// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: gsheets-connect  (AUTENTICADA — verify_jwt=true)
//   Devuelve la URL de "Acceder con Google" para conectar Sheets por OAuth.
//   Crea un nonce (estado) para asegurar el callback.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userOwnsChannel, userIsChannelAdmin } from "../_shared/db.ts";
import { getAccessToken, sheetsEstado, crearHojaDelCanal } from "../_shared/gsheets.ts";

const db = serviceClient();
const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
const REDIRECT = "https://ahoxdyffbwjlshmdezwi.supabase.co/functions/v1/gsheets-callback";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const { data: u } = await userClient(auth).auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);
  const { data: member } = await db.from("app_users").select("id").eq("id", uid).eq("activo", true).maybeSingle();
  if (!member) return json({ error: "not_member" }, 403);

  let body: { channel_id?: string; disconnect?: boolean; confirmar?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!body.channel_id) return json({ error: "falta_channel" }, 400);
  if (!(await userOwnsChannel(db, uid, body.channel_id))) return json({ error: "forbidden_channel" }, 403);
  // 🔒 Conectar/desconectar la sync a Google Sheets toca la integración del canal (enlaza una
  // cuenta de Google arbitraria o corta la sincronización) → solo ADMIN de la cuenta, igual que
  // channel-config/ai-config. Antes un operador podía hacerlo (misma clase de hueco).
  if (!(await userIsChannelAdmin(db, uid, body.channel_id))) return json({ error: "forbidden", detalle: "Solo un administrador puede conectar o desconectar Google Sheets." }, 403);

  // ── Confirmar la conexión que dejó PENDIENTE el callback (0120) ─────────────────────
  // Solo la activa el MISMO usuario que la inició, con el código `gc` que Google le devolvió a
  // SU navegador. Así el permiso de Google queda atado a quien pidió conectar: un tercero al que
  // le pasaron el enlace no tiene esta sesión, y el que se lo pasó no tiene el código.
  if (body.confirmar) {
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(body.confirmar))))]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    // DELETE … RETURNING: un solo uso, aunque lleguen dos confirmaciones juntas.
    const { data: filas, error: eP } = await db.from("gsheets_oauth_state").delete()
      .eq("confirm_hash", hash).eq("channel_id", body.channel_id)
      .select("user_id, created_at, pendiente_refresh, pendiente_email");
    const p = ((filas ?? []) as any[])[0];
    if (eP || !p || !p.pendiente_refresh) return json({ error: "expirado", detalle: "La conexión con Google expiró o ya se usó. Vuelve a conectar." }, 400);
    if (Date.now() - new Date(p.created_at ?? 0).getTime() > 10 * 60 * 1000) return json({ error: "expirado", detalle: "Pasaron más de 10 minutos. Vuelve a conectar." }, 400);
    if (p.user_id && p.user_id !== uid) return json({ error: "otro_usuario", detalle: "Esta conexión la inició otra persona del equipo: tiene que confirmarla ella, con su sesión." }, 403);
    // El error se MIRA: `db.rpc()` no lanza. Sin esto, un fallo al guardar el refresh token en
    // el Vault seguía de largo, marcaba `connected: true` y el panel decía «conectado» con la
    // sincronización muerta.
    const { error: eTok } = await db.rpc("set_gsheets_token", { p_channel_id: body.channel_id, p_refresh_token: p.pendiente_refresh, p_email: p.pendiente_email ?? null });
    if (eTok) { console.error("[gsheets-connect] set_gsheets_token:", eTok.message); return json({ error: "sin_guardar", detalle: "Google dio el permiso pero no pudimos guardarlo. Reintenta." }, 500); }
    // Modo OAuth en channels.gsheets, conservando la hoja si ya había, y el rastro de quién.
    const { data: ch } = await db.from("channels").select("gsheets").eq("id", body.channel_id).maybeSingle();
    const g = ((ch as any)?.gsheets ?? {}) as Record<string, unknown>;
    g.connected = true; g.mode = "oauth"; g.google_email = p.pendiente_email ?? null;
    g.conectado_por = uid; g.conectado_at = new Date().toISOString();
    await db.from("channels").update({ gsheets: g }).eq("id", body.channel_id);
    // 📗 Conectar deja la hoja LISTA: si no había, o la guardada ya no existe o esta cuenta de
    // Google no la ve, se crea una nueva. Una hoja que sigue viva NO se toca.
    try {
      const token = await getAccessToken(String(p.pendiente_refresh));
      const sid = String(g.spreadsheet_id ?? "");
      const estado = sid ? await sheetsEstado(token, sid) : "no_existe";
      if (estado !== "ok") {
        await crearHojaDelCanal(db, body.channel_id, token);
        return json({ ok: true, hoja: sid ? "recreada" : "creada" });
      }
    } catch (e) {
      // El permiso ya quedó guardado: sin hoja, Ajustes ofrece crearla o pegar una.
      console.error("[gsheets-connect] crear hoja:", (e as any)?.message ?? e);
    }
    return json({ ok: true, hoja: "ok" });
  }

  // Desconectar: borra el refresh token del Vault (no necesita OAuth configurado).
  if (body.disconnect) {
    // El error se MIRA (db.rpc no lanza): si el token NO se borró del Vault y acá abajo se
    // marcaba `connected:false`, el panel decía «desconectado» con la credencial de Google
    // todavía guardada. Desconectar tiene que ser verdad.
    const { error: eDel } = await db.rpc("delete_gsheets_token", { p_channel_id: body.channel_id });
    if (eDel) {
      console.error("[gsheets-connect] delete_gsheets_token:", eDel.message);
      return json({ error: "no_desconectado", detalle: "No se pudo borrar el permiso de Google. Reintenta." }, 500);
    }
    // Limpia también el estado en channels.gsheets (que el callback escribe al conectar). Sin
    // esto el panel seguía mostrando "conectado" y syncPedidoSheet entraba por la rama oauth
    // hasta que el token daba null. Se conserva el resto (spreadsheet_id, webhook_url).
    const { data: chG } = await db.from("channels").select("gsheets").eq("id", body.channel_id).maybeSingle();
    const g = ((chG as any)?.gsheets ?? {}) as Record<string, unknown>;
    await db.from("channels").update({ gsheets: { ...g, connected: false, mode: null } }).eq("id", body.channel_id);
    return json({ ok: true });
  }
  if (!CLIENT_ID) return json({ error: "sin_configurar", detalle: "Falta configurar GOOGLE_OAUTH_CLIENT_ID en el servidor" }, 400);

  const nonce = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  // El nonce lleva QUIÉN lo pidió, no solo el canal: el callback comprueba que esa persona siga
  // siendo admin del canal y deja anotado quién conectó (0118). Sin la columna todavía, se
  // guarda como antes. Y el error se mira: si el insert fallaba, Google devolvía a un callback
  // que no encontraba el nonce y el panel decía «expirado» sin motivo.
  let { error: eIns } = await db.from("gsheets_oauth_state").insert({ nonce, channel_id: body.channel_id, user_id: uid });
  if (eIns && /user_id/.test(eIns.message)) ({ error: eIns } = await db.from("gsheets_oauth_state").insert({ nonce, channel_id: body.channel_id }));
  if (eIns) {
    console.error("[gsheets-connect] guardar state:", eIns.message);
    return json({ error: "no_iniciado", detalle: "No se pudo iniciar la conexión con Google. Reintenta." }, 500);
  }
  await db.from("gsheets_oauth_state").delete().lt("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());

  const p = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: "code",
    scope: SCOPE, access_type: "offline", prompt: "consent",
    include_granted_scopes: "true", state: nonce,
  });
  return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}` });
});
