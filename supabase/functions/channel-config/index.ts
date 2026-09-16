// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: channel-config  (AUTENTICADA — verify_jwt=true)
//   Gestiona los datos y secretos del canal (WhatsApp/Meta + Telegram)
//   desde ⚙️ Configuraciones. Los secretos van cifrados a Vault; nunca
//   se guardan en tablas legibles ni se devuelven.
//   Acciones: status | save | whatsapp_test | whatsapp_disconnect | …
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, getChannelSecrets, userOwnsChannel, userIsChannelAdmin } from "../_shared/db.ts";
import { setWebhook, deleteWebhook } from "../_shared/telegram.ts";
import { AVISOS } from "../_shared/avisos.ts";
import { matchSegment, BATCH } from "../_shared/campaigns.ts";
import { fetchConTimeout } from "../_shared/http.ts";

const db = serviceClient();
const GRAPH_V = "v25.0";
// Dos ayudantes para hablar con Meta con el token del canal. Devuelven {status, body} y
// nunca lanzan: un timeout o una caída de red se leen igual que un error de Meta.
async function metaGet(token: string, path: string) {
  try {
    const r = await fetchConTimeout(`https://graph.facebook.com/${GRAPH_V}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { status: r.status, body: await r.json().catch(() => ({})) as any };
  } catch (e) {
    return { status: 0, body: { error: { message: String((e as any)?.message ?? e) } } as any };
  }
}
async function metaPost(token: string, path: string, payload?: Record<string, unknown>) {
  try {
    const r = await fetchConTimeout(`https://graph.facebook.com/${GRAPH_V}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => ({})) as any };
  } catch (e) {
    return { status: 0, body: { error: { message: String((e as any)?.message ?? e) } } as any };
  }
}
const pinNuevo = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
// Campos planos del canal editables desde el panel.
const PLAIN = ["phone_number_id", "waba_id", "verify_token", "pixel_id", "page_id"];
// Secretos → Vault.
const SECRETS = ["access_token", "app_secret", "capi_token", "telegram_bot_token", "ads_token"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userRes } = await userClient(authHeader).auth.getUser();
  const uid = userRes?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);
  const { data: member } = await db
    .from("app_users").select("id, role, platform_admin").eq("id", uid).eq("activo", true).maybeSingle();
  if (!member) return json({ error: "not_member" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const { action, channel_id } = body ?? {};
  if (!channel_id) return json({ error: "falta_channel" }, 400);

  const { data: channel } = await db.from("channels").select("id").eq("id", channel_id).maybeSingle();
  if (!channel) return json({ error: "canal_invalido" }, 400);
  // Multi-tenant: el que llama debe ser miembro de la cuenta dueña del canal
  // (esta función toca secretos del canal — el chequeo es imprescindible aquí).
  if (!(await userOwnsChannel(db, uid, channel_id))) return json({ error: "forbidden_channel" }, 403);
  // 🔒 Rol: las acciones que tocan SECRETOS/conexiones (tokens de Meta, app_secret, CAPI,
  // el pairing de Telegram = "la llave para volverse admin") son solo para admin. Antes
  // cualquier miembro activo —incluido un operador/vendedor— podía rotar el access_token,
  // desconectar WhatsApp o generar el código de Telegram (escalada funcional operador→admin).
  // La config de negocio (avisos/resumen/plantillas) y los tests siguen abiertos al operador.
  // Rol POR CUENTA (account_members.role de la cuenta dueña del canal), NO el legacy global
  // app_users.role — que diverge y permitía escalada operador→admin en otra cuenta.
  const esAdmin = await userIsChannelAdmin(db, uid, channel_id);
  // template_submit crea/envía una plantilla a Meta con el access_token del canal (cambia
  // estado del lado de Meta) → coherente con el resto del gating, solo admin.
  // whatsapp_fix escribe en la cuenta de Meta DEL CLIENTE (suscribe la app, registra el
  // número): mismo criterio que el resto de acciones de conexión, solo admin.
  const ADMIN_ACTIONS = new Set(["save", "whatsapp_disconnect", "whatsapp_fix", "whatsapp_finish", "whatsapp_descubrir", "telegram_disconnect", "telegram_connect", "telegram_pair_start", "template_submit"]);
  if (ADMIN_ACTIONS.has(action) && !esAdmin) return json({ error: "forbidden", detalle: "Solo un administrador puede cambiar los secretos o conexiones del canal." }, 403);

  try {
    if (action === "status") {
      const { data } = await db.rpc("channel_secrets_status", { p_channel_id: channel_id }).maybeSingle();
      const s = data ?? {};
      // `copiloto` (¿el webhook de Telegram está activo?) se resuelve acá server-side en
      // vez de que el panel lea channels.telegram_webhook_secret: ese secreto es material
      // del webhook y NO debe ser legible por un miembro (con él podría forjar el webhook
      // público y aprobar pagos). Migración 0073 revoca el SELECT de esa columna.
      const { data: cRow } = await db.from("channels").select("telegram_webhook_secret").eq("id", channel_id).maybeSingle();
      return json({ ok: true, secrets: {
        access_token: !!(s as any).access_token, app_secret: !!(s as any).app_secret,
        capi_token: !!(s as any).capi_token, telegram_bot_token: !!(s as any).telegram_bot_token,
        ads_token: !!(s as any).ads_token,
        copiloto: !!(cRow as any)?.telegram_webhook_secret,
      } });
    }
    // ¿Sigue pendiente el código de pairing de Telegram? (para el poll del panel, que ya
    // no lee channels.telegram_pair — ese código lo puede leer cualquier miembro por RLS).
    if (action === "telegram_pair_status") {
      const { data: c } = await db.from("channels").select("telegram_pair").eq("id", channel_id).maybeSingle();
      return json({ ok: true, pendiente: !!(c as any)?.telegram_pair });
    }

    // Conecta el Copiloto de Telegram: registra el webhook del bot de ESTE
    // canal. El secreto se genera acá (server-side) y viaja de vuelta en cada
    // update dentro de un header — es lo que prueba que el request viene de
    // Telegram y no de cualquiera que adivine la URL.
    if (action === "telegram_connect") {
      const secrets = await getChannelSecrets(db, channel_id);
      const token = secrets?.telegram_bot_token;
      if (!token) return json({ error: "sin_token", detalle: "Carga primero el bot token del canal." }, 400);
      const secret = crypto.randomUUID().replace(/-/g, "");
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram-webhook?ch=${channel_id}`;
      const r = await setWebhook(token, url, secret);
      if (!r.ok) return json({ error: "telegram", detalle: r.error }, 400);
      const { error } = await db.from("channels").update({ telegram_webhook_secret: secret }).eq("id", channel_id);
      if (error) return json({ error: "guardar_secreto", detalle: error.message }, 400);
      return json({ ok: true, url });
    }

    // Genera el código para vincular un Telegram. Corto (se tipea en el
    // celular) y efímero (5 min): es la llave para volverse admin, así que no
    // puede quedar dando vueltas. El webhook lo valida cuando llega el mensaje.
    if (action === "telegram_pair_start") {
      const { data: c } = await db.from("channels").select("telegram_webhook_secret").eq("id", channel_id).maybeSingle();
      if (!(c as any)?.telegram_webhook_secret) {
        return json({ error: "sin_webhook", detalle: "Activa primero el Copiloto: sin eso el bot no puede recibir tu código." }, 400);
      }
      const codigo = String(Math.floor(100000 + Math.random() * 900000));
      const vence = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const { error } = await db.from("channels").update({ telegram_pair: { codigo, vence } }).eq("id", channel_id);
      if (error) return json({ error: "guardar_codigo", detalle: error.message }, 400);
      return json({ ok: true, codigo, vence });
    }

    // El catálogo de avisos + lo que el canal tenga configurado. El panel NO
    // tiene su propia copia de la lista a propósito: dos listas se separan al
    // primer cambio y nadie se entera hasta que un aviso sale mal.
    if (action === "avisos_catalogo") {
      const { data: c } = await db.from("channels").select("telegram_avisos, resumenes").eq("id", channel_id).maybeSingle();
      return json({ ok: true, catalogo: AVISOS, config: (c as any)?.telegram_avisos ?? null, resumenes: (c as any)?.resumenes ?? null });
    }

    // A cuánta gente le llegaría una campaña con ESTE segmento, antes de programarla.
    // Usa la MISMA función que arma la audiencia de verdad (matchSegment), no una copia en
    // el navegador: una copia diverge al primer cambio de reglas y el número empieza a
    // mentir. Con eso el panel puede además decir cuánto va a tardar en salir, que es el
    // dato que nadie calcula de cabeza (25 envíos por minuto: 5.000 personas son 3 horas).
    if (action === "campana_audiencia") {
      try {
        const ids = await matchSegment(db, channel_id, (body as any).segmento ?? {});
        // `por_minuto` viaja con el total para que el panel no tenga que saberse el ritmo: es el
        // BATCH real del envío (el cron corre cada minuto), no una copia que pueda quedar vieja.
        return json({ ok: true, total: ids.length, por_minuto: BATCH });
      } catch (e) {
        return json({ error: "no_se_pudo", detalle: String((e as any)?.message ?? e) }, 500);
      }
    }

    // Resúmenes diarios (mañana/noche) a Telegram. Solo config; el estado
    // anti-duplicado (resumen_estado) lo maneja el scheduler.
    if (action === "resumen_guardar") {
      const norm = (x: any) => {
        if (!x || typeof x !== "object") return { on: false, hora: "08:00" };
        let hora = typeof x.hora === "string" ? x.hora.trim() : "";
        if (!/^\d{2}:\d{2}$/.test(hora)) hora = "08:00";
        const [h, m] = hora.split(":").map((n: string) => parseInt(n, 10));
        if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) hora = "08:00";
        return { on: x.on === true, hora };
      };
      const resumenes = {
        manana: norm(body.resumenes?.manana),
        noche: norm(body.resumenes?.noche),
      };
      const { error } = await db.from("channels").update({ resumenes }).eq("id", channel_id);
      if (error) return json({ error: "guardar_resumenes", detalle: error.message }, 400);
      return json({ ok: true });
    }

    // Guarda el on/off y el texto propio de cada aviso. Se manda el objeto
    // entero: es chico y así borrar un texto (volver al default) es simplemente
    // no mandarlo, sin necesidad de un "borrar" aparte.
    if (action === "avisos_guardar") {
      const items: Record<string, { on?: boolean; texto?: string; foto?: boolean }> = {};
      for (const a of AVISOS) {
        const v = body.items?.[a.clave];
        if (!v) continue;
        const fila: { on?: boolean; texto?: string; foto?: boolean } = {};
        if (v.on === false) fila.on = false;                       // solo se guarda lo apagado
        const t = typeof v.texto === "string" ? v.texto.trim() : "";
        if (t && t !== a.texto) fila.texto = t.slice(0, 3000);      // igual al default → no se guarda
        // Adjuntar comprobante: solo tiene sentido en los avisos marcados como tal.
        if (a.comprobante && v.foto === true) fila.foto = true;
        if (Object.keys(fila).length) items[a.clave] = fila;
      }
      const cfg: Record<string, unknown> = { items };
      if (body.hora === false) cfg.hora = false;
      const { error } = await db.from("channels").update({ telegram_avisos: cfg }).eq("id", channel_id);
      if (error) return json({ error: "guardar_avisos", detalle: error.message }, 400);
      return json({ ok: true });
    }

    // Diagnóstico REAL de la conexión. "Conectado" en el panel solo significaba
    // "hay un token guardado": no probaba que el token siga siendo válido, que
    // el webhook esté registrado, ni que los avisos lleguen a alguien. Acá se
    // comprueban las tres cosas contra Telegram y se manda un mensaje de prueba.
    if (action === "telegram_test") {
      const secrets = await getChannelSecrets(db, channel_id);
      const token = secrets?.telegram_bot_token;
      if (!token) return json({ ok: true, bot: null, webhook: null, enviados: 0, chats: 0, motivo: "sin_token" });

      const tg = async (m: string) => {
        try {
          const r = await fetchConTimeout(`https://api.telegram.org/bot${token}/${m}`);
          return await r.json();
        } catch (e) { return { ok: false, description: String((e as any)?.message ?? e) }; }
      };
      const me = await tg("getMe");
      const wh = await tg("getWebhookInfo");

      const { data: c } = await db.from("channels")
        .select("telegram_chat_ids, telegram_webhook_secret, nombre").eq("id", channel_id).maybeSingle();
      const chatIds = ((c as any)?.telegram_chat_ids ?? []).map(String);

      // El envío de prueba se hace chat por chat para poder decir CUÁL falló:
      // el error típico es que alguien bloqueó al bot y hay que sacarlo.
      const detalle: { chat: string; ok: boolean; error?: string }[] = [];
      for (const chat of chatIds) {
        try {
          const r = await fetchConTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chat, parse_mode: "HTML", disable_web_page_preview: true,
              text: `🔔 <b>Prueba de conexión</b>\n<i>${(c as any)?.nombre ?? "Tu bot"}</i> · si lees esto, los avisos te van a llegar bien.`,
            }),
          });
          const d = await r.json();
          detalle.push({ chat, ok: !!d?.ok, error: d?.ok ? undefined : (d?.description ?? "falló") });
        } catch (e) { detalle.push({ chat, ok: false, error: String((e as any)?.message ?? e) }); }
      }

      const esperada = `${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram-webhook?ch=${channel_id}`;
      return json({
        ok: true,
        bot: me?.ok ? { nombre: me.result?.first_name, usuario: me.result?.username } : null,
        bot_error: me?.ok ? null : (me?.description ?? "token inválido"),
        webhook: {
          registrado: !!wh?.result?.url,
          apunta_bien: wh?.result?.url === esperada,
          copiloto: !!(c as any)?.telegram_webhook_secret,
          pendientes: wh?.result?.pending_update_count ?? 0,
          ultimo_error: wh?.result?.last_error_message ?? null,
        },
        chats: chatIds.length,
        enviados: detalle.filter((d) => d.ok).length,
        detalle,
      });
    }

    // Diagnóstico REAL de WhatsApp. "Conectado" en el panel solo significa "hay
    // un token guardado": no prueba que Meta lo acepte, ni que la app esté
    // suscrita a la WABA (sin eso NO entra ni un mensaje). Acá se comprueba todo
    // contra Graph y se lee la calidad del número (verde/amarillo/rojo).
    if (action === "whatsapp_test") {
      const { data: c } = await db.from("channels")
        .select("phone_number_id, waba_id, verify_token").eq("id", channel_id).maybeSingle();
      const phoneId = (c as any)?.phone_number_id;
      const wabaId = (c as any)?.waba_id;
      const secrets = await getChannelSecrets(db, channel_id);
      const token = secrets?.access_token;

      // Sin lo mínimo no tiene sentido llamar a Meta: se dice qué falta.
      if (!phoneId || !token) {
        return json({ ok: true, configurado: false, falta: { phone: !phoneId, token: !token } });
      }

      const V = "v25.0";
      const g = async (path: string) => {
        try {
          const r = await fetchConTimeout(`https://graph.facebook.com/${V}/${path}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          return { status: r.status, body: await r.json() };
        } catch (e) {
          return { status: 0, body: { error: { message: String((e as any)?.message ?? e) } } };
        }
      };

      // 1) El número: valida token + phone_number_id de un solo tiro.
      // `platform_type` dice si el número está REGISTRADO en la Cloud API ("CLOUD_API") o
      // si sigue en el limbo de "agregado pero sin registrar" — el estado en el que el
      // webhook está verde, los datos correctos, y aun así no entra ni sale un mensaje.
      const num = await g(`${phoneId}?fields=verified_name,display_phone_number,quality_rating,code_verification_status,platform_type,status`);
      const numOk = num.status === 200 && !num.body?.error;

      // 2) Suscripción de la app a la WABA (necesaria para RECIBIR mensajes).
      let suscripcion: { comprobado: boolean; suscrito?: boolean; error?: string } | null = null;
      if (wabaId) {
        const sub = await g(`${wabaId}/subscribed_apps`);
        if (sub.status === 200 && Array.isArray((sub.body as any)?.data)) {
          suscripcion = { comprobado: true, suscrito: (sub.body as any).data.length > 0 };
        } else {
          suscripcion = { comprobado: false, error: (sub.body as any)?.error?.message ?? "no se pudo consultar" };
        }
      }

      // 3) ¿La app de Meta apunta su webhook a Nodo, y a los campos que hacen falta?
      //    Es lo único de la conexión que vivía SOLO en la pantalla de Meta: desde acá no
      //    se veía, así que un webhook apuntando a otro sitio (o sin el campo `messages`)
      //    era invisible. El app_id sale de debug_token; el app access token, de juntarlo
      //    con el App Secret que el usuario ya pegó.
      let appHook: { comprobado: boolean; apunta_aqui?: boolean; url?: string | null; campos?: string[]; error?: string } | null = null;
      if (secrets?.app_secret) {
        const dbg = await metaGet(token, `debug_token?input_token=${encodeURIComponent(token)}`);
        const appId = dbg.status === 200 ? String(dbg.body?.data?.app_id ?? "") : "";
        if (appId) {
          const callback = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-webhook`;
          const subs = await metaGet(`${appId}|${secrets.app_secret}`, `${appId}/subscriptions`);
          if (subs.status === 200 && Array.isArray(subs.body?.data)) {
            const wa = subs.body.data.find((s: any) => s?.object === "whatsapp_business_account");
            appHook = {
              comprobado: true,
              apunta_aqui: wa?.callback_url === callback,
              url: wa?.callback_url ?? null,
              campos: (wa?.fields ?? []).map((f: any) => f?.name ?? f),
            };
          } else {
            appHook = { comprobado: false, error: String(subs.body?.error?.message ?? "no se pudo consultar") };
          }
        }
      }

      return json({
        ok: true,
        configurado: true,
        app_webhook: appHook,
        numero: numOk ? {
          nombre: (num.body as any).verified_name ?? null,
          telefono: (num.body as any).display_phone_number ?? null,
          calidad: (num.body as any).quality_rating ?? null,
          verificado: (num.body as any).code_verification_status ?? null,
          plataforma: (num.body as any).platform_type ?? null,
          estado: (num.body as any).status ?? null,
        } : null,
        registrado: numOk ? ((num.body as any).platform_type === "CLOUD_API") : null,
        numero_error: numOk ? null : ((num.body as any)?.error?.message ?? "Meta rechazó el token o el Phone Number ID"),
        webhook: { app_secret: !!secrets?.app_secret, verify_token: !!(c as any)?.verify_token },
        suscripcion,
      });
    }

    // ── Averiguar los IDs a partir del token ───────────────────────────────────────────
    // El Phone Number ID y el WABA ID no son secretos: son etiquetas, y el token que el
    // usuario acaba de pegar YA dice a qué cuenta pertenece. Copiarlos a mano es trabajo
    // que Meta puede contestar — y es de donde salen los errores más tontos (Chrome llegó
    // a autocompletar el Phone Number ID con el nombre de una empresa guardada, "Square",
    // y eso rompía el canal en silencio; ver la validación numérica en el panel).
    // Todo acá es de SOLO LECTURA: mira, no toca.
    if (action === "whatsapp_descubrir") {
      // El token puede venir recién escrito (aún sin guardar) o estar ya en Vault.
      const tokenDado = String(body.token ?? "").trim();
      const token = tokenDado || (await getChannelSecrets(db, channel_id))?.access_token;
      if (!token) return json({ error: "falta_token", detalle: "Pega primero el Access token." }, 400);

      // De qué WABAs habla este token. granular_scopes trae, por permiso, los ids de los
      // activos que el token puede tocar: ahí está la cuenta de WhatsApp Business.
      const dbg = await metaGet(token, `debug_token?input_token=${encodeURIComponent(token)}`);
      if (dbg.status !== 200 || dbg.body?.error) {
        return json({ error: "meta", detalle: String(dbg.body?.error?.message ?? "Meta no reconoció el token.") }, 400);
      }
      const scopes = (dbg.body?.data?.granular_scopes ?? []) as any[];
      const ids = new Set<string>();
      for (const s of scopes) {
        if (s?.scope === "whatsapp_business_management" || s?.scope === "whatsapp_business_messaging") {
          for (const t of (s.target_ids ?? [])) ids.add(String(t));
        }
      }
      // Sin granular_scopes (tokens viejos o con acceso a todo) queda el WABA ya guardado.
      if (!ids.size) {
        const { data: c } = await db.from("channels").select("waba_id").eq("id", channel_id).maybeSingle();
        if ((c as any)?.waba_id) ids.add(String((c as any).waba_id));
      }
      if (!ids.size) {
        return json({ ok: true, cuentas: [], motivo: "El token no declara ninguna cuenta de WhatsApp Business. Suele pasar cuando se generó ANTES de asignarle los activos al usuario del sistema." });
      }

      const cuentas: any[] = [];
      for (const waba of ids) {
        const [info, nums] = await Promise.all([
          metaGet(token, `${waba}?fields=name`),
          metaGet(token, `${waba}/phone_numbers?fields=id,display_phone_number,verified_name`),
        ]);
        cuentas.push({
          waba_id: waba,
          nombre: info.status === 200 ? (info.body?.name ?? null) : null,
          numeros: (nums.body?.data ?? []).map((n: any) => ({
            id: String(n.id), telefono: n.display_phone_number ?? null, nombre: n.verified_name ?? null,
          })),
          error: nums.status === 200 ? null : String(nums.body?.error?.message ?? "no se pudieron listar los números"),
        });
      }
      return json({ ok: true, cuentas });
    }

    // ── Terminar la conexión ───────────────────────────────────────────────────────────
    // Se llama justo DESPUÉS de guardar los datos del número. Si ya están los cuatro, Nodo
    // hace por su cuenta los dos trámites que faltan —suscribir la app y registrar el
    // número— en vez de mandar al usuario de vuelta a Meta a buscar un interruptor
    // escondido y a pelearse con un «se produjo un error» que no dice nada.
    // Es lo que hace un instalador: no te enseña las palabras, te deja el aparato andando.
    // Solo toca lo que falta: si ya estaba suscrita o ya estaba registrado, no llama.
    if (action === "whatsapp_finish") {
      const { data: c } = await db.from("channels")
        .select("phone_number_id, waba_id").eq("id", channel_id).maybeSingle();
      const phoneId = (c as any)?.phone_number_id;
      const wabaId = (c as any)?.waba_id;
      const secrets = await getChannelSecrets(db, channel_id);
      const token = secrets?.access_token;

      // Sin lo mínimo no hay nada que terminar: se guardó un pedazo y falta el resto.
      const falta: string[] = [];
      if (!phoneId) falta.push("Phone Number ID");
      if (!token) falta.push("Access token");
      if (falta.length) return json({ ok: true, listo: false, falta });

      const hecho: string[] = [];
      const fallo: { que: string; motivo: string; necesita_pin?: boolean }[] = [];
      let pin: string | null = null;

      // 0) El webhook de la app. Esto es lo que antes se hacía a mano en dos pasos: generar
      //    una frase, guardarla, irse a Meta, pegar la URL y la frase, y darle a «Verificar
      //    y guardar» — con la trampa de que si la guardabas DESPUÉS, Meta contestaba «no se
      //    pudo verificar» sin decir por qué. Acá el orden es imposible de invertir.
      //    Necesita un app access token (`{app_id}|{app_secret}`): el app_id lo devuelve
      //    debug_token —así que no hay que pedírselo al usuario— y el App Secret ya lo pegó.
      const appSecret = secrets?.app_secret;
      if (appSecret) {
        const dbg = await metaGet(token, `debug_token?input_token=${encodeURIComponent(token)}`);
        const appId = dbg.status === 200 ? String(dbg.body?.data?.app_id ?? "") : "";
        if (appId) {
          const appToken = `${appId}|${appSecret}`;
          const callback = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-webhook`;
          const subs = await metaGet(appToken, `${appId}/subscriptions`);
          const wa = (subs.body?.data ?? []).find((s: any) => s?.object === "whatsapp_business_account");
          const campos: string[] = (wa?.fields ?? []).map((f: any) => String(f?.name ?? f));
          // 🔴 El POST REEMPLAZA la lista de campos, no la amplía. Suscribirse solo a los dos
          // que Nodo necesita borraría los que Meta pone por defecto desde su panel
          // (account_alerts, phone_number_quality_update…), que son los avisos de que tu
          // número está en riesgo. Se manda la UNIÓN de lo que ya había con lo que hace falta.
          const QUIERO = ["messages", "message_template_status_update"];
          const DEFECTO = ["account_alerts", "account_review_update", "account_update",
            "message_template_quality_update", "phone_number_name_update",
            "phone_number_quality_update", "security"];
          const finales = [...new Set([...(campos.length ? campos : DEFECTO), ...QUIERO])];
          const yaEsta = wa?.callback_url === callback && QUIERO.every((f) => campos.includes(f));
          if (!yaEsta) {
            // El verify_token tiene que estar GUARDADO antes del POST: Meta llama al webhook
            // durante esa misma llamada y el webhook lo busca en la tabla de canales.
            const { data: cv } = await db.from("channels").select("verify_token").eq("id", channel_id).maybeSingle();
            let verify = String((cv as any)?.verify_token ?? "").trim();
            if (!verify) {
              verify = "nodo-" + [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
              const { error } = await db.from("channels").update({ verify_token: verify }).eq("id", channel_id);
              if (error) verify = "";
            }
            if (verify) {
              const r = await metaPost(appToken, `${appId}/subscriptions`, {
                object: "whatsapp_business_account",
                callback_url: callback,
                verify_token: verify,
                fields: finales.join(","),
              });
              if (r.status === 200 && r.body?.success) hecho.push("webhook");
              else fallo.push({ que: "webhook", motivo: String(r.body?.error?.message ?? "Meta no aceptó la URL del webhook.") });
            }
          }
        }
      }

      // 1) Suscribir la app a la cuenta (sin esto no ENTRA ningún mensaje).
      if (wabaId) {
        const sub = await metaGet(token, `${wabaId}/subscribed_apps`);
        const yaEsta = sub.status === 200 && Array.isArray(sub.body?.data) && sub.body.data.length > 0;
        if (!yaEsta) {
          const r = await metaPost(token, `${wabaId}/subscribed_apps`);
          if (r.status === 200 && r.body?.success) hecho.push("suscribir");
          else fallo.push({ que: "suscribir", motivo: String(r.body?.error?.message ?? "Meta no aceptó la suscripción.") });
        }
      }

      // 2) Registrar el número en la Cloud API (sin esto no SALE ninguno).
      const num = await metaGet(token, `${phoneId}?fields=platform_type`);
      if (num.status === 200 && num.body?.platform_type !== "CLOUD_API") {
        const dado = String(body.pin ?? "").trim();
        if (dado && !/^\d{6}$/.test(dado)) return json({ error: "pin_invalido", detalle: "El PIN son 6 dígitos." }, 400);
        const usar = dado || pinNuevo();
        const r = await metaPost(token, `${phoneId}/register`, { messaging_product: "whatsapp", pin: usar });
        if (r.status === 200 && r.body?.success) {
          hecho.push("registrar");
          if (!dado) pin = usar; // solo se devuelve el que inventó Nodo, para que lo anote
        } else {
          const msg = String(r.body?.error?.message ?? "Meta no aceptó el registro.");
          fallo.push({ que: "registrar", motivo: msg, necesita_pin: /pin|two[- ]step/i.test(msg) });
        }
      }

      return json({ ok: true, listo: true, hecho, fallo, pin });
    }

    // ── Los dos trámites que el usuario hacía a mano en Meta ───────────────────────────
    // Encender la suscripción a «messages» y registrar el número en la Cloud API. Los dos
    // fallan sin decir por qué (el interruptor viene apagado y nadie avisa; el botón
    // «Registrar» contesta «se produjo un error» a secas), y los dos son puro trámite: no
    // hay nada que decidir. Nodo tiene el access_token del canal —la MISMA llave con la
    // que envía mensajes— así que puede hacerlos por su cuenta.
    // Se ofrecen como botón dentro del diagnóstico, no al guardar: son escrituras en la
    // cuenta de Meta del cliente y las dispara él, viendo antes qué va a pasar.
    if (action === "whatsapp_fix") {
      const que = String(body.que ?? "");
      if (que !== "suscribir" && que !== "registrar") return json({ error: "que_invalido" }, 400);

      const { data: c } = await db.from("channels")
        .select("phone_number_id, waba_id").eq("id", channel_id).maybeSingle();
      const phoneId = (c as any)?.phone_number_id;
      const wabaId = (c as any)?.waba_id;
      const secrets = await getChannelSecrets(db, channel_id);
      const token = secrets?.access_token;
      if (!token) return json({ error: "falta_token", detalle: "Guarda primero el Access token." }, 400);

      const V = "v25.0";
      const post = async (path: string, payload?: Record<string, unknown>) => {
        try {
          const r = await fetchConTimeout(`https://graph.facebook.com/${V}/${path}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: payload ? JSON.stringify(payload) : undefined,
          });
          return { status: r.status, body: await r.json().catch(() => ({})) };
        } catch (e) {
          return { status: 0, body: { error: { message: String((e as any)?.message ?? e) } } };
        }
      };

      if (que === "suscribir") {
        if (!wabaId) return json({ error: "falta_waba", detalle: "Guarda primero el WABA ID." }, 400);
        const r = await post(`${wabaId}/subscribed_apps`);
        if (r.status === 200 && (r.body as any)?.success) return json({ ok: true, hecho: "suscribir" });
        return json({ error: "meta", detalle: (r.body as any)?.error?.message ?? "Meta no aceptó la suscripción." }, 400);
      }

      // Registrar. El PIN es la verificación en dos pasos del número: si es nuevo lo
      // genera Nodo y se lo DEVUELVE al panel para que el dueño lo anote — no se guarda
      // acá: es suyo, y Meta se lo va a pedir el día que migre el número a otro sitio.
      // Si el número ya tenía 2FA con otro PIN, Nodo no puede adivinarlo → lo pide.
      if (!phoneId) return json({ error: "falta_phone", detalle: "Guarda primero el Phone Number ID." }, 400);
      const pinDado = String(body.pin ?? "").trim();
      if (pinDado && !/^\d{6}$/.test(pinDado)) return json({ error: "pin_invalido", detalle: "El PIN son 6 dígitos." }, 400);
      const pin = pinDado || String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
      const r = await post(`${phoneId}/register`, { messaging_product: "whatsapp", pin });
      if (r.status === 200 && (r.body as any)?.success) {
        return json({ ok: true, hecho: "registrar", pin, pin_generado: !pinDado });
      }
      const msg = String((r.body as any)?.error?.message ?? "Meta no aceptó el registro.");
      return json({ error: "meta", detalle: msg, necesita_pin: /pin|two[- ]step/i.test(msg) }, 400);
    }

    if (action === "templates_sync") {
      // Trae las plantillas REALES de la WABA con su estado de aprobación de Meta
      // (APPROVED/PENDING/REJECTED/…) y las refleja en wa_templates. Meta es la
      // fuente de verdad: antes el estado se marcaba A MANO y podía mentir (nombre
      // mal escrito, plantilla pausada por Meta, etc. → el envío se rechazaba).
      const { data: c } = await db.from("channels").select("waba_id").eq("id", channel_id).maybeSingle();
      const wabaId = (c as any)?.waba_id;
      const secrets = await getChannelSecrets(db, channel_id);
      const token = secrets?.access_token;
      if (!wabaId || !token) {
        return json({ ok: true, sincronizado: false, falta: { waba: !wabaId, token: !token } });
      }
      const V = "v25.0";
      let res: any;
      try {
        const r = await fetchConTimeout(`https://graph.facebook.com/${V}/${wabaId}/message_templates?fields=name,language,status,category,components&limit=200`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        res = await r.json();
      } catch (e) {
        return json({ ok: false, error: String((e as any)?.message ?? e) });
      }
      if (res?.error) return json({ ok: false, error: res.error.message ?? "Meta rechazó la consulta" });
      const metaTpls = Array.isArray(res?.data) ? res.data : [];

      // Meta → los 3 estados que maneja el panel. Solo APPROVED puede enviarse;
      // PAUSED/DISABLED/REJECTED se marcan "rechazada" para que Nodo no las ofrezca.
      const mapEstado = (s: string) => {
        const u = String(s || "").toUpperCase();
        if (u === "APPROVED") return "aprobada";
        if (u === "PENDING" || u === "IN_APPEAL" || u === "PENDING_DELETION") return "pendiente";
        return "rechazada";
      };
      const bodyOf = (comps: any[]) => {
        const b = (comps || []).find((x: any) => String(x?.type).toUpperCase() === "BODY");
        return b?.text ?? "";
      };
      // ¿Nodo puede ENVIAR esta plantilla? Hoy solo llena variables del CUERPO. Si la
      // plantilla tiene una variable {{N}} en el encabezado de texto, un encabezado de
      // MEDIA (imagen/documento/video, que exige un parámetro de media), o un botón con
      // URL dinámica ({{N}}), el envío (solo bodyParams) haría que Meta rechace el lote
      // entero. Se detecta acá y el resto del sistema la esconde/bloquea.
      const tieneVar = (s: any) => /\{\{\s*\d+\s*\}\}/.test(String(s ?? ""));
      const soportaEnvio = (comps: any[]) => {
        for (const c of comps || []) {
          const tipo = String(c?.type).toUpperCase();
          if (tipo === "HEADER") {
            const fmt = String(c?.format ?? "TEXT").toUpperCase();
            if (fmt !== "TEXT") return false;              // header de media: no soportado
            if (tieneVar(c?.text)) return false;           // header de texto con variable
          } else if (tipo === "BUTTONS") {
            for (const b of c?.buttons || []) if (tieneVar(b?.url) || tieneVar(b?.text)) return false; // botón dinámico
          }
        }
        return true;
      };

      const { data: existentes } = await db.from("wa_templates")
        .select("id, name, language").eq("channel_id", channel_id);
      const idx = new Map<string, string>();
      for (const r of existentes ?? []) idx.set(`${(r as any).name}::${(r as any).language ?? "es"}`, (r as any).id);

      let creadas = 0, actualizadas = 0;
      for (const t of metaTpls) {
        const name = t?.name;
        if (!name) continue;
        const language = t?.language ?? "es";
        const estado = mapEstado(t?.status);
        const bodyTxt = bodyOf(t?.components);
        const puedeEnviar = soportaEnvio(t?.components);
        const prevId = idx.get(`${name}::${language}`);
        if (prevId) {
          // params se PRESERVAN: es el mapeo de huecos {{1}},{{2}} que hizo el usuario.
          // Si la columna soporta_envio no existe aún (migración 0074 sin aplicar), se
          // reintenta sin ella para no romper la sincronización.
          let up = await db.from("wa_templates").update({
            estado_meta: estado, body_preview: bodyTxt, categoria: t?.category ?? null, soporta_envio: puedeEnviar,
          }).eq("id", prevId);
          if ((up as any)?.error && /soporta_envio|column/.test(String((up as any).error.message))) {
            await db.from("wa_templates").update({ estado_meta: estado, body_preview: bodyTxt, categoria: t?.category ?? null }).eq("id", prevId);
          }
          actualizadas++;
        } else {
          let ins = await db.from("wa_templates").insert({
            channel_id, name, language, estado_meta: estado,
            body_preview: bodyTxt, categoria: t?.category ?? null, params: [], activa: true, soporta_envio: puedeEnviar,
          });
          if ((ins as any)?.error && /soporta_envio|column/.test(String((ins as any).error.message))) {
            await db.from("wa_templates").insert({ channel_id, name, language, estado_meta: estado, body_preview: bodyTxt, categoria: t?.category ?? null, params: [], activa: true });
          }
          creadas++;
        }
      }
      return json({ ok: true, sincronizado: true, total: metaTpls.length, creadas, actualizadas });
    }

    if (action === "template_submit") {
      // Crea la plantilla EN Meta y la manda a aprobación (POST message_templates).
      // El estado real vuelve por el webhook message_template_status_update o por
      // "Sincronizar". Necesita WABA + token con permiso whatsapp_business_management.
      const t = (body.template ?? {}) as any;
      const name = String(t.name || "").trim();
      const language = String(t.language || "es");
      const category = String(t.category || "UTILITY").toUpperCase();
      const text = String(t.body || "");
      const examples: string[] = Array.isArray(t.examples) ? t.examples.map((x: any) => String(x)) : [];
      if (!name || !text) return json({ ok: false, error: "Falta el nombre o el cuerpo de la plantilla." });

      const { data: c } = await db.from("channels").select("waba_id").eq("id", channel_id).maybeSingle();
      const wabaId = (c as any)?.waba_id;
      const secrets = await getChannelSecrets(db, channel_id);
      const token = secrets?.access_token;
      if (!wabaId || !token) return json({ ok: true, enviado: false, falta: { waba: !wabaId, token: !token } });

      // Meta exige un ejemplo por cada variable {{N}} del cuerpo.
      const nVars = (text.match(/\{\{\s*\d+\s*\}\}/g) || []).length;
      const components: any[] = [{ type: "BODY", text }];
      if (nVars > 0) {
        const ex: string[] = [];
        for (let i = 0; i < nVars; i++) ex.push(examples[i] || "ejemplo");
        components[0].example = { body_text: [ex] };
      }
      const V = "v25.0";
      let res: any;
      try {
        const r = await fetchConTimeout(`https://graph.facebook.com/${V}/${wabaId}/message_templates`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name, language, category, components }),
        });
        res = await r.json();
      } catch (e) {
        return json({ ok: false, error: String((e as any)?.message ?? e) });
      }
      if (res?.error) {
        return json({ ok: false, error: res.error.error_user_msg || res.error.message || "Meta rechazó la plantilla." });
      }
      // Meta arranca en PENDING; reflejarlo local (el webhook/sync trae el final).
      const estado = String(res?.status || "PENDING").toUpperCase() === "APPROVED" ? "aprobada" : "pendiente";
      await db.from("wa_templates").update({ estado_meta: estado, meta_id: res?.id ?? null })
        .eq("channel_id", channel_id).eq("name", name).eq("language", language);
      return json({ ok: true, enviado: true, estado, meta_id: res?.id ?? null });
    }

    if (action === "save") {
      // ── Campos planos del canal ─────────────────────────────────
      const upd: Record<string, unknown> = {};
      for (const k of PLAIN) if (body[k] !== undefined) upd[k] = (body[k] ?? "").toString().trim() || null;
      if (body.telegram_chat_ids !== undefined) {
        const arr = Array.isArray(body.telegram_chat_ids)
          ? body.telegram_chat_ids
          : String(body.telegram_chat_ids || "").split(/[\s,]+/);
        upd.telegram_chat_ids = arr.map((x: string) => x.trim()).filter(Boolean);
      }
      // Validar formato (numérico) y PERTENENCIA de los IDs de Meta en el BACKEND (el front ya
      // valida, pero un cliente puede llamar la función directo). Sin esto un admin podía
      // guardar el phone_number_id/waba_id de OTRA cuenta: el phone_number_id lo frena el índice
      // único, pero el waba_id NO es único → squatting que descarta el sync de plantillas de la
      // víctima (Meta enruta su webhook de estado por waba_id y cae en el canal del atacante,
      // cuya firma no valida → 401 → update perdido). corre con service_role → ve todos los canales.
      // Cuenta dueña del canal: el waba_id SÍ puede repetirse entre canales de la MISMA
      // cuenta (un negocio con 2 números bajo una WABA — el webhook lo soporta), pero NO
      // entre cuentas distintas (eso sería squatting). El phone_number_id es único global.
      const { data: myCh } = await db.from("channels").select("account_id").eq("id", channel_id).maybeSingle();
      const myAcc = (myCh as any)?.account_id ?? null;
      for (const idk of ["phone_number_id", "waba_id"]) {
        const v = upd[idk];
        if (v == null) continue; // no se está cambiando (o se está limpiando)
        if (!/^\d{5,}$/.test(String(v))) return json({ error: "id_invalido", detalle: `El ${idk} debe ser numérico.` }, 400);
        let dq = db.from("channels").select("id, account_id").eq(idk, v as string).neq("id", channel_id);
        // waba_id: solo choca si pertenece a OTRA cuenta (permite el 2do número del mismo negocio).
        if (idk === "waba_id" && myAcc) dq = dq.neq("account_id", myAcc);
        const { data: dup } = await dq.limit(1).maybeSingle();
        if (dup) return json({ error: "id_en_uso", detalle: `Ese ${idk} ya está en uso por otro canal.` }, 400);
      }
      if (Object.keys(upd).length) {
        const { error } = await db.from("channels").update(upd).eq("id", channel_id);
        if (error) return json({ error: "guardar_canal", detalle: error.message }, 400);
      }

      // ── Secretos → Vault (solo los que traen valor) ─────────────
      for (const kind of SECRETS) {
        const val = body[kind];
        if (val === undefined || val === null || String(val).trim() === "") continue;
        const { error } = await db.rpc("set_channel_secret", {
          p_channel_id: channel_id, p_kind: kind, p_value: String(val).trim(),
        });
        if (error) return json({ error: "guardar_secreto", detalle: `${kind}: ${error.message}` }, 400);
      }
      return json({ ok: true });
    }

    if (action === "telegram_disconnect") {
      // Desconecta Telegram: quita el webhook del Copiloto, limpia chats/vínculo
      // y borra el bot token del Vault. NO toca datos del negocio (Telegram es
      // solo el canal de avisos). El deleteWebhook es best-effort (si el token ya
      // no vale, igual limpiamos el resto).
      const secrets = await getChannelSecrets(db, channel_id);
      const token = secrets?.telegram_bot_token;
      if (token) { try { await deleteWebhook(token); } catch { /* best-effort */ } }
      const { error: e1 } = await db.from("channels")
        .update({ telegram_chat_ids: [], telegram_webhook_secret: null, telegram_pair: null }).eq("id", channel_id);
      if (e1) return json({ error: "desconectar_tg", detalle: e1.message }, 400);
      const { error: e2 } = await db.rpc("delete_channel_secret", { p_channel_id: channel_id, p_kind: "telegram_bot_token" });
      if (e2) return json({ error: "desconectar_tg_secreto", detalle: e2.message }, 400);
      return json({ ok: true });
    }

    if (action === "whatsapp_disconnect") {
      // Desconecta el NÚMERO de WhatsApp para poder poner otro (p.ej. tras un
      // baneo). NO toca los datos del canal (contactos, pedidos, flujos,
      // productos) ni ads/CAPI/pixel: solo quita phone_number_id + waba_id y
      // borra los secretos del número (access_token + app_secret) del Vault.
      // El verify_token se conserva (lo elige el usuario, es reutilizable).
      // Se borran los SECRETOS PRIMERO y recién después se nulan las columnas: el motivo
      // típico de desconectar es "me banearon / vendí el número → mata el token". Si se
      // nulaba primero y el borrado del secreto fallaba, quedaba un token VIVO huérfano en
      // el Vault con la UI ya "desconectada". Ahora, ante un fallo, el canal sigue conectado
      // (columnas intactas) y el operador reintenta — nunca un token vivo tras desconectar.
      for (const kind of ["access_token", "app_secret"]) {
        const { error } = await db.rpc("delete_channel_secret", { p_channel_id: channel_id, p_kind: kind });
        if (error) return json({ error: "desconectar_secreto", detalle: `${kind}: ${error.message}` }, 400);
      }
      const { error: e1 } = await db.from("channels")
        .update({ phone_number_id: null, waba_id: null }).eq("id", channel_id);
      if (e1) return json({ error: "desconectar", detalle: e1.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "accion_invalida" }, 400);
  } catch (e) {
    console.error("[channel-config] error:", e);
    return json({ error: "interno", detalle: String((e as any)?.message ?? e) }, 500);
  }
});
