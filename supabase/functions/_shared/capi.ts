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
    .select("wa_id, ctwa_clid").eq("id", contactId).maybeSingle();
  if (!channel?.pixel_id) return { ok: false, error: "canal sin pixel_id" };

  const hasCtwa = !!contact?.ctwa_clid;
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
  const userData: Record<string, unknown> = {};
  if (contact?.wa_id) userData.ph = [await sha256Hex(contact.wa_id)];
  if (hasCtwa) userData.ctwa_clid = contact!.ctwa_clid;

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
