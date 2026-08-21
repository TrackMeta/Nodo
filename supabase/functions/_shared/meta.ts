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
  // Meta rechaza (132000) un parámetro de plantilla con salto de línea, tab o >4 espacios
  // seguidos. resolveP (campaigns.ts) ya colapsa el whitespace al sustituir {{key}}, PERO
  // el motor pre-resuelve sus params con resolve() → llegan como literales sin {{}}, el
  // regex de resolveP no matchea y el \n pasa intacto. Colapsar acá, en el punto ÚNICO de
  // paso, blinda TODAS las rutas (motor, campañas, secuencias, avisos, envío manual).
  const clean = (t: unknown) => String(t ?? "").replace(/\s+/g, " ").trim();
  const components: any[] = [];
  if (headerParams.length) {
    components.push({ type: "header", parameters: headerParams.map((t) => ({ type: "text", text: clean(t) })) });
  }
  if (bodyParams.length) {
    components.push({ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: clean(t) })) });
  }
  return await postMessage(phoneNumberId, accessToken, {
    messaging_product: "whatsapp", recipient_type: "individual", to: toWaId,
    type: "template",
    template: { name, language: { code: language || "es" }, ...(components.length ? { components } : {}) },
  });
}

// Descarga un media entrante de WhatsApp (imagen, audio…) como bytes crudos.
// Los media de WhatsApp NO tienen URL pública: hay que pedir la URL firmada a
// Graph y descargarla con el token del canal.
export async function fetchMediaBytes(
  mediaId: string, accessToken: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
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
  const mime = meta.mime_type || bin.headers.get("content-type") || "application/octet-stream";
  return { bytes: new Uint8Array(await bin.arrayBuffer()), mime };
}

// Igual que arriba pero devuelve un data-URI base64 (para pasar imágenes al LLM).
export async function fetchMediaAsDataUri(mediaId: string, accessToken: string): Promise<string> {
  const { bytes, mime } = await fetchMediaBytes(mediaId, accessToken);
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return `data:${mime || "image/jpeg"};base64,${btoa(s)}`;
}

// Errores de Meta que son TRANSITORIOS (vale reintentar) vs permanentes. 130429 = rate
// limit del número (muy común en ráfagas de pedidos), 131056 = par (from,to) rate-limited,
// 80007 = rate limit de la app, 133016 = restauración en curso. Un 5xx también es transitorio.
const META_RETRYABLE = new Set([130429, 131056, 80007, 133016]);

// POST genérico a /messages. Devuelve el wamid o lanza MetaApiError.
// Reintenta con backoff los errores TRANSITORIOS: antes, un rate-limit momentáneo se
// trataba como fallo permanente → el mensaje se marcaba 'failed', el flujo AVANZABA y una
// entrega digital pagada / una clave de recojo se perdía sin reenvío. Un error permanente
// (número inválido, plantilla rechazada) sigue lanzando al toque, sin reintentar.
async function postMessage(phoneNumberId: string, accessToken: string, payload: unknown): Promise<string> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  let lastErr: MetaApiError | null = null;
  for (let intento = 0; intento < 3; intento++) {
    if (intento) await new Promise((r) => setTimeout(r, intento === 1 ? 400 : 1100));
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data: any = {};
    try { const t = await res.text(); data = t ? JSON.parse(t) : {}; } catch (_) { data = {}; }
    if (res.ok && !data.error) return data.messages?.[0]?.id ?? "";
    const e = data.error ?? {};
    lastErr = new MetaApiError({ code: e.code, subcode: e.error_subcode, message: e.message, type: e.type, fbtrace_id: e.fbtrace_id });
    const transitorio = res.status >= 500 || META_RETRYABLE.has(Number(e.code));
    if (!transitorio) throw lastErr; // permanente → no reintentar
  }
  throw lastErr ?? new MetaApiError({ message: "envío falló tras reintentos" });
}
