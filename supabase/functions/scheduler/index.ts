// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: scheduler  (INTERNA — verify_jwt=false)
//   Un "tick" del reloj del sistema. La llama un cron (pg_cron / Supabase
//   Cron) cada minuto. Hace dos cosas:
//     1) Despierta los nodos Esperar/debounce vencidos (flow_runs.wake_at).
//     2) Dispara las secuencias de remarketing conscientes de la conversación.
//   Se protege con un secreto compartido (header x-scheduler-secret).
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, getChannelSecrets } from "../_shared/db.ts";
import { deliverStep, runEngine, startFlowRun, ventana24hAbierta, recomputeStageOnLoss } from "../_shared/engine.ts";
import { processCampaigns, sendTemplateToContact } from "../_shared/campaigns.ts";
import { sendTelegram } from "../_shared/telegram.ts";
import { construirResumen, localParts, localDayStartUTC, ymd } from "../_shared/resumen.ts";

const db = serviceClient();

// Anti-spam: ventana de enfriamiento entre envíos AUTOMÁTICOS de marketing a un
// mismo contacto (secuencias + recordatorios de adelanto). Las campañas, que son
// deliberadas, NO se frenan pero SÍ marcan el timestamp (así un envío del negocio
// suprime el nudge automático de ese día). Los avisos transaccionales de pedido
// (guía, clave, "llegó a agencia") NO cuentan: son mensajes que el cliente espera.
const ANTISPAM_MS = 18 * 3600 * 1000;
// Un flow_run 'esperando' cuenta como "conversación activa" (y pausa el
// remarketing) SOLO mientras sea RECIENTE. Los flujos de venta terminan en un nodo
// `pregunta`/`ia` esperando la respuesta del cliente y NO ponen timeout que cierre
// el run: si el cliente se va tras el saludo, ese run quedaría 'esperando' para
// siempre y bloquearía su remarketing PARA SIEMPRE — justo al lead silencioso al
// que apunta la secuencia. Pasado este tope de inactividad, un 'esperando' rancio
// se considera conversación abandonada y ya NO bloquea. (El propio temporizador del
// paso ya garantiza que el cliente lleva ≥ umbral callado antes de llegar acá.)
const RUN_STALE_MS = 3 * 3600 * 1000;
const tocoMktReciente = (c: any, now: number) =>
  !!c?.ultimo_auto_msg_at && (now - new Date(c.ultimo_auto_msg_at).getTime()) < ANTISPAM_MS;
async function marcarTocoMkt(contactId: string) {
  await db.from("contacts").update({ ultimo_auto_msg_at: new Date().toISOString() })
    .eq("id", contactId).then(() => {}, () => {}); // best-effort (columna 0056)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Protección: FAIL-CLOSED. Sin secreto configurado no se atiende a nadie.
  // Antes era "si hay secreto, exigirlo": bastaba con que alguien borrara o
  // renombrara SCHEDULER_SECRET para que este endpoint —que dispara campañas y
  // remarketing a clientes REALES— quedara abierto a internet, y nada avisaba.
  // El webhook de WhatsApp ya usaba este criterio; acá faltaba.
  const secret = Deno.env.get("SCHEDULER_SECRET");
  if (!secret) {
    console.error("[scheduler] falta SCHEDULER_SECRET — no se atiende el tick");
    return json({ error: "sin_secreto" }, 503);
  }
  if (req.headers.get("x-scheduler-secret") !== secret) {
    return json({ error: "forbidden" }, 403);
  }

  const now = Date.now();
  let woke = 0, fired = 0;

  // ── 1) Despertar Esperar/debounce vencidos ────────────────────────
  const { data: runs } = await db.from("flow_runs")
    .select("channel_id, contact_id")
    .eq("estado", "esperando").not("wake_at", "is", null)
    .lte("wake_at", new Date().toISOString()).limit(100);
  for (const r of runs ?? []) {
    try { await runEngine(db, (r as any).channel_id, (r as any).contact_id, { type: "resume" }); woke++; }
    catch (e) { console.error("[scheduler] wake:", (e as any)?.message ?? e); }
  }

  // ── 2) Secuencias de remarketing ──────────────────────────────────
  const { data: subs } = await db.from("sequence_subscriptions")
    .select("id, channel_id, contact_id, sequence_id, paso_actual, updated_at, suscrito_at")
    .eq("estado", "activa").limit(200);
  for (const s of subs ?? []) {
    try { if (await processSub(s, now)) fired++; }
    catch (e) { console.error("[scheduler] seq:", (e as any)?.message ?? e); }
  }

  // ── 3) Campañas / broadcast ───────────────────────────────────────
  try { await processCampaigns(db); }
  catch (e) { console.error("[scheduler] campaigns:", (e as any)?.message ?? e); }

  // ── 4) Recordatorios anclados a pedido (§6-SEPTIES) ───────────────
  // Trigger tipo `pedido_recordatorio` config { estado, horas }: si un pedido
  // lleva ≥ horas en ese estado, dispara el flujo UNA sola vez (marca en
  // shipping). Ej.: esperando_adelanto sin pago → nudge; en_agencia sin
  // cobrar el saldo → nudge urgente (la agencia devuelve el paquete).
  let nudged = 0;
  try { nudged = await processOrderReminders(now); }
  catch (e) { console.error("[scheduler] pedidos:", (e as any)?.message ?? e); }

  // ── 5) Adelantos: recordar y vencer ───────────────────────────────
  let recordados = 0, vencidos = 0;
  try { ({ recordados, vencidos } = await processAdelantos(now)); }
  catch (e) { console.error("[scheduler] adelantos:", (e as any)?.message ?? e); }

  // ── 6) Resúmenes diarios a Telegram (mañana / noche) ──────────────
  let resumenes = 0;
  try { resumenes = await processResumenes(); }
  catch (e) { console.error("[scheduler] resumenes:", (e as any)?.message ?? e); }

  return json({ ok: true, woke, fired, nudged, recordados, vencidos, resumenes });
});

// ── Resúmenes diarios ───────────────────────────────────────────────
// Dos avisos que el operador programa (Canales → Avisos): mañana = cómo fue
// AYER, noche = cómo va HOY. Cada tick (por minuto) revisa si toca mandarlos.
// El texto lo arma construirResumen() (compartido con los comandos de Telegram).
async function processResumenes(): Promise<number> {
  const now = new Date();
  let sent = 0;
  const { data: chans } = await db.from("channels")
    .select("id, nombre, timezone, moneda, resumenes, resumen_estado, telegram_chat_ids")
    .not("resumenes", "is", null).limit(100);
  for (const ch of chans ?? []) {
    try {
      const cfg = (ch as any).resumenes ?? {};
      const chatIds = (ch as any).telegram_chat_ids ?? [];
      if (!chatIds.length) continue;
      const tz = (ch as any).timezone || "America/Lima";
      const lp = localParts(now, tz);
      const hoy = ymd(lp.y, lp.mo, lp.d);
      const nowMin = lp.hh * 60 + lp.mm;
      const estado = (ch as any).resumen_estado ?? {};
      let dirty = false;

      for (const tipo of ["manana", "noche"] as const) {
        const t = cfg[tipo];
        if (!t || t.on !== true || typeof t.hora !== "string") continue;
        const [hh, mm] = t.hora.split(":").map((x: string) => parseInt(x, 10));
        if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
        const horaMin = hh * 60 + mm;
        // Ventana de 60 min desde la hora fijada: tolera atrasos del cron sin
        // que activarlo a media tarde dispare el de la mañana al toque.
        if (nowMin < horaMin || nowMin >= horaMin + 60) continue;
        if (estado[tipo] === hoy) continue; // ya se mandó hoy

        // Mañana resume AYER; noche resume HOY (fecha local).
        let diaYmd = hoy;
        if (tipo === "manana") {
          const inicioHoy = localDayStartUTC(lp.y, lp.mo, lp.d, tz);
          const ay = localParts(new Date(inicioHoy.getTime() - 12 * 3600 * 1000), tz);
          diaYmd = ymd(ay.y, ay.mo, ay.d);
        }
        const cual = tipo === "manana" ? "ayer" : "hoy";
        const texto = await construirResumen(db, ch, diaYmd, cual);
        const secrets = await getChannelSecrets(db, (ch as any).id);
        const token = secrets?.telegram_bot_token;
        if (token) { await sendTelegram(token, chatIds, texto); sent++; }
        estado[tipo] = hoy; // marcar aunque falte token (no reintentar en bucle)
        dirty = true;
      }
      if (dirty) await db.from("channels").update({ resumen_estado: estado }).eq("id", (ch as any).id);
    } catch (e) { console.error("[processResumenes]", (e as any)?.message ?? e); }
  }
  return sent;
}

// Un pedido de provincia se crea apenas el cliente da sus datos (todavía sin
// pagar), así que la columna "Esperando adelanto" se llenaría de gente que
// nunca pagó. Esto la mantiene limpia sola: primero se le recuerda, y si igual
// no paga, el pedido vence. Las dos cosas son activables y configurables — si
// están apagadas, el Kanban se comporta como antes y lo maneja el operador.
//   pedidos_config.adelanto = {
//     nudge:      { activo, horas, mensaje },
//     vencimiento:{ activo, horas }
//   }
async function processAdelantos(now: number): Promise<{ recordados: number; vencidos: number }> {
  let recordados = 0, vencidos = 0;
  const { data: chans } = await db.from("channels").select("id, pedidos_config").limit(50);
  for (const ch of chans ?? []) {
    const cfg = (ch as any)?.pedidos_config?.adelanto;
    if (!cfg) continue;
    const chId = (ch as any).id;

    // Vencer primero: si ya pasó el plazo, no tiene sentido recordarle.
    const venc = cfg.vencimiento ?? {};
    if (venc.activo && Number(venc.horas) > 0) {
      const cutoff = new Date(now - Number(venc.horas) * 3600 * 1000).toISOString();
      const { data: viejos } = await db.from("orders")
        .select("id, contact_id")
        .eq("channel_id", chId).eq("estado", "esperando_adelanto")
        .lte("created_at", cutoff).limit(50);
      for (const o of viejos ?? []) {
        await db.from("orders").update({ estado: "cancelado", updated_at: new Date().toISOString() }).eq("id", (o as any).id);
        // Recalcular la ETAPA del embudo (igual que la cancelación manual en order-update):
        // sin esto el contacto se quedaba en "interesado" (mapeo de esperando_adelanto)
        // aunque su pedido ya venció → el embudo lo mostraba como lead vivo y ofrecía
        // "Reactivar" un pedido muerto. Baja a "perdido" si no le queda otra compra viva.
        await recomputeStageOnLoss(db, chId, (o as any).contact_id).catch(() => {});
        await db.from("contact_events").insert({
          channel_id: chId, contact_id: (o as any).contact_id, tipo: "nota",
          titulo: "Pedido vencido", detalle: `Sin adelanto tras ${venc.horas} h`,
        }).then(() => {}, () => {}); // best-effort
        vencidos++;
      }
    }

    // Recordar: una sola vez por pedido (se marca en shipping).
    const nudge = cfg.nudge ?? {};
    if (nudge.activo && Number(nudge.horas) > 0 && String(nudge.mensaje ?? "").trim()) {
      const cutoff = new Date(now - Number(nudge.horas) * 3600 * 1000).toISOString();
      const { data: pend } = await db.from("orders")
        .select("id, contact_id, shipping")
        .eq("channel_id", chId).eq("estado", "esperando_adelanto")
        .lte("created_at", cutoff).limit(50);
      for (const o of pend ?? []) {
        const ship = (o as any).shipping ?? {};
        if (ship._nudge_adelanto) continue; // ya se le recordó
        // Respeta al que pidió que no le escriban (mismo criterio que el
        // remarketing: un "no me escriban" vale para todo).
        const { data: c } = await db.from("contacts")
          .select("no_remarketing, bot_activo, ultimo_auto_msg_at").eq("id", (o as any).contact_id).maybeSingle();
        if ((c as any)?.no_remarketing === true) continue;
        if ((c as any)?.bot_activo === false) continue; // lo tomó un humano
        if (await antispamOn((o as any).channel_id) && tocoMktReciente(c, now)) continue; // anti-spam (si está activo): ya recibió un envío automático hace poco
        if (!await enHorario(chId)) continue;
        try {
          // Fuera de la ventana de 24h el texto libre lo rechaza Meta (el cliente
          // que no pagó el adelanto suele estar callado → ventana cerrada). Si el
          // negocio configuró una plantilla de recordatorio, esa sí llega (y
          // dentro del FEP, gratis); si no, se POSTERGA sin marcar → se reintenta
          // cuando el cliente reabra la ventana, o el pedido vence solo (arriba).
          let enviado = false;
          if (await ventana24hAbierta(db, (o as any).contact_id)) {
            await deliverStep(db, chId, (o as any).contact_id, { mensaje: nudge.mensaje });
            enviado = true;
          } else if (nudge.template_name) {
            await sendTemplateToContact(db, chId, (o as any).contact_id, {
              name: nudge.template_name, language: nudge.template_lang, params: nudge.template_params,
            });
            enviado = true;
          }
          if (enviado) {
            await db.from("orders").update({
              shipping: { ...ship, _nudge_adelanto: new Date().toISOString() },
              updated_at: new Date().toISOString(),
            }).eq("id", (o as any).id);
            await marcarTocoMkt((o as any).contact_id); // sella el anti-spam
            recordados++;
          }
        } catch (e) { console.error("[scheduler] nudge adelanto:", (e as any)?.message ?? e); }
      }
    }
  }
  return { recordados, vencidos };
}

async function processOrderReminders(now: number): Promise<number> {
  const { data: trigs } = await db.from("flow_triggers")
    .select("flow_id, channel_id, config, interrumpe, flows!inner(estado)")
    .eq("tipo", "pedido_recordatorio").eq("activo", true).limit(50);
  let n = 0;
  for (const t of trigs ?? []) {
    if ((t as any).flows?.estado !== "activo") continue;
    const estado = (t as any).config?.estado;
    const horas = Number((t as any).config?.horas ?? 24);
    if (!estado || !(horas > 0)) continue;
    const cutoff = new Date(now - horas * 3600 * 1000).toISOString();
    const { data: ords } = await db.from("orders")
      .select("id, contact_id, shipping")
      .eq("channel_id", (t as any).channel_id).eq("estado", estado)
      .lte("updated_at", cutoff).limit(25);
    for (const o of ords ?? []) {
      if (!(o as any).contact_id) continue;
      const ship = (o as any).shipping ?? {};
      const mark = "_nudge_" + estado; // una sola vez por estado
      if (ship[mark]) continue;
      try {
        // El flujo del recordatorio emite texto libre → fuera de la ventana de
        // 24h Meta lo rechaza y el cliente no recibe nada. Si no se le puede
        // alcanzar, se POSTERGA sin marcar (no se pierde: se reintenta cuando
        // reabra la ventana, o el pedido cambia de estado y deja de aplicar).
        if (!await ventana24hAbierta(db, (o as any).contact_id)) continue;
        const ok = await startFlowRun(db, (t as any).channel_id, (o as any).contact_id,
          (t as any).flow_id, { force: !!(t as any).interrumpe });
        if (ok) {
          await db.from("orders").update({ shipping: { ...ship, [mark]: new Date().toISOString() } })
            .eq("id", (o as any).id);
          n++;
        }
      } catch (e) { console.error("[scheduler] nudge:", (e as any)?.message ?? e); }
    }
  }
  return n;
}

// ¿El contacto ya compró? Mira la etapa y, por si acaso, un pedido confirmado
// (la etapa se puede mover a mano; la venta real no miente).
// ¿El contacto ya es cliente FIRME? = compró (venta cerrada al 100%) O se
// comprometió (Lima contraentrega confirmada esperando al motorizado, o
// provincia con el adelanto ya validado). En ambos casos NO hay que seguir
// mandándole remarketing: ofrecerle "última oportunidad / descuento" a alguien
// que ya aceptó pagar el precio completo queda mal y quema la marca.
// El embudo mapea todos los estados de compromiso a la etapa "confirmado" y las
// ventas cerradas a "comprado", así que la etapa basta; igual se revisan los
// estados del pedido por si la etapa quedó rezagada.
// OJO: `esperando_adelanto` y el digital `pendiente` NO cuentan (son etapa
// "interesado" = prospecto que aún puede abandonar) → a esos SÍ se les sigue.
const ESTADOS_FIRMES = [
  "confirmada", "entregado_cobrado", "recogido", "saldo_pagado",       // comprado (100%)
  "confirmado", "en_reparto", "reprogramado", "adelanto_validado",     // comprometido
  "por_despachar", "despachado", "en_agencia",
];
async function yaCompro(contactId: string, stage: string | null): Promise<boolean> {
  const st = String(stage ?? "").toLowerCase();
  if (st === "comprado" || st === "confirmado") return true;
  try {
    const { data } = await db.from("orders").select("id")
      .eq("contact_id", contactId)
      .in("estado", ESTADOS_FIRMES)
      .limit(1).maybeSingle();
    return !!data;
  } catch (_) { return false; }
}

// Horario permitido del remarketing (hora local del negocio). Sin configurar,
// se manda a cualquier hora (lo de antes). Cacheado por tick.
const horarioCache = new Map<string, any>();
async function enHorario(channelId: string): Promise<boolean> {
  try {
    let cfg = horarioCache.get(channelId);
    if (cfg === undefined) {
      const { data } = await db.from("channels").select("remarketing, timezone").eq("id", channelId).maybeSingle();
      cfg = data ?? null;
      horarioCache.set(channelId, cfg);
    }
    const r = cfg?.remarketing;
    if (!r || r.activo === false || !r.desde || !r.hasta) return true; // sin restricción
    const tz = cfg?.timezone || "America/Lima";
    const hhmm = new Intl.DateTimeFormat("es-PE", {
      timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date()).replace(/^24/, "00"); // ICU a veces da "24:xx" a medianoche → "00:xx"
    // Comparación lexicográfica de "HH:MM" (funciona con ceros a la izquierda).
    return hhmm >= String(r.desde) && hhmm <= String(r.hasta);
  } catch (_) { return true; } // ante la duda, no bloquear el remarketing
}

// ¿El anti-spam de 18h está activo en este canal? Recomendado ON (protege el
// número de un baneo por sobre-envío), pero el negocio puede apagarlo. Default
// ON si no está configurado. Reusa el caché de la config de remarketing.
async function antispamOn(channelId: string): Promise<boolean> {
  try {
    let cfg = horarioCache.get(channelId);
    if (cfg === undefined) {
      const { data } = await db.from("channels").select("remarketing, timezone").eq("id", channelId).maybeSingle();
      cfg = data ?? null;
      horarioCache.set(channelId, cfg);
    }
    return (cfg?.remarketing?.antispam ?? true) !== false;
  } catch (_) { return true; }
}

async function processSub(s: any, now: number): Promise<boolean> {
  const { data: seq } = await db.from("sequences").select("*").eq("id", s.sequence_id).maybeSingle();
  const pasos = Array.isArray((seq as any)?.pasos) ? (seq as any).pasos : [];
  // Modo de disparo (0064). 'goteo' = programado: ignora el silencio y NO se
  // reinicia con la respuesta del cliente; corre su calendario desde que se
  // suscribió. 'reenganche' (default) = el de siempre (se ancla al silencio).
  const esGoteo = (seq as any)?.modo === "goteo";
  if (!seq || !(seq as any).activo || s.paso_actual >= pasos.length) {
    await db.from("sequence_subscriptions")
      .update({ estado: "completada", updated_at: new Date().toISOString() }).eq("id", s.id);
    return false;
  }
  const paso = pasos[s.paso_actual];

  const { data: c } = await db.from("contacts")
    .select("ultimo_mensaje_cliente_at, bot_activo, stage, no_remarketing, ultimo_auto_msg_at").eq("id", s.contact_id).maybeSingle();
  if (!c) return false;
  if ((c as any).bot_activo === false) return false; // humano tomó la conversación

  // ── Salvaguardas (requisitos 2 y 16) ──
  // 1) Pidió que no le escriban → se cancela, no se reintenta nunca más.
  if ((c as any).no_remarketing === true) {
    await db.from("sequence_subscriptions")
      .update({ estado: "cancelada", updated_at: new Date().toISOString() }).eq("id", s.id);
    return false;
  }
  // 2) Ya compró O se comprometió → sale del remarketing. Mandarle "última
  //    oportunidad" a alguien que ya pagó, o que ya aceptó pagar y espera su
  //    entrega, es vergonzoso y quema la marca.
  if (await yaCompro(s.contact_id, (c as any).stage)) {
    await db.from("sequence_subscriptions")
      .update({ estado: "completada", updated_at: new Date().toISOString() }).eq("id", s.id);
    return false;
  }
  // 3) Fuera del horario permitido → esperar al próximo tick (no se pierde el
  //    paso, solo se posterga hasta una hora decente).
  if (!await enHorario(s.channel_id)) return false;

  // Temporizador del paso: cuenta desde el MÁS RECIENTE entre (a) cuándo se envió
  // el paso anterior —`updated_at` se sella en cada avance— y (b) el último
  // mensaje del cliente. Así cada paso corre DESDE EL PASO ANTERIOR (el "espera
  // entre toques" que configura el negocio), pero si el cliente RESPONDE su
  // mensaje es más reciente → el temporizador se REINICIA y no se le insiste
  // mientras haya conversación. (El paso 1 no tiene "paso anterior": updated_at
  // ≈ suscrito_at → cuenta desde que mostró interés / su último mensaje.)
  // En 'goteo' el ancla NO incluye el mensaje del cliente → el reloj corre desde
  // la suscripción / el paso anterior, sin reiniciarse si el cliente responde.
  const marcas = (esGoteo
    ? [s.updated_at, s.suscrito_at]
    : [(c as any).ultimo_mensaje_cliente_at, s.updated_at, s.suscrito_at])
    .map((t) => (t ? new Date(t).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  const anchor = marcas.length ? Math.max(...marcas) : now;
  const silenceSec = (now - anchor) / 1000;
  const umbral = Number(paso.umbral_silencio_seg ?? paso.delay_seg ?? 0);
  if (silenceSec < umbral) return false; // aún no toca

  // No interrumpir una conversación GENUINAMENTE activa → reintentar en el próximo
  // tick. Un run 'activo' se está ejecutando ahora → siempre espera. Uno 'esperando'
  // bloquea solo si su última actividad es reciente (más nueva que lo que el paso
  // lleva esperando, con tope RUN_STALE_MS); si quedó 'esperando' hace rato (cliente
  // que abandonó tras el saludo, sin timeout que cierre el run) YA NO bloquea, así la
  // secuencia por fin alcanza al silencioso. (Solo puede haber UN run activo/esperando
  // por contacto: índice único parcial idx_runs_lock.)
  const { data: active } = await db.from("flow_runs").select("estado, updated_at")
    .eq("contact_id", s.contact_id).in("estado", ["activo", "esperando"]).maybeSingle();
  if (active) {
    const idleMs = now - new Date((active as any).updated_at).getTime();
    const graceMs = Math.min(umbral * 1000, RUN_STALE_MS);
    // Un run 'activo' se está ejecutando AHORA → nunca lo cortamos (en cualquier
    // modo). El 'esperando' idle solo frena al reenganche (que respeta el
    // silencio); el goteo lo ignora — su gracia es no meterse a mitad de una
    // ejecución viva, no esperar a que el cliente se calle.
    if ((active as any).estado === "activo") return false;
    if (!esGoteo && idleMs < graceMs) return false;
  }

  // Anti-spam: no encimar envíos automáticos. Si ya recibió un toque de marketing
  // (otra secuencia, un nudge, o una campaña) dentro de la ventana de enfriamiento,
  // se posterga al próximo tick — no se pierde el paso, solo espera.
  if (await antispamOn(s.channel_id) && tocoMktReciente(c, now)) return false;

  // Oferta identificada: el paso puede pegar un DESCUENTO al contacto para una
  // opción concreta. El motor lo lee al validar el pago (precioEsperado), así un
  // "te dejo el X a S/Y" no es solo texto: el OCR valida contra el precio con
  // descuento, y el {{precio}} del mensaje ya sale rebajado. Vence a las N horas.
  // ¿Este paso REALMENTE va a enviar? La plantilla (HSM) sale SIEMPRE; el flujo y el
  // mensaje de texto libre SOLO dentro de la ventana de 24h. Se calcula ANTES de grabar
  // la oferta: si no, el cliente nunca vería "te dejo a S/Y" pero el validador aceptaría
  // igual ese precio rebajado (descuento fantasma / pérdida de margen).
  const enVentana = await ventana24hAbierta(db, s.contact_id);
  const vaAEnviar = !!paso.template_name
    || (!!paso.flow_id && enVentana)
    || (!!(paso.mensaje || paso.bubbles?.length || paso.variantes?.length) && enVentana);
  if (vaAEnviar && paso.oferta && paso.oferta.version_id && paso.oferta.precio != null) {
    const venceH = Number(paso.oferta.vence_horas ?? 0);
    const vence = venceH > 0 ? new Date(now + venceH * 3600 * 1000).toISOString() : null;
    await db.from("contacts").update({
      oferta_activa: { opcion_id: paso.oferta.version_id, precio: Number(paso.oferta.precio), vence, origen: "remarketing" },
    }).eq("id", s.contact_id).then(() => {}, () => {}); // best-effort (columna 0030)
  }

  // Disparar el paso: flujo, plantilla HSM (fuera de 24h) o mensaje/burbujas.
  // `toco` marca si de verdad salió algo (para sellar el anti-spam solo entonces).
  let toco = false;
  if (paso.flow_id) {
    // El flujo arranca con texto libre (un saludo) casi siempre → igual que el mensaje,
    // SOLO se corre dentro de la ventana; fuera, se avanza sin correrlo. Antes esta rama
    // NO chequeaba la ventana → emitía texto libre fuera de 24h (violación de política de
    // WhatsApp: degrada/banea el número). Para alcanzar a un silencioso, usa una plantilla.
    if (enVentana) { await startFlowRun(db, s.channel_id, s.contact_id, paso.flow_id); toco = true; }
    else console.warn(`[secuencia] paso ${s.paso_actual} de ${s.contact_id}: flujo fuera de 24h → no se corre (ponle plantilla al paso)`);
  }
  else if (paso.template_name) {
    await sendTemplateToContact(db, s.channel_id, s.contact_id, {
      name: paso.template_name, language: paso.template_lang, params: paso.template_params,
    });
    toco = true;
  }
  // Mensaje del paso: texto simple, burbujas multimedia o rotación de variantes.
  // Las secuencias se disparan por silencio → la ventana de 24h casi siempre
  // está cerrada, y el texto libre lo rechaza Meta. Si el paso no tiene
  // plantilla (rama de arriba), solo se envía dentro de la ventana; fuera, se
  // avanza igual para no estancar la secuencia (para alcanzar a un silencioso
  // hay que ponerle una plantilla a este paso).
  else if (paso.mensaje || paso.bubbles?.length || paso.variantes?.length) {
    if (enVentana) {
      await deliverStep(db, s.channel_id, s.contact_id, paso);
      toco = true;
    } else {
      console.warn(`[secuencia] paso ${s.paso_actual} de ${s.contact_id}: fuera de 24h y sin plantilla → no se envía (ponle plantilla al paso para alcanzarlo)`);
    }
  }
  if (toco) await marcarTocoMkt(s.contact_id);

  const next = s.paso_actual + 1;
  await db.from("sequence_subscriptions").update({
    paso_actual: next,
    estado: next >= pasos.length ? "completada" : "activa",
    updated_at: new Date().toISOString(),
  }).eq("id", s.id);
  return true;
}
