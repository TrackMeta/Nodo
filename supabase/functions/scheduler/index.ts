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
import { enParalelo } from "../_shared/concurrencia.ts";

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

// Cuántas conversaciones se despiertan a la vez. Bajo a propósito: cada una puede llamar a
// la IA, así que esto acota las llamadas simultáneas al proveedor (y su límite de tasa) y la
// carga sobre la base. Subirlo rinde más por tick, pero conviene medir antes de tocarlo.
const CONC_WAKE = 5;

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
  // Mismo motivo para el mapa producto→secuencias: lo cambia la pantalla de Secuencias cada
  // vez que enlazas o desenlazas una secuencia de un producto, y sin limpiarlo el veto "ya
  // compró ESTE producto" seguía mirando el mapa viejo hasta que el isolate se reciclara —
  // así que se le insistía a quien ya había comprado, o se sacaba del remarketing a quien no.
  // Quedó fuera cuando se arregló el de horario; es el mismo bug, en el Map de al lado.
  prodSeqCache.clear();
  // La secuencia se leía UNA VEZ POR SUSCRIPCIÓN, y todas las de una misma secuencia piden
  // la misma fila: con 200 personas en un reenganche eran 200 consultas idénticas por tick.
  // Se cachea por tick (igual que las otras dos), lo que baja un tercio de las lecturas y
  // deja margen para revisar más suscripciones en el mismo minuto.
  seqCache.clear();

  // ── 1) Despertar Esperar/debounce vencidos ────────────────────────
  const { data: runs } = await db.from("flow_runs")
    .select("channel_id, contact_id")
    .eq("estado", "esperando").not("wake_at", "is", null)
    .lte("wake_at", new Date().toISOString())
    .order("wake_at", { ascending: true })   // los más vencidos primero: sin ORDER BY, con más de 100 pendientes Postgres podía devolver siempre el mismo subconjunto y matar de hambre al resto
    .limit(100);
  // EN PARALELO (de a CONC_WAKE). Cada `runEngine` puede llamar a la IA y esperar segundos,
  // así que en fila india 100 conversaciones vencidas no entran ni de lejos en el minuto del
  // tick — ni en el wall-clock de la Edge Function: el scheduler moría a media lista y el
  // resto esperaba al tick siguiente. Y esto es GLOBAL: no son 100 conversaciones de un
  // negocio, son 100 de TODOS los bots de TODOS los usuarios, así que el que más chats tiene
  // le mete latencia a los demás. Cada run es de un contacto distinto y el lock por contacto
  // (idx_runs_lock) los mantiene aislados, así que paralelizar es seguro. Conservador a
  // propósito: 5 a la vez acota la carga simultánea sobre la base y sobre la API de IA
  // (cuyos 429 ya tienen reintento), y aun así rinde ~5× más por tick.
  await enParalelo(runs ?? [], CONC_WAKE, async (r: any) => {
    try {
      // El operador pudo TOMAR el chat mientras el run estaba parqueado en un "Esperar"/timeout.
      // Sin este chequeo, al vencer wake_at el scheduler reanudaba y disparaba el mensaje parqueado
      // ENCIMA del operador (el guard de bot_activo del webhook no cubre este camino). Igual que ya
      // hacen las inyecciones de remarketing de este archivo.
      const { data: ct } = await db.from("contacts").select("bot_activo").eq("id", r.contact_id).maybeSingle();
      if ((ct as any)?.bot_activo === false) return;
      await runEngine(db, r.channel_id, r.contact_id, { type: "resume" }); woke++;
    } catch (e) { console.error("[scheduler] wake:", (e as any)?.message ?? e); }
  });

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
  // DESPERTADOR (0078): se piden solo las suscripciones cuyo `proximo_at` ya venció, en vez
  // de pasar lista a todas. Antes el trabajo del tick crecía con el TOTAL de suscritos
  // aunque el 99% no tuviera nada que hacer, y una que no podía enviar —de madrugada, con
  // el cliente a mitad de charla, frenada por el anti-spam— se revisaba igual cada minuto
  // toda la noche. Ahora cada una lleva anotado CUÁNDO tiene sentido volver a mirarla, así
  // que el tick depende de a cuántos les toca AHORA, no de cuántos hay.
  //   · `proximo_at` NULL = nunca calculada → cuenta como vencida, para que las que ya
  //     existían entren en la primera pasada y se sellen solas (sin backfill aparte).
  //   · El orden pone primero a las más atrasadas, que es el reparto justo si un pico deja
  //     más vencidas que el tope.
  // Mismo patrón que `flow_runs.wake_at`, que es como el motor duerme las conversaciones.
  const { data: subs } = await db.from("sequence_subscriptions")
    .select("id, channel_id, contact_id, sequence_id, paso_actual, updated_at, suscrito_at")
    .eq("estado", "activa")
    .or(`proximo_at.is.null,proximo_at.lte.${new Date().toISOString()}`)
    .order("proximo_at", { ascending: true, nullsFirst: true })
    // Tope de seguridad, no de reparto: con el despertador lo normal es que venzan unas
    // pocas por minuto. Existe para que un pico (el cron caído un rato, o una tanda que se
    // suscribió junta) no intente vaciarse de golpe y se pase del minuto del tick.
    .limit(500);
  for (const s of subs ?? []) {
    try { if (await processSub(s, now)) fired++; }
    catch (e) { console.error("[scheduler] seq:", (e as any)?.message ?? e); }
  }
  // Ya no hace falta sellar un cursor de rotación en lote: cada `processSub` deja anotado su
  // propio `proximo_at` (envió → cuándo toca el siguiente paso; no pudo → cuándo reintentar),
  // así que la ventana avanza sola y sin escrituras extra.

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
  // Paginado, no `.limit(100)`: a diferencia de flow_runs y sequence_subscriptions (que
  // llevan ORDER BY justo para evitar inanición), acá no había orden NI nada que drene, así
  // que con más de 100 canales con resúmenes activos siempre ganaban los mismos y al resto
  // no le llegaba su digest nunca.
  const chans: any[] = [];
  for (let desde = 0; desde < 100000; desde += 1000) {
    const { data, error } = await db.from("channels")
      .select("id, nombre, timezone, moneda, resumenes, resumen_estado, telegram_chat_ids")
      .not("resumenes", "is", null).order("id", { ascending: true }).range(desde, desde + 999);
    if (error) break;
    const filas = data ?? [];
    chans.push(...filas);
    if (filas.length < 1000) break;
  }
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
  // Paginado en vez de `.limit(50)`: ese tope era arbitrario y MUDO — a partir de la cuenta
  // 51 de la plataforma, esos canales dejaban de recibir recordatorios de adelanto y avisos
  // de vencimiento sin que nada lo dijera. (Aparte, PostgREST corta en 1000 por request,
  // así que subir el número tampoco habría bastado.)
  const chans: any[] = [];
  for (let desde = 0; desde < 100000; desde += 1000) {
    const { data, error } = await db.from("channels").select("id, pedidos_config")
      .order("id", { ascending: true }).range(desde, desde + 999);
    if (error) break;
    const filas = data ?? [];
    chans.push(...filas);
    if (filas.length < 1000) break;
  }
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
  // Paginado, no `.limit(50)`: esto NO es un lote que se drene (flow_triggers no marca nada
  // como procesado, así que cada corrida traía los MISMOS 50 primeros). Con más de 50
  // disparadores de este tipo en la plataforma, los de la cola de atrás no se procesaban
  // NUNCA y esos recordatorios de pedido no salían jamás. El `.limit(25)` de los pedidos de
  // abajo sí es un lote legítimo: marca `_nudge_<estado>` en shipping y no se repite.
  const trigs: any[] = [];
  for (let desde = 0; desde < 100000; desde += 1000) {
    const { data, error } = await db.from("flow_triggers")
      .select("flow_id, channel_id, config, interrumpe, flows!inner(estado)")
      .eq("tipo", "pedido_recordatorio").eq("activo", true)
      .order("flow_id", { ascending: true }).range(desde, desde + 999);
    if (error) break;
    const filas = data ?? [];
    trigs.push(...filas);
    if (filas.length < 1000) break;
  }
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

// Secuencias leídas en este tick. Se limpia al inicio de cada invocación (ver arriba): dura
// lo que dura el tick, así que un cambio del operador entra en el minuto siguiente.
// Guarda TAMBIÉN el error, para no perder la distinción entre "no existe" y "no pude leerla"
// —de la que depende no dar por completada una suscripción por un hipo de red—.
const seqCache = new Map<string, { data: any; error: any }>();
async function leerSecuencia(sequenceId: string) {
  const hit = seqCache.get(sequenceId);
  if (hit) return hit;
  const { data, error } = await db.from("sequences").select("*").eq("id", sequenceId).maybeSingle();
  const res = { data, error };
  if (!error) seqCache.set(sequenceId, res);   // un fallo NO se cachea: se reintenta en la siguiente
  return res;
}

// "Vuelve a mirar esta suscripción dentro de X". Es lo que hace que el cron no la revise
// cada minuto para nada: cuando algo la frena (horario, anti-spam, el cliente está a mitad
// de charla) se anota CUÁNDO tendría sentido reintentar, en vez de volver a las 60 segundos.
// Piso de 1 minuto para no crear un bucle apretado; no toca `updated_at`, que es el ancla
// del temporizador del paso (y de la que depende el claim atómico).
async function posponer(subId: string, ms: number) {
  const at = new Date(Date.now() + Math.max(60_000, ms)).toISOString();
  await db.from("sequence_subscriptions").update({ proximo_at: at })
    .eq("id", subId).then(() => {}, () => {});
}

async function processSub(s: any, now: number): Promise<boolean> {
  const { data: seq, error: errSeq } = await leerSecuencia(s.sequence_id);
  // Distinguir "la secuencia ya no existe" de "no pude leerla". Sin esto, un error transitorio
  // dejaba `seq` en null y caía en el branch de abajo, que marca la suscripción COMPLETADA:
  // ese contacto se quedaba fuera del remarketing PARA SIEMPRE por un hipo de red, en silencio.
  // Ante un error se sale sin tocar nada y el próximo tick reintenta.
  if (errSeq) { console.error(`[secuencia] leer la secuencia ${s.sequence_id}: ${errSeq.message} — se reintenta`); return false; }
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
  // Secuencia PAUSADA: no se toca la suscripción, pero se aparta un rato — sin esto se la
  // revisaba cada minuto mientras siguiera pausada, que pueden ser semanas.
  if (seq && (seq as any).activo === false) { await posponer(s.id, 30 * 60_000); return false; }
  if (!seq || s.paso_actual >= pasos.length) {
    await db.from("sequence_subscriptions")
      .update({ estado: "completada", updated_at: new Date().toISOString() }).eq("id", s.id);
    return false;
  }
  const paso = pasos[s.paso_actual];

  const { data: c } = await db.from("contacts")
    .select("ultimo_mensaje_cliente_at, bot_activo, stage, no_remarketing, ultimo_auto_msg_at, product_id").eq("id", s.contact_id).maybeSingle();
  if (!c) { await posponer(s.id, 60 * 60_000); return false; }   // contacto borrado: casi nunca
  // El humano tomó el chat: mientras siga así no hay remarketing que valga. Se vuelve a mirar
  // en un rato en vez de cada minuto.
  if ((c as any).bot_activo === false) { await posponer(s.id, 30 * 60_000); return false; }

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
  // Fuera del horario de remarketing. Antes se la revisaba cada minuto TODA la noche sin
  // poder enviar; ahora se aparta y vuelve más tarde.
  if (!await enHorario(s.channel_id)) { await posponer(s.id, 20 * 60_000); return false; }

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
  // Aún no toca. Este es EL caso común, y acá la hora exacta se sabe: falta
  // `umbral - silenceSec`. Se anota y no se la vuelve a mirar hasta entonces — es lo que
  // hace que un paso de "espera 3 días" cueste UNA revisión en tres días en vez de 4.320.
  // Ojo con el ancla: en modo reenganche cuenta también el último mensaje del cliente, así
  // que si contesta el plazo se corre hacia adelante; por eso se recalcula acá cada vez que
  // se la mira, en lugar de fiarse del valor viejo.
  if (silenceSec < umbral) { await posponer(s.id, (umbral - silenceSec) * 1000); return false; }

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
    // El cliente está a mitad de una conversación con el bot: no se le encima remarketing.
    // Se vuelve en un rato (antes, cada minuto mientras durara la charla).
    if ((active as any).estado === "activo") { await posponer(s.id, 15 * 60_000); return false; }
    // Conversación reciente pero parada: se espera a que se enfríe lo que falte del margen.
    if (!esGoteo && idleMs < graceMs) { await posponer(s.id, graceMs - idleMs); return false; }
  }

  // Anti-spam: no encimar envíos automáticos. Si ya recibió un toque de marketing
  // (otra secuencia, un nudge, o una campaña) dentro de la ventana de enfriamiento,
  // se posterga al próximo tick — no se pierde el paso, solo espera.
  // Ya recibió un toque automático hace poco. Se sabe exactamente cuándo se libera: cuando
  // el último toque cumpla ANTISPAM_MS.
  if (await antispamOn(s.channel_id) && tocoMktReciente(c, now)) {
    const desde = new Date((c as any).ultimo_auto_msg_at).getTime();
    await posponer(s.id, ANTISPAM_MS - (now - desde));
    return false;
  }

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
      // Solo cuenta como "toque de marketing" si REALMENTE salió: deliverStep devuelve false
      // cuando Meta lo rechaza (no lanza). Marcarlo igual le quema al contacto el cooldown de
      // remarketing sin haber recibido nada.
      if (await deliverStep(db, s.channel_id, s.contact_id, paso)) toco = true;
      else console.warn(`[secuencia] paso ${s.paso_actual} de ${s.contact_id}: Meta rechazó el envío → no cuenta como toque`);
    } else {
      console.warn(`[secuencia] paso ${s.paso_actual} de ${s.contact_id}: fuera de 24h y sin plantilla → no se envía (ponle plantilla al paso para alcanzarlo)`);
    }
  }
  if (toco) await marcarTocoMkt(s.contact_id);

  const next = s.paso_actual + 1;
  // Cuándo volver a mirarla: la espera del paso QUE SIGUE, contada desde ahora (que es
  // justo el ancla nueva, porque `updated_at` se sella en esta misma escritura). Es una
  // cota INFERIOR y con eso basta: si el cliente responde antes, el ancla se corre hacia
  // adelante y al mirarla se recalcula sola. Nunca puede adelantar un envío, solo atrasarlo.
  const pasoSig = pasos[next];
  const esperaSig = pasoSig ? Number(pasoSig.umbral_silencio_seg ?? pasoSig.delay_seg ?? 0) : 0;
  await db.from("sequence_subscriptions").update({
    paso_actual: next,
    estado: next >= pasos.length ? "completada" : "activa",
    updated_at: new Date().toISOString(),
    proximo_at: new Date(Date.now() + Math.max(60_000, esperaSig * 1000)).toISOString(),
  }).eq("id", s.id);
  return true;
}
