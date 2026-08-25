// Llamadas a la WhatsApp Cloud API (Graph API).
import { fetchConTimeout } from "./http.ts";
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
  // El pie de foto tiene tope 1024 en Meta y pasarse tira el envío ENTERO con un 400: no
  // llega la foto del producto, no solo el texto de más. Como el pie sale de una burbuja
  // con variables, es fácil pasarse sin darse cuenta. Se recorta acá (y no en cada sitio
  // que llama) para que valga para todos. telegram.ts ya lo hacía; esta era la gemela que
  // se quedó sin el recorte.
  if (caption && kind !== "audio") media.caption = caption.slice(0, 1024);
  // El nombre de archivo también tiene tope. Se recorta por el medio para que la extensión
  // sobreviva: sin ella, al cliente le llega un archivo que su teléfono no sabe abrir.
  if (kind === "document" && filename) {
    let fn = filename;
    if (fn.length > 240) {
      const p = fn.lastIndexOf(".");
      const ext = p > 0 && fn.length - p <= 10 ? fn.slice(p) : "";
      fn = fn.slice(0, 240 - ext.length) + ext;
    }
    media.filename = fn;
  }
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
    // El cuerpo de un interactivo tope 1024 (el motor ya lo recorta antes de llegar acá;
    // esto es la red para que un futuro sitio que llame a sendButtons no reviva el fallo:
    // pasarse hace que Meta rechace el mensaje entero y el cliente no reciba nada).
    interactive: { type: "button", body: { text: (bodyText || "…").slice(0, 1024) }, action },
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
  // El recorte va junto al colapso de espacios y por el mismo motivo: cada parámetro tiene
  // un tope de 1024 y pasarse tumba la plantilla ENTERA. Un {{producto}} o un {{motivo}}
  // largo dejaba sin enviar todo el mensaje, que además es de los que salen fuera de las
  // 24h (recordatorios, avisos de pedido) — justo los que no se pueden reintentar gratis.
  const clean = (t: unknown) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 1024);
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

// El porqué de los timeouts está en http.ts. Acá solo los plazos:
const META_TIMEOUT_MS = 15_000;        // POST y consultas a Graph
const META_TIMEOUT_BAJADA_MS = 45_000; // descarga del archivo en sí (puede ser un video)

// Descarga un media entrante de WhatsApp (imagen, audio…) como bytes crudos.
// Los media de WhatsApp NO tienen URL pública: hay que pedir la URL firmada a
// Graph y descargarla con el token del canal.
export async function fetchMediaBytes(
  mediaId: string, accessToken: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const metaRes = await fetchConTimeout(
    `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    META_TIMEOUT_MS,
  );
  const meta = await metaRes.json();
  if (!metaRes.ok || meta.error || !meta.url) {
    const e = meta.error ?? {};
    throw new MetaApiError({ code: e.code, subcode: e.error_subcode, message: e.message ?? "media sin url", type: e.type, fbtrace_id: e.fbtrace_id });
  }
  const bin = await fetchConTimeout(
    meta.url,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    META_TIMEOUT_BAJADA_MS,
  );
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

// ¿Este rechazo de Meta se va a resolver SOLO con el tiempo? Sirve para no quemar un
// destinatario por un tope temporal: en una campaña, marcarlo "fallido" es definitivo (esa
// fila no se reintenta nunca) y ese cliente se queda sin recibir un mensaje que mañana sí
// habría salido. Incluye los reintentables de arriba —que llegan acá solo si `postMessage`
// ya agotó su backoff— más 131048 (spam/pair rate: te frena TEMPORALMENTE con ESE
// destinatario) y cualquier 5xx.
// OJO: el tope DIARIO de conversaciones iniciadas (el "messaging tier" de 250/1K/10K/100K)
// no está acá porque no tengo confirmado su código; si aparece uno nuevo que sea temporal,
// este es el sitio donde sumarlo.
export function esRechazoTemporal(meta: any): boolean {
  const code = Number(meta?.code);
  if (META_RETRYABLE.has(code) || code === 131048) return true;
  const st = Number(meta?.status);
  return Number.isFinite(st) && st >= 500;
}

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
    // Un envío colgado se comía el tiempo de la función entera sin lanzar nunca, así que ni
    // los reintentos de acá abajo ni el aviso de "no se pudo enviar" llegaban a correr. Con
    // el timeout el intento falla, se reintenta, y si igual no sale, alguien se entera.
    let res: Response;
    try {
      res = await fetchConTimeout(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, META_TIMEOUT_MS);
    } catch (e) {
      // Timeout o caída de red: transitorio por definición → que lo agarre el reintento.
      lastErr = new MetaApiError({ message: `red o timeout hablando con Meta: ${String((e as any)?.message ?? e)}` });
      continue;
    }
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

// ── Qué salió mal, en cristiano ────────────────────────────────────
// Los errores de Meta llegan en inglés y crudos ("Message failed to send because more than
// 24 hours have passed…"). El operador los ve en el aviso de Telegram y en el chat, y ahí lo
// único que importa es qué pasó y qué hacer. Se traducen los códigos que de verdad aparecen;
// del resto se deja el texto original, y el original se conserva SIEMPRE al final para no
// perder el detalle técnico cuando toque investigar.
const MOTIVOS: Record<number, string> = {
  131047: "Pasaron más de 24 h desde el último mensaje del cliente: fuera de esa ventana solo se le puede escribir con una plantilla aprobada.",
  131026: "Ese número no puede recibir el mensaje (puede que no tenga WhatsApp o que esté mal escrito).",
  131049: "Meta frenó el envío para cuidar la experiencia del usuario: se le está mandando demasiado marketing a esta persona.",
  131048: "Meta frenó el envío a este cliente por límite antispam. Se reintenta más tarde.",
  130429: "Se pasó el límite de mensajes por segundo del número. Se reintenta solo.",
  132000: "La plantilla no cuadra con los datos enviados: faltan o sobran variables.",
  132001: "Esa plantilla no existe o no está aprobada en Meta.",
  133016: "WhatsApp está restaurando la cuenta. Se reintenta solo.",
  190: "El token de WhatsApp venció o fue revocado: hay que reconectar el número en Canales.",
};
export function motivoLegible(meta: any): string {
  const code = Number(meta?.code ?? meta?.error?.code ?? 0);
  const original = String(meta?.message ?? meta?.error?.message ?? "").trim();
  const claro = MOTIVOS[code];
  if (!claro) return original || "WhatsApp no aceptó el mensaje";
  return original ? `${claro} (Meta ${code}: ${original})` : `${claro} (Meta ${code})`;
}
