// Corrector del panel y la app (auditoría 18-oct): revisa la SINTAXIS de cada .js y de cada <script> dentro de los
// .html de panel/ (incluida panel/app/), sin ejecutar nada. Falla (exit 1) si alguno no compila.
// Por qué: GitHub Pages publica lo que se sube sin mirar. El 15-oct un «$$» en un String.replace dejó
// «Identifier '$' has already been declared» y la app no abría (memoria reemplazo-con-signo-dolar).
// Uso: node tools/revisar-panel.mjs            (lo corre también la acción de GitHub antes de publicar)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PANEL = path.join(RAIZ, "panel");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "revisar-panel-"));
const OMITIR = new Set(["node_modules", "vendor", "kit"]);   // (copias de librerías de terceros, ya minificadas)

function archivos(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (OMITIR.has(d.name)) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) archivos(p, out);
    else if (/\.(js|mjs|html)$/.test(d.name) && !/\.min\.js$/.test(d.name)) out.push(p);
  }
  return out;
}
// Devuelve el primer error de sintaxis (o null). Los módulos van como .mjs; los <script> clásicos como .cjs.
function revisar(codigo, esModulo, nombre) {
  const f = path.join(TMP, nombre.replace(/[^\w.-]+/g, "_") + (esModulo ? ".mjs" : ".cjs"));
  fs.writeFileSync(f, codigo);
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  if (r.status === 0) return null;
  const err = (r.stderr || "").split("\n");
  const i = err.findIndex((l) => /Error/.test(l));
  return { linea: (err[0].match(/:(\d+)\s*$/) || [])[1], msg: (err[i] || err[0] || "").trim(), muestra: (err[1] || "").trim() };
}

const fallos = [];
let n = 0;
for (const a of archivos(PANEL)) {
  const rel = path.relative(RAIZ, a).split(path.sep).join("/");
  const src = fs.readFileSync(a, "utf8");
  if (a.endsWith(".html")) {
    let k = 0;
    for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = m[1], cod = m[2];
      if (/\bsrc\s*=/.test(attrs) || !cod.trim()) continue;
      const tipo = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "";
      if (tipo && !/^(module|text\/javascript|application\/javascript)$/i.test(tipo)) continue;   // (JSON, plantillas)
      k++; n++;
      // línea del <script> dentro del .html, para que el número que se informa sea el del archivo real
      const base = src.slice(0, m.index).split("\n").length - 1;
      const e = revisar(cod, /^module$/i.test(tipo), `${rel}#${k}`);
      if (e) fallos.push(`${rel}${e.linea ? ":" + (base + Number(e.linea)) : ""} (script ${k})\n    ${e.msg}${e.muestra ? "\n    → " + e.muestra : ""}`);
    }
  } else {
    n++;
    const e = revisar(src, true, rel);
    if (e) fallos.push(`${rel}${e.linea ? ":" + e.linea : ""}\n    ${e.msg}${e.muestra ? "\n    → " + e.muestra : ""}`);
  }
}
fs.rmSync(TMP, { recursive: true, force: true });
if (fallos.length) {
  console.log(`FRENADO: ${fallos.length} archivo(s) del panel no compilan (de ${n} revisados):\n`);
  console.log(fallos.join("\n\n"));
  process.exit(1);
}
console.log(`OK: ${n} scripts del panel y la app compilan.`);
