// ═════════════════════════════════════════════════════════════════════════
// 💱 Convertir dinero entre monedas con el tipo de cambio de CADA DÍA (29-oct, paso 3 de la moneda).
// La tabla tipos_cambio (migración 0140) la llena el scheduler una vez al día: cuánto vale 1 USD en cada moneda.
// Una venta se convierte con el cambio del día en que se hizo (si ese día no hay, el último anterior; si es de antes
// del primer registro, el primero). Inicio, su Bitácora y Rendimiento usan esto mismo: si cada pantalla convirtiera
// a su manera, darían números distintos para el mismo periodo.
// Archivo aparte (no en shell.js) a propósito: una página que importa un export nuevo de un módulo viejo guardado
// en el navegador queda en blanco (ver ventana-ajustes.js).
// ═════════════════════════════════════════════════════════════════════════
import { supa } from "./shell.js";

let _cambios = null;
export async function cargarCambios() {
  if (_cambios) return _cambios;
  const m = {};
  try {
    const { data } = await supa.from("tipos_cambio").select("fecha,moneda,por_usd").order("fecha").limit(5000);
    for (const r of data || []) (m[String(r.moneda).toUpperCase()] ||= []).push([String(r.fecha), Number(r.por_usd)]);
  } catch (_) { /* sin la tabla: nada se puede convertir y queda aparte, como antes */ }
  _cambios = m;
  return m;
}
// Cuánto vale 1 USD en `moneda` el día `fecha`. null = no se sabe.
export function porUsd(cambios, moneda, fecha) {
  const cod = String(moneda || "").toUpperCase();
  if (cod === "USD") return 1;
  const lista = (cambios || {})[cod];
  if (!lista || !lista.length) return null;
  const dia = String(fecha || "").slice(0, 10);
  let v = lista[0][1];
  for (const [f, x] of lista) { if (f <= dia) v = x; else break; }
  return v > 0 ? v : null;
}
// Por cuánto multiplicar un monto en `de` para tenerlo en `a`, el día `fecha`. null = no se puede.
export function factorCambio(cambios, de, a, fecha) {
  const d = String(de || "").toUpperCase(), h = String(a || "").toUpperCase();
  if (!d || !h || d === h) return 1;
  const x = porUsd(cambios, d, fecha), y = porUsd(cambios, h, fecha);
  return x && y ? y / x : null;
}
// Los campos de plata del pedido (lo que leen las cuentas de orders.js).
const CAMPOS_ENVIO = ["adelanto", "adelanto_abonado", "pago_acreditado_adelanto", "prepago_lima_abonado", "saldo", "vuelto", "costo_producto", "empaque", "flete"];
const por = (v, f) => (v == null || v === "" || !Number.isFinite(Number(v))) ? v : +(Number(v) * f).toFixed(2);
// Copia del pedido con su plata llevada a la moneda `a` (factor `f`). `costoFicha` = el costo del producto en SU
// moneda cuando el pedido no lo congeló: se congela y se convierte junto (si no, el margen restaría pesos a soles).
export function convertirPedido(o, f, a, costoFicha) {
  const c = JSON.parse(JSON.stringify(o));
  c._moneda_orig = String(o.currency || "").toUpperCase();
  c._total_orig = Number(o.amount || 0) + (o.order_bumps || []).reduce((s, b) => s + Number(b?.precio || 0), 0);
  c.currency = a;
  c.amount = por(c.amount, f);
  (c.order_bumps || []).forEach((b) => { b.precio = por(b.precio, f); b.costo = por(b.costo, f); });
  const sh = c.shipping || (c.shipping = {});
  if ((sh.costo_producto == null || sh.costo_producto === "") && costoFicha != null && costoFicha !== "") sh.costo_producto = Number(costoFicha);
  for (const k of CAMPOS_ENVIO) if (k in sh) sh[k] = por(sh[k], f);
  return c;
}
// Lleva a la moneda `cur` los pedidos de `ordR.data` que estén en otra (muta ordR.data). Los que no se pueden
// convertir (moneda sin tipo de cambio) quedan FUERA, como antes, y se avisan. `costoDe(o)` = costo del producto
// de la ficha × cantidad, en la moneda del producto (o null).
// Devuelve { convertidas: {MXN:{n, total}}, otras: {XXX:{n, cobrado}} } — `total` en la moneda original.
export async function llevarAMoneda(ordR, cur, cobradoDe, costoDe) {
  const res = { convertidas: {}, otras: {} };
  if (!ordR || ordR.error) return res;
  const lista = ordR.data || [];
  if (!lista.some((o) => String(o.currency || "PEN").toUpperCase() !== cur)) return res;
  const cambios = await cargarCambios();
  ordR.data = lista.map((o) => {
    const de = String(o.currency || "PEN").toUpperCase();
    if (de === cur) return o;
    const f = factorCambio(cambios, de, cur, o.created_at);
    if (f == null) { const k = res.otras[de] || (res.otras[de] = { n: 0, cobrado: 0 }); k.n++; k.cobrado += cobradoDe(o); return null; }
    const k = res.convertidas[de] || (res.convertidas[de] = { n: 0, total: 0 }); k.n++;
    k.total += Number(o.amount || 0) + (o.order_bumps || []).reduce((s, b) => s + Number(b?.precio || 0), 0);
    return convertirPedido(o, f, cur, costoDe ? costoDe(o) : null);
  }).filter(Boolean);
  return res;
}
