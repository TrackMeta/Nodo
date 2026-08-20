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
  return call.provider === "openai" ? await callOpenAI(call) : await callAnthropic(call);
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
  return (data.content ?? [])
    .filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
}

function toAnthropicContent(content: string | ContentBlock[]): unknown[] {
  const blocks = typeof content === "string" ? [{ type: "text", text: content } as ContentBlock] : content;
  return blocks.map((b) => {
    if (b.type === "text") return { type: "text", text: b.text };
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
  opts: { model?: string; language?: string; filename?: string } = {},
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
  return String(data.text ?? "").trim();
}

// ── Helper: convierte una URL o data-URI base64 en ContentBlock ────
export function imageBlock(src: string): ContentBlock {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(src);
  if (m) return { type: "image", url: "", media_type: m[1], data: m[2] };
  return { type: "image", url: src };
}
