// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: order-update  (AUTENTICADA — verify_jwt=true)
//   El Kanban de Pedidos avanza el estado de un pedido físico (registrar
//   guía, marcar llegada, cobrado…). Al cambiar el estado, dispara los
//   flujos con trigger `pedido_estado` que escuchan ese estado — así el
//   humano mueve la tarjeta y el bot escribe los mensajes (DEFINICION
//   §6-SEPTIES, división de trabajo bot↔humano).
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/db.ts";
import { startFlowRun, syncPedidoSheet, resumeAfterApproval, entregarExtrasDigitales, resumeIntoExtras } from "../_shared/engine.ts";

const db = serviceClient();
// Estados que representan dinero cobrado/cierre → sellan confirmed_at.
const CONFIRM_STATES = ["confirmada", "entregado_cobrado", "recogido", "saldo_pagado"];
// Estados en que el pedido físico quedó PAGADO DEL TODO → recién ahí se entregan
// las ventas extra digitales que viajaban en él (ride-along).
const FULLPAY_STATES = ["entregado_cobrado", "saldo_pagado", "recogido"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Dos formas de entrar:
  //  · Un miembro (admin u operador) desde el panel, con su JWT.
  //  · Otra Edge Function nuestra, con la service_role key (ej. el Copiloto de
  //    Telegram, que ya validó por su lado que quien tocó el botón es admin del
  //    canal). Esa key solo vive server-side, así que presentarla es prueba de
  //    ser código nuestro. Se reusa esta función a propósito: si el camino de
  //    Telegram duplicara la lógica, tarde o temprano las dos se separarían.
  const auth = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const interno = !!serviceKey && auth === `Bearer ${serviceKey}`;
  if (!interno) {
    const { data: u } = await userClient(auth).auth.getUser();
    const uid = u?.user?.id;
    if (!uid) return json({ error: "no_auth" }, 401);
    const { data: member } = await db.from("app_users").select("id").eq("id", uid).eq("activo", true).maybeSingle();
    if (!member) return json({ error: "not_member" }, 403);
  }

  let body: { order_id?: string; estado?: string; shipping?: Record<string, unknown>; amount?: number; resume?: boolean };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!body.order_id) return json({ error: "falta_order_id" }, 400);

  const { data: order } = await db.from("orders")
    .select("id, channel_id, contact_id, estado, shipping")
    .eq("id", body.order_id).maybeSingle();
  if (!order) return json({ error: "no_existe" }, 404);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.shipping && typeof body.shipping === "object") {
    patch.shipping = { ...((order as any).shipping ?? {}), ...body.shipping };
  }
  if (typeof body.amount === "number" && Number.isFinite(body.amount)) patch.amount = body.amount;
  const newEstado = body.estado && body.estado !== (order as any).estado ? body.estado : null;
  if (newEstado) {
    patch.estado = newEstado;
    if (CONFIRM_STATES.includes(newEstado)) patch.confirmed_at = new Date().toISOString();
  }

  const { error } = await db.from("orders").update(patch).eq("id", order.id);
  if (error) return json({ error: error.message }, 500);
  // La hoja sigue al pedido: acá pasan TODOS los cambios que hace un humano
  // (el Kanban y el Copiloto, incluido el de Telegram). No lanza.
  await syncPedidoSheet(db, order.id);

  // Reanudar un run parqueado por validación manual:
  //  · pago digital PRINCIPAL → el pedido pasa a 'confirmada' (marca
  //    digital_pendiente); se reanuda para entregar el producto.
  //  · pago de VENTA EXTRA → el pedido ya está confirmado y no cambia de estado;
  //    el Copiloto manda `resume:true` (y limpia extra_pendiente) para reanudar
  //    y entregar el extra.
  // Solo aplica a estos casos → no afecta los pedidos físicos.
  let resumed = false;
  const wantResume = !!body.resume
    || (newEstado === "confirmada" && ((order as any).shipping || {}).digital_pendiente);
  if (wantResume && (order as any).contact_id) {
    try {
      resumed = await resumeAfterApproval(db, (order as any).channel_id, (order as any).contact_id);
    } catch (e) {
      console.error("[order-update] resume:", (e as any)?.message ?? e);
    }
  }

  // Pedido físico pagado del todo → entregar las ventas extra digitales que
  // viajaban en él (link/archivo). Idempotente; no afecta pedidos sin extras.
  if (newEstado && FULLPAY_STATES.includes(newEstado) && (order as any).contact_id) {
    try {
      await entregarExtrasDigitales(db, (order as any).channel_id, (order as any).contact_id, order.id);
    } catch (e) {
      console.error("[order-update] entregar extras digitales:", (e as any)?.message ?? e);
    }
  }

  // Adelanto aprobado a mano: si el producto ofrece la venta extra DESPUÉS del
  // adelanto, se reanuda la conversación hacia el ofrecimiento (que saluda
  // "¡recibido!") en vez del aviso normal. Si no aplica, cae al aviso de siempre.
  let extrasOfrecidos = false;
  if (newEstado === "adelanto_validado" && (order as any).contact_id) {
    try {
      extrasOfrecidos = await resumeIntoExtras(db, (order as any).channel_id, (order as any).contact_id);
    } catch (e) {
      console.error("[order-update] resume extras:", (e as any)?.message ?? e);
    }
  }

  // Cambio de estado → Timeline + flujos suscritos a ese estado.
  let flowStarted: string | null = null;
  if (newEstado && (order as any).contact_id) {
    try {
      await db.from("contact_events").insert({
        channel_id: (order as any).channel_id, contact_id: (order as any).contact_id,
        tipo: "nota", titulo: "Pedido → " + newEstado,
      });
    } catch (_) { /* best-effort */ }

    const { data: trigs } = extrasOfrecidos ? { data: [] } : await db.from("flow_triggers")
      .select("flow_id, config, interrumpe, flows!inner(id, estado)")
      .eq("channel_id", (order as any).channel_id)
      .eq("tipo", "pedido_estado").eq("activo", true);
    for (const t of trigs ?? []) {
      const estados: string[] = ((t as any).config?.estados ?? []).map(String);
      if (!estados.includes(newEstado)) continue;
      if ((t as any).flows?.estado !== "activo") continue;
      try {
        // `interrumpe` = cancelar la conversación activa para notificar ya.
        const ok = await startFlowRun(db, (order as any).channel_id, (order as any).contact_id,
          (t as any).flow_id, { force: !!(t as any).interrumpe });
        if (ok) { flowStarted = (t as any).flow_id; break; }
      } catch (e) {
        console.error("[order-update] flow:", (e as any)?.message ?? e);
      }
    }
  }
  return json({ ok: true, estado: newEstado ?? (order as any).estado, flow_started: flowStarted, resumed });
});
