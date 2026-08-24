// Registrar una venta a MANO (cerrada por fuera: llamada, número personal). Crea
// el pedido contra un contacto, congela la atribución del anuncio, entrega el
// link digital, mueve el embudo y dispara el Purchase a Meta si corresponde.
// Auth: miembro dueño del canal (userOwnsChannel).
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userOwnsChannel } from "../_shared/db.ts";
import { crearVentaManual } from "../_shared/engine.ts";

const db = serviceClient();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  const { data: u } = await userClient(auth).auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);

  let body: {
    channel_id?: string; contact_id?: string; product_id?: string; version_id?: string;
    amount?: number; estado?: string; entregar?: boolean; atributos?: Record<string, string> | null;
    extras?: Array<{ productId: string; versionId: string; nombre?: string; precio: number; digital?: boolean }> | null;
    envio?: { zona?: string; cliente?: string; tel?: string; dni?: string; direccion?: string; distrito?: string; referencia?: string; ciudad?: string; destino?: string } | null;
  };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const { channel_id, contact_id, product_id, version_id, amount, estado, entregar, atributos, extras, envio } = body;
  if (!channel_id || !contact_id || !product_id || !version_id || !estado) return json({ error: "faltan_campos" }, 400);
  // Monto > 0: una venta manual en S/0 se contabiliza como cerrada, entrega el digital gratis
  // y dispara un Purchase(0) a Meta. El front ya lo bloquea; acá es la red de seguridad.
  if (!(Number(amount) > 0)) return json({ error: "monto_invalido", detalle: "El monto debe ser mayor a 0." }, 400);
  if (!(await userOwnsChannel(db, uid, channel_id))) return json({ error: "forbidden_channel" }, 403);
  // El contact_id (y el product_id) vienen del cliente: se exige que pertenezcan al canal
  // ya verificado, si no un miembro del tenant A crearía un pedido sobre un contacto del
  // tenant B (corre con service_role, salta RLS).
  const { data: okContact } = await db.from("contacts").select("id").eq("id", contact_id).eq("channel_id", channel_id).maybeSingle();
  if (!okContact) return json({ error: "contacto_invalido" }, 400);
  const { data: okProd } = await db.from("products").select("id").eq("id", product_id).eq("channel_id", channel_id).maybeSingle();
  if (!okProd) return json({ error: "producto_invalido" }, 400);
  // …y que la VERSIÓN sea de ese producto. Se validaba el contacto y el producto pero no el
  // par producto/versión, y `crearVentaManual` lee la versión por su id a secas: con un
  // version_id de otro producto el pedido nacía cruzado — con el producto A pero la entrega
  // (el link digital) de la versión de B, o sea el cliente recibiendo lo que no compró, y el
  // stock descontándose del producto equivocado.
  const { data: okVer } = await db.from("product_versions").select("id")
    .eq("id", version_id).eq("product_id", product_id).maybeSingle();
  if (!okVer) return json({ error: "version_invalida", detalle: "Esa presentación no es de ese producto." }, 400);

  try {
    const res = await crearVentaManual(db, channel_id, contact_id, {
      productId: product_id, versionId: version_id, amount: Number(amount) || 0,
      estado, entregarLink: entregar !== false, atributos: atributos || null,
      extras: Array.isArray(extras) ? extras : null, envio: envio || null,
    });
    return json({ ok: true, order_id: res.orderId });
  } catch (e) {
    return json({ error: String((e as any)?.message ?? e) }, 500);
  }
});
