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
  let res = await base().neq("bloqueado", true).limit(5000);
  if (res.error) res = await base().limit(5000);
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
    // Retraso aleatorio entre envíos reales (anti-baneo). No aplica al 1º ni
    // cuando el canal no puede enviar (prueba sin WhatsApp conectado).
    if (!first && canSend) await new Promise((r) => setTimeout(r, 120 + Math.random() * 260));
    first = false;
    try {
      const ctx = await contactCtx(db, s.contact_id);
      const bodyParams = ((tpl as any).params ?? []).map((p: string) => resolveP(String(p), ctx));
      let wamid = "";
      if (canSend && ctx.wa_id) {
        wamid = await sendTemplate((ch as any).phone_number_id, token!, ctx.wa_id, (tpl as any).name, (tpl as any).language, bodyParams);
      }
      await db.from("campaign_sends").update({ estado: "enviado", wamid: wamid || null, sent_at: new Date().toISOString() }).eq("id", s.id);
      await db.from("messages").insert({
        channel_id: c.channel_id, contact_id: s.contact_id, direction: "out",
        type: "template", content: { template: (tpl as any).name, params: bodyParams }, wamid: wamid || null, status: "sent",
      });
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
): Promise<string> {
  const { data: ch } = await db.from("channels").select("phone_number_id, channel_type").eq("id", channelId).maybeSingle();
  const secrets = await getChannelSecrets(db, channelId);
  const token = secrets?.access_token;
  const ctx = await contactCtx(db, contactId);
  const bodyParams = (tpl.params ?? []).map((p) => resolveP(String(p), ctx));
  let wamid = "";
  if ((ch as any)?.channel_type === "whatsapp" && (ch as any).phone_number_id && token && ctx.wa_id) {
    wamid = await sendTemplate((ch as any).phone_number_id, token, ctx.wa_id, tpl.name, tpl.language || "es", bodyParams);
  }
  await db.from("messages").insert({
    channel_id: channelId, contact_id: contactId, direction: "out",
    type: "template", content: { template: tpl.name, params: bodyParams }, wamid: wamid || null, status: "sent",
  });
  return wamid;
}

// ── Contexto del contacto para resolver variables ─────────────────
async function contactCtx(db: SupabaseClient, contactId: string): Promise<any> {
  const { data: c } = await db.from("contacts").select("nombre, wa_id, stage").eq("id", contactId).maybeSingle();
  const { data: fields } = await db.from("contact_field_values")
    .select("value, custom_fields!inner(key)").eq("contact_id", contactId);
  const ctx: any = { nombre: (c as any)?.nombre ?? "", wa_id: (c as any)?.wa_id ?? "", telefono: (c as any)?.wa_id ?? "", stage: (c as any)?.stage ?? "" };
  for (const f of fields ?? []) ctx[(f as any).custom_fields.key] = (f as any).value;
  // Datos del último pedido, con los mismos nombres que usan los flujos
  // ({{pedido_guia}}, {{pedido_sede}}, {{pedido_saldo}}…). Sin esto una
  // plantilla de "tu pedido va en camino" no podía decir el número de guía:
  // el parámetro se resolvía vacío y el aviso salía manco.
  try {
    const { data: o } = await db.from("orders")
      .select("estado, amount, shipping").eq("contact_id", contactId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (o) {
      ctx.pedido_estado = (o as any).estado ?? "";
      ctx.pedido_monto = (o as any).amount ?? "";
      for (const [k, v] of Object.entries((o as any).shipping ?? {})) ctx["pedido_" + k] = v;
    }
  } catch (_) { /* best-effort */ }
  return ctx;
}
function resolveP(text: string, ctx: any): string {
  return (text ?? "").replace(/\{\{\s*([\w\-.]+)\s*\}\}/g, (_: string, k: string) => (ctx[k] ?? "").toString());
}
