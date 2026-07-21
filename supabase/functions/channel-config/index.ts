// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: channel-config  (AUTENTICADA — verify_jwt=true)
//   Gestiona los datos y secretos del canal (WhatsApp/Meta + Telegram)
//   desde ⚙️ Configuraciones. Los secretos van cifrados a Vault; nunca
//   se guardan en tablas legibles ni se devuelven.
//   Acciones: status | save
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, getChannelSecrets, userOwnsChannel } from "../_shared/db.ts";
import { setWebhook } from "../_shared/telegram.ts";
import { AVISOS } from "../_shared/avisos.ts";

const db = serviceClient();
// Campos planos del canal editables desde el panel.
const PLAIN = ["phone_number_id", "waba_id", "verify_token", "pixel_id", "page_id"];
// Secretos → Vault.
const SECRETS = ["access_token", "app_secret", "capi_token", "telegram_bot_token"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userRes } = await userClient(authHeader).auth.getUser();
  const uid = userRes?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);
  const { data: member } = await db
    .from("app_users").select("id, role").eq("id", uid).eq("activo", true).maybeSingle();
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

  try {
    if (action === "status") {
      const { data } = await db.rpc("channel_secrets_status", { p_channel_id: channel_id }).maybeSingle();
      const s = data ?? {};
      return json({ ok: true, secrets: {
        access_token: !!(s as any).access_token, app_secret: !!(s as any).app_secret,
        capi_token: !!(s as any).capi_token, telegram_bot_token: !!(s as any).telegram_bot_token,
      } });
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
      const { data: c } = await db.from("channels").select("telegram_avisos").eq("id", channel_id).maybeSingle();
      return json({ ok: true, catalogo: AVISOS, config: (c as any)?.telegram_avisos ?? null });
    }

    // Guarda el on/off y el texto propio de cada aviso. Se manda el objeto
    // entero: es chico y así borrar un texto (volver al default) es simplemente
    // no mandarlo, sin necesidad de un "borrar" aparte.
    if (action === "avisos_guardar") {
      const items: Record<string, { on?: boolean; texto?: string }> = {};
      for (const a of AVISOS) {
        const v = body.items?.[a.clave];
        if (!v) continue;
        const fila: { on?: boolean; texto?: string } = {};
        if (v.on === false) fila.on = false;                       // solo se guarda lo apagado
        const t = typeof v.texto === "string" ? v.texto.trim() : "";
        if (t && t !== a.texto) fila.texto = t.slice(0, 3000);      // igual al default → no se guarda
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
          const r = await fetch(`https://api.telegram.org/bot${token}/${m}`);
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
          const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
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
          const r = await fetch(`https://graph.facebook.com/${V}/${path}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          return { status: r.status, body: await r.json() };
        } catch (e) {
          return { status: 0, body: { error: { message: String((e as any)?.message ?? e) } } };
        }
      };

      // 1) El número: valida token + phone_number_id de un solo tiro.
      const num = await g(`${phoneId}?fields=verified_name,display_phone_number,quality_rating,code_verification_status`);
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

      return json({
        ok: true,
        configurado: true,
        numero: numOk ? {
          nombre: (num.body as any).verified_name ?? null,
          telefono: (num.body as any).display_phone_number ?? null,
          calidad: (num.body as any).quality_rating ?? null,
          verificado: (num.body as any).code_verification_status ?? null,
        } : null,
        numero_error: numOk ? null : ((num.body as any)?.error?.message ?? "Meta rechazó el token o el Phone Number ID"),
        webhook: { app_secret: !!secrets?.app_secret, verify_token: !!(c as any)?.verify_token },
        suscripcion,
      });
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

    return json({ error: "accion_invalida" }, 400);
  } catch (e) {
    console.error("[channel-config] error:", e);
    return json({ error: "interno", detalle: String((e as any)?.message ?? e) }, 500);
  }
});
