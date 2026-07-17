// ═══════════════════════════════════════════════════════════════════
// Nodo · orders.js — QUÉ significa cada estado de un pedido, y cuánto
// dinero representa. Fuente ÚNICA: la importan dashboard.html y pedidos.html.
//
// Por qué existe: "qué cuenta como venta" vivía duplicado en TRES lugares con
// tres criterios distintos que no coincidían — y ninguno incluía `confirmado`
// (el estado de toda venta de Lima), así que el Dashboard decía "Ingresos
// S/ 0.00" aunque hubiera ventas físicas cobradas. Un solo lugar para decidirlo.
//
// La idea de fondo: en digital "vendí", "cobré" y "me deben" son lo mismo —el
// cliente paga por adelantado— y por eso un solo número alcanzaba. En físico se
// separan: un pedido de Lima confirmado es una venta cerrada con CERO cobrado
// (se paga al recibir), y uno de provincia con adelanto tiene S/ 20 en la mano
// y S/ 100 en el aire. Contar el total en esos casos infla; contar cero, miente
// al revés. Por eso cada estado declara cuánto se cobró DE VERDAD.
// ═══════════════════════════════════════════════════════════════════

// cobro: cuánto entró · venta: el cliente cerró la compra · perdido: no llega a
// destino · tono: color del badge · zona: a qué operación pertenece.
export const EST = {
  // ── Digital: paga por adelantado, se entrega al toque ──
  confirmada:         { label:"Confirmada",          venta:true,  cobro:"todo",     tono:"ok" },
  pendiente:          { label:"Pendiente",           venta:false, cobro:"nada",     tono:"warn" },
  anulada:            { label:"Anulada",             venta:false, cobro:"nada",     tono:"bad",  perdido:true },
  carrito:            { label:"Carrito",             venta:false, cobro:"nada",     tono:"warn" },

  // ── Lima · contraentrega: la plata recién entra cuando el motorizado cobra ──
  confirmado:         { label:"Confirmado",          venta:true,  cobro:"nada",     tono:"warn", zona:"lima" },
  en_reparto:         { label:"En reparto",          venta:true,  cobro:"nada",     tono:"warn", zona:"lima" },
  reprogramado:       { label:"Reprogramado",        venta:true,  cobro:"nada",     tono:"warn", zona:"lima" },
  entregado_cobrado:  { label:"Entregado y cobrado", venta:true,  cobro:"todo",     tono:"ok",   zona:"lima" },
  rechazado:          { label:"Rechazado",           venta:true,  cobro:"nada",     tono:"bad",  perdido:true, zona:"lima" },

  // ── Provincia · adelanto + saldo contra la clave de recojo ──
  // `esperando_adelanto` NO es venta: el pedido se crea con los datos y sin
  // pagar a propósito, para poder medir cuántos abandonan.
  esperando_adelanto: { label:"Esperando adelanto",  venta:false, cobro:"nada",     tono:"warn", zona:"provincia" },
  adelanto_validado:  { label:"Adelanto validado",   venta:true,  cobro:"adelanto", tono:"ok",   zona:"provincia" },
  por_despachar:      { label:"Por despachar",       venta:true,  cobro:"adelanto", tono:"ok",   zona:"provincia" },
  despachado:         { label:"Despachado",          venta:true,  cobro:"adelanto", tono:"warn", zona:"provincia" },
  en_agencia:         { label:"En agencia",          venta:true,  cobro:"adelanto", tono:"warn", zona:"provincia" },
  saldo_pagado:       { label:"Saldo pagado",        venta:true,  cobro:"todo",     tono:"ok",   zona:"provincia" },
  recogido:           { label:"Recogido",            venta:true,  cobro:"todo",     tono:"ok",   zona:"provincia" },
  // No lo recogió: el paquete vuelve, pero el adelanto se queda (decisión de
  // Rodrigo: es el seguro del flete). Por eso es perdido Y cobró el adelanto.
  no_recogido:        { label:"No recogido",         venta:true,  cobro:"adelanto", tono:"bad",  perdido:true, zona:"provincia" },

  cancelado:          { label:"Cancelado",           venta:false, cobro:"nada",     tono:"bad",  perdido:true },
};

export const label = (e) => EST[e]?.label || e || "—";
export const tono  = (e) => EST[e]?.tono  || "warn";

// Valor del pedido: producto + ventas extra.
export function total(o){
  let v = Number(o?.amount || 0);
  (o?.order_bumps || []).forEach((b) => { v += Number(b?.precio || 0); });
  return v;
}

const adelantoDe = (o) => Number(o?.shipping?.adelanto || 0) || 0;

// Plata que YA entró por este pedido. El adelanto cuenta como lo que es: un
// cobro parcial (ni el total, ni cero).
export function cobrado(o){
  const m = EST[o?.estado];
  if (!m) return 0; // estado desconocido → no inventamos plata
  if (m.cobro === "todo") return total(o);
  if (m.cobro === "adelanto") return Math.min(adelantoDe(o), total(o));
  return 0;
}

// Plata comprometida que falta entrar. Un pedido perdido ya no se va a cobrar,
// y uno que aún no es venta no debe nada.
export function porCobrar(o){
  const m = EST[o?.estado];
  if (!m || m.perdido || !m.venta) return 0;
  return Math.max(0, total(o) - cobrado(o));
}

export const esVenta   = (o) => !!EST[o?.estado]?.venta;
export const esPerdido = (o) => !!EST[o?.estado]?.perdido;
// Despachado o en la calle sin haber cobrado todo: es el riesgo vivo.
export const enLaCalle = (o) => ["despachado","en_agencia","en_reparto"].includes(o?.estado);
