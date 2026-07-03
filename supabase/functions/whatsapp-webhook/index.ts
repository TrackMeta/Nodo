// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: whatsapp-webhook  (PÚBLICA — verify_jwt=false)
//   GET  → verificación de Meta (hub.challenge)
//   POST → recepción de mensajes/estados, validando firma por canal.
// ═══════════════════════════════════════════════════════════════════
import { serviceClient, getChannelSecrets } from "../_shared/db.ts";
import { verifyMetaSignature } from "../_shared/crypto.ts";

const db = serviceClient();

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ── GET: verificación del webhook ────────────────────────────────
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token) {
      const { data } = await db
        .from("channels")
        .select("id")
        .eq("verify_token", token)
        .eq("activo", true)
        .limit(1);
      if (data && data.length > 0) {
        return new Response(challenge ?? "", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // ── POST: recepción ──────────────────────────────────────────────
  const raw = await req.text(); // cuerpo CRUDO (necesario para HMAC)
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Ruteo por phone_number_id del payload.
  const phoneNumberId = payload?.entry?.[0]?.changes?.[0]?.value?.metadata
    ?.phone_number_id as string | undefined;
  if (!phoneNumberId) return new Response("OK", { status: 200 }); // eventos sin msgs

  const { data: channel } = await db
    .from("channels")
    .select("id")
    .eq("phone_number_id", phoneNumberId)
    .eq("activo", true)
    .maybeSingle();
  if (!channel) return new Response("OK", { status: 200 }); // canal desconocido

  // Validar firma con el App Secret del canal.
  const secrets = await getChannelSecrets(db, channel.id);
  if (!secrets?.app_secret) {
    console.error(`[webhook] canal ${channel.id} sin app_secret`);
    return new Response("Unauthorized", { status: 401 });
  }
  const sig = req.headers.get("x-hub-signature-256");
  const ok = await verifyMetaSignature(raw, sig, secrets.app_secret);
  if (!ok) return new Response("Unauthorized", { status: 401 });

  // Procesar (idempotente por wamid). Si falla, devolvemos 500 y Meta reintenta.
  try {
    await processPayload(channel.id, payload);
  } catch (e) {
    console.error("[webhook] error procesando:", e);
    return new Response("Server Error", { status: 500 });
  }
  return new Response("OK", { status: 200 });
});

// ── Procesamiento del payload ──────────────────────────────────────
async function processPayload(channelId: string, payload: any) {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const profileName = value.contacts?.[0]?.profile?.name as string | undefined;

      for (const msg of value.messages ?? []) {
        await processInbound(channelId, msg, profileName);
      }
      for (const st of value.statuses ?? []) {
        await processStatus(st);
      }
    }
  }
}

async function processInbound(channelId: string, msg: any, profileName?: string) {
  const waId: string = msg.from;
  const { text, type, content } = extractContent(msg);
  const ref = msg.referral; // Click-to-WhatsApp (oro para atribución)

  // Upsert contacto (captura CTWA solo si viene).
  const patch: Record<string, unknown> = {
    channel_id: channelId,
    wa_id: waId,
    last_input: text,
    last_input_type: type,
    ultimo_mensaje_at: new Date().toISOString(),
    ultimo_mensaje_cliente_at: new Date().toISOString(),
  };
  if (profileName) patch.nombre = profileName;
  if (ref) {
    patch.ad_id = ref.source_id ?? null;
    patch.ctwa_clid = ref.ctwa_clid ?? null;
    patch.source = ref.source_type ?? "ctwa";
  }

  const { data: contact, error: upErr } = await db
    .from("contacts")
    .upsert(patch, { onConflict: "channel_id,wa_id" })
    .select("id")
    .single();
  if (upErr) throw new Error(`upsert contact: ${upErr.message}`);

  // Asegurar la conversación y refrescar la ventana de 24h ANTES de
  // insertar el mensaje (el trigger de no_leidos necesita la fila).
  const expira = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.from("conversations").upsert(
    {
      channel_id: channelId,
      contact_id: contact.id,
      window_type: "service_24h",
      expira_at: expira,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "contact_id" },
  );

  // Insertar mensaje entrante (dedup por wamid; el trigger sube no_leidos).
  const { error: msgErr } = await db.from("messages").insert({
    channel_id: channelId,
    contact_id: contact.id,
    direction: "in",
    type,
    content,
    wamid: msg.id,
    status: "delivered",
    ts: new Date(Number(msg.timestamp) * 1000).toISOString(),
  });
  // 23505 = unique_violation → mensaje repetido (reintento de Meta). Ignorar.
  if (msgErr && (msgErr as any).code !== "23505") {
    throw new Error(`insert message: ${msgErr.message}`);
  }
}

async function processStatus(st: any) {
  const wamid: string = st.id;
  const status: string = st.status; // sent | delivered | read | failed
  const patch: Record<string, unknown> = { status };
  if (status === "failed" && st.errors?.[0]) {
    const e = st.errors[0];
    patch.error = { code: e.code, title: e.title, message: e.message };
    console.error(`[status] failed wamid=${wamid} code=${e.code} ${e.title}`);
  }
  await db.from("messages").update(patch).eq("wamid", wamid);
}

// Extrae texto/tipo/contenido de un mensaje entrante de WhatsApp.
function extractContent(msg: any): { text: string; type: string; content: any } {
  const t = msg.type as string;
  switch (t) {
    case "text":
      return { text: msg.text?.body ?? "", type: "text", content: { text: msg.text?.body ?? "" } };
    case "image":
    case "audio":
    case "video":
    case "document":
    case "sticker": {
      const media = msg[t] ?? {};
      return {
        text: media.caption ?? `[${t}]`,
        type: t,
        content: { media_id: media.id, mime_type: media.mime_type, caption: media.caption ?? null },
      };
    }
    case "interactive": {
      const i = msg.interactive ?? {};
      const reply = i.button_reply ?? i.list_reply ?? {};
      return { text: reply.title ?? "", type: "interactive", content: { id: reply.id, title: reply.title } };
    }
    case "button":
      return { text: msg.button?.text ?? "", type: "button", content: { text: msg.button?.text } };
    case "location":
      return {
        text: "[ubicación]",
        type: "location",
        content: { lat: msg.location?.latitude, lng: msg.location?.longitude },
      };
    default:
      return { text: `[${t}]`, type: "system", content: { raw_type: t } };
  }
}
