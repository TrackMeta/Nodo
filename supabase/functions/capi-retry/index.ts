// Reintentar el envío del Purchase de un pedido a Meta. Borra el evento CAPI
// previo (fallido / pendiente) de ese pedido y vuelve a disparar maybePurchase.
// Para el botón "Reintentar envío a Meta". Auth: dueño del canal.
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userOwnsChannel } from "../_shared/db.ts";
import { maybePurchase } from "../_shared/capi.ts";

const db = serviceClient();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  const { data: u } = await userClient(auth).auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);

  let body: { channel_id?: string; order_id?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const { channel_id, order_id } = body;
  if (!channel_id || !order_id) return json({ error: "faltan_campos" }, 400);
  if (!(await userOwnsChannel(db, uid, channel_id))) return json({ error: "forbidden_channel" }, 403);

  const { data: order } = await db.from("orders")
    .select("id, channel_id, contact_id, estado, amount, currency, shipping")
    .eq("id", order_id).maybeSingle();
  if (!order || (order as any).channel_id !== channel_id) return json({ error: "pedido no encontrado" }, 404);

  // Solo el evento PRINCIPAL de este pedido (event_id "Purchase:<order_id>"). NO se toca
  // el del UPSELL ("Purchase:<order_id>:x:<sufijo>", mismo order_id/event_name): antes el
  // delete por event_name lo arrastraba y, como capi-retry solo reenvía el principal, se
  // perdía el registro y la atribución del extra vendido tras el cierre.
  const eidPrincipal = "Purchase:" + order_id;
  const { data: prev } = await db.from("capi_events").select("estado")
    .eq("channel_id", channel_id).eq("event_id", eidPrincipal).maybeSingle();
  // Si YA se envió OK, no reenviar: pasadas las ~48h de dedup de Meta, reenviar el mismo
  // event_id contaría el Purchase DOS veces. El botón reintenta solo lo fallido/pendiente.
  if (prev && (prev as any).estado === "enviado") {
    return json({ ok: true, error: null, ya_enviado: true });
  }
  // Borra el principal (el dedup por event_id impediría reenviar si no) SOLO si había algo
  // fallido/pendiente. Si nunca se registró, el delete es no-op y maybePurchase lo crea.
  await db.from("capi_events").delete()
    .eq("channel_id", channel_id).eq("event_id", eidPrincipal);

  const res = await maybePurchase(db, order as any);
  if (!res) return json({ ok: false, error: "Este pedido no es una venta de anuncio cerrada (nada que enviar)." });
  return json({ ok: !!res.ok, error: res.ok ? null : (res.error || "No se pudo enviar a Meta") });
});
