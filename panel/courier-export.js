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
// Lo que va DENTRO del paquete: el principal y también los extras y regalos
// físicos. Sin ellos la descripción declaraba un solo producto para una caja que
// lleva dos o tres — el cliente pagó las medias y le prometimos la gorra, y en un
// reclamo o un extravío la descripción no cuadra con el contenido. Los digitales
// se excluyen: se entregan por link, no viajan.
// La variante del extra sale del `stock_key`: el `nombre` trae la presentación
// ("· Unica") y la talla real vive ahí ("Talla=m").
const bumpsDesc = (o) => (o.order_bumps || []).filter((b) => b && b.digital !== true).map((b) => {
  const va = (b.stock_key && b.stock_key !== "_")
    ? b.stock_key.split("|").map((kv) => { const [k, val] = kv.split("="); return `${k}: ${val || ""}`; }).join(", ")
    : "";
  let nom = String(b.nombre || "").replace(/\s*—\s*S\/\s*[\d.,]+\s*$/i, "").trim();
  if (va) nom = nom.replace(/\s*·\s*[Uu]nica\s*$/, "").trim();
  return `${nom || "extra"}${va ? ` (${va})` : ""}`;
}).filter(Boolean);
const productoDesc = (o) => {
  const p = o.product || {}, v = o.version || {}, atr = atrTexto(o.shipping);
  const base = [p.nombre, v.nombre, atr && `(${atr})`].filter(Boolean).join(" ");
  const mas = bumpsDesc(o);
  // Tope defensivo: la celda del Excel del courier no es un campo libre infinito.
  return [base, ...mas].filter(Boolean).join(" + ").slice(0, 250);
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
// Teléfono REAL para el courier. shipping.tel (capturado) manda; luego la columna
// telefono; c.wa_id SOLO si es un número de verdad y NO el BSUID de un cliente sin número
// (wa_id === user_id) ni el marcador de prueba. Sin esta guarda, un cliente sin número
// exportaba un celular basura (últimos 9 díg. del BSUID) → el courier no lo ubica.
function telCliente(c, s) {
  const wa = String((c && c.wa_id) || ""), uid = String((c && c.user_id) || "");
  return String((s && s.tel) || "").trim() || String((c && c.telefono) || "").trim()
    || (wa && wa !== "webchat-test" && wa !== uid ? wa : "");
}
function filasEva(orders) {
  return orders.map((o) => {
    const c = o.contact || {}, s = o.shipping || {}, f = [];
    f[1] = s.cliente || c.nombre || "";        // B DESTINATARIO (editable: shipping.cliente manda)
    f[2] = tel9(telCliente(c, s));             // C CELULAR (capturado; nunca el BSUID de un sin-número)
    f[3] = (s.distrito || "").toUpperCase();    // D DISTRITO ENTREGA
    f[4] = s.direccion || "";                   // E DIRECCIÓN
    f[5] = s.referencia || "";                  // F REFERENCIA
    f[7] = "EFECTIVO";                          // H MÉTODO DE COBRANZA
    f[8] = N(O.porCobrar(o));                   // I IMPORTE A COBRAR (contraentrega): lo que FALTA, no el total (si hubo adelanto, no cobrar de nuevo)
    f[10] = productoDesc(o);                    // K DESCRIPCIÓN DEL PRODUCTO
    f[11] = N(1);                               // L CANTIDAD
    return f;
  });
}
async function revisarEva(orders) {
  const listas = await cargarListas();
  const oficiales = new Set(((listas && listas.eva && listas.eva.distrito) || []).map(_norm).filter(Boolean));
  const p = [];
  orders.forEach((o) => {
    const c = o.contact || {}, s = o.shipping || {}, q = c.nombre || s.cliente || "un pedido";
    if (!s.direccion) p.push(`${q}: falta dirección.`);
    if (!s.distrito) p.push(`${q}: falta distrito.`);
    if (!telCliente(c, s)) p.push(`${q}: falta un teléfono válido — el courier no podrá coordinar la entrega.`);
    // El distrito va al Excel tal cual; si no coincide con la lista oficial de
    // Eva (mal escrito o distrito raro) avisamos para que lo corrijan en Editar.
    else if (oficiales.size && !oficiales.has(_norm(s.distrito)))
      p.push(`${q}: el distrito “${s.distrito}” no está en la lista de Eva — revísalo (Editar pedido).`);
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
    f[1] = tel9(telCliente(c, s));                                 // B TELF. DESTINATARIO (nunca el BSUID)
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
async function revisarShalom(orders, cfg) {
  const sh = (cfg && cfg.shalom) || {}, p = [];
  const listas = await cargarListas();
  const ags = listas && listas.shalom && listas.shalom.destino;
  const oficiales = new Set((ags || []).map(_norm).filter(Boolean));
  if (!sh.origen) p.push("Falta tu oficina de ORIGEN Shalom (Negocio → Entrega → Exportar a couriers).");
  orders.forEach((o) => {
    const c = o.contact || {}, s = o.shipping || {}, q = c.nombre || s.cliente || s.dni || "un pedido";
    if (!s.dni) p.push(`${q}: falta DNI. (Editar pedido)`);
    if (!telCliente(c, s)) p.push(`${q}: falta un teléfono válido para el courier. (Editar pedido)`);
    // Se resuelve el DESTINO igual que filasShalom y se valida contra la lista OFICIAL:
    // si sale una ciudad cruda ("CUSCO") en vez de una agencia real, la columna DESTINO
    // tiene validación de lista en la plantilla de Shalom → la fila (o el archivo) se
    // rechaza. Antes solo se chequeaba que no estuviera vacío (como sí hace revisarEva).
    const destino = (s.destino || sugerirAgencia(s.sede || s.ciudad, ags) || s.sede || s.ciudad || "").trim();
    if (!destino) p.push(`${q}: falta la agencia de DESTINO. (Editar pedido)`);
    else if (oficiales.size && !oficiales.has(_norm(destino)))
      p.push(`${q}: el destino “${destino}” no es una agencia Shalom de la lista — revísalo (Editar pedido).`);
  });
  return p;
}

// ── Catálogo de couriers ───────────────────────────────────────────
export const COURIERS = {
  eva: { id: "eva", nombre: "Eva Courier", zona: "lima", zonaLbl: "Solo Lima", color: "#1f6feb", inicial: "e", logo: "courier/eva-logo.png", ext: "xlsm",
    plantilla: "courier/eva.xlsm", sheet: "xl/worksheets/sheet2.xml", tabla: "xl/tables/table2.xml",
    filas: filasEva, revisar: revisarEva },
  shalom: { id: "shalom", nombre: "Shalom", zona: "provincia", zonaLbl: "Provincia", color: "#e2261c", inicial: "S", logo: "courier/shalom-logo.png", ext: "xlsx",
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
  // 2) el nombre de la agencia oficial aparece DENTRO de lo que escribió el
  //    cliente (nombró la sede completa, p. ej. "Cusco Urubamba") → la más
  //    específica (la más larga si hay varias contenidas).
  const dentro = agencias.filter((a) => { const na = _norm(a); return na && t.includes(na); })
    .sort((a, b) => _norm(b).length - _norm(a).length);
  if (dentro.length) return dentro[0];
  // 3) lo que escribió el cliente es PARTE del nombre de una agencia (nombró
  //    solo la ciudad, p. ej. "Cusco"). Solo sugerimos si hay UNA candidata:
  //    si varias sedes de esa ciudad lo contienen es ambiguo (¿cuál?) y adivinar
  //    manda el paquete a la oficina equivocada → mejor no sugerir y que el
  //    dueño elija del desplegable.
  const contienen = agencias.filter((a) => { const na = _norm(a); return na && na.includes(t); });
  if (contienen.length === 1) return contienen[0];
  if (contienen.length > 1) return "";
  // 4) por palabras compartidas (>2 letras). Solo si UNA agencia tiene el
  //    puntaje máximo; si empatan varias es ambiguo → no adivinar.
  const tk = new Set(t.split(" ").filter((w) => w.length > 2));
  if (!tk.size) return "";
  let best = "", score = 0, empate = false;
  for (const a of agencias) {
    const aw = _norm(a).split(" ").filter((w) => w.length > 2);
    let sc = 0; for (const w of aw) if (tk.has(w)) sc++;
    if (sc > score) { score = sc; best = a; empate = false; }
    else if (sc === score && sc > 0) { empate = true; }
  }
  return (score > 0 && !empate) ? best : "";
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
  // Fecha del reloj DEL USUARIO, no UTC: toISOString() en Perú (UTC-5) ya devuelve el día
  // siguiente a partir de las 7pm, así que el archivo bajado de noche se guardaba fechado
  // mañana y descuadraba el archivo de despachos.
  const hoy = new Intl.DateTimeFormat("en-CA").format(new Date());
  descargar(escribirZip(entries), `${courier.nombre.replace(/\s+/g, "_")}_por_despachar_${hoy}.${courier.ext}`);
  return filas.length;
}
