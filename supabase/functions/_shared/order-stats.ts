// ═══════════════════════════════════════════════════════════════════
// Nodo · order-stats.ts — QUÉ es venta y CUÁNTA plata entró, para el motor.
//
// ESPEJO de panel/orders.js (esa es la FUENTE DE VERDAD del Dashboard). Solo
// el subconjunto que el resumen diario necesita. Si cambia la tabla EST en
// orders.js (se agrega/renombra un estado), actualizar acá también — si no, el
// resumen contaría distinto al Dashboard y mentiría.
// ═══════════════════════════════════════════════════════════════════

type Est = { venta?: boolean; cobro?: "todo" | "adelanto" | "nada"; perdido?: boolean; zona?: string };

export const EST: Record<string, Est> = {
  // Digital
  confirmada:        { venta: true,  cobro: "todo" },
  pendiente:         { cobro: "nada" },
  anulada:           { perdido: true, cobro: "nada" },
  carrito:           { cobro: "nada" },
  // Lima · contraentrega
  confirmado:        { venta: true, cobro: "nada",     zona: "lima" },
  en_reparto:        { venta: true, cobro: "nada",     zona: "lima" },
  reprogramado:      { venta: true, cobro: "nada",     zona: "lima" },
  entregado_cobrado: { venta: true, cobro: "todo",     zona: "lima" },
  rechazado:         { venta: true, cobro: "nada",     zona: "lima", perdido: true },
  // Provincia · adelanto + saldo
  esperando_adelanto:{ cobro: "nada",                  zona: "provincia" },
  adelanto_validado: { venta: true, cobro: "adelanto", zona: "provincia" },
  por_despachar:     { venta: true, cobro: "adelanto", zona: "provincia" },
  despachado:        { venta: true, cobro: "adelanto", zona: "provincia" },
  en_agencia:        { venta: true, cobro: "adelanto", zona: "provincia" },
  saldo_pagado:      { venta: true, cobro: "todo",     zona: "provincia" },
  recogido:          { venta: true, cobro: "todo",     zona: "provincia" },
  no_recogido:       { venta: true, cobro: "adelanto", zona: "provincia", perdido: true },
  cancelado:         { perdido: true, cobro: "nada" },
};

export type Order = {
  amount?: number | null;
  order_bumps?: Array<{ precio?: number | null }> | null;
  estado?: string | null;
  shipping?: Record<string, unknown> | null;
};

export function total(o: Order): number {
  let v = Number(o?.amount || 0);
  for (const b of o?.order_bumps || []) v += Number(b?.precio || 0);
  return v;
}

export function cobrado(o: Order): number {
  const m = EST[o?.estado ?? ""];
  if (!m) return 0;
  if (m.cobro === "todo") return total(o);
  if (m.cobro === "adelanto") return Math.min(Number((o?.shipping as any)?.adelanto || 0) || 0, total(o));
  return 0;
}

export function porCobrar(o: Order): number {
  const m = EST[o?.estado ?? ""];
  if (!m || m.perdido || !m.venta) return 0;
  return Math.max(0, total(o) - cobrado(o));
}

export const esVenta = (o: Order) => !!EST[o?.estado ?? ""]?.venta;
export const esPerdido = (o: Order) => !!EST[o?.estado ?? ""]?.perdido;
export const esFisico = (o: Order) => !!EST[o?.estado ?? ""]?.zona || !!(o?.shipping as any)?.zona;

// Ganancia por SNAPSHOT congelado en el pedido (shipping.costo_producto/flete):
// no necesita join de productos. null = falta un dato → no se puede afirmar margen.
export function margenSnap(o: Order): number | null {
  const cp = (o?.shipping as any)?.costo_producto;
  if (cp == null || cp === "") return null;
  const f = (o?.shipping as any)?.flete;
  if (esFisico(o) && (f == null || f === "")) return null;
  return cobrado(o) - Number(cp) - (f === "" || f == null ? 0 : Number(f));
}

// ── Resumen de un conjunto de pedidos (los KPIs del digest) ─────────
export type Digest = {
  ventas: number;          // pedidos que cerraron como venta
  ingresos: number;        // plata que YA entró
  porCobrar: number;       // comprometido que falta
  ticket: number;          // ingreso promedio por venta
  pedidosNuevos: number;   // todos los creados (incluye no-venta)
  digital: number; fisico: number;  // desglose de los pedidos nuevos
  perdidos: number;
  costoProd: number;       // suma de costos de mercadería vendida
  envio: number;           // suma de fletes registrados
  ganancia: number | null; // bruta; null si NINGÚN pedido tenía datos
  gananciaSinDatos: number; // pedidos físicos sin costo/flete → no cuentan
};

export function resumirPedidos(orders: Order[]): Digest {
  let ingresos = 0, pc = 0, vendido = 0, ventas = 0, digital = 0, fisico = 0, perdidos = 0;
  let ganancia = 0, conMargen = 0, sinDatos = 0, costoProd = 0, envio = 0;
  for (const o of orders) {
    if (esFisico(o)) fisico++; else digital++;
    if (esVenta(o)) {
      ventas++;
      ingresos += cobrado(o);
      pc += porCobrar(o);
      vendido += total(o);
      const cp = (o?.shipping as any)?.costo_producto;
      const cpN = (cp == null || cp === "") ? null : Number(cp);
      if (!esFisico(o)) {
        // Digital: sin costo de mercadería → la ganancia bruta es lo cobrado
        // (mismo criterio que la banda del Dashboard). Si el producto digital
        // igual tiene un costo cargado, se suma al COGS informativo.
        ganancia += cobrado(o); conMargen++;
        if (cpN != null) costoProd += cpN;
      } else {
        const f = (o?.shipping as any)?.flete;
        const fN = (f == null || f === "") ? null : Number(f);
        if (cpN == null || fN == null) {
          sinDatos++; // físico sin costo o sin flete → no se afirma margen
        } else {
          costoProd += cpN; envio += fN;
          ganancia += cobrado(o) - cpN - fN; conMargen++;
        }
      }
    }
    if (esPerdido(o)) perdidos++;
  }
  return {
    ventas, ingresos, porCobrar: pc,
    ticket: ventas ? vendido / ventas : 0,
    pedidosNuevos: orders.length, digital, fisico, perdidos,
    costoProd, envio,
    ganancia: conMargen ? ganancia : null, gananciaSinDatos: sinDatos,
  };
}
