// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: channel-config  (AUTENTICADA — verify_jwt=true)
//   Gestiona los datos y secretos del canal (WhatsApp/Meta + Telegram)
//   desde ⚙️ Configuraciones. Los secretos van cifrados a Vault; nunca
//   se guardan en tablas legibles ni se devuelven.
//   Acciones: status | save
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, getChannelSecrets } from "../_shared/db.ts";
import { setWebhook } from "../_shared/telegram.ts";

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
      if (!token) return json({ error: "sin_token", detalle: "Cargá primero el bot token del canal." }, 400);
      const secret = crypto.randomUUID().replace(/-/g, "");
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram-webhook?ch=${channel_id}`;
      const r = await setWebhook(token, url, secret);
      if (!r.ok) return json({ error: "telegram", detalle: r.error }, 400);
      const { error } = await db.from("channels").update({ telegram_webhook_secret: secret }).eq("id", channel_id);
      if (error) return json({ error: "guardar_secreto", detalle: error.message }, 400);
      return json({ ok: true, url });
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
