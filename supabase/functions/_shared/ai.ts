// ═══════════════════════════════════════════════════════════════════
// Nodo · ai.ts — puente multi-proveedor de IA (Claude / ChatGPT).
// Cada canal define en Configuraciones su proveedor + API key (cifrada
// en Vault). El nodo "ia" del flow-runner descifra la key por RPC y llama
// aquí. La key nunca vive en el repo ni en el navegador.
// ═══════════════════════════════════════════════════════════════════

// ── Endpoints y modelos por defecto de cada proveedor ──────────────
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_DEFAULT = "claude-opus-4-8";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_DEFAULT = "gpt-4o";

export type Provider = "anthropic" | "openai";

export class AiError extends Error {
  info: { provider?: string; type?: string; status?: number };
  constructor(info: { provider?: string; type?: string; message?: string; status?: number }) {
    super(`IA ${info.provider ?? ""} ${info.status ?? ""} ${info.type ?? ""}: ${info.message ?? ""}`);
    this.info = info;
  }
}

// Contenido de un mensaje de usuario (texto y/o imagen).
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; url: string; media_type?: string; data?: string };

export interface AiCall {
  provider: Provider;
  apiKey: string;
  model?: string;          // modelo específico; si falta usa el del proveedor
  system?: string;
  content: string | ContentBlock[];
  maxTokens?: number;
  jsonSchema?: Record<string, unknown>; // salida estructurada (modo "extraer")
  // 📊 Para registrar el consumo (ver `registraUso`). Opcionales a propósito: sin ellos
  // la llamada funciona igual y simplemente no se contabiliza, así que ningún call site
  // se rompe por no pasarlos.
  db?: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<unknown> };
  channelId?: string;
  origen?: string;         // vender | extraer | clasificar | ocr | stt | asistente | otro
}

// 💵 Tarifa por millón de tokens (USD). Es una FOTO de precios públicos, no la factura:
// sirve para que el dueño vea el orden de magnitud en su panel sin salir de Nodo. El
// número exacto siempre manda el del proveedor. Un modelo que no esté acá se registra
// igual (los tokens son el hecho) con costo 0, para no inventar una cifra.
const TARIFAS: Record<string, { in: number; out: number }> = {
  "gpt-4.1-mini": { in: 0.40, out: 1.60 },
  "gpt-4.1-nano": { in: 0.10, out: 0.40 },
  "gpt-4.1": { in: 2.00, out: 8.00 },
  "gpt-4o-mini": { in: 0.15, out: 0.60 },
  "gpt-4o": { in: 2.50, out: 10.00 },
  "claude-3-5-haiku": { in: 0.80, out: 4.00 },
  "claude-3-5-sonnet": { in: 3.00, out: 15.00 },
  "claude-sonnet-4": { in: 3.00, out: 15.00 },
  "claude-opus-4": { in: 15.00, out: 75.00 },
};
function tarifaDe(model: string): { in: number; out: number } | null {
  const m = String(model || "").toLowerCase();
  if (TARIFAS[m]) return TARIFAS[m];
  // Los modelos traen fecha pegada ("gpt-4.1-mini-2025-04-14"): vale el prefijo más largo.
  let mejor: { in: number; out: number } | null = null, largo = 0;
  for (const [k, v] of Object.entries(TARIFAS)) {
    if (m.startsWith(k) && k.length > largo) { mejor = v; largo = k.length; }
  }
  return mejor;
}

// Suma esta llamada al acumulado del día. Best-effort de verdad: si falla, se traga el
// error. Ninguna venta se puede caer porque no se pudo anotar un contador.
async function registraUso(
  call: AiCall, model: string, tokIn: number, tokOut: number,
): Promise<void> {
  try {
    if (!call.db || !call.channelId) return;
    if (!Number.isFinite(tokIn) && !Number.isFinite(tokOut)) return;
    const t = tarifaDe(model);
    const costo = t
      ? +(((tokIn || 0) * t.in + (tokOut || 0) * t.out) / 1_000_000).toFixed(6)
      : 0;
    await call.db.rpc("ai_usage_add", {
      p_channel_id: call.channelId,
      p_provider: call.provider,
      p_model: model,
      p_origen: call.origen || "otro",
      p_in: Math.max(0, Math.round(tokIn || 0)),
      p_out: Math.max(0, Math.round(tokOut || 0)),
      p_costo: costo,
    });
  } catch (_) { /* el contador nunca tumba una llamada */ }
}

// Tope de tamaño del input de TEXTO (~50k tokens). Las Edge Functions de IA no acotaban
// el input (brief/comando/resumen/texto), así que un miembro podía mandar varios MB y
// quemar el presupuesto de IA de la cuenta. Está MUY por encima de cualquier prompt real
// (hilo 4k + catálogo ≈ 10-20k). NO cuenta las imágenes base64 (el OCR de comprobantes es
// legítimamente grande y ya está topado en media-upload).
const MAX_INPUT_CHARS = 200_000;

// fetch con TIMEOUT: Deno fetch no lo trae por defecto. Un proveedor que acepta la conexión
// pero se cuelga (incidente típico bajo carga) bloquearía TODA la invocación de la Edge
// Function hasta el wall-clock de Supabase (~150s), y un CUELGUE no es un throw → evade la
// degradación con try/catch de los call sites → el flow_run queda con el lock tomado y el
// cliente recibe DEAD-AIR hasta que el reaper de runs zombi lo libere. Al abortar, lanza →
// los call sites ya degradan (rama "fallo"/fallback).
const AI_TIMEOUT_MS = 28_000;
async function fetchAI(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// Despacha al proveedor correcto y devuelve el texto de la respuesta.
export async function runAI(call: AiCall): Promise<string> {
  if (!call.apiKey) throw new AiError({ provider: call.provider, message: "API key no configurada" });
  const textLen = (call.system?.length || 0) + (typeof call.content === "string"
    ? call.content.length
    : call.content.reduce((a, b) => a + (b.type === "text" ? b.text.length : 0), 0));
  if (textLen > MAX_INPUT_CHARS) throw new AiError({ provider: call.provider, type: "input_too_large", message: `input de texto demasiado grande (${textLen} > ${MAX_INPUT_CHARS})` });
  const una = () => call.provider === "openai" ? callOpenAI(call) : callAnthropic(call);
  try {
    return await una();
  } catch (e) {
    // UN reintento, y solo ante los dos estados TRANSITORIOS del proveedor: 429 (límite de
    // tasa) y 529 (sobrecargado). Sin esto, un pico de tráfico del proveedor se traducía en
    // que ESE cliente recibiera el mensaje de respaldo genérico en vez de la respuesta del
    // vendedor — con la venta a medias y sin que nada lo dijera.
    //   · Se reintenta SOLO con un status HTTP: un timeout aborta (AbortError, sin status) y
    //     NO se reintenta, así el peor caso sigue acotado (~1.2 s + el timeout de una llamada)
    //     y no se encadenan dos esperas largas ante un cliente que está esperando respuesta.
    //   · Un 401/400/refusal no se reintenta: reintentar lo que ya falló por configuración
    //     solo gasta tiempo y tokens.
    const st = (e as AiError)?.info?.status;
    if (st !== 429 && st !== 529) throw e;
    await new Promise((r) => setTimeout(r, 1200));
    return await una();
  }
}

// ── Claude (Anthropic Messages API) ────────────────────────────────
async function callAnthropic(call: AiCall): Promise<string> {
  const userContent = toAnthropicContent(call.content);
  const body: Record<string, unknown> = {
    model: call.model || ANTHROPIC_DEFAULT,
    max_tokens: call.maxTokens ?? 1024,
    messages: [{ role: "user", content: userContent }],
  };
  if (call.system) body.system = call.system;
  if (call.jsonSchema) body.output_config = { format: { type: "json_schema", schema: call.jsonSchema } };

  const res = await fetchAI(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": call.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  // Leer como TEXTO y parsear con guarda: bajo carga los gateways devuelven 502/504/529 con
  // HTML (no JSON). `res.json()` directo lanzaba SyntaxError ANTES de armar el AiError → se
  // perdía el status real (429 vs 401 vs 529) y el diagnóstico. Ahora un body no-JSON cae a
  // un AiError con el status y un extracto del cuerpo.
  const raw = await res.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!res.ok || data.type === "error") {
    const e = data.error ?? {};
    throw new AiError({ provider: "anthropic", type: e.type, message: e.message || raw.slice(0, 200), status: res.status });
  }
  if (data.stop_reason === "refusal") {
    throw new AiError({ provider: "anthropic", type: "refusal", message: "el modelo rechazó la solicitud" });
  }
  // Claude llama distinto a los mismos números: input_tokens / output_tokens.
  await registraUso(call, String(body.model ?? ""), data.usage?.input_tokens ?? 0, data.usage?.output_tokens ?? 0);
  return (data.content ?? [])
    .filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
}

function toAnthropicContent(content: string | ContentBlock[]): unknown[] {
  const blocks = typeof content === "string" ? [{ type: "text", text: content } as ContentBlock] : content;
  return blocks.map((b) => {
    if (b.type === "text") return { type: "text", text: b.text };
    // PDF (comprobante enviado como documento): Claude lo lee con un bloque `document`, no `image`.
    if (b.data && b.media_type === "application/pdf") {
      return { type: "document", source: { type: "base64", media_type: "application/pdf", data: b.data } };
    }
    // Imagen: base64 si viene data-URI parseado, si no por URL.
    if (b.data && b.media_type) {
      return { type: "image", source: { type: "base64", media_type: b.media_type, data: b.data } };
    }
    return { type: "image", source: { type: "url", url: b.url } };
  });
}

// ── ChatGPT (OpenAI Chat Completions API) ──────────────────────────
async function callOpenAI(call: AiCall): Promise<string> {
  const messages: unknown[] = [];
  if (call.system) messages.push({ role: "system", content: call.system });
  messages.push({ role: "user", content: toOpenAIContent(call.content) });

  const body: Record<string, unknown> = {
    model: call.model || OPENAI_DEFAULT,
    max_tokens: call.maxTokens ?? 1024,
    messages,
  };
  // OpenAI: para "extraer" forzamos objeto JSON.
  if (call.jsonSchema) {
    body.response_format = { type: "json_object" };
    // OpenAI responde 400 si NINGÚN mensaje contiene literalmente la palabra "json" con
    // json_object. Los callers internos la incluyen, pero un nodo "extraer" con prompt de
    // usuario (config del producto) podría no tenerla → se garantiza acá.
    const tieneJson = /json/i.test(call.system ?? "") || (typeof call.content === "string" && /json/i.test(call.content));
    if (!tieneJson) messages.unshift({ role: "system", content: "Responde SOLO con un objeto JSON válido." });
  }

  const res = await fetchAI(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${call.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  // Ver nota en callAnthropic: leer texto + parse con guarda para no perder el status real
  // ante un 5xx no-JSON del gateway.
  const raw = await res.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!res.ok || data.error) {
    const e = data.error ?? {};
    throw new AiError({ provider: "openai", type: e.type, message: e.message || raw.slice(0, 200), status: res.status });
  }
  // 📊 El conteo exacto de tokens viene en la propia respuesta y hasta ahora se tiraba.
  await registraUso(call, String(body.model ?? ""), data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? 0);
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

function toOpenAIContent(content: string | ContentBlock[]): unknown {
  if (typeof content === "string") return content;
  // Contenido mixto (texto + imagen) → formato de partes de OpenAI.
  return content.map((b) => {
    if (b.type === "text") return { type: "text", text: b.text };
    const url = b.data && b.media_type ? `data:${b.media_type};base64,${b.data}` : b.url;
    return { type: "image_url", image_url: { url } };
  });
}

// ── STT: transcribe una nota de voz a texto (OpenAI Whisper) ───────
// Los clientes en Perú mandan mucho audio; esto lo convierte a texto para
// que los triggers y la IA lo entiendan. Requiere una API key de OpenAI
// (la de visión/conversación del canal sirve). Devuelve el texto o "".
export async function transcribeAudio(
  apiKey: string,
  bytes: Uint8Array,
  mime = "audio/ogg",
  // `db`/`channelId`: para contabilizar el audio en el consumo del canal (ver registraUso).
  opts: {
    model?: string; language?: string; filename?: string;
    db?: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<unknown> };
    channelId?: string;
  } = {},
): Promise<string> {
  if (!apiKey) throw new AiError({ provider: "openai", message: "falta API key de OpenAI para transcribir" });
  const form = new FormData();
  const ext = mime.includes("mp3") || mime.includes("mpeg") ? "mp3"
    : mime.includes("wav") ? "wav" : mime.includes("m4a") || mime.includes("mp4") ? "m4a"
    : mime.includes("webm") ? "webm" : "ogg";
  form.append("file", new Blob([bytes], { type: mime }), opts.filename || `audio.${ext}`);
  form.append("model", opts.model || "whisper-1");
  form.append("language", opts.language || "es"); // español por defecto (mejora la precisión)
  const res = await fetchAI("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  // Ver nota en callAnthropic: leer texto + parse con guarda para no perder el status real
  // ante un 5xx no-JSON del gateway.
  const raw = await res.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!res.ok || data.error) {
    const e = data.error ?? {};
    throw new AiError({ provider: "openai", type: e.type, message: e.message || raw.slice(0, 200), status: res.status });
  }
  // 🎙️ Whisper no cobra por tokens sino por MINUTO de audio ($0.006/min), así que no hay
  // `usage` que leer: se estima por el tamaño del archivo (~1 minuto por cada 500 KB de
  // ogg/opus de WhatsApp) y se registra como un costo aparte, sin tokens. Es la parte más
  // barata del gasto y lo que importa es que aparezca, no el céntimo exacto.
  try {
    if (opts.db && opts.channelId) {
      const minutos = Math.max(0.1, bytes.byteLength / 500_000);
      await opts.db.rpc("ai_usage_add", {
        p_channel_id: opts.channelId, p_provider: "openai", p_model: opts.model || "whisper-1",
        p_origen: "stt", p_in: 0, p_out: 0, p_costo: +(minutos * 0.006).toFixed(6),
      });
    }
  } catch (_) { /* el contador nunca tumba una transcripción */ }
  return String(data.text ?? "").trim();
}

// ── Helper: convierte una URL o data-URI base64 en ContentBlock ────
export function imageBlock(src: string): ContentBlock {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(src);
  if (m) return { type: "image", url: "", media_type: m[1], data: m[2] };
  return { type: "image", url: src };
}
