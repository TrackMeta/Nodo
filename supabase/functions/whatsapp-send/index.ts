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
  // El contact_id viene del cliente: se exige que pertenezca al canal ya verificado
  // (si no, un miembro del tenant A podría apagar el bot, contaminar la conversación o
  // mandar un WhatsApp a un contacto del tenant B — corre con service_role, salta RLS).
  const { data: contact } = await db
    .from("contacts").select("id, wa_id").eq("id", contact_id).eq("channel_id", channel_id).maybeSingle();
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
    // Validar ANTES de enviar: sin token/wa_id, sendTemplateToContact NO manda a Meta pero
    // igual inserta el mensaje como "sent" y devuelve wamid="" → el panel mostraba
    // "Plantilla enviada ✓" con una burbuja FANTASMA que nunca salió. Se falla antes.
    const secrets = await getChannelSecrets(db, channel_id);
    if (!secrets?.access_token) return json({ error: "sin_token", detalle: "El canal no tiene token de WhatsApp configurado." }, 500);
    if (!contact.wa_id) return json({ error: "sin_wa_id", detalle: "El contacto no tiene número de WhatsApp." }, 400);
    try {
      const wamid = await sendTemplateToContact(db, channel_id, contact_id, {
        name: tpl.name, language: tpl.language || "es",
        params: ((tpl as any).params ?? []) as string[],
      }, { sentBy: "human", sentByUser: uid });
      if (!wamid) return json({ error: "no_enviado", detalle: "No se pudo enviar la plantilla (revisa el número/token del canal)." }, 502);
      // Recién con el envío CONFIRMADO se pausa el bot: si el envío falla, el bot sigue
      // atendiendo (antes se pausaba ANTES de enviar → un fallo dejaba el bot mudo/pausado
      // sin que saliera nada al cliente, hasta re-activarlo a mano).
      await db.from("contacts").update({ bot_activo: false }).eq("id", contact_id);
      await db.from("conversations").update({ no_leidos: 0 }).eq("contact_id", contact_id);
      return json({ ok: true, wamid });
    } catch (e) {
      const meta = e instanceof MetaApiError ? e.meta : { message: String((e as any)?.message ?? e) };
      console.error("[send] plantilla fallo:", meta);
      return json({ error: "meta_error", detalle: meta }, 502);
    }
  }

  // ── Validar ventana (gate único de salida para texto y media) ─────
  // Se mide la ventana de SERVICIO (24h desde el último mensaje del cliente), que es la que
  // habilita el texto libre. Antes se usaba `conversations.expira_at`, que es la MAYOR entre
  // esas 24h y el Free Entry Point de 72h del anuncio — y eso deja pasar envíos que Meta
  // rechaza: las 72h del FEP son sobre el COBRO (los mensajes no se cobran), no sobre el
  // permiso. Con las 24h cerradas solo entra una plantilla, aunque el FEP siga vivo.
  // El resultado de dejarlo pasar era un mensaje "enviado" que en realidad rebotaba (131047).
  const { data: ct24 } = await db
    .from("contacts").select("ultimo_mensaje_cliente_at").eq("id", contact_id).maybeSingle();
  const _ult = (ct24 as any)?.ultimo_mensaje_cliente_at ? new Date((ct24 as any).ultimo_mensaje_cliente_at).getTime() : 0;
  const abierta = _ult > 0 && (Date.now() - _ult) < 24 * 60 * 60 * 1000;
  if (!abierta) {
    return json({ error: "ventana_cerrada", detalle: "La ventana se cerró: solo puedes iniciar con una plantilla aprobada." }, 403);
  }

  // ── Obtener token del canal (Vault) y enviar ──────────────────────
  const secrets = await getChannelSecrets(db, channel_id);
  if (!secrets?.access_token) return json({ error: "sin_token" }, 500);

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
      // wamid || null: si Meta omite el id, guardar null (no ""), para que los webhooks de
      // status (delivered/read/failed) puedan matchear por wamid — un "" no matchea nada.
      content: outContent, wamid: wamid || null, status: "sent",
      sent_by: "human", sent_by_user: uid,
    });
    // El bot se pausa recién con el envío CONFIRMADO, igual que en la rama de plantilla.
    // Estaba antes del envío: si Meta rechazaba el mensaje, al cliente no le llegaba nada
    // Y ADEMÁS el bot quedaba apagado, así que nadie lo atendía hasta reactivarlo a mano.
    // Con un problema de canal (token vencido) eso se multiplicaba: cada cliente al que
    // intentaras escribir se quedaba, de una sola vez, sin respuesta tuya y sin bot.
    await db.from("contacts").update({ bot_activo: false }).eq("id", contact_id);
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
      sent_by: "human", sent_by_user: uid,
    });
    return json({ error: "meta_error", detalle: meta }, 502);
  }
});
