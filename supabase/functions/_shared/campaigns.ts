// ═══════════════════════════════════════════════════════════════════
// Nodo · campaigns.ts — Campañas/broadcast con plantillas HSM.
// Expande el segmento a envíos y despacha por lotes (respeta rate).
// También expone envío de plantilla a un contacto (para secuencias
// fuera de la ventana de 24h).
// ═══════════════════════════════════════════════════════════════════
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getChannelSecrets } from "./db.ts";
import { sendTemplate } from "./meta.ts";

const BATCH = 25; // envíos por tick (por campaña)

// Llamado por el scheduler cada tick.
export async function processCampaigns(db: SupabaseClient) {
  const nowIso = new Date().toISOString();
  // 1) Programadas que ya toca → expandir a envíos.
  const { data: prog } = await db.from("campaigns").select("*")
    .eq("estado", "programada")
    .or(`programada_at.is.null,programada_at.lte.${nowIso}`).limit(10);
  for (const c of prog ?? []) await expandCampaign(db, c);

  // 2) En curso → enviar el siguiente lote.
  const { data: sending } = await db.from("campaigns").select("*")
    .eq("estado", "enviando").limit(5);
  for (const c of sending ?? []) await sendBatch(db, c);
}

async function expandCampaign(db: SupabaseClient, c: any) {
  const ids = await matchSegment(db, c.channel_id, c.segmento ?? {});
  if (ids.length) {
    const rows = ids.map((id) => ({ campaign_id: c.id, contact_id: id, estado: "pendiente" }));
    await db.from("campaign_sends").upsert(rows, { onConflict: "campaign_id,contact_id", ignoreDuplicates: true });
  }
  await db.from("campaigns").update({ estado: "enviando", total: ids.length }).eq("id", c.id);
}

// Resuelve el segmento { stage:[], tags:[], modo } a ids de contacto.
// Excluye el contacto de prueba (webchat-test) y los bloqueados de los masivos.
async function matchSegment(db: SupabaseClient, channelId: string, seg: any): Promise<string[]> {
  const stages: string[] = seg.stage ?? seg.stages ?? [];
  const base = () => {
    let q = db.from("contacts").select("id").eq("channel_id", channelId).neq("wa_id", "webchat-test");
    if (stages.length) q = q.in("stage", stages);
    return q;
  };
  // Intenta filtrar bloqueados; si la columna no existe (0021 sin aplicar), reintenta sin ese filtro.
  // Tope alto (20k) para no cortar audiencias grandes en silencio. Si algún día un
  // canal supera esto, la solución de fondo es paginar con .range(); hoy 20k cubre
  // de sobra (un negocio con más contactos que eso ya escaló a otro problema).
  const CAP = 20000;
  // Excluye bloqueados Y opt-out (no_remarketing): un "no me escriban" es un rechazo
  // DURO que vale para TODO el remarketing (las secuencias y el nudge ya lo respetan;
  // las campañas masivas NO lo hacían → mandaban la plantilla HSM a quien pidió no
  // recibir → quejas, block-rate arriba, riesgo de baneo del número por Meta).
  let res = await base().neq("bloqueado", true).neq("no_remarketing", true).limit(CAP);
  if (res.error) res = await base().neq("bloqueado", true).limit(CAP); // por si falta la columna no_remarketing
  if (res.error) res = await base().limit(CAP);                        // o falta también bloqueado
  const { data } = res;
  let ids = (data ?? []).map((r: any) => r.id);

  const tags: string[] = seg.tags ?? [];
  if (tags.length && ids.length) {
    const { data: ct } = await db.from("contact_tags")
      .select("contact_id, tags!inner(nombre)").in("contact_id", ids);
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
    const { data: ords } = await db.from("orders")
      .select("contact_id, estado, created_at").in("contact_id", ids)
      .order("created_at", { ascending: false });
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

  const { data: pend } = await db.from("campaign_sends").select("id, contact_id")
    .eq("campaign_id", c.id).eq("estado", "pendiente").limit(BATCH);
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
  await db.from("campaigns").update({ enviados: (c.enviados || 0) + ok, fallidos: (c.fallidos || 0) + fail }).eq("id", c.id);
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
  let tq = db.from("wa_templates").select("estado_meta, params, body_preview").eq("channel_id", channelId).eq("name", tpl.name);
  if (tpl.language) tq = tq.eq("language", tpl.language);
  const { data: tplRow } = await tq.maybeSingle();
  if ((tplRow as any)?.estado_meta && (tplRow as any).estado_meta !== "aprobada") {
    throw new Error(`Plantilla "${tpl.name}" no está aprobada por Meta (${(tplRow as any).estado_meta})`);
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
  let wamid = "";
  if ((ch as any)?.channel_type === "whatsapp" && (ch as any).phone_number_id && token && ctx.wa_id) {
    wamid = await sendTemplate((ch as any).phone_number_id, token, ctx.wa_id, tpl.name, tpl.language || "es", bodyParams);
  }
  await db.from("messages").insert({
    channel_id: channelId, contact_id: contactId, direction: "out",
    type: "template", content: { template: tpl.name, params: bodyParams }, wamid: wamid || null, status: "sent",
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
