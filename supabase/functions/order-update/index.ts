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
import { startFlowRun, syncPedidoSheet, resumeAfterApproval, rejectDigitalPending, entregarExtrasDigitales, resumeIntoExtras, cerrarConversacionVenta, moverEtapa, stageDeEstado, recomputeStageOnLoss, deliverStep, aplicarStock, reservarStockPedido, reconciliarStockManual, registrarOperacion, canalesQueCobranIgual, enviarClaveRecojo, mensajeEstadoDefault, demoraProvincia, saldoTrasAdelanto, avisarPagadoTotal, ventana24hAbierta, avisarEnvioFallido, resolverPrepagoLima, normOperacion } from "../_shared/engine.ts";
import { maybePurchase } from "../_shared/capi.ts";
import { sendTemplateToContact } from "../_shared/campaigns.ts";
import { EST } from "../_shared/order-stats.ts";

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
    order_bumps?: unknown[];
    product_id?: string; version_id?: string | null;
    reject?: string; reject_motivo?: string;
    // Cómo avisarle al cliente este cambio (lo elige el humano al mover el pedido).
    aviso?: { modo?: string; template?: { name?: string; language?: string; params?: string[] } };
    // Solo mirar: devuelve el mensaje que le llegaría al cliente, sin mover nada.
    preview?: boolean;
    // Pago adelantado de un pedido de Lima: aprobarlo (con el monto que confirmó el humano)
    // o rechazarlo. Ver resolverPrepagoLima en engine.ts.
    prepago_lima?: "aprobar" | "rechazar"; monto?: number; motivo?: string; via?: string;
  };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!body.order_id) return json({ error: "falta_order_id" }, 400);

  const { data: order } = await db.from("orders")
    // products(nombre): lo usa el resumen del pedido que va en el aviso de estado — sin él
    // decía «📦 *3 frascos*» sin decir de qué producto.
    .select("id, channel_id, contact_id, estado, shipping, amount, currency, product_id, order_bumps, confirmed_at, products(nombre)")
    .eq("id", body.order_id).maybeSingle();
  if (!order) return json({ error: "no_existe" }, 404);
  // Multi-tenant: si entra un humano (no el service-role interno del Copiloto),
  // su cuenta debe ser dueña del canal del pedido.
  if (!interno && !(await userOwnsChannel(db, uid, (order as any).channel_id))) {
    return json({ error: "forbidden_channel" }, 403);
  }

  // 🛵 Pago adelantado de Lima: no mueve el estado (el pedido sigue «confirmado»), así que va
  // por su propio camino — con su candado, que el CAS por estado de abajo no daría.
  if (body.prepago_lima === "aprobar" || body.prepago_lima === "rechazar") {
    const r = await resolverPrepagoLima(db, order.id, body.prepago_lima, {
      monto: body.monto, motivo: body.motivo, por: interno ? (body.via || "interno") : uid,
    });
    if (r.error) return json({ error: r.error, detalle: r.detalle }, r.error === "no_existe" ? 404 : 400);
    return json(r);
  }

  // 👁️ VISTA PREVIA: qué mensaje le llegaría al cliente si mueves el pedido a `estado`.
  // No toca nada. Existe para que el panel pueda MOSTRAR el aviso por defecto del motor
  // en vez de proponer "no avisarle": el dueño que no escribió un texto propio veía
  // "no se enviaría nada" y confirmaba en silencio… con un mensaje correcto ya escrito
  // acá. La preview sale de la MISMA función que envía, así que no hay dos versiones.
  if (body.preview === true) {
    const shipP = { ...((order as any).shipping ?? {}) };
    let demP = "";
    try {
      const { data: chP } = await db.from("channels").select("entregas")
        .eq("id", (order as any).channel_id).maybeSingle();
      demP = demoraProvincia((chP as any)?.entregas, String(shipP?.ciudad ?? ""));
    } catch { /* sin config → sin plazo */ }
    const bumpsP = ((order as any).order_bumps ?? []) as any[];
    const totalP = (Number((order as any).amount) || 0) +
      bumpsP.reduce((a, b) => a + (Number((b as any)?.precio) || 0), 0);
    // Si el negocio escribió su PROPIO aviso para este estado (Pagos y atención → Avisos de
    // pedido), ESE es el que sale — la preview mostraba el genérico del motor y el operador
    // confirmaba viendo un texto que no era el que le llegaba al cliente.
    let previoPropio = "";
    try {
      const { data: chAv } = await db.from("channels").select("pedidos_config").eq("id", (order as any).channel_id).maybeSingle();
      const avP = (chAv as any)?.pedidos_config?.avisos?.[String(body.estado ?? "")] ?? {};
      if (String(avP.modo ?? "mensaje") !== "flujo") previoPropio = String(avP.texto ?? "").trim();
    } catch { /* sin config → el genérico */ }
    return json({
      ok: true,
      propio: !!previoPropio,
      preview: previoPropio || (mensajeEstadoDefault(String(body.estado ?? ""), shipP, totalP,
        (order as any).currency, bumpsP, (order as any).products?.nombre ?? null, demP) ?? ""),
    });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let notaSinOperacion = false; // se anota tras el CAS (ver más abajo)
  // Registra en el anti-reúso la operación de CADA abono de un pago en partes (idempotente).
  const registrarAbonos = async (abonos: unknown, ctxOp: string) => {
    if (!Array.isArray(abonos)) return;
    for (const a of abonos as any[]) {
      const op = String(a?.op ?? "").trim();
      if (op) await registrarOperacion(db, (order as any).channel_id, op, order.id, ctxOp).catch(() => {});
    }
  };
  if (body.shipping && typeof body.shipping === "object") {
    patch.shipping = { ...((order as any).shipping ?? {}), ...body.shipping };
  }
  if (typeof body.amount === "number" && Number.isFinite(body.amount) && body.amount >= 0) {
    patch.amount = body.amount;
    // Si un humano CAMBIÓ el monto, queda marcado: el motor no lo recalcula al aprobar (crearPedido).
    if (Math.abs(body.amount - (Number((order as any).amount) || 0)) > 0.009) {
      patch.shipping = { ...((patch.shipping as any) ?? (order as any).shipping ?? {}), monto_manual: true };
    }
  }
  // Editar los order_bumps a mano desde "Editar pedido" (quitar un extra puesto
  // por error, corregir un precio). OJO: no reconcilia stock ni el saldo — eso lo
  // ajusta el operador aparte.
  // 🔒 Cada extra con presentación tiene que ser de un producto de ESTE canal (igual que
  // venta-manual): un version_id de otra cuenta hacía que entregarExtrasDigitales le mandara
  // a este cliente el contenido digital pagado de otro negocio.
  if (Array.isArray(body.order_bumps)) {
    // Los que el pedido YA tenía no se revisan: si su producto se borró después, editar el
    // pedido (p. ej. corregir un precio) no debe fallar por un extra viejo.
    const yaEstaban = new Set((((order as any).order_bumps ?? []) as any[]).map((b) => String(b?.version_id ?? "")));
    for (const b of body.order_bumps as any[]) {
      const vid = b?.version_id;
      if (!vid || yaEstaban.has(String(vid))) continue;
      const { data: okV } = await db.from("product_versions").select("id, products!inner(channel_id)")
        .eq("id", String(vid)).eq("products.channel_id", (order as any).channel_id).maybeSingle();
      if (!okV) return json({ error: "extra_invalido", detalle: "Uno de los extras no es de este bot." }, 400);
    }
    patch.order_bumps = body.order_bumps;
  }
  // Cambiar el producto del pedido desde "Editar pedido". Se valida que el nuevo
  // producto pertenezca al MISMO canal del pedido (no colar uno ajeno). El stock se
  // reconcilia abajo (reconciliarStockManual); el saldo/amount los ajusta el operador.
  if (typeof body.product_id === "string" && body.product_id) {
    const { data: prod } = await db.from("products").select("id")
      .eq("id", body.product_id).eq("channel_id", (order as any).channel_id).maybeSingle();
    if (!prod) return json({ error: "producto_ajeno" }, 400);
    patch.product_id = body.product_id;
    patch.version_id = (typeof body.version_id === "string" && body.version_id) ? body.version_id : null;
    if (patch.version_id) {
      const { data: okV } = await db.from("product_versions").select("id")
        .eq("id", patch.version_id as string).eq("product_id", body.product_id).maybeSingle();
      if (!okV) return json({ error: "version_invalida", detalle: "Esa presentación no es de ese producto." }, 400);
    }
  }
  const newEstado = body.estado && body.estado !== (order as any).estado ? body.estado : null;
  // 🚦 El estado tiene que ser uno de los que el sistema conoce (EST, la misma tabla que usan
  // el Kanban y los números del Dashboard). Antes se escribía CUALQUIER string: un pedido con
  // un estado inventado —probando escribí "entregado" en vez de "entregado_cobrado"— no cae
  // en ninguna columna del Kanban, `stageDeEstado` devuelve null así que la etapa del contacto
  // se congela, y como EST no lo clasifica desaparece de la plata del Dashboard. Todo eso en
  // silencio. Desde los botones del panel no pasa (mandan estados válidos), pero esta función
  // es un endpoint y el pedido queda en un limbo del que nadie se entera.
  if (newEstado && !EST[newEstado]) {
    return json({ error: "estado_desconocido", detalle: `"${newEstado}" no es un estado de pedido. Válidos: ${Object.keys(EST).join(", ")}` }, 400);
  }
  // 🚦 Saltos IMPOSIBLES. No había matriz de transiciones: un pedido cancelado podía pasar
  // directo a «despachado» (y el bloque de «revivir stock» le descontaba otra unidad), y uno
  // ya recogido/cobrado podía volver a «esperando adelanto». Los perdidos se reactivan solo
  // por el principio (pendiente / confirmado / esperando_adelanto / adelanto_validado), y de
  // un pedido cerrado no se retrocede.
  if (newEstado) {
    const _origen = String((order as any).estado ?? "");
    // `no_recogido` NO va acá: el Kanban lo redespacha (→ despachado / en_agencia) y es la
    // corrección más común de ese estado.
    const _PERDIDOS = ["cancelado", "anulada", "rechazado"];
    const _AVANZADOS = ["por_despachar", "despachado", "en_agencia", "saldo_pagado", "recogido", "entregado_cobrado", "en_reparto", "reprogramado"];
    const _CERRADOS = ["recogido", "entregado_cobrado"];
    const _INICIALES = ["pendiente", "esperando_adelanto", "adelanto_validado", "confirmado", "confirmada"];
    if (_PERDIDOS.includes(_origen) && _AVANZADOS.includes(newEstado)) {
      return json({ error: "transicion_invalida", detalle: `Un pedido «${_origen}» no puede pasar directo a «${newEstado}». Reactívalo primero (pendiente, confirmado o esperando adelanto).` }, 400);
    }
    if (_CERRADOS.includes(_origen) && _INICIALES.includes(newEstado)) {
      return json({ error: "transicion_invalida", detalle: `Un pedido «${_origen}» ya está cerrado; no puede volver a «${newEstado}».` }, 400);
    }
    // De una venta cerrada a un estado INTERMEDIO (en agencia, en reparto, despachado…): puede ser
    // corregir un clic equivocado, pero al cliente le llega «paga tu saldo» o «tu pedido salió»
    // y la venta sale del Dashboard. Solo con confirmación explícita (el panel la pide).
    const _SALIDAS_OK = ["anulada", "cancelado", "devuelto", "rechazado", "no_recogido", ..._CERRADOS];
    if (_CERRADOS.includes(_origen) && !_SALIDAS_OK.includes(newEstado) && (body as any).forzar !== true) {
      return json({ error: "cerrado_confirmar", detalle: `Este pedido ya está «${_origen}» (venta cerrada). Si lo pasas a «${newEstado}», al cliente le puede llegar el aviso de ese estado y la venta deja de contar en el Dashboard.` }, 409);
    }
  }
  if (newEstado) {
    patch.estado = newEstado;
    // La fecha de la VENTA se fija UNA vez (la primera vez que se cierra): antes se reescribía en cada
    // paso (saldo pagado → recogido) y en Compras la venta «se mudaba» de septiembre a octubre.
    // (Si la fecha vino de un paso que NO cierra —el adelanto validado también la sella—, se reescribe
    // al cerrar de verdad.)
    if (CONFIRM_STATES.includes(newEstado) && (!(order as any).confirmed_at || !CONFIRM_STATES.includes(String((order as any).estado)))) patch.confirmed_at = new Date().toISOString();
  }

  // 🔒 Anti-reúso en la APROBACIÓN MANUAL: si el nº de operación de este pago YA se
  // acreditó en OTRO pedido, NO aprobar (doble crédito / doble despacho contra un solo
  // pago real). El caso auto↔auto lo cierra reclamarOperacion; este cubre el hueco
  // manual↔manual: dos comprobantes del mismo Yape que crearon dos pedidos pendientes,
  // ambos "listos para aprobar" antes de que ninguno escribiera el ledger (los pre-chequeos
  // de reúso del motor no ven nada porque el ledger aún está vacío). El registro efectivo
  // sigue más abajo; acá solo se BLOQUEA el reúso CRUZADO. Mismo pedido = OK (idempotente).
  {
    const sh = ((order as any).shipping ?? {}) as any;
    // Un RECHAZO del extra también manda extra_pendiente:false: sin excluirlo se trataba como
    // aprobación (nota falsa «aprobado sin operación», 409 por reúso, operación registrada).
    const aprobandoExtra = body.resume === true || (body.shipping && (body.shipping as any).extra_pendiente === false && !(body.shipping as any).extra_rechazado_at);
    let opChk = "";
    if (newEstado === "adelanto_validado") opChk = String(sh.adelanto_operacion || sh.adelanto_operacion_leida || "");
    else if (newEstado === "saldo_pagado") opChk = String(sh.saldo_operacion || sh.saldo_operacion_leida || "");
    else if (newEstado === "confirmada") opChk = String(((patch.shipping as any) ?? sh).digital_operacion || ((patch.shipping as any) ?? sh).digital_operacion_leida || "");
    else if (aprobandoExtra) opChk = String(((patch.shipping as any) ?? sh).extra_operacion || ((patch.shipping as any) ?? sh).extra_operacion_leida || "");
    // LA MISMA normalización con la que se REGISTRA (normOperacion: solo letras y dígitos). Acá
    // solo se quitaban espacios, así que «YP-060625582J» o «N° 123456» nunca calzaban con lo
    // guardado y el mismo Yape se aprobaba a mano en dos pedidos.
    const opN = normOperacion(opChk);
    // ⚠️ Aprobar un pago SIN nº de operación (el OCR no lo leyó, o «Aprobar» a ojo) salta el
    // candado anti-reúso y no deja rastro: el pedido avanza, se entrega, y ninguna operación
    // queda registrada. Se permite (es decisión del operador) pero queda anotado en la Actividad.
    const _aprobandoPago = ["adelanto_validado", "saldo_pagado", "confirmada"].includes(String(newEstado ?? "")) || aprobandoExtra;
    // La nota se deja DESPUÉS del CAS (más abajo): acá, antes, un doble clic o un 2º operador
    // (que termina en `deduped`) la escribía dos veces, y una describía una aprobación que no
    // ocurrió.
    notaSinOperacion = _aprobandoPago && opN.length < 4 && !!(order as any).contact_id;
    if (opN.length >= 4) {
      // 💸 También los bots HERMANOS que cobran al MISMO número: el ledger se llevaba por
      // canal, así que un Yape ya acreditado en el otro bot de la cuenta se podía aprobar
      // acá a mano y un solo pago pagaba dos ventas (los dos canales de Rodrigo comparten
      // el 977533352). Ver canalesQueCobranIgual en engine.ts.
      const { data: prev } = await db.from("payment_operations").select("order_id, contact_id")
        .in("channel_id", await canalesQueCobranIgual(db, (order as any).channel_id))
        .eq("operacion", opN).limit(1).maybeSingle();
      // Ya reclamada por OTRO pedido → reúso. Y si quedó con order_id null (el pago digital
      // principal se reclama ANTES de que exista el pedido, así que su fila no lleva order_id),
      // se compara por CONTACTO: la misma operación en manos de otro cliente es un reúso igual.
      // Antes `prev.order_id &&` dejaba pasar justo ese caso: un Yape ya usado para un digital,
      // mandado como adelanto de un físico, se aprobaba a mano y un solo pago acreditaba dos ventas.
      const pOrd = (prev as any)?.order_id ?? null, pCt = (prev as any)?.contact_id ?? null;
      const reusada = !!prev && (pOrd ? pOrd !== order.id : (!!pCt && pCt !== (order as any).contact_id));
      if (reusada) {
        return json({ error: "operacion_reusada", detalle: `Esa operación (${opN}) ya se acreditó en otro pedido. Revísalo antes de aprobar.` }, 409);
      }
    }
  }
  // Comprobante RECHAZADO: el abono que ese comprobante había sumado a la bolsa de pagos
  // parciales (`*_abonos`) tiene que salir de ella. Antes se quedaba: una captura falsa de
  // S/10 rechazada + un Yape real de S/10 después sumaban S/20 y «cubrían» el adelanto (o el
  // saldo): se despachaba (o se soltaba la clave) con la mitad del dinero. Se quita el abono
  // que corresponde al ÚLTIMO comprobante leído (por su nº de operación; sin operación, el
  // último de ese monto sin operación) y se recalcula lo abonado.
  if (patch.shipping) {
    const shp = patch.shipping as any;
    for (const pre of ["adelanto", "saldo"]) {
      if (!(body.shipping as any)?.[`${pre}_rechazado_at`]) continue;
      const abonos = Array.isArray(shp[`${pre}_abonos`]) ? [...shp[`${pre}_abonos`]] : [];
      if (!abonos.length) continue;
      const opL = String(shp[`${pre}_operacion_leida`] ?? "").toUpperCase().replace(/\s+/g, "").trim();
      const mL = Number(shp[`${pre}_monto_leido`]);
      let idx = -1;
      if (opL.length >= 4) idx = abonos.map((a: any) => String(a?.op ?? "").toUpperCase().replace(/\s+/g, "")).lastIndexOf(opL);
      if (idx < 0 && Number.isFinite(mL)) { for (let i = abonos.length - 1; i >= 0; i--) { if (!abonos[i]?.op && Number(abonos[i]?.monto) === mL) { idx = i; break; } } }
      if (idx < 0) idx = abonos.length - 1;
      abonos.splice(idx, 1);
      const total = Math.round(abonos.reduce((s: number, a: any) => s + (Number(a?.monto) || 0), 0) * 100) / 100;
      shp[`${pre}_abonos`] = abonos;
      if (abonos.length) shp[`${pre}_abonado`] = total;
      else { delete shp[`${pre}_abonos`]; delete shp[`${pre}_abonado`]; delete shp[`${pre}_parcial`]; }
    }
  }

  // 🔓 Comprobante RECHAZADO: su nº de operación se LIBERA del anti-reúso (solo la reserva de ESTE
  // pedido). El motor la reserva al leerlo, antes de decidir si va a revisión; rechazado, quedaba
  // quemado y cuando el cliente reenviaba la misma captura —justo lo que el bot le pide— recibía
  // «este comprobante ya se usó». Un rechazo es «no lo acredito», no «es un fraude probado».
  if (body.shipping) {
    const shp: any = (patch.shipping as any) ?? {};
    for (const pre of ["adelanto", "saldo", "digital", "extra"]) {
      if (!(body.shipping as any)?.[`${pre}_rechazado_at`]) continue;
      const opR = normOperacion(String(shp[`${pre}_operacion_leida`] ?? shp[`${pre}_operacion`] ?? ""));
      if (opR.length < 4) continue;
      await db.from("payment_operations").delete()
        .eq("channel_id", (order as any).channel_id).eq("operacion", opR).eq("order_id", (order as any).id)
        .then(() => {}, () => {});
      // La reserva de un digital puede haber nacido SIN pedido (se reserva antes de crearlo): va por contacto.
      if ((order as any).contact_id) await db.from("payment_operations").delete()
        .eq("channel_id", (order as any).channel_id).eq("operacion", opR).is("order_id", null).eq("contact_id", (order as any).contact_id)
        .then(() => {}, () => {});
    }
  }

  // CAS sobre el estado cuando HAY transición: dos aprobaciones concurrentes del MISMO
  // botón de Telegram (doble-tap antes de que se quiten los botones) leían ambas el estado
  // viejo y ambas pasaban a entregar → DOBLE entrega digital + doble aviso. Con `.eq(estado)`
  // solo una gana el UPDATE; la otra afecta 0 filas y aborta las side-effects de abajo
  // (resumeAfterApproval / entrega / CAPI / avisos). Sin transición (edición pura) no aplica.
  // extra_ok (aprobar una venta EXTRA) NO cambia el estado del pedido, así que el CAS de
  // estado no lo cubre y dos toques concurrentes (dos admins con el mismo aviso, o doble-tap)
  // entregaban el extra digital DOS veces (segundo link/licencia regalado + doble aviso +
  // doble fila en Sheets). Le damos su propio CAS por DATO: el UPDATE solo procede si el
  // extra SIGUE pendiente; el 2do toque afecta 0 filas y aborta las side-effects de abajo.
  const aprobandoExtraCas = !newEstado && !!(body.shipping && (body.shipping as any).extra_pendiente === false);
  let uq = db.from("orders").update(patch).eq("id", order.id);
  if (newEstado) uq = uq.eq("estado", (order as any).estado);
  else if (aprobandoExtraCas) uq = uq.eq("shipping->>extra_pendiente", "true");
  const { data: upd, error } = await uq.select("id");
  if (error) return json({ error: error.message }, 500);
  if ((newEstado || aprobandoExtraCas) && (!upd || !upd.length)) return json({ ok: true, deduped: true });
  if (notaSinOperacion) {
    await db.from("contact_events").insert({
      channel_id: (order as any).channel_id, contact_id: (order as any).contact_id, tipo: "nota",
      titulo: "⚠️ Pago aprobado sin nº de operación",
      detalle: `Se aprobó «${newEstado ?? "venta extra"}» sin operación legible: no entra al candado anti-reúso. Si tienes el comprobante, anota la operación en el pedido.`,
    }).then(() => {}, () => {});
  }
  // La hoja sigue al pedido: acá pasan TODOS los cambios que hace un humano
  // (el Kanban y el Copiloto, incluido el de Telegram). No lanza.
  await syncPedidoSheet(db, order.id);
  // 📦 Stock: si el pedido salta de «esperando adelanto / pendiente» directo a un estado
  // avanzado (Editar pedido lo permite: pagó por fuera), el stock nunca se apartaba —solo
  // se reservaba al pasar por «adelanto validado»— y la venta cerraba sin descontar nada.
  // reservarStockPedido es idempotente (claim atómico).
  if (newEstado && ["esperando_adelanto", "pendiente"].includes(String((order as any).estado ?? "")) &&
      ["por_despachar", "despachado", "en_agencia", "saldo_pagado", "recogido", "entregado_cobrado", "confirmado"].includes(newEstado)) {
    try { await reservarStockPedido(db, order.id, (order as any).channel_id); }
    catch (e) { console.error("[order-update] reservar stock (salto directo):", (e as any)?.message ?? e); }
  }

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
    // 📦 Stock: si la venta se CAE (cancelada/rechazada/no recogida/anulada),
    // devuelve al inventario las unidades que se reservaron al crear el pedido.
    // Idempotente: la bandera stock_devuelto evita devolver dos veces.
    // …salvo que el producto YA SE ENTREGÓ (Lima entregado y cobrado, provincia recogido): anular
    // esa venta (pago falso, devolución de plata) no trae el paquete de vuelta al almacén, y sumar
    // la unidad inventaba stock que no existe. Si de verdad vuelve, se ajusta a mano.
    const _yaEntregado = ["entregado_cobrado", "recogido"].includes(String((order as any).estado ?? ""));
    if (st === "perdido" && _yaEntregado) {
      await db.from("contact_events").insert({ channel_id: (order as any).channel_id, contact_id: (order as any).contact_id, tipo: "nota",
        titulo: "📦 Stock no devuelto", detalle: `El pedido ya estaba «${(order as any).estado}» (el producto salió). Si te lo devolvieron, súmalo a mano en el producto.` }).then(() => {}, () => {});
    }
    if (st === "perdido" && !_yaEntregado) {
      const ship = ((order as any).shipping || {}) as any;
      if (ship.stock_descontado && !ship.stock_devuelto && Array.isArray(ship.stock_mov)) {
        try {
          // Solo se marca stock_devuelto si el +1 REALMENTE aplicó (ok): si el CAS agotó
          // reintentos bajo contención, NO marcar → la unidad no se pierde del inventario
          // (queda pendiente de un reintento) en vez de darla por devuelta sin haberlo hecho.
          const { ok } = await aplicarStock(db, ship.stock_mov, 1);
          // order_patch_shipping (0068), NO un write del shipping completo: order-update no
          // toma el contact_lock y el handler del cliente (sede/dirección) escribe shipping
          // en paralelo → `{ ...ship(snapshot viejo), ... }` PISABA una sede recién editada
          // (paquete a la agencia equivocada). El patch fusiona SOLO la bandera, atómico.
          // El error se MIRA (db.rpc no lanza): si la marca no se graba, el stock ya volvió
          // pero el pedido no lo sabe → la próxima cancelación lo devuelve OTRA VEZ.
          if (ok) { const { error: _eDev } = await db.rpc("order_patch_shipping", { p_order_id: (order as any).id, p_patch: { stock_devuelto: true } }); if (_eDev) console.error("[order-update] patch devuelto:", _eDev.message); }
          else console.error("[order-update] devolver stock: CAS agotó reintentos — NO marcado stock_devuelto");
        } catch (e) { console.error("[order-update] devolver stock:", (e as any)?.message ?? e); }
      }
    } else {
      // 📦 REVIVIR un pedido cancelado: si venía con el stock DEVUELTO (stock_devuelto:true)
      // y se lo mueve de vuelta a un estado VIVO (no perdido), se vuelve a descontar el
      // inventario. Sin esto el pedido revivido se despacharía SIN apartar stock (sobreventa
      // silenciosa): order_claim_stock exige stock_descontado=false y reconciliarStockManual
      // ve stock_devuelto y no toca nada. Idempotente por la propia bandera.
      const ship = ((order as any).shipping || {}) as any;
      if (ship.stock_devuelto === true && Array.isArray(ship.stock_mov) && ship.stock_mov.length) {
        try {
          const { ok } = await aplicarStock(db, ship.stock_mov, -1);
          // Igual que arriba: patch atómico de las banderas, no un write del shipping completo
          // (que pisaría ediciones concurrentes de sede/dirección hechas bajo el lock).
          if (ok) { const { error: _eRev } = await db.rpc("order_patch_shipping", { p_order_id: (order as any).id, p_patch: { stock_devuelto: false, stock_descontado: true } }); if (_eRev) console.error("[order-update] patch revivir:", _eRev.message); }
          else console.error("[order-update] revivir stock: CAS agotó reintentos — NO re-descontado");
        } catch (e) { console.error("[order-update] revivir stock:", (e as any)?.message ?? e); }
      }
    }
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
  // 🔴 Aprobado pero SIN reanudar = la venta cuenta, Meta recibió el Purchase… y el cliente no
  // recibe nada (la conversación que esperaba el visto bueno ya no estaba: se reinició, entró
  // por otro anuncio). Antes el panel decía «Listo» igual. Se deja escrito y se avisa.
  const entregaPendiente = wantResume && !resumed && !!(order as any).contact_id;
  if (entregaPendiente) {
    await db.from("contact_events").insert({
      channel_id: (order as any).channel_id, contact_id: (order as any).contact_id, tipo: "error",
      titulo: "⚠️ Pago aprobado, pero el producto NO se entregó solo",
      detalle: "La conversación ya no estaba esperando esta aprobación. Entrégale el acceso a mano desde el chat.",
    }).then(() => {}, () => {});
  }

  // Comprobante RECHAZADO en el Copiloto: el run quedaba parqueado y el bot le
  // respondía "estoy verificando tu pago" para siempre. Se reanuda por la rama
  // de pago inválido para que pida un comprobante nuevo. Solo si el operador
  // eligió que el bot siga (si prefiere atenderlo él, manda `reject:"humano"` y
  // el chat queda pausado y ese run parqueado se cierra: ver la rama «humano» de abajo).
  let rejected = false;
  if (body.reject === "bot" && (order as any).contact_id) {
    try {
      rejected = await rejectDigitalPending(
        db, (order as any).channel_id, (order as any).contact_id,
        typeof body.reject_motivo === "string" ? body.reject_motivo : undefined);
    } catch (e) {
      console.error("[order-update] reject:", (e as any)?.message ?? e);
    }
  } else if (body.reject === "humano" && (order as any).contact_id) {
    // «Lo atiendo yo»: el run parqueado NO era inofensivo. Al reactivar el bot, cada mensaje —
    // incluido un comprobante nuevo— recibía «sigo verificando» sin pasar por el OCR, y aprobar
    // después moviendo a «confirmada» no entregaba (ya no había aprobación pendiente). Se cierra
    // ese run: el próximo comprobante vuelve a entrar por la venta normal.
    await db.from("flow_runs").update({ estado: "cancelado", updated_at: new Date().toISOString() })
      .eq("contact_id", (order as any).contact_id).in("estado", ["esperando", "activo"])
      .eq("vars->_await->>type", "aprobacion_digital")
      .then(() => {}, () => {});
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
  let avisoPagadoTotal = false;
  if (newEstado === "adelanto_validado" && (order as any).contact_id) {
    // 🔒 Anti-reúso: al aprobar el adelanto a mano, registra su operación en el
    // ledger unificado (payment_operations) → no se podrá reusar como pago
    // digital, como saldo, ni como adelanto de otro pedido. Idempotente.
    const shipA = ((order as any).shipping || {}) as any;
    const opA = String(shipA.adelanto_operacion || shipA.adelanto_operacion_leida || "").trim();
    if (opA) await registrarOperacion(db, (order as any).channel_id, opA, order.id, "adelanto").catch((e) => console.error("[order-update] registrar op adelanto:", (e as any)?.message ?? e));
    // Y CADA parte si se pagó en abonos: solo se registraba la última, así que la primera parte
    // (un Yape de S/15) se podía reenviar después como pago del saldo o de otro pedido.
    await registrarAbonos(shipA.adelanto_abonos, "adelanto");
    // 📦 Provincia solo aparta stock cuando el adelanto queda validado (acá, a
    // mano). Descuenta el plan guardado al crear el pedido. Idempotente.
    try {
      await reservarStockPedido(db, order.id, (order as any).channel_id);
    } catch (e) {
      console.error("[order-update] reservar stock:", (e as any)?.message ?? e);
    }
    // 💰 Acreditar al saldo lo pagado de MÁS en el adelanto (o marcar pagado total si
    // cubrió todo). Así el saldo a cobrar en la agencia baja solo, sin doble cobro si
    // el cliente adelantó de más o pagó completo de una. Se relee el shipping fresco
    // para no pisar lo que el cambio de estado ya escribió.
    try {
      const { data: fresh } = await db.from("orders").select("shipping").eq("id", order.id).maybeSingle();
      const shipNow = (((fresh as any)?.shipping) || shipA) as any;
      let totalAdel = Number(shipNow.adelanto_abonado ?? shipNow.adelanto_monto_leido ?? shipNow.adelanto) || 0;
      // 🚫 Freno de SOBREPAGO (espeja el camino AUTO en maybeAdelanto): si el monto que
      // leyó el OCR supera lo que el cliente PODRÍA deber (adelanto + saldo = total) por
      // más del margen, es casi seguro una mala lectura ("S/20" leído como "S/1200"). El
      // camino auto ya lo manda a manual por eso; pero al aprobar a mano NO se debe usar
      // ese número para reducir el saldo: zeroearía el saldo REAL y el negocio perdería lo
      // que falta cobrar en la agencia. Se acredita solo el adelanto esperado (si hubo un
      // sobrepago real, el operador ajusta el saldo a mano desde "Editar pedido").
      const totalOwed = (Number(shipNow.adelanto) || 0) + (Number(shipNow.saldo) || 0);
      const { data: chAdel } = await db.from("channels").select("pedidos_config").eq("id", (order as any).channel_id).maybeSingle();
      const _pc = (chAdel as any)?.pedidos_config ?? {};
      const _mRaw = Number(_pc?.adelanto?.revisar_sobre_sol ?? _pc?.digital?.revisar_sobre_sol);
      const margenAdel = Number.isFinite(_mRaw) && _mRaw >= 0 ? _mRaw : 50;
      if (totalOwed > 0 && totalAdel > totalOwed + margenAdel) totalAdel = Number(shipNow.adelanto) || 0;
      const { saldo: saldoNuevo, pagadoTotal } = saldoTrasAdelanto(shipNow, totalAdel);
      // Idempotencia: NO re-acreditar el MISMO pago. Si el operador mueve el pedido
      // adelanto_validado → esperando_adelanto → adelanto_validado, sin esta guarda
      // se volvía a restar sobre el saldo YA reducido (cobraba de menos en la agencia).
      const yaAcreditado = Number(shipNow.pago_acreditado_adelanto);
      // Se avisa DESPUÉS del bloque (tras resumeIntoExtras), para que el mensaje no
      // se le adelante al "¡Adelanto recibido!" del flujo. Ver avisarPagadoTotal.
      avisoPagadoTotal = pagadoTotal && saldoNuevo < (Number(shipNow.saldo) || 0) && yaAcreditado !== totalAdel;
      // También cuando el saldo SUBE: aprobar a mano un adelanto MENOR al pedido (el cliente
      // pagó solo el mínimo, o el operador aceptó menos) dejaba el saldo intacto → en la
      // agencia se le cobraba S/100 en vez de S/110 y el Dashboard contaba S/20 cobrados
      // cuando entraron S/10. El camino AUTO ya escribía el saldo nuevo siempre; este no.
      const _saldoAct = Number(shipNow.saldo) || 0;
      const _sube = saldoNuevo > _saldoAct && totalAdel > 0;
      if (_sube && (order as any).contact_id) {
        await db.from("contact_events").insert({
          channel_id: (order as any).channel_id, contact_id: (order as any).contact_id, tipo: "nota",
          titulo: "💰 Adelanto aprobado por debajo de lo pedido",
          detalle: `Se acreditó ${totalAdel} de los ${Number(shipNow.adelanto) || 0} pedidos: el saldo pasa de ${_saldoAct} a ${saldoNuevo}. Si el monto leído está mal, corrige el saldo en Editar pedido.`,
        }).then(() => {}, () => {});
      }
      if ((saldoNuevo < _saldoAct || _sube) && yaAcreditado !== totalAdel) {
        // MERGE atómico (order_patch_shipping, 0068), NO write del shipping completo:
        // order-update no toma el contact_lock y el handler del cliente escribe shipping
        // (sede/dirección) en paralelo → un write completo pisaría una sede recién editada
        // (paquete a la agencia equivocada). Se tocan SOLO las claves de pago.
        // 🔴 El error se MIRA: `db.rpc()` no lanza (devuelve `{ error }`), así que el
        // try/catch que había acá no corría nunca y un fallo se perdía entero — el pedido se
        // quedaba con el saldo VIEJO después de acreditarle el adelanto, o sea cobrándole de
        // más al cliente, sin una línea en ningún log.
        const { error: _ePatch } = await db.rpc("order_patch_shipping", { p_order_id: order.id, p_patch: { saldo: String(saldoNuevo), adelanto_abonado: totalAdel, pago_acreditado_adelanto: totalAdel, ...(pagadoTotal ? { pagado_total: true } : {}) } });
        if (_ePatch) {
          console.error("[order-update] patch crédito adelanto:", _ePatch.message);
          await db.from("contact_events").insert({
            channel_id: (order as any).channel_id, contact_id: (order as any).contact_id, tipo: "error",
            titulo: "⚠️ No se pudo acreditar el adelanto al saldo",
            detalle: `El pedido quedó con el saldo anterior (${_saldoAct}) en vez de ${saldoNuevo}. Corrígelo en «Editar pedido» antes de cobrarle. (${_ePatch.message})`,
          }).then(() => {}, () => {});
        }
      }
    } catch (e) { console.error("[order-update] crédito saldo adelanto:", (e as any)?.message ?? e); }
    try {
      extrasOfrecidos = await resumeIntoExtras(db, (order as any).channel_id, (order as any).contact_id);
    } catch (e) {
      console.error("[order-update] resume extras:", (e as any)?.message ?? e);
    }
    // Pagó el total de una: decírselo. Si no, se queda creyendo que todavía debe
    // el saldo en la agencia (ver avisarPagadoTotal en engine.ts).
    if (avisoPagadoTotal) await avisarPagadoTotal(db, (order as any).channel_id, (order as any).contact_id);
  }

  // 🔒 Anti-reúso: al aprobar el saldo a mano (o al cerrar el pedido cobrado),
  // registra su operación en el ledger unificado. Idempotente.
  if (newEstado === "saldo_pagado" && (order as any).contact_id) {
    const shipS = ((order as any).shipping || {}) as any;
    const opS = String(shipS.saldo_operacion || shipS.saldo_operacion_leida || "").trim();
    if (opS) await registrarOperacion(db, (order as any).channel_id, opS, order.id, "saldo").catch((e) => console.error("[order-update] registrar op saldo:", (e as any)?.message ?? e));
    await registrarAbonos(shipS.saldo_abonos, "saldo");
  }

  // 🔒 Anti-reúso DIGITAL: cuando un pago digital que fue a validación MANUAL se
  // aprueba (pasa a 'confirmada', vía el botón digital_ok de Telegram o el panel),
  // registra su operación en el ledger unificado — igual que adelanto/saldo. Sin
  // esto el comprobante aprobado a mano nunca entraba al ledger (el registro solo
  // ocurría en el camino AUTOMÁTICO) y podía REUSARSE en otra compra digital. La
  // guarda `if (opD)` lo limita a pagos digitales: un pedido físico en 'confirmada'
  // no tiene digital_operacion. Idempotente (registrarOperacion ignora duplicados).
  if (newEstado === "confirmada" && (order as any).contact_id) {
    const shipD = ((patch.shipping as any) ?? (order as any).shipping ?? {}) as any;
    const opD = String(shipD.digital_operacion || shipD.digital_operacion_leida || "").trim();
    if (opD) await registrarOperacion(db, (order as any).channel_id, opD, order.id, "digital").catch((e) => console.error("[order-update] registrar op digital:", (e as any)?.message ?? e));
    await registrarAbonos(shipD.digital_abonos, "digital");
  }

  // 🔒 Anti-reúso EXTRA: mismo hueco que el digital, pero para el pago de una venta
  // EXTRA aprobado a mano. El botón extra_ok manda { resume:true, extra_pendiente:false }
  // SIN cambiar el estado del pedido, así que no lo cubre el bloque de arriba. El nº de
  // operación del extra se guardó en shipping.extra_operacion al ir a validación manual
  // (engine: rama esExtra). Sin registrarlo, ese comprobante quedaba reusable. Guarda:
  // solo cuando de verdad se aprueba el extra (resume o extra_pendiente:false) y hay op.
  if ((order as any).contact_id) {
    const shipE = ((patch.shipping as any) ?? (order as any).shipping ?? {}) as any;
    const opE = String(shipE.extra_operacion || shipE.extra_operacion_leida || "").trim();
    // Un RECHAZO del extra también manda extra_pendiente:false: sin excluirlo se trataba como
    // aprobación (nota falsa «aprobado sin operación», 409 por reúso, operación registrada).
    const aprobandoExtra = body.resume === true || (body.shipping && (body.shipping as any).extra_pendiente === false && !(body.shipping as any).extra_rechazado_at);
    if (opE && aprobandoExtra) await registrarOperacion(db, (order as any).channel_id, opE, order.id, "extra").catch((e) => console.error("[order-update] registrar op extra:", (e as any)?.message ?? e));
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

  // Mensaje escrito en Pagos y atención → Avisos de pedido. Se manda DIRECTO,
  // sin flujo: nadie debería tener que armar un flujo para escribir "tu pedido
  // va en camino". Si el negocio no escribió nada ahí, cae al flujo de siempre
  // (compat con los avisos que ya existían).
  if (avisoModo === "mensaje" && newEstado && (order as any).contact_id) {
    try {
      const { data: chA } = await db.from("channels").select("pedidos_config")
        .eq("id", (order as any).channel_id).maybeSingle();
      const cfg = (chA as any)?.pedidos_config?.avisos?.[newEstado] ?? {};
      const texto = String(cfg.texto ?? "").trim();
      if (texto) {
        // El aviso configurado es TEXTO LIBRE (y quizá una imagen): Meta lo RECHAZA fuera
        // de la ventana de 24h (mover el pedido suele pasar días después del último mensaje
        // del cliente). Igual que el aviso por defecto de abajo, solo se manda DENTRO de la
        // ventana; fuera se registra para que el negocio use una plantilla. Antes se enviaba
        // siempre y, fuera de ventana, fallaba en silencio marcando avisoEnviado="mensaje".
        if (await ventana24hAbierta(db, (order as any).contact_id)) {
          // Con la foto de la guía: UNA burbuja de imagen con el texto de pie.
          // Si el pedido no tiene foto, emit() manda el pie como texto solo.
          // 📎 Archivo FIJO de este aviso (Pagos y avisos → "Adjuntar imagen o audio"): el
          // mismo para todos los clientes que llegan a este momento — la foto de "así te
          // llega a la agencia", un audio explicando cómo recoger. No lo elige la IA: está
          // pegado al momento. Va como burbuja aparte y DESPUÉS del texto, para que el
          // cliente lea primero de qué se trata; un archivo suelto sin contexto no se abre.
          const mmA = cfg.media && cfg.media.media_url ? cfg.media : null;
          // La guía puede ser un PDF (Shalom la entrega así): mandarla como `image` la rechaza
          // Meta (131053) y como la burbuja es única, el cliente se quedaba sin guía Y sin texto.
          const gk = String((order as any).shipping?.guia_foto_kind || "image");
          const bubbles = cfg.foto_guia
            ? [{ media_kind: gk, media_url: "{{pedido_guia_foto}}", caption: texto, text: texto, ...(gk === "document" ? { filename: "guia.pdf", mime: "application/pdf" } : {}) }]
            : [{ text: texto }];
          if (mmA) {
            bubbles.push({
              media_kind: mmA.media_kind || "image", media_url: mmA.media_url,
              mime: mmA.mime, filename: mmA.filename, caption: "",
            } as any);
          }
          // deliverStep devuelve false si Meta rechazó el envío → NO marcar como enviado.
          if (await deliverStep(db, (order as any).channel_id, (order as any).contact_id, { bubbles }, (order as any).id)) avisoEnviado = "mensaje";
          else avisoError = "Meta rechazó el envío del aviso";
        } else {
          avisoError = "fuera de la ventana de 24h — usa una plantilla para avisar";
          console.warn(`[order-update] aviso "mensaje" de "${newEstado}" NO enviado: fuera de la ventana de 24h.`);
        }
      }
    } catch (e) {
      avisoError = String((e as any)?.message ?? e);
      console.error("[order-update] aviso propio:", avisoError);
    }
  }

  // Exige newEstado (como la rama "mensaje"): el aviso está atado al MOVIMIENTO del pedido. Sin
  // esto, un 2º update sin transición (doble modal por doble clic → el 1º ya cambió el estado, el
  // 2º llega con newEstado=null pero el CAS no cubre la plantilla) reenviaba la plantilla al cliente.
  if (avisoModo === "plantilla" && newEstado && aviso.template?.name && (order as any).contact_id) {
    try {
      const wamidTpl = await sendTemplateToContact(db, (order as any).channel_id, (order as any).contact_id, {
        name: aviso.template.name, language: aviso.template.language, params: aviso.template.params ?? [],
      }, undefined, (order as any).id);
      // Sin token / número / wa_id la función NO lanza: devuelve "" y deja el mensaje `failed`.
      // Antes acá se daba por enviada igual → «✅ plantilla enviada» con el cliente sin nada.
      if (wamidTpl) avisoEnviado = aviso.template.name;
      else { avisoError = "el canal no pudo enviar la plantilla (token, número o contacto sin WhatsApp)"; try { await avisarEnvioFallido(db, (order as any).channel_id, (order as any).contact_id, { message: avisoError }, { critico: true }); } catch (_) { /* best-effort */ } }
    } catch (e) {
      avisoError = String((e as any)?.message ?? e);
      console.error("[order-update] plantilla:", avisoError);
    }
  }

  // El aviso por plantilla YA le habló al cliente: disparar además el flujo de
  // ese estado le mandaría el mismo aviso dos veces (y el segundo fallaría por
  // ventana cerrada, que es justo por lo que se eligió plantilla).
  // El flujo solo entra si NADIE le habló ya al cliente: si salió el mensaje
  // propio o la plantilla, dispararlo además mandaría el aviso dos veces.
  const saltarFlujo = avisoModo === "plantilla" || avisoModo === "ninguno" || avisoEnviado === "mensaje";

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

  // Aviso al cliente por DEFECTO: si el pedido cambió de estado y NADIE le avisó
  // (ni un aviso configurado en Pagos y atención, ni un flujo pedido_estado),
  // mandamos un mensaje por defecto para que el paso no quede MUDO. Cubre "en
  // reparto" (Lima: salió el motorizado), "despachado" (provincia: va a la
  // agencia + guía) y "saldo pagado" (clave de recojo). Usa el shipping ya
  // fusionado (incluye lo recién guardado en esta misma llamada).
  // avisoModo !== "ninguno": si el operador eligió "No avisarle" (Editar pedido manda SIEMPRE
  // {modo:"ninguno"}, y los modales de despacho/lote/llegada lo ofrecen), este fallback por DEFECTO
  // NO debe mandar nada. Sin el guard, mover "en silencio" a saldo_pagado/recogido igual le mandaba
  // al cliente la CLAVE DE RECOJO (o el aviso de despacho), incumpliendo el contrato {ninguno}→no avisar.
  // !extrasOfrecidos: al validar el adelanto de un producto con venta extra, la conversación se
  // reanuda hacia el ofrecimiento («¡Recibido! ¿te agrego…?») EN VEZ del aviso normal; sin este
  // guard salían los dos y el ofrecimiento quedaba sepultado entre dos «recibí tu adelanto».
  if (avisoModo !== "ninguno" && newEstado && !avisoEnviado && !flowStarted && !extrasOfrecidos && (order as any).contact_id) {
    // Se relee el shipping REAL: el crédito de un sobre-adelanto (order_patch_shipping, más
    // arriba) no está ni en `order` ni en `patch` → el aviso decía «falta S/130» a quien ya
    // pagó todo, justo después del «queda cubierto por completo».
    let shipFresco: Record<string, unknown> | null = null;
    try { const { data: fr } = await db.from("orders").select("shipping").eq("id", (order as any).id).maybeSingle(); shipFresco = ((fr as any)?.shipping ?? null) as Record<string, unknown> | null; } catch { /* cae al snapshot */ }
    const ship2 = { ...((order as any).shipping ?? {}), ...(shipFresco ?? {}), ...((patch.shipping as any) ?? {}) };
    // El "Ten listo S/X" / "A cobrar" para Lima debe ser el TOTAL (base + extras), como
    // el rótulo del motorizado y el Excel del courier. Antes pasaba solo `amount` (base) →
    // el motorizado cobraba total pero al cliente se le decía la base → conflicto en la
    // puerta. (Provincia usa s.saldo, que ya incluye los extras con sube_saldo.)
    const _amt = Number((patch.amount as number) ?? (order as any).amount) || 0;
    const _bumps = Array.isArray(patch.order_bumps) ? patch.order_bumps : ((order as any).order_bumps ?? []);
    const _total = _amt + (_bumps as any[]).reduce((a, b) => a + (Number((b as any)?.precio) || 0), 0);
    // ⏱️ El plazo de la agencia, si el negocio lo configuró (Negocio → Entrega y logística).
    let _dem = "";
    try {
      // `channelId` no existía en este archivo: ReferenceError tragado por el catch → el plazo
      // de la agencia («suele estar en 2 a 4 días») nunca salía por el aviso por defecto.
      const { data: chD } = await db.from("channels").select("entregas").eq("id", (order as any).channel_id).maybeSingle();
      _dem = demoraProvincia((chD as any)?.entregas, String((ship2 as any)?.ciudad ?? ""));
    } catch { /* sin config → el mensaje va sin plazo, como siempre */ }
    const txt = mensajeEstadoDefault(newEstado, ship2, _total, (order as any).currency, _bumps as any[],
      (order as any).products?.nombre ?? null, _dem);
    if (txt) {
      // Este aviso por defecto es TEXTO LIBRE. Meta lo rechaza fuera de la ventana de
      // servicio de 24h (mover una tarjeta a "despachado"/"en_agencia" suele pasar días
      // después del último mensaje del cliente). Antes se enviaba incondicionalmente →
      // Meta lo rechazaba, el cliente no recibía nada y `avisoEnviado="default"` hacía
      // creer que salió. Ahora solo se manda dentro de la ventana; fuera, se registra para
      // que el negocio use una plantilla (como hace el scheduler).
      try {
        if (await ventana24hAbierta(db, (order as any).contact_id)) {
          // Estar DENTRO de la ventana no garantiza que salga: Meta igual puede rechazar
          // (número inválido, media mala, límite). deliverStep devuelve false en ese caso y
          // NO lanza → marcar "default" a ciegas repite el mismo bug que el de fuera de
          // ventana, y para saldo_pagado eso es la CLAVE DE RECOJO dada por enviada. Espeja
          // la rama del aviso propio (arriba), que sí chequea el booleano.
          if (await deliverStep(db, (order as any).channel_id, (order as any).contact_id, { bubbles: [{ text: txt }] }, (order as any).id)) {
            avisoEnviado = "default";
          } else {
            avisoError = "Meta rechazó el envío del aviso";
            await avisarEnvioFallido(db, (order as any).channel_id, (order as any).contact_id, {
              message: newEstado === "saldo_pagado"
                ? "No pude enviar la CLAVE DE RECOJO (WhatsApp rechazó el envío). Mándasela a mano — la necesita para recoger su pedido ya pagado."
                : `No pude avisar al cliente el cambio a "${newEstado}" (WhatsApp rechazó el envío). Avísale a mano.`,
            }, { critico: true }).catch(() => {});
          }
        } else {
          console.warn(`[order-update] aviso default de "${newEstado}" NO enviado: fuera de la ventana de 24h.`);
          // Fuera de la ventana el aviso NO salió. Para saldo_pagado eso es la CLAVE DE
          // RECOJO —lo único que el cliente necesita para recoger su pedido YA PAGADO— y el
          // operador clicó "Aprobar y dar la clave" creyendo que salió. Se le avisa por
          // Telegram para que la mande por plantilla o a mano (antes: silencio total).
          await avisarEnvioFallido(db, (order as any).channel_id, (order as any).contact_id, {
            message: newEstado === "saldo_pagado"
              ? "No pude enviar la CLAVE DE RECOJO (el cliente está fuera de la ventana de 24h). Mándasela por plantilla o a mano — la necesita para recoger."
              : newEstado === "en_agencia"
              ? "No pude avisarle al cliente que su pedido LLEGÓ a la agencia (fuera de la ventana de 24h). Avísale por plantilla o a mano — tiene que ir a pagar el saldo y recogerlo."
              : `No pude avisar al cliente el cambio a "${newEstado}" (fuera de la ventana de 24h). Usa una plantilla.`,
          }, { critico: true }).catch(() => {});
        }
      } catch (e) { console.error("[order-update] aviso default:", (e as any)?.message ?? e); }
    } else if (newEstado === "saldo_pagado") {
      // Sin `txt` no se envía NADA, y para saldo_pagado eso significa que el cliente pagó y
      // se quedó SIN su clave de recojo. mensajeEstadoDefault devuelve null cuando el pedido
      // no tiene `clave_recojo` registrada. Antes esta rama no existía: `aviso_enviado` y
      // `aviso_error` volvían los DOS vacíos, así que el operador movía la tarjeta y daba
      // por avisado a alguien que nunca recibió nada. Ahora se dice qué falta y cómo
      // arreglarlo. (Las otras ramas de aviso ya dejaban su rastro; esta era la muda.)
      avisoError = "el pedido no tiene clave de recojo — regístrala en el pedido y vuelve a avisarle";
      await avisarEnvioFallido(db, (order as any).channel_id, (order as any).contact_id, {
        message: "El cliente pagó el saldo pero el pedido NO tiene clave de recojo registrada, así que no pude enviársela. Anótala en el pedido y mándasela — la necesita para recoger.",
      }, { critico: true }).catch(() => {});
    }
  }

  // 📦 Reconciliar stock desde "Editar pedido": si cambió la variante del principal,
  // se agregó/quitó un extra o se editó la variante de un regalo/extra, ajusta el
  // inventario (descuenta lo nuevo, devuelve lo removido). Idempotente y con guardias
  // adentro (no toca pedidos no reservados ni perdidos). No bloquea la respuesta.
  let stockAlerts: Array<{ nombre: string; key: string; restante: number; agotado: boolean }> = [];
  if (body.shipping || Array.isArray(body.order_bumps) || body.product_id) {
    try {
      // 🔄 El shipping FRESCO, no el snapshot con que entró la petición: el bloque «revivir»
      // de arriba ya cambió stock_devuelto/stock_descontado por RPC, y con la copia vieja
      // reconciliarStockManual veía «stock_devuelto: true» y no tocaba nada — un pedido revivido
      // y cambiado de producto en el mismo guardado se quedaba con el stock del producto viejo.
      // 🔴 Y SOLO el fresco: `patch.shipping` es una copia COMPLETA armada al inicio de la llamada
      // ({...order.shipping, ...body.shipping}). Ya se guardó arriba, así que el fresco lo trae; volver
      // a ponerlo encima pisaba lo que cambió DESPUÉS en esta misma llamada: el saldo corregido al
      // validar el adelanto (volvía al viejo), las marcas de stock del bloque «revivir» y el
      // `entregado` de los extras digitales (el regalo se le mandaba dos veces al cliente).
      let shipFinal: any = patch.shipping ? { ...((order as any).shipping ?? {}), ...(patch.shipping as any) } : (order as any).shipping;
      let bumpsFinal: any[] = Array.isArray(body.order_bumps) ? body.order_bumps : ((order as any).order_bumps ?? []);
      try {
        const { data: fresco, error: eFresco } = await db.from("orders").select("shipping, order_bumps").eq("id", (order as any).id).maybeSingle();
        if (!eFresco && fresco) {
          shipFinal = (fresco as any).shipping ?? {};
          bumpsFinal = Array.isArray((fresco as any).order_bumps) ? (fresco as any).order_bumps : [];
        }
      } catch (_) { /* se sigue con el snapshot */ }
      const prodFinal = (patch.product_id as string) ?? (order as any).product_id ?? null;
      const estadoFinal = String(newEstado ?? (order as any).estado);
      stockAlerts = await reconciliarStockManual(db, order.id, estadoFinal, shipFinal, bumpsFinal, prodFinal);
    } catch (e) { console.error("[order-update] reconciliar stock:", (e as any)?.message ?? e); }
  }

  return json({ ok: true, estado: newEstado ?? (order as any).estado, flow_started: flowStarted, resumed, rejected, entrega_pendiente: entregaPendiente,
    aviso_enviado: avisoEnviado, aviso_error: avisoError, stock_alerts: stockAlerts });
});
