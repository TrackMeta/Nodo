// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: scheduler  (INTERNA — verify_jwt=false)
//   Un "tick" del reloj del sistema. La llama un cron (pg_cron / Supabase
//   Cron) cada minuto. Hace dos cosas:
//     1) Despierta los nodos Esperar/debounce vencidos (flow_runs.wake_at).
//     2) Dispara las secuencias de remarketing conscientes de la conversación.
//   Se protege con un secreto compartido (header x-scheduler-secret).
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/db.ts";
import { deliverStep, runEngine, startFlowRun } from "../_shared/engine.ts";
import { processCampaigns, sendTemplateToContact } from "../_shared/campaigns.ts";

const db = serviceClient();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Protección: si hay SCHEDULER_SECRET configurado, exigir el header.
  const secret = Deno.env.get("SCHEDULER_SECRET");
  if (secret && req.headers.get("x-scheduler-secret") !== secret) {
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

  return json({ ok: true, woke, fired, nudged });
});

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
async function yaCompro(contactId: string, stage: string | null): Promise<boolean> {
  if (String(stage ?? "").toLowerCase() === "comprado") return true;
  try {
    const { data } = await db.from("orders").select("id")
      .eq("contact_id", contactId)
      .in("estado", ["confirmada", "entregado_cobrado", "recogido", "saldo_pagado"])
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
    }).format(new Date());
    // Comparación lexicográfica de "HH:MM" (funciona con ceros a la izquierda).
    return hhmm >= String(r.desde) && hhmm <= String(r.hasta);
  } catch (_) { return true; } // ante la duda, no bloquear el remarketing
}

async function processSub(s: any, now: number): Promise<boolean> {
  const { data: seq } = await db.from("sequences").select("pasos, activo").eq("id", s.sequence_id).maybeSingle();
  const pasos = Array.isArray((seq as any)?.pasos) ? (seq as any).pasos : [];
  if (!seq || !(seq as any).activo || s.paso_actual >= pasos.length) {
    await db.from("sequence_subscriptions")
      .update({ estado: "completada", updated_at: new Date().toISOString() }).eq("id", s.id);
    return false;
  }
  const paso = pasos[s.paso_actual];

  const { data: c } = await db.from("contacts")
    .select("ultimo_mensaje_cliente_at, bot_activo, stage, no_remarketing").eq("id", s.contact_id).maybeSingle();
  if (!c) return false;
  if ((c as any).bot_activo === false) return false; // humano tomó la conversación

  // ── Salvaguardas (requisitos 2 y 16) ──
  // 1) Pidió que no le escriban → se cancela, no se reintenta nunca más.
  if ((c as any).no_remarketing === true) {
    await db.from("sequence_subscriptions")
      .update({ estado: "cancelada", updated_at: new Date().toISOString() }).eq("id", s.id);
    return false;
  }
  // 2) Ya compró → sale del remarketing. Mandarle "última oportunidad" a alguien
  //    que acaba de pagar es vergonzoso y quema la marca.
  if (await yaCompro(s.contact_id, (c as any).stage)) {
    await db.from("sequence_subscriptions")
      .update({ estado: "completada", updated_at: new Date().toISOString() }).eq("id", s.id);
    return false;
  }
  // 3) Fuera del horario permitido → esperar al próximo tick (no se pierde el
  //    paso, solo se posterga hasta una hora decente).
  if (!await enHorario(s.channel_id)) return false;

  // Silencio consciente de la conversación: se mide desde el último mensaje
  // del cliente (si responde, el temporizador se reinicia solo).
  const anchor = (c as any).ultimo_mensaje_cliente_at ?? s.updated_at ?? s.suscrito_at;
  const silenceSec = (now - new Date(anchor).getTime()) / 1000;
  const umbral = Number(paso.umbral_silencio_seg ?? paso.delay_seg ?? 0);
  if (silenceSec < umbral) return false; // aún no toca

  // No interrumpir una conversación activa → reintentar en el próximo tick.
  const { data: active } = await db.from("flow_runs").select("id")
    .eq("contact_id", s.contact_id).in("estado", ["activo", "esperando"]).maybeSingle();
  if (active) return false;

  // Disparar el paso: flujo, plantilla HSM (fuera de 24h) o mensaje/burbujas.
  if (paso.flow_id) await startFlowRun(db, s.channel_id, s.contact_id, paso.flow_id);
  else if (paso.template_name) {
    await sendTemplateToContact(db, s.channel_id, s.contact_id, {
      name: paso.template_name, language: paso.template_lang, params: paso.template_params,
    });
  }
  // Mensaje del paso: texto simple, burbujas multimedia o rotación de variantes.
  else if (paso.mensaje || paso.bubbles?.length || paso.variantes?.length) {
    await deliverStep(db, s.channel_id, s.contact_id, paso);
  }

  const next = s.paso_actual + 1;
  await db.from("sequence_subscriptions").update({
    paso_actual: next,
    estado: next >= pasos.length ? "completada" : "activa",
    updated_at: new Date().toISOString(),
  }).eq("id", s.id);
  return true;
}
