// ═══════════════════════════════════════════════════════════════════
// Nodo · memoria.ts — Memoria IA: el perfil vivo del cliente.
//
// Dos capas que la IA DETECTA/DEDUCE del hilo, SIN interrogar:
//   · quien_es    — hechos humanos ("Compra para su mamá", "Es enfermera")
//   · como_tratar — comportamiento ("Decide rápido", "Trato cercano")
// (La capa "Para vender" —zona/pago/talla— ya vive en contact_field_values;
//  esto NO la duplica.)
//
// Diseño (acordado con Rodrigo):
//   · Resumen CURADO y corto (cap por capa) → no engorda, cuesta centavos.
//   · Modelo BARATO para esta capa de análisis.
//   · Throttle: no extrae más de 1 vez cada THROTTLE_MIN por contacto.
//   · Frenos: solo lo útil, nada sensible (salud/dinero/familia), no operativo.
//   · DEFENSIVO: nunca lanza — si algo falla, la venta sigue igual.
//
// Aislamiento: escribe en contacts.memoria_ia (columna con RLS por cuenta,
// migración 0059). El panel (renderContactPanel) lo lee y pinta las capas.
// ═══════════════════════════════════════════════════════════════════
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runAI, type Provider } from "./ai.ts";

export interface MemoriaAI {
  quien_es: string[];
  como_tratar: string[];
  _last?: string; // ISO del último análisis (throttle)
}

const MAX_ITEMS = 6;      // el resumen no crece sin fin
const MAX_LEN = 60;       // cada hecho, corto
const THROTTLE_MIN = 15;  // 1 análisis cada 15 min por contacto (control de costo)
const EXTRACT_MAX_TOKENS = 300;

// Modelo barato por proveedor (la capa "cómo tratar" no necesita el modelo caro).
function modeloBarato(provider: Provider): string {
  return provider === "openai" ? "gpt-4o-mini" : "claude-haiku-4-5-20251001";
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["quien_es", "como_tratar"],
  properties: {
    quien_es: { type: "array", items: { type: "string" }, maxItems: MAX_ITEMS },
    como_tratar: { type: "array", items: { type: "string" }, maxItems: MAX_ITEMS },
  },
} as const;

// Normaliza una lista: strings limpios, sin duplicados, cortos, cap por capa.
function curar(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  const vistos = new Set<string>();
  for (const x of arr) {
    const s = String(x ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_LEN);
    if (!s) continue;
    const k = s.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(s);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

// Lee la memoria actual del contacto (defensivo: si falta columna → vacío).
export async function leerMemoria(db: SupabaseClient, contactId: string): Promise<MemoriaAI> {
  try {
    const { data } = await db.from("contacts").select("memoria_ia").eq("id", contactId).maybeSingle();
    const m = (data as any)?.memoria_ia;
    if (m && typeof m === "object") {
      return { quien_es: curar(m.quien_es), como_tratar: curar(m.como_tratar), _last: m._last };
    }
  } catch (_) { /* columna pendiente o error → vacío */ }
  return { quien_es: [], como_tratar: [] };
}

// ── Lado LECTURA: inyecta la memoria como contexto para PERSONALIZAR la
// respuesta de venta. Devuelve "" si no hay nada, para no gastar tokens de más.
// (Aún NO cableado en el motor: se deja listo para la Fase 2c, después de
//  que Rodrigo valide que la escritura funciona.)
export function memoriaComoContexto(m: MemoriaAI): string {
  const qe = (m.quien_es ?? []).slice(0, MAX_ITEMS);
  const ct = (m.como_tratar ?? []).slice(0, MAX_ITEMS);
  if (!qe.length && !ct.length) return "";
  const lin: string[] = ["LO QUE YA SABES DE ESTE CLIENTE (úsalo con naturalidad, máximo un guiño; la venta manda, nunca lo repitas de golpe ni saques temas sensibles):"];
  if (qe.length) lin.push("· Quién es: " + qe.join("; "));
  if (ct.length) lin.push("· Cómo tratarlo (deducido, trátalo con tacto): " + ct.join("; "));
  return lin.join("\n");
}

const SYSTEM_EXTRACT = [
  "Eres un analista silencioso de un CRM de ventas por WhatsApp. Lees una conversación y actualizas un perfil CORTO del cliente.",
  "Devuelve SOLO JSON con dos listas de frases breves (máx 6 c/u, en español):",
  '  "quien_es": hechos humanos útiles para tratarlo mejor la próxima vez (ej: "Compra para su mamá", "Es enfermera", "Prefiere que le escriban en la tarde").',
  '  "como_tratar": rasgos de comportamiento DEDUCIDOS (ej: "Decide rápido", "Regatea", "Trato cercano").',
  "REGLAS ESTRICTAS:",
  "· NO incluyas datos operativos de la venta (zona, dirección, método de pago, talla, producto, precio): eso se guarda aparte.",
  "· NO incluyas datos sensibles (salud, problemas de dinero, temas familiares delicados). Si aparecen, IGNÓRALOS.",
  "· Solo lo ÚTIL y con evidencia en el texto. Nada de suposiciones sin base ni relleno.",
  "· Devuelve el perfil COMPLETO y actualizado (parte de lo que ya sabías y ajústalo); mantenlo corto — descarta lo que ya no aporte.",
  "· Si no hay nada que valga la pena, devuelve las listas tal como estaban (o vacías).",
].join("\n");

// ── Lado ESCRITURA: extrae/actualiza la memoria desde el hilo. NUNCA lanza.
export async function actualizarMemoriaIA(
  db: SupabaseClient,
  opts: { channelId: string; contactId: string; provider: Provider; apiKey: string; thread: string },
): Promise<void> {
  try {
    const { channelId, contactId, provider, apiKey, thread } = opts;
    if (!apiKey || !thread || thread.trim().length < 15) return; // nada útil que analizar

    const actual = await leerMemoria(db, contactId);

    // Throttle por contacto (control de costo): 1 análisis cada THROTTLE_MIN.
    if (actual._last) {
      const mins = (Date.now() - new Date(actual._last).getTime()) / 60000;
      if (Number.isFinite(mins) && mins < THROTTLE_MIN) return;
    }

    const prompt = [
      "PERFIL ACTUAL:",
      JSON.stringify({ quien_es: actual.quien_es, como_tratar: actual.como_tratar }),
      "",
      "CONVERSACIÓN (más reciente al final):",
      thread.slice(-4000),
    ].join("\n");

    const raw = await runAI({
      provider, apiKey, model: modeloBarato(provider),
      system: SYSTEM_EXTRACT, content: prompt, maxTokens: EXTRACT_MAX_TOKENS,
      jsonSchema: SCHEMA as unknown as Record<string, unknown>,
    });

    const m = /\{[\s\S]*\}/.exec(String(raw ?? ""));
    if (!m) return;
    const parsed = JSON.parse(m[0]);
    const quien_es = curar(parsed.quien_es);
    const como_tratar = curar(parsed.como_tratar);

    // No escribas si no cambió nada (evita writes inútiles).
    const igual = JSON.stringify({ q: quien_es, c: como_tratar }) ===
      JSON.stringify({ q: actual.quien_es, c: actual.como_tratar });
    const nuevo: MemoriaAI = { quien_es, como_tratar, _last: new Date().toISOString() };

    await db.from("contacts").update({ memoria_ia: nuevo }).eq("id", contactId);
    if (!igual) {
      try {
        await db.from("contact_events").insert({
          channel_id: channelId, contact_id: contactId, tipo: "nota",
          titulo: "🧠 Memoria IA actualizada",
          detalle: [...quien_es, ...como_tratar].join(" · ").slice(0, 140) || null,
        });
      } catch (_) { /* log opcional */ }
    }
  } catch (e) {
    // Defensivo total: la venta NUNCA se cae por la memoria.
    try { console.error("[memoria-ia]", (e as any)?.message ?? e); } catch (_) { /* noop */ }
  }
}
