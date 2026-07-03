// ═══════════════════════════════════════════════════════════════════
// Nodo · ai.ts — puente con la API de Claude (Anthropic Messages API).
// Lo usa el nodo "ia" del flow-runner: generar texto, analizar imágenes
// (OCR de comprobantes) y extraer datos estructurados.
//
// La API key vive en un secreto global de Supabase (ANTHROPIC_API_KEY),
// nunca en el repo ni en el navegador. Se lee con Deno.env en el runtime.
// ═══════════════════════════════════════════════════════════════════
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

// Modelo por defecto. Cada nodo puede sobreescribirlo en su config (`modelo`),
// p.ej. claude-haiku-4-5 para respuestas rápidas y baratas, o
// claude-opus-4-8 para razonamiento más exigente.
const DEFAULT_MODEL = "claude-opus-4-8";

export interface AiError {
  type?: string;
  message?: string;
  status?: number;
}
export class AnthropicError extends Error {
  info: AiError;
  constructor(info: AiError) {
    super(`Anthropic error ${info.status ?? ""} ${info.type ?? ""}: ${info.message ?? ""}`);
    this.info = info;
  }
}

// Bloque de contenido de un mensaje de usuario (texto o imagen).
export type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source:
        | { type: "url"; url: string }
        | { type: "base64"; media_type: string; data: string };
    };

export interface CallOpts {
  system?: string;
  content: string | ContentBlock[]; // mensaje de usuario
  model?: string;
  maxTokens?: number;
  // structured output opcional: JSON Schema para forzar el formato de salida.
  jsonSchema?: Record<string, unknown>;
}

// Llamada base a la API. Devuelve el texto de la respuesta (primer bloque text).
export async function callClaude(opts: CallOpts): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new AnthropicError({ message: "ANTHROPIC_API_KEY no configurada en Supabase" });
  }

  const userContent =
    typeof opts.content === "string"
      ? [{ type: "text", text: opts.content }]
      : opts.content;

  const body: Record<string, unknown> = {
    model: opts.model || DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    messages: [{ role: "user", content: userContent }],
  };
  if (opts.system) body.system = opts.system;
  // Salida estructurada (JSON) — útil para el modo "extraer".
  if (opts.jsonSchema) {
    body.output_config = { format: { type: "json_schema", schema: opts.jsonSchema } };
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": API_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok || data.type === "error") {
    const e = data.error ?? {};
    throw new AnthropicError({ type: e.type, message: e.message, status: res.status });
  }

  // El modelo puede rehusar por seguridad: no hay texto que devolver.
  if (data.stop_reason === "refusal") {
    throw new AnthropicError({ type: "refusal", message: "el modelo rechazó la solicitud" });
  }

  // Concatenar todos los bloques de texto de la respuesta.
  const text = (data.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();
  return text;
}

// Generar texto a partir de un prompt (con contexto opcional en el system).
export async function generateText(
  prompt: string,
  system?: string,
  model?: string,
  maxTokens?: number,
): Promise<string> {
  return await callClaude({ content: prompt, system, model, maxTokens });
}

// Analizar una imagen (OCR de comprobantes Yape/Plin, etc.).
// `imageUrl` puede ser una URL pública o un data-URI base64.
export async function analyzeImage(
  imageUrl: string,
  prompt: string,
  system?: string,
  model?: string,
  maxTokens?: number,
): Promise<string> {
  const image = parseImageSource(imageUrl);
  const content: ContentBlock[] = [image, { type: "text", text: prompt }];
  return await callClaude({ content, system, model, maxTokens: maxTokens ?? 1024 });
}

// Convierte una URL o data-URI base64 en el bloque `image` que espera la API.
function parseImageSource(src: string): ContentBlock {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(src);
  if (m) {
    return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
  }
  return { type: "image", source: { type: "url", url: src } };
}
