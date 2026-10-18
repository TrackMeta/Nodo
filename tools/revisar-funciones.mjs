// Corrector de las Edge Functions (auditoría 18-oct): `deno check` y SOLO frena por los errores que tumban el bot.
// Los avisos de tipos que el código ya tenía (TS2339 «la propiedad no existe en el tipo», etc.) no frenan: si frenaran,
// no se podría desplegar nunca. Sí frenan: sintaxis (TS1xxx), constante repetida (TS2451: el 503 «bot mudo» de la
// memoria const-duplicada-503), nombre o import que no existe, variable usada antes de declararse.
// Uso: node tools/revisar-funciones.mjs [funcion ...]     (sin argumentos: todas)
// Lo usan tools/desplegar.ps1 (antes de subir) y la acción de GitHub revisar-motor.yml (en cada push).
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { funciones } from "./funciones-afectadas.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GRAVES = {
  TS2451: "constante o variable repetida (bot mudo, 503)", TS2300: "identificador repetido",
  TS2304: "nombre que no existe", TS2552: "nombre que no existe",
  TS2305: "import de algo que el módulo no exporta", TS2724: "import de algo que el módulo no exporta",
  TS2307: "archivo o módulo que no existe", TS2448: "variable usada antes de declararse",
  TS2454: "variable usada antes de asignarse",
};
const fns = process.argv.slice(2).flatMap((a) => a.split(",")).filter(Boolean);
const lista = fns.length ? fns : funciones();
const deno = [path.join(os.homedir(), ".deno", "bin", process.platform === "win32" ? "deno.exe" : "deno"), "deno"].find((d) => d === "deno" || fs.existsSync(d));
const r = spawnSync(deno, ["check", ...lista.map((f) => `supabase/functions/${f}/index.ts`)],
  { cwd: RAIZ, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" }, maxBuffer: 64 * 1024 * 1024 });
if (r.error) { console.log("No se pudo correr deno: " + r.error.message); process.exit(3); }
const salida = (r.stdout || "") + (r.stderr || "");
const errores = [...salida.matchAll(/(TS\d+) \[ERROR\]:? ([^\r\n]*)[\s\S]*?at (file:\/\/\/[^\r\n]+)/g)];
const graves = errores.filter((m) => /^TS1\d{3}$/.test(m[1]) || GRAVES[m[1]]);
// deno puede fallar sin errores TS (p. ej. un import remoto que no baja): eso también frena.
if (r.status !== 0 && !errores.length) {
  console.log("FRENADO: deno check falló sin errores de tipos (¿red o import remoto?):\n" + salida.slice(-1500));
  process.exit(2);
}
if (graves.length) {
  console.log(`FRENADO: ${graves.length} error(es) que rompen el bot. No se sube nada.`);
  for (const m of graves) {
    const donde = decodeURIComponent(m[3]).replace(/^file:\/\/\//, "").replace(RAIZ.split(path.sep).join("/") + "/", "");
    console.log(`  ${m[1]} (${GRAVES[m[1]] || "error de sintaxis"}): ${m[2]}\n     en ${donde}`);
  }
  process.exit(2);
}
console.log(`OK: ${lista.length} función(es) sin errores graves (${errores.length} aviso(s) de tipos que no frenan).`);
