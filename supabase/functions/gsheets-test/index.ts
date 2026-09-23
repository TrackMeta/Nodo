// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: gsheets-test  (AUTENTICADA — verify_jwt=true)
//   Escribe una fila de PRUEBA en la app web de Apps Script del usuario.
//   Se hace desde el servidor porque el navegador no puede (CORS de Google).
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userOwnsChannel, userIsChannelAdmin } from "../_shared/db.ts";
import { getAccessToken, sheetsAppend, sheetsBootstrap, sheetsEstado, crearHojaDelCanal, sheetsLeerFila, sheetsBorrarFila } from "../_shared/gsheets.ts";
import { fetchConTimeout } from "../_shared/http.ts";

const db = serviceClient();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const { data: u } = await userClient(auth).auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);
  const { data: member } = await db.from("app_users").select("id").eq("id", uid).eq("activo", true).maybeSingle();
  if (!member) return json({ error: "not_member" }, 403);

  let body: { webhook_url?: string; tab?: string; oauth?: boolean; preparar?: boolean; crear?: boolean; estado?: boolean; leer_fila?: boolean; borrar_fila?: boolean; order_id?: string; channel_id?: string; spreadsheet_id?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  // Multi-tenant: cualquier acción sobre un canal exige ser de su cuenta.
  if (body.channel_id && !(await userOwnsChannel(db, uid, body.channel_id))) return json({ error: "forbidden_channel" }, 403);
  // 🔒 `preparar` (crear/reescribir las pestañas de la hoja) es config de la integración →
  // solo ADMIN. Una fila de prueba suelta queda abierta al operador (como el `test` de channel-config).
  if ((body.preparar || body.crear) && body.channel_id && !(await userIsChannelAdmin(db, uid, body.channel_id))) {
    return json({ error: "forbidden", detalle: "Solo un administrador puede preparar la hoja de Google Sheets." }, 403);
  }
  const fecha = new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" }).format(new Date());

  // ── Crear una hoja NUEVA y dejarla conectada (botón de Ajustes) ─────
  if (body.crear) {
    if (!body.channel_id) return json({ error: "faltan_datos" }, 400);
    const { data: refresh } = await db.rpc("get_gsheets_token", { p_channel_id: body.channel_id });
    if (!refresh) return json({ ok: false, detalle: "El canal no está conectado con Google (reconecta)" });
    try {
      const token = await getAccessToken(String(refresh));
      const r = await crearHojaDelCanal(db, body.channel_id, token);
      return json({ ok: true, spreadsheet_id: r.id, spreadsheet_url: r.url, titulo: r.titulo });
    } catch (e) {
      return json({ ok: false, detalle: String((e as any)?.message ?? e) });
    }
  }

  // ── Leer (o borrar) la fila de UN pedido: comprobar qué llegó a la hoja ──
  if (body.leer_fila || body.borrar_fila) {
    if (!body.channel_id || !body.spreadsheet_id || !body.order_id || !body.tab) return json({ error: "faltan_datos" }, 400);
    if (!(await userIsChannelAdmin(db, uid, body.channel_id))) return json({ error: "forbidden" }, 403);
    // Solo pedidos de ESTE canal: no se lee ni borra una fila que no le toca.
    const { data: ord } = await db.from("orders").select("id").eq("id", body.order_id).eq("channel_id", body.channel_id).maybeSingle();
    if (!ord) return json({ ok: false, detalle: "Ese pedido no es de este canal" });
    const { data: refresh } = await db.rpc("get_gsheets_token", { p_channel_id: body.channel_id });
    if (!refresh) return json({ ok: false, detalle: "El canal no está conectado con Google (reconecta)" });
    try {
      const token = await getAccessToken(String(refresh));
      if (body.borrar_fila) return json({ ok: true, borrada: await sheetsBorrarFila(token, body.spreadsheet_id, body.tab, body.order_id) });
      return json({ ok: true, ...(await sheetsLeerFila(token, body.spreadsheet_id, body.tab, body.order_id)) });
    } catch (e) {
      return json({ ok: false, detalle: String((e as any)?.message ?? e) });
    }
  }

  // ── ¿La hoja guardada sigue existiendo? (Ajustes lo mira al abrir) ──
  // Sin esto, una hoja borrada seguía saliendo como «Conectada» y cada venta se perdía.
  if (body.estado) {
    if (!body.channel_id || !body.spreadsheet_id) return json({ error: "faltan_datos" }, 400);
    const { data: refresh } = await db.rpc("get_gsheets_token", { p_channel_id: body.channel_id });
    if (!refresh) return json({ ok: true, estado: "sin_token" });
    try {
      const token = await getAccessToken(String(refresh));
      return json({ ok: true, estado: await sheetsEstado(token, body.spreadsheet_id) });
    } catch (e) {
      return json({ ok: false, detalle: String((e as any)?.message ?? e) });
    }
  }

  // ── Preparar la hoja: crea las 3 pestañas con sus encabezados ──────
  // Corre al guardar la hoja, para que conectar sea una sola cosa: el usuario
  // pega el enlace y ya está todo listo. No hay que pedirle que cree pestañas
  // ni tipee encabezados a mano.
  if (body.preparar) {
    if (!body.channel_id || !body.spreadsheet_id) return json({ error: "faltan_datos" }, 400);
    const { data: refresh } = await db.rpc("get_gsheets_token", { p_channel_id: body.channel_id });
    if (!refresh) return json({ ok: false, detalle: "El canal no está conectado con Google (reconecta)" });
    try {
      const token = await getAccessToken(String(refresh));
      const r = await sheetsBootstrap(token, body.spreadsheet_id);
      return json({ ok: true, ...r });
    } catch (e) {
      return json({ ok: false, detalle: String((e as any)?.message ?? e) });
    }
  }

  // ── Modo OAuth: escribir vía la Sheets API con el token del canal ──
  if (body.oauth) {
    if (!body.channel_id || !body.spreadsheet_id) return json({ error: "faltan_datos" }, 400);
    const { data: refresh } = await db.rpc("get_gsheets_token", { p_channel_id: body.channel_id });
    if (!refresh) return json({ ok: false, detalle: "El canal no está conectado con Google (reconecta)" });
    try {
      const token = await getAccessToken(String(refresh));
      await sheetsAppend(token, body.spreadsheet_id, body.tab || undefined, { Prueba: "Nodo ✓", Fecha: fecha });
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, detalle: String((e as any)?.message ?? e) });
    }
  }

  // ── Modo Apps Script: POST a la app web ──
  // 🔒 También exige el canal (y arriba, ser de su cuenta): sin eso cualquier miembro de la
  // plataforma usaba esta función como relé ciego para disparar CUALQUIER Apps Script /exec
  // ajeno desde nuestro servidor.
  if (!body.channel_id) return json({ error: "faltan_datos", detalle: "Falta el canal" }, 400);
  const url = body.webhook_url?.trim();
  if (!url || !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(url)) {
    return json({ error: "url_invalida", detalle: "La URL debe ser una app web de Apps Script (/exec)" }, 400);
  }
  try {
    const res = await fetchConTimeout(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hoja: body.tab || undefined, fila: { Prueba: "Nodo ✓", Fecha: fecha } }),
    });
    const txt = await res.text();
    if (!res.ok) return json({ ok: false, detalle: `HTTP ${res.status}: ${txt.slice(0, 200)}` });
    // Apps Script devuelve 200 IGUAL cuando la app web está desplegada con acceso equivocado
    // ("Solo yo" en vez de "Cualquiera" → Google sirve una página de LOGIN HTML) o cuando doPost
    // lanza (página de error HTML). Con solo res.ok se daba falso OK y la sincronización real fallaba
    // en producción. Se detecta esa página HTML: la escritura real no devuelve un documento <html>.
    const t = txt.trim();
    if (/^<(!doctype|html)/i.test(t) || /accounts\.google\.com|ServiceLogin|autoriza|authoriz|iniciar sesión|sign in/i.test(t)) {
      return json({ ok: false, detalle: "La app web respondió una página de Google (login/permiso) en vez de escribir la fila. Vuelve a desplegarla con acceso «Cualquiera» y reintenta." });
    }
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, detalle: String((e as any)?.message ?? e) });
  }
});
