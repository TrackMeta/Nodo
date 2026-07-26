// ═══════════════════════════════════════════════════════════════════
// Nodo · xlsx-fill.js — RELLENAR una plantilla .xlsx/.xlsm real.
//
// Los couriers (Shalom, Eva, Olva…) tienen su propio Excel de carga masiva,
// con hojas de validación, tablas, macros y estilos. Para que su portal lo
// acepte, no inventamos un Excel nuevo: rellenamos una COPIA de su archivo
// original, tocando lo mínimo — solo el `sheetData` de UNA hoja: se conserva la
// fila de cabecera y se agregan las filas de datos; todo lo demás (macros,
// validaciones, tablas, activeX, estilos) se copia byte por byte.
//
// Es el espejo de escritura del lector ZIP de conciliar.js: un .xlsx es un ZIP,
// y acá lo volvemos a armar con las APIs nativas del navegador (sin librerías).
// ═══════════════════════════════════════════════════════════════════

// ── CRC32 (lo exige cada entrada del ZIP) ──────────────────────────
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── Leer el ZIP: cada entrada con su metadata + bytes crudos ────────
// Se conserva el orden y los bytes COMPRIMIDOS tal cual (así las partes que no
// tocamos salen idénticas). Los tamaños/crc se leen del directorio central, que
// es la fuente fiable (la cabecera local a veces los deja en 0).
export function leerZip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("El archivo no parece un Excel válido.");
  const nEntries = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = [];
  for (let i = 0; i < nEntries; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const flag = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const time = dv.getUint16(p + 12, true);
    const date = dv.getUint16(p + 14, true);
    const crc = dv.getUint32(p + 16, true);
    const compSize = dv.getUint32(p + 20, true);
    const uncompSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const cmtLen = dv.getUint16(p + 32, true);
    const extAttr = dv.getUint32(p + 38, true);
    const lhOff = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    const lhNameLen = dv.getUint16(lhOff + 26, true);
    const lhExtraLen = dv.getUint16(lhOff + 28, true);
    const ini = lhOff + 30 + lhNameLen + lhExtraLen;
    entries.push({ name, flag, method, time, date, crc, uncompSize, extAttr, data: u8.slice(ini, ini + compSize) });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return entries;
}

async function inflar(entry) {
  if (entry.method === 0) return entry.data;
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([entry.data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function textoDe(entry) { return new TextDecoder("utf-8").decode(await inflar(entry)); }
export const entradaPorNombre = (entries, name) => entries.find((e) => e.name === name);

// Reemplaza una entrada por texto NUEVO, guardado SIN comprimir (method 0). No
// hace falta comprimir: el archivo abre igual y nos ahorramos CompressionStream.
export function ponerTexto(entry, texto) {
  const bytes = new TextEncoder().encode(texto);
  entry.method = 0;
  entry.flag = 0;
  entry.data = bytes;
  entry.uncompSize = bytes.length;
  entry.crc = crc32(bytes);
}

// ── Escribir el ZIP de vuelta ──────────────────────────────────────
export function escribirZip(entries) {
  const enc = new TextEncoder();
  const partes = [];
  const central = [];
  let offset = 0;
  const push = (arr) => { partes.push(arr); offset += arr.length; };
  for (const e of entries) {
    const nameB = enc.encode(e.name);
    const flag = e.flag & ~0x08; // sin "data descriptor": los tamaños van en la cabecera
    const lh = new Uint8Array(30 + nameB.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, flag, true);
    dv.setUint16(8, e.method, true);
    dv.setUint16(10, e.time || 0, true);
    dv.setUint16(12, e.date || 0, true);
    dv.setUint32(14, e.crc, true);
    dv.setUint32(18, e.data.length, true);
    dv.setUint32(22, e.uncompSize, true);
    dv.setUint16(26, nameB.length, true);
    dv.setUint16(28, 0, true);
    lh.set(nameB, 30);
    const localOff = offset;
    push(lh); push(e.data);
    const cd = new Uint8Array(46 + nameB.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flag, true);
    cv.setUint16(10, e.method, true);
    cv.setUint16(12, e.time || 0, true);
    cv.setUint16(14, e.date || 0, true);
    cv.setUint32(16, e.crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.uncompSize, true);
    cv.setUint16(28, nameB.length, true);
    cv.setUint16(38, 0, true);            // (30 extra, 32 comment, 34 disk, 36 int-attr = 0)
    cv.setUint32(38, e.extAttr || 0, true);
    cv.setUint32(42, localOff, true);
    cd.set(nameB, 46);
    central.push(cd);
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) { push(c); cdSize += c.length; }
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  push(eocd);
  let total = 0; for (const c of partes) total += c.length;
  const out = new Uint8Array(total);
  let o = 0; for (const c of partes) { out.set(c, o); o += c.length; }
  return out;
}

// ── Modificar el sheetData de una hoja ─────────────────────────────
const escXml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function colLetra(n) { let s = "", x = n + 1; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s; }

// `filas` = array de filas; cada fila = array indexado por columna (0=A). Cada
// celda: null/"" se omite; {t:"n",v} = número; cualquier otra cosa = texto.
// Conserva `headerRows` filas de cabecera y REEMPLAZA el resto (borra ejemplos).
export function rellenarSheet(xml, filas, { headerRows = 1 } = {}) {
  const m = xml.match(/<sheetData(\s[^>]*)?>([\s\S]*?)<\/sheetData>/);
  if (!m) throw new Error("La hoja no tiene sheetData.");
  const rowsArr = m[2].match(/<row[^>]*\/>|<row[\s\S]*?<\/row>/g) || [];
  const header = rowsArr.slice(0, headerRows).join("");
  let body = "";
  let maxCol = 0;
  filas.forEach((fila, idx) => {
    const r = headerRows + 1 + idx;
    let cells = "";
    fila.forEach((cell, col) => {
      if (cell == null || cell === "") return;
      if (col > maxCol) maxCol = col;
      const ref = colLetra(col) + r;
      if (cell && cell.t === "n") cells += `<c r="${ref}"><v>${cell.v}</v></c>`;
      else { const val = (cell && cell.t) ? cell.v : cell; cells += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(val)}</t></is></c>`; }
    });
    body += `<row r="${r}">${cells}</row>`;
  });
  const nuevo = `<sheetData${m[1] || ""}>${header}${body}</sheetData>`;
  let out = xml.slice(0, m.index) + nuevo + xml.slice(m.index + m[0].length);
  const lastRow = Math.max(headerRows + filas.length, 1);
  out = out.replace(/<dimension ref="([A-Z]+)\d+:([A-Z]+)\d+"\s*\/>/, (_, c1, c2) => `<dimension ref="${c1}1:${c2}${lastRow}"/>`);
  return out;
}

// Extiende (o achica) el rango de una tabla de Excel a `lastRow` filas. Excel
// se queja ("archivo dañado") si la tabla declara filas que ya no existen, así
// que hay que ajustarla cuando cambiamos cuántas filas de datos hay.
export function ajustarTablaRef(tableXml, lastRow) {
  const fix = (s) => s.replace(/(ref=")([A-Z]+)(\d+):([A-Z]+)(\d+)(")/, (_, a, c1, r1, c2, r2, b) => `${a}${c1}${r1}:${c2}${Math.max(lastRow, Number(r1))}${b}`);
  let out = tableXml.replace(/<table [^>]*ref="[^"]*"[^>]*>/, fix);
  out = out.replace(/<autoFilter [^>]*ref="[^"]*"[^>]*\/?>/, fix);
  return out;
}

// ── Descargar ──────────────────────────────────────────────────────
export function descargar(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
