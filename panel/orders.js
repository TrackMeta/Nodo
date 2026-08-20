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
  // Mismo momento que adelanto_validado (adelanto pagado, listo para despachar):
  // se muestra con el MISMO nombre para no confundir. Sigue siendo un estado
  // aparte por compatibilidad con pedidos viejos que ya estaban aquí.
  por_despachar:      { label:"Adelanto validado",   venta:true,  cobro:"adelanto", tono:"ok",   zona:"provincia" },
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
// Pedido CERRADO/COMPLETADO: se cobró TODO (digital pagado, Lima entregado y
// cobrado, provincia recogido / saldo pagado). Es una venta terminada, no una en
// curso. Se usa para permitir "Registrar OTRA venta a mano" (recompra) sobre un
// cliente que ya cerró una compra, sin duplicar un pedido todavía activo.
export const esCerrado = (o) => EST[o?.estado]?.cobro === "todo";
// Ya salió físicamente y todavía no está cobrado del todo: es el riesgo vivo.
// Es un SUBCONJUNTO de porCobrar — se muestra como desglose, no como KPI aparte
// (dos números que se solapan sin decirlo confunden más de lo que informan).
export const enLaCalle = (o) => ["despachado","en_agencia","en_reparto","reprogramado"].includes(o?.estado);
// OJO: `shipping.zona` puede valer "digital" (lo escribe "Editar pedido" de un
// pedido digital). NO cuenta como físico — solo "lima"/"provincia" lo hacen. Sin
// esta guarda, un digital con zona="digital" se colaba como físico y zonaDe lo
// mandaba a "provincia" por defecto (embudo de provincia en un pedido digital).
export const esFisico  = (o) => {
  const z = String(o?.shipping?.zona ?? "").toLowerCase();
  if (z === "digital") return false;
  return !!EST[o?.estado]?.zona || z === "lima" || z === "provincia" || o?.product?.tipo === "fisico";
};

// De qué operación es un pedido: "digital" | "lima" | "provincia".
// Manda la zona REAL (shipping.zona); si el pedido es viejo y no la trae, se
// deduce del estado, que ya la declara en EST.
//
// Vivía copiado en pedidos.html y compras.html con una lista de estados Lima
// escrita a mano. Estaba en sync de milagro: agregar un estado Lima a EST y
// olvidarse de las dos copias lo habría contado como provincia, en silencio. Es
// el mismo descuido que tuvo al Dashboard sin contar las ventas físicas.
export function zonaDe(o){
  const z = String(o?.shipping?.zona ?? "").toLowerCase();
  if (z === "digital") return "digital"; // zona explícita de un pedido digital
  if (!esFisico(o)) return "digital";
  if (z === "lima" || z === "provincia") return z;
  return EST[o?.estado]?.zona ?? "provincia";
}

// ── Lo que te cuesta a ti ──────────────────────────────────────────
// Flete REGISTRADO al cerrar el pedido. `null` = todavía no se registró (≠ 0,
// que significa "no pagué nada"): sin esto el margen saldría inventado.
export function flete(o){
  const v = o?.shipping?.flete;
  return v === "" || v == null ? null : Number(v) || 0;
}

// Costo de la mercadería. Manda el SNAPSHOT que se congeló en el pedido al
// crearlo (`shipping.costo_producto`): así cambiar el costo del producto después
// no altera los márgenes ya cerrados. Solo si el pedido no lo tiene (pedidos
// viejos, previos al snapshot) se cae al costo vivo del producto × cantidad.
// null = no hay dato de costo → no se puede hablar de margen.
// 🎁 Costo de los regalos adjuntos (bumps con regalo:true). Un regalo no se
// vende (precio 0 → no suma en total()), pero SÍ te cuesta: se cuenta como COGS.
export function costoRegalos(o){
  let c = 0;
  for (const b of (o?.order_bumps || [])) if (b?.regalo) c += Number(b?.costo || 0);
  return c;
}
// 🛒 Costo de los EXTRAS pagados (bumps NO-regalo con costo). A diferencia del regalo,
// el extra SÍ se vende (su precio suma en total()), así que su costo también es COGS.
// Antes solo se restaba el del regalo → el margen salía inflado cuando el extra costaba.
export function costoExtras(o){
  let c = 0;
  for (const b of (o?.order_bumps || [])) if (!b?.regalo) c += Number(b?.costo || 0);
  return c;
}
export function costoProducto(o, prod, cantidad = 1){
  const reg = costoRegalos(o);
  const ext = costoExtras(o);
  const extra = reg + ext;
  const snap = o?.shipping?.costo_producto;
  if (snap != null && snap !== "") return Number(snap) + extra;
  const unit = prod?.config?.costo;
  if (unit == null || unit === "") return extra > 0 ? extra : null; // sin costo del principal, pero regalo/extra sí cuestan
  return Number(unit) * (Number(cantidad) || 1) + extra;
}

// Costo de empaque/embalaje del pedido. Snapshot del producto (config.empaque) al
// crear, editable en "Editar pedido". Es OPCIONAL: vacío = 0 y NO bloquea el margen
// (a diferencia del flete). Se descuenta de la ganancia real.
export function empaque(o){
  const v = o?.shipping?.empaque;
  return v === "" || v == null ? 0 : Number(v) || 0;
}

// Ganancia real = lo cobrado − mercadería − envío − empaque. Devuelve null si falta
// algún dato: preferimos no mostrar margen a mostrar uno inventado.
export function margen(o, prod, cantidad = 1){
  const cp = costoProducto(o, prod, cantidad);
  const f  = flete(o);
  if (cp == null) return null;
  if (esFisico(o) && f == null) return null; // físico sin flete registrado
  // El empaque es un costo FÍSICO (caja/bolsa/etiqueta del despacho): en digital NO se
  // resta (el Dashboard y el digest definen la ganancia digital = cobrado − COGS). Sin este
  // gate, Rendimiento/CPA restaba el empaque a un digital y daba una ganancia distinta al Dashboard.
  return cobrado(o) - cp - (f ?? 0) - (esFisico(o) ? empaque(o) : 0);
}

// Costo de reparto configurado para una zona de Lima. Cascada: zona → grupo →
// todo Lima; lo más específico manda. Vacío hereda (no es cero).
export function costoZonaLima(entregas, zonaNombre){
  const c = entregas?.costos;
  if (!c) return null;
  const z = String(zonaNombre || "").trim();
  if (z && c.zonas?.[z] != null) return Number(c.zonas[z]);
  const zona = (entregas.zonas || []).find((x) => String(x?.nombre||"").toLowerCase() === z.toLowerCase());
  if (zona?.grupo && c.grupos?.[zona.grupo] != null) return Number(c.grupos[zona.grupo]);
  return c.default != null ? Number(c.default) : null;
}
