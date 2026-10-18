// Qué Edge Functions empaqueta cada archivo de supabase/functions (imports relativos, transitivos).
// Uso:
//   node tools/funciones-afectadas.mjs                 → todas las funciones y sus piezas de _shared
//   node tools/funciones-afectadas.mjs <archivo>...    → las funciones que hay que desplegar si cambian esos archivos
//   node tools/funciones-afectadas.mjs --desde <commit> → las que cambiaron desde ese commit (git diff)
// Por qué existe (auditoría 18-oct): el despliegue subía una lista FIJA de 17 funciones; las otras 17 también
// empaquetan piezas de _shared (meta.ts, capi.ts, gsheets.ts…) y se quedaban con la versión vieja.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FN = path.join(RAIZ, "supabase", "functions");
const RE_IMP = /(?:import|export)\s[^'"]*?from\s*["'](\.{1,2}\/[^"']+)["']|import\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)|import\s*["'](\.{1,2}\/[^"']+)["']/g;

function deps(archivo, vistos = new Set()) {
  if (vistos.has(archivo) || !fs.existsSync(archivo)) return vistos;
  vistos.add(archivo);
  const src = fs.readFileSync(archivo, "utf8");
  for (const m of src.matchAll(RE_IMP)) deps(path.resolve(path.dirname(archivo), m[1] || m[2] || m[3]), vistos);
  return vistos;
}
export function funciones() {
  return fs.readdirSync(FN, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && fs.existsSync(path.join(FN, d.name, "index.ts")))
    .map((d) => d.name).sort();
}
export function mapa() {
  const m = {};
  for (const f of funciones()) m[f] = [...deps(path.join(FN, f, "index.ts"))].map((a) => path.relative(FN, a).split(path.sep).join("/"));
  return m;
}
export function afectadas(cambiados) {
  const rel = cambiados.map((a) => path.relative(FN, path.resolve(RAIZ, a)).split(path.sep).join("/")).filter((a) => !a.startsWith(".."));
  const m = mapa();
  return Object.keys(m).filter((f) => m[f].some((a) => rel.includes(a)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--desde") {
    const out = execSync(`git -C "${RAIZ}" diff --name-only ${args[1]} -- supabase/functions`, { encoding: "utf8" });
    console.log(afectadas(out.split("\n").filter(Boolean)).join("\n"));
  } else if (args.length) {
    console.log(afectadas(args).join("\n"));
  } else {
    for (const [f, a] of Object.entries(mapa())) console.log(f.padEnd(18), a.filter((x) => x.startsWith("_shared")).map((x) => x.slice(8)).join(" "));
  }
}
