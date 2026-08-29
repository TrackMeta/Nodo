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

// Ítems que NUNCA deben entrar al perfil: datos operativos (que se guardan aparte) o
// texto que huele a INYECCIÓN (el perfil se concatena al system prompt de ventas, así que
// un ítem del cliente disfrazado de "hecho" podría intentar torcer precio/reglas/tono). El
// SYSTEM_EXTRACT ya lo prohíbe por prompt; esto es el refuerzo en CÓDIGO (el modelo barato
// es jailbreakeable). Un ítem legítimo de trato humano jamás menciona precio/pago/reglas.
// Incluye también PII de IDENTIDAD/DIRECCIÓN: el SYSTEM_EXTRACT ya la prohíbe, pero es la
// capa jailbreakeable — un cliente podría redactar su mensaje para que el modelo barato guarde
// "vive en Av. España 200" (≤60 chars) y eso quedaría en el perfil y se re-inyectaría al system.
// Estos marcadores (dirección/domicilio) son lo más sensible y regex-detectable; nombres/ciudades
// sueltos siguen dependiendo del prompt, pero la dirección es la que no debe filtrarse.
const PROHIBIDO_MEM = /(precio|descuent|dcto|gratis|regal|cup[oó]n|oferta|\bsoles?\b|s\/\s*\d|\$\s*\d|yape|plin|transfer|\bpaga\b|\bdni\b|tel[eé]fono|ignora|olvida|reglas|sistema|prompt|instrucci|jailbreak|obedece|actúa como|actua como|av\.|avenida|\bjr\.?\b|jir[oó]n|\bcalle\b|\bmz\.?\b|manzana|\blote\b|urbanizaci|\burb\.?\b|pasaje|\bpsje\b|direcci[oó]n|domicilio|vivo en|\bvip\b|precio especial|may[uú]scul|en ingl[eé]s|responde en|cont[eé]stale|habla como|tr[aá]tal[oa] como|\benferm[oa]s?\b|c[aá]ncer|\bcovid\b|hospital|cl[ií]nic|di[aá]gn[oó]stic|embaraz|\bluto\b|falleci|divorci|depresi[oó]n)/i;

// Normaliza una lista: strings limpios, sin duplicados, cortos, cap por capa. Descarta
// los ítems operativos/de inyección (PROHIBIDO_MEM).
function curar(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  const vistos = new Set<string>();
  for (const x of arr) {
    const s = String(x ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_LEN);
    if (!s) continue;
    if (PROHIBIDO_MEM.test(s)) continue;   // 🛡️ fuera datos operativos / intentos de inyección
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
// La perilla "qué tan personal" por producto (products.config.memoria_nivel):
//   off     = no usa la memoria al responder (solo vender).
//   suave   = un guiño natural, la venta manda (DEFAULT).
//   cercano = trato cálido y cercano, sin descuidar la venta.
export type NivelMemoria = "off" | "suave" | "cercano";
export function nivelMemoria(config: unknown): NivelMemoria {
  const n = String((config as any)?.memoria_nivel ?? "suave").toLowerCase();
  return (n === "off" || n === "cercano") ? n : "suave";
}

// Inyecta la memoria como contexto para PERSONALIZAR la respuesta, modulado por
// el nivel del producto. "off" no inyecta nada.
export function memoriaComoContexto(m: MemoriaAI, nivel: NivelMemoria = "suave"): string {
  if (nivel === "off") return "";
  const qe = (m.quien_es ?? []).slice(0, MAX_ITEMS);
  const ct = (m.como_tratar ?? []).slice(0, MAX_ITEMS);
  if (!qe.length && !ct.length) return "";
  const intro = nivel === "cercano"
    ? "LO QUE YA SABES DE ESTE CLIENTE (trátalo con calidez y cercanía, como quien ya lo conoce; sin repetirlo de golpe, sin temas sensibles y sin descuidar cerrar la venta):"
    : "LO QUE YA SABES DE ESTE CLIENTE (úsalo con naturalidad, máximo un guiño; la venta manda, nunca lo repitas de golpe ni saques temas sensibles):";
  const lin: string[] = [intro];
  if (qe.length) lin.push("· Quién es: " + qe.join("; "));
  if (ct.length) lin.push("· Cómo tratarlo (deducido, trátalo con tacto): " + ct.join("; "));
  return lin.join("\n");
}

const SYSTEM_EXTRACT = [
  "Eres un analista silencioso de un CRM de ventas por WhatsApp. Lees una conversación y actualizas un perfil CORTO del cliente.",
  "Devuelve SOLO JSON con dos listas de frases breves (máx 6 c/u, en español):",
  '  "quien_es": lo que te contó de SÍ MISMO y que sirve para venderle mejor hoy y para que la próxima conversación no empiece de cero. Van tres cosas: (a) contexto humano — "Compra para su mamá", "Es enfermera", "Prefiere que le escriban en la tarde"; (b) su OBJETIVO declarado — "Quiere bajar barriga", "Busca ganar masa", "Lo quiere para su rutina de la mañana"; y (c) su SITUACIÓN de partida, la que él mismo cuenta — "Tiene 55 años", "Nunca ha entrenado", "Entrena en casa sin equipo", "Tiene poco tiempo entre semana", "Ya probó otros programas". Todo eso te lo dijo PARA que lo asesores: guardarlo es lo que evita que en la siguiente conversación le preguntes lo mismo.',
  '  "como_tratar": rasgos de comportamiento DEDUCIDOS (ej: "Decide rápido", "Regatea", "Trato cercano").',
  "REGLAS ESTRICTAS:",
  "· PROHIBIDO incluir datos operativos de la venta: nombre del cliente, dónde vive (ciudad/distrito/dirección), DNI, teléfono, método de pago, producto, talla, color, cantidad, precio, sede/agencia. TODO eso ya se guarda aparte — si lo pones acá, es un ERROR. Ej. de lo que NUNCA debes devolver: \"Se llama Ana\", \"Vive en Trujillo\", \"Nombre real es...\", \"Talla 38\", \"Paga con Yape\".",
  "· \"quien_es\" es solo el CONTEXTO HUMANO no operativo (para quién compra, su oficio, una preferencia de trato/horario). \"como_tratar\" es solo COMPORTAMIENTO deducido.",
  "· El OBJETIVO y la SITUACIÓN que el cliente cuenta SÍ van (su meta, su edad, su experiencia previa, con qué cuenta, cuánto tiempo tiene). Lo que NUNCA va es un juicio o una condición sobre su cuerpo o su salud: guarda \"Quiere bajar barriga\" y NUNCA \"Tiene sobrepeso\"; guarda \"Tiene 55 años y empieza de cero\" y NUNCA \"Está lesionado\" ni \"Es diabético\"; guarda \"Busca algo suave para empezar\" sin explicar por qué. La regla para distinguirlas: lo que él DICE de su situación se guarda tal como lo diría él; lo que TÚ concluirías sobre su cuerpo o su salud, no. Lo segundo queda escrito en su ficha, lo ve cualquiera del equipo, y sigue ahí dentro de un año.",
  "· NO incluyas datos sensibles (salud, diagnósticos, problemas de dinero, temas familiares delicados, religión, política). Si aparecen, IGNÓRALOS.",
  "· La EDAD, la EXPERIENCIA PREVIA y sus CONDICIONES de uso (tiempo, espacio, equipo) NO son datos sensibles: si él los menciona, GUÁRDALOS tal cual («Tiene 55 años», «Nunca ha entrenado», «Entrena en casa sin equipo», «Tiene poco tiempo entre semana»). Son lo que hace que la próxima conversación no empiece de cero, y es la clase de cosa que un buen vendedor recuerda de su cliente.",
  "· PROHIBIDO el relleno. No guardes que está interesado en el producto ni que pregunta por él: eso ya se sabe por su pedido y por el chat, y ocupa el lugar de lo que sí importa. Tampoco frases vagas de vendedor («Buscador de resultados», «Cliente potencial», «Quiere mejorar»): si no dice algo CONCRETO que él contó, no va.",
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

    // Lectura con detección de FALLO (no usar leerMemoria acá: traga el error y devuelve
    // vacío, indistinguible de "sin memoria" → un timeout de lectura terminaría escribiendo
    // un perfil VACÍO sobre el real acumulado). Si el select falla, se ABORTA: mejor no
    // analizar este turno que borrar el perfil.
    let actual: MemoriaAI;
    try {
      const { data, error } = await db.from("contacts").select("memoria_ia").eq("id", contactId).maybeSingle();
      if (error) return;
      const raw = (data as any)?.memoria_ia;
      actual = (raw && typeof raw === "object")
        ? { quien_es: curar(raw.quien_es), como_tratar: curar(raw.como_tratar), _last: raw._last }
        : { quien_es: [], como_tratar: [] };
    } catch (_) { return; }

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

    // El modelo YA corrió (el costo se pagó). Pase lo que pase abajo, se BUMPEA `_last`
    // para que el throttle mida el último ANÁLISIS, no el último CAMBIO: antes `_last` solo
    // se escribía en la ruta de éxito, así que con el perfil ya estable (lo normal tras 2-3
    // turnos) el modelo barato corría en CADA turno (el guard nunca bloqueaba).
    const now = new Date().toISOString();
    // Re-lee fresco antes de bumpear: NO pisar una edición del operador ocurrida durante el
    // análisis (~2-4s de la IA). Solo se toca _last sobre el perfil VIGENTE, no la copia vieja.
    const bumpLast = async () => {
      let base: MemoriaAI = actual;
      try { base = await leerMemoria(db, contactId); } catch (_) { /* usa actual */ }
      await db.from("contacts").update({ memoria_ia: { ...base, _last: now } }).eq("id", contactId).then(() => {}, () => {});
    };
    const m = /\{[\s\S]*\}/.exec(String(raw ?? ""));
    if (!m) { await bumpLast(); return; }
    let parsed: any; try { parsed = JSON.parse(m[0]); } catch (_) { await bumpLast(); return; }
    const quien_es = curar(parsed.quien_es);
    const como_tratar = curar(parsed.como_tratar);
    // 🛡️ Anti-borrado POR CAPA: el modelo barato a veces re-emite UNA capa y olvida la
    // otra. Si una capa nueva viene VACÍA pero antes tenía contenido, se conserva la vieja
    // (antes solo se protegía el vaciado TOTAL de ambas → una capa se borraba sola).
    const finalQ = (quien_es.length === 0 && (actual.quien_es?.length || 0) > 0) ? actual.quien_es : quien_es;
    const finalC = (como_tratar.length === 0 && (actual.como_tratar?.length || 0) > 0) ? actual.como_tratar : como_tratar;
    // Sin cambio de contenido → no reescribe el perfil, pero SÍ bumpea el throttle.
    const igual = JSON.stringify({ q: finalQ, c: finalC }) ===
      JSON.stringify({ q: actual.quien_es, c: actual.como_tratar });
    if (igual) { await bumpLast(); return; }
    const nuevo: MemoriaAI = { quien_es: finalQ, como_tratar: finalC, _last: now };
    // Re-lectura fresca + merge por DELTA: el operador (u otro turno) pudo editar la memoria
    // mientras corría la IA (~2-4s). Se aplica el CAMBIO de la IA (respecto al snapshot `actual`
    // que vio) sobre lo FRESCO, en vez de sobrescribir con la salida cruda del LLM. Así: (a) NO se
    // RESUCITA un chip que el operador borró en esa ventana (la IA no lo tocó → sigue borrado);
    // (b) las adiciones del operador van PRIMERO → sobreviven el cap de MAX_ITEMS. Antes solo se
    // fusionaban las ADICIONES del operador y se reescribía la salida del LLM (que aún veía el
    // chip borrado). El panel ya hace este delta (contact-extras.js). `curar` dedup + capa.
    try {
      const fresco = await leerMemoria(db, contactId);
      const mergeCapa = (freshArr: string[] | undefined, actualArr: string[] | undefined, aiArr: string[] | undefined) => {
        const fresh = freshArr || [], act = actualArr || [], ai = aiArr || [];
        const aiAdd = ai.filter((x) => !act.includes(x));   // lo que la IA AGREGÓ respecto a lo que vio
        const aiDel = act.filter((x) => !ai.includes(x));   // lo que la IA QUITÓ
        return curar([...fresh.filter((x) => !aiDel.includes(x)), ...aiAdd]);
      };
      nuevo.quien_es = mergeCapa(fresco.quien_es, actual.quien_es, finalQ);
      nuevo.como_tratar = mergeCapa(fresco.como_tratar, actual.como_tratar, finalC);
    } catch (_) { /* si la re-lectura falla, se escribe lo analizado */ }
    await db.from("contacts").update({ memoria_ia: nuevo }).eq("id", contactId);
    try {
      await db.from("contact_events").insert({
        channel_id: channelId, contact_id: contactId, tipo: "nota",
        titulo: "🧠 Memoria IA actualizada",
        detalle: [...finalQ, ...finalC].join(" · ").slice(0, 140) || null,
      });
    } catch (_) { /* log opcional */ }
  } catch (e) {
    // Defensivo total: la venta NUNCA se cae por la memoria.
    try { console.error("[memoria-ia]", (e as any)?.message ?? e); } catch (_) { /* noop */ }
  }
}
