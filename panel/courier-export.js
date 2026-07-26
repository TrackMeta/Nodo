// ═══════════════════════════════════════════════════════════════════
// Nodo · courier-export.js — arma el Excel de carga masiva de cada courier
// a partir de los pedidos "por despachar", rellenando SU plantilla original
// (ver xlsx-fill.js). Cada courier declara qué hoja llenar y qué columna lleva
// qué dato del pedido.
//
// Al agregar un courier nuevo (Olva, etc.): sumá su plantilla en panel/courier/,
// una entrada acá con su hoja/tabla y su función de filas. Nada más.
// ═══════════════════════════════════════════════════════════════════
import * as O from "./orders.js";
import { leerZip, textoDe, entradaPorNombre, ponerTexto, rellenarSheet, ajustarTablaRef, escribirZip, descargar } from "./xlsx-fill.js";

const N = (v) => ({ t: "n", v: Number(v) || 0 });
// Los couriers piden el celular sin código de país (9 dígitos en Perú).
const tel9 = (wa) => String(wa || "").replace(/\D/g, "").slice(-9);
const atrTexto = (s) => Object.entries((s && s.atributos) || {}).map(([k, v]) => `${k}: ${v}`).join(", ");
const productoDesc = (o) => {
  const p = o.product || {}, v = o.version || {}, atr = atrTexto(o.shipping);
  return [p.nombre, v.nombre, atr && `(${atr})`].filter(Boolean).join(" ");
};

// Estados que cuentan como "por despachar" por zona = la columna homónima del
// Kanban de Pedidos (KB_LIMA / KB_PROV). Lo que ya se despachó o cerró no va.
export const POR_DESPACHAR = {
  lima: new Set(["confirmado"]),
  provincia: new Set(["adelanto_validado", "por_despachar"]),
};

// ── EVA COURIER (Lima, contraentrega) — hoja "FORMULARIO" (sheet2) ──
// Columnas: B destinatario · C celular · D distrito · E dirección · F referencia
// · G maps/GPS · H método cobro · I importe a cobrar · J observaciones ·
// K descripción · L cantidad · N SKU. (A y las opcionales van vacías.)
function filasEva(orders) {
  return orders.map((o) => {
    const c = o.contact || {}, s = o.shipping || {}, f = [];
    f[1] = c.nombre || s.cliente || "";        // B DESTINATARIO
    f[2] = tel9(c.wa_id);                       // C CELULAR
    f[3] = (s.distrito || "").toUpperCase();    // D DISTRITO ENTREGA
    f[4] = s.direccion || "";                   // E DIRECCIÓN
    f[5] = s.referencia || "";                  // F REFERENCIA
    f[7] = "EFECTIVO";                          // H MÉTODO DE COBRANZA
    f[8] = N(O.total(o));                       // I IMPORTE A COBRAR (contraentrega)
    f[10] = productoDesc(o);                    // K DESCRIPCIÓN DEL PRODUCTO
    f[11] = N(1);                               // L CANTIDAD
    return f;
  });
}
function revisarEva(orders) {
  const p = [];
  orders.forEach((o) => {
    const c = o.contact || {}, s = o.shipping || {}, q = c.nombre || s.cliente || "un pedido";
    if (!s.direccion) p.push(`${q}: falta dirección.`);
    if (!s.distrito) p.push(`${q}: falta distrito.`);
  });
  return p;
}

// ── SHALOM (provincia, agencia) — hoja "Hoja1" (sheet1) ─────────────
// A doc destinatario · B telf destinatario · C/D contacto (opc) · E GRR (opc) ·
// F origen · G destino · H mercadería · I-L alto/ancho/largo/peso · M cantidad.
function filasShalom(orders, cfg) {
  const sh = (cfg && cfg.shalom) || {};
  return orders.map((o) => {
    const c = o.contact || {}, s = o.shipping || {}, p = o.product || {}, f = [];
    f[0] = s.dni || "";                                            // A DESTINATARIO (DOC)
    f[1] = tel9(c.wa_id);                                          // B TELF. DESTINATARIO
    f[5] = (sh.origen || "").toUpperCase();                        // F ORIGEN
    f[6] = (s.ciudad || "").toUpperCase();                         // G DESTINO
    f[7] = (sh.mercaderia || p.nombre || "ENCOMIENDA").toUpperCase(); // H MERCADERIA
    f[8] = N(sh.alto || 0);                                        // I ALTO
    f[9] = N(sh.ancho || 0);                                       // J ANCHO
    f[10] = N(sh.largo || 0);                                      // K LARGO
    f[11] = N(sh.peso || 0);                                       // L PESO
    f[12] = N(1);                                                  // M CANTIDAD
    return f;
  });
}
function revisarShalom(orders, cfg) {
  const sh = (cfg && cfg.shalom) || {}, p = [];
  if (!sh.origen) p.push("Falta tu oficina de ORIGEN Shalom (Negocio → Entrega → Exportar a couriers).");
  orders.forEach((o) => {
    const c = o.contact || {}, s = o.shipping || {}, q = c.nombre || s.cliente || s.dni || "un pedido";
    if (!s.dni) p.push(`${q}: falta DNI.`);
    if (!s.ciudad) p.push(`${q}: falta la ciudad de destino.`);
  });
  return p;
}

// ── Catálogo de couriers ───────────────────────────────────────────
export const COURIERS = {
  eva: { id: "eva", nombre: "Eva Courier", zona: "lima", ext: "xlsm",
    plantilla: "courier/eva.xlsm", sheet: "xl/worksheets/sheet2.xml", tabla: "xl/tables/table2.xml",
    filas: filasEva, revisar: revisarEva },
  shalom: { id: "shalom", nombre: "Shalom", zona: "provincia", ext: "xlsx",
    plantilla: "courier/shalom.xlsx", sheet: "xl/worksheets/sheet1.xml",
    filas: filasShalom, revisar: revisarShalom },
};
export const couriersDeZona = (zona) => Object.values(COURIERS).filter((c) => c.zona === zona);

// Devuelve los pedidos "por despachar" de una zona a partir de la lista viva.
export function porDespachar(list, zona) {
  const est = POR_DESPACHAR[zona] || new Set();
  return list.filter((o) => O.zonaDe(o) === zona && est.has(o.estado));
}

// Rellena la plantilla del courier y dispara la descarga. Devuelve cuántas filas.
export async function generar(courier, orders, cfg) {
  const resp = await fetch(courier.plantilla);
  if (!resp.ok) throw new Error(`No pude cargar la plantilla de ${courier.nombre}.`);
  const entries = leerZip(await resp.arrayBuffer());
  const hoja = entradaPorNombre(entries, courier.sheet);
  if (!hoja) throw new Error(`La plantilla de ${courier.nombre} cambió de estructura.`);
  const filas = courier.filas(orders, cfg);
  ponerTexto(hoja, rellenarSheet(await textoDe(hoja), filas, { headerRows: 1 }));
  if (courier.tabla) {
    const t = entradaPorNombre(entries, courier.tabla);
    if (t) ponerTexto(t, ajustarTablaRef(await textoDe(t), 1 + filas.length));
  }
  const hoy = new Date().toISOString().slice(0, 10);
  descargar(escribirZip(entries), `${courier.nombre.replace(/\s+/g, "_")}_por_despachar_${hoy}.${courier.ext}`);
  return filas.length;
}
