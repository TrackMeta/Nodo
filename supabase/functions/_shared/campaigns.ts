// ═══════════════════════════════════════════════════════════════════
// Nodo · campaigns.ts — Campañas/broadcast con plantillas HSM.
// Expande el segmento a envíos y despacha por lotes (respeta rate).
// También expone envío de plantilla a un contacto (para secuencias
// fuera de la ventana de 24h).
// ═══════════════════════════════════════════════════════════════════
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getChannelSecrets } from "./db.ts";
import { sendTemplate } from "./meta.ts";
import { enParalelo } from "./concurrencia.ts";

const BATCH = 25; // envíos por tick (por campaña)
// Campañas que envían a la vez. Los envíos DENTRO de una campaña siguen espaciados uno a uno
// (el retraso anti-baneo no se toca); en paralelo van campañas distintas, normalmente de
// números de WhatsApp distintos.
const CONC_CAMP = 4;

// Llamado por el scheduler cada tick.
export async function processCampaigns(db: SupabaseClient) {
  const nowIso = new Date().toISOString();
  // 1) Programadas que ya toca → expandir a envíos.
  // Orden explícito en las dos: sin `.order()` el orden que devuelve Postgres no está
  // garantizado, así que con más campañas que el tope no había forma de saber cuáles
  // entraban. FIFO por fecha — la que se programó primero, primero — y así el recorte
  // es al menos predecible y no deja una campaña esperando por sorteo.
  const { data: prog } = await db.from("campaigns").select("*")
    .eq("estado", "programada")
    .or(`programada_at.is.null,programada_at.lte.${nowIso}`)
    .order("programada_at", { ascending: true, nullsFirst: true }).order("id").limit(10);
  // Cada una en su try: si expandir UNA falla (ahora matchSegment lanza ante un error que no
  // sea de columna faltante), las demás del tick tienen que seguir. La que falló se queda en
  // "programada" y el próximo tick la reintenta.
  for (const c of prog ?? []) {
    try { await expandCampaign(db, c); }
    catch (e) { console.error(`[campañas] expandir "${c.nombre ?? c.id}":`, (e as any)?.message ?? e); }
  }

  // 2) En curso → enviar el siguiente lote.
  // 🌐 REPARTO ENTRE BOTS. Este cron es de TODA la plataforma: las campañas "enviando" son de
  // todos los canales de todos los usuarios. Con un `limit(5)` pelado, un solo usuario con 5
  // campañas en curso se llevaba los cinco cupos y NADIE más enviaba hasta que terminara — y
  // una campaña grande tarda horas (25 envíos por tick). Se traen más y se reparte: como
  // mucho MAX_POR_CANAL por canal, hasta MAX_TICK en total. Dentro de un mismo canal sigue
  // mandando el orden de creación.
  const MAX_POR_CANAL = 2, MAX_TICK = 8;
  const { data: enCurso } = await db.from("campaigns").select("*")
    .eq("estado", "enviando").order("created_at", { ascending: true }).order("id").limit(60);
  const porCanal = new Map<string, number>();
  const sending: any[] = [];
  for (const c of enCurso ?? []) {
    const usados = porCanal.get((c as any).channel_id) ?? 0;
    if (usados >= MAX_POR_CANAL) continue;
    porCanal.set((c as any).channel_id, usados + 1);
    sending.push(c);
    if (sending.length >= MAX_TICK) break;
  }
  // En paralelo entre campañas (los envíos DENTRO de cada una siguen espaciados por el
  // retraso anti-baneo): en fila india, 8 campañas × 25 envíos con su pausa no entran en el
  // minuto del tick. Cada una en su try — una que reviente no deja sin lote a las demás.
  await enParalelo(sending, CONC_CAMP, async (c: any) => {
    try { await sendBatch(db, c); }
    catch (e) { console.error(`[campañas] enviar lote de "${c.nombre ?? c.id}":`, (e as any)?.message ?? e); }
  });
}

async function expandCampaign(db: SupabaseClient, c: any) {
  const ids = await matchSegment(db, c.channel_id, c.segmento ?? {});
  // Por LOTES y mirando el error. Desde que matchSegment pagina, la audiencia ya no topa en
  // 1000: un canal grande devuelve decenas de miles de ids y meterlos en un solo POST manda
  // megabytes de body. Y el error no se miraba: si ese insert fallaba, la campaña pasaba
  // igual a "enviando" con `total` lleno → quedaba marcada como en curso SIN un solo
  // destinatario, y nadie recibía nada. Al fallar se deja en "programada" y el próximo tick
  // lo reintenta: el upsert con ignoreDuplicates es idempotente, así que lo ya insertado no
  // se duplica.
  let insertados = 0;
  for (const trozo of enTrozos(ids, 500)) {
    const rows = trozo.map((id) => ({ campaign_id: c.id, contact_id: id, estado: "pendiente" }));
    const { error } = await db.from("campaign_sends")
      .upsert(rows, { onConflict: "campaign_id,contact_id", ignoreDuplicates: true });
    if (error) {
      console.error(`[campañas] expandir "${c.nombre ?? c.id}": ${error.message} — queda programada, se reintenta`);
      return;
    }
    insertados += trozo.length;
  }
  await db.from("campaigns").update({ estado: "enviando", total: insertados }).eq("id", c.id);
}

// Trae TODAS las filas de una consulta paginando con .range().
//   PostgREST devuelve como MUCHO 1000 filas por request y el `.limit()` del cliente NO lo
//   sube — medido contra la base: 1200 filas guardadas, `limit=5000` → 1000 devueltas. Por
//   eso el viejo `.limit(20000)` de la audiencia no servía de nada.
//   `makeQuery(from,to)` debe devolver una query FRESCA con `.range(from,to)` y un orden
//   ESTABLE (un campo + `id` de desempate), o las páginas repiten y saltan filas.
async function pageAll<T = any>(
  makeQuery: (from: number, to: number) => any,
  { pageSize = 1000, max = 50000 }: { pageSize?: number; max?: number } = {},
): Promise<{ data: T[]; error: any }> {
  const out: T[] = [];
  let from = 0;
  while (from < max) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error) return { data: out, error };
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return { data: out, error: null };
}
// Parte una lista de ids en trozos: un `.in()` con miles de ids arma una URL enorme.
const enTrozos = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// Resuelve el segmento { stage:[], tags:[], modo } a ids de contacto.
// Excluye el contacto de prueba (webchat-test) y los bloqueados de los masivos.
async function matchSegment(db: SupabaseClient, channelId: string, seg: any): Promise<string[]> {
  const stages: string[] = seg.stage ?? seg.stages ?? [];
  const base = (f: number, t: number) => {
    let q = db.from("contacts").select("id").eq("channel_id", channelId).neq("wa_id", "webchat-test");
    if (stages.length) q = q.in("stage", stages);
    return q.order("id", { ascending: true }).range(f, t);
  };
  // Intenta filtrar bloqueados; si la columna no existe (0021 sin aplicar), reintenta sin ese filtro.
  // PAGINADO, no `.limit(20000)`: ese tope era una ilusión (PostgREST corta en 1000 por
  // request y el limit del cliente no lo sube), así que una campaña a una audiencia de más
  // de 1000 contactos se enviaba SOLO a los primeros 1000 — y el reporte mostraba ese
  // número como si fuera la audiencia entera. Justo el "cortar en silencio" que el
  // comentario anterior creía estar evitando.
  const CAP = 50000;
  // Excluye bloqueados Y opt-out (no_remarketing): un "no me escriban" es un rechazo
  // DURO que vale para TODO el remarketing (las secuencias y el nudge ya lo respetan;
  // las campañas masivas NO lo hacían → mandaban la plantilla HSM a quien pidió no
  // recibir → quejas, block-rate arriba, riesgo de baneo del número por Meta).
  // Los reintentos existen para una base sin la migración que agregó esas columnas, así que
  // solo se degrada ante ESE error. Antes bastaba cualquier `res.error`: un hipo de red al
  // paginar hacía caer al intento sin filtro y metía en la audiencia justo a quien pidió que
  // no le escriban. El re-chequeo en vuelo de sendBatch lo frena antes de mandar, pero el
  // total del reporte igual salía inflado con gente que nunca iba a recibir nada.
  const faltaColumna = (e: any) => /column .* does not exist|42703/i.test(String(e?.message ?? e ?? ""));
  let res = await pageAll((f, t) => base(f, t).neq("bloqueado", true).neq("no_remarketing", true), { max: CAP });
  if (res.error && faltaColumna(res.error)) res = await pageAll((f, t) => base(f, t).neq("bloqueado", true), { max: CAP }); // sin la columna no_remarketing
  if (res.error && faltaColumna(res.error)) res = await pageAll((f, t) => base(f, t), { max: CAP });                        // ni bloqueado
  // Un error que NO sea de columna (red, permisos) NO puede leerse como "audiencia vacía":
  // la campaña se marcaría enviando/completada sin destinatarios. Se deja para el próximo tick.
  if (res.error) throw new Error("matchSegment: " + (res.error.message ?? res.error));
  const { data } = res;
  let ids = (data ?? []).map((r: any) => r.id);

  const tags: string[] = seg.tags ?? [];
  if (tags.length && ids.length) {
    // Por trozos de ids Y paginando: un contacto puede tener varias etiquetas, así que
    // 1000 contactos ya pasan de 1000 filas. Truncado, el filtro descartaba gente que SÍ
    // tenía la etiqueta (se quedaba sin sus filas y parecía no tenerla).
    const ct: any[] = [];
    for (const trozo of enTrozos(ids, 300)) {
      const { data } = await pageAll((f, t) => db.from("contact_tags")
        .select("contact_id, tags!inner(nombre)").in("contact_id", trozo)
        .order("contact_id", { ascending: true }).range(f, t));
      ct.push(...(data ?? []));
    }
    const modo = seg.modo ?? "cualquiera";
    const byContact: Record<string, Set<string>> = {};
    (ct ?? []).forEach((r: any) => { (byContact[r.contact_id] ??= new Set()).add(r.tags.nombre); });
    ids = ids.filter((id) => {
      const s = byContact[id] ?? new Set();
      return modo === "todas" ? tags.every((t) => s.has(t)) : tags.some((t) => s.has(t));
    });
  }

  // Segmento por estado del ÚLTIMO pedido (embudo de logística = Kanban de Pedidos).
  const orderStates: string[] = seg.order_estados ?? [];
  if (orderStates.length && ids.length) {
    // Ídem: por trozos y paginando. Cada contacto entra ENTERO en un trozo, así que el
    // "último pedido de cada uno" sigue siendo correcto. Truncado, el estado del último
    // pedido se calculaba sobre una muestra y el segmento metía o dejaba fuera a quien no
    // tocaba.
    const ords: any[] = [];
    for (const trozo of enTrozos(ids, 300)) {
      const { data } = await pageAll((f, t) => db.from("orders")
        .select("contact_id, estado, created_at").in("contact_id", trozo)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).range(f, t));
      ords.push(...(data ?? []));
    }
    const latest: Record<string, string> = {};
    (ords ?? []).forEach((o: any) => { if (o.contact_id && !(o.contact_id in latest)) latest[o.contact_id] = o.estado; });
    ids = ids.filter((id) => orderStates.includes(latest[id]));
  }
  return ids;
}

async function sendBatch(db: SupabaseClient, c: any) {
  const { data: tpl } = await db.from("wa_templates").select("*").eq("id", c.template_id).maybeSingle();
  if (!tpl) { await db.from("campaigns").update({ estado: "completada" }).eq("id", c.id); return; }
  // Defensa en profundidad: si Meta pausó/rechazó la plantilla DESPUÉS de crear la
  // campaña (baja calidad, sin aviso en la UI), no quemar la audiencia entera contra
  // un rechazo 132001. Se detiene la campaña y se marcan los pendientes con motivo.
  // (La UI ya filtra por estado_meta al elegir; esto cubre el cambio posterior.)
  if ((tpl as any).estado_meta && (tpl as any).estado_meta !== "aprobada") {
    await db.from("campaign_sends").update({ estado: "fallido", error: { message: "La plantilla ya no está aprobada por Meta" } }).eq("campaign_id", c.id).eq("estado", "pendiente");
    await db.from("campaigns").update({ estado: "completada" }).eq("id", c.id);
    return;
  }
  // El nº de parámetros mapeados debe COINCIDIR con las variables {{N}} del cuerpo
  // aprobado en Meta, o Meta rechaza todo el lote (132000). templates_sync inserta
  // params:[] al traer una plantilla nueva → usarla antes de mapear los huecos
  // quemaría la audiencia entera. Se detiene la campaña con un motivo accionable.
  // Plantilla con variable en encabezado/botón o header de media: Nodo solo llena el
  // cuerpo → Meta rechazaría el lote (132000). La marca la sincronización (0074).
  if ((tpl as any).soporta_envio === false) {
    await db.from("campaign_sends").update({ estado: "fallido", error: { message: "La plantilla usa variables en el encabezado o en un botón, que Nodo aún no puede llenar. Usa una plantilla con variables solo en el cuerpo." } }).eq("campaign_id", c.id).eq("estado", "pendiente");
    await db.from("campaigns").update({ estado: "completada" }).eq("id", c.id);
    return;
  }
  const nVars = new Set(String((tpl as any).body_preview ?? "").match(/\{\{\s*\d+\s*\}\}/g) ?? []).size;
  const nParams = ((tpl as any).params ?? []).length;
  if (nVars !== nParams) {
    await db.from("campaign_sends").update({ estado: "fallido", error: { message: `La plantilla tiene ${nVars} variable(s) {{N}} pero ${nParams} parámetro(s) mapeado(s). Mapea los huecos en Plantillas antes de enviar.` } }).eq("campaign_id", c.id).eq("estado", "pendiente");
    await db.from("campaigns").update({ estado: "completada" }).eq("id", c.id);
    return;
  }

  const { data: ch } = await db.from("channels")
    .select("phone_number_id, channel_type").eq("id", c.channel_id).maybeSingle();
  const secrets = await getChannelSecrets(db, c.channel_id);
  const token = secrets?.access_token;
  const canSend = (ch as any)?.channel_type === "whatsapp" && (ch as any).phone_number_id && token;

  const { data: pend, error: errPend } = await db.from("campaign_sends").select("id, contact_id")
    .eq("campaign_id", c.id).eq("estado", "pendiente").limit(BATCH);
  // Distinguir "no quedan pendientes" de "no pude leerlos". Antes el error no se recogía:
  // `data` venía undefined, `!pend?.length` daba true y la campaña se marcaba COMPLETADA por
  // un hipo de red — a mitad del envío, con el resto de la audiencia sin recibir nada y sin
  // forma de retomarla. Ahora un error deja la campaña 'enviando' y el próximo tick sigue.
  if (errPend) { console.error(`[campañas] leer pendientes de "${c.nombre ?? c.id}": ${errPend.message} — se reintenta`); return; }
  if (!pend?.length) { await db.from("campaigns").update({ estado: "completada" }).eq("id", c.id); return; }

  let ok = 0, fail = 0;
  let first = true;
  for (const s of pend) {
    // Claim ATÓMICO: marca la fila 'enviando' SOLO si sigue 'pendiente'. Si un tick
    // solapado (el cron corre cada minuto y un lote grande puede pasar de 60s) ya la
    // tomó, el update no afecta filas → se salta. Sin esto, dos ticks seleccionaban
    // las MISMAS filas pendientes y mandaban la plantilla DOS veces al mismo contacto
    // (cuesta una conversación Meta, spamea, sube el block-rate). Si el envío tiene
    // éxito pero el update final falla, la fila queda 'enviando' (no se reintenta) →
    // no hay doble envío; el mensaje ya salió, solo queda sin marcar 'enviado'.
    const { data: claim } = await db.from("campaign_sends")
      .update({ estado: "enviando" }).eq("id", s.id).eq("estado", "pendiente").select("id");
    if (!claim || !claim.length) continue; // otro worker la reclamó
    // Re-chequeo de opt-out/bloqueo EN VUELO: matchSegment los excluyó al EXPANDIR, pero un lote
    // grande tarda HORAS en drenar (25/tick, cron cada minuto). Si el cliente pide baja (o lo
    // bloqueas) mientras tanto, su fila pendiente NO debe dispararse: mandar una HSM a quien
    // acaba de pedir "no me escriban" sube el block-rate y arriesga el baneo del número por Meta.
    {
      const { data: cc } = await db.from("contacts").select("no_remarketing, bloqueado").eq("id", s.contact_id).maybeSingle();
      if ((cc as any)?.no_remarketing === true || (cc as any)?.bloqueado === true) {
        await db.from("campaign_sends").update({ estado: "cancelado", error: { message: "El contacto pidió baja / fue bloqueado durante la campaña" } }).eq("id", s.id);
        continue;
      }
    }
    // Retraso aleatorio entre envíos reales (anti-baneo). No aplica al 1º ni
    // cuando el canal no puede enviar (prueba sin WhatsApp conectado).
    if (!first && canSend) await new Promise((r) => setTimeout(r, 120 + Math.random() * 260));
    first = false;
    try {
      const ctx = await contactCtx(db, s.contact_id);
      const bodyParams = ((tpl as any).params ?? []).map((p: string) => resolveP(String(p), ctx));
      // Meta rechaza una plantilla con un parámetro vacío. Si a ESTE contacto le
      // falta un dato que la plantilla usa, se marca fallido con motivo claro y NO
      // se llama a Meta (ahorra el envío condenado y le dice al operador por qué,
      // en vez de un rechazo críptico de la API).
      const faltaIdx = bodyParams.findIndex((v: string) => !String(v ?? "").trim());
      if (canSend && faltaIdx >= 0) {
        await db.from("campaign_sends").update({
          estado: "fallido",
          error: { message: `Falta el dato del parámetro {{${faltaIdx + 1}}} para este contacto` },
        }).eq("id", s.id);
        fail++;
        continue;
      }
      let wamid = "";
      if (canSend && ctx.wa_id) {
        wamid = await sendTemplate((ch as any).phone_number_id, token!, ctx.wa_id, (tpl as any).name, (tpl as any).language, bodyParams);
      }
      // Canal que PUEDE enviar (WhatsApp con token) pero el contacto no tiene wa_id (lead BSUID
      // sin número) → NO marcar "enviado" (fantasma que nunca salió, ensucia el hilo con un
      // "sent" e infla `enviados` sin reintento). Se marca fallido, como sendTemplateToContact.
      if (canSend && !wamid) {
        await db.from("campaign_sends").update({ estado: "fallido", error: { message: "El contacto no tiene número de WhatsApp" } }).eq("id", s.id);
        fail++;
        continue;
      }
      await db.from("campaign_sends").update({ estado: "enviado", wamid: wamid || null, sent_at: new Date().toISOString() }).eq("id", s.id);
      await db.from("messages").insert({
        channel_id: c.channel_id, contact_id: s.contact_id, direction: "out",
        type: "template", content: { template: (tpl as any).name, params: bodyParams }, wamid: wamid || null, status: "sent",
        sent_by: "bot",
      });
      // Anti-spam: una campaña (deliberada) no se frena, pero marca el "último
      // toque de marketing" del contacto para que el scheduler NO le encime hoy
      // un paso de secuencia ni un nudge automático. Columna 0056; best-effort.
      if (canSend) await db.from("contacts").update({ ultimo_auto_msg_at: new Date().toISOString() }).eq("id", s.contact_id).then(() => {}, () => {});
      ok++;
    } catch (e) {
      await db.from("campaign_sends").update({ estado: "fallido", error: { message: String((e as any)?.message ?? e) } }).eq("id", s.id);
      fail++;
    }
  }
  // Los contadores se RECUENTAN desde campaign_sends, no se acumulan sobre el valor que se
  // leyó al empezar el tick. Ese `c.enviados` es una foto vieja: el cron corre cada minuto y
  // un lote grande tarda más (por eso existe el claim atómico por fila), así que dos ticks
  // solapados leían el mismo número y el segundo pisaba lo que sumó el primero. Los envíos
  // no se duplicaban —eso lo cubre el claim— pero el progreso se quedaba corto: la campaña
  // mostraba 300 de 1000 con 600 ya enviados, que es justo la lectura que hace pensar que se
  // atascó. Dos counts con índice, al lado de 25 envíos con su retraso anti-baneo, no se notan.
  const cnt = async (estado: string) => {
    const { count, error } = await db.from("campaign_sends")
      .select("id", { count: "exact", head: true }).eq("campaign_id", c.id).eq("estado", estado);
    return error ? null : (count ?? 0);
  };
  const nOk = await cnt("enviado"), nFail = await cnt("fallido");
  // Si el recuento falla, se cae al acumulado de siempre en vez de dejar el contador quieto.
  await db.from("campaigns").update({
    enviados: nOk ?? ((c.enviados || 0) + ok),
    fallidos: nFail ?? ((c.fallidos || 0) + fail),
  }).eq("id", c.id);
}

// Envío de plantilla a un contacto (secuencias fuera de 24h).
export async function sendTemplateToContact(
  db: SupabaseClient, channelId: string, contactId: string,
  tpl: { name: string; language?: string; params?: string[] },
  sender?: { sentBy?: string; sentByUser?: string | null },
  orderId?: string | null,   // fija el pedido para {{pedido_*}} (aviso al mover un pedido)
): Promise<string> {
  const { data: ch } = await db.from("channels").select("phone_number_id, channel_type").eq("id", channelId).maybeSingle();
  const secrets = await getChannelSecrets(db, channelId);
  const token = secrets?.access_token;
  const ctx = await contactCtx(db, contactId, orderId);
  // Params posicionales. Si el caller no los pasa (aviso del Kanban al mover la
  // tarjeta, plantilla por defecto de un momento), se toman los que la plantilla
  // tiene guardados en Plantillas (wa_templates.params). Sin esto, una plantilla
  // con variables {{1}},{{2}} salía con los huecos VACÍOS → Meta la rechazaba y
  // el cliente no recibía el aviso. Se resuelven contra los datos del contacto.
  let rawParams = tpl.params;
  // Cargamos la fila real (por canal+nombre+idioma) para (a) validar que sigue
  // aprobada por Meta y (b) caer a sus params guardados si el caller no los pasó.
  // El filtro por idioma evita que un canal con la MISMA plantilla en dos idiomas
  // reviente maybeSingle (múltiples filas) → params vacíos → mismatch 132000.
  let tq = db.from("wa_templates").select("estado_meta, params, body_preview, soporta_envio, language").eq("channel_id", channelId).eq("name", tpl.name);
  if (tpl.language) tq = tq.eq("language", tpl.language);
  const { data: tplRow } = await tq.maybeSingle();
  if ((tplRow as any)?.estado_meta && (tplRow as any).estado_meta !== "aprobada") {
    throw new Error(`Plantilla "${tpl.name}" no está aprobada por Meta (${(tplRow as any).estado_meta})`);
  }
  if ((tplRow as any)?.soporta_envio === false) {
    throw new Error(`Plantilla "${tpl.name}" usa variables en el encabezado o botón (Nodo solo llena el cuerpo).`);
  }
  if (!rawParams || rawParams.length === 0) rawParams = ((tplRow as any)?.params as string[]) ?? [];
  // El conteo de params debe cuadrar con las variables {{N}} del cuerpo aprobado
  // (132000 si no). El fallback "-" rellena valores VACÍOS pero no arregla un
  // desajuste de CANTIDAD (ej. body con {{1}}{{2}} y params mapeado solo con 1).
  const _nVars = new Set(String((tplRow as any)?.body_preview ?? "").match(/\{\{\s*\d+\s*\}\}/g) ?? []).size;
  if ((tplRow as any)?.body_preview && _nVars !== rawParams.length) {
    throw new Error(`Plantilla "${tpl.name}": ${_nVars} variable(s) {{N}} pero ${rawParams.length} parámetro(s) mapeado(s). Mapea los huecos en Plantillas.`);
  }
  // Un parámetro que resuelve a cadena VACÍA (ej. {{pedido_guia}} sin guía aún) hace que
  // Meta rechace la plantilla ENTERA (error 132000) → el cliente no recibe nada. Se pone
  // un guion como marcador para que el aviso igual se entregue (mejor "guía: -" que nada).
  const bodyParams = rawParams.map((p) => { const v = resolveP(String(p), ctx); return v && v.trim() ? v : "-"; });
  // Idioma: el del caller si vino; si no, el idioma REAL de la fila aprobada (no "es"
  // hardcodeado, que da 132001 si la plantilla está en es_PE/es_MX/en). "es" es el último
  // recurso solo si ni el caller ni la fila lo tienen.
  const lang = tpl.language || (tplRow as any)?.language || "es";
  const esWhats = (ch as any)?.channel_type === "whatsapp";
  let wamid = "";
  if (esWhats && (ch as any).phone_number_id && token && ctx.wa_id) {
    wamid = await sendTemplate((ch as any).phone_number_id, token, ctx.wa_id, tpl.name, lang, bodyParams);
  }
  // Canal WhatsApp que NO pudo enviar (sin token/phone/wa_id = a medio configurar): NO lo
  // marques "sent" (el operador vería "aviso enviado ✓" y el cliente nunca recibió nada).
  // whatsapp-send ya devuelve 502 ante wamid vacío; esto cubre scheduler/order-update/motor.
  // En webchat (channel_type != whatsapp) el insert ES la entrega → "sent" es correcto.
  const status = esWhats && !wamid ? "failed" : "sent";
  await db.from("messages").insert({
    channel_id: channelId, contact_id: contactId, direction: "out",
    type: "template", content: { template: tpl.name, params: bodyParams }, wamid: wamid || null, status,
    sent_by: sender?.sentBy ?? "bot", sent_by_user: sender?.sentByUser ?? null,
  });
  return wamid;
}

// ── Contexto del contacto para resolver variables ─────────────────
async function contactCtx(db: SupabaseClient, contactId: string, orderId?: string | null): Promise<any> {
  const { data: c } = await db.from("contacts").select("nombre, wa_id, stage, telefono, user_id").eq("id", contactId).maybeSingle();
  const { data: fields } = await db.from("contact_field_values")
    .select("value, custom_fields!inner(key)").eq("contact_id", contactId);
  // {{telefono}}: la columna REAL primero; cae a wa_id SOLO si no es un BSUID (un lead que
  // llegó por anuncio sin número tiene wa_id === user_id, un id interno, no un teléfono).
  // Antes `telefono = wa_id` siempre → una plantilla con {{telefono}} mostraba el BSUID.
  // Espeja el fix de avisar/buildContext en engine.ts (que vivía solo del lado del motor).
  const _wa = (c as any)?.wa_id ?? "";
  const _telReal = String((c as any)?.telefono ?? "").trim();
  const _telefono = _telReal || (_wa && _wa === (c as any)?.user_id ? "" : _wa);
  const ctx: any = { nombre: (c as any)?.nombre ?? "", wa_id: _wa, telefono: _telefono, stage: (c as any)?.stage ?? "" };
  for (const f of fields ?? []) ctx[(f as any).custom_fields.key] = (f as any).value;
  // Datos del último pedido, con los mismos nombres que usan los flujos
  // ({{pedido_guia}}, {{pedido_sede}}, {{pedido_saldo}}…). Sin esto una
  // plantilla de "tu pedido va en camino" no podía decir el número de guía:
  // el parámetro se resolvía vacío y el aviso salía manco.
  try {
    // Con orderId (ej. aviso al MOVER un pedido concreto en el kanban) se resuelve ESE
    // pedido; sin él, el más reciente (compat). Antes siempre el último → una plantilla
    // de "tu pedido va en camino" mandaba la guía/sede del pedido equivocado.
    const oq = db.from("orders").select("estado, amount, shipping");
    const { data: o } = orderId
      ? await oq.eq("id", orderId).maybeSingle()
      : await oq.eq("contact_id", contactId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (o) {
      ctx.pedido_estado = (o as any).estado ?? "";
      ctx.pedido_monto = (o as any).amount ?? "";
      for (const [k, v] of Object.entries((o as any).shipping ?? {})) ctx["pedido_" + k] = v;
    }
  } catch (_) { /* best-effort */ }
  return ctx;
}
function resolveP(text: string, ctx: any): string {
  // Colapsa saltos de línea / tabs / espacios múltiples en el VALOR sustituido:
  // Meta rechaza (132000) un parámetro de body con \n, \t o >4 espacios seguidos.
  // Un cliente que escribió su dirección en varias líneas rompía el aviso ENTERO.
  return (text ?? "").replace(/\{\{\s*([\w\-.]+)\s*\}\}/g, (_: string, k: string) =>
    (ctx[k] ?? "").toString().replace(/\s+/g, " ").trim());
}
