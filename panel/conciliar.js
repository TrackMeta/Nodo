// ═══════════════════════════════════════════════════════════════════
// Nodo · conciliar.js — motor de conciliación de pagos.
//
// Cruza el reporte del banco/billetera con las ventas que Nodo da por
// cobradas, para cazar dos cosas: ventas que el bot dio por pagadas y el banco
// no respalda (pago falso), y plata que entró y Nodo no registró.
//
// POR QUÉ ES DIFÍCIL (medido sobre el reporte real de Yape de Rodrigo, 4.593
// pagos entrantes en 3 meses):
//   · El reporte NO trae número de operación — el dato que haría el cruce
//     infalible, y que Nodo sí extrae del comprobante, no está del otro lado.
//   · El monto casi no discrimina: S/10 aparece 2.337 veces, S/3 1.237 veces;
//     cuatro montos son el 99,4% del archivo. Son ~26 pagos de S/10 por día.
//
// Por eso el emparejamiento NO puede ser goloso ("el más cercano gana"): un
// error se propaga en cadena — el pago que le robó a la venta A deja a la B
// sin el suyo, que toma el de C. Acá se hace por ELECCIÓN MUTUA con margen:
// solo se casa una pareja si cada uno es el mejor del otro y le saca ventaja
// clara al segundo. El empate no se resuelve, se muestra.
// ═══════════════════════════════════════════════════════════════════

// ── 1. Lectura del archivo ─────────────────────────────────────────
// Todo pasa en el navegador: el reporte del banco no se sube a ningún lado.

// Un .xlsx es un ZIP. Se lee su directorio central y se infla solo la hoja que
// interesa con DecompressionStream (nativo, sin librerías).
async function leerZip(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  // End of Central Directory: firma PK\x05\x06, se busca desde el final.
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("El archivo no parece un Excel válido.");
  const nEntries = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  const dec = new TextDecoder();
  for (let i = 0; i < nEntries; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const metodo = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const cmtLen = dv.getUint16(p + 32, true);
    const lhOff = dv.getUint32(p + 42, true);
    const nombre = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    // Cabecera local: sus campos de longitud pueden diferir de los del directorio.
    const lhNameLen = dv.getUint16(lhOff + 26, true);
    const lhExtraLen = dv.getUint16(lhOff + 28, true);
    const ini = lhOff + 30 + lhNameLen + lhExtraLen;
    out[nombre] = { metodo, datos: u8.subarray(ini, ini + compSize) };
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}
async function inflar(entrada) {
  if (!entrada) return "";
  if (entrada.metodo === 0) return new TextDecoder("utf-8").decode(entrada.datos);
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([entrada.datos]).stream().pipeThrough(ds);
  return new TextDecoder("utf-8").decode(await new Response(stream).arrayBuffer());
}

// Devuelve una matriz de filas (arrays de texto) a partir del .xlsx.
// Soporta las dos formas de guardar texto: sharedStrings (lo normal) e
// inlineStr (lo que usa el export de Yape).
async function filasDeXlsx(buf) {
  const zip = await leerZip(buf);
  const hojaKey = Object.keys(zip).find((k) => /^xl\/worksheets\/sheet1\.xml$/i.test(k))
    || Object.keys(zip).find((k) => /^xl\/worksheets\/.*\.xml$/i.test(k));
  if (!hojaKey) throw new Error("El Excel no tiene hojas legibles.");
  const [hoja, shared] = await Promise.all([inflar(zip[hojaKey]), inflar(zip["xl/sharedStrings.xml"])]);
  const sst = [];
  if (shared) {
    for (const m of shared.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      sst.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
    }
  }
  const desesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const filas = [];
  for (const rm of hoja.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const celdas = [];
    for (const cm of rm[1].matchAll(/<c r="([A-Z]+)[0-9]+"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const col = colIndex(cm[1]);
      const tipo = (cm[2].match(/t="([^"]+)"/) || [])[1];
      const cuerpo = cm[3];
      let val = "";
      if (tipo === "s") {
        const i = Number((cuerpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1]);
        val = sst[i] ?? "";
      } else if (tipo === "inlineStr") {
        val = [...cuerpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("");
      } else {
        val = (cuerpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1] ?? "";
      }
      celdas[col] = desesc(val).trim();
    }
    if (celdas.some((c) => c)) filas.push([...celdas].map((c) => c ?? ""));
  }
  return filas;
}
function colIndex(letras) {
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// CSV con detección de separador (coma o punto y coma) y comillas.
function filasDeCsv(texto) {
  const sep = (texto.split("\n")[0].match(/;/g) || []).length > (texto.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  const filas = [];
  let campo = "", fila = [], enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') enComillas = false;
      else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === sep) { fila.push(campo.trim()); campo = ""; }
    else if (c === "\n") { fila.push(campo.trim()); if (fila.some((x) => x)) filas.push(fila); fila = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  fila.push(campo.trim());
  if (fila.some((x) => x)) filas.push(fila);
  return filas;
}

// ── 2. Reconocer el formato ────────────────────────────────────────
// Cada banco exporta columnas distintas. En vez de pedirle al usuario que diga
// cuál es cuál, se busca la fila de encabezados por sus nombres y se mapea.
// Agregar un banco = agregar una entrada acá.
const FORMATOS = [
  {
    id: "yape", nombre: "Yape",
    // "Tipo de Transacción | Origen | Destino | Monto | Mensaje | Fecha de operación"
    claves: ["tipo de transacc", "origen", "destino", "monto", "fecha de operac"],
    col: { tipo: ["tipo de transacc"], quien: ["origen"], monto: ["monto"], fecha: ["fecha de operac"], nota: ["mensaje"] },
    entrante: (t) => /te pag|te yape|recib/i.test(t || ""),
  },
  {
    id: "generico", nombre: "Genérico",
    claves: ["monto", "fecha"],
    col: { tipo: ["tipo", "operación", "operacion", "descripción", "descripcion", "concepto"],
           quien: ["origen", "cliente", "ordenante", "nombre", "beneficiario", "remitente"],
           monto: ["monto", "importe", "abono", "haber", "cargo/abono"],
           fecha: ["fecha de operac", "fecha y hora", "fecha"],
           nota: ["mensaje", "glosa", "detalle", "referencia", "descripción", "descripcion"] },
    // Sin columna de tipo, un monto positivo se toma como entrada.
    entrante: (t, mov) => (t ? !/pagaste|envi|cargo|retiro|salida/i.test(t) : Number(mov.monto) > 0),
  },
];

const norm = (s) => String(s ?? "").toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

// Busca la fila de encabezados (los reportes traen título y filas vacías arriba).
function detectarFormato(filas) {
  for (let i = 0; i < Math.min(filas.length, 40); i++) {
    const cab = filas[i].map(norm);
    for (const f of FORMATOS) {
      const ok = f.claves.every((k) => cab.some((c) => c.includes(k)));
      if (!ok) continue;
      const idx = {};
      for (const [campo, alias] of Object.entries(f.col)) {
        const j = cab.findIndex((c) => c && alias.some((a) => c.includes(a)));
        if (j >= 0) idx[campo] = j;
      }
      if (idx.monto != null && idx.fecha != null) return { formato: f, fila: i, idx };
    }
  }
  return null;
}

// dd/MM/yyyy HH:mm:ss (Yape), y las variantes comunes de los bancos.
function parseFecha(s) {
  const t = String(s ?? "").trim();
  if (!t) return null;
  let m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const d = new Date(t);
  return isNaN(d) ? null : d;
}
function parseMonto(s) {
  let t = String(s ?? "").replace(/[^\d.,-]/g, "").trim();
  if (!t) return NaN;
  // "1.234,56" (europeo) vs "1,234.56" (inglés)
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = t.replace(",", ".");
  return Math.abs(Number(t));
}

// Lee el archivo → lista de movimientos ENTRANTES normalizados.
export async function leerReporte(file) {
  const nombre = (file.name || "").toLowerCase();
  let filas;
  if (nombre.endsWith(".csv") || nombre.endsWith(".txt")) filas = filasDeCsv(await file.text());
  else filas = await filasDeXlsx(await file.arrayBuffer());
  const det = detectarFormato(filas);
  if (!det) throw new Error("No reconocí las columnas de este archivo. Necesito al menos una de monto y una de fecha.");
  const { formato, fila, idx } = det;
  const movs = [];
  let salientes = 0, ilegibles = 0;
  for (let i = fila + 1; i < filas.length; i++) {
    const f = filas[i];
    const monto = parseMonto(f[idx.monto]);
    const fecha = parseFecha(f[idx.fecha]);
    if (!Number.isFinite(monto) || monto <= 0 || !fecha) { if (f.some((x) => x)) ilegibles++; continue; }
    const tipo = idx.tipo != null ? f[idx.tipo] : "";
    const mov = { i: movs.length, tipo, quien: idx.quien != null ? f[idx.quien] : "", monto,
                  fecha, nota: idx.nota != null ? f[idx.nota] : "", usado: false };
    if (!formato.entrante(tipo, mov)) { salientes++; continue; }
    movs.push(mov);
  }
  movs.forEach((m, i) => { m.i = i; });
  return { formato: formato.nombre, movs, salientes, ilegibles, filas: filas.length };
}

// ── 3. Nombres ─────────────────────────────────────────────────────
// El 80% de los pagos llega con el nombre enmascarado ("Elvis Pal*"), y el
// resto con prefijo de la billetera de origen ("PLIN - DAVID EDGAR FIGUEROA").
// Además el titular puede no ser el cliente (paga la mamá, el esposo), así que
// el nombre SUMA cuando calza pero no descarta cuando no.
export function limpiaNombre(s) {
  let t = norm(s);
  t = t.replace(/^[a-z]{2,6}\s*-\s*/, "");          // "plin - ", "bcp - "
  return t.replace(/\*/g, " ").replace(/\s+/g, " ").trim();
}
// 1 = calza fuerte · 0.5 = calza el nombre de pila · 0 = no se puede afirmar
export function calzaNombre(origen, candidato) {
  const a = limpiaNombre(origen), b = limpiaNombre(candidato);
  if (!a || !b) return 0;
  const pa = a.split(" ").filter((x) => x.length > 1);
  const pb = b.split(" ").filter((x) => x.length > 1);
  if (!pa.length || !pb.length) return 0;
  let exactas = 0, prefijos = 0;
  for (const x of pa) {
    if (pb.includes(x)) { exactas++; continue; }
    // El enmascarado corta el apellido: "pal" contra "palomino".
    if (pb.some((y) => (y.length >= 3 && x.length >= 3) && (y.startsWith(x) || x.startsWith(y)))) prefijos++;
  }
  if (exactas >= 2) return 1;
  if (exactas === 1 && prefijos >= 1) return 1;
  if (exactas === 1 || prefijos >= 2) return 0.5;
  return 0;
}

// ── 4. Emparejar ───────────────────────────────────────────────────
// `ventas`: [{ id, monto, fecha (Date, cuándo llegó el comprobante), cliente,
//              metodo? }]  ·  `movs`: los del reporte.
export const OPCIONES = {
  minutosAntes: 240,   // el pago ocurre ANTES de la captura; 4 h de gracia
  minutosDespues: 30,  // margen por relojes desfasados / captura previa
  centavos: 0.005,     // tolerancia de redondeo
};

// Puntaje de una pareja. Devuelve null si ni siquiera es candidata.
export function puntuar(venta, mov, op = OPCIONES) {
  if (Math.abs(venta.monto - mov.monto) > op.centavos) return null;
  const dif = (venta.fecha - mov.fecha) / 60000; // minutos que el pago va ADELANTE
  if (dif < -op.minutosDespues || dif > op.minutosAntes) return null;
  // Cuanto más pegado al comprobante, mejor. 0 min = 1 · 240 min = 0.
  const cercania = 1 - Math.min(Math.abs(dif), op.minutosAntes) / op.minutosAntes;
  const nom = calzaNombre(mov.quien, venta.cliente);
  const notaOk = venta.producto && mov.nota && norm(mov.nota).includes(norm(venta.producto).split(" ")[0]) ? 0.15 : 0;
  return {
    total: cercania * 0.6 + nom * 0.4 + notaOk,
    minutos: Math.round(dif), nombre: nom, nota: !!notaOk,
  };
}

// Emparejamiento por ELECCIÓN MUTUA con margen. Nunca resuelve un empate.
//   modo "prudente"   → exige que el nombre no contradiga, o candidato único
//   modo "equilibrado"→ acepta también cuando le saca ventaja clara al segundo
export function emparejar(ventas, movs, { modo = "prudente", op = OPCIONES } = {}) {
  const cands = new Map();   // venta.id -> [{mov, p}]
  const porMov = new Map();  // mov.i    -> [{ventaId, p}]
  for (const v of ventas) {
    const lista = [];
    for (const m of movs) {
      const p = puntuar(v, m, op);
      if (p) lista.push({ mov: m, p });
    }
    lista.sort((a, b) => b.p.total - a.p.total);
    cands.set(v.id, lista);
    for (const c of lista) {
      if (!porMov.has(c.mov.i)) porMov.set(c.mov.i, []);
      porMov.get(c.mov.i).push({ ventaId: v.id, p: c.p });
    }
  }
  for (const arr of porMov.values()) arr.sort((a, b) => b.p.total - a.p.total);

  const cuadradas = [], revisar = [], sinPago = [];
  const movUsado = new Set();
  for (const v of ventas) {
    const lista = cands.get(v.id) || [];
    if (!lista.length) { sinPago.push({ venta: v, motivo: "sin_candidatos" }); continue; }
    const mejor = lista[0], segundo = lista[1];
    const rivales = (porMov.get(mejor.mov.i) || []).filter((x) => x.ventaId !== v.id);
    // Elección mutua: nadie más pretende ese movimiento con mejor puntaje.
    const esMutuo = !rivales.length || rivales[0].p.total < mejor.p.total - 1e-9;
    const unico = !segundo;
    const margen = segundo ? mejor.p.total - segundo.p.total : 1;
    const nombreOk = mejor.p.nombre >= 0.5;
    const seguro = modo === "equilibrado"
      ? esMutuo && (unico || margen >= 0.25 || nombreOk)
      : esMutuo && (unico || nombreOk);
    if (seguro && !movUsado.has(mejor.mov.i)) {
      movUsado.add(mejor.mov.i);
      cuadradas.push({ venta: v, mov: mejor.mov, p: mejor.p, por: razones(mejor, v) });
    } else {
      revisar.push({ venta: v, opciones: lista.slice(0, 5).map((c) => ({ mov: c.mov, p: c.p, por: razones(c, v) })),
                     motivo: !esMutuo ? "otro_pedido_lo_reclama" : "empate" });
    }
  }
  const libres = movs.filter((m) => !movUsado.has(m.i));
  return { cuadradas, revisar, sinPago, libres, movUsado };
}

// Por qué se casó esta pareja, en palabras. La decisión tiene que poder
// auditarse: un veredicto sin explicación no se puede corregir.
function razones(c, v) {
  const out = [`S/ ${c.mov.monto.toFixed(2)} exacto`];
  const min = c.p.minutos;
  out.push(min === 0 ? "a la misma hora que la captura"
    : min > 0 ? `el pago entró ${min} min antes de la captura`
    : `el pago entró ${-min} min después de la captura`);
  if (c.p.nombre >= 1) out.push(`“${c.mov.quien}” calza con ${v.cliente}`);
  else if (c.p.nombre >= 0.5) out.push(`“${c.mov.quien}” se parece a ${v.cliente}`);
  else if (c.mov.quien) out.push(`pagó “${c.mov.quien}” (otro titular)`);
  if (c.p.nota) out.push("la nota menciona el producto");
  return out;
}

// ── 5. Plata que entró y Nodo no registró ──────────────────────────
// El mismo Yape recibe pagos de OTROS negocios (en el reporte real de Rodrigo,
// miles). Listarlos todos haría el reporte inservible, así que solo se
// muestran los que huelen a Nodo: los que caen cerca de una señal real.
// `señales` debe traer sobre todo COMPROBANTES (imágenes entrantes de un
// contacto): son mucho más selectivas que "cualquier mensaje" — con una
// ventana ancha y señales flojas, la mitad del archivo ajeno se cuela.
export function pagosSinVenta(libres, señales, { minutos = 45 } = {}) {
  const conSeñal = [], ajenos = [];
  for (const m of libres) {
    const cerca = señales.filter((s) => Math.abs(s.fecha - m.fecha) / 60000 <= minutos);
    if (cerca.length) {
      cerca.sort((a, b) => Math.abs(a.fecha - m.fecha) - Math.abs(b.fecha - m.fecha));
      // Un mismo cliente puede haber mandado varias fotos: se queda la más
      // pegada al pago. Si no, las tres pistas serían la misma persona.
      const vistos = new Set(), unicas = [];
      for (const s of cerca) {
        const k = s.id ?? s.contacto ?? s.nombre;
        if (vistos.has(k)) continue;
        vistos.add(k); unicas.push(s);
        if (unicas.length === 3) break;
      }
      conSeñal.push({ mov: m, pistas: unicas });
    } else ajenos.push(m);
  }
  return { conSeñal, ajenos };
}
