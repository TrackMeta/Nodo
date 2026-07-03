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

// Despacha al proveedor correcto y devuelve el texto de la respuesta.
export async function runAI(call: AiCall): Promise<string> {
  if (!call.apiKey) throw new AiError({ provider: call.provider, message: "API key no configurada" });
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

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": call.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.type === "error") {
    const e = data.error ?? {};
    throw new AiError({ provider: "anthropic", type: e.type, message: e.message, status: res.status });
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
  if (call.jsonSchema) body.response_format = { type: "json_object" };

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${call.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    const e = data.error ?? {};
    throw new AiError({ provider: "openai", type: e.type, message: e.message, status: res.status });
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

// ── Helper: convierte una URL o data-URI base64 en ContentBlock ────
export function imageBlock(src: string): ContentBlock {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(src);
  if (m) return { type: "image", url: "", media_type: m[1], data: m[2] };
  return { type: "image", url: src };
}
