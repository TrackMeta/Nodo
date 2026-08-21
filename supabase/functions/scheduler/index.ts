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
  let woke = 0, fired = 0, reaped = 0;

  // El caché de config de remarketing (horario/timezone/anti-spam) es por TICK: se
  // limpia al inicio de cada invocación. El isolate de Deno vive muchos ticks, así
  // que un Map de módulo que nunca se limpia congelaba la config → un cambio del
  // operador en las horas de remarketing no tomaba efecto hasta reciclar el isolate.
  horarioCache.clear();

  // ── 1) Despertar Esperar/debounce vencidos ────────────────────────
  const { data: runs } = await db.from("flow_runs")
    .select("channel_id, contact_id")
    .eq("estado", "esperando").not("wake_at", "is", null)
    .lte("wake_at", new Date().toISOString())
    .order("wake_at", { ascending: true })   // los más vencidos primero: sin ORDER BY, con más de 100 pendientes Postgres podía devolver siempre el mismo subconjunto y matar de hambre al resto
    .limit(100);
  for (const r of runs ?? []) {
    try {
      // El operador pudo TOMAR el chat mientras el run estaba parqueado en un "Esperar"/timeout.
      // Sin este chequeo, al vencer wake_at el scheduler reanudaba y disparaba el mensaje parqueado
      // ENCIMA del operador (el guard de bot_activo del webhook no cubre este camino). Igual que ya
      // hacen las inyecciones de remarketing de este archivo.
      const { data: ct } = await db.from("contacts").select("bot_activo").eq("id", (r as any).contact_id).maybeSingle();
      if ((ct as any)?.bot_activo === false) continue;
      await runEngine(db, (r as any).channel_id, (r as any).contact_id, { type: "resume" }); woke++;
    } catch (e) { console.error("[scheduler] wake:", (e as any)?.message ?? e); }
  }

  // ── 1b) Reaper de runs 'activo' zombis ────────────────────────────
  // Si el isolate murió entre el INSERT de startRun (estado='activo') y el primer
  // saveRun (wall-time/OOM/deploy a mitad), la fila queda 'activo' PARA SIEMPRE: el
  // wake loop de arriba solo mira 'esperando', el índice único idx_runs_lock impide
  // crear un run nuevo, y cada mensaje entrante entra a resumeRun sin `_await` → se
  // descarta (dead-air total) y el remarketing del contacto queda bloqueado sin
  // recuperación automática. Ningún run real dura horas → un 'activo' inactivo hace
  // más de RUN_STALE_MS es un zombi: se cierra para liberar el lock (el próximo
  // mensaje del cliente arranca un run limpio).
  const zombieCut = new Date(now - RUN_STALE_MS).toISOString();
  const { data: zombies } = await db.from("flow_runs")
    .select("id, channel_id, contact_id")
    .eq("estado", "activo").lt("updated_at", zombieCut).limit(50);
  for (const z of zombies ?? []) {
    const { data: done } = await db.from("flow_runs")
      .update({ estado: "completado", wake_at: null })
      .eq("id", (z as any).id).eq("estado", "activo").select("id");
    if (done && done.length) { reaped++; console.warn(`[scheduler] run zombi cerrado (contacto ${(z as any).contact_id})`); }
  }

  // ── 2) Secuencias de remarketing ──────────────────────────────────
  const { data: subs } = await db.from("sequence_subscriptions")
    .select("id, channel_id, contact_id, sequence_id, paso_actual, updated_at, suscrito_at")
    .eq("estado", "activa")
    .order("updated_at", { ascending: true })   // la menos tocada primero: evita inanición si hay más de 200 subs activas
    .limit(200);
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

  return json({ ok: true, woke, fired, reaped, nudged, recordados, vencidos, resumenes });
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
            // Se pasa `o.id` para que {{pedido_saldo}}/{{pedido_sede}} resuelvan ESTE pedido
            // (el que espera adelanto). Sin el orderId, buildContext caía al pedido más
            // reciente del contacto → un cliente con un pedido nuevo recibía el recordatorio
            // con el saldo/sede del pedido equivocado.
            await deliverStep(db, chId, (o as any).contact_id, { mensaje: nudge.mensaje }, (o as any).id);
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
      // Si un HUMANO tomó la conversación (bot_activo=false), NO inyectar un flujo
      // automático encima del agente — mismo guard que processAdelantos/processSub.
      const { data: ct } = await db.from("contacts").select("bot_activo").eq("id", (o as any).contact_id).maybeSingle();
      if ((ct as any)?.bot_activo === false) continue;
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
async function yaCompro(contactId: string, productId: string | null): Promise<boolean> {
  try {
    // Veto POR PRODUCTO (decisión de Rodrigo): un contacto SOLO sale del remarketing de ESTE
    // producto si ya lo compró/comprometió — NO de TODO por haber comprado otra cosa. En un
    // negocio de compra repetida eso recupera el re-enganche de otros productos. (Antes era
    // GLOBAL: cualquier compra vetaba todo el remarketing para siempre.) NO se usa el `stage`
    // del contacto (es global, no por producto). Sin product_id (secuencia general/legacy) →
    // veto GLOBAL como antes (cualquier compra firme).
    let q = db.from("orders").select("id").eq("contact_id", contactId).in("estado", ESTADOS_FIRMES);
    if (productId) q = q.eq("product_id", productId);
    const { data } = await q.limit(1).maybeSingle();
    return !!data;
  } catch (_) { return false; }
}

// Producto DUEÑO de una secuencia de remarketing: se deriva del mapa
// products.config.remarketing_seqs (segmento→sequence_id) o remarketing_seq_id, porque la
// sub NO guarda product_id y contacts.product_id es LAST-WRITE (markProduct lo pisa con el
// último producto tocado) → usarlo para el veto por-producto daba el producto equivocado
// (spam a un comprador de A, o baja de un lead vivo de A por comprar B). Cacheado por tick.
// Si la secuencia no mapea a ningún producto (general/legacy/enroll manual) → null → yaCompro
// cae al veto GLOBAL (cualquier compra firme), que es el fallback seguro (no spamear).
const prodSeqCache = new Map<string, Array<{ id: string; seqs: Set<string> }>>();
async function productoDeSecuencia(channelId: string, sequenceId: string): Promise<string | null> {
  try {
    if (!sequenceId) return null;
    let prods = prodSeqCache.get(channelId);
    if (!prods) {
      const { data } = await db.from("products").select("id, config").eq("channel_id", channelId);
      prods = (data ?? []).map((p: any) => {
        const cfg = p.config ?? {};
        const seqs = new Set<string>();
        const map = (cfg.remarketing_seqs && typeof cfg.remarketing_seqs === "object") ? cfg.remarketing_seqs : {};
        for (const v of Object.values(map)) if (v) seqs.add(String(v));
        if (cfg.remarketing_seq_id) seqs.add(String(cfg.remarketing_seq_id));
        return { id: p.id as string, seqs };
      });
      prodSeqCache.set(channelId, prods);
    }
    const hit = prods.find((p) => p.seqs.has(String(sequenceId)));
    return hit ? hit.id : null;
  } catch (_) { return null; }
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
    // Comparación lexicográfica de "HH:MM" (funciona con ceros a la izquierda). Si la
    // ventana CRUZA MEDIANOCHE (desde > hasta, p.ej. 20:00–08:00) hay que unir los dos
    // tramos con OR; con AND, como antes, NINGÚN instante caía dentro → el remarketing
    // nocturno quedaba apagado 24h sin error visible.
    const d = String(r.desde), h = String(r.hasta);
    return d <= h ? (hhmm >= d && hhmm <= h) : (hhmm >= d || hhmm <= h);
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
  // Secuencia PAUSADA (existe pero activo=false): NO tocar la sub — se queda 'activa'
  // y se reanuda sola cuando el operador la reactiva. Antes caía en el mismo branch
  // que 'borrada/terminada' y se marcaba 'completada' → al reactivar nadie se
  // reanudaba: los toques en vuelo se perdían para siempre (200 leads a mitad de
  // camino quedaban muertos con un solo toggle). "Pausar" debe ser reversible.
  if (seq && (seq as any).activo === false) return false;
  if (!seq || s.paso_actual >= pasos.length) {
    await db.from("sequence_subscriptions")
      .update({ estado: "completada", updated_at: new Date().toISOString() }).eq("id", s.id);
    return false;
  }
  const paso = pasos[s.paso_actual];

  const { data: c } = await db.from("contacts")
    .select("ultimo_mensaje_cliente_at, bot_activo, stage, no_remarketing, ultimo_auto_msg_at, product_id").eq("id", s.contact_id).maybeSingle();
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
  // Veto POR PRODUCTO: el producto es el DUEÑO de esta secuencia (derivado de su sequence_id),
  // NO contacts.product_id (last-write, lo pisa markProduct con el último producto tocado).
  const subProductId = await productoDeSecuencia(s.channel_id, s.sequence_id);
  if (await yaCompro(s.contact_id, subProductId)) {
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

  // Claim ATÓMICO del paso: reclama ESTA sub reescribiendo updated_at solo si nadie
  // la tocó desde que la leímos (mismo paso_actual y mismo updated_at). El cron se
  // invoca fire-and-forget; si un tick pasa de 60s, el siguiente arranca solapado y
  // AMBOS seleccionan las mismas subs 'activa' → sin este claim, el mismo paso se
  // enviaba DOS veces (doble toque + doble conversación Meta). Debe ir ANTES de
  // escribir la oferta y de enviar. Si no afecta filas, otro tick ya lo tomó.
  const _claimStamp = new Date().toISOString();
  let _claimQ = db.from("sequence_subscriptions").update({ updated_at: _claimStamp })
    .eq("id", s.id).eq("paso_actual", s.paso_actual);
  _claimQ = s.updated_at ? _claimQ.eq("updated_at", s.updated_at) : _claimQ.is("updated_at", null);
  const { data: _claim } = await _claimQ.select("id");
  if (!_claim || !_claim.length) return false;

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
    // SIEMPRE con caducidad: si el paso no configura `vence_horas` (o es 0), antes
    // quedaba `vence=null` = descuento ETERNO → el validador aceptaba el precio rebajado
    // para siempre (y en recompras/extras de esa misma versión). Default de 72h.
    const venceH = Number(paso.oferta.vence_horas);
    const vh = Number.isFinite(venceH) && venceH > 0 ? venceH : 72;
    const vence = new Date(now + vh * 3600 * 1000).toISOString();
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
    // `toco` refleja el RETORNO de startFlowRun: devuelve false si ya hay un run
    // activo/esperando (p.ej. un run rancio que el guard dejó pasar) → el flujo NO
    // corrió, así que NO se debe consumir el paso ni sellar el anti-spam (se reintenta
    // el próximo tick). Antes se marcaba toco=true a ciegas → paso perdido + oferta ya
    // escrita sin que el cliente viera nada (descuento fantasma).
    if (enVentana) {
      const ok = await startFlowRun(db, s.channel_id, s.contact_id, paso.flow_id);
      toco = !!ok;
      if (!ok) {
        // El flujo NO arrancó (ya hay un run activo/esperando: el cliente está a mitad de
        // una conversación). NO se consume el paso ni se avanza: se REINTENTA el próximo
        // tick, cuando el run se libere. Antes se caía a avanzar `paso_actual` igual (el
        // `return` faltaba) → el paso de re-enganche se perdía en silencio sin enviar nada.
        console.warn(`[secuencia] paso ${s.paso_actual} de ${s.contact_id}: flujo NO arrancó (run activo/esperando) → se reintenta el próximo tick`);
        return false;
      }
    }
    else console.warn(`[secuencia] paso ${s.paso_actual} de ${s.contact_id}: flujo fuera de 24h → no se corre (ponle plantilla al paso)`);
  }
  else if (paso.template_name) {
    // El envío de plantilla puede FALLAR (Meta la rechaza: plantilla no aprobada,
    // pausada, o params inválidos). Sin este try/catch el throw se propagaba fuera
    // de processSub y `paso_actual` NUNCA avanzaba → la secuencia se trababa en un
    // reintento infinito cada tick (y jamás llegaban los pasos siguientes). Ahora se
    // registra y se AVANZA igual (se salta ese toque) para no bloquear la secuencia.
    try {
      await sendTemplateToContact(db, s.channel_id, s.contact_id, {
        name: paso.template_name, language: paso.template_lang, params: paso.template_params,
      });
      toco = true;
    } catch (e) {
      console.warn(`[secuencia] paso ${s.paso_actual} de ${s.contact_id}: plantilla "${paso.template_name}" falló (${String((e as any)?.message ?? e)}) → se salta este toque y avanza`);
    }
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
