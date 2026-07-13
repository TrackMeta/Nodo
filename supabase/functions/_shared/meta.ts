// Llamadas a la WhatsApp Cloud API (Graph API).
const GRAPH_VERSION = "v25.0";

export interface MetaError {
  code?: number;
  subcode?: number;
  message?: string;
  type?: string;
  fbtrace_id?: string;
}

export class MetaApiError extends Error {
  meta: MetaError;
  constructor(meta: MetaError) {
    super(`Meta API error ${meta.code}/${meta.subcode}: ${meta.message}`);
    this.meta = meta;
  }
}

// Envía un mensaje de texto. Devuelve el wamid del mensaje creado.
export async function sendText(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  text: string,
): Promise<string> {
  return await postMessage(phoneNumberId, accessToken, {
    messaging_product: "whatsapp", recipient_type: "individual", to: toWaId,
    type: "text", text: { preview_url: false, body: text },
  });
}

// Envía media por URL pública. kind ∈ image|audio|video|document. Devuelve wamid.
export async function sendMedia(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  kind: "image" | "audio" | "video" | "document",
  link: string,
  caption?: string,
  filename?: string,
): Promise<string> {
  const media: Record<string, unknown> = { link };
  // El audio no admite caption en la Cloud API.
  if (caption && kind !== "audio") media.caption = caption;
  if (kind === "document" && filename) media.filename = filename;
  return await postMessage(phoneNumberId, accessToken, {
    messaging_product: "whatsapp", recipient_type: "individual", to: toWaId,
    type: kind, [kind]: media,
  });
}

// Envía botones interactivos (máx. 3, título ≤ 20 chars). Devuelve el wamid.
export async function sendButtons(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  bodyText: string,
  buttons: { id: string; title: string }[],
): Promise<string> {
  const action = {
    buttons: buttons.slice(0, 3).map((b) => ({
      type: "reply",
      reply: { id: b.id, title: (b.title || b.id).slice(0, 20) },
    })),
  };
  return await postMessage(phoneNumberId, accessToken, {
    messaging_product: "whatsapp", recipient_type: "individual", to: toWaId,
    type: "interactive",
    interactive: { type: "button", body: { text: bodyText || "…" }, action },
  });
}

// Envía una plantilla HSM (para escribir fuera de la ventana de 24h).
// bodyParams: valores de las variables {{1}},{{2}}… del cuerpo.
export async function sendTemplate(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  name: string,
  language: string,
  bodyParams: string[] = [],
  headerParams: string[] = [],
): Promise<string> {
  const components: any[] = [];
  if (headerParams.length) {
    components.push({ type: "header", parameters: headerParams.map((t) => ({ type: "text", text: String(t ?? "") })) });
  }
  if (bodyParams.length) {
    components.push({ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: String(t ?? "") })) });
  }
  return await postMessage(phoneNumberId, accessToken, {
    messaging_product: "whatsapp", recipient_type: "individual", to: toWaId,
    type: "template",
    template: { name, language: { code: language || "es" }, ...(components.length ? { components } : {}) },
  });
}

// Descarga un media entrante (imagen de comprobante, etc.) y lo devuelve
// como data-URI base64. Los media de WhatsApp NO tienen URL pública: hay
// que pedir la URL firmada a Graph y descargarla con el token del canal.
export async function fetchMediaAsDataUri(mediaId: string, accessToken: string): Promise<string> {
  const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meta = await metaRes.json();
  if (!metaRes.ok || meta.error || !meta.url) {
    const e = meta.error ?? {};
    throw new MetaApiError({ code: e.code, subcode: e.error_subcode, message: e.message ?? "media sin url", type: e.type, fbtrace_id: e.fbtrace_id });
  }
  const bin = await fetch(meta.url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!bin.ok) throw new MetaApiError({ code: bin.status, message: "no se pudo descargar el media" });
  const mime = meta.mime_type || bin.headers.get("content-type") || "image/jpeg";
  const bytes = new Uint8Array(await bin.arrayBuffer());
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return `data:${mime};base64,${btoa(s)}`;
}

// POST genérico a /messages. Devuelve el wamid o lanza MetaApiError.
async function postMessage(phoneNumberId: string, accessToken: string, payload: unknown): Promise<string> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    // Meta trae error.code y error.error_subcode — loguearlos siempre.
    const e = data.error ?? {};
    throw new MetaApiError({
      code: e.code, subcode: e.error_subcode, message: e.message,
      type: e.type, fbtrace_id: e.fbtrace_id,
    });
  }
  return data.messages?.[0]?.id ?? "";
}
