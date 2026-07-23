// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: order-update  (AUTENTICADA — verify_jwt=true)
//   El Kanban de Pedidos avanza el estado de un pedido físico (registrar
//   guía, marcar llegada, cobrado…). Al cambiar el estado, dispara los
//   flujos con trigger `pedido_estado` que escuchan ese estado — así el
//   humano mueve la tarjeta y el bot escribe los mensajes (DEFINICION
//   §6-SEPTIES, división de trabajo bot↔humano).
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userOwnsChannel } from "../_shared/db.ts";
import { startFlowRun, syncPedidoSheet, resumeAfterApproval, rejectDigitalPending, entregarExtrasDigitales, resumeIntoExtras, cerrarConversacionVenta, moverEtapa, stageDeEstado, recomputeStageOnLoss } from "../_shared/engine.ts";
import { maybePurchase } from "../_shared/capi.ts";
import { sendTemplateToContact } from "../_shared/campaigns.ts";

const db = serviceClient();
// Estados que representan dinero cobrado/cierre → sellan confirmed_at.
const CONFIRM_STATES = ["confirmada", "entregado_cobrado", "recogido", "saldo_pagado"];
// Venta física TERMINADA: se cierra la conversación de venta para ceder el paso
// al soporte post-venta (el flujo de venta de provincia es un bucle sin "Fin").
const FIN_VENTA_FISICA = ["saldo_pagado", "recogido", "entregado_cobrado"];
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
  let uid: string | undefined;
  if (!interno) {
    const { data: u } = await userClient(auth).auth.getUser();
    uid = u?.user?.id;
    if (!uid) return json({ error: "no_auth" }, 401);
    const { data: member } = await db.from("app_users").select("id").eq("id", uid).eq("activo", true).maybeSingle();
    if (!member) return json({ error: "not_member" }, 403);
  }

  let body: {
    order_id?: string; estado?: string; shipping?: Record<string, unknown>; amount?: number; resume?: boolean;
    reject?: string; reject_motivo?: string;
    // Cómo avisarle al cliente este cambio (lo elige el humano al mover el pedido).
    aviso?: { modo?: string; template?: { name?: string; language?: string; params?: string[] } };
  };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!body.order_id) return json({ error: "falta_order_id" }, 400);

  const { data: order } = await db.from("orders")
    .select("id, channel_id, contact_id, estado, shipping, amount, currency")
    .eq("id", body.order_id).maybeSingle();
  if (!order) return json({ error: "no_existe" }, 404);
  // Multi-tenant: si entra un humano (no el service-role interno del Copiloto),
  // su cuenta debe ser dueña del canal del pedido.
  if (!interno && !(await userOwnsChannel(db, uid, (order as any).channel_id))) {
    return json({ error: "forbidden_channel" }, 403);
  }

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

  // Purchase a Meta SOLO cuando la venta es real (dinero cobrado): Lima
  // entregado y cobrado, provincia recogido / saldo pagado, digital confirmado.
  // Es el punto por donde pasan todos los cierres que marca un humano. Idempotente
  // por pedido (dedup en capi) y usa el ctwa_clid CONGELADO en el pedido. Un
  // "no recogido" nunca llega acá. No lanza si el canal no tiene pixel/token.
  if (newEstado) {
    try {
      await maybePurchase(db, {
        id: order.id, channel_id: (order as any).channel_id, contact_id: (order as any).contact_id,
        estado: newEstado, amount: (patch.amount as number) ?? (order as any).amount,
        currency: (order as any).currency, shipping: (patch.shipping as any) ?? (order as any).shipping,
      });
    } catch (e) { console.error("[order-update] capi purchase:", (e as any)?.message ?? e); }
    // Embudo automático: el cambio de estado del pedido mueve la etapa de la
    // persona. Al AVANZAR (confirmado/comprado) solo sube. Pero si el estado es de
    // PÉRDIDA (anulada, cancelado, rechazado, no_recogido), se RECALCULA desde los
    // pedidos que quedan: así anular la única venta baja a "perdido", pero si le
    // queda otra compra real se mantiene "comprado".
    const st = stageDeEstado(newEstado);
    if (st === "perdido") await recomputeStageOnLoss(db, (order as any).channel_id, (order as any).contact_id);
    else await moverEtapa(db, (order as any).channel_id, (order as any).contact_id, st);
  }

  // Venta física cerrada (saldo pagado / recogido / entregado) → cierra la
  // conversación de venta para que el modo SOPORTE post-venta tome el mando.
  // Va antes del disparo de pedido_estado (clave de recojo), que arranca igual.
  // No afecta al caso DIGITAL: "confirmada" no está en esta lista y su run se
  // reanuda (resumeAfterApproval), no se cancela.
  if (newEstado && FIN_VENTA_FISICA.includes(newEstado) && (order as any).contact_id) {
    await cerrarConversacionVenta(db, (order as any).contact_id);
  }

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

  // Comprobante RECHAZADO en el Copiloto: el run quedaba parqueado y el bot le
  // respondía "estoy verificando tu pago" para siempre. Se reanuda por la rama
  // de pago inválido para que pida un comprobante nuevo. Solo si el operador
  // eligió que el bot siga (si prefiere atenderlo él, manda `reject:"humano"` y
  // el chat queda pausado con el run parqueado, que es inofensivo).
  let rejected = false;
  if (body.reject === "bot" && (order as any).contact_id) {
    try {
      rejected = await rejectDigitalPending(
        db, (order as any).channel_id, (order as any).contact_id,
        typeof body.reject_motivo === "string" ? body.reject_motivo : undefined);
    } catch (e) {
      console.error("[order-update] reject:", (e as any)?.message ?? e);
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
  let avisoEnviado: string | null = null;
  let avisoError: string | null = null;
  // Cómo avisarle al cliente, elegido por el humano al mover el pedido:
  //   { modo:"mensaje" }  → el flujo de siempre (solo llega si la ventana de
  //                          24h sigue abierta; si no, Meta lo rechaza)
  //   { modo:"plantilla", template:{name,language,params} } → la única vía que
  //                          Meta acepta fuera de ventana
  //   { modo:"ninguno" }  → no avisar (lo hace él por su cuenta)
  // Sin el campo, se comporta como siempre ("mensaje").
  const aviso = (body.aviso ?? {}) as { modo?: string; template?: { name?: string; language?: string; params?: string[] } };
  const avisoModo = String(aviso.modo ?? "mensaje");

  if (avisoModo === "plantilla" && aviso.template?.name && (order as any).contact_id) {
    try {
      await sendTemplateToContact(db, (order as any).channel_id, (order as any).contact_id, {
        name: aviso.template.name, language: aviso.template.language, params: aviso.template.params ?? [],
      });
      avisoEnviado = aviso.template.name;
    } catch (e) {
      avisoError = String((e as any)?.message ?? e);
      console.error("[order-update] plantilla:", avisoError);
    }
  }

  // El aviso por plantilla YA le habló al cliente: disparar además el flujo de
  // ese estado le mandaría el mismo aviso dos veces (y el segundo fallaría por
  // ventana cerrada, que es justo por lo que se eligió plantilla).
  const saltarFlujo = avisoModo === "plantilla" || avisoModo === "ninguno";

  if (newEstado && (order as any).contact_id) {
    try {
      await db.from("contact_events").insert({
        channel_id: (order as any).channel_id, contact_id: (order as any).contact_id,
        tipo: "nota", titulo: "Pedido → " + newEstado,
      });
    } catch (_) { /* best-effort */ }

    const { data: trigs } = (extrasOfrecidos || saltarFlujo) ? { data: [] } : await db.from("flow_triggers")
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
  return json({ ok: true, estado: newEstado ?? (order as any).estado, flow_started: flowStarted, resumed, rejected,
    aviso_enviado: avisoEnviado, aviso_error: avisoError });
});
