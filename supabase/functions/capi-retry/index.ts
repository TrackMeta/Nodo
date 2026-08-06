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

  // Limpia el evento previo (el dedup por event_id impediría reenviar si no).
  await db.from("capi_events").delete()
    .eq("channel_id", channel_id).eq("order_id", order_id).eq("event_name", "Purchase");

  const res = await maybePurchase(db, order as any);
  if (!res) return json({ ok: false, error: "Este pedido no es una venta de anuncio cerrada (nada que enviar)." });
  return json({ ok: !!res.ok, error: res.ok ? null : (res.error || "No se pudo enviar a Meta") });
});
