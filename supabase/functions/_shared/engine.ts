// ═══════════════════════════════════════════════════════════════════
// Nodo · flow-runner — intérprete de grafos de flujo.
// Lo invocan el webchat (pruebas) y el webhook de WhatsApp. Ejecuta
// nodos hasta toparse con una espera (Pregunta/Botones/Esperar) o Fin.
// Respeta el lock por contacto (un solo run activo/esperando).
// ═══════════════════════════════════════════════════════════════════
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { imageBlock, runAI, transcribeAudio, type ContentBlock, type Provider } from "./ai.ts";
import { sendCapiEvent } from "./capi.ts";
import { sendTelegram, type TgButton } from "./telegram.ts";
import { sendTemplateToContact } from "./campaigns.ts";
import { getAccessToken, sheetsAppend, sheetsUpdate } from "./gsheets.ts";
import { getChannelSecrets } from "./db.ts";
import { fetchMediaAsDataUri, fetchMediaBytes, MetaApiError, sendButtons, sendMedia, sendText } from "./meta.ts";

export type EngineEvent =
  // mediaRef: referencia a la imagen del mensaje ("wa-media:<id>" en WhatsApp,
  // URL pública en webchat) — la consume el nodo IA "analizar imagen".
  // adId: source_id del referral CTWA (solo primer mensaje desde un anuncio).
  | { type: "message"; text: string; msgType?: string; mediaRef?: string; adId?: string }
  | { type: "button"; buttonId: string; title?: string }
  | { type: "resume" }; // despertar tras Esperar

const MAX_STEPS = 50; // tope de nodos por invocación (evita bucles infinitos)

interface Run {
  id: string;
  channel_id: string;
  contact_id: string;
  flow_id: string;
  current_node_id: string | null;
  vars: Record<string, any>;
  estado: string;
  wake_at: string | null;
}
interface Node {
  id: string; flow_id: string; tipo: string; nombre: string | null;
  config: any; es_inicial: boolean;
}

// ── Entrada principal ──────────────────────────────────────────────
export async function runEngine(
  db: SupabaseClient, channelId: string, contactId: string, event: EngineEvent,
) {
  // BOTÓN = ATAJO QUE ESCRIBE POR EL CLIENTE. Salvo que el flujo esté esperando
  // justo ese botón (ruteo determinista por arista `boton:<id>`, que solo usan
  // los esqueletos viejos y el editor avanzado), el toque se convierte en un
  // mensaje de texto con el título del botón. Así lo ve TODO lo que sigue: la
  // IA, las condiciones y los interceptores de arriba (opt-out, pide-humano,
  // reclamo), que solo miran eventos de tipo "message". Antes, un toque sin
  // arista que lo esperara caía al buffer y el cliente se quedaba sin respuesta.
  if (event.type === "button") {
    if (!(await esperaEsteBoton(db, contactId, event.buttonId))) {
      event = { type: "message", text: event.title ?? event.buttonId, msgType: "text" };
    }
  }

  // STT: si entra una nota de voz, transcribirla a texto ANTES de todo, para
  // que los triggers de palabra clave, condiciones y la IA la entiendan como
  // si el cliente hubiera escrito. El audio original queda guardado igual.
  if (event.type === "message" && event.msgType === "audio" && event.mediaRef) {
    const texto = await transcribeIncoming(db, channelId, event.mediaRef).catch((e) => {
      console.error("[STT]", (e as any)?.message ?? e); return null;
    });
    if (texto) {
      event = { ...event, text: texto };
      await db.from("contacts").update({ last_input: texto }).eq("id", contactId);
      await annotateAudioTranscript(db, contactId, texto);
      await logEvent(db, channelId, contactId, "nota", "🎙️ Audio transcrito", texto.slice(0, 140));
    }
  }

  // Opt-out: si el cliente pide que no le escriban más, se le apaga el
  // remarketing en el acto. Se evalúa ANTES de cualquier otra cosa y no
  // interrumpe el flujo (puede seguir comprando si quiere; lo que se apaga son
  // las secuencias de recuperación, no la atención).
  if (event.type === "message" && esOptOut(event.text)) {
    await aplicarOptOut(db, channelId, contactId);
  }

  // ¿Pidió hablar con una persona? Se corta acá: el bot no sigue contestando
  // encima de alguien que ya pidió un humano. Le confirma que lo pasa (con la
  // expectativa según horario) para no dejarlo en el aire.
  if (event.type === "message" && pideHumano(event.text)) {
    await pasarAHumano(db, channelId, contactId, "Lo pidió explícitamente: “" + String(event.text ?? "").slice(0, 120) + "”", { aviso: true });
    return;
  }

  // ¿Reclamo / cliente molesto? Escala a una persona, lo tranquiliza (nunca dead
  // air) y te avisa. La consulta al canal solo corre si el texto ya disparó la
  // red determinista, así que es barata. Se puede apagar (humano.reclamos=false).
  if (event.type === "message" && pideReclamo(event.text)) {
    const { data: chR } = await db.from("channels").select("pedidos_config").eq("id", channelId).maybeSingle();
    if (((chR as any)?.pedidos_config?.humano?.reclamos ?? true) !== false) {
      await pasarAHumano(db, channelId, contactId, "😠 Reclamo / cliente molesto: “" + String(event.text ?? "").slice(0, 120) + "”", { aviso: true });
      return;
    }
  }

  // Reclama su vuelto (pagó de más) → el bot lo tranquiliza y te avisa para que
  // hagas la devolución, sin pausar ni traspasar (así el cliente no queda en el
  // aire si no estás). Si está desactivado, sigue el flujo normal (lo ve la IA).
  if (event.type === "message" && pideVuelto(event.text)) {
    if (await manejarVuelto(db, channelId, contactId, event.text ?? "")) return;
  }

  // Interceptor de SALDO automático (Agente de Logística · modo auto): si entra
  // un comprobante y el contacto tiene un pedido "en_agencia" esperando el
  // saldo, la IA valida el pago y suelta la clave de recojo — o, ante cualquier
  // duda, lo deriva al Copiloto y avisa por Telegram.
  if (event.type === "message" && event.mediaRef && (event.msgType === "image" || !event.msgType)) {
    try {
      if (await maybeAutoSaldo(db, channelId, contactId, event)) return;
    } catch (e) { console.error("[autoSaldo]", (e as any)?.message ?? e); }
    // Comprobante del ADELANTO: mismo interceptor, un paso antes del embudo.
    // Vive acá y no en el flujo para que respete tu configuración en el
    // momento, sin depender de cuándo se generó el flujo.
    try {
      if (await maybeAdelanto(db, channelId, contactId, event)) return;
    } catch (e) { console.error("[adelanto]", (e as any)?.message ?? e); }
  }

  let run = await getActiveRun(db, contactId);

  if (run) {
    const ready = await resumeRun(db, run, event);
    if (!ready) return; // esperaba otra cosa (ej. buffer) → nada que hacer
  } else {
    if (event.type !== "message") return;
    // Modo soporte post-venta: si el contacto YA compró y escribe sin flujo
    // activo, lo atendemos como cliente (soporte), no re-vendemos. Si quiere
    // recomprar, dentro se relanza la venta. Solo entonces cae al ruteo normal.
    try { if (await maybePostventa(db, channelId, contactId, event)) return; }
    catch (e) { console.error("[postventa]", (e as any)?.message ?? e); }
    const decision = await routeDecision(db, channelId, event.text, event.adId);
    const flow = decision.flow;
    if (!flow) return; // ningún flujo maneja este mensaje (ni por IA)
    // Registrar en la Timeline si el ruteo lo decidió la IA (transparencia).
    if (decision.tier === "ia" || decision.tier === "fallback") {
      await logEvent(db, channelId, contactId, "nota", "🧭 Ruteo por IA", decision.reason ?? "").catch(() => {});
    }
    run = await startRun(db, channelId, contactId, flow);
    if (!run) {
      // Perdió la carrera del lock (dos webhooks casi simultáneos): otro run
      // ya está activo → entregar este evento a ese run como reanudación.
      run = await getActiveRun(db, contactId);
      if (!run) return;
      const ready = await resumeRun(db, run, event);
      if (!ready) return;
    }
  }
  // Imagen entrante (ej. comprobante): se sube a almacenamiento propio para
  // tener un LINK PÚBLICO reutilizable → {{ultima_imagen}} (Sheets, Telegram)
  // y el nodo IA (OCR) la lee de esa misma URL. Si la subida falla, se usa la
  // referencia original como respaldo.
  if (event.type === "message" && event.mediaRef && (event.msgType === "image" || !event.msgType)) {
    const url = await ingestImage(db, channelId, contactId, event.mediaRef).catch((e) => {
      console.error("[ingestImage]", (e as any)?.message ?? e); return null;
    });
    run.vars._last_image = url ?? event.mediaRef;
    if (url) {
      run.vars.ultima_imagen = url;
      await setField(db, channelId, contactId, "ultima_imagen", url);
    }
  }
  await execute(db, run);
}

// Reanuda un run parqueado esperando la aprobación manual de un pago digital.
// Lo llama order-update cuando marcas el pedido como confirmado (desde el
// Copiloto o Telegram): recién entonces el bot entrega el producto y sigue su
// proceso de venta normal (link + ventas extra + Sheets).
export async function resumeAfterApproval(
  db: SupabaseClient, channelId: string, contactId: string,
): Promise<boolean> {
  const run = await getActiveRun(db, contactId);
  if (!run || run.channel_id !== channelId) return false;
  if ((run.vars as any)?._await?.type !== "aprobacion_digital") return false;
  const ready = await resumeRun(db, run, { type: "resume" } as EngineEvent);
  if (!ready) return false;
  await execute(db, run);
  return true;
}

// ¿El flujo está parado esperando ESTE botón y hay una arista que lo atienda?
// Solo entonces vale el ruteo determinista; en cualquier otro caso el toque se
// trata como texto. Cuesta una consulta extra, y únicamente cuando tocan un
// botón.
async function esperaEsteBoton(db: SupabaseClient, contactId: string, buttonId: string): Promise<boolean> {
  try {
    const run = await getActiveRun(db, contactId);
    const aw = (run?.vars as any)?._await;
    if (!run || aw?.type !== "button" || !aw.node_id) return false;
    return !!(await nextNode(db, run.flow_id, aw.node_id, `boton:${buttonId}`));
  } catch (_) { return false; }
}

// Puerta de salida de un nodo IA: la misma que usaría si hubiera corrido solo.
// El generador cablea 'exito'; 'continuar' queda de respaldo para flujos hechos
// a mano en el editor.
async function salidaOcr(db: SupabaseClient, flowId: string, nodeId: string) {
  return (await nextNode(db, flowId, nodeId, "exito")) ??
         (await nextNode(db, flowId, nodeId, "continuar"));
}

// Rechazar el comprobante de un pago parqueado (lo llama order-update desde el
// Copiloto). Sin esto el run se quedaba congelado para siempre: el cliente podía
// escribir mil veces y solo recibía "estoy verificando tu pago".
//
// No se inventa un camino nuevo: el flujo YA sabe pedir un comprobante nuevo
// —es la rama 'pago inválido' de la Condición ¿Pago válido?—, así que se marca
// el resultado como NO y se reanuda por ahí. Como el nombre de la variable que
// mira la Condición depende del nodo (pago_resultado en la venta principal,
// pago_extra_N en cada extra), se lee del propio nodo (`guardar_en`).
export async function rejectDigitalPending(
  db: SupabaseClient, channelId: string, contactId: string, motivo?: string,
): Promise<boolean> {
  const run = await getActiveRun(db, contactId);
  if (!run || run.channel_id !== channelId) return false;
  const aw = (run.vars as any)?._await;
  if (aw?.type !== "aprobacion_digital" || !aw.node_id) return false;

  const node = await getNode(db, aw.node_id);
  const clave = String((node as any)?.config?.guardar_en || "pago_resultado");
  const razon = String(motivo ?? "").trim() || "El comprobante no pasó la revisión.";
  const veredicto = `PAGO_NO ${razon}`;
  run.vars[clave] = veredicto;
  await setField(db, channelId, contactId, clave, veredicto).catch(() => {});

  // Se liberan los flags para que el SIGUIENTE comprobante vuelva a pasar por tu
  // aprobación. Sin esto, el segundo intento se aprobaría solo — justo después
  // de que rechazaras el primero por sospechoso.
  delete (run.vars as any)._pago_manual_pendiente;
  delete (run.vars as any)._extra_manual_pendiente;

  run.current_node_id = await salidaOcr(db, run.flow_id, aw.node_id);
  delete (run.vars as any)._await;
  run.estado = "activo";
  run.wake_at = null;
  await logEvent(db, channelId, contactId, "nota", "❌ Pago rechazado · el bot pide un comprobante nuevo").catch(() => {});
  await execute(db, run);
  return true;
}

// Ofrecer la venta extra DESPUÉS de validar el adelanto (opción configurable del
// producto físico). Reanuda la conversación de venta —que quedó esperando el
// adelanto en un nodo marcado `post_adelanto`— hacia el ofrecimiento. Ese nodo de
// espera VUELVE a sí mismo aunque el cliente escriba, así que el run sigue
// parqueado ahí hasta que el pago se valida → el ofrecimiento se manda de forma
// confiable (tan confiable como el aviso de "adelanto recibido"). Devuelve true
// si reanudó (entonces quien llama NO debe mandar además el aviso normal).
export async function resumeIntoExtras(
  db: SupabaseClient, channelId: string, contactId: string,
): Promise<boolean> {
  const run = await getActiveRun(db, contactId);
  if (!run || run.channel_id !== channelId) return false;
  const aw = (run.vars as any)?._await;
  if (!aw?.node_id) return false;
  const node = await getNode(db, aw.node_id);
  if (!(node as any)?.config?.post_adelanto) return false;
  const next = await nextNode(db, run.flow_id, aw.node_id, "post_adelanto");
  if (!next) return false;
  run.current_node_id = next;
  delete (run.vars as any)._await;
  run.estado = "activo";
  run.wake_at = null;
  await execute(db, run);
  return true;
}

// Entrega los enlaces/archivos de las ventas extra DIGITALES que viajaban en un
// pedido físico ("ride-along"), una vez que el pedido quedó pagado del todo
// (Lima: entregado y cobrado; provincia: saldo pagado / recogido). Antes no: dar
// el link en un cobro contraentrega sería regalar el digital. Idempotente: marca
// cada bump entregado. La llaman order-update y el interceptor de saldo.
export async function entregarExtrasDigitales(db: SupabaseClient, channelId: string, contactId: string, orderId: string) {
  try {
    const { data: o } = await db.from("orders").select("order_bumps").eq("id", orderId).maybeSingle();
    const bumps = ((o as any)?.order_bumps ?? []) as any[];
    if (!bumps.some((b) => b?.digital && b?.version_id && !b?.entregado)) return;
    let changed = false;
    for (const b of bumps) {
      if (!(b?.digital && b?.version_id && !b?.entregado)) continue;
      const { data: v } = await db.from("product_versions").select("nombre, entrega").eq("id", b.version_id).maybeSingle();
      const items = (Array.isArray((v as any)?.entrega) ? (v as any).entrega : []).filter((it: any) => it && it.url);
      if (!items.length) continue; // sin entrega configurada → nada que mandar
      await deliverMessage(db, channelId, contactId, `🎁 Acá va tu ${b.nombre || (v as any)?.nombre || "extra"}:`).catch(() => {});
      for (const it of items) await deliverMessage(db, channelId, contactId, String(it.url)).catch(() => {});
      b.entregado = true; changed = true;
    }
    if (changed) await db.from("orders").update({ order_bumps: bumps }).eq("id", orderId);
  } catch (e) {
    console.error("[entregarExtrasDigitales]", (e as any)?.message ?? e);
  }
}

// ── Pasar la conversación a un humano ──────────────────────────────
// Dos disparadores distintos, porque son dos cosas distintas:
//   · Lo PIDE explícito → lista de frases, determinista. Si alguien pide hablar
//     con una persona, no puede quedar sujeto a que un modelo lo interprete.
//   · Es realmente NECESARIO → eso sí es criterio, y lo decide la IA escribiendo
//     el marcador [[humano]] (mismo patrón que [[media:tag]], ya probado).
// A propósito NO entran acá cosas como "¿eres un bot?": eso es curiosidad y la
// IA la responde. Escalar de más es tan malo como no escalar.
const PIDE_HUMANO = [
  "quiero hablar con una persona", "hablar con una persona", "con una persona real",
  "quiero hablar con un humano", "hablar con un humano", "atencion humana",
  "quiero hablar con un asesor", "hablar con un asesor",
  "quiero hablar con alguien", "hablar con alguien",
  "quiero un asesor", "un operador", "un agente humano", "hay alguien real",
  "me pueden llamar", "quiero que me llamen",
  // Formas de USTED: acá mucha gente trata de usted, y "páseme" no calza con
  // "pásame". Sin esto, el cliente formal se queda sin humano.
  "pasame con alguien", "paseme con alguien",
  "pasame con un asesor", "paseme con un asesor",
  "pasame con una persona", "paseme con una persona",
  "comuniqueme con alguien", "comunicame con alguien", "me comunica con alguien",
];
function pideHumano(text: string): boolean {
  const t = limpiaOpt(text);
  if (!t || t.length > 90) return false;
  return PIDE_HUMANO.some((f) => {
    const n = limpiaOpt(f);
    if (!n) return false;
    if (t === n) return true;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${esc}(\\s|$)`).test(t);
  });
}

// ── "Pide su vuelto" (pagó de más) → regla DURA → humano ───────────
// Cuando el cliente pagó de más y RECLAMA la diferencia, no se deja a criterio
// de la IA (decisión de Rodrigo): es plata, y responder mal quema. Lista
// determinista, mismo patrón que pideHumano. Frases específicas del vuelto para
// no escalar de más (un "quiero un cambio de talla" no debe caer acá).
const PIDE_VUELTO = [
  "mi vuelto", "el vuelto", "quiero mi vuelto", "me das mi vuelto", "me das el vuelto",
  "dame mi vuelto", "me devuelves el vuelto", "me devuelve el vuelto", "devuelveme el vuelto", "devuelvame el vuelto",
  "pague de mas", "pague demas", "he pagado de mas", "pague mas de la cuenta", "pague de mas sin querer",
  "me devuelves lo de mas", "me devuelve lo de mas", "lo que pague de mas", "devuelveme lo de mas",
  "me devuelves la diferencia", "me devuelve la diferencia", "quiero la diferencia",
  "me sobro plata", "me sobro dinero", "me devuelves lo que sobra", "saldo a favor",
];
function pideVuelto(text: string): boolean {
  const t = limpiaOpt(text);
  if (!t || t.length > 90) return false;
  return PIDE_VUELTO.some((f) => {
    const n = limpiaOpt(f);
    if (!n) return false;
    if (t === n) return true;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${esc}(\\s|$)`).test(t);
  });
}

// ── Reclamo / cliente molesto → escala a una persona ──────────────────
// Señales INEQUÍVOCAS de enojo o disputa. Un bot argumentando con un cliente
// molesto es puro riesgo (pierdes al cliente y quemas tu marca), así que esto no
// se deja al criterio de la IA: red determinista para lo fuerte, y la IA sigue
// escalando lo sutil con [[humano]]. Lista corta a propósito: NO queremos que un
// "esto no me funciona" o "tengo un problema con la talla" (que el bot SÍ puede
// resolver) escale. Solo enojo/disputa real. Configurable (humano.reclamos).
const PIDE_RECLAMO = [
  "estafa", "estafador", "estafadores", "me estafaron", "es un robo", "esto es un robo", "me robaron",
  "son unos ladrones", "ladrones", "son unos rateros", "son unos abusivos", "esto es un abuso",
  "voy a denunciar", "los voy a denunciar", "los denuncio", "indecopi",
  "voy a reportar", "los voy a reportar", "los voy a demandar", "voy a demandar",
  "pesimo servicio", "pesima atencion", "una verguenza", "es una verguenza", "esto es un fraude",
  "exijo mi devolucion", "quiero mi devolucion", "devuelvanme mi dinero", "quiero que me devuelvan mi dinero",
  "estoy indignado", "estoy indignada", "es una estafa", "esto es una estafa",
];
function pideReclamo(text: string): boolean {
  const t = limpiaOpt(text);
  if (!t || t.length > 240) return false; // los reclamos suelen ser largos (rants)
  return PIDE_RECLAMO.some((f) => {
    const n = limpiaOpt(f);
    if (!n) return false;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${esc}(\\s|$)`).test(t);
  });
}

// ── Recompra (post-venta) → relanzar la venta ─────────────────────────
// Un comprador que quiere comprar OTRA VEZ / más unidades. Determinista para lo
// claro (los LLM no escriben el marcador [[recompra]] de forma confiable si
// pueden responder directo). El [[recompra]] de la IA queda como respaldo para
// frases más sutiles. Solo se evalúa en modo post-venta (ya es comprador).
const PIDE_RECOMPRA = [
  "quiero comprar otro", "quiero comprar otra", "quiero comprar mas", "comprar otro par",
  "comprar mas pares", "comprar de nuevo", "comprar otra vez", "volver a comprar",
  "quiero otro par", "quiero otra unidad", "otro par mas", "unidades mas",
  "quiero pedir otro", "pedir otro", "quiero comprar de nuevo", "me vendes otro",
  "quiero comprar nuevamente", "necesito otro par", "quiero mas pares",
];
function pideRecompra(text: string): boolean {
  const t = limpiaOpt(text);
  if (!t || t.length > 200) return false;
  return PIDE_RECOMPRA.some((f) => {
    const n = limpiaOpt(f);
    if (!n) return false;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${esc}(\\s|$)`).test(t);
  });
}
// Reclama su vuelto → según el modo configurado en Validación de pagos
// (pedidos_config.vuelto.modo):
//   · "tranquilizar" (default): el bot le responde un mensaje configurable, te
//     avisa, y SIGUE atendiéndolo (no pausa). Nunca queda en el aire.
//   · "humano": pausa esa conversación y te la traspasa (si no estás, el cliente
//     espera — pero es lo que algunos negocios quieren).
//   · "off": sin manejo especial (lo ve la IA como cualquier mensaje).
// Devuelve true si lo manejó (entonces runEngine no procesa más ese mensaje).
async function manejarVuelto(db: SupabaseClient, channelId: string, contactId: string, texto: string): Promise<boolean> {
  const { data: ch } = await db.from("channels").select("pedidos_config").eq("id", channelId).maybeSingle();
  const cfg = (ch as any)?.pedidos_config?.vuelto ?? {};
  // Compat con la forma vieja {activo}: activo:false → off; si no, tranquilizar.
  const modo = cfg.modo ?? (cfg.activo === false ? "off" : "tranquilizar");
  if (modo === "off") return false; // lo maneja la IA normal

  // Monto del vuelto (si hay un pedido reciente con saldo a favor).
  let vuelto = 0;
  try {
    const { data: ords } = await db.from("orders").select("shipping")
      .eq("contact_id", contactId).order("created_at", { ascending: false }).limit(10);
    for (const o of ords ?? []) { const v = Number(((o as any).shipping ?? {}).vuelto); if (Number.isFinite(v) && v > 0) { vuelto = v; break; } }
  } catch (_) { /* best-effort */ }
  const { data: c } = await db.from("contacts").select("nombre, wa_id").eq("id", contactId).maybeSingle();
  const quien = (c as any)?.nombre || (c as any)?.wa_id || "Un cliente";

  if (modo === "humano") {
    const frag = String(texto ?? "").slice(0, 100);
    const motivo = vuelto > 0
      ? `💸 Pide su vuelto (pagó de más). Saldo a favor: <b>S/ ${vuelto}</b>. “${frag}”`
      : `💸 Reclama un vuelto / devolución. “${frag}”`;
    await pasarAHumano(db, channelId, contactId, motivo, { aviso: true }); // pausa + traspasa + avisa al cliente
    return true;
  }

  // modo "tranquilizar" (default): responde, avisa y SIGUE atendiendo.
  const def = "¡No te preocupes! 🙌 Registramos que pagaste de más. Un administrador está gestionando la devolución de tu vuelto{{monto}} y te enviaremos la constancia por aquí en un momentito. Seguimos con tu pedido con normalidad. 🙂";
  let msg = (cfg?.mensaje && String(cfg.mensaje).trim()) ? String(cfg.mensaje) : def;
  msg = msg.replace(/\{\{\s*vuelto\s*\}\}/g, vuelto > 0 ? `S/ ${vuelto}` : "")
           .replace(/\{\{\s*monto\s*\}\}/g, vuelto > 0 ? ` (S/ ${vuelto})` : "");
  await deliverMessage(db, channelId, contactId, msg).catch(() => {});
  await notifyAdmin(db, { channel_id: channelId, contact_id: contactId } as any,
    `💸 <b>${quien} reclama su vuelto</b>\nSaldo a favor: ${vuelto > 0 ? "<b>S/ " + vuelto + "</b>" : "(revisar en Compras)"}\nEl bot ya le dijo que lo estás gestionando — hazle la devolución y mándale la captura por el chat. El bot sigue atendiéndolo.`);
  await logEvent(db, channelId, contactId, "nota", "💸 Reclamó su vuelto", `saldo a favor ${vuelto > 0 ? "S/ " + vuelto : "?"}`).catch(() => {});
  return true;
}

// ── Horario de atención humana (para no traspasar hacia un vacío) ──────
// La secuencia empieza en lunes para calcular "mañana"/"el <día>".
const SEQ_DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const DIA_NOMBRE: Record<string, string> = {
  lun: "el lunes", mar: "el martes", mie: "el miércoles", jue: "el jueves",
  vie: "el viernes", sab: "el sábado", dom: "el domingo",
};
function fmtHora(hhmm: string): string {
  const [H, M] = String(hhmm || "09:00").split(":").map((n) => Number(n));
  const ap = (H < 12 || H === 24) ? "a.m." : "p.m.";
  let h12 = H % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${String(M || 0).padStart(2, "0")} ${ap}`;
}
// Frase amable de cuándo vuelve a haber atención ("hoy a las 3:00 p.m.",
// "mañana a las 9:00 a.m.", "el lunes a las 9:00 a.m.").
function proximaApertura(h: any, tz: string): string {
  const { hhmm, dia } = ahoraEnTz(tz);
  const dias = h?.dias ?? {};
  const on = (d: string) => dias[d] !== false;
  const desde = String(h?.desde || "09:00");
  const fmt = fmtHora(desde);
  if (on(dia) && hhmm < desde) return `hoy a las ${fmt}`;
  let idx = SEQ_DIAS.indexOf(dia); if (idx < 0) idx = 0;
  for (let i = 1; i <= 7; i++) {
    const d = SEQ_DIAS[(idx + i) % 7];
    if (on(d)) return `${i === 1 ? "mañana" : DIA_NOMBRE[d]} a las ${fmt}`;
  }
  return `a las ${fmt}`;
}
// ¿Estamos dentro del horario de atención? Sin horario definido → siempre "sí"
// (asumimos que estás disponible; el aviso será "en un momento").
function horarioAtencion(hcfg: any, tz: string): { dentro: boolean; proxima: string | null } {
  const h = hcfg?.horario ?? {};
  if (!h.activo) return { dentro: true, proxima: null };
  const { hhmm, dia } = ahoraEnTz(tz);
  const dias = h.dias ?? {};
  const desde = String(h.desde || "09:00");
  const hasta = String(h.hasta || "20:00");
  const dentro = dias[dia] !== false && hhmm >= desde && hhmm <= hasta;
  return { dentro, proxima: dentro ? null : proximaApertura(h, tz) };
}

// Pausa el bot, marca la conversación y avisa. `motivo` explica POR QUÉ, para
// que quien la tome sepa a qué entra sin leer todo el hilo.
// `opts.aviso` — regla de oro "nunca dead air": le decimos al cliente qué
// esperar, según el horario de atención (channels.pedidos_config.humano):
//   true    → siempre le mandamos un mensaje (dentro: "en un momento"; fuera:
//             "un asesor te responde <próxima apertura>").
//   "fuera" → solo si estamos FUERA de horario (para escaladas donde la IA ya
//             escribió su propio mensaje, que sirve dentro de horario).
//   false/omitido → no manda nada (el caller ya avisó por su cuenta).
async function pasarAHumano(
  db: SupabaseClient, channelId: string, contactId: string, motivo: string,
  opts?: { aviso?: boolean | "fuera" },
) {
  try {
    await db.from("contacts").update({ bot_activo: false }).eq("id", contactId);
    await db.from("conversations").update({ requiere_humano: true }).eq("contact_id", contactId);
    await logEvent(db, channelId, contactId, "humano", "Transferido a un humano", motivo);

    let dentro = true, proxima: string | null = null, avisoTxt = "", chequeoHorario = false;
    if (opts?.aviso === true || opts?.aviso === "fuera") {
      chequeoHorario = true;
      const { data: ch } = await db.from("channels").select("pedidos_config, timezone").eq("id", channelId).maybeSingle();
      const hcfg = (ch as any)?.pedidos_config?.humano ?? {};
      const tz = (ch as any)?.timezone || "America/Lima";
      const h = horarioAtencion(hcfg, tz);
      dentro = h.dentro; proxima = h.proxima;
      if (opts.aviso === true || !dentro) {
        if (!dentro) {
          avisoTxt = String(hcfg.aviso_fuera ?? "").trim() ||
            `¡Gracias por escribir! 🙌 Ahora mismo no hay un asesor en línea${proxima ? `, pero te responde ${proxima}` : ""}. Déjame tu consulta por aquí y la vemos apenas volvamos. 🙏`;
        } else {
          avisoTxt = String(hcfg.aviso_dentro ?? "").trim() ||
            "¡Gracias! 🙌 En un momento te atiende un asesor de nuestro equipo por aquí. 🙂";
        }
      }
    }
    if (avisoTxt) await deliverMessage(db, channelId, contactId, avisoTxt).catch(() => {});

    const { data: c } = await db.from("contacts").select("nombre, wa_id").eq("id", contactId).maybeSingle();
    const quien = (c as any)?.nombre || (c as any)?.wa_id || "Un cliente";
    const nota = !chequeoHorario ? "" : dentro
      ? "\n🟢 En horario de atención."
      : `\n🔴 Fuera de horario${proxima ? ` — al cliente le dijimos que respondes ${proxima}` : ""}.`;
    await notifyAdmin(db, { channel_id: channelId, contact_id: contactId } as any,
      `🙋 <b>${quien} necesita a una persona</b>\n${motivo}\nEl bot quedó en pausa en esa conversación.${nota}`);
  } catch (e) { console.error("[pasarAHumano]", (e as any)?.message ?? e); }
}

// ── Opt-out del remarketing ────────────────────────────────────────
// Si alguien dice claramente que no quiere que le escriban, hay que
// RESPETARLO. Esto es a propósito determinista (una lista de frases, no la IA):
// para algo así no se puede depender de que un modelo "interprete bien" — el
// costo de equivocarse es seguir spameando a quien te pidió que pares.
const OPT_OUT = [
  "no me interesa", "no me interesan", "ya no me interesa", "no gracias", "no, gracias",
  "no escriban", "no me escriban", "no escribas", "no me escribas", "dejen de escribir",
  "no molesten", "no me molesten", "no me contacten", "dejame en paz", "déjame en paz",
  "eliminar mi numero", "eliminen mi numero", "borrenme", "bórrenme", "no quiero nada",
  "ya no quiero", "basta", "stop", "unsubscribe", "baja",
];
// Reusa normalize() (el helper que ya tiene el motor: minúsculas + sin tildes)
// y además saca la puntuación, para que "¡No, gracias!" == "no gracias".
const limpiaOpt = (s: string) => normalize(s).replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

function esOptOut(text: string): boolean {
  const t = limpiaOpt(text);
  if (!t || t.length > 80) return false; // un texto largo rara vez es un "no" seco
  return OPT_OUT.some((f) => {
    const n = limpiaOpt(f);
    if (!n) return false;
    if (t === n) return true;
    // Límites de palabra, NO includes(): "voy a trabajar" contiene "baja" y
    // "bastante" contiene "basta" — con includes marcaríamos opt-out a alguien
    // que solo dijo que iba a trabajar.
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${esc}(\\s|$)`).test(t);
  });
}

// Marca el opt-out y CANCELA las secuencias activas del contacto.
async function aplicarOptOut(db: SupabaseClient, channelId: string, contactId: string) {
  try {
    await db.from("contacts").update({ no_remarketing: true }).eq("id", contactId);
    await db.from("sequence_subscriptions")
      .update({ estado: "cancelada", updated_at: new Date().toISOString() })
      .eq("contact_id", contactId).eq("estado", "activa");
    await logEvent(db, channelId, contactId, "nota", "🚫 Pidió no recibir más mensajes",
      "Remarketing apagado para este contacto");
  } catch (_) { /* columna pendiente (0031) */ }
}

// ── Estado del run ─────────────────────────────────────────────────
async function getActiveRun(db: SupabaseClient, contactId: string): Promise<Run | null> {
  const { data } = await db.from("flow_runs").select("*")
    .eq("contact_id", contactId).in("estado", ["activo", "esperando"])
    .maybeSingle();
  return data as Run | null;
}

async function saveRun(db: SupabaseClient, run: Run) {
  await db.from("flow_runs").update({
    current_node_id: run.current_node_id, vars: run.vars,
    estado: run.estado, wake_at: run.wake_at, flow_id: run.flow_id,
    updated_at: new Date().toISOString(),
  }).eq("id", run.id);
}

// ── Ruteo de inicio de chat ────────────────────────────────────────
// Decide qué flujo arranca un mensaje entrante, en cascada de 3 niveles:
//   1) referral (ad_id del anuncio)  2) keyword (frase clave, determinista)
//   3) IA Router (intención) → si ninguno, flujo de respaldo o nada.
export type RouteTier = "referral" | "keyword" | "entrada" | "ia" | "fallback" | "none";
export interface RouteResult {
  tier: RouteTier;
  flow: { id: string; nombre?: string } | null;
  confidence?: number;
  reason?: string;
}

// Niveles 1-2: determinista (referral + keyword + flujo de entrada).
function matchTrigger(db: SupabaseClient, channelId: string, text: string, adId?: string): Promise<RouteResult> {
  return (async () => {
    const norm = normalize(text);
    const { data: triggers } = await db.from("flow_triggers")
      .select("flow_id, tipo, config, flows!inner(id, nombre, estado, es_entrada)")
      .eq("channel_id", channelId).eq("activo", true);

    let entrada: any = null;
    let kwHit: any = null;
    for (const t of triggers ?? []) {
      const flow = (t as any).flows;
      if (!flow || flow.estado !== "activo") continue;
      if (t.tipo === "entrada") { entrada = flow; continue; }
      // Referral CTWA: el anuncio identifica el producto sin depender del texto.
      // Gana sobre keyword (solo viene en el primer mensaje desde el anuncio).
      if (t.tipo === "referral" && adId) {
        const ads: string[] = (t.config?.ad_ids ?? []).map(String);
        if (ads.includes(String(adId))) return { tier: "referral", flow };
      }
      if (t.tipo === "keyword") {
        const kws: string[] = (t.config?.keywords ?? []).map(normalize);
        const mode = t.config?.match ?? "contiene";
        const hit = kws.some((k) =>
          k && (mode === "exacta" ? norm === k
            : mode === "empieza" ? norm.startsWith(k)
            : norm.includes(k))
        );
        if (hit && !kwHit) kwHit = flow; // keyword gana sobre entrada
      }
    }
    if (kwHit) return { tier: "keyword", flow: kwHit };
    if (entrada) return { tier: "entrada", flow: entrada };
    return { tier: "none", flow: null };
  })();
}

// Nivel 3: IA Router. Cuando ningún trigger determinista matchea, la IA lee
// el mensaje del cliente + la lista de productos activos (su Descripción/FAQ)
// y elige el que mejor calza. Solo rutea si supera el umbral de confianza; si
// no, cae al flujo de respaldo (menú) o a null. Requiere key de IA en el canal
// y ia_router.activo. Degrada en silencio ante cualquier error (nunca rompe).
async function aiRoute(db: SupabaseClient, channelId: string, text: string): Promise<RouteResult | null> {
  const clean = (text ?? "").trim();
  if (clean.length < 2) return null;
  try {
    const { data: ch } = await db.from("channels")
      .select("ia_router, ia_perfiles").eq("id", channelId).maybeSingle();
    const cfg = (ch as any)?.ia_router ?? {};
    if (!cfg.activo) return null;
    const umbral = Number.isFinite(Number(cfg.umbral)) ? Number(cfg.umbral) : 0.6;

    // Candidatos: flujos ACTIVOS con trigger keyword/entrada (los "puntos de
    // entrada" del canal), con su descripción de intención (producto o flujo).
    const { data: trg } = await db.from("flow_triggers")
      .select("tipo, flows!inner(id, nombre, estado, product_id, descripcion)")
      .eq("channel_id", channelId).eq("activo", true).in("tipo", ["keyword", "entrada"]);
    const flows = new Map<string, any>();
    for (const t of trg ?? []) {
      const f = (t as any).flows;
      if (f && f.estado === "activo" && !flows.has(f.id)) flows.set(f.id, f);
    }
    if (flows.size === 0) return null;

    const prodIds = [...new Set([...flows.values()].map((f) => f.product_id).filter(Boolean))];
    const prods = new Map<string, any>();
    if (prodIds.length) {
      const { data: ps } = await db.from("products").select("id, nombre, config").in("id", prodIds);
      for (const p of ps ?? []) prods.set((p as any).id, p);
    }
    const cands = [...flows.values()].map((f) => {
      const p = f.product_id ? prods.get(f.product_id) : null;
      const c = (p as any)?.config ?? {};
      const intent = c.intencion || c.contexto_producto || c.faq || f.descripcion || "";
      return { flow_id: f.id, label: (p as any)?.nombre || f.nombre || "Flujo", intent: String(intent).slice(0, 500) };
    });

    // Resolver proveedor + key (perfil del router, o el default del canal).
    const perfiles = (ch as any)?.ia_perfiles ?? {};
    const perfil = perfiles?.[cfg.perfil || "extraccion"] ?? null;
    const wantProvider = perfil?.proveedor && perfil.proveedor !== "auto" ? perfil.proveedor : null;
    const { data: aiRows } = await db.rpc("get_channel_ai_active", { p_channel_id: channelId, p_provider: wantProvider });
    const ai = Array.isArray(aiRows) ? aiRows[0] : aiRows;
    if (!ai?.api_key) return null; // sin IA configurada → no rutea (silencioso)
    const model = (perfil?.proveedor === ai.provider ? perfil?.modelo : null) || ai.model || undefined;

    const lista = cands.map((c, i) => `[${i + 1}] ${c.label}: ${c.intent || "(sin descripción)"}`).join("\n");
    const system = "Eres un clasificador de intención para un chatbot de ventas. Debes decidir a qué producto se refiere el mensaje de un cliente. Responde ÚNICAMENTE con un objeto JSON, sin texto adicional ni explicaciones.";
    const prompt = `Mensaje del cliente:\n"${clean}"\n\nProductos disponibles:\n${lista}\n\n` +
      `Elige el número del producto que el cliente quiere. Si el mensaje no calza claramente con ninguno (saludo genérico, spam, off-topic), usa 0.\n` +
      `Responde exactamente: {"idx": <número entre 0 y ${cands.length}>, "confianza": <0.0 a 1.0>}`;

    const raw = await runAI({ provider: ai.provider as Provider, apiKey: ai.api_key, model, system, content: prompt, maxTokens: 120 });
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) return null;
    let parsed: any;
    try { parsed = JSON.parse(m[0]); } catch { return null; }
    const idx = Number(parsed?.idx);
    const conf = Number(parsed?.confianza);

    if (Number.isInteger(idx) && idx >= 1 && idx <= cands.length && Number.isFinite(conf) && conf >= umbral) {
      const c = cands[idx - 1];
      return { tier: "ia", flow: { id: c.flow_id, nombre: c.label }, confidence: conf, reason: `IA eligió "${c.label}" (${Math.round(conf * 100)}%)` };
    }
    // Sin confianza suficiente → flujo de respaldo (menú) si está configurado.
    if (cfg.fallback_flow_id) {
      const { data: fb } = await db.from("flows")
        .select("id, nombre, estado").eq("id", cfg.fallback_flow_id).eq("channel_id", channelId).maybeSingle();
      if (fb && (fb as any).estado === "activo") {
        return { tier: "fallback", flow: { id: (fb as any).id, nombre: (fb as any).nombre }, confidence: Number.isFinite(conf) ? conf : undefined, reason: "IA sin confianza suficiente → flujo de respaldo" };
      }
    }
    return { tier: "none", flow: null, confidence: Number.isFinite(conf) ? conf : undefined, reason: "IA sin confianza suficiente" };
  } catch (e) {
    console.error("[aiRoute]", (e as any)?.message ?? e);
    return null; // decorativo: si la IA falla, el ruteo simplemente no arranca
  }
}

// Cascada completa (niveles 1-3). La usan runEngine (para arrancar) y la
// Edge Function route-test (simulador del panel, sin ejecutar nada).
export async function routeDecision(db: SupabaseClient, channelId: string, text: string, adId?: string): Promise<RouteResult> {
  const det = await matchTrigger(db, channelId, text, adId);
  if (det.flow) return det;
  const ia = await aiRoute(db, channelId, text);
  if (ia) return ia;
  return { tier: "none", flow: null };
}

async function startRun(db: SupabaseClient, channelId: string, contactId: string, flow: any, initialVars: Record<string, unknown> = {}): Promise<Run | null> {
  const initial = await initialNode(db, flow.id);
  const { data, error } = await db.from("flow_runs").insert({
    channel_id: channelId, contact_id: contactId, flow_id: flow.id,
    current_node_id: initial?.id ?? null, vars: initialVars, estado: "activo",
  }).select("*").single();
  // 23505 = ya hay un run activo para este contacto (índice idx_runs_lock):
  // dos webhooks simultáneos → el que pierde la carrera lo maneja el caller.
  if (error) {
    if ((error as any).code === "23505") return null;
    throw new Error(`startRun: ${error.message}`);
  }
  // Nombre + producto del flujo (para Timeline y atribución de producto).
  const { data: f } = await db.from("flows").select("nombre, product_id").eq("id", flow.id).maybeSingle();
  await logEvent(db, channelId, contactId, "flujo_inicio", "Flujo iniciado", (f as any)?.nombre ?? null);
  await markProduct(db, contactId, (f as any)?.product_id);
  return data as Run;
}

// ── Reanudar un run que esperaba input/botón/tiempo ────────────────
async function resumeRun(db: SupabaseClient, run: Run, event: EngineEvent): Promise<boolean> {
  const aw = run.vars._await;
  run.estado = "activo";

  // Aprobación de un pago digital manual: order-update reanuda el run parqueado
  // en el nodo OCR. Se sale por la MISMA puerta que usaría el nodo si hubiera
  // corrido solo ('exito', con 'continuar' de respaldo) → el nodo Condición lee
  // PAGO_OK (ya guardado) y sigue a la entrega normal (link + extras + Sheets).
  // OJO: mirar solo 'continuar' devolvía null (el generador cablea 'exito') y el
  // run se daba por completado SIN entregar lo que el cliente ya había pagado.
  if (event.type === "resume" && aw?.type === "aprobacion_digital") {
    run.current_node_id = await salidaOcr(db, run.flow_id, aw.node_id);
    delete run.vars._await;
    // Se libera el flag del extra para que el SIGUIENTE extra de la cadena también
    // pueda parquearse a tu aprobación (el principal solo ocurre una vez).
    delete run.vars._extra_manual_pendiente;
    run.wake_at = null;
    return true;
  }
  if (event.type === "resume") {
    // Nos despertó el reloj. Hay dos casos distintos:
    //   · Esperar (sin _await): simplemente seguir por 'continuar'.
    //   · Pregunta con timeout_seg (_await presente): el cliente NO contestó
    //     a tiempo → seguir por la rama 'timeout' (o 'continuar' si no existe).
    if (aw?.node_id) {
      run.current_node_id =
        (await nextNode(db, run.flow_id, aw.node_id, "timeout")) ??
        (await nextNode(db, run.flow_id, aw.node_id, "continuar"));
      await logEvent(db, run.channel_id, run.contact_id, "nota", "⏱ Sin respuesta a tiempo").catch(() => {});
    } else {
      run.current_node_id = await nextNode(db, run.flow_id, run.current_node_id!, "continuar");
    }
    delete run.vars._await;
    run.wake_at = null;
    return true;
  }
  if (!aw) {
    // No esperaba nada pero llegó un mensaje mientras corría → al buffer.
    run.vars._buffer = [...(run.vars._buffer ?? []), event];
    await saveRun(db, run);
    return false;
  }
  if (aw.type === "input" && event.type === "message") {
    if (aw.guardar_en) {
      await setField(db, run.channel_id, run.contact_id, aw.guardar_en, event.text);
      await logEvent(db, run.channel_id, run.contact_id, "campo", "Campo capturado", `${aw.guardar_en}: ${event.text ?? ""}`.slice(0, 140));
    }
    run.vars[aw.guardar_en] = event.text;
    run.current_node_id = await nextNode(db, run.flow_id, aw.node_id, "continuar");
    delete run.vars._await;
    run.wake_at = null; // contestó a tiempo → cancelar el timeout pendiente
    return true;
  }
  if (aw.type === "button" && event.type === "button") {
    const handle = `boton:${event.buttonId}`;
    const next = await nextNode(db, run.flow_id, aw.node_id, handle);
    run.current_node_id = next;
    delete run.vars._await;
    run.wake_at = null;
    return true;
  }
  // Pago digital POR VALIDAR: el cliente escribe antes de tu visto bueno. Antes
  // se quedaba mudo (iba al buffer y nunca se contestaba); ahora le responde en
  // modo "verificando" y el run SIGUE parqueado hasta que apruebes.
  if (aw.type === "aprobacion_digital" && event.type === "message") {
    await responderVerificando(db, run, event);
    run.estado = "esperando"; // permanece parqueado esperando tu aprobación
    await saveRun(db, run);
    return false;
  }
  // Tipo inesperado (ej. escribió texto donde esperábamos botón) → buffer.
  run.vars._buffer = [...(run.vars._buffer ?? []), event];
  await saveRun(db, run);
  return false;
}

// ── Ejecución de nodos ─────────────────────────────────────────────
async function execute(db: SupabaseClient, run: Run) {
  for (let i = 0; i < MAX_STEPS; i++) {
    if (!run.current_node_id) { run.estado = "completado"; break; }
    const node = await getNode(db, run.current_node_id);
    if (!node) { run.estado = "completado"; break; }
    await logEvent(db, run.channel_id, run.contact_id, "nodo", node.nombre || node.tipo, node.tipo);

    const ctx = await buildContext(db, run);

    switch (node.tipo) {
      case "mensaje": {
        const bubbles = node.config?.bubbles ?? [{ text: node.config?.text ?? "" }];
        let hasButtons = false;
        for (const b of bubbles) {
          await emit(db, run, b, ctx);
          // Solo se queda esperando si de verdad salieron botones: con títulos
          // vacíos no se envía ninguno y el flujo esperaría un toque imposible.
          if ((b.buttons ?? []).some((x: any) => String(x?.title ?? "").trim())) hasButtons = true;
        }
        if (hasButtons) {
          run.vars._await = { type: "button", node_id: node.id };
          run.estado = "esperando";
          await saveRun(db, run); return;
        }
        run.current_node_id = await nextNode(db, run.flow_id, node.id, "continuar");
        break;
      }
      case "rotador": {
        // Mensajes iniciales con ROTACIÓN de copy (evita baneos por repetir el
        // mismo saludo a todos). Cada variante = lista de burbujas (texto/media).
        // Elige una variante activa por PESO; si el rotador está apagado, usa
        // siempre la primera variante activa. Luego continúa al flujo de venta/IA.
        // RECOMPRA: el cliente ya compró y vuelve por más. En vez del pitch de
        // bienvenida ("gracias por tu interés"), un saludo cálido de recompra;
        // el vendedor IA (nodo siguiente) retoma preguntando qué quiere esta vez.
        if ((run.vars as any)?._recompra) {
          await emit(db, run, { text: "¡Hola de nuevo! 🎉 Con gusto te preparo tu nuevo pedido. ¿Qué necesitas esta vez?" }, ctx);
        } else {
          const all = (node.config?.variantes ?? []) as any[];
          const active = all.filter((v) => v.activo !== false && (v.bubbles?.length));
          if (active.length) {
            const rotOn = node.config?.activo !== false && active.length > 1;
            const chosen = rotOn ? pickWeighted(active) : active[0];
            for (const b of (chosen.bubbles ?? [])) await emit(db, run, b, ctx);
            await logEvent(db, run.channel_id, run.contact_id, "nota", "🎲 Variante inicial", chosen.nombre ?? "");
          }
        }
        // "Y después": continuar a otro flujo (venta o IA) o terminar. Se guarda
        // dentro del rotador, así el flujo Bienvenida es un solo nodo.
        const des = node.config?.despues ?? {};
        if (des.modo === "flujo" && des.flow_id) {
          const { data: tf } = await db.from("flows")
            .select("id, nombre, product_id, estado").eq("id", des.flow_id).eq("channel_id", run.channel_id).maybeSingle();
          if (tf && (tf as any).estado === "activo") {
            run.flow_id = (tf as any).id;
            const init = await initialNode(db, run.flow_id);
            run.current_node_id = init?.id ?? null;
            await logEvent(db, run.channel_id, run.contact_id, "flujo_inicio", "Flujo iniciado", (tf as any).nombre ?? null);
            await markProduct(db, run.contact_id, (tf as any).product_id);
            break;
          }
        }
        run.current_node_id = await nextNode(db, run.flow_id, node.id, "continuar");
        break;
      }
      case "pregunta": {
        // Adjuntos multimedia (imagen/video/audio) que se envían ANTES de la pregunta.
        for (const b of (node.config?.media ?? [])) await emit(db, run, b, ctx);
        // Sin texto = "esperar la respuesta sin decir nada" (lo usa el bucle
        // conversacional de la IA: responde y vuelve a escuchar). Antes se
        // emitía igual e insertaba una burbuja EN BLANCO en el chat.
        const pregTxt = resolve(node.config?.text ?? "", ctx);
        if (pregTxt.trim()) await emit(db, run, { text: pregTxt }, ctx);
        run.vars._await = { type: "input", node_id: node.id, guardar_en: node.config?.guardar_en };
        run.estado = "esperando";
        // timeout_seg: si el cliente NO contesta en ese tiempo, el scheduler
        // despierta el run y sigue por la rama "timeout". Es lo que evita
        // dejar a alguien colgado esperando una respuesta que no va a llegar
        // (ej.: pagó y no contesta la venta extra → se le entrega igual).
        const tSeg = Number(node.config?.timeout_seg ?? 0);
        run.wake_at = tSeg > 0 ? new Date(Date.now() + tSeg * 1000).toISOString() : null;
        await saveRun(db, run); return;
      }
      case "condicion": {
        const handle = await evalCondicion(db, run, node, ctx);
        run.current_node_id = await nextNode(db, run.flow_id, node.id, handle);
        break;
      }
      case "accion": {
        await runAcciones(db, run, node.config?.acciones ?? [], ctx);
        run.current_node_id = await nextNode(db, run.flow_id, node.id, "continuar");
        break;
      }
      case "esperar": {
        const seg = Number(node.config?.segundos ?? 3);
        run.wake_at = new Date(Date.now() + seg * 1000).toISOString();
        run.estado = "esperando";
        await saveRun(db, run); return;
      }
      case "iniciar_flujo": {
        const target = await resolveTargetFlow(db, run.channel_id, node.config);
        if (target) {
          run.flow_id = target;
          const init = await initialNode(db, target);
          run.current_node_id = init?.id ?? null;
          const { data: tf } = await db.from("flows").select("nombre, product_id").eq("id", target).maybeSingle();
          await logEvent(db, run.channel_id, run.contact_id, "flujo_inicio", "Flujo iniciado", (tf as any)?.nombre ?? null);
          await markProduct(db, run.contact_id, (tf as any)?.product_id);
        } else {
          run.current_node_id = null;
        }
        break;
      }
      case "ia": {
        await runIa(db, run, node, ctx);
        // El nodo IA puede PARQUEAR el run (pago digital en validación manual):
        // deja estado "esperando" para que la entrega ocurra recién al aprobar.
        if (run.estado === "esperando") { await saveRun(db, run); return; }
        break;
      }
      case "evento_fb": {
        await runEventoFb(db, run, node, ctx);
        break;
      }
      case "plantilla": {
        // Plantilla HSM aprobada por Meta — única vía para escribir FUERA de
        // la ventana de 24h (notificaciones de pedido físico en tránsito).
        try {
          await sendTemplateToContact(db, run.channel_id, run.contact_id, {
            name: node.config?.template_name,
            language: node.config?.template_lang,
            params: (node.config?.params ?? []).map((p: string) => resolve(String(p), ctx)),
          });
          run.current_node_id =
            (await nextNode(db, run.flow_id, node.id, "exito")) ??
            (await nextNode(db, run.flow_id, node.id, "continuar"));
        } catch (err) {
          await logEvent(db, run.channel_id, run.contact_id, "error", "Error al enviar plantilla", String((err as any)?.message ?? err));
          run.current_node_id =
            (await nextNode(db, run.flow_id, node.id, "fallo")) ??
            (await nextNode(db, run.flow_id, node.id, "continuar"));
        }
        break;
      }
      case "google_sheets": {
        await runGoogleSheets(db, run, node, ctx);
        break;
      }
      case "fin": run.estado = "completado"; run.current_node_id = null; break;
      default: {
        // Nodo desconocido → se salta siguiendo 'exito' (o 'continuar').
        run.current_node_id =
          (await nextNode(db, run.flow_id, node.id, "exito")) ??
          (await nextNode(db, run.flow_id, node.id, "continuar"));
      }
    }
  }
  if (run.estado === "activo") run.estado = "completado"; // agotó MAX_STEPS
  if (run.estado === "completado") await logEvent(db, run.channel_id, run.contact_id, "flujo_fin", "Flujo finalizado");
  await saveRun(db, run);
}

// ── Modo de entrega del canal (WhatsApp real vs webchat de pruebas) ─
async function ensureDelivery(db: SupabaseClient, run: any) {
  if (run._delivery !== undefined) return;
  const { data: ch } = await db.from("channels")
    .select("channel_type, phone_number_id").eq("id", run.channel_id).maybeSingle();
  if ((ch as any)?.channel_type === "whatsapp" && (ch as any).phone_number_id) {
    const secrets = await getChannelSecrets(db, run.channel_id);
    run._delivery = { mode: "whatsapp", phoneNumberId: (ch as any).phone_number_id, token: secrets?.access_token ?? null };
  } else {
    run._delivery = { mode: "webchat" };
  }
}

// ── Emisión de mensajes salientes ──────────────────────────────────
// En WhatsApp real envía por Graph API; en webchat basta con insertar
// (el panel lo ve por Realtime). Siempre queda registro en messages.
async function emit(db: SupabaseClient, run: any, bubble: any, ctx: any) {
  await ensureDelivery(db, run);
  const text = resolve(bubble.text ?? "", ctx);
  const d = run._delivery;

  // ── Burbuja de MEDIA (imagen/video/audio/documento) ──
  // media_url = URL pública (subida por media-upload). En WhatsApp se envía
  // por Graph; en webchat basta con insertar (el panel la renderiza).
  const mediaUrl = bubble.media_url ? resolve(String(bubble.media_url), ctx) : "";
  const mediaKind = bubble.media_kind as ("image" | "video" | "audio" | "document" | undefined);
  if (mediaUrl && mediaKind) {
    const caption = resolve(bubble.caption ?? bubble.text ?? "", ctx);
    let wamid = ""; let status = "sent"; let error: any = null;
    if (d?.mode === "whatsapp" && d.token && ctx.wa_id) {
      try {
        wamid = await sendMedia(d.phoneNumberId, d.token, ctx.wa_id, mediaKind, mediaUrl, caption || undefined, bubble.filename);
      } catch (e) {
        status = "failed";
        error = e instanceof MetaApiError ? e.meta : { message: String((e as any)?.message ?? e) };
        console.error("[emit] fallo envío media:", error);
      }
    }
    await db.from("messages").insert({
      channel_id: run.channel_id, contact_id: run.contact_id,
      direction: "out", type: mediaKind,
      content: { media_url: mediaUrl, caption: caption || "", mime: bubble.mime ?? "", filename: bubble.filename ?? "" },
      status, wamid: wamid || null, error,
    });
    return;
  }

  // ── Burbuja de TEXTO / BOTONES ──
  // Saneado acá y no solo en el panel: es la red que agarra los botones vacíos,
  // los títulos largos o los ids repetidos vengan de donde vengan (datos viejos,
  // el editor avanzado, un import). Cualquiera de esas tres cosas hace que Meta
  // rechace el mensaje ENTERO, y el cliente se quedaría sin nada.
  const vistos = new Set<string>();
  const btns = (bubble.buttons ?? [])
    .map((b: any, i: number) => {
      let id = String(b?.id ?? "").trim() || `atajo_${i + 1}`;
      while (vistos.has(id)) id += "_";
      vistos.add(id);
      return { id: id.slice(0, 256), title: String(b?.title ?? "").trim().slice(0, 20) };
    })
    .filter((b: any) => b.title)
    .slice(0, 3);
  // Los botones cuelgan de un cuerpo de texto: sin texto no hay interactivo.
  const isInteractive = btns.length > 0 && !!text;
  const content: any = {};
  if (text) content.text = text;
  if (bubble.media_id) content.media_id = bubble.media_id;
  if (isInteractive) content.buttons = btns;

  let wamid = ""; let status = "sent"; let error: any = null;
  if (d?.mode === "whatsapp" && d.token && ctx.wa_id && (text || isInteractive)) {
    try {
      wamid = isInteractive
        ? await sendButtons(d.phoneNumberId, d.token, ctx.wa_id, text, btns)
        : await sendText(d.phoneNumberId, d.token, ctx.wa_id, text);
    } catch (e) {
      status = "failed";
      error = e instanceof MetaApiError ? e.meta : { message: String((e as any)?.message ?? e) };
      console.error("[emit] fallo envío WhatsApp:", error);
    }
  }
  await db.from("messages").insert({
    channel_id: run.channel_id, contact_id: run.contact_id,
    direction: "out", type: isInteractive ? "interactive" : "text",
    content, status, wamid: wamid || null, error,
  });
}

// Emite el texto que generó la IA, resolviendo los marcadores [[media:tag]]:
// por cada marcador envía el archivo correspondiente del catálogo del producto
// (config.ia_multimedia, expuesto en ctx._ia_multimedia) intercalado con el
// texto. Los marcadores desconocidos se descartan (no se filtran al usuario).
async function emitIaText(db: SupabaseClient, run: any, result: string, ctx: any) {
  // [[humano]] — la IA pide ayuda cuando juzga que no puede resolverlo sola.
  // Se saca del texto SIEMPRE (aunque el traspaso falle) para que el marcador
  // nunca se le filtre al cliente. El mensaje que la IA escribió sí se manda:
  // avisa que lo pasa con una persona, y después el bot queda en pausa.
  if (/\[\[\s*humano\s*\]\]/i.test(result)) {
    result = result.replace(/\[\[\s*humano\s*\]\]/gi, "").trim();
    await pasarAHumano(db, run.channel_id, run.contact_id,
      "La IA pidió ayuda: no pudo resolverlo sola.", { aviso: "fuera" }).catch(() => {});
  }
  const re = /\[\[media:([\w-]+)\]\]/g;
  if (!re.test(result)) { if (result.trim()) await emit(db, run, { text: result }, ctx); return; }
  const catalog: any[] = Array.isArray(ctx?._ia_multimedia) ? ctx._ia_multimedia : [];
  re.lastIndex = 0;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(result)) !== null) {
    const before = result.slice(last, m.index).trim();
    if (before) await emit(db, run, { text: before }, ctx);
    const asset = catalog.find((x) => x && x.tag === m![1]);
    if (asset && asset.media_url) {
      await emit(db, run, {
        media_kind: asset.media_kind, media_url: asset.media_url,
        mime: asset.mime, filename: asset.filename, caption: "",
      }, ctx);
    }
    last = m.index + m[0].length;
  }
  const rest = result.slice(last).trim();
  if (rest) await emit(db, run, { text: rest }, ctx);
}

// Arranca un flujo concreto para un contacto (usado por el scheduler para
// remarketing). No interrumpe una conversación activa.
export async function startFlowRun(
  db: SupabaseClient, channelId: string, contactId: string, flowId: string,
  opts?: { force?: boolean; vars?: Record<string, unknown> },
): Promise<boolean> {
  if (opts?.force) {
    // Modo prueba: cancela cualquier run y arranca el flujo aunque esté en borrador.
    await db.from("flow_runs").update({ estado: "cancelado" })
      .eq("contact_id", contactId).in("estado", ["activo", "esperando"]);
  } else if (await getActiveRun(db, contactId)) {
    return false;
  }
  const { data: flow } = await db.from("flows").select("id, estado").eq("id", flowId).maybeSingle();
  if (!flow) return false;
  if (!opts?.force && (flow as any).estado !== "activo") return false;
  const run = await startRun(db, channelId, contactId, flow, opts?.vars ?? {});
  if (!run) return false; // otro run ganó la carrera del lock
  await execute(db, run);
  return true;
}

// Envía un mensaje suelto (paso de secuencia sin flujo).
export async function deliverMessage(db: SupabaseClient, channelId: string, contactId: string, text: string) {
  await deliverStep(db, channelId, contactId, { mensaje: text });
}

// Envía un PASO de secuencia con el mismo motor que los "mensajes iniciales":
// soporta burbujas multimedia (texto/imagen/video/audio) y ROTACIÓN de
// variantes ponderadas (paso.variantes[].bubbles). Formatos aceptados:
//   { mensaje }                         → una burbuja de texto (compat viejo)
//   { bubbles:[...] }                   → una o varias burbujas
//   { rotacion, variantes:[{peso,activo,bubbles}] } → rota una variante
export async function deliverStep(db: SupabaseClient, channelId: string, contactId: string, paso: any) {
  const run: any = { channel_id: channelId, contact_id: contactId, vars: {} };
  const ctx = await buildContext(db, run);

  // Elegir las burbujas a enviar.
  let bubbles: any[] = [];
  const variantes = Array.isArray(paso?.variantes) ? paso.variantes : null;
  if (variantes && variantes.length) {
    const active = variantes.filter((v: any) => v.activo !== false && (v.bubbles?.length));
    if (active.length) {
      const rotOn = paso.rotacion !== false && active.length > 1;
      const chosen = rotOn ? pickWeighted(active) : active[0];
      bubbles = chosen.bubbles ?? [];
    }
  } else if (Array.isArray(paso?.bubbles) && paso.bubbles.length) {
    bubbles = paso.bubbles;
  } else if (paso?.mensaje) {
    bubbles = [{ text: String(paso.mensaje) }];
  }

  for (const b of bubbles) {
    if (b && (b.media_url || (b.text && String(b.text).trim()))) await emit(db, run, b, ctx);
  }
}

// ── STT: descarga el audio entrante y lo transcribe (OpenAI Whisper) ─
// mediaRef = "wa-media:<id>" (WhatsApp, se baja por Graph con el token del
// canal) o una URL pública (webchat de pruebas).
async function transcribeIncoming(db: SupabaseClient, channelId: string, mediaRef: string): Promise<string | null> {
  const { data: aiRows } = await db.rpc("get_channel_ai_active", { p_channel_id: channelId, p_provider: "openai" });
  const ai = Array.isArray(aiRows) ? aiRows[0] : aiRows;
  if (!ai?.api_key) { console.warn("[STT] el canal no tiene API key de OpenAI → no se transcribe el audio"); return null; }

  let bytes: Uint8Array, mime: string;
  if (mediaRef.startsWith("wa-media:")) {
    const secrets = await getChannelSecrets(db, channelId);
    if (!secrets?.access_token) return null;
    ({ bytes, mime } = await fetchMediaBytes(mediaRef.slice("wa-media:".length), secrets.access_token));
  } else {
    const r = await fetch(mediaRef);
    if (!r.ok) return null;
    mime = r.headers.get("content-type") || "audio/ogg";
    bytes = new Uint8Array(await r.arrayBuffer());
  }
  const texto = await transcribeAudio(ai.api_key, bytes, mime);
  return texto || null;
}

// Sube una imagen entrante (comprobante) a Storage y devuelve su URL pública.
// WhatsApp no da URL pública del media; el webchat sí (se devuelve tal cual).
async function ingestImage(db: SupabaseClient, channelId: string, contactId: string, mediaRef: string): Promise<string | null> {
  if (/^https?:/.test(mediaRef)) return mediaRef;            // webchat: ya pública
  if (!mediaRef.startsWith("wa-media:")) return null;
  const secrets = await getChannelSecrets(db, channelId);
  if (!secrets?.access_token) return null;
  const { bytes, mime } = await fetchMediaBytes(mediaRef.slice("wa-media:".length), secrets.access_token);
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const path = `comprobantes/${contactId}/${Date.now()}.${ext}`;
  let up = await db.storage.from("media").upload(path, bytes, { contentType: mime || "image/jpeg", upsert: true });
  if (up.error && /bucket|not found/i.test(up.error.message)) {
    await db.storage.createBucket("media", { public: true }).catch(() => {}); // 1ª vez
    up = await db.storage.from("media").upload(path, bytes, { contentType: mime || "image/jpeg", upsert: true });
  }
  if (up.error) { console.error("[ingestImage] upload:", up.error.message); return null; }
  return db.storage.from("media").getPublicUrl(path).data?.publicUrl ?? null;
}

// Guarda la transcripción dentro de la burbuja del audio → el operador la lee
// en la Bandeja bajo la nota de voz. Best-effort.
async function annotateAudioTranscript(db: SupabaseClient, contactId: string, texto: string) {
  try {
    const { data: m } = await db.from("messages")
      .select("id, content").eq("contact_id", contactId).eq("direction", "in").eq("type", "audio")
      .order("ts", { ascending: false }).limit(1).maybeSingle();
    if (m) await db.from("messages").update({ content: { ...((m as any).content ?? {}), transcription: texto } }).eq("id", (m as any).id);
  } catch (_) { /* best-effort */ }
}

// ── Condiciones ────────────────────────────────────────────────────
async function evalCondicion(db: SupabaseClient, run: Run, node: Node, ctx: any): Promise<string> {
  for (const ruta of node.config?.rutas ?? []) {
    const modo = ruta.match ?? "todas";
    const res = [];
    for (const c of ruta.condiciones ?? []) res.push(await evalCond(db, run, c, ctx));
    const ok = modo === "cualquiera" ? res.some(Boolean) : res.every(Boolean);
    if (ok) return ruta.handle ?? `ruta:${ruta.nombre}`;
  }
  return "si_no_cumple";
}
async function evalCond(db: SupabaseClient, run: Run, c: any, ctx: any): Promise<boolean> {
  switch (c.op) {
    case "tiene_tag":    return await hasTag(db, run.contact_id, c.valor);
    case "no_tiene_tag": return !(await hasTag(db, run.contact_id, c.valor));
    case "campo_igual":     return String(ctx[c.campo] ?? "") === String(c.valor);
    case "campo_contiene":  return String(ctx[c.campo] ?? "").toLowerCase().includes(String(c.valor).toLowerCase());
    case "campo_existe":    return ctx[c.campo] != null && ctx[c.campo] !== "";
    default: return false;
  }
}

// ── Acciones ───────────────────────────────────────────────────────
// Requisito 6 — idempotencia: una venta = UNA fila en Sheets y UN aviso, aunque
// el motor reintente, el cliente reenvíe el comprobante o el webhook re-entregue.
// Se marca en el contacto (persiste entre runs, a diferencia de run.vars).
// Sin esto, un reintento duplica ingresos en las estadísticas — un error que se
// descubre tarde y ensucia los números de meses.
async function yaSeHizo(db: SupabaseClient, run: Run, clave: string): Promise<boolean> {
  const k = "_once_" + clave;
  try {
    const { data } = await db.from("contact_field_values")
      .select("value, custom_fields!inner(key)")
      .eq("contact_id", run.contact_id).eq("custom_fields.key", k).maybeSingle();
    if (data) return true;
  } catch (_) { return false; } // ante la duda, NO bloquear el aviso
  await setField(db, run.channel_id, run.contact_id, k, new Date().toISOString());
  return false;
}

async function runAcciones(db: SupabaseClient, run: Run, acciones: any[], ctx: any) {
  for (const a of acciones) {
    // `una_vez`: la acción corre una sola vez por contacto y clave. Se resuelve
    // acá y no en cada acción para que sirva a todas (avisos, Sheets, etiquetas).
    if (a.una_vez) {
      const clave = resolve(String(a.una_vez), ctx);
      if (clave && await yaSeHizo(db, run, clave)) {
        await logEvent(db, run.channel_id, run.contact_id, "nota", "Acción omitida (ya se hizo)", clave).catch(() => {});
        continue;
      }
    }
    switch (a.tipo) {
      case "add_tag":    await addTag(db, run.channel_id, run.contact_id, a.valor); await logEvent(db, run.channel_id, run.contact_id, "etiqueta_add", "Etiqueta añadida", a.valor); break;
      case "remove_tag": await removeTag(db, run.channel_id, run.contact_id, a.valor); await logEvent(db, run.channel_id, run.contact_id, "etiqueta_del", "Etiqueta quitada", a.valor); break;
      case "set_field": {
        const v = resolve(String(a.valor ?? ""), ctx);
        run.vars[a.key] = v; // disponible ya en este run (Condiciones posteriores)
        await setField(db, run.channel_id, run.contact_id, a.key, v);
        await logEvent(db, run.channel_id, run.contact_id, "campo", "Campo actualizado", `${a.key}: ${v}`.slice(0, 140));
        break;
      }
      case "clear_field":
        delete run.vars[a.key]; await setField(db, run.channel_id, run.contact_id, a.key, null);
        await logEvent(db, run.channel_id, run.contact_id, "campo", "Campo borrado", a.key);
        break;
      case "append_field": {
        const prev = ctx[a.key] ? String(ctx[a.key]) + "\n" : "";
        const v = prev + resolve(String(a.valor ?? ""), ctx);
        run.vars[a.key] = v;
        await setField(db, run.channel_id, run.contact_id, a.key, v);
        await logEvent(db, run.channel_id, run.contact_id, "campo", "Campo actualizado", `${a.key}: ${v}`.slice(0, 140));
        break;
      }
      case "stage":      await db.from("contacts").update({ stage: a.valor }).eq("id", run.contact_id); await logEvent(db, run.channel_id, run.contact_id, "nota", "Etapa: " + a.valor); break;
      case "notify_admin": {
        // `foto` opcional: adjunta la imagen (p.ej. {{ultima_imagen}}) como foto.
        const foto = a.foto ? resolve(String(a.foto), ctx) : undefined;
        await notifyAdmin(db, run, resolve(String(a.mensaje ?? a.valor ?? ""), ctx), foto);
        break;
      }
      case "transfer_human": {
        await db.from("contacts").update({ bot_activo: false }).eq("id", run.contact_id);
        await db.from("conversations").update({ requiere_humano: true }).eq("contact_id", run.contact_id);
        const msg = a.mensaje ? resolve(String(a.mensaje), ctx) : `🙋 ${ctx.nombre || ctx.wa_id} necesita atención humana`;
        await notifyAdmin(db, run, msg);
        await logEvent(db, run.channel_id, run.contact_id, "humano", "Transferido a un humano");
        break;
      }
      case "subscribe_seq": await subscribeSeq(db, run, a); await logEvent(db, run.channel_id, run.contact_id, "secuencia_inicio", "Secuencia suscrita", a.nombre ?? null); break;
      case "unsubscribe_seq": await unsubscribeSeq(db, run, a); await logEvent(db, run.channel_id, run.contact_id, "secuencia_cancel", "Secuencia cancelada", a.nombre ?? null); break;
      case "crear_pedido": await crearPedido(db, run, a, ctx); break;
      case "actualizar_pedido": await actualizarPedido(db, run, a, ctx); break;
      case "entregar": await entregarOpcion(db, run, a, ctx); break;
      case "resolver_zona": await resolverZonaAccion(db, run, a, ctx); break;
      // ── Conversación / contacto ──
      case "nota":
        await logEvent(db, run.channel_id, run.contact_id, "nota", resolve(String(a.valor ?? a.texto ?? ""), ctx) || "Nota"); break;
      case "seguimiento_on":
        await db.from("conversations").update({ requiere_humano: true }).eq("contact_id", run.contact_id);
        await logEvent(db, run.channel_id, run.contact_id, "nota", "Marcado para seguimiento"); break;
      case "seguimiento_off":
        await db.from("conversations").update({ requiere_humano: false }).eq("contact_id", run.contact_id);
        await logEvent(db, run.channel_id, run.contact_id, "nota", "Seguimiento quitado"); break;
      case "archivar":
        await db.from("conversations").update({ archivada: true }).eq("contact_id", run.contact_id);
        await logEvent(db, run.channel_id, run.contact_id, "nota", "Conversación archivada"); break;
      case "desarchivar":
        await db.from("conversations").update({ archivada: false }).eq("contact_id", run.contact_id);
        await logEvent(db, run.channel_id, run.contact_id, "nota", "Conversación desarchivada"); break;
      case "bloquear":
        await db.from("contacts").update({ bloqueado: true, bot_activo: false }).eq("id", run.contact_id);
        await logEvent(db, run.channel_id, run.contact_id, "nota", "Contacto bloqueado"); break;
      case "borrar_info":
        await db.from("contact_field_values").delete().eq("contact_id", run.contact_id);
        run.vars = {};
        await logEvent(db, run.channel_id, run.contact_id, "nota", "Información del usuario borrada"); break;
      // ── Bot / atención humana ──
      case "return_bot":
        await db.from("contacts").update({ bot_activo: true }).eq("id", run.contact_id);
        await db.from("conversations").update({ requiere_humano: false }).eq("contact_id", run.contact_id);
        await logEvent(db, run.channel_id, run.contact_id, "humano", "Devuelto al bot"); break;
      // ── Herramientas (calculan un valor y lo guardan en un campo) ──
      case "fecha_formato": {
        const v = formatFechaAhora(a.formato);
        if (a.guardar_en) { run.vars[a.guardar_en] = v; await setField(db, run.channel_id, run.contact_id, a.guardar_en, v); await logEvent(db, run.channel_id, run.contact_id, "campo", "Fecha formateada", `${a.guardar_en}: ${v}`); }
        break;
      }
      case "aleatorio": {
        const v = generarAleatorio(a);
        if (a.guardar_en) { run.vars[a.guardar_en] = v; await setField(db, run.channel_id, run.contact_id, a.guardar_en, v); await logEvent(db, run.channel_id, run.contact_id, "campo", "Valor aleatorio", `${a.guardar_en}: ${v}`); }
        break;
      }
      case "contar_caracteres": {
        const src = resolve(String(a.origen ?? a.valor ?? ""), ctx);
        const v = String([...src].length);
        if (a.guardar_en) { run.vars[a.guardar_en] = v; await setField(db, run.channel_id, run.contact_id, a.guardar_en, v); await logEvent(db, run.channel_id, run.contact_id, "campo", "Contador de caracteres", `${a.guardar_en}: ${v}`); }
        break;
      }
    }
  }
}

// Fecha/hora de AHORA en la zona del negocio, según el formato elegido.
function formatFechaAhora(fmt?: string): string {
  const now = new Date(); const TZ = "America/Lima";
  const p = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-PE", { timeZone: TZ, ...opts }).format(now);
  switch (fmt) {
    case "yyyy-mm-dd": { const [d, m, y] = p({ day: "2-digit", month: "2-digit", year: "numeric" }).split("/"); return `${y}-${m}-${d}`; }
    case "hh:mm": return p({ hour: "2-digit", minute: "2-digit", hour12: false });
    case "dia_semana": return p({ weekday: "long" });
    case "dd/mm/yyyy hh:mm": return `${p({ day: "2-digit", month: "2-digit", year: "numeric" })} ${p({ hour: "2-digit", minute: "2-digit", hour12: false })}`;
    case "dd/mm/yyyy": default: return p({ day: "2-digit", month: "2-digit", year: "numeric" });
  }
}

// Genera un número o texto aleatorio. { modo:"numero"|"texto", min,max,longitud }
function generarAleatorio(a: any): string {
  if (a.modo === "texto") {
    const n = Math.max(1, Number(a.longitud ?? 6));
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = ""; for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  const min = Math.ceil(Number(a.min ?? 1)), max = Math.floor(Number(a.max ?? 100));
  const lo = Math.min(min, max), hi = Math.max(min, max);
  return String(Math.floor(Math.random() * (hi - lo + 1)) + lo);
}

// ── Pedidos (productos físicos, DEFINICION §6-SEPTIES) ─────────────
// Estados FINALES de un pedido (no se "reabre" con actualizar_pedido).
const ORDER_FINAL = ["confirmada", "anulada", "entregado_cobrado", "recogido", "cancelado", "rechazado", "no_recogido"];

function parseMonto(raw: unknown, ctx: any): number | undefined {
  const s = resolve(String(raw ?? ""), ctx).trim().replace(",", ".");
  if (!s) return undefined;
  const n = Number(s.replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

// ═══════════════════════════════════════════════════════════════════
// ESPEJO DE PEDIDOS EN GOOGLE SHEETS
// La hoja refleja `orders` sola: se llama al crear el pedido y en CADA cambio
// de estado, y busca la fila por ID para actualizarla en vez de agregar otra.
// Va acá y no como nodos del flujo a propósito: si dependiera de que cada
// flujo tenga su nodo de Sheets, alcanzaría con que alguien edite un flujo para
// que dejen de registrarse ventas y nadie se entere hasta fin de mes.
//
// Tres hojas, como los tableros: "Digital", "Lima" y "Provincia" — cada
// operación tiene datos distintos y mezclarlas hace una hoja ilegible.
// Nunca lanza: la hoja no puede romper una venta.
// ═══════════════════════════════════════════════════════════════════
const EST_HOJA: Record<string, string> = {
  esperando_adelanto: "Esperando adelanto", adelanto_validado: "Adelanto pagado",
  por_despachar: "Por despachar", despachado: "Despachado", en_agencia: "En agencia",
  saldo_pagado: "Saldo pagado", recogido: "Recogido", confirmado: "Confirmado",
  en_reparto: "En reparto", entregado_cobrado: "Entregado y cobrado",
  reprogramado: "Reprogramado", rechazado: "Rechazado", no_recogido: "No recogido",
  cancelado: "Cancelado", confirmada: "Pagado", pendiente: "Pendiente", anulada: "Anulada",
};

export async function syncPedidoSheet(db: SupabaseClient, orderId: string) {
  try {
    const { data: o } = await db.from("orders")
      .select("id, channel_id, contact_id, estado, amount, currency, shipping, order_bumps, created_at, product:product_id(nombre, tipo)")
      .eq("id", orderId).maybeSingle();
    if (!o) return;
    const ord = o as any;
    const { data: ch } = await db.from("channels").select("gsheets").eq("id", ord.channel_id).maybeSingle();
    const g = (ch as any)?.gsheets ?? {};
    if (!g.spreadsheet_id || g.connected === false) return; // sin hoja conectada, no hay nada que hacer
    const { data: c } = await db.from("contacts")
      .select("nombre, wa_id, ad_id").eq("id", ord.contact_id).maybeSingle();
    const ct = (c as any) ?? {};
    const s = ord.shipping ?? {};
    const zona = String(s.zona ?? "").toLowerCase();
    const fisico = ord.product?.tipo === "fisico" || !!zona;

    const fecha = new Intl.DateTimeFormat("es-PE", {
      timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date(ord.created_at));
    const extra = (ord.order_bumps ?? []).reduce((a: number, b: any) => a + Number(b.precio ?? 0), 0);

    let hoja: string; let fila: Record<string, string>;
    if (!fisico) {
      // Nombres cortos, como los escribió Rodrigo en su hoja. El casado es sin
      // distinguir mayúsculas, así que "CEL" y "Cel" son la misma columna.
      hoja = "Digital";
      fila = {
        "ID": ord.id,
        "Ad ID": ct.ad_id ?? "",
        "Cliente": ct.nombre ?? "",
        "Cel": ct.wa_id ?? "",
        "Fecha y hora": fecha,
        "Valor": String(ord.amount ?? ""),
        "Producto": [ord.product?.nombre, s.opcion].filter(Boolean).join(" · "),
        "Orderbump": extra ? String(extra) : "",
        "Imagen": s.comprobante ?? s.adelanto_comprobante ?? "",
      };
    } else if (zona === "lima") {
      hoja = "Lima";
      fila = {
        "ID": ord.id,
        "Ad ID": ct.ad_id ?? "",
        "Cliente": s.cliente || ct.nombre || "",
        "Celular": ct.wa_id ?? "",
        "Fecha y hora": fecha,
        "Distrito": s.zona_nombre ?? "",
        "Dirección": s.direccion ?? "",
        "Referencia": s.referencia ?? "",
        "Producto": ord.product?.nombre ?? "",
        "Opción": s.opcion ?? "",
        "Valor a cobrar": String(s.saldo ?? ord.amount ?? ""),
        "Estado": EST_HOJA[ord.estado] ?? ord.estado,
      };
    } else {
      hoja = "Provincia";
      fila = {
        "ID": ord.id,
        "Ad ID": ct.ad_id ?? "",
        "Cliente": s.cliente || ct.nombre || "",
        "Celular": ct.wa_id ?? "",
        "Fecha y hora": fecha,
        "DNI": s.dni ?? "",
        "Agencia": [s.ciudad, s.sede].filter(Boolean).join(" · "),
        "Producto": ord.product?.nombre ?? "",
        "Opción": s.opcion ?? "",
        "Valor total": String(ord.amount ?? ""),
        "Adelanto": String(s.adelanto ?? ""),
        "Saldo": String(s.saldo ?? ""),
        "Guía": s.guia ?? "",
        "Estado": EST_HOJA[ord.estado] ?? ord.estado,
        "Imagen": s.adelanto_comprobante ?? s.saldo_comprobante ?? "",
      };
    }

    // update busca por ID; si no encuentra la fila, la agrega. Así la primera
    // llamada crea y las siguientes actualizan, sin llevar cuenta de nada.
    if (g.mode === "oauth") {
      const { data: tk } = await db.rpc("get_gsheets_token", { p_channel_id: ord.channel_id });
      const refresh = Array.isArray(tk) ? tk[0]?.refresh_token : (tk as any)?.refresh_token ?? tk;
      if (!refresh) return;
      const token = await getAccessToken(String(refresh));
      await sheetsUpdate(token, String(g.spreadsheet_id), hoja, { "ID": ord.id }, fila);
    } else if (g.webhook_url) {
      await fetch(String(g.webhook_url), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hoja, fila, buscar: { "ID": ord.id }, accion: "update" }),
      });
    }
  } catch (e) {
    // Nunca romper la venta por la hoja.
    console.error("[syncPedidoSheet]", (e as any)?.message ?? e);
  }
}

// Acción entregar: { mensaje?, una_burbuja?, diferir?, incluir_buffer?, version_id? }
// Envía lo que la opción COMPRADA incluye (uno o varios links y/o archivos), y
// CADA item puede llevar su propio `mensaje` (etiqueta). Modos:
//  · normal         → cada cosa en su burbuja (mensaje del item + el link/archivo).
//  · una_burbuja    → UN solo mensaje de texto: encabezado + todos los links en
//                     líneas. Los ARCHIVOS adjuntos salen aparte (regla de WhatsApp).
//  · diferir        → NO envía; acumula los items en run.vars._entrega_buffer para
//                     entregarlos JUNTO con el principal al final (venta extra "antes").
//  · incluir_buffer → antepone lo acumulado (extras diferidos) a esta entrega y vacía el buffer.
// Reemplaza al {{link_entrega}} suelto: cada opción entrega lo suyo. Idempotente:
// se puede volver a llamar ("no me llegó") — reenvía lo mismo sin cobrar de nuevo.
async function entregarOpcion(db: SupabaseClient, run: Run, a: any, ctx: any) {
  let opcion = (ctx as any)._opcion as Opcion | null;
  // a.version_id → entregar una opción CONCRETA en vez de la que compró como
  // principal. Es lo que usa la venta extra: el extra es otra opción de compra.
  const vid = a?.version_id ? resolve(String(a.version_id), ctx) : "";
  if (vid) {
    const { data } = await db.from("product_versions")
      .select("id, nombre, precio, entrega, descripcion, cantidad").eq("id", vid).maybeSingle();
    if (data) opcion = data as unknown as Opcion;
  }
  // Items de ESTA opción, con su mensaje opcional ya resuelto (soporta {{vars}}).
  const items = (Array.isArray(opcion?.entrega) ? opcion!.entrega : [])
    .filter((it: any) => it && it.url)
    .map((it: any) => ({
      tipo: it.tipo, url: String(it.url), nombre: it.nombre ?? "",
      media_kind: it.media_kind || "document", filename: it.filename ?? undefined,
      mensaje: it.mensaje ? resolve(String(it.mensaje), ctx) : "",
    }));

  const vars = run.vars as any;
  // "diferir": guardar para la entrega conjunta del final (no se envía ahora).
  if (a?.diferir) {
    if (items.length) vars._entrega_buffer = [...(vars._entrega_buffer || []), ...items];
    return;
  }

  // Juntar con lo diferido (venta extra "antes") si corresponde, y vaciar el buffer.
  let all = items;
  if (a?.incluir_buffer && Array.isArray(vars._entrega_buffer) && vars._entrega_buffer.length) {
    all = [...items, ...vars._entrega_buffer];
    vars._entrega_buffer = [];
  }
  const header = a?.mensaje ? resolve(String(a.mensaje), ctx) : "";

  if (!all.length) {
    // Compat: opción sin items pero con link suelto en config.
    if (ctx.link_entrega) await emit(db, run, { text: header ? `${header}\n${String(ctx.link_entrega)}` : String(ctx.link_entrega) }, ctx);
    else if (header) await emit(db, run, { text: header }, ctx);
    else await logEvent(db, run.channel_id, run.contact_id, "error", "Nada que entregar",
      `La opción "${opcion?.nombre ?? "—"}" no tiene entrega configurada`);
    return;
  }

  const links = all.filter((it) => it.tipo !== "archivo");
  const files = all.filter((it) => it.tipo === "archivo");

  if (a?.una_burbuja) {
    // Un solo mensaje: encabezado + cada link en su línea (con su etiqueta/mensaje).
    let text = header;
    for (const it of links) {
      const label = it.mensaje || it.nombre;
      text += (text ? "\n" : "") + (label ? `${label} ` : "") + it.url;
    }
    if (text) await emit(db, run, { text }, ctx);
    // Archivos: obligatoriamente aparte (WhatsApp); su mensaje va de caption.
    for (const it of files) {
      await emit(db, run, { media_url: it.url, media_kind: it.media_kind, filename: it.filename, caption: it.mensaje || it.nombre || "" }, ctx);
    }
  } else {
    // Burbujas separadas: encabezado, luego cada item (su mensaje + el link/archivo).
    if (header) await emit(db, run, { text: header }, ctx);
    for (const it of all) {
      if (it.mensaje) await emit(db, run, { text: it.mensaje }, ctx);
      if (it.tipo === "archivo") {
        await emit(db, run, { media_url: it.url, media_kind: it.media_kind, filename: it.filename, caption: it.nombre ?? "" }, ctx);
      } else {
        await emit(db, run, { text: `${it.nombre ? it.nombre + ": " : ""}${it.url}` }, ctx);
      }
    }
  }
  await logEvent(db, run.channel_id, run.contact_id, "nota", "Producto entregado",
    `${opcion?.nombre ?? ""} · ${all.length} ${all.length === 1 ? "elemento" : "elementos"}`);
}

// Acción crear_pedido: { estado?, monto?, datos?: { zona:"{{zona_entrega}}", … } }
// Envío que el cliente paga APARTE y que entra al total del pedido. Los tres
// modos (Negocio → Entrega, con override por producto):
//   · "incluido" → 0. El flete sale de tu margen; el cliente no paga nada extra.
//     Es el caso normal: el precio de lista ya lo contempla.
//   · "suma"     → el monto de la zona se suma a lo que paga el cliente.
//   · "agencia"  → 0. Lo paga en la agencia al recoger; no pasa por tu caja.
// Sin modo resuelto se cae a la forma vieja del producto (agencia modo "fijo" o
// los checkboxes con costo_lima/costo_provincia), para no cambiarle el
// comportamiento a los productos que nadie volvió a tocar.
function envioCobroDe(ctx: any, zona: string): number {
  const modo = String(ctx._envio_modo ?? "");
  if (modo === "incluido" || modo === "agencia") return 0;
  if (modo === "suma") {
    const v = Number(zona === "lima" ? ctx._envio_cobro_lima : ctx._envio_cobro_provincia);
    return Number.isFinite(v) && v > 0 ? +v.toFixed(2) : 0;
  }
  if (zona === "provincia") {
    const fijo = Number(ctx.envio_cobro);
    if (Number.isFinite(fijo) && fijo > 0) return fijo; // forma nueva (modo fijo)
    if (ctx.envio_gratis === false) { const c = Number(ctx.envio_costo_provincia); if (Number.isFinite(c) && c > 0) return c; }
  } else if (zona === "lima") {
    if (ctx.envio_gratis === false) { const c = Number(ctx.envio_costo_lima); if (Number.isFinite(c) && c > 0) return c; }
  }
  return 0;
}

// Pago digital: qué se registra como cobrado. Si el OCR leyó un monto y el
// cliente pagó MÁS que lo esperado (típico cuando el remarketing bajó el precio
// pero pagó el de lista), se registra lo que REALMENTE pagó y el excedente queda
// como `vuelto` (saldo a favor del cliente). Si pagó lo justo, todo normal.
function pagoRealYVuelto(run: Run, esperadoTotal: number): { amount: number; vuelto: number } {
  const pagado = Number(run.vars.pago_monto);
  if (Number.isFinite(pagado) && pagado > esperadoTotal + 0.5) {
    return { amount: +pagado.toFixed(2), vuelto: +(pagado - esperadoTotal).toFixed(2) };
  }
  return { amount: +esperadoTotal.toFixed(2), vuelto: 0 };
}
async function avisarVuelto(db: SupabaseClient, run: Run, amount: number, vuelto: number) {
  try {
    const { data: c } = await db.from("contacts").select("nombre, wa_id").eq("id", run.contact_id).maybeSingle();
    const quien = (c as any)?.nombre || (c as any)?.wa_id || "Un cliente";
    await notifyAdmin(db, { channel_id: run.channel_id, contact_id: run.contact_id } as any,
      `💸 <b>Pagó de más · vuelto S/ ${vuelto}</b>\n${quien} pagó <b>S/ ${amount}</b> (S/ ${vuelto} de más). Revisa si se lo devuelves o queda a favor.`).catch(() => {});
  } catch (_) { /* best-effort */ }
}

async function crearPedido(db: SupabaseClient, run: Run, a: any, ctx: any) {
  try {
    const ship: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(a.datos ?? {})) ship[k] = resolve(String(v ?? ""), ctx);

    // Atributos capturados (talla, color…) → quedan en el pedido, por su NOMBRE
    // legible, para el rótulo de envío y Compras. Se leen de las variables del
    // run por su clave (los pobló extraerDatos). Solo los que tienen valor.
    const atrs: any[] = Array.isArray((ctx as any)._atributos) ? (ctx as any)._atributos : [];
    if (atrs.length) {
      const bag: Record<string, string> = {};
      for (const at of atrs) {
        const v = String(ctx[at.clave] ?? run.vars?.[at.clave] ?? "").trim();
        if (v) bag[at.nombre] = v;
      }
      if (Object.keys(bag).length) ship.atributos = bag;
    }

    // Pago digital manual: el pedido YA se creó como 'pendiente' al parquear el
    // pago; ahora que se aprobó y la entrega llegó a este nodo, se ACTUALIZA en
    // vez de insertar otro (evita el pedido duplicado). Solo aplica en ese caso
    // (flag _order_precreado): el resto de flujos insertan como siempre.
    if (run.vars._order_precreado && run.vars._order_id) {
      const base = parseMonto(a.monto ?? a.amount, ctx) ?? 0;
      const { data: cur } = await db.from("orders").select("shipping").eq("id", run.vars._order_id).maybeSingle();
      const merged = { ...((cur as any)?.shipping ?? {}), ...ship, digital_pendiente: false };
      const patch: Record<string, unknown> = {
        estado: a.estado || "confirmada", shipping: merged, updated_at: new Date().toISOString(),
      };
      // Registra lo REALMENTE pagado + el vuelto (excedente) si pagó de más.
      const pr = pagoRealYVuelto(run, base);
      if (base) patch.amount = pr.amount;
      if (pr.vuelto > 0) merged.vuelto = pr.vuelto;
      if (["confirmada", "entregado_cobrado", "recogido", "saldo_pagado"].includes(patch.estado as string)) {
        patch.confirmed_at = new Date().toISOString();
      }
      await db.from("orders").update(patch).eq("id", run.vars._order_id);
      if (pr.vuelto > 0) await avisarVuelto(db, run, pr.amount, pr.vuelto);
      run.vars._order_precreado = false;
      run.vars.pedido_id = run.vars._order_id;
      ctx.pedido_id = run.vars._order_id;
      await logEvent(db, run.channel_id, run.contact_id, "nota", "Pedido confirmado (pago manual aprobado)");
      await syncPedidoSheet(db, run.vars._order_id as string);
      return;
    }

    const { data: c } = await db.from("contacts").select("product_id").eq("id", run.contact_id).maybeSingle();

    // El envío que cobras se SUMA al total del pedido (decisión de Rodrigo).
    const base = parseMonto(a.monto ?? a.amount, ctx) ?? 0;
    const envio = envioCobroDe(ctx, String(ship.zona ?? ctx.zona_entrega ?? ""));
    if (envio > 0) ship.envio_cobrado = envio; // transparente en el pedido
    const esperado = +(base + envio).toFixed(2);
    // Venta DIGITAL (confirmada): se registra lo que REALMENTE pagó y, si pagó de
    // más, el excedente queda como `vuelto` (saldo a favor) y se avisa. El resto
    // de estados (físico) usan el monto esperado como siempre.
    let amount = esperado, vuelto = 0;
    if (a.estado === "confirmada") { const pr = pagoRealYVuelto(run, esperado); amount = pr.amount; vuelto = pr.vuelto; if (vuelto > 0) ship.vuelto = vuelto; }

    // Congela el costo de la mercadería EN el pedido, para que cambiar el costo
    // del producto después no altere los márgenes ya cerrados (snapshot).
    try {
      const pid = (c as any)?.product_id;
      if (pid) {
        const { data: p } = await db.from("products").select("config").eq("id", pid).maybeSingle();
        const unit = (p as any)?.config?.costo;
        if (unit != null && unit !== "") {
          const cant = Number(ctx.cantidad) || 1;
          ship.costo_producto = +(Number(unit) * cant).toFixed(2);
        }
      }
    } catch { /* sin costo → el Dashboard lo marca como "faltan datos" */ }

    const { data: ord, error } = await db.from("orders").insert({
      channel_id: run.channel_id, contact_id: run.contact_id,
      product_id: (c as any)?.product_id ?? null,
      amount, estado: a.estado || "carrito", shipping: ship,
    }).select("id").single();
    if (error) throw new Error(error.message);
    run.vars._order_id = (ord as any).id;
    run.vars.pedido_id = (ord as any).id; // {{pedido_id}}: la llave de la fila en Sheets
    ctx.pedido_id = (ord as any).id;
    await logEvent(db, run.channel_id, run.contact_id, "nota", "Pedido creado", a.estado || "carrito");
    if (vuelto > 0) await avisarVuelto(db, run, amount, vuelto);
    await syncPedidoSheet(db, (ord as any).id); // la fila nace con el pedido
  } catch (err) {
    await logEvent(db, run.channel_id, run.contact_id, "error", "Error al crear pedido", String((err as any)?.message ?? err));
  }
}

// Acción actualizar_pedido: { estado?, monto?, datos? } — actúa sobre el
// pedido del run (_order_id) o el último pedido NO final del contacto.
async function actualizarPedido(db: SupabaseClient, run: Run, a: any, ctx: any) {
  try {
    let orderId = run.vars._order_id as string | undefined;
    if (!orderId) {
      const { data: o } = await db.from("orders").select("id")
        .eq("contact_id", run.contact_id)
        .not("estado", "in", `(${ORDER_FINAL.map((e) => `"${e}"`).join(",")})`)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      orderId = (o as any)?.id;
    }
    if (!orderId) return;
    run.vars._order_id = orderId;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (a.estado) {
      patch.estado = resolve(String(a.estado), ctx);
      if (["confirmada", "entregado_cobrado", "recogido", "saldo_pagado"].includes(patch.estado as string)) {
        patch.confirmed_at = new Date().toISOString();
      }
    }
    const monto = parseMonto(a.monto ?? a.amount, ctx);
    if (monto !== undefined) patch.amount = monto;
    // a.bump: { nombre, precio } — suma una venta extra al pedido. Alimenta las
    // métricas de "ventas extra" del Dashboard y la columna "Valor Producto
    // extra" de la hoja, sin inventar una tabla nueva.
    if (a.bump) {
      const { data: cur } = await db.from("orders").select("order_bumps, shipping").eq("id", orderId).maybeSingle();
      const previos = ((cur as any)?.order_bumps ?? []) as any[];
      const nombre = resolve(String(a.bump.nombre ?? ""), ctx);
      const precio = Number(resolve(String(a.bump.precio ?? "0"), ctx)) || 0;
      // Idempotente: si ya está ese extra, no se suma dos veces.
      if (!previos.some((b) => b?.nombre === nombre)) {
        // Un extra DIGITAL dentro de un pedido físico viaja con su version_id +
        // digital:true → su link/archivo se entrega cuando el pedido queda pagado
        // del todo (no antes: sería regalar el digital en un pago contraentrega).
        const nuevo: Record<string, unknown> = { nombre, precio };
        if (a.bump.version_id) nuevo.version_id = resolve(String(a.bump.version_id), ctx);
        if (a.bump.digital) { nuevo.digital = true; nuevo.entregado = false; }
        patch.order_bumps = [...previos, nuevo];
        // Venta extra "ride-along" en un pedido FÍSICO: no se cobra aparte, se
        // suma al SALDO (lo que cobra la agencia en provincia, o el motorizado en
        // Lima). El adelanto no cambia. Solo si el pedido tiene saldo y el bump lo
        // pide.
        if (a.bump.sube_saldo) {
          const sActual = Number(((cur as any)?.shipping ?? {}).saldo);
          if (Number.isFinite(sActual)) {
            patch.shipping = { ...((cur as any)?.shipping ?? {}), saldo: +(sActual + precio).toFixed(2) };
          }
        }
      }
    }
    if (a.datos && Object.keys(a.datos).length) {
      const { data: cur } = await db.from("orders").select("shipping").eq("id", orderId).maybeSingle();
      const ship: Record<string, unknown> = { ...((cur as any)?.shipping ?? {}) };
      for (const [k, v] of Object.entries(a.datos)) ship[k] = resolve(String(v ?? ""), ctx);
      patch.shipping = ship;
    }
    const { error } = await db.from("orders").update(patch).eq("id", orderId);
    if (error) throw new Error(error.message);
    if (a.estado) await logEvent(db, run.channel_id, run.contact_id, "nota", "Pedido → " + patch.estado);
    await syncPedidoSheet(db, orderId); // la fila sigue al pedido
  } catch (err) {
    await logEvent(db, run.channel_id, run.contact_id, "error", "Error al actualizar pedido", String((err as any)?.message ?? err));
  }
}

// Suscribe (o reactiva) al contacto en una secuencia de remarketing.
async function subscribeSeq(db: SupabaseClient, run: Run, a: any) {
  let seqId = a.sequence_id;
  if (!seqId && a.nombre) {
    const { data } = await db.from("sequences").select("id")
      .eq("channel_id", run.channel_id).eq("nombre", a.nombre).maybeSingle();
    seqId = (data as any)?.id;
  }
  if (!seqId) return;
  await db.from("sequence_subscriptions").upsert({
    channel_id: run.channel_id, contact_id: run.contact_id, sequence_id: seqId,
    estado: "activa", paso_actual: 0, updated_at: new Date().toISOString(),
  }, { onConflict: "contact_id,sequence_id" });
}
async function unsubscribeSeq(db: SupabaseClient, run: Run, a: any) {
  let q = db.from("sequence_subscriptions").update({ estado: "cancelada", updated_at: new Date().toISOString() })
    .eq("contact_id", run.contact_id);
  if (a.sequence_id) q = q.eq("sequence_id", a.sequence_id);
  await q;
}

// Notifica a los admins del canal por Telegram (bot token en Vault).
// `buttons`: el Copiloto en el celular. Los toques los recibe la Edge Function
// telegram-webhook, que verifica que el que tocó sea admin de este canal.
async function notifyAdmin(db: SupabaseClient, run: Run, text: string, photoUrl?: string, buttons?: TgButton[][]) {
  if (!text) return;
  const { data: channel } = await db.from("channels")
    .select("telegram_chat_ids, nombre").eq("id", run.channel_id).maybeSingle();
  const chatIds = (channel as any)?.telegram_chat_ids ?? [];
  if (!chatIds.length) return;
  const secrets = await getChannelSecrets(db, run.channel_id);
  const token = secrets?.telegram_bot_token;
  if (!token) { console.warn("[notify_admin] canal sin telegram_bot_token"); return; }
  const prefix = (channel as any)?.nombre ? `[${(channel as any).nombre}] ` : "";
  await sendTelegram(token, chatIds, prefix + text, photoUrl, buttons);
}

// Dispara los flujos suscritos a un estado de pedido (igual que order-update),
// usado por la validación automática de saldo para soltar la clave de recojo.
// `forzar`: lo usan los INTERCEPTORES de pago (adelanto/saldo). Ahí sabemos que
// el run de venta está esperando al cliente, y startFlowRun sin force devuelve
// false si hay un run activo → el aviso NUNCA se enviaría. O sea: el cliente
// paga y no recibe confirmación. Cuando el pago ya entró, la conversación de
// venta terminó y le toca ceder al flujo del pedido.
async function triggerPedidoEstado(
  db: SupabaseClient, channelId: string, contactId: string, estado: string, forzar = false,
) {
  const { data: trigs } = await db.from("flow_triggers")
    .select("flow_id, config, interrumpe, flows!inner(id, estado)")
    .eq("channel_id", channelId).eq("tipo", "pedido_estado").eq("activo", true);
  for (const t of trigs ?? []) {
    const estados: string[] = ((t as any).config?.estados ?? []).map(String);
    if (!estados.includes(estado)) continue;
    if ((t as any).flows?.estado !== "activo") continue;
    try {
      const ok = await startFlowRun(db, channelId, contactId, (t as any).flow_id,
        { force: forzar || !!(t as any).interrumpe });
      if (ok) break;
    } catch (e) { console.error("[triggerPedidoEstado]", (e as any)?.message ?? e); }
  }
}

// Cierra la conversación de VENTA de un contacto (cancela su run activo). Se usa
// cuando la venta física TERMINÓ (provincia: saldo pagado; Lima: entregado y
// cobrado): el flujo de venta de provincia es un bucle que nunca llega a "Fin",
// así que sin esto la IA vendedora seguiría atendiendo para siempre. Al cerrarlo,
// el siguiente mensaje del cliente lo toma el modo SOPORTE post-venta (que
// reenvía la clave/acceso, da el estado y maneja la recompra). No toca el flujo
// de pedido_estado (clave de recojo), que corre por separado.
export async function cerrarConversacionVenta(db: SupabaseClient, contactId: string) {
  try {
    await db.from("flow_runs").update({ estado: "cancelado" })
      .eq("contact_id", contactId).in("estado", ["activo", "esperando"]);
  } catch (e) { console.error("[cerrarConversacionVenta]", (e as any)?.message ?? e); }
}

// Esquema de la validación del comprobante de saldo (salida estructurada).
const SALDO_SCHEMA = {
  type: "object",
  properties: {
    es_pago: { type: "boolean", description: "true si la imagen es un comprobante de pago" },
    valido: { type: "boolean", description: "true si el pago es legítimo según las reglas del negocio" },
    monto: { type: ["number", "null"], description: "monto pagado (número), o null si no se lee" },
    operacion: { type: ["string", "null"], description: "número de operación/constancia, o null" },
    motivo: { type: "string", description: "explicación breve" },
  },
  required: ["es_pago", "valido", "motivo"],
  additionalProperties: false,
} as const;

// Comprobante del ADELANTO (provincia). Mismo patrón que el saldo, porque es
// la misma decisión: ¿la IA aprueba sola o te consulta?
//   · manual (default): el OCR igual lo analiza —te ahorra leerlo— pero NO
//     aprueba: guarda el comprobante y su veredicto en el pedido, te avisa por
//     Telegram y la tarjeta te espera en el Copiloto. Es lo que pidió Rodrigo:
//     "la IA me adjunta los datos y el comprobante para yo validarlo".
//   · auto: si el monto cuadra y no hay señales raras, lo valida y sigue.
// Devuelve true si "tomó" el mensaje (el flujo no debe seguir con él).
async function maybeAdelanto(db: SupabaseClient, channelId: string, contactId: string, event: EngineEvent): Promise<boolean> {
  const { data: order } = await db.from("orders")
    .select("id, estado, amount, currency, shipping")
    .eq("channel_id", channelId).eq("contact_id", contactId).eq("estado", "esperando_adelanto")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!order) return false;
  const ship = ((order as any).shipping ?? {}) as Record<string, any>;

  const { data: ch } = await db.from("channels").select("pedidos_config, ocr_config").eq("id", channelId).maybeSingle();
  const cfg = (ch as any)?.pedidos_config?.adelanto ?? {};
  const url = await ingestImage(db, channelId, contactId, event.mediaRef!).catch(() => null);
  if (!url) return false; // no se pudo leer → que lo maneje el flujo normal

  const esperado = Number(ship.adelanto);
  const runlike = { channel_id: channelId, contact_id: contactId } as any;

  // El OCR opina SIEMPRE (aunque decidas tú): así llegas a la tarjeta con el
  // trabajo de lectura hecho.
  let parsed: any = null;
  try {
    const { data: aiRows } = await db.rpc("get_channel_ai_active", { p_channel_id: channelId, p_provider: null });
    const ai = Array.isArray(aiRows) ? aiRows[0] : aiRows;
    if (ai?.api_key) {
      const sys = (buildOcrSystem((ch as any)?.ocr_config, Number.isFinite(esperado) ? esperado : null, (order as any).currency)
        ?? "Eres un validador experto de comprobantes de pago de Perú.") +
        "\n\nDevuelve SOLO un JSON con: es_pago, valido, monto, operacion, motivo.";
      const raw = await runAI({
        provider: ai.provider as Provider, apiKey: ai.api_key, model: ai.model || undefined, system: sys,
        content: [imageBlock(url), { type: "text", text: `El cliente debe pagar un ADELANTO de ${Number.isFinite(esperado) ? esperado : "?"} ${(order as any).currency ?? ""}. Analiza si este comprobante corresponde a ese pago.` }],
        maxTokens: 500, jsonSchema: SALDO_SCHEMA as unknown as Record<string, unknown>,
      });
      parsed = JSON.parse(raw);
    }
  } catch (_) { parsed = null; }

  // No es un comprobante (una foto cualquiera, una equivocación) → no
  // interceptamos: la IA sigue atendiendo normal.
  if (parsed && parsed.es_pago === false) return false;

  const monto = Number(parsed?.monto);
  const oper = parsed?.operacion ? String(parsed.operacion).trim() : null;
  let reuse = false;
  if (oper) {
    const { data: dup } = await db.from("orders").select("id")
      .eq("channel_id", channelId).eq("shipping->>adelanto_operacion", oper).limit(1).maybeSingle();
    reuse = !!dup;
  }
  const tol = Math.max(0, Number(cfg.tolerancia ?? 1));
  const montoOk = Number.isFinite(monto) && Number.isFinite(esperado) && esperado > 0 && monto >= (esperado - tol);
  const puedeAuto = cfg.validacion === "auto" && !!parsed?.valido && montoOk && !reuse;

  if (puedeAuto) {
    await db.from("orders").update({
      estado: "adelanto_validado", confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      shipping: { ...ship, adelanto_operacion: oper, adelanto_validado_auto: true, adelanto_comprobante: url },
    }).eq("id", (order as any).id);
    await logEvent(db, channelId, contactId, "nota", "Adelanto validado automáticamente", `Monto ${monto}${oper ? " · op " + oper : ""}`);
    await syncPedidoSheet(db, (order as any).id);
    // Si el producto ofrece la venta extra DESPUÉS del adelanto, se reanuda la
    // conversación hacia el ofrecimiento (que saluda "¡recibido!"). Si no aplica
    // (sin extras post, o el run ya no está esperando), cae al aviso normal.
    const ofrecio = await resumeIntoExtras(db, channelId, contactId).catch(() => false);
    if (!ofrecio) await triggerPedidoEstado(db, channelId, contactId, "adelanto_validado", true);
    await notifyAdmin(db, runlike, `✅ Adelanto validado automáticamente. Monto ${monto}${oper ? " · op " + oper : ""}.`, url);
    return true;
  }

  // Manual (o auto con dudas) → queda esperándote en el Copiloto, con la
  // opinión del OCR ya escrita. NO se aprueba nada a tus espaldas.
  const motivo = reuse ? "operación ya usada"
    : !montoOk ? `monto no coincide (pagó ${Number.isFinite(monto) ? monto : "?"}, adelanto ${Number.isFinite(esperado) ? esperado : "?"})`
    : (parsed?.valido ? "listo para tu aprobación" : (parsed?.motivo || "requiere revisión"));
  await db.from("orders").update({
    updated_at: new Date().toISOString(),
    shipping: {
      ...ship, adelanto_comprobante: url, adelanto_recibido_at: new Date().toISOString(),
      adelanto_revisar: motivo, adelanto_monto_leido: Number.isFinite(monto) ? monto : null,
      adelanto_operacion_leida: oper, adelanto_ok_ia: !!parsed?.valido && montoOk && !reuse,
    },
  }).eq("id", (order as any).id);
  await logEvent(db, channelId, contactId, "nota", "Adelanto por aprobar", motivo);
  // Con botón: se aprueba desde el celular sin abrir el panel. El toque lo
  // recibe telegram-webhook, que verifica que seas admin de este canal.
  await notifyAdmin(db, runlike,
    `💰 <b>Adelanto por validar</b>\n${motivo}\n` +
    `Monto leído: ${Number.isFinite(monto) ? monto : "?"} · esperado: ${Number.isFinite(esperado) ? esperado : "?"}`,
    url,
    [[{ text: "✅ Aprobar", data: `adel_ok:${(order as any).id}` }]]);
  await deliverMessage(db, channelId, contactId, "¡Gracias! Estoy verificando tu pago y en un momento te confirmo. 🙌").catch(() => {});
  return true;
}

// Validación AUTOMÁTICA del saldo remanente (modo auto del Agente de Logística).
// Devuelve true si "tomó" el mensaje (no debe seguir el flujo normal).
async function maybeAutoSaldo(db: SupabaseClient, channelId: string, contactId: string, event: EngineEvent): Promise<boolean> {
  // 1) ¿Pedido en agencia esperando el saldo?
  const { data: order } = await db.from("orders")
    .select("id, estado, amount, currency, shipping")
    .eq("channel_id", channelId).eq("contact_id", contactId).eq("estado", "en_agencia")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!order) return false;
  const ship = ((order as any).shipping ?? {}) as Record<string, any>;

  // 2) ¿Modo automático activado en IA · Pedidos?
  const { data: ch } = await db.from("channels").select("pedidos_config, ocr_config").eq("id", channelId).maybeSingle();
  const log = (ch as any)?.pedidos_config?.log ?? {};
  if (log.modo !== "auto") return false;

  // 3) Sube el comprobante a storage propio → URL pública (IA + Telegram).
  const url = await ingestImage(db, channelId, contactId, event.mediaRef!).catch(() => null);
  if (!url) return false; // no se pudo leer → que lo maneje el flujo normal

  const saldo = Number(ship.saldo);
  const clave = ship.clave_recojo;
  const tol = Math.max(0, Number(log.tolerancia ?? 0));
  const runlike = { channel_id: channelId, contact_id: contactId } as any;

  // 4) Valida con la IA (visión) usando el Validador del canal + salida JSON.
  const { data: aiRows } = await db.rpc("get_channel_ai_active", { p_channel_id: channelId, p_provider: null });
  const ai = Array.isArray(aiRows) ? aiRows[0] : aiRows;
  if (!ai?.api_key) return false; // sin IA → que lo tome un humano por el flujo normal
  const ocrSys = buildOcrSystem((ch as any)?.ocr_config, Number.isFinite(saldo) ? saldo : null, (order as any).currency)
    ?? "Eres un validador experto de comprobantes de pago de Perú.";
  const system = ocrSys +
    "\n\nDevuelve SOLO un JSON con los campos: es_pago, valido, monto, operacion, motivo. " +
    "`valido` es true solo si el pago es legítimo, va al destinatario correcto y no hay señales de fraude/montaje.";

  let parsed: any = null;
  try {
    const raw = await runAI({
      provider: ai.provider as Provider, apiKey: ai.api_key, model: ai.model || undefined,
      system,
      content: [imageBlock(url), { type: "text", text: `El cliente debe pagar un SALDO de ${Number.isFinite(saldo) ? saldo : "?"} ${(order as any).currency ?? ""}. Analiza si este comprobante corresponde a ese pago.` }],
      maxTokens: 500, jsonSchema: SALDO_SCHEMA as unknown as Record<string, unknown>,
    });
    parsed = JSON.parse(raw);
  } catch (_) { parsed = null; }

  // Si no es un pago (o no se pudo analizar), no interceptamos: sigue el flujo normal.
  if (!parsed || !parsed.es_pago) return false;

  const monto = Number(parsed.monto);
  const oper = parsed.operacion ? String(parsed.operacion).trim() : null;

  // 5) Anti-reúso: la misma operación no puede validar dos pedidos.
  let reuse = false;
  if (oper) {
    const { data: dup } = await db.from("orders").select("id")
      .eq("channel_id", channelId).eq("shipping->>saldo_operacion", oper).limit(1).maybeSingle();
    reuse = !!dup;
  }
  const montoOk = Number.isFinite(monto) && Number.isFinite(saldo) && saldo > 0 && monto >= (saldo - tol);
  const puedeAuto = !!parsed.valido && montoOk && !reuse && !!clave;

  if (puedeAuto) {
    // ✅ Todo cuadra → saldo_pagado (guarda la operación) + dispara la entrega de clave.
    await db.from("orders").update({
      estado: "saldo_pagado", confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      shipping: { ...ship, saldo_operacion: oper, saldo_validado_auto: true, saldo_comprobante: url },
    }).eq("id", (order as any).id);
    await logEvent(db, channelId, contactId, "nota", "Saldo validado automáticamente", `Monto ${monto}${oper ? " · op " + oper : ""}`);
    await syncPedidoSheet(db, (order as any).id);
    // Venta cerrada → cede el paso al soporte post-venta (la clave la manda el
    // flujo pedido_estado de la línea siguiente).
    await cerrarConversacionVenta(db, contactId);
    await triggerPedidoEstado(db, channelId, contactId, "saldo_pagado", true);
    // Pedido pagado del todo → recién ahora se entregan las ventas extra
    // digitales que viajaban en él (link/archivo).
    await entregarExtrasDigitales(db, channelId, contactId, (order as any).id);
    await notifyAdmin(db, runlike, `✅ Saldo validado automáticamente y clave de recojo enviada. Monto ${monto}${oper ? " · op " + oper : ""}.`, url);
    return true;
  }

  // ⚠️ Ante cualquier duda → al Copiloto + aviso por Telegram.
  const motivo = reuse ? "operación ya usada"
    : !montoOk ? `monto no coincide (pagó ${Number.isFinite(monto) ? monto : "?"}, saldo ${Number.isFinite(saldo) ? saldo : "?"})`
    : !clave ? "el pedido no tiene clave de recojo cargada"
    : (parsed.motivo || "requiere revisión manual");
  await db.from("orders").update({
    updated_at: new Date().toISOString(),
    shipping: { ...ship, saldo_comprobante: url, saldo_recibido_at: new Date().toISOString(), saldo_revisar: motivo },
  }).eq("id", (order as any).id);
  await logEvent(db, channelId, contactId, "nota", "Comprobante de saldo por aprobar", motivo);
  await notifyAdmin(db, runlike,
    `🕵️ <b>Saldo por revisar</b>\n${motivo}\nAl aprobar, el bot le manda la clave de recojo.`,
    url,
    clave ? [[{ text: "🔑 Aprobar y dar la clave", data: `saldo_ok:${(order as any).id}` }]] : undefined);
  await deliverMessage(db, channelId, contactId, "¡Gracias! Estoy verificando tu pago del saldo y en breve te confirmo. 🙌").catch(() => {});
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// MODO SOPORTE POST-VENTA
// Una vez que el cliente COMPRÓ, si vuelve a escribir sin un flujo activo, el
// bot lo atiende como CLIENTE (reenvía su acceso, le da el estado del pedido, lo
// ayuda a usarlo o con un cambio) en vez de re-venderle lo mismo desde cero. Si
// quiere COMPRAR de nuevo o más unidades, la IA lo marca con [[recompra]] y se
// relanza la venta (con un pedido nuevo). Sin esto, tras el nodo "Fin" el bot
// re-disparaba el flujo de venta (re-pitch) o se quedaba mudo.
// ═══════════════════════════════════════════════════════════════════
const COMPRADO_STATES = new Set([
  "confirmada", "confirmado", "adelanto_validado", "por_despachar", "despachado",
  "en_agencia", "saldo_pagado", "recogido", "en_reparto", "entregado_cobrado", "reprogramado",
]);
// Provincia en FULFILLMENT con el SALDO todavía pendiente: pagó el adelanto pero
// aún debe el saldo (y por eso no tiene su clave de recojo). Acá el bot NO está
// en "soporte post-venta" sino COBRANDO el saldo — no re-vende y JAMÁS da la clave.
const SALDO_PENDIENTE = new Set(["adelanto_validado", "por_despachar", "despachado", "en_agencia"]);

// Limpia los candados `una_vez` de venta/aviso para que una RECOMPRA cree un
// pedido nuevo (y su aviso), en vez de omitirlos por idempotencia del contacto.
async function limpiarCandadosVenta(db: SupabaseClient, contactId: string) {
  try {
    const { data } = await db.from("contact_field_values")
      .select("id, custom_fields!inner(key)").eq("contact_id", contactId);
    for (const r of (data ?? [])) {
      if (/^_once_(venta|aviso)_/.test(String((r as any).custom_fields?.key ?? ""))) {
        await db.from("contact_field_values").delete().eq("id", (r as any).id);
      }
    }
  } catch (e) { console.error("[limpiarCandadosVenta]", (e as any)?.message ?? e); }
}

// Resetea los datos del ITEM (talla, color, opción, "datos completos") para que
// la recompra los capture de cero — el par nuevo puede ser otra talla/color. La
// zona, la dirección y el nombre NO se tocan: reusarlos es lo bueno de un
// recomprador (menos fricción).
async function resetItemFields(db: SupabaseClient, channelId: string, contactId: string, productId: string) {
  try {
    const { data: p } = await db.from("products").select("config").eq("id", productId).maybeSingle();
    const attrs = normalizeAtributos((p as any)?.config?.atributos);
    const claves = [...attrs.map((a) => a.clave), "opcion_id", "opcion", "opcion_elegida", "datos_completos"];
    for (const k of claves) await setField(db, channelId, contactId, k, null);
  } catch (e) { console.error("[resetItemFields]", (e as any)?.message ?? e); }
}

// Relanza el flujo de venta del producto para una RECOMPRA (pedido nuevo).
// Limpia los candados una_vez para que el nuevo pedido/aviso no se omitan, y
// resetea los datos del item; marca el run con _recompra (saludo cálido).
async function relanzarVenta(db: SupabaseClient, channelId: string, contactId: string, productId: string | null): Promise<boolean> {
  if (!productId) return false;
  const { data: flow } = await db.from("flows")
    .select("id").eq("channel_id", channelId).eq("product_id", productId).eq("estado", "activo")
    .order("created_at").limit(1).maybeSingle();
  if (!flow) return false;
  await limpiarCandadosVenta(db, contactId);
  await resetItemFields(db, channelId, contactId, productId);
  const ok = await startFlowRun(db, channelId, contactId, (flow as any).id, { force: true, vars: { _recompra: true } });
  if (ok) await logEvent(db, channelId, contactId, "nota", "🔁 Recompra: se relanzó la venta").catch(() => {});
  return ok;
}

// El cliente escribe mientras su pago digital está POR VALIDAR (el run quedó
// parqueado esperando tu visto bueno). En vez de quedarse MUDO, el bot le
// responde en modo "verificando": lo acompaña y contesta lo que pueda, pero NO
// confirma el pago ni entrega nada (eso pasa recién cuando apruebas). Si no hay
// IA, manda un mensaje fijo. El run sigue parqueado (no se toca acá).
async function responderVerificando(db: SupabaseClient, run: Run, event: EngineEvent) {
  const fallback = "¡Sigo verificando tu pago! 🙌 Apenas lo confirme te llega tu acceso por aquí. Cualquier cosa, dime.";
  try {
    const ctx = await buildContext(db, run);
    ctx.last_input = event.text ?? "";
    const info = await channelIaInfo(db, run);
    const { data: aiRows } = await db.rpc("get_channel_ai_active", { p_channel_id: run.channel_id, p_provider: null });
    const ai = Array.isArray(aiRows) ? aiRows[0] : aiRows;
    if (!ai?.api_key) { await deliverMessage(db, run.channel_id, run.contact_id, fallback).catch(() => {}); return; }
    const parts: string[] = [];
    if (info.negocio) parts.push("## Sobre el negocio\n" + info.negocio);
    if (ctx.contexto_producto) parts.push(`## Sobre el producto${ctx.producto_nombre ? ` (${ctx.producto_nombre})` : ""}\n` + ctx.contexto_producto);
    parts.push(
      "## Estás VERIFICANDO su pago\n" +
      "El cliente ya envió su comprobante y su pago está siendo revisado por una persona del equipo. " +
      "Acompáñalo con calidez y contéstale lo que puedas, PERO:\n" +
      "- NO confirmes el pago ni digas que ya está validado.\n" +
      "- NO entregues el producto, el acceso ni el link todavía.\n" +
      "- Si pregunta cuánto falta, dile que lo estás verificando y que apenas se confirme le llega su acceso por aquí (no des un tiempo exacto).\n" +
      "- Si el problema es serio o insiste mucho, escribe `[[humano]]`."
    );
    const hist = await historial(db, run, 8);
    const content = `El cliente (con su pago en verificación) te escribe:\n"${event.text ?? ""}"` +
      (hist ? `\n\n## La conversación hasta ahora\n${hist}\n\nResponde SOLO a su último mensaje.` : "");
    const result = await runAI({ provider: ai.provider as Provider, apiKey: ai.api_key, model: ai.model || undefined, system: parts.join("\n\n"), content, maxTokens: 400 });
    await emitIaText(db, run, result || fallback, ctx);
  } catch (e) {
    console.error("[responderVerificando]", (e as any)?.message ?? e);
    await deliverMessage(db, run.channel_id, run.contact_id, fallback).catch(() => {});
  }
}

async function maybePostventa(db: SupabaseClient, channelId: string, contactId: string, event: EngineEvent): Promise<boolean> {
  // 1) ¿Es comprador? Su último pedido está en un estado de compra concretada.
  const { data: order } = await db.from("orders")
    .select("estado, product_id, product:product_id(nombre)")
    .eq("channel_id", channelId).eq("contact_id", contactId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!order || !COMPRADO_STATES.has(String((order as any).estado))) return false;

  // 2) Configurable: se puede apagar (pedidos_config.postventa.activo=false).
  const { data: ch } = await db.from("channels").select("pedidos_config").eq("id", channelId).maybeSingle();
  const pv = (ch as any)?.pedidos_config?.postventa ?? {};
  if (pv.activo === false) return false;
  const estado = String((order as any).estado);
  const esperandoSaldo = SALDO_PENDIENTE.has(estado);

  // 2b) Recompra CLARA (determinista): relanza la venta directo, sin gastar un
  // turno de IA. NO en la ventana de saldo pendiente: primero se cierra ese
  // pedido (no lo dejamos abrir otro debiendo el saldo del actual).
  if (!esperandoSaldo && pideRecompra(event.text ?? "")) {
    if (await relanzarVenta(db, channelId, contactId, (order as any).product_id)) {
      await logEvent(db, channelId, contactId, "nota", "🛎️ Soporte post-venta → recompra", (event.text ?? "").slice(0, 80)).catch(() => {});
      return true;
    }
  }

  // 3) Contexto (run virtual: no hay flujo activo, solo queremos el contexto del
  // contacto: producto, {{link_entrega}}, estado del pedido, conocimiento…).
  const run: any = { id: null, channel_id: channelId, contact_id: contactId, flow_id: null, current_node_id: null, vars: { last_input: event.text ?? "" } };
  const ctx = await buildContext(db, run);
  ctx.last_input = event.text ?? "";

  const info = await channelIaInfo(db, run);
  const { data: aiRows } = await db.rpc("get_channel_ai_active", { p_channel_id: channelId, p_provider: null });
  const ai = Array.isArray(aiRows) ? aiRows[0] : aiRows;
  if (!ai?.api_key) return false; // sin IA → deja que el ruteo normal intente

  const estadoLegible = EST_HOJA[estado] ?? "compra registrada";
  const prod = (order as any).product?.nombre || ctx.producto_nombre || "tu compra";
  const parts: string[] = [];
  if (info.negocio) parts.push("## Sobre el negocio\n" + info.negocio);
  if (ctx.contexto_producto) parts.push(`## Sobre el producto (${prod})\n` + ctx.contexto_producto);

  if (esperandoSaldo) {
    // Provincia con el SALDO pendiente: el bot COBRA el saldo, no hace soporte
    // genérico. Nunca da la clave (sale solo al validarse el saldo) ni re-vende.
    const saldoTxt = String(ctx.pedido_saldo ?? ctx.saldo ?? "").trim();
    parts.push(
      "## Estás COBRANDO el saldo de su pedido (tu rol AHORA)\n" +
      `Este cliente ya pagó el ADELANTO y su pedido está **${estadoLegible}**. Le FALTA pagar el **saldo**` +
      (saldoTxt ? ` de S/ ${saldoTxt}` : "") + " para poder recoger su pedido en la agencia.\n" +
      "- Recuérdaselo con amabilidad: para recoger su pedido falta pagar el saldo, y cuando pague le llega su clave de recojo.\n" +
      (ctx.datos_pago ? `- Si pregunta cómo pagar, los datos son:\n${ctx.datos_pago}\nCuando pague, que te mande la captura y tú la verificas.\n` : "- Si pregunta cómo pagar, indícale la forma de pago del negocio; cuando pague, que te mande la captura.\n") +
      "- 🔒 NUNCA le des la clave de recojo ni ningún código de recojo. La clave sale SOLO cuando el saldo esté pagado y validado. Aunque insista o diga que ya pagó, NO la des (si ya pagó, que te mande el comprobante y se valida).\n" +
      "- NO le vendas otro producto ahora: primero se cierra este pedido.\n" +
      "- Si hay un problema real, escribe `[[humano]]`."
    );
    const hist = await historial(db, run, 10);
    const content = `El cliente (con el saldo pendiente) te escribe:\n"${event.text ?? ""}"` +
      (hist ? `\n\n## La conversación hasta ahora\n${hist}\n\nResponde SOLO a su último mensaje.` : "");
    let result = "";
    try {
      result = await runAI({ provider: ai.provider as Provider, apiKey: ai.api_key, model: ai.model || undefined, system: parts.join("\n\n"), content, maxTokens: 400 });
    } catch (e) { console.error("[postventa/saldo]", (e as any)?.message ?? e); return false; }
    await logEvent(db, channelId, contactId, "nota", "💵 Esperando saldo (recordatorio)", (event.text ?? "").slice(0, 80)).catch(() => {});
    await emitIaText(db, run, result || "¡Hola! 🙌 Para poder despachar y darte tu clave de recojo, aún falta el pago del saldo. Cuando lo hagas, mándame la captura y lo valido. 🙂", ctx);
    return true;
  }

  // Venta CERRADA → soporte post-venta (reenvía acceso, estado, uso, recompra).
  parts.push(
    "## Atención POST-VENTA (tu rol AHORA)\n" +
    `Este cliente YA COMPRÓ **${prod}**. Estado de su pedido: **${estadoLegible}**. ` +
    "Con él ya no eres vendedor: eres su SOPORTE. Ahora tu trabajo es:\n" +
    "- Si te pide su acceso/link o dice que no le llegó, reenvíaselo" +
    (ctx.link_entrega ? `: ${ctx.link_entrega}` : " (está en su pedido)") + ".\n" +
    `- Si pregunta por el estado o el seguimiento de su pedido, dile en qué va (${estadoLegible}) con naturalidad.\n` +
    "- Si necesita ayuda para usar el producto, oriéntalo con lo que sabes de él.\n" +
    "- Si hay un problema real, un cambio o una devolución que no puedes resolver, escribe `[[humano]]`.\n" +
    "NO le ofrezcas comprar lo mismo otra vez como si no te conociera, ni le repitas el pitch de venta.\n" +
    "PERO si el cliente QUIERE COMPRAR de nuevo, más unidades u otro producto, con gusto: dile con calidez que se lo preparas y escribe el marcador `[[recompra]]` (el cliente NO lo ve). No lo trates como desconocido." +
    (pv.instrucciones && String(pv.instrucciones).trim() ? "\n\nIndicaciones del negocio para la post-venta:\n" + String(pv.instrucciones).trim() : "")
  );
  const system = parts.join("\n\n");

  const hist = await historial(db, run, 10);
  const content = `El cliente (ya comprador) te escribe:\n"${event.text ?? ""}"` +
    (hist ? `\n\n## La conversación hasta ahora\n${hist}\n\nResponde SOLO a su último mensaje.` : "");

  let result = "";
  try {
    result = await runAI({ provider: ai.provider as Provider, apiKey: ai.api_key, model: ai.model || undefined, system, content, maxTokens: 500 });
  } catch (e) { console.error("[postventa]", (e as any)?.message ?? e); return false; }

  await logEvent(db, channelId, contactId, "nota", "🛎️ Soporte post-venta", (event.text ?? "").slice(0, 80)).catch(() => {});

  // ¿Quiere recomprar? Se relanza la venta del MISMO producto (pedido nuevo). Se
  // limpian los candados una_vez para que el pedido/aviso no se omitan.
  if (/\[\[\s*recompra\s*\]\]/i.test(result)) {
    result = result.replace(/\[\[\s*recompra\s*\]\]/gi, "").trim();
    if (result) await emitIaText(db, run, result, ctx);
    await relanzarVenta(db, channelId, contactId, (order as any).product_id);
    return true; // aunque no haya flujo para relanzar, ya respondió
  }

  await emitIaText(db, run, result || "¡Hola! 🙂 ¿En qué te ayudo con tu compra?", ctx);
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// COPILOTO DE RESPUESTAS (botón IA del compositor)
// Sugiere al ASESOR HUMANO las 3 mejores respuestas para enviarle al cliente
// AHORA, con la personalidad del Vendedor IA, mirando TODA la conversación + el
// conocimiento del negocio/producto + el estado del pedido. Lo usa la Edge
// Function reply-suggest. No envía nada: solo devuelve texto para la barra.
// ═══════════════════════════════════════════════════════════════════
export async function sugerirRespuestas(db: SupabaseClient, channelId: string, contactId: string): Promise<string[]> {
  const run: any = { id: null, channel_id: channelId, contact_id: contactId, flow_id: null, current_node_id: null, vars: {} };
  const ctx = await buildContext(db, run);
  const info = await channelIaInfo(db, run);
  const { data: aiRows } = await db.rpc("get_channel_ai_active", { p_channel_id: channelId, p_provider: null });
  const ai = Array.isArray(aiRows) ? aiRows[0] : aiRows;
  if (!ai?.api_key) throw new Error("Este canal no tiene IA configurada (Ajustes → IA · Proveedores).");

  const prod = ctx.producto_nombre || "";
  const parts: string[] = [];
  if (info.negocio) parts.push("## Sobre el negocio (incluye tu personalidad, tono y emojis)\n" + info.negocio);
  if (ctx.contexto_producto) parts.push(`## Sobre el producto${prod ? ` (${prod})` : ""}\n` + ctx.contexto_producto);
  const pm = (info.ocr?.metodos ?? []).filter((m: any) => m && (m.app || m.numero || m.titular))
    .map((m: any) => "- " + [m.app, m.numero, m.titular ? `(${m.titular})` : ""].filter(Boolean).join(" "));
  if (pm.length) parts.push("## Formas de pago aceptadas\n" + pm.join("\n"));
  if (ctx.pedido_estado) {
    let p = "## Estado del pedido del cliente\n" + (EST_HOJA[String(ctx.pedido_estado)] ?? String(ctx.pedido_estado));
    if (ctx.pedido_saldo) p += `\nSaldo pendiente: S/ ${ctx.pedido_saldo}`;
    if (ctx.pedido_adelanto) p += `\nAdelanto: S/ ${ctx.pedido_adelanto}`;
    parts.push(p);
  }
  parts.push(
    "## Tu tarea\n" +
    "Un ASESOR HUMANO de este negocio está atendiendo el chat de WhatsApp de abajo y quiere ayuda para responderle al cliente. " +
    "Basándote en TODA la conversación, el conocimiento del negocio/producto y el estado del pedido, propón las 3 MEJORES respuestas que el asesor podría enviarle al cliente AHORA MISMO.\n" +
    "Reglas:\n" +
    "- Que suenen EXACTAMENTE como este negocio: mismo tono, estilo y emojis que usarías tú vendiendo.\n" +
    "- Cada una lista para ENVIAR tal cual: sin placeholders, sin marcadores, sin '[nombre]', sin '{{...}}'.\n" +
    "- Las 3 opciones deben ser ÚTILES y DISTINTAS entre sí para este momento (no 3 versiones de lo mismo).\n" +
    "- Naturales, humanas y directas. Ni muy largas ni robóticas.\n" +
    "- NUNCA inventes datos que no sabes (precios, claves de recojo, plazos). Si falta un dato, la respuesta puede pedírselo al cliente.\n" +
    "Responde SOLO en JSON: {\"sugerencias\":[\"...\",\"...\",\"...\"]}."
  );
  const system = parts.join("\n\n");
  const hist = await historial(db, run, 16);
  const content = hist
    ? `## La conversación hasta ahora\n${hist}\n\nGenera las 3 sugerencias para el asesor.`
    : "El cliente todavía no ha escrito nada en este chat. Sugiere 3 formas cálidas de iniciar o retomar la conversación.";

  const raw = await runAI({
    provider: ai.provider as Provider, apiKey: ai.api_key, model: ai.model || undefined,
    system, content, maxTokens: 700,
    jsonSchema: {
      type: "object",
      properties: { sugerencias: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 } },
      required: ["sugerencias"], additionalProperties: false,
    } as unknown as Record<string, unknown>,
  });
  let arr: string[] = [];
  try {
    const m = /\{[\s\S]*\}/.exec(raw);
    const parsed = m ? JSON.parse(m[0]) : {};
    arr = Array.isArray(parsed?.sugerencias) ? parsed.sugerencias.map((s: any) => String(s ?? "").trim()).filter(Boolean) : [];
  } catch (_) { arr = []; }
  return arr.slice(0, 3);
}

// ── Nodo IA (Claude/ChatGPT): generar texto, analizar imagen o extraer ─
// Conocimiento del canal (negocio + perfiles de IA + validador OCR), cacheado por run.
async function channelIaInfo(db: SupabaseClient, run: Run): Promise<{ negocio: string | null; perfiles: any; ocr: any; pedidos: any }> {
  let info = (run as any)._chIa;
  if (!info) {
    info = { negocio: null, perfiles: {}, ocr: null, pedidos: null };
    try {
      const { data: ch } = await db.from("channels")
        .select("negocio, ia_perfiles, ocr_config, pedidos_config").eq("id", run.channel_id).maybeSingle();
      info.negocio = (ch as any)?.negocio ?? null;
      info.perfiles = (ch as any)?.ia_perfiles ?? {};
      info.ocr = (ch as any)?.ocr_config ?? null;
      info.pedidos = (ch as any)?.pedidos_config ?? null;
    } catch (_) {
      // Reintento sin columnas nuevas por si faltan migraciones (0026/0027).
      try {
        const { data: ch } = await db.from("channels").select("negocio, ia_perfiles, ocr_config").eq("id", run.channel_id).maybeSingle();
        info.negocio = (ch as any)?.negocio ?? null;
        info.perfiles = (ch as any)?.ia_perfiles ?? {};
        info.ocr = (ch as any)?.ocr_config ?? null;
      } catch (_2) {
        try {
          const { data: ch } = await db.from("channels").select("negocio, ia_perfiles").eq("id", run.channel_id).maybeSingle();
          info.negocio = (ch as any)?.negocio ?? null;
          info.perfiles = (ch as any)?.ia_perfiles ?? {};
        } catch (_3) { /* migración 0023 pendiente */ }
      }
    }
    (run as any)._chIa = info;
  }
  return info;
}

// ── Agentes de pedidos físicos (IA · Pedidos) ──────────────────────
// Embudo de un contacto según el estado de su último pedido, para (a) gatear
// la IA por embudo y (b) inyectarle las instrucciones/mensajes correctos.
function funnelOf(estado: any): "mensajeria" | "confirmaciones" | "logistica" {
  const e = String(estado ?? "").toLowerCase();
  if (!e || e === "carrito") return "mensajeria";
  if (e === "esperando_adelanto" || e === "por_confirmar") return "confirmaciones";
  const log = ["confirmado", "adelanto_validado", "por_despachar", "despachado", "en_agencia",
    "saldo_pagado", "recogido", "en_reparto", "entregado_cobrado", "reprogramado", "rechazado",
    "no_recogido", "cancelado", "por_registrar", "por_enviar", "enviado", "despachar"];
  if (log.includes(e)) return "logistica";
  return "mensajeria";
}
// ¿El pedido va por agencia (provincia) o contraentrega (Lima)?
// Antes se DEDUCÍA del estado, y eso tenía un hueco real: los dos estados del
// embudo "confirmaciones" (esperando_adelanto, por_confirmar) devolvían
// siempre agencia, así que la rama de contraentrega de IA·Pedidos (msg_cod /
// instr_cod / "enviar fecha") no se activaba NUNCA.
// Ahora manda la zona REAL del pedido (shipping.zona, que escribe
// resolver_zona/crear_pedido) y el estado queda solo como respaldo para pedidos
// viejos que no la tengan.
function esAgencia(estado: any, zona?: any): boolean {
  const z = String(zona ?? "").toLowerCase();
  if (z === "lima") return false;
  if (z === "provincia") return true;
  const cod = ["confirmado", "en_reparto", "entregado_cobrado", "reprogramado", "rechazado"];
  return !cod.includes(String(estado ?? "").toLowerCase());
}
// Instrucciones + mensajes del embudo (config de IA · Pedidos) para el system.
function buildPedidosSystem(pedidos: any, funnel: string, agencia: boolean): string | null {
  if (!pedidos) return null;
  const L: string[] = [];
  if (funnel === "confirmaciones") {
    const c = pedidos.conf ?? {};
    const instr = agencia ? c.instr_ag : c.instr_cod;
    if (instr && String(instr).trim()) L.push("## Cómo confirmar este pedido\n" + String(instr).trim());
    if (agencia && c.msg_ag_pago && String(c.msg_ag_pago).trim()) L.push("## Mensaje para presentar los métodos de pago\nCuando el cliente vaya a pagar, envíale este mensaje:\n" + String(c.msg_ag_pago).trim());
    const msg = agencia ? c.msg_ag : c.msg_cod;
    if (msg && String(msg).trim()) L.push("## Mensaje al confirmar el pedido\nCuando el pedido quede confirmado, envía:\n" + String(msg).trim());
    if (!agencia && c.fecha) L.push("Al confirmar, informa también la fecha estimada de envío.");
  } else if (funnel === "logistica") {
    const g = pedidos.log ?? {};
    const instr = agencia ? g.instr_ag : g.instr_cod;
    if (instr && String(instr).trim()) L.push("## Seguimiento logístico de este pedido\n" + String(instr).trim());
    if (agencia && g.modo === "auto") L.push("Si el cliente envía el comprobante del saldo y el monto coincide con lo pendiente, entrega la clave de recojo. Si no coincide o hay cualquier duda, NO la entregues y avisa que un asesor revisará.");
    else if (agencia) L.push("No entregues la clave de recojo por tu cuenta: avisa que un asesor validará el pago del saldo y te la hará llegar.");
  }
  return L.length ? L.join("\n\n") : null;
}

// ═══════════════════════════════════════════════════════════════════
// OPCIONES DE COMPRA
// Una opción = algo comprable: nombre, precio y qué entrega. Unifica lo que
// antes eran tres conceptos distintos ("versiones" Básico/Premium, "packs" y
// "ofertas por cantidad"): para el sistema los tres tienen la misma forma, así
// que se configuran, se detectan, se cobran y se entregan igual. Viven en
// product_versions (ver migración 0029). Todo producto tiene al menos una.
// ═══════════════════════════════════════════════════════════════════
type Opcion = {
  id: string;
  nombre: string;
  precio: number | null;
  entrega: any[];
  descripcion: string | null;
  cantidad: number;
};

async function loadOpciones(db: SupabaseClient, run: Run, productId: string): Promise<Opcion[]> {
  const cache = (run as any)._opciones;
  if (cache && cache._pid === productId) return cache.list;
  let list: Opcion[] = [];
  try {
    const { data } = await db.from("product_versions")
      .select("id, nombre, precio, entrega, descripcion, cantidad")
      .eq("product_id", productId).eq("activo", true).order("orden");
    list = (data ?? []) as Opcion[];
  } catch (_) { /* columnas pendientes (0029) → sin opciones */ }
  (run as any)._opciones = { _pid: productId, list };
  return list;
}

// La opción elegida es un valor VIVO: se sobrescribe cada vez que el cliente
// cambia de opinión, y solo el PAGO la vuelve definitiva. Si el producto tiene
// una sola opción no hay nada que elegir (caso simple: no molesta al usuario).
async function opcionElegida(db: SupabaseClient, run: Run, ctx: any): Promise<Opcion | null> {
  const prodId = ctx._product_id;
  if (!prodId) return null;
  const list = await loadOpciones(db, run, prodId);
  if (!list.length) return null;
  const id = ctx.opcion_id ?? run.vars?.opcion_id;
  if (id) {
    const hit = list.find((o) => o.id === id);
    if (hit) return hit;
  }
  return list.length === 1 ? list[0] : null;
}

// Oferta de remarketing vigente para ESTE contacto. Clave del diseño: la oferta
// NOMBRA la opción ({opcion_id, precio, vence}), no es "un número más bajo" —
// así, aunque un descuento haga que dos opciones cuesten lo mismo, el monto
// pagado nunca es ambiguo (se resuelve por la oferta que recibió el cliente).
// OJO: buildContext corre DENTRO del bucle de nodos (hasta MAX_STEPS por
// mensaje), así que esto se cachea por run — si no, serían decenas de consultas
// extra por cada mensaje. Mismo patrón que _prodCtx / _botFields.
async function ofertaActiva(db: SupabaseClient, run: Run): Promise<any | null> {
  const cache = (run as any)._oferta;
  if (cache !== undefined) return cache;
  let out: any = null;
  try {
    const { data: c } = await db.from("contacts")
      .select("oferta_activa").eq("id", run.contact_id).maybeSingle();
    const o = (c as any)?.oferta_activa;
    if (o && o.opcion_id && o.precio != null &&
        !(o.vence && new Date(o.vence).getTime() < Date.now())) { // no caducada
      out = o;
    }
  } catch (_) { /* columna pendiente (0030) */ }
  (run as any)._oferta = out;
  return out;
}

// Precio que ESTE cliente debe pagar AHORA = opción elegida + oferta activa.
// No es un precio de lista global: es un valor vivo por contacto. Es lo que
// valida el OCR, así que nunca se adivina.
async function precioEsperado(
  db: SupabaseClient, run: Run, ctx: any,
): Promise<{ monto: number | null; opcion: Opcion | null; oferta: any | null }> {
  const opcion = await opcionElegida(db, run, ctx);
  const oferta = await ofertaActiva(db, run);
  if (oferta && opcion && oferta.opcion_id === opcion.id && Number.isFinite(Number(oferta.precio))) {
    return { monto: Number(oferta.precio), opcion, oferta };
  }
  if (opcion?.precio != null && Number.isFinite(Number(opcion.precio))) {
    return { monto: Number(opcion.precio), opcion, oferta };
  }
  const legacy = Number(ctx.precio); // productos viejos: precio suelto en config
  return { monto: Number.isFinite(legacy) ? legacy : null, opcion, oferta };
}

// ═══════════════════════════════════════════════════════════════════
// ZONAS DE ENTREGA (reglas DURAS, por código)
// Reparto de trabajo: la IA interpreta QUÉ LUGAR dijo el cliente (eso es
// lenguaje, su trabajo); el CÓDIGO decide si lo cubrimos, si llega hoy y si ya
// pasó la hora de corte (eso es plata y tiempo, no se negocia). Un toggle del
// usuario tiene que ser una REGLA, no una sugerencia que un modelo puede
// ignorar o dejarse convencer de saltarse. Además la IA literalmente no sabe
// qué hora es ni compara horas de forma confiable.
// La lista es la de entrega REAL del negocio, no el mapa político: los clientes
// dicen "Huaycán" o "Chosica", no "Ate" ni "Lurigancho" (ver migración 0032).
// ═══════════════════════════════════════════════════════════════════
type Zona = { nombre: string; grupo: string; cubro: boolean; mismo_dia: boolean; alias?: string[] };

async function loadEntregas(db: SupabaseClient, run: Run): Promise<any | null> {
  const cache = (run as any)._entregas;
  if (cache !== undefined) return cache;
  let out: any = null;
  try {
    const { data } = await db.from("channels").select("entregas, timezone").eq("id", run.channel_id).maybeSingle();
    out = data ?? null;
  } catch (_) { /* columna pendiente (0032) */ }
  (run as any)._entregas = out;
  return out;
}

const limpiaZona = (s: string) => normalize(s).replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

// "Lima" a secas = la ciudad, no un distrito. El cliente que dice "soy de Lima"
// SÍ es zona Lima (contraentrega), pero todavía no sabemos su distrito. Esto lo
// distingue de nombrar un lugar específico fuera de la lista (→ provincia).
const LIMA_GENERICA = new Set([
  "lima", "lima metropolitana", "lima ciudad", "ciudad de lima", "lima peru",
  "capital", "la capital", "lima capital", "lima lima", "lima cercado", "cercado de lima",
]);
function esLimaGenerica(s: string): boolean {
  const n = limpiaZona(s);
  return LIMA_GENERICA.has(n);
}

// Busca el lugar mencionado contra la lista del negocio. Determinista y gratis:
// la mayoría de los clientes nombran el distrito tal cual ("soy de SJL").
function matchZona(zonas: Zona[], texto: string): Zona | null {
  const t = " " + limpiaZona(texto) + " ";
  if (t.trim().length < 3) return null;
  // Candidatos (nombre + alias) ordenados de más largo a más corto: "SANTA
  // MARIA DEL MAR" tiene que ganarle a "SANTA MARIA", y "SAN JUAN DE
  // LURIGANCHO" a cualquier "SAN JUAN" suelto.
  const cands: { z: Zona; s: string }[] = [];
  for (const z of zonas) {
    cands.push({ z, s: limpiaZona(z.nombre) });
    for (const a of (z.alias ?? [])) cands.push({ z, s: limpiaZona(a) });
  }
  cands.sort((a, b) => b.s.length - a.s.length);
  for (const c of cands) if (c.s && t.includes(" " + c.s + " ")) return c.z;
  return null;
}

// La IA extrae el lugar de una frase libre ("mándalo por el óvalo de Santa
// Anita pues"). Solo se usa si el match determinista no encontró nada.
async function extraerLugar(db: SupabaseClient, channelId: string, texto: string): Promise<string | null> {
  try {
    const { data: aiRows } = await db.rpc("get_channel_ai_active", { p_channel_id: channelId, p_provider: null });
    const ai = Array.isArray(aiRows) ? aiRows[0] : aiRows;
    if (!ai?.api_key) return null; // sin IA → solo match determinista
    const raw = await runAI({
      provider: ai.provider as Provider, apiKey: ai.api_key, model: ai.model || undefined,
      system: "Extraes lugares del Perú de mensajes de clientes. Responde SOLO con un JSON, sin explicaciones.",
      content: `Mensaje del cliente:\n"${texto}"\n\n¿A qué distrito, ciudad o localidad del Perú se refiere para su entrega? ` +
        `Si solo menciona la ciudad de Lima de forma genérica (ej. "soy de Lima", "acá en la capital", "en Lima nomás") sin nombrar un distrito, responde exactamente "Lima". ` +
        `Responde exactamente: {"lugar":"<nombre del lugar, o vacío si no menciona ninguno>"}`,
      maxTokens: 80,
    });
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) return null;
    const lugar = String(JSON.parse(m[0])?.lugar ?? "").trim();
    return lugar || null;
  } catch (e) {
    console.error("[extraerLugar]", (e as any)?.message ?? e);
    return null;
  }
}

// Fecha/hora ACTUAL en la zona horaria del negocio, ya descompuesta.
function ahoraEnTz(tz: string): { hhmm: string; dia: string; iso: string } {
  const now = new Date();
  const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now).toLowerCase();
  const map: Record<string, string> = { mon: "lun", tue: "mar", wed: "mie", thu: "jue", fri: "vie", sat: "sab", sun: "dom" };
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return { hhmm, dia: map[wd] ?? "lun", iso };
}

// ¿Se puede entregar HOY en esta zona? Todo calculado, nada opinado.
function entregaHoy(cfg: any, zona: Zona): { hoy: boolean; motivo: string } {
  const e = cfg?.entregas ?? {};
  const tz = cfg?.timezone || "America/Lima";
  const { hhmm, dia, iso } = ahoraEnTz(tz);
  if (!zona.mismo_dia) return { hoy: false, motivo: "esta zona no tiene entrega el mismo día" };
  if (dia === "dom" && e.domingos !== true) return { hoy: false, motivo: "los domingos no hay reparto" };
  if (dia !== "dom" && e.dias && e.dias[dia] === false) return { hoy: false, motivo: "hoy no hay reparto" };
  if (e.feriados !== true && Array.isArray(e.feriados_fechas) && e.feriados_fechas.includes(iso)) {
    return { hoy: false, motivo: "hoy es feriado" };
  }
  const corte = String(e.corte ?? "");
  if (corte && hhmm > corte) return { hoy: false, motivo: `ya pasó la hora de corte de hoy (${corte})` };
  return { hoy: true, motivo: "" };
}

// Acción resolver_zona: { texto?, guardar_en? } — lee lo que dijo el cliente,
// resuelve la zona contra la config del negocio y deja el veredicto en campos
// para que el flujo ramifique y la IA solo lo comunique.
//   {{zona_entrega}}  lima | provincia
//   {{zona_nombre}}   el nombre de la zona reconocida
//   {{entrega_hoy}}   si | no
//   {{entrega_motivo}} por qué no llega hoy (para que la IA lo explique bien)
async function resolverZonaAccion(db: SupabaseClient, run: Run, a: any, ctx: any) {
  // La zona NO se re-evalúa una vez CONFIRMADA. Se corre en cada mensaje, así
  // que después de "soy de Trujillo" el cliente dice "la sede de Av. España" y
  // el detector tomaba esa CALLE como su ciudad: Trujillo se perdía y el pedido
  // salía con la agencia mal. EXCEPCIÓN: si el cliente dijo solo "Lima" sin
  // distrito (`zona_distrito_incierto`), seguimos afinando hasta que lo nombre.
  // Si de verdad se equivocó de zona ya confirmada, lo corrige un humano.
  if (!a?.forzar && String(ctx.zona_entrega ?? "").trim() && ctx.zona_distrito_incierto !== "si") return;

  const texto = a?.texto ? resolve(String(a.texto), ctx) : String(ctx.last_input ?? "");
  const cfg = await loadEntregas(db, run);
  const zonas: Zona[] = cfg?.entregas?.zonas ?? [];
  if (!zonas.length) return; // sin configuración → no tocar nada

  const set = async (k: string, v: string) => {
    run.vars[k] = v;
    ctx[k] = v; // el mismo turno ya lo ve (la IA redacta con el veredicto puesto)
    await setField(db, run.channel_id, run.contact_id, k, v);
  };

  // 1) Match DETERMINISTA contra la lista de distritos del negocio (lo mejor:
  // gratis y sin ambigüedad). La mayoría nombra el distrito tal cual ("soy de SJL").
  let z = matchZona(zonas, texto);
  let lugar: string | null = z ? z.nombre : null;
  // 2) Sin match directo: la IA extrae el lugar del texto libre, y reintentamos
  // el match determinista sobre ese lugar (puede venir deletreado distinto).
  if (!z) {
    const ext = await extraerLugar(db, run.channel_id, texto);
    if (ext) { lugar = ext; z = matchZona(zonas, ext); if (z) lugar = z.nombre; }
  }
  // Si no mencionó NINGÚN lugar, no se toca nada. Antes cualquier mensaje sin
  // lugar ("hola") lo marcaba como provincia, y la IA le hablaba de agencias a
  // alguien que todavía no había dicho de dónde era.
  if (!lugar) return;

  // 3a) Calzó un DISTRITO de la lista → veredicto determinista y CONFIRMADO.
  // La lista manda: un distrito destildado (cubro=false) es provincia.
  if (z) {
    const esLima = z.cubro !== false;
    await set("zona_entrega", esLima ? "lima" : "provincia");
    await set("zona_nombre", z.nombre);
    await set("ciudad", z.nombre);
    await set("zona_distrito_incierto", ""); // distrito ya conocido → deja de afinar
    if (esLima) {
      const { hoy, motivo } = entregaHoy(cfg, z);
      await set("entrega_hoy", hoy ? "si" : "no");
      await set("entrega_motivo", motivo);
    } else {
      await set("entrega_hoy", "no");
      await set("entrega_motivo", "no cubrimos esa zona con reparto propio");
    }
    await logEvent(db, run.channel_id, run.contact_id, "campo", "Zona resuelta",
      `${z.nombre} → ${esLima ? "lima" : "provincia"}${esLima ? ` · hoy: ${run.vars.entrega_hoy}` : ""}`);
    return;
  }

  // 3b) No calzó distrito, pero el cliente nombró "Lima" a secas (la ciudad).
  // Es zona Lima (CONTRAENTREGA), pero falta el distrito para despachar y para
  // saber si llega hoy → lo dejamos ABIERTO y la IA le pregunta el distrito. Sin
  // esto, "soy de Lima" caía a provincia y se le ofrecía agencia + adelanto (mal).
  if (esLimaGenerica(lugar)) {
    await set("zona_entrega", "lima");
    await set("zona_nombre", "Lima");
    await set("ciudad", "Lima");
    await set("zona_distrito_incierto", "si");
    await set("entrega_hoy", "");   // sin distrito no se puede prometer el mismo día
    await set("entrega_motivo", "");
    await logEvent(db, run.channel_id, run.contact_id, "campo", "Zona resuelta", "Lima (distrito por confirmar)");
    return;
  }

  // 3c) Nombró un lugar específico que NO está en la lista → Provincia (agencia).
  // La lista del negocio es la fuente de verdad de la cobertura propia.
  await set("zona_entrega", "provincia");
  await set("zona_nombre", "");
  await set("ciudad", lugar);
  await set("zona_distrito_incierto", "");
  await set("entrega_hoy", "no");
  await set("entrega_motivo", "no cubrimos esa zona con reparto propio");
  await logEvent(db, run.channel_id, run.contact_id, "campo", "Zona resuelta", `${lugar} → provincia`);
}

// ═══════════════════════════════════════════════════════════════════
// EXTRACTOR DE DATOS CONVERSACIONAL
// La IA vende Y recolecta al mismo tiempo: después de cada mensaje pesca los
// datos que aparezcan, sin interrogar ni re-preguntar lo que el cliente ya
// dijo. Reemplaza la cadena de nodos `pregunta` (que es un formulario disfrazado
// de chat).
//
// Principio acordado con Rodrigo: se pide UNA vez, se acepta lo que venga, y lo
// dudoso se marca para que un humano lo vea. NUNCA se traba una venta por
// calidad de dato — salvo que sin ese dato la operación se rompa de verdad.
// Ejemplo real: una dirección vaga NO bloquea, porque el motorizado igual se la
// vuelve a pedir el día de la entrega; un DNI mal SÍ bloquea, porque la agencia
// no entrega el paquete.
// ═══════════════════════════════════════════════════════════════════
type CampoDato = {
  clave: string;
  label: string;
  detalle?: string;
  requerido?: boolean;
  validar?: "dni" | "sede";
  // Un dato puede hacer falta solo en un camino: el DNI lo pide la agencia
  // (provincia), pero para un envío en Lima con contraentrega no sirve de nada
  // y pedirlo sería fricción gratis.
  solo_si_zona?: "lima" | "provincia";
};

// Palabras que no identifican NINGUNA oficina en particular. Si al sacarlas la
// sede queda vacía o queda solo la ciudad, el cliente todavía no dijo cuál es.
const RUIDO_SEDE = /\b(shalom|olva|agencia|agencias|sede|oficina|sucursal|terminal|de|del|la|el|los|las|en|a|por|mi|su)\b/g;

// Validaciones DURAS, por código. Contar dígitos es exactamente lo que un LLM
// hace mal, así que no se lo preguntamos: lo verificamos.
function validarDato(v: CampoDato, valor: string, ctx?: any): { ok: boolean; motivo?: string } {
  const s = String(valor ?? "").trim();
  if (!s) return { ok: false, motivo: "vacío" };
  if (v.validar === "dni") {
    const d = s.replace(/\D/g, "");
    if (d.length !== 8) return { ok: false, motivo: `el DNI debe tener 8 dígitos (mandó ${d.length})` };
    return { ok: true };
  }
  // La sede NO puede ser la ciudad. El modelo lo hace igual aunque el detalle del
  // campo se lo prohíba con todas las letras ("la oficina EXACTA…, NO la ciudad"):
  // ante "soy de Trujillo" devuelve sede="trujillo", porque es el único lugar que
  // ve. Y como después no se pisa lo ya capturado, la sede de verdad ("Av.
  // España") se perdía y el pedido quedaba imposible de despachar —Shalom Trujillo
  // tiene varias oficinas—. Ya se intentó arreglar por prompt y volvió a pasar,
  // así que se verifica por código, igual que el DNI.
  if (v.validar === "sede") {
    const limpio = limpiaZona(s).replace(RUIDO_SEDE, " ").replace(/\s+/g, " ").trim();
    if (!limpio) return { ok: false, motivo: "no dijo qué oficina es" };
    const ciudad = limpiaZona(String(ctx?.ciudad ?? ""));
    if (ciudad && limpio === ciudad) {
      return { ok: false, motivo: `"${s}" es la ciudad, no la oficina — falta la sede exacta (ej. «Av. España»)` };
    }
  }
  return { ok: true };
}

// Heurísticas de "dato dudoso": se ACEPTA igual, solo se marca. No se le
// pregunta al modelo si el dato "está bien" — eso lo decide el operador.
function datoDudoso(clave: string, valor: string): string | null {
  const s = String(valor ?? "").trim();
  if (clave === "direccion") {
    const tieneNumero = /\d/.test(s);
    if (s.length < 12 || !tieneNumero) return "dirección imprecisa (sin calle o número)";
  }
  if (clave === "nombre") {
    if (s.split(/\s+/).filter(Boolean).length < 2) return "falta el apellido";
  }
  return null;
}

async function extraerDatos(db: SupabaseClient, run: Run, cfg: any, ctx: any): Promise<void> {
  const todos: CampoDato[] = Array.isArray(cfg.campos) ? cfg.campos : [];
  // Los datos que aplican dependen del camino: mientras no sepamos la zona, se
  // piden solo los comunes (no vamos a pedirle el DNI a alguien de Lima).
  const campos = todos.filter((c) => !c.solo_si_zona || c.solo_si_zona === ctx.zona_entrega);
  const texto = String(ctx.last_input ?? "");
  if (!campos.length || !texto) return;

  // Solo se le pregunta a la IA por lo que TODAVÍA no tenemos: más barato y
  // evita que "re-extraiga" y pise un dato bueno con uno peor.
  const faltan = campos.filter((c) => !String(ctx[c.clave] ?? "").trim());
  if (faltan.length) {
    try {
      const { data: aiRows } = await db.rpc("get_channel_ai_active", { p_channel_id: run.channel_id, p_provider: null });
      const ai = Array.isArray(aiRows) ? aiRows[0] : aiRows;
      if (ai?.api_key) {
        const lista = faltan.map((c) => `- "${c.clave}": ${c.label}${c.detalle ? ` (${c.detalle})` : ""}`).join("\n");
        const raw = await runAI({
          provider: ai.provider as Provider, apiKey: ai.api_key, model: ai.model || undefined,
          // Dos reglas aprendidas probando con el modelo real:
          // 1) Si NO le decimos que copie tal cual, "corrige" solo: un DNI de 7
          //    dígitos lo omitía en silencio, y entonces nuestra validación por
          //    código nunca corría y la IA no podía decir "te faltó un dígito".
          // 2) Si no le decimos que lo impreciso TAMBIÉN es dirección, mandaba
          //    "por el mercado de Santa Anita" a referencia y la dirección
          //    quedaba vacía → nunca se marcaba la duda y la re-preguntaba.
          system: "Extraes datos de mensajes de clientes peruanos para un pedido. Respondes SOLO con un JSON, sin explicaciones.\n" +
            "REGLAS:\n" +
            "- Si un dato NO aparece en el mensaje, omítelo: jamás lo inventes ni lo deduzcas.\n" +
            "- Copia el valor TAL COMO lo dijo el cliente, aunque te parezca incompleto, mal escrito o inválido. " +
            "Validar NO es tu trabajo: de eso se encarga el sistema. Nunca omitas un dato por creer que está mal.\n" +
            "- Si el cliente indica dónde entregar aunque sea de forma vaga (\"por el mercado X\", \"a la espalda del colegio\"), " +
            "eso ES la dirección: ponlo en el campo de dirección igual. La referencia es información EXTRA, no un reemplazo.",
          content: `Mensaje del cliente:\n"${texto}"\n\nDatos a buscar:\n${lista}\n\n` +
            `Devuelve solo los que estén PRESENTES en el mensaje:\n{${faltan.map((c) => `"${c.clave}":"..."`).join(",")}}`,
          maxTokens: 250,
        });
        const m = /\{[\s\S]*\}/.exec(raw);
        const parsed = m ? JSON.parse(m[0]) : {};
        for (const c of faltan) {
          const val = String(parsed?.[c.clave] ?? "").trim();
          if (!val) continue;
          const v = validarDato(c, val, ctx);
          if (!v.ok) {
            // Dato inválido de verdad (ej. DNI de 7 dígitos): NO se guarda, y se
            // le dice a la IA qué pedirle exactamente.
            run.vars["_error_" + c.clave] = v.motivo ?? "";
            ctx["_error_" + c.clave] = v.motivo ?? "";
            continue;
          }
          run.vars[c.clave] = val;
          ctx[c.clave] = val;
          await setField(db, run.channel_id, run.contact_id, c.clave, val);
          const duda = datoDudoso(c.clave, val);
          if (duda) {
            await setField(db, run.channel_id, run.contact_id, "_duda_" + c.clave, duda);
            await logEvent(db, run.channel_id, run.contact_id, "nota", "⚠️ " + duda, `${c.clave}: ${val}`);
          } else {
            await logEvent(db, run.channel_id, run.contact_id, "campo", "Dato capturado", `${c.clave}: ${val}`);
          }
        }
      }
    } catch (e) { console.error("[extraerDatos]", (e as any)?.message ?? e); }
  }

  // Lo que sigue faltando, para que la IA sepa qué pedir (y el flujo sepa si ya
  // puede crear el pedido). Se recalcula DESPUÉS de extraer.
  const pendientes = campos.filter((c) => c.requerido !== false && !String(ctx[c.clave] ?? "").trim());
  ctx._datos_faltan = pendientes;
  const completo = pendientes.length === 0;
  run.vars.datos_completos = completo ? "si" : "no";
  ctx.datos_completos = completo ? "si" : "no";
  await setField(db, run.channel_id, run.contact_id, "datos_completos", completo ? "si" : "no");
}

// ═══════════════════════════════════════════════════════════════════
// CLASIFICADOR DE TEXTO LIBRE (pieza reusable)
// El cliente rara vez toca los botones: escribe a su manera ("el completo",
// "el de 149", "mándalo a Huaycán"). Esta función lee lo que escribió y decide
// a cuál de TUS candidatos se refiere. Se reusa para: opción de compra, zona de
// entrega, y cualquier elección futura.
//
// Reglas del diseño:
//   · preguntar ≠ elegir  → si solo pide info, no fija nada (intencion).
//   · nada se bloquea hasta el pago → el valor siempre se puede sobrescribir.
//   · confianza baja → quien llama debe CONFIRMAR con una pregunta, jamás
//     adivinar cuando hay dinero de por medio.
//   · el botón sigue sirviendo como atajo, pero nunca es una dependencia.
// ═══════════════════════════════════════════════════════════════════
type Clasificacion = {
  intencion: "preguntando" | "comparando" | "eligiendo" | "cambiando" | "ninguna";
  clave: string | null;
  confianza: number;
};

async function classify(
  db: SupabaseClient, channelId: string,
  opts: {
    texto: string;
    candidatos: { clave: string; label: string; detalle?: string | null }[];
    que: string;      // qué se está eligiendo, en español ("la opción de compra")
    perfil?: string;  // perfil de IA a usar (default: extraccion)
    // "eleccion" (default): distingue ELEGIR de preguntar — una consulta NO fija
    //   nada (no damos por vendida una opción porque preguntaron el precio).
    // "intencion": clasificación directa — devuelve la que mejor calza
    //   (ej. "¿aceptó la venta extra?" → acepta / rechaza / duda).
    modo?: "eleccion" | "intencion";
  },
): Promise<Clasificacion | null> {
  const clean = (opts.texto ?? "").trim();
  if (clean.length < 2 || !opts.candidatos.length) return null;
  try {
    const { data: ch } = await db.from("channels").select("ia_perfiles").eq("id", channelId).maybeSingle();
    const perfiles = (ch as any)?.ia_perfiles ?? {};
    const perfil = perfiles?.[opts.perfil || "extraccion"] ?? null;
    const wantProvider = perfil?.proveedor && perfil.proveedor !== "auto" ? perfil.proveedor : null;
    const { data: aiRows } = await db.rpc("get_channel_ai_active", { p_channel_id: channelId, p_provider: wantProvider });
    const ai = Array.isArray(aiRows) ? aiRows[0] : aiRows;
    if (!ai?.api_key) return null; // sin IA → degrada en silencio (no rompe el flujo)
    const model = (perfil?.proveedor === ai.provider ? perfil?.modelo : null) || ai.model || undefined;

    const lista = opts.candidatos
      .map((c, i) => `[${i + 1}] ${c.label}${c.detalle ? `: ${String(c.detalle).slice(0, 200)}` : ""}`)
      .join("\n");
    const modo = opts.modo ?? "eleccion";
    const system =
      "Eres un clasificador para un chatbot de ventas peruano. " +
      (modo === "eleccion"
        ? "Distingues con precisión cuándo un cliente ESTÁ ELIGIENDO algo y cuándo solo ESTÁ PREGUNTANDO o COMPARANDO. "
        : "Interpretas la respuesta del cliente y la clasificas en una de las opciones dadas. ") +
      "Responde ÚNICAMENTE con un objeto JSON, sin texto adicional.";
    const prompt = modo === "eleccion"
      ? `Mensaje del cliente:\n"${clean}"\n\nOpciones de ${opts.que}:\n${lista}\n\n` +
        `Determina:\n` +
        `- "intencion": "eligiendo" si decide/confirma una; "cambiando" si ya había elegido y ahora quiere otra; ` +
        `"preguntando" si solo pide información; "comparando" si contrasta varias o negocia; "ninguna" si no viene al caso.\n` +
        `- "idx": el número de la opción a la que se refiere, o 0 si ninguna/no está eligiendo.\n` +
        `- "confianza": 0.0 a 1.0.\n\n` +
        `IMPORTANTE: preguntar por una opción NO es elegirla. Si el cliente solo pide detalles o compara, ` +
        `usa "preguntando"/"comparando" con idx 0.\n` +
        `Responde exactamente: {"intencion":"...","idx":<0-${opts.candidatos.length}>,"confianza":<0.0-1.0>}`
      : `Mensaje del cliente:\n"${clean}"\n\n${opts.que}:\n${lista}\n\n` +
        `Elige el número de la opción que mejor describe lo que el cliente quiere decir. ` +
        `Si el mensaje no calza con ninguna o es ambiguo, usa 0.\n` +
        `Responde exactamente: {"idx":<0-${opts.candidatos.length}>,"confianza":<0.0-1.0>}`;

    const raw = await runAI({
      provider: ai.provider as Provider, apiKey: ai.api_key, model, system, content: prompt, maxTokens: 120,
    });
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    const idx = Number(parsed?.idx);
    const conf = Number(parsed?.confianza);
    const intencion = String(parsed?.intencion ?? (modo === "intencion" ? "eligiendo" : "ninguna")) as Clasificacion["intencion"];
    const enRango = Number.isInteger(idx) && idx >= 1 && idx <= opts.candidatos.length;
    // En modo "eleccion" solo devolvemos clave si REALMENTE está eligiendo:
    // preguntar no fija nada. En modo "intencion" la clasificación ES la
    // respuesta, así que no hay nada que filtrar.
    const eligiendo = modo === "intencion" || intencion === "eligiendo" || intencion === "cambiando";
    const clave = eligiendo && enRango ? opts.candidatos[idx - 1].clave : null;
    return { intencion, clave, confianza: Number.isFinite(conf) ? conf : 0 };
  } catch (e) {
    console.error("[classify]", (e as any)?.message ?? e);
    return null; // nunca rompe la conversación
  }
}

// Detecta qué opción de compra quiere el cliente y la fija SI hay confianza.
// Devuelve la clasificación para que quien llama decida si confirmar.
async function detectarOpcion(db: SupabaseClient, run: Run, ctx: any, texto: string): Promise<Clasificacion | null> {
  const prodId = ctx._product_id;
  if (!prodId) return null;
  const list = await loadOpciones(db, run, prodId);
  if (list.length < 2) return null; // una sola opción → nada que elegir
  const cls = await classify(db, run.channel_id, {
    texto,
    que: "compra disponibles",
    candidatos: list.map((o) => ({
      clave: o.id,
      label: `${o.nombre}${o.precio != null ? ` (S/ ${o.precio})` : ""}`,
      detalle: o.descripcion,
    })),
  });
  if (!cls) return null;
  // Solo fijamos con confianza suficiente. Si duda, quien llama debe CONFIRMAR
  // con una pregunta: nunca adivinamos cuando hay dinero de por medio.
  if (cls.clave && cls.confianza >= 0.7) {
    const op = list.find((o) => o.id === cls.clave);
    run.vars.opcion_id = cls.clave;
    ctx.opcion_id = cls.clave;
    await setField(db, run.channel_id, run.contact_id, "opcion_id", cls.clave);
    if (op) await setField(db, run.channel_id, run.contact_id, "opcion_elegida", op.nombre);
    // Refresca el contexto en el MISMO turno: si el cliente cambió de opinión,
    // {{precio}} ya vale lo nuevo cuando la IA redacte su respuesta.
    const { monto } = await precioEsperado(db, run, ctx);
    if (op) {
      ctx.opcion = op.nombre;
      ctx.cantidad = op.cantidad ?? 1;
      (ctx as any)._opcion = op;
    }
    if (monto != null) { ctx.precio = monto; ctx.precio_esperado = monto; }
    await logEvent(db, run.channel_id, run.contact_id, "campo",
      cls.intencion === "cambiando" ? "Cambió de opción" : "Opción elegida",
      `${op?.nombre ?? cls.clave} (${Math.round(cls.confianza * 100)}%)`);
  }
  return cls;
}

// Construye el contexto de sistema para validar comprobantes de pago a partir
// del "Validador de comprobantes" del canal (Sección IA). Hace que el nodo IA
// de OCR reconozca pagos con criterio de negocio (destinatario correcto, monto,
// fecha, anti-fraude) sin tener que repetirlo en cada flujo.
// `montoEsperado` es el precio VIVO de este cliente (opción + oferta): sin él la
// IA no puede saber si el pago "corresponde al producto elegido".
function buildOcrSystem(ocr: any, montoEsperado?: number | null, moneda?: string | null): string | null {
  if (!ocr || ocr.activo === false) return null;
  const metodos = Array.isArray(ocr.metodos) ? ocr.metodos.filter((m: any) => m && (m.app || m.titular || m.numero)) : [];
  const r = ocr.reglas ?? {};
  const p: string[] = [];
  p.push("Eres un validador experto de comprobantes de pago de Perú (Yape, Plin, y transferencias de BCP, BBVA, Interbank, Scotiabank, etc.). Analiza la captura con el máximo detalle y criterio anti-fraude.");
  if (metodos.length) {
    p.push("## Métodos de pago VÁLIDOS de este negocio\nEl pago solo es válido si va dirigido a uno de estos destinatarios:\n" +
      metodos.map((m: any) => "- " + [m.app && `App/Banco: ${m.app}`, m.titular && `Titular esperado: ${m.titular}`, m.numero && `Número/cuenta: ${m.numero}`, m.notas && `(${m.notas})`].filter(Boolean).join(" · ")).join("\n"));
  }
  const reglas: string[] = [];
  if (metodos.length && r.verificar_titular !== false) reglas.push("El destinatario/titular del comprobante DEBE coincidir con uno de los métodos válidos. Si no coincide, es INVÁLIDO.");
  if (r.verificar_monto) {
    // El monto esperado es el precio VIVO de este cliente (opción de compra +
    // oferta activa). Con él la IA puede decidir si el pago corresponde a lo
    // que el cliente eligió; sin él solo puede mirar el comprobante a ciegas.
    const tol = Number(r.tolerancia_monto ?? 0);
    if (montoEsperado != null && Number.isFinite(montoEsperado)) {
      const min = Math.max(0, montoEsperado - (Number.isFinite(tol) ? tol : 0));
      reglas.push(
        `El cliente debe pagar EXACTAMENTE ${montoEsperado}${moneda ? " " + moneda : ""}. ` +
        `Es válido si el monto pagado es ${min} o más (pagar de más SIEMPRE se acepta). ` +
        `Si pagó MENOS, es INVÁLIDO: informa cuánto falta, no lo apruebes.`,
      );
    } else {
      reglas.push("Extrae el monto pagado y verifica que cubra el monto acordado con el cliente" + (tol ? ` (tolerancia ±${tol}).` : "."));
    }
  }
  if (r.verificar_fecha) reglas.push(`La fecha/hora del comprobante debe ser reciente (no más de ${Number(r.fecha_max_horas ?? 48)} horas). Si es antigua, márcalo como sospechoso.`);
  if (r.operacion_unica) reglas.push("Extrae el número de operación/constancia. Es la clave anti-reuso: si falta o es ilegible, desconfía.");
  if (r.rechazar_editados) reglas.push("Detecta señales de edición/montaje (tipografías inconsistentes, recortes, píxeles alterados, datos que no cuadran). Ante duda razonable, INVÁLIDO.");
  const nivel = r.exigencia === "alta" ? "ALTA (rechaza ante cualquier duda)" : r.exigencia === "baja" ? "BAJA (aprueba si lo esencial coincide)" : "MEDIA (equilibrio entre seguridad y fluidez)";
  reglas.push(`Nivel de exigencia: ${nivel}.`);
  p.push("## Reglas de validación\n" + reglas.map((x) => "- " + x).join("\n"));
  // Consideraciones SIEMPRE presentes (realidad de los pagos en Perú).
  const cons: string[] = [
    "Los pagos en Perú son INTEROPERABLES: un Yape puede llegar a un Plin y viceversa, y las transferencias cruzan bancos (BCP, BBVA, Interbank, Scotiabank…). NO invalides un pago solo porque la app/banco de origen sea distinta a la del destinatario; lo que importa es que el dinero llegue a una de las cuentas/números válidos de arriba.",
    "El nombre del destinatario suele salir PARCIAL o enmascarado (ej. «PER FLO», «P*** F****», «J. PÉREZ N.», solo iniciales o apellidos). Considéralo válido si coincide RAZONABLEMENTE con el titular esperado (mismas iniciales/apellidos/patrón); no exijas el nombre completo exacto.",
    "Distingue una CONSTANCIA de pago ya realizado de un «pago programado» o «en proceso» aún no ejecutado: estos últimos NO son válidos.",
    // Muchos clientes NO pagan desde la app: van a un agente o al banco. Esos
    // comprobantes son igual de válidos y hay que saber leerlos.
    "El comprobante NO siempre es una captura de pantalla de una app. Puede ser una BOLETA o CONSTANCIA física fotografiada (transferencia hecha en un agente, en ventanilla del banco, o desde la web del banco), un voucher impreso o un PDF. Todos son VÁLIDOS: juzga por su CONTENIDO (destinatario, monto, fecha, nº de operación), nunca por el formato ni por que sea una foto de un papel.",
    // Ilegible ≠ inválido: no acusar de fraude a quien mandó una foto movida.
    "Si la imagen está borrosa, cortada, con reflejos o no se lee bien, NO la declares inválida ni acuses fraude: marca legible=false y pide amablemente una foto más clara. Un comprobante ilegible es distinto de un comprobante falso.",
    "Ante un pago legítimo con algún detalle menor (una fecha difícil de leer, un nombre parcial), inclínate por ACEPTAR si lo esencial coincide. Rechazar un pago verdadero es peor que revisar uno dudoso.",
  ];
  p.push("## Consideraciones importantes\n" + cons.map((x) => "- " + x).join("\n"));
  if (ocr.instrucciones && String(ocr.instrucciones).trim()) p.push("## Instrucciones adicionales del negocio\n" + String(ocr.instrucciones).trim());
  p.push('Devuelve tu conclusión en JSON: {"es_pago":true|false,"legible":true|false,"valido":true|false,"monto":number,"moneda":"PEN","operacion":"...","fecha":"...","titular":"...","banco":"...","motivo":"explica en una frase por qué es válido o no"}. `es_pago` es false si la imagen no es un comprobante (una foto cualquiera, un meme, el producto). `legible` es false si no se alcanza a leer. Si te piden otro formato en el prompt del nodo, respétalo, pero aplica siempre estas reglas de validación.');
  return p.join("\n\n");
}
// El hilo del chat, como lo vería una persona. Es lo que convierte al nodo IA
// en una vendedora que conversa y no en un contestador que saluda de nuevo cada
// vez. Cacheado por run: en un mismo turno se puede llamar más de una vez.
async function historial(db: SupabaseClient, run: Run, max = 12): Promise<string> {
  const cache = (run as any)._hist;
  if (cache !== undefined) return cache;
  let out = "";
  try {
    const { data } = await db.from("messages")
      .select("direction, type, content, ts").eq("contact_id", run.contact_id)
      .order("ts", { ascending: false }).limit(max);
    const filas = (data ?? []).reverse()
      .map((m: any) => {
        const quien = m.direction === "in" ? "Cliente" : "Tú";
        const txt = m.content?.text ?? m.content?.caption ?? "";
        if (txt) return `${quien}: ${txt}`;
        // Un "[imagen]" es información: el cliente mandó algo aunque no sea texto.
        return m.type && m.type !== "text" ? `${quien}: [${m.type}]` : null;
      })
      .filter(Boolean);
    out = filas.join("\n");
  } catch (e) { console.error("[historial]", (e as any)?.message ?? e); }
  (run as any)._hist = out;
  return out;
}

// Perfil por defecto según la operación del nodo (§6-OCTIES).
const PERFIL_POR_OP: Record<string, string> = {
  generar_texto: "ventas", analizar_imagen: "ocr", extraer: "extraccion",
};

// ── Anti-reúso determinista de comprobantes ────────────────────────
// El "no aceptes dos veces el mismo comprobante" deja de ser una instrucción a
// la IA (blanda) y pasa a ser un chequeo por código: cada nº de operación válido
// se registra una vez por canal (tabla payment_operations, índice único). Cubre
// pago principal digital y ventas extra; el índice único aguanta hasta carreras.
function normOperacion(op: string): string {
  return String(op ?? "").toUpperCase().replace(/\s+/g, "").trim();
}
async function operacionYaUsada(db: SupabaseClient, channelId: string, op: string): Promise<boolean> {
  const n = normOperacion(op);
  if (n.length < 4) return false; // muy corto/ilegible → no bloquea (lo juzga la IA)
  const { data } = await db.from("payment_operations").select("id")
    .eq("channel_id", channelId).eq("operacion", n).maybeSingle();
  return !!data;
}
async function registrarOperacion(db: SupabaseClient, channelId: string, op: string, orderId: string | null, contexto: string): Promise<void> {
  const n = normOperacion(op);
  if (n.length < 4) return;
  await db.from("payment_operations").insert({
    channel_id: channelId, operacion: n, order_id: orderId, contexto,
  }).then(() => {}, () => { /* choca con el único = ya estaba: ok */ });
}

// Modo de validación del pago DIGITAL, resolviendo la precedencia acordada con
// Rodrigo: override del producto (config.validacion_pago) > default del canal
// (pedidos_config.digital.validacion) > "auto" (comportamiento histórico).
// Devuelve también si el producto es digital, para no tocar el camino físico.
async function digitalPagoModo(db: SupabaseClient, run: Run, info: any): Promise<{ manual: boolean; digital: boolean }> {
  const canal = info?.pedidos?.digital?.validacion === "manual" ? "manual" : "auto";
  let tipo: string | null = null;
  let override: string | null = null;
  try {
    const { data: c } = await db.from("contacts").select("product_id").eq("id", run.contact_id).maybeSingle();
    const pid = (c as any)?.product_id;
    if (pid) {
      const { data: p } = await db.from("products").select("tipo, config").eq("id", pid).maybeSingle();
      tipo = (p as any)?.tipo ?? null;
      const v = (p as any)?.config?.validacion_pago;
      if (v === "auto" || v === "manual") override = v;
    }
  } catch (_) { /* sin producto → usa el default del canal */ }
  const efectivo = override ?? canal;
  return { manual: efectivo === "manual", digital: tipo !== "fisico" };
}

async function runIa(db: SupabaseClient, run: Run, node: Node, ctx: any) {
  const cfg = node.config ?? {};
  const op = cfg.operacion ?? "generar_texto";
  const maxTokens = cfg.max_tokens ? Number(cfg.max_tokens) : undefined;
  const prompt = resolve(String(cfg.prompt ?? ""), ctx);
  const info = await channelIaInfo(db, run);
  const funnel = funnelOf(ctx.pedido_estado);
  // ctx.pedido_zona sale de orders.shipping.zona (buildContext expone shipping
  // como {{pedido_*}}): la zona real le gana a deducirla del estado.
  const agencia = esAgencia(ctx.pedido_estado, ctx.pedido_zona);

  // Control de IA por embudo (IA · Pedidos): si el canal ya configuró Pedidos y
  // el embudo de este contacto está apagado, la IA no responde (lo toma un
  // humano). Solo aplica a respuestas conversacionales (generar_texto) y solo
  // cuando existe pedidos_config, para no alterar canales que no usan la función.
  if (op === "generar_texto" && info.pedidos?.embudos && info.pedidos.embudos[funnel] === false) {
    await logEvent(db, run.channel_id, run.contact_id, "nota", "IA en pausa (embudo " + funnel + ")",
      "El embudo está desactivado en IA · Pedidos; responde un humano.").catch(() => {});
    run.current_node_id =
      (await nextNode(db, run.flow_id, node.id, "exito")) ??
      (await nextNode(db, run.flow_id, node.id, "continuar"));
    return; // sin generar ni enviar
  }

  // ¿El cliente está ELIGIENDO una opción de compra? Lee su texto libre (no
  // dependemos de que toque un botón). Preguntar no es elegir: si solo compara,
  // esto no fija nada. Refresca {{precio}} en el acto si eligió o cambió.
  if (op === "generar_texto" && ctx.last_input && cfg.detectar_opcion !== false) {
    await detectarOpcion(db, run, ctx, String(ctx.last_input)).catch(() => null);
  }

  // Físico: ¿mencionó a dónde lo quiere? Resuelve la zona contra la lista del
  // negocio y deja el veredicto (cubrimos / llega hoy / va por agencia) listo
  // para inyectárselo a la IA. La IA NO decide nada de esto: solo lo comunica.
  if (op === "generar_texto" && ctx.last_input && cfg.detectar_zona) {
    await resolverZonaAccion(db, run, {}, ctx).catch(() => null);
  }

  // Vende Y recolecta a la vez: pesca del mensaje los datos que hagan falta,
  // sin interrogar. Deja {{datos_completos}} para que el flujo sepa cuándo ya
  // puede crear el pedido. Los campos del flujo se suman a los ATRIBUTOS del
  // producto (talla, color…): se capturan igual, y los obligatorios entran a
  // {{datos_completos}} para que la IA no cierre sin ellos.
  if (op === "generar_texto" && ctx.last_input) {
    const attrCampos = (Array.isArray(ctx._atributos) ? ctx._atributos : []).map((a: any) => ({
      clave: a.clave, label: a.nombre, requerido: a.obligatorio !== false,
      detalle: [a.valores?.length ? `valores posibles: ${a.valores.join(", ")}` : "", a.ayuda]
        .filter(Boolean).join(". ") || undefined,
    }));
    const campos = [...(Array.isArray(cfg.campos) ? cfg.campos : []), ...attrCampos];
    if (campos.length) await extraerDatos(db, run, { ...cfg, campos }, ctx).catch(() => null);
  }

  // Operación "clasificar": mete la última respuesta del cliente en una de las
  // opciones que define el nodo (ej. acepta / rechaza / duda) y la guarda en un
  // campo para que un nodo Condición ramifique. Es lo que permite el "corte
  // inteligente" de la cadena de ventas extra: entiende un "no gracias", un "ya
  // tengo uno" o un "dale" sin depender de botones.
  if (op === "clasificar") {
    const cands = (cfg.opciones ?? []).map((o: any) =>
      typeof o === "string"
        ? { clave: o, label: o }
        : { clave: o.clave ?? o.label, label: o.label ?? o.clave, detalle: o.detalle ?? null });
    const key = cfg.guardar_en || "clasificacion";
    // Sin IA, sin candidatos o sin confianza → queda el default. El flujo sigue
    // por la rama prudente en vez de inventar una decisión del cliente.
    let val = String(cfg.default ?? "duda");
    if (cands.length && ctx.last_input) {
      const cls = await classify(db, run.channel_id, {
        texto: String(ctx.last_input), candidatos: cands, modo: "intencion",
        que: cfg.que || "Opciones", perfil: cfg.perfil,
      });
      if (cls?.clave && cls.confianza >= Number(cfg.umbral ?? 0.6)) val = cls.clave;
    }
    run.vars[key] = val;
    await setField(db, run.channel_id, run.contact_id, key, val);
    await logEvent(db, run.channel_id, run.contact_id, "campo", "Intención detectada", `${key}: ${val}`);
    run.current_node_id =
      (await nextNode(db, run.flow_id, node.id, "exito")) ??
      (await nextNode(db, run.flow_id, node.id, "continuar"));
    return;
  }

  // Prompt de sistema en 3 niveles (§6-OCTIES): negocio → producto → nodo.
  let system = (cfg.system ?? cfg.contexto) ? resolve(String(cfg.system ?? cfg.contexto), ctx) : undefined;
  if (op === "generar_texto" && cfg.usar_conocimiento !== false) {
    const parts: string[] = [];
    if (info.negocio) parts.push("## Sobre el negocio\n" + info.negocio);
    // Formas de pago (fuente única = Validador de comprobantes): la IA sabe
    // responder "¿cómo pago?" sin repetir los datos en el Conocimiento.
    const pm = (info.ocr?.metodos ?? []).filter((m: any) => m && (m.app || m.numero || m.titular))
      .map((m: any) => "- " + [m.app, m.numero, m.titular ? `(${m.titular})` : ""].filter(Boolean).join(" "));
    if (pm.length) parts.push("## Formas de pago aceptadas\n" + pm.join("\n"));
    if (ctx.contexto_producto) parts.push(`## Sobre el producto${ctx.producto_nombre ? ` (${ctx.producto_nombre})` : ""}\n` + ctx.contexto_producto);
    // Opciones de compra: la IA tiene que conocerlas para venderlas y para que
    // el cliente pueda elegir ESCRIBIENDO. Le decimos explícitamente que no dé
    // por elegida ninguna hasta que el cliente decida (preguntar ≠ elegir).
    if (ctx._product_id) {
      const ops = await loadOpciones(db, run, ctx._product_id);
      if (ops.length > 1) {
        const lista = ops.map((o) =>
          `- ${o.nombre}${o.precio != null ? `: S/ ${o.precio}` : ""}${o.descripcion ? ` — ${o.descripcion}` : ""}`
        ).join("\n");
        const estado = ctx.opcion
          ? `\n\nAhora mismo el cliente se inclina por: **${ctx.opcion}**${ctx.precio != null ? ` (S/ ${ctx.precio})` : ""}. ` +
            `Puede cambiar de opinión en cualquier momento: si lo hace, respétalo sin reprocharle.`
          : `\n\nEl cliente AÚN NO eligió. No des ninguna por elegida: si pregunta o compara, informa y ayúdalo a decidir. ` +
            `Solo cuando decida, confirma cuál y su precio.`;
        parts.push("## Opciones de compra disponibles\n" + lista + estado);
      }
    }
    // Atributos del pedido (talla, color…): la IA los pregunta con naturalidad y
    // los confirma antes de cerrar. Le decimos qué YA tiene (para no repreguntar),
    // qué falta, y qué multimedia de apoyo puede enviar. El motor ya los capturó
    // arriba (extraerDatos): acá solo se le instruye cómo conversarlos.
    const atributos: any[] = Array.isArray(ctx._atributos) ? ctx._atributos : [];
    if (atributos.length) {
      const L: string[] = [];
      for (const a of atributos) {
        const val = String(ctx[a.clave] ?? "").trim();
        if (val) { L.push(`- ${a.nombre}: YA registrado = "${val}". No lo vuelvas a preguntar.`); continue; }
        const req = a.obligatorio !== false ? "obligatorio" : "opcional";
        const vals = a.valores?.length ? ` — valores: ${a.valores.join(", ")}` : "";
        L.push(`- ${a.nombre} (${req})${vals}.${a.ayuda ? ` ${a.ayuda}` : ""}`);
      }
      const apoyos = atributos.flatMap((a: any) => (a.media || []).map((m: any) => ({ a, m })))
        .filter((x: any) => x.m && x.m.tag);
      const apoyoTxt = apoyos.length
        ? "\n\nApoyos que PUEDES enviar (escribe `[[media:TAG]]` en una línea aparte cuando ayude a decidir):\n" +
          apoyos.map((x: any) => `- [[media:${x.m.tag}]] — ${x.m.descripcion || `apoyo para ${x.a.nombre}`}`).join("\n")
        : "";
      const faltan = atributos.filter((a: any) => a.obligatorio !== false && !String(ctx[a.clave] ?? "").trim());
      const cierre = faltan.length
        ? `\n\nAún te falta capturar: **${faltan.map((a: any) => a.nombre).join(", ")}**. Pídelos con naturalidad, de a pocos, sin interrogar ni pedir todo de golpe, y no confirmes el pedido hasta tenerlos.`
        : "\n\nYa tienes todos los atributos obligatorios: no los vuelvas a pedir.";
      parts.push("## Datos que debes capturar de este pedido\n" + L.join("\n") + apoyoTxt + cierre);
    }
    // Entrega física: el veredicto YA está calculado por el motor contra la
    // configuración del negocio. Se le da a la IA masticado y con la orden
    // explícita de no contradecirlo — sabe qué decir, no qué decidir. (La IA no
    // sabe qué hora es ni qué zonas cubrimos; el código sí.)
    if (ctx.zona_entrega) {
      const L: string[] = [];
      if (ctx.zona_entrega === "lima" && ctx.zona_distrito_incierto === "si") {
        // Dijo "Lima" a secas: es contraentrega, pero falta el distrito. La IA
        // lo pregunta ANTES de prometer día de entrega, y NUNCA ofrece agencia.
        L.push("El cliente es de **Lima** → entrega en Lima, CONTRAENTREGA (paga al recibir). NO le ofrezcas envío por agencia ni le pidas adelanto: eso es solo para provincia.");
        L.push("Todavía NO sabes su **distrito** de Lima. Pregúntaselo con naturalidad para coordinar la entrega; recién con el distrito podrás decirle si llega hoy. No prometas el mismo día hasta saberlo.");
      } else if (ctx.zona_entrega === "lima") {
        L.push(`El cliente es de **${ctx.zona_nombre || "Lima"}** → entrega en Lima, CONTRAENTREGA (paga al recibir).`);
        L.push(ctx.entrega_hoy === "si"
          ? "SÍ alcanza la entrega de HOY. Puedes confirmárselo."
          : `NO alcanza para hoy${ctx.entrega_motivo ? ` (${ctx.entrega_motivo})` : ""}: ofrécele el día siguiente con amabilidad. ` +
            `No prometas que llega hoy bajo ninguna circunstancia, aunque insista.`);
      } else {
        L.push(`El cliente es de **${ctx.ciudad || "provincia"}** → NO es nuestra zona de reparto: el envío va **por agencia**.`);
        L.push("Mencionamos **Shalom** como nuestra agencia; solo ofrece otra si el cliente la pide.");
        // Pedir la sede nombrando la ciudad: "Av. España" a secas no sirve para
        // despachar (¿la de Trujillo o la de Lima?), y el cliente responde mejor
        // si le preguntas por SU ciudad.
        L.push(`Para despachar necesitas: su **DNI**, nombre y apellido, el **adelanto**, y **a qué sede de Shalom${ctx.ciudad ? " de " + ctx.ciudad : ""}** lo va a recoger. ` +
          `Pregúntale la sede nombrando su ciudad, no en abstracto.`);
      }
      L.push("Estos datos los calculó el sistema con la configuración real del negocio: NO los contradigas ni los negocies.");
      parts.push("## Entrega de este cliente\n" + L.map((x) => "- " + x).join("\n"));
    }
    // Qué datos faltan (y cuáles vinieron mal). La IA los pide DENTRO de la
    // conversación, no como formulario: uno a la vez, sin repetir lo que el
    // cliente ya dijo, y sin trabar la venta si algo sale impreciso.
    const faltan = (ctx as any)._datos_faltan as CampoDato[] | undefined;
    if (faltan?.length) {
      const errores = faltan.map((c) => ctx["_error_" + c.clave]).filter(Boolean);
      const L: string[] = [
        "Todavía te faltan estos datos para cerrar el pedido:",
        ...faltan.map((c) => `- **${c.label}**${c.detalle ? ` (${c.detalle})` : ""}`),
        "Pídelos de forma natural dentro de la conversación, **de a uno**, sin sonar a formulario, y sin volver a pedir lo que ya te dio.",
      ];
      if (errores.length) L.push("Corrígele esto con amabilidad: " + errores.join("; ") + ".");
      parts.push("## Datos que faltan\n" + L.join("\n"));
    } else if (ctx.datos_completos === "si") {
      parts.push("## Datos\nYa tienes todo lo necesario para el pedido: no le pidas más datos, cierra la venta.");
    }
    if (ctx.emojis) parts.push("## Emojis de este producto\nPuedes usar estos emojis (con moderación) cuando hables de este producto: " + ctx.emojis);
    if (ctx.faq) parts.push("## Preguntas frecuentes y objeciones\n" + ctx.faq);
    // Agentes de pedidos físicos: instrucciones y mensajes del embudo actual
    // (confirmaciones/logística) según el estado del pedido y el tipo de envío.
    const ped = buildPedidosSystem(info.pedidos, funnel, agencia);
    if (ped) parts.push(ped);
    // Pedir ayuda. Se le dice con precisión cuándo, porque escalar de más
    // molesta al operador tanto como no escalar molesta al cliente.
    parts.push(
      "## Cuando necesites a una persona\n" +
      "Si de verdad no puedes resolverlo tú, escribe el marcador `[[humano]]` en tu respuesta " +
      "(el cliente NO lo ve) y dile con calidez que lo pasas con alguien del equipo. " +
      "NO prometas un tiempo exacto de respuesta (\"en 5 minutos\"): solo dile que lo verá una persona; del horario se encarga el sistema.\n" +
      "Úsalo SOLO si: el cliente está molesto o reclamando, hay un problema con un pedido ya hecho, " +
      "te pide algo que no puedes decidir (un descuento fuera de lo permitido, cambiar o cancelar un pedido), " +
      "o te preguntó dos veces lo mismo y no lograste ayudarlo.\n" +
      "NO lo uses por: preguntas normales del producto, precios, formas de pago, tiempos de entrega, " +
      "ni porque te pregunten si eres un bot — eso respóndelo tú.",
    );
    if (system) parts.push(system);
    if (parts.length) system = parts.join("\n\n");
  }
  // OCR: inyecta el "Validador de comprobantes" del canal (métodos válidos +
  // reglas anti-fraude) para que la IA reconozca pagos con criterio de negocio.
  if (op === "analizar_imagen" && cfg.usar_validador !== false) {
    // El monto esperado sale del contexto (opción elegida + oferta activa): así
    // la IA valida contra lo que ESTE cliente debe pagar, y puede decir si el
    // comprobante "corresponde al producto elegido".
    // cfg.monto_esperado lo pisa cuando se está cobrando otra cosa (ej. el pago
    // de una venta extra, que tiene su propio precio).
    const esperado = cfg.monto_esperado
      ? Number(resolve(String(cfg.monto_esperado), ctx))
      : Number(ctx.precio_esperado);
    const vt = buildOcrSystem(info.ocr, Number.isFinite(esperado) ? esperado : null, ctx.moneda ?? null);
    if (vt) system = system ? (vt + "\n\n" + system) : vt;
  }

  try {
    // Resolver proveedor + modelo: override del nodo > perfil del rol > default del canal.
    const perfilKey = cfg.perfil || PERFIL_POR_OP[op];
    const perfil = perfilKey ? (info.perfiles?.[perfilKey] ?? null) : null;
    const wantProvider = cfg.proveedor && cfg.proveedor !== "auto"
      ? cfg.proveedor
      : (perfil?.proveedor && perfil.proveedor !== "auto" ? perfil.proveedor : null);
    const { data: aiRows } = await db.rpc("get_channel_ai_active", {
      p_channel_id: run.channel_id, p_provider: wantProvider,
    });
    const ai = Array.isArray(aiRows) ? aiRows[0] : aiRows;
    if (!ai?.api_key) throw new Error("IA no configurada en este canal (Configuraciones)");
    const provider = ai.provider as Provider;
    const model = cfg.modelo || (perfil?.proveedor === ai.provider ? perfil?.modelo : null) || ai.model || undefined;

    let content: string | ContentBlock[] = prompt;
    // Sin esto la IA está CIEGA: recibía un prompt fijo ("continúa la
    // conversación") sin la conversación ni el mensaje del cliente, así que
    // respondía un saludo genérico cada vez, ignorando lo que le preguntaban.
    // No se ve leyendo el código — solo corriendo un chat de verdad.
    if (op === "generar_texto" && cfg.usar_historial !== false) {
      const hist = await historial(db, run, Number(cfg.historial_max ?? 12));
      if (hist) content = `${prompt}\n\n## La conversación hasta ahora\n${hist}\n\nResponde SOLO al último mensaje del cliente. No repitas el saludo si ya saludaste.`;
    }
    if (op === "analizar_imagen") {
      // La imagen viene de una variable de config, o del último input del contacto.
      const img = cfg.imagen_var ? ctx[cfg.imagen_var] : (ctx.last_image ?? run.vars._last_image);
      if (!img) throw new Error("no hay imagen para analizar");
      let src = String(img);
      // "wa-media:<id>" = media privado de WhatsApp → descargar con el token
      // del canal y pasarlo como base64 (el LLM no puede leer URLs firmadas).
      if (src.startsWith("wa-media:")) {
        const secrets = await getChannelSecrets(db, run.channel_id);
        if (!secrets?.access_token) throw new Error("canal sin access_token para leer el media");
        src = await fetchMediaAsDataUri(src.slice("wa-media:".length), secrets.access_token);
      }
      const blocks: ContentBlock[] = [];
      // Imágenes de REFERENCIA del validador (opcional, máx 3): ayudan a la IA a
      // reconocer cómo lucen los pagos, sin ser el único método aceptado.
      const refs = (cfg.usar_validador !== false && Array.isArray(info.ocr?.ejemplos))
        ? info.ocr.ejemplos.filter((e: any) => e?.url).slice(0, 3) : [];
      if (refs.length) {
        blocks.push({ type: "text", text: `A continuación ${refs.length} comprobante(s) de REFERENCIA (válidos, solo para que sepas cómo lucen los pagos de este negocio). NO son el único método: si el comprobante del cliente es de otro tipo/app, ignóralos y valida por las reglas.` });
        for (const e of refs) blocks.push(imageBlock(String(e.url)));
        blocks.push({ type: "text", text: "— Ahora analiza el SIGUIENTE comprobante enviado por el cliente:" });
      }
      blocks.push(imageBlock(src), { type: "text", text: prompt });
      content = blocks;
    }

    const result = await runAI({
      provider, apiKey: ai.api_key, model, system, content, maxTokens,
      jsonSchema: op === "extraer" ? cfg.json_schema : undefined,
    });

    // Guardar el resultado como variable del run y (si existe) campo persistente.
    if (cfg.guardar_en) {
      run.vars[cfg.guardar_en] = result;
      await setField(db, run.channel_id, run.contact_id, cfg.guardar_en, result);
      await logEvent(db, run.channel_id, run.contact_id, "campo", "Campo capturado (IA)", `${cfg.guardar_en}: ${result ?? ""}`.slice(0, 140));
    }
    // El OCR YA LEE el banco, la operación y el monto — pero se perdían: el
    // nodo solo guardaba el texto crudo ("PAGO_OK"). Si el comprobante trae un
    // JSON, se rescatan a campos propios para que el aviso y Google Sheets
    // puedan decir CON QUÉ pagó, que es justo lo que Rodrigo quiere registrar.
    if (op === "analizar_imagen") {
      try {
        const m = /\{[\s\S]*\}/.exec(String(result ?? ""));
        if (m) {
          const p = JSON.parse(m[0]);
          const guarda = async (k: string, v: any) => {
            const s = String(v ?? "").trim();
            if (!s) return;
            run.vars[k] = s;
            ctx[k] = s;
            await setField(db, run.channel_id, run.contact_id, k, s);
          };
          await guarda("pago_metodo", p.banco ?? p.app);
          await guarda("pago_operacion", p.operacion);
          await guarda("pago_monto", p.monto);
          await guarda("pago_titular", p.titular);
        }
      } catch (_) { /* no trajo JSON: el flujo sigue igual con el texto crudo */ }
    }
    // ── Anti-reúso determinista + validación manual (pagos digitales) ──
    // Cuando el OCR da el pago por VÁLIDO (PAGO_OK), dos cosas antes de entregar:
    //  (1) Anti-reúso por código: si el nº de operación ya se usó en este canal,
    //      se rechaza solo (sin depender de que la IA lo recuerde).
    //  (2) Validación MANUAL: si el canal/producto lo pide, no se entrega aún; se
    //      avisa (Copiloto + Telegram) y el run queda parqueado hasta tu visto
    //      bueno. Distingue el pago PRINCIPAL (crea pedido pendiente) del de una
    //      VENTA EXTRA (marca el pedido ya existente, sin duplicarlo).
    if (op === "analizar_imagen" && /PAGO_OK/i.test(String(result ?? ""))) {
      const esExtra = String(cfg.guardar_en ?? "").startsWith("pago_extra");
      const opNum = String(run.vars.pago_operacion ?? "").trim();

      if (opNum && await operacionYaUsada(db, run.channel_id, opNum)) {
        // Reúso → convertir el veredicto en rechazo: la Condición del flujo
        // manda a "reintentar pago". No se registra (ya estaba) ni se parquea.
        const aviso = `PAGO_NO Este comprobante ya se usó antes (operación ${opNum}). Envíame uno nuevo, por favor.`;
        if (cfg.guardar_en) {
          run.vars[cfg.guardar_en] = aviso;
          await setField(db, run.channel_id, run.contact_id, cfg.guardar_en, aviso);
        }
        await logEvent(db, run.channel_id, run.contact_id, "nota", "🚫 Comprobante reusado", `operación ${opNum}`).catch(() => {});
      } else {
        if (opNum) {
          await registrarOperacion(db, run.channel_id, opNum, (run.vars._order_id as string) ?? null, esExtra ? "extra" : "digital").catch(() => {});
        }
        const yaParque = esExtra ? run.vars._extra_manual_pendiente : run.vars._pago_manual_pendiente;
        if (!yaParque) {
          const modo = await digitalPagoModo(db, run, info);
          if (modo.digital && modo.manual) {
            const url = String(run.vars._last_image ?? ctx.ultima_imagen ?? "");
            const { data: cc } = await db.from("contacts").select("product_id, nombre, wa_id").eq("id", run.contact_id).maybeSingle();
            const quien = (cc as any)?.nombre || (cc as any)?.wa_id || "Un cliente";
            if (esExtra) {
              // El pedido principal YA existe: se marca para aprobar el extra,
              // NO se crea otro pedido (el extra se suma como bump al aprobar).
              const oid = run.vars._order_id as string | undefined;
              const montoX = Number(cfg.monto_esperado ? resolve(String(cfg.monto_esperado), ctx) : 0) || Number(run.vars.pago_monto) || 0;
              if (oid) {
                const { data: cur } = await db.from("orders").select("shipping").eq("id", oid).maybeSingle();
                await db.from("orders").update({
                  shipping: {
                    ...((cur as any)?.shipping ?? {}),
                    extra_pendiente: true, extra_comprobante: url,
                    extra_monto_leido: run.vars.pago_monto ?? montoX,
                    extra_operacion: run.vars.pago_operacion ?? null,
                    extra_ok_ia: true, extra_label: cfg._extra_label ?? "Venta extra",
                  },
                  updated_at: new Date().toISOString(),
                }).eq("id", oid);
              }
              run.vars._extra_manual_pendiente = true;
              await notifyAdmin(db, { channel_id: run.channel_id, contact_id: run.contact_id } as any,
                `🎁 <b>Pago de venta extra por validar</b>\n${quien} ${montoX ? "pagó S/ " + montoX : "envió un comprobante"} por ${cfg._extra_label ?? "un extra"}. Apruébalo en el Copiloto.`).catch(() => {});
            } else {
              const amount = Number(ctx.precio_esperado) || Number(run.vars.pago_monto) || 0;
              const ship = {
                digital_pendiente: true, digital_comprobante: url,
                digital_monto_leido: run.vars.pago_monto ?? null,
                digital_operacion: run.vars.pago_operacion ?? null,
                digital_ok_ia: true,
              };
              try {
                // Si ya había un pendiente de esta misma venta (típico: le
                // rechazaste el comprobante anterior y mandó otro), se REUSA en vez
                // de crear un segundo pedido — si no, cada intento fallido dejaría
                // un 'pendiente' huérfano en la base.
                const previo = run.vars._order_precreado ? String(run.vars._order_id ?? "") : "";
                let reusado = false;
                if (previo) {
                  const { data: cur } = await db.from("orders").select("shipping, estado").eq("id", previo).maybeSingle();
                  if ((cur as any)?.estado === "pendiente") {
                    await db.from("orders").update({
                      amount, shipping: { ...((cur as any).shipping ?? {}), ...ship },
                      updated_at: new Date().toISOString(),
                    }).eq("id", previo);
                    reusado = true;
                  }
                }
                if (!reusado) {
                  const { data: ord } = await db.from("orders").insert({
                    channel_id: run.channel_id, contact_id: run.contact_id,
                    product_id: (cc as any)?.product_id ?? null,
                    amount, estado: "pendiente", shipping: ship,
                  }).select("id").single();
                  if (ord) { run.vars._order_id = (ord as any).id; run.vars._order_precreado = true; }
                }
              } catch (e) { console.error("[digital manual] crear pendiente:", (e as any)?.message ?? e); }
              run.vars._pago_manual_pendiente = true;
              await notifyAdmin(db, { channel_id: run.channel_id, contact_id: run.contact_id } as any,
                `💳 <b>Pago digital por validar</b>\n${quien} ${amount ? "pagó S/ " + amount : "envió un comprobante"}. Revísalo y apruébalo en el Copiloto.`).catch(() => {});
            }
            await deliverMessage(db, run.channel_id, run.contact_id, "¡Gracias! Estoy verificando tu pago y en un momentito te confirmo. 🙌").catch(() => {});
            await logEvent(db, run.channel_id, run.contact_id, "nota", esExtra ? "🎁 Pago de extra en revisión (validación manual)" : "💳 Pago digital en revisión (validación manual)").catch(() => {});
            run.vars._await = { type: "aprobacion_digital", node_id: node.id };
            run.estado = "esperando";
            return; // parqueado: la entrega ocurre recién al aprobar
          }
        }
      }
    }

    // Enviar el resultado al usuario (por defecto sí, salvo que se desactive).
    const enviar = cfg.enviar ?? (op === "generar_texto");
    if (enviar && result) await emitIaText(db, run, String(result), ctx);

    run.current_node_id =
      (await nextNode(db, run.flow_id, node.id, "exito")) ??
      (await nextNode(db, run.flow_id, node.id, "continuar"));
  } catch (err) {
    console.error("nodo ia falló:", (err as any)?.message ?? err);
    run.vars._ia_error = String((err as any)?.message ?? err);
    await logEvent(db, run.channel_id, run.contact_id, "error", "Error en nodo IA", String((err as any)?.message ?? err));
    run.current_node_id =
      (await nextNode(db, run.flow_id, node.id, "fallo")) ??
      (await nextNode(db, run.flow_id, node.id, "continuar"));
  }
}

// ── Nodo Google Sheets: registra una fila vía webhook de Apps Script ─
// El usuario publica un Apps Script en su hoja (Ajustes → Google Sheets) que
// recibe { hoja, fila } y agrega la fila. Nodo solo hace POST a esa URL.
async function runGoogleSheets(db: SupabaseClient, run: Run, node: Node, ctx: any) {
  const cfg = node.config ?? {};
  // `una_vez`: una venta = UNA fila. Sin esto, un reintento del motor o un
  // comprobante reenviado duplican la fila y los ingresos quedan inflados en la
  // hoja — un error que se descubre tarde y ensucia meses de números.
  if (cfg.una_vez) {
    const clave = resolve(String(cfg.una_vez), ctx);
    if (clave && await yaSeHizo(db, run, clave)) {
      await logEvent(db, run.channel_id, run.contact_id, "nota", "📊 Fila omitida (ya se registró)", clave).catch(() => {});
      run.current_node_id =
        (await nextNode(db, run.flow_id, node.id, "exito")) ??
        (await nextNode(db, run.flow_id, node.id, "continuar"));
      return;
    }
  }
  try {
    const { data: ch } = await db.from("channels").select("gsheets").eq("id", run.channel_id).maybeSingle();
    const g = (ch as any)?.gsheets ?? {};
    const accion = cfg.accion === "update" ? "update" : "append";
    // columnas: [{ col:"Fecha", valor:"{{fecha_compra}}" }, …] → { Fecha: "13/07/2026", … }
    // En "append" = celdas de la fila nueva; en "update" = celdas a modificar.
    const fila: Record<string, string> = {};
    for (const c of cfg.columnas ?? []) {
      if (!c?.col) continue;
      fila[String(c.col)] = resolve(String(c.valor ?? ""), ctx);
    }
    const buscar: Record<string, string> = {};
    if (accion === "update") for (const b of cfg.buscar ?? []) if (b?.col) buscar[String(b.col)] = resolve(String(b.valor ?? ""), ctx);
    const hoja = cfg.hoja || g.tab || undefined;

    if (g.mode === "oauth") {
      // OAuth: llamamos a la Sheets API con el token del canal (Vault).
      const spreadsheetId = g.spreadsheet_id;
      if (!spreadsheetId) throw new Error("Falta elegir la hoja en Ajustes → Google Sheets");
      const { data: refresh } = await db.rpc("get_gsheets_token", { p_channel_id: run.channel_id });
      if (!refresh) throw new Error("Google Sheets desconectado (reconecta en Ajustes)");
      const token = await getAccessToken(String(refresh));
      if (accion === "update") await sheetsUpdate(token, spreadsheetId, hoja, buscar, fila);
      else await sheetsAppend(token, spreadsheetId, hoja, fila);
    } else if (g.webhook_url) {
      // Apps Script: POST a la app web del usuario.
      const payload: Record<string, unknown> = { accion, hoja, fila };
      if (accion === "update") payload.buscar = buscar;
      const res = await fetch(g.webhook_url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Apps Script respondió " + res.status);
    } else {
      throw new Error("Google Sheets no está conectado (Ajustes → Google Sheets)");
    }
    await logEvent(db, run.channel_id, run.contact_id, "nota", accion === "update" ? "📊 Fila actualizada en Google Sheets" : "📊 Fila enviada a Google Sheets");
    run.current_node_id =
      (await nextNode(db, run.flow_id, node.id, "exito")) ??
      (await nextNode(db, run.flow_id, node.id, "continuar"));
  } catch (err) {
    await logEvent(db, run.channel_id, run.contact_id, "error", "Error al escribir en Google Sheets", String((err as any)?.message ?? err));
    run.current_node_id =
      (await nextNode(db, run.flow_id, node.id, "fallo")) ??
      (await nextNode(db, run.flow_id, node.id, "continuar"));
  }
}

// ── Nodo Evento Facebook (CAPI): Lead / InitiateCheckout / Purchase ─
async function runEventoFb(db: SupabaseClient, run: Run, node: Node, ctx: any) {
  const cfg = node.config ?? {};
  const eventName = cfg.event_name ?? "Lead";
  const valRaw = resolve(String(cfg.value ?? ""), ctx).trim();
  const value = valRaw ? Number(valRaw.replace(",", ".")) : undefined;
  const orderId = cfg.order_id ? resolve(String(cfg.order_id), ctx).trim() || undefined : undefined;
  const currency = cfg.currency || "PEN";

  const res = await sendCapiEvent(db, run.channel_id, run.contact_id, {
    eventName, value: Number.isFinite(value as number) ? value : undefined,
    currency, orderId,
  });
  if (!res.ok) { run.vars._capi_error = res.error; await logEvent(db, run.channel_id, run.contact_id, "error", "Error al enviar evento a Meta", String(res.error ?? "")); }

  // En una compra confirmada, registrar la orden (métricas de producto del
  // Dashboard) y un evento de compra en el Timeline.
  if (res.ok && eventName === "Purchase") {
    const { data: c } = await db.from("contacts").select("product_id").eq("id", run.contact_id).maybeSingle();
    await db.from("orders").insert({
      channel_id: run.channel_id, contact_id: run.contact_id,
      product_id: (c as any)?.product_id ?? null,
      amount: Number.isFinite(value as number) ? value : 0,
      currency, order_id: orderId ?? null, estado: "confirmada",
      confirmed_at: new Date().toISOString(),
    }); // si la tabla orders no existe (0017 pendiente) o el order_id se repite, el error se ignora
    await logEvent(db, run.channel_id, run.contact_id, "compra", "Compra registrada", value ? `${currency} ${value}` : "");
  }

  const handle = res.ok ? "exito" : "fallo";
  run.current_node_id =
    (await nextNode(db, run.flow_id, node.id, handle)) ??
    (await nextNode(db, run.flow_id, node.id, "continuar"));
}

// ── Atributos del producto (talla, color…) ─────────────────────────
// Detalles que la IA pregunta y registra pero que NO cambian el precio (eso
// serían Opciones de compra). Se capturan como campos (extraerDatos), quedan en
// {{clave}} y en el pedido (shipping.atributos), y cada uno puede traer
// multimedia de apoyo que la IA envía por [[media:tag]] (ej. guía de tallas).
type Atributo = { nombre: string; clave: string; obligatorio: boolean; valores: string[]; ayuda: string; media: any[] };
function slugAttr(s: string): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
}
function normalizeAtributos(raw: any): Atributo[] {
  if (!Array.isArray(raw)) return [];
  const out: Atributo[] = []; const usadas = new Set<string>();
  raw.forEach((a: any, i: number) => {
    const nombre = String(a?.nombre ?? "").trim();
    if (!nombre) return;
    let clave = String(a?.clave ?? "").trim() || slugAttr(nombre) || ("atributo" + (i + 1));
    let base = clave, n = 2;
    while (usadas.has(clave)) clave = base + "_" + n++;
    usadas.add(clave);
    const valores = String(a?.valores ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
    const media = (Array.isArray(a?.media) ? a.media : [])
      .filter((m: any) => m && m.media_url)
      .map((m: any, j: number) => ({ ...m, tag: String(m.tag || ("atr_" + clave + (j ? "_" + j : ""))) }));
    out.push({ nombre, clave, obligatorio: a?.obligatorio !== false, valores, ayuda: String(a?.ayuda ?? "").trim(), media });
  });
  return out;
}

// ── Contexto y resolución de variables {{ }} ───────────────────────
async function buildContext(db: SupabaseClient, run: Run) {
  const { data: c } = await db.from("contacts")
    .select("nombre, wa_id, stage, last_input, last_input_type, product_id, ad_id, ctwa_clid, source, created_at")
    .eq("id", run.contact_id).maybeSingle();
  const { data: fields } = await db.from("contact_field_values")
    .select("value, custom_fields!inner(key)").eq("contact_id", run.contact_id);
  // Fecha/hora actuales en la zona del negocio (para {{fecha}}, {{fecha_hora}}).
  const now = new Date();
  const fFecha = new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric" }).format(now);
  const fHora = new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit" }).format(now);
  const ctx: any = {
    nombre: c?.nombre ?? "", telefono: c?.wa_id ?? "", wa_id: c?.wa_id ?? "",
    stage: c?.stage ?? "", last_input: c?.last_input ?? "",
    last_input_type: (c as any)?.last_input_type ?? "",
    // Atribución del anuncio (Click-to-WhatsApp) capturada en el primer mensaje.
    ad_id: (c as any)?.ad_id ?? "", ctwa_clid: (c as any)?.ctwa_clid ?? "", origen: (c as any)?.source ?? "",
    // Fecha/hora de AHORA (para sellar {{fecha}} de compra con un set_field).
    fecha: fFecha, hora: fHora, fecha_hora: `${fFecha} ${fHora}`,
  };
  // PRECEDENCIA (de menos a más específico; lo de abajo pisa a lo de arriba):
  //   Campos del Bot (global) → datos del Producto → run.vars → Campos del
  //   contacto. Así lo específico gana: el dato de un producto pisa al global,
  //   y el dato propio del contacto pisa a todo.

  // 1) Campos del Bot (sección Campos → "Campos del Bot"): globales fijos del
  //    canal, su valor vive en custom_fields.valor y aplica a TODA conversación.
  try {
    let bf = (run as any)._botFields;
    if (!bf) {
      bf = {};
      const { data: fixed } = await db.from("custom_fields")
        .select("key, valor").eq("channel_id", run.channel_id).eq("modo", "fijo");
      for (const f of fixed ?? []) if ((f as any).valor != null) bf[(f as any).key] = (f as any).valor;
      (run as any)._botFields = bf;
    }
    for (const [k, v] of Object.entries(bf)) ctx[k] = v;
  } catch (_) { /* columna valor pendiente (0013) */ }

  // 2) Campos FIJOS del producto (§6-SEXIES): la ficha del producto expone sus
  // datos como variables ({{precio}}, {{link_entrega}}, {{producto_nombre}},
  // {{adelanto}}, {{envio_*}}…). Cacheado por run (no cambian a mitad).
  try {
    const prodId = (c as any)?.product_id;
    ctx._product_id = prodId ?? null; // "_" = interno, no se filtra a {{...}}
    if (prodId) {
      let pc = (run as any)._prodCtx;
      if (!pc || pc._id !== prodId) {
        const { data: p } = await db.from("products").select("nombre, config").eq("id", prodId).maybeSingle();
        pc = { _id: prodId };
        if (p) {
          pc.producto_nombre = (p as any).nombre;
          for (const [k, v] of Object.entries((p as any).config ?? {})) {
            if (v == null || typeof v === "object") continue;
            pc[k] = v;
          }
          // Atributos del producto (talla, color…): definiciones normalizadas para
          // capturarlos y mostrarle a la IA qué falta. "_" = interno, no {{...}}.
          const attrs = normalizeAtributos((p as any).config?.atributos);
          if (attrs.length) pc._atributos = attrs;
          // Multimedia que la IA puede enviar (se resuelve por [[media:tag]] al
          // emitir el texto). Se guarda con "_" para no filtrarse a {{...}}. El
          // catálogo suma la multimedia del producto MÁS la de apoyo de cada
          // atributo, así el mismo mecanismo [[media:tag]] envía una guía de tallas.
          const cat: any[] = [];
          const mm = (p as any).config?.ia_multimedia;
          if (Array.isArray(mm)) for (const x of mm) if (x && x.tag && x.media_url) cat.push(x);
          for (const a of attrs) for (const m of a.media) cat.push(m);
          if (cat.length) pc._ia_multimedia = cat;
          const env = (p as any).config?.envio;
          if (env && typeof env === "object") {
            if (env.agencias && env.agencias.shalom) {
              // Forma nueva: adelanto por agencia → {{adelanto_shalom}}, {{adelanto_olva}}.
              for (const agk of ["shalom", "olva"]) {
                const ag = env.agencias[agk];
                if (ag) pc["adelanto_" + agk] = ag.adelanto_valor ?? "";
              }
              const actk = env.agencia_activa || "shalom";
              const ag = env.agencias[actk];
              pc.adelanto = ag?.adelanto_valor ?? "";
              // {{envio_cobro}}: lo que el cliente paga de envío y que TÚ cobras
              // (entra al total del pedido). Solo el modo "fijo" es un cargo tuyo;
              // "cliente" lo paga a la agencia aparte, y "gratis"/"gratis_desde"
              // no suman. 0 cuando no corresponde.
              pc.envio_cobro = ag?.modo === "fijo" ? (Number(ag.monto_fijo) || 0) : 0;
            } else {
              // Forma vieja (compat): checkboxes + adelanto único.
              for (const [k, v] of Object.entries(env)) {
                if (v == null || typeof v === "object") continue;
                pc["envio_" + k] = v;
              }
              const val = Number(env.adelanto_valor ?? 0);
              const precio = Number((p as any).config?.precio);
              pc.adelanto = env.adelanto_modo === "porcentaje" && Number.isFinite(precio) && precio > 0
                ? (precio * val / 100).toFixed(2)
                : val;
            }
          }
          // Adelanto — prioridad: (1) override limpio del producto
          // (config.adelanto_override, de la pestaña Entrega), (2) lo que venga
          // de config.envio (compat productos viejos), (3) DEFAULT del negocio.
          const ov = (p as any).config?.adelanto_override;
          if (ov != null && ov !== "") {
            pc.adelanto = Number(ov);
          } else if (pc.adelanto == null || pc.adelanto === "") {
            const ent = await loadEntregas(db, run);
            const def = (ent as any)?.entregas?.adelanto_default;
            if (def != null && def !== "") pc.adelanto = Number(def);
          }
          // Cómo se cobra el envío — prioridad: (1) override del producto
          // (pestaña Entrega), (2) regla del negocio, (3) nada → forma vieja.
          // Los montos siguen la misma cascada: un producto puede cobrar un
          // envío distinto, y si no fija monto usa el del negocio.
          const cf: any = (p as any).config ?? {};
          const ent = await loadEntregas(db, run);
          const E: any = (ent as any)?.entregas ?? {};
          const modo = String(cf.envio_modo || E.envio_modo || "");
          if (modo) {
            pc._envio_modo = modo;
            const pick = (a: any, b: any) => (a != null && a !== "" ? a : b);
            pc._envio_cobro_lima = Number(pick(cf.envio_cobro_lima, E.envio_cobro_lima)) || 0;
            pc._envio_cobro_provincia = Number(pick(cf.envio_cobro_provincia, E.envio_cobro_provincia)) || 0;
          }
        }
        (run as any)._prodCtx = pc;
      }
      for (const [k, v] of Object.entries(pc)) if (k !== "_id") ctx[k] = v;
    }
  } catch (_) { /* columnas pendientes */ }
  // 3) Variables del run en curso, y 4) Campos del contacto (lo más específico).
  Object.assign(ctx, run.vars);
  for (const f of fields ?? []) ctx[(f as any).custom_fields.key] = (f as any).value;

  // 5) Opción de compra elegida (unifica versión/pack/cantidad). Su precio PISA
  // al precio suelto del producto: {{precio}} siempre refleja lo que ESTE
  // cliente debe pagar ahora (opción + oferta activa). Va después de los campos
  // porque `opcion_id` es un campo del contacto (persiste entre conversaciones).
  try {
    const { monto, opcion, oferta } = await precioEsperado(db, run, ctx);
    if (opcion) {
      ctx.opcion = opcion.nombre;
      ctx.cantidad = opcion.cantidad ?? 1;
      (ctx as any)._opcion = opcion; // interno: lo usa la acción `entregar`
      // Compat: los flujos viejos escriben {{link_entrega}} a mano → que apunte
      // al primer link de la opción. La entrega completa la manda `entregar`.
      const primer = (Array.isArray(opcion.entrega) ? opcion.entrega : [])
        .find((it: any) => it?.url && it.tipo !== "archivo");
      if (primer) ctx.link_entrega = primer.url;
    }
    if (monto != null) {
      ctx.precio = monto;
      ctx.precio_esperado = monto;
    }
    if (oferta) ctx._oferta = oferta;
  } catch (_) { /* migración 0029 pendiente → sigue el precio de config */ }

  // 6) {{saldo}} = lo que falta cobrar DESPUÉS del adelanto, para la venta por
  // agencia (provincia). Va acá y no en el bloque del producto porque la opción
  // de compra y la oferta activa PISAN {{precio}} justo arriba: restar antes
  // daría el saldo del precio viejo (el de 1 par cuando compró 2).
  // OJO: es solo para provincia. En Lima NO se usa —el motorizado cobra el
  // precio completo— y {{adelanto}} igual viene con valor porque sale del
  // producto, no de la zona: usar {{saldo}} allá cobraría de menos.
  // Incluye el envío que se cobra: el saldo tiene que cerrar adelanto+saldo =
  // total del pedido (precio + envío). Si no, el envío nunca se cobraría.
  if (Number.isFinite(Number(ctx.precio))) {
    const adel = Number(ctx.adelanto);
    const envio = envioCobroDe(ctx, String(ctx.zona_entrega ?? "provincia"));
    ctx.saldo = Math.max(0, +(Number(ctx.precio) + envio - (Number.isFinite(adel) ? adel : 0)).toFixed(2));
    // {{total_cobrar}} = TODO lo que el cliente paga por este pedido, envío
    // incluido. Es lo que se le dice al motorizado de Lima (que cobra el íntegro
    // contraentrega) y el total que se avisa en provincia. Con {{precio}} ahí,
    // un envío cobrado se perdía: el pedido decía 130 y se cobraban 120.
    // (zona real, sin el default a provincia de arriba: {{saldo}} es un concepto
    // de provincia, pero el total se le dice a cualquiera.)
    const envioZona = envioCobroDe(ctx, String(ctx.zona_entrega ?? ""));
    ctx.total_cobrar = +(Number(ctx.precio) + envioZona).toFixed(2);
    ctx.envio_cobrado = envioZona;
  }

  // Último pedido del contacto → variables {{pedido_*}} para los flujos de
  // notificación de físicos (guía, saldo, clave de recojo…). Best-effort.
  try {
    const { data: o } = await db.from("orders")
      .select("estado, amount, currency, shipping").eq("contact_id", run.contact_id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (o) {
      ctx.pedido_estado = (o as any).estado;
      ctx.pedido_monto = (o as any).amount;
      for (const [k, v] of Object.entries((o as any).shipping ?? {})) ctx["pedido_" + k] = v;
    }
  } catch (_) { /* columna/tabla pendiente */ }
  return ctx;
}
function resolve(text: string, ctx: any): string {
  return (text ?? "").replace(/\{\{\s*([\w\-.]+)\s*\}\}/g, (_, k) => (ctx[k] ?? "").toString());
}

// ── Helpers de datos ───────────────────────────────────────────────
async function initialNode(db: SupabaseClient, flowId: string): Promise<Node | null> {
  const { data } = await db.from("flow_nodes").select("*")
    .eq("flow_id", flowId).eq("es_inicial", true).maybeSingle();
  if (data) return data as Node;
  const { data: any0 } = await db.from("flow_nodes").select("*")
    .eq("flow_id", flowId).order("created_at").limit(1).maybeSingle();
  return any0 as Node | null;
}
async function getNode(db: SupabaseClient, nodeId: string): Promise<Node | null> {
  const { data } = await db.from("flow_nodes").select("*").eq("id", nodeId).maybeSingle();
  return data as Node | null;
}
async function nextNode(db: SupabaseClient, flowId: string, nodeId: string, handle: string): Promise<string | null> {
  const { data } = await db.from("flow_edges").select("target_node")
    .eq("flow_id", flowId).eq("source_node", nodeId).eq("source_handle", handle)
    .limit(1).maybeSingle();
  return (data as any)?.target_node ?? null;
}
async function resolveTargetFlow(db: SupabaseClient, channelId: string, config: any): Promise<string | null> {
  if (config?.target_flow_id) return config.target_flow_id;
  if (config?.target_role) {
    const { data } = await db.from("flows").select("id")
      .eq("channel_id", channelId).eq("role", config.target_role).eq("estado", "activo")
      .limit(1).maybeSingle();
    return (data as any)?.id ?? null;
  }
  return null;
}
// ── Bitácora de actividad del contacto (Timeline de la Bandeja) ────
// Best-effort: si la tabla contact_events no existe aún (migración 0021
// pendiente), el error se ignora silenciosamente.
async function logEvent(
  db: SupabaseClient, channelId: string, contactId: string,
  tipo: string, titulo: string, detalle?: string | null,
) {
  try {
    await db.from("contact_events").insert({
      channel_id: channelId, contact_id: contactId, tipo, titulo, detalle: detalle ?? null,
    });
  } catch (_) { /* tabla pendiente de migrar */ }
}

// Atribuye el contacto al producto del flujo (para el emoji y filtros de la
// Bandeja). Se activa al entrar a un flujo ligado a un producto.
async function markProduct(db: SupabaseClient, contactId: string, productId?: string | null) {
  if (!productId) return;
  try { await db.from("contacts").update({ product_id: productId }).eq("id", contactId); } catch (_) { /* columna pendiente */ }
  // Auto-enrolar al remarketing del producto: apenas el contacto muestra interés
  // (entra a la conversación de ese producto), queda inscrito. El scheduler lo
  // saca solo si compra (yaCompro), si responde (el silencio se reinicia) o si
  // pidió no más mensajes (no_remarketing) — así que suscribir a un comprador es
  // inofensivo (se completa antes de enviarle nada). Solo se inscribe la PRIMERA
  // vez: si ya hay una suscripción (activa, pausada, completada o cancelada) no
  // se toca, para no resetear el drip ni pisar un opt-out.
  try {
    const { data: p } = await db.from("products").select("channel_id, config").eq("id", productId).maybeSingle();
    const seqId = (p as any)?.config?.remarketing_seq_id;
    const chId = (p as any)?.channel_id;
    if (seqId && chId) {
      const { data: ex } = await db.from("sequence_subscriptions").select("id")
        .eq("contact_id", contactId).eq("sequence_id", seqId).maybeSingle();
      if (!ex) {
        await db.from("sequence_subscriptions").insert({
          channel_id: chId, contact_id: contactId, sequence_id: seqId,
          estado: "activa", paso_actual: 0, updated_at: new Date().toISOString(),
        });
      }
    }
  } catch (_) { /* sin remarketing / columnas pendientes → no pasa nada */ }
}

async function setField(db: SupabaseClient, channelId: string, contactId: string, key: string, value: string | null) {
  if (!key) return;
  let { data: f } = await db.from("custom_fields").select("id")
    .eq("channel_id", channelId).eq("key", key).limit(1).maybeSingle();
  // Si el flujo escribe en un campo que no existe, se crea solo (dinámico) →
  // el dato persiste y aparece en el panel del contacto. Cumple "declarar
  // campos desde los nodos" sin obligar a crearlos antes en la sección Campos.
  if (!f) {
    const nombre = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    await db.from("custom_fields").upsert(
      { channel_id: channelId, key, nombre, tipo: "text", modo: "dinamico" },
      { onConflict: "channel_id,key", ignoreDuplicates: true },
    );
    ({ data: f } = await db.from("custom_fields").select("id")
      .eq("channel_id", channelId).eq("key", key).maybeSingle());
  }
  if (!f) return;
  await db.from("contact_field_values").upsert(
    { contact_id: contactId, field_id: (f as any).id, value, updated_at: new Date().toISOString() },
    { onConflict: "contact_id,field_id" },
  );
}
async function hasTag(db: SupabaseClient, contactId: string, tagName: string): Promise<boolean> {
  const { data } = await db.from("contact_tags")
    .select("tag_id, tags!inner(nombre)").eq("contact_id", contactId);
  return (data ?? []).some((r: any) => r.tags?.nombre === tagName);
}
async function addTag(db: SupabaseClient, channelId: string, contactId: string, tagName: string) {
  let { data: tag } = await db.from("tags").select("id")
    .eq("channel_id", channelId).eq("nombre", tagName).maybeSingle();
  if (!tag) {
    const ins = await db.from("tags").insert({ channel_id: channelId, nombre: tagName }).select("id").single();
    tag = ins.data;
  }
  if (tag) await db.from("contact_tags").upsert({ contact_id: contactId, tag_id: (tag as any).id }, { onConflict: "contact_id,tag_id" });
}
async function removeTag(db: SupabaseClient, channelId: string, contactId: string, tagName: string) {
  const { data: tag } = await db.from("tags").select("id")
    .eq("channel_id", channelId).eq("nombre", tagName).maybeSingle();
  if (tag) await db.from("contact_tags").delete().eq("contact_id", contactId).eq("tag_id", (tag as any).id);
}
function normalize(s: string): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

// Elige una variante al azar PONDERADA por su peso (default 1). Si todos los
// pesos son 0, cae a una selección uniforme.
function pickWeighted<T extends { peso?: number }>(items: T[]): T {
  const weights = items.map((v) => Math.max(0, Number(v.peso ?? 1)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r < 0) return items[i]; }
  return items[items.length - 1];
}
