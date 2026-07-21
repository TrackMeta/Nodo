// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: whatsapp-send  (AUTENTICADA — verify_jwt=true)
//   Envía un mensaje de texto desde el panel. Valida ventana de 24h,
//   pausa el bot al intervenir el humano y guarda el mensaje saliente.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, getChannelSecrets, userOwnsChannel } from "../_shared/db.ts";
import { sendText, sendMedia, MetaApiError } from "../_shared/meta.ts";
import { sendTemplateToContact } from "../_shared/campaigns.ts";

const db = serviceClient();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // ── Verificar que quien llama es un miembro activo ────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userRes } = await userClient(authHeader).auth.getUser();
  const uid = userRes?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);
  const { data: member } = await db
    .from("app_users").select("id").eq("id", uid).eq("activo", true).maybeSingle();
  if (!member) return json({ error: "not_member" }, 403);

  // ── Body ──────────────────────────────────────────────────────────
  let body: {
    channel_id?: string; contact_id?: string; text?: string;
    media?: { kind?: string; url?: string; caption?: string; filename?: string };
    template?: { name?: string; language?: string };
  };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const { channel_id, contact_id, text, media, template } = body;
  const mediaKind = media?.url ? (["image", "audio", "video", "document"].includes(media.kind || "") ? media.kind! : "document") : null;
  if (!channel_id || !contact_id || (!text?.trim() && !mediaKind && !template?.name)) {
    return json({ error: "faltan_campos" }, 400);
  }

  // ── Cargar canal y contacto ───────────────────────────────────────
  const { data: channel } = await db
    .from("channels").select("id, phone_number_id, activo")
    .eq("id", channel_id).maybeSingle();
  if (!channel || !channel.activo || !channel.phone_number_id) {
    return json({ error: "canal_invalido" }, 400);
  }
  // Multi-tenant: solo un miembro de la cuenta dueña del canal puede enviar.
  if (!(await userOwnsChannel(db, uid, channel_id))) return json({ error: "forbidden_channel" }, 403);
  const { data: contact } = await db
    .from("contacts").select("id, wa_id").eq("id", contact_id).maybeSingle();
  if (!contact) return json({ error: "contacto_invalido" }, 400);

  // ── Plantilla: el único mensaje que WhatsApp acepta FUERA de ventana ──
  // No pasa por el gate de abajo. La plantilla debe existir en el canal,
  // estar activa y aprobada; los {{params}} los resuelve sendTemplateToContact
  // con los datos del contacto.
  if (template?.name) {
    const { data: tpl } = await db.from("wa_templates")
      .select("name, language, params, activa, estado_meta")
      .eq("channel_id", channel_id).eq("name", template.name)
      .eq("language", template.language || "es").maybeSingle();
    if (!tpl || tpl.activa === false || ((tpl as any).estado_meta ?? "aprobada") !== "aprobada") {
      return json({ error: "plantilla_invalida", detalle: "La plantilla no existe, está inactiva o no está aprobada." }, 400);
    }
    // Humano interviene → pausar el bot, igual que con texto libre.
    await db.from("contacts").update({ bot_activo: false }).eq("id", contact_id);
    try {
      const wamid = await sendTemplateToContact(db, channel_id, contact_id, {
        name: tpl.name, language: tpl.language || "es",
        params: ((tpl as any).params ?? []) as string[],
      });
      await db.from("conversations").update({ no_leidos: 0 }).eq("contact_id", contact_id);
      return json({ ok: true, wamid });
    } catch (e) {
      const meta = e instanceof MetaApiError ? e.meta : { message: String((e as any)?.message ?? e) };
      console.error("[send] plantilla fallo:", meta);
      return json({ error: "meta_error", detalle: meta }, 502);
    }
  }

  // ── Validar ventana (gate único de salida para texto y media) ─────
  // expira_at ya es la MAYOR entre la ventana de servicio (24h) y la
  // Free Entry Point (72h del anuncio), calculada por el webhook.
  const { data: conv } = await db
    .from("conversations").select("expira_at").eq("contact_id", contact_id).maybeSingle();
  const abierta = conv?.expira_at && new Date(conv.expira_at) > new Date();
  if (!abierta) {
    return json({ error: "ventana_cerrada", detalle: "La ventana se cerró: solo puedes iniciar con una plantilla aprobada." }, 403);
  }

  // ── Obtener token del canal (Vault) y enviar ──────────────────────
  const secrets = await getChannelSecrets(db, channel_id);
  if (!secrets?.access_token) return json({ error: "sin_token" }, 500);

  // Pausar el bot para este contacto (humano interviene).
  await db.from("contacts").update({ bot_activo: false }).eq("id", contact_id);

  const caption = text?.trim() || "";
  const msgType = mediaKind ?? "text";
  const outContent = mediaKind
    ? { media_url: media!.url, caption, mime: "", filename: media?.filename }
    : { text: caption };

  try {
    const wamid = mediaKind
      ? await sendMedia(channel.phone_number_id, secrets.access_token, contact.wa_id, mediaKind as any, media!.url!, caption, media?.filename)
      : await sendText(channel.phone_number_id, secrets.access_token, contact.wa_id, caption);
    await db.from("messages").insert({
      channel_id, contact_id, direction: "out", type: msgType,
      content: outContent, wamid, status: "sent",
    });
    // El operador está atendiendo → marcar leído.
    await db.from("conversations").update({ no_leidos: 0 }).eq("contact_id", contact_id);
    return json({ ok: true, wamid });
  } catch (e) {
    // Guardar el mensaje como fallido para que se vea en el hilo.
    const meta = e instanceof MetaApiError ? e.meta : { message: String(e) };
    console.error("[send] fallo:", meta);
    await db.from("messages").insert({
      channel_id, contact_id, direction: "out", type: msgType,
      content: outContent, status: "failed", error: meta,
    });
    return json({ error: "meta_error", detalle: meta }, 502);
  }
});
