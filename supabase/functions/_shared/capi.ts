// ═══════════════════════════════════════════════════════════════════
// Nodo · capi.ts — Conversiones a Meta (Conversions API).
// Envía Lead / InitiateCheckout / Purchase con atribución de Click-to-
// WhatsApp (ctwa_clid) y deduplicación por event_id / order_id.
// El token CAPI se lee de Vault por canal (service_role).
// ═══════════════════════════════════════════════════════════════════
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sha256Hex } from "./crypto.ts";
import { getChannelSecrets } from "./db.ts";

const GRAPH_VERSION = "v25.0";

export interface CapiOpts {
  eventName: "Lead" | "InitiateCheckout" | "Purchase" | string;
  value?: number;
  currency?: string;
  orderId?: string;      // comprobante → dedup de compra
  eventId?: string;      // si no se da, se deriva de orderId/contacto
  // El ctwa_clid CONGELADO del pedido. Se antepone al del contacto porque el
  // Purchase se dispara al cierre (días después), cuando el contacto ya pudo
  // hacer clic en otro anuncio y sobrescribir su ctwa_clid. La foto del pedido
  // mantiene la venta pegada al anuncio que de verdad la originó.
  ctwaClid?: string;
  // Datos extra para subir el Event Match Quality (se hashean acá, en tu
  // servidor; nunca salen en claro hacia un tercero). Meta matchea mejor con
  // nombre + ciudad + país además del teléfono.
  match?: { fullName?: string; city?: string; country?: string };
}

// Estados de un pedido que significan VENTA REAL (dinero cobrado / entregado):
//   · "confirmada"        → venta DIGITAL PAGADA (femenino, "Pagado").
//   · "entregado_cobrado" → Lima: el motorizado ENTREGÓ y COBRÓ.
//   · "recogido"/"saldo_pagado" → provincia: recogió y pagó el saldo.
// El Purchase se dispara SOLO en estos — un "no recogido" nunca cuenta.
// ⚠️ OJO con "confirmado" (masculino): es el pedido de LIMA recién creado, que
// es CONTRAENTREGA — todavía NO cobró nada (orders.js: cobro "nada"). NO va acá,
// a propósito: contarlo dispararía el Purchase antes de la entrega (justo lo que
// no queremos). Lima recién cuenta como venta en "entregado_cobrado". No agregar
// "confirmado" a este set.
export const PURCHASE_STATES = new Set(
  ["confirmada", "entregado_cobrado", "recogido", "saldo_pagado"],
);

// Normaliza y hashea un dato personal para Meta (SHA-256, minúsculas, sin
// espacios de sobra). El ctwa_clid y el teléfono se tratan aparte.
async function hashPii(v: string | undefined | null): Promise<string | null> {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  return await sha256Hex(s);
}

export interface CapiResult {
  ok: boolean;
  deduped?: boolean;
  error?: string;
}

// Despacha un evento de conversión. Idempotente: si el event_id (o el
// order_id de una compra) ya existe, no reenvía.
export async function sendCapiEvent(
  db: SupabaseClient,
  channelId: string,
  contactId: string,
  opts: CapiOpts,
): Promise<CapiResult> {
  // Datos de canal y contacto.
  const { data: channel } = await db.from("channels")
    .select("pixel_id, page_id").eq("id", channelId).maybeSingle();
  const { data: contact } = await db.from("contacts")
    .select("wa_id, ctwa_clid, nombre").eq("id", contactId).maybeSingle();
  if (!channel?.pixel_id) return { ok: false, error: "canal sin pixel_id" };

  // ctwa CONGELADO del pedido primero; el del contacto solo como respaldo.
  const ctwa = opts.ctwaClid || contact?.ctwa_clid || null;
  const hasCtwa = !!ctwa;
  const actionSource = hasCtwa ? "business_messaging" : "website";

  // event_id estable: por comprobante (compra) o por contacto+evento.
  const eventId = opts.eventId
    ?? (opts.orderId ? `${opts.eventName}:${opts.orderId}` : `${opts.eventName}:${contactId}:${Date.now()}`);

  // ── Registrar (dedup por índice único) ANTES de enviar ────────────
  const { error: insErr } = await db.from("capi_events").insert({
    channel_id: channelId, contact_id: contactId,
    event_name: opts.eventName, value: opts.value ?? null,
    currency: opts.currency ?? "PEN", order_id: opts.orderId ?? null,
    event_id: eventId, action_source: actionSource, estado: "pendiente",
  });
  if (insErr) {
    // 23505 = unique_violation → ya se procesó este evento/compra.
    if ((insErr as any).code === "23505") return { ok: true, deduped: true };
    return { ok: false, error: insErr.message };
  }

  // Token CAPI del canal (Vault).
  const secrets = await getChannelSecrets(db, channelId);
  const capiToken = secrets?.capi_token;
  if (!capiToken) {
    await markEvent(db, channelId, eventId, "fallido", { error: "sin capi_token" });
    return { ok: false, error: "canal sin capi_token" };
  }

  // ── Construir payload ─────────────────────────────────────────────
  // Cuantas más claves de match legítimas, mejor atribuye Meta (Event Match
  // Quality). Todo lo personal va HASHEADO; el ctwa_clid va en claro (es un id
  // de clic, no un dato personal).
  const userData: Record<string, unknown> = {};
  if (contact?.wa_id) userData.ph = [await sha256Hex(String(contact.wa_id).replace(/\D/g, ""))];
  if (hasCtwa) userData.ctwa_clid = ctwa;
  // Nombre: preferimos el que dio para el envío (opts.match.fullName), y si no,
  // el del perfil. Se parte en nombre/apellido.
  const full = String(opts.match?.fullName || contact?.nombre || "").trim();
  if (full) {
    const parts = full.split(/\s+/);
    const fn = await hashPii(parts[0]);
    const ln = parts.length > 1 ? await hashPii(parts.slice(1).join(" ")) : null;
    if (fn) userData.fn = [fn];
    if (ln) userData.ln = [ln];
  }
  const ct = await hashPii(String(opts.match?.city || "").replace(/\s+/g, ""));
  if (ct) userData.ct = [ct];
  const country = await hashPii(opts.match?.country); // ej. "pe"
  if (country) userData.country = [country];

  const customData: Record<string, unknown> = {};
  if (opts.value != null) { customData.value = opts.value; customData.currency = opts.currency ?? "PEN"; }
  if (opts.orderId) customData.order_id = opts.orderId;

  const evt: Record<string, unknown> = {
    event_name: opts.eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: actionSource,
    event_id: eventId,
    user_data: userData,
  };
  if (hasCtwa) evt.messaging_channel = "whatsapp";
  if (Object.keys(customData).length) evt.custom_data = customData;

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${channel.pixel_id}/events`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [evt], access_token: capiToken }),
    });
    const body = await res.json();
    if (!res.ok || body.error) {
      await markEvent(db, channelId, eventId, "fallido", body);
      console.error("[capi] error:", body.error ?? body);
      return { ok: false, error: body.error?.message ?? "meta_error" };
    }
    await markEvent(db, channelId, eventId, "enviado", body);
    return { ok: true };
  } catch (e) {
    await markEvent(db, channelId, eventId, "fallido", { error: String((e as any)?.message ?? e) });
    return { ok: false, error: String((e as any)?.message ?? e) };
  }
}

async function markEvent(db: SupabaseClient, channelId: string, eventId: string, estado: string, resp: unknown) {
  await db.from("capi_events").update({ estado, meta_response: resp })
    .eq("channel_id", channelId).eq("event_id", eventId);
}

// Dispara el Purchase de un pedido SI (y solo si) su estado es una venta real
// (dinero cobrado). Idempotente por `order_id`: aunque el pedido pase por varios
// estados de cierre (saldo_pagado y luego recogido), Meta recibe UN solo
// Purchase. Usa el ctwa_clid CONGELADO en el pedido (no el del contacto, que
// pudo cambiar). Se llama desde donde sea que un pedido llegue a un estado de
// cierre: el Kanban/Copiloto (order-update) y las validaciones automáticas.
export interface OrderLike {
  id: string;
  channel_id: string;
  contact_id: string;
  estado?: string;
  amount?: number | null;
  currency?: string | null;
  shipping?: Record<string, unknown> | null;
}
export async function maybePurchase(db: SupabaseClient, order: OrderLike): Promise<CapiResult | null> {
  if (!order?.estado || !PURCHASE_STATES.has(order.estado)) return null;
  const ship = (order.shipping ?? {}) as Record<string, unknown>;
  const val = Number(order.amount);
  return await sendCapiEvent(db, order.channel_id, order.contact_id, {
    eventName: "Purchase",
    value: Number.isFinite(val) && val > 0 ? val : undefined,
    currency: (order.currency as string) || "PEN",
    orderId: order.id, // → event_id "Purchase:<id>" = una sola vez por pedido
    ctwaClid: (ship.ctwa_clid as string) || undefined,
    match: { fullName: (ship.cliente as string) || undefined, city: (ship.ciudad as string) || undefined, country: "pe" },
  });
}
