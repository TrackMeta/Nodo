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
import { deliverMessage, runEngine, startFlowRun } from "../_shared/engine.ts";
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

  return json({ ok: true, woke, fired });
});

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
    .select("ultimo_mensaje_cliente_at, bot_activo").eq("id", s.contact_id).maybeSingle();
  if (!c) return false;
  if ((c as any).bot_activo === false) return false; // humano tomó la conversación

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

  // Disparar el paso: flujo, plantilla HSM (fuera de 24h) o mensaje suelto.
  if (paso.flow_id) await startFlowRun(db, s.channel_id, s.contact_id, paso.flow_id);
  else if (paso.template_name) {
    await sendTemplateToContact(db, s.channel_id, s.contact_id, {
      name: paso.template_name, language: paso.template_lang, params: paso.template_params,
    });
  }
  else if (paso.mensaje) await deliverMessage(db, s.channel_id, s.contact_id, String(paso.mensaje));

  const next = s.paso_actual + 1;
  await db.from("sequence_subscriptions").update({
    paso_actual: next,
    estado: next >= pasos.length ? "completada" : "activa",
    updated_at: new Date().toISOString(),
  }).eq("id", s.id);
  return true;
}
