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
    f[1] = s.cliente || c.nombre || "";        // B DESTINATARIO (editable: shipping.cliente manda)
    f[2] = tel9(s.tel || c.wa_id);             // C CELULAR (9 díg; shipping.tel puede overridear)
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
const num = (...xs) => { for (const x of xs) if (x !== undefined && x !== null && x !== "") return Number(x) || 0; return 0; };
function filasShalom(orders, cfg, listas) {
  const sh = (cfg && cfg.shalom) || {};
  const ags = listas && listas.shalom && listas.shalom.destino;
  return orders.map((o) => {
    const c = o.contact || {}, s = o.shipping || {}, f = [];
    f[0] = s.dni || "";                                            // A DESTINATARIO (DOC)
    f[1] = tel9(s.tel || c.wa_id);                                 // B TELF. DESTINATARIO
    f[5] = (sh.origen || "").toUpperCase();                        // F ORIGEN (agencia, de la config)
    // G DESTINO: agencia elegida → SUGERIDA (match de la lista con lo que dijo el
    // cliente) → sede/ciudad en crudo. Así el Excel sale con la agencia oficial.
    f[6] = (s.destino || sugerirAgencia(s.sede || s.ciudad, ags) || s.sede || s.ciudad || "").toUpperCase();
    // H MERCADERIA = medida interna de Shalom (SOBRE/PAQUETE XXS…L), NO el
    // nombre del producto. Por pedido (shipping.mercaderia) o el default del negocio.
    f[7] = (s.mercaderia || sh.mercaderia || "PAQUETE S").toUpperCase();
    f[8] = N(num(s.alto, sh.alto));                                // I ALTO
    f[9] = N(num(s.ancho, sh.ancho));                              // J ANCHO
    f[10] = N(num(s.largo, sh.largo));                             // K LARGO
    f[11] = N(num(s.peso, sh.peso));                              // L PESO
    f[12] = N(1);                                                  // M CANTIDAD
    return f;
  });
}
function revisarShalom(orders, cfg) {
  const sh = (cfg && cfg.shalom) || {}, p = [];
  if (!sh.origen) p.push("Falta tu oficina de ORIGEN Shalom (Negocio → Entrega → Exportar a couriers).");
  orders.forEach((o) => {
    const c = o.contact || {}, s = o.shipping || {}, q = c.nombre || s.cliente || s.dni || "un pedido";
    if (!s.dni) p.push(`${q}: falta DNI. (Editar pedido)`);
    if (!s.destino && !s.sede && !s.ciudad) p.push(`${q}: falta la agencia de DESTINO. (Editar pedido)`);
  });
  return p;
}

// ── Catálogo de couriers ───────────────────────────────────────────
export const COURIERS = {
  eva: { id: "eva", nombre: "Eva Courier", zona: "lima", zonaLbl: "Solo Lima", color: "#1f6feb", inicial: "e", ext: "xlsm",
    plantilla: "courier/eva.xlsm", sheet: "xl/worksheets/sheet2.xml", tabla: "xl/tables/table2.xml",
    filas: filasEva, revisar: revisarEva },
  shalom: { id: "shalom", nombre: "Shalom", zona: "provincia", zonaLbl: "Provincia", color: "#e2261c", inicial: "S", ext: "xlsx",
    plantilla: "courier/shalom.xlsx", sheet: "xl/worksheets/sheet1.xml",
    filas: filasShalom, revisar: revisarShalom },
};
// Couriers que vienen pronto (deshabilitados en el menú), por zona.
export const COURIERS_PRONTO = [
  { nombre: "Olva Courier", zona: "provincia", inicial: "O" },
  { nombre: "Más couriers", zona: "lima", inicial: "+" },
];
export const prontoDeZona = (zona) => COURIERS_PRONTO.filter((c) => c.zona === zona);
export const couriersDeZona = (zona) => Object.values(COURIERS).filter((c) => c.zona === zona);

// Sugerir la agencia de la lista oficial que más se parece a lo que dijo el
// cliente (su `sede`/`ciudad`, texto libre). Es una SUGERENCIA para que el
// pedido llegue casi listo y el dueño solo confirme — no reemplaza su elección.
const _norm = (s) => String(s ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^A-Z0-9 ]/g, " ").replace(/\bSHALOM\b/g, " ").replace(/\s+/g, " ").trim();
export function sugerirAgencia(texto, agencias) {
  const t = _norm(texto);
  if (!t || !Array.isArray(agencias) || !agencias.length) return "";
  // 1) coincidencia exacta
  const exacta = agencias.find((a) => _norm(a) === t);
  if (exacta) return exacta;
  // 2) una contiene a la otra (la agencia aparece en el texto o viceversa) → la más larga
  const cont = agencias.filter((a) => { const na = _norm(a); return na && (t.includes(na) || na.includes(t)); })
    .sort((a, b) => Math.abs(_norm(a).length - t.length) - Math.abs(_norm(b).length - t.length));
  if (cont.length) return cont[0];
  // 3) por palabras compartidas (>2 letras); solo si comparten al menos una
  const tk = new Set(t.split(" ").filter((w) => w.length > 2));
  if (!tk.size) return "";
  let best = "", score = 0;
  for (const a of agencias) {
    const aw = _norm(a).split(" ").filter((w) => w.length > 2);
    let sc = 0; for (const w of aw) if (tk.has(w)) sc++;
    if (sc > score) { score = sc; best = a; }
  }
  return score > 0 ? best : "";
}

// Listas de los desplegables de los couriers (agencias, distritos, medidas),
// extraídas de sus plantillas. Se cargan una vez y se cachean.
let _listas = null;
export async function cargarListas() {
  if (_listas) return _listas;
  try { const r = await fetch("courier/listas.json"); _listas = r.ok ? await r.json() : {}; }
  catch { _listas = {}; }
  return _listas;
}

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
  const listas = await cargarListas();
  const filas = courier.filas(orders, cfg, listas);
  ponerTexto(hoja, rellenarSheet(await textoDe(hoja), filas, { headerRows: 1 }));
  if (courier.tabla) {
    const t = entradaPorNombre(entries, courier.tabla);
    if (t) ponerTexto(t, ajustarTablaRef(await textoDe(t), 1 + filas.length));
  }
  const hoy = new Date().toISOString().slice(0, 10);
  descargar(escribirZip(entries), `${courier.nombre.replace(/\s+/g, "_")}_por_despachar_${hoy}.${courier.ext}`);
  return filas.length;
}
