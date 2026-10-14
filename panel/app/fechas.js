// Selector de fechas de la app (Hoy y Ventas): botón con el período y su rango; al tocarlo, la hoja con Hoy, Ayer,
// 7 días… y «Personalizado…» (desde / hasta, hora del negocio).
import { $, esc, ic, abrirHoja, hoja, toast } from "./app.js";
import { PRESETS, computePreset, ymd } from "../date-range.js";

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const fDia = (d) => `${d.getDate()} ${MES[d.getMonth()]}`;
export const fRango = (r) => (ymd(r.from) === ymd(r.to) ? fDia(r.to) : `${fDia(r.from)} – ${fDia(r.to)}`);
export const lblDe = (r) => (r.preset === "custom" ? "Personalizado" : (PRESETS.find((p) => p[0] === r.preset) || [, "Período"])[1]);

// El botón (la página escucha el clic en [data-dsel] y llama a elegirFechas)
export const botonFechas = (r) => `<button type="button" class="dsel" data-dsel>${ic("calendar")}<span><b>${esc(lblDe(r))}</b><small>${fRango(r)}</small></span>${ic("chevronDown")}</button>`;

// Abre la hoja con el período actual `R`; `listo(nuevoR)` recibe el período elegido
export function elegirFechas(R, listo) {
  const ops = PRESETS.map((p) => { const r = computePreset(p[0]); return { t: p[1], small: p[0] === "max" ? "desde el inicio" : fRango(r), on: R.preset === p[0], v: p[0] }; });
  ops.push({ t: "Personalizado…", small: R.preset === "custom" ? fRango(R) : "elige desde y hasta", on: R.preset === "custom", v: "custom" });
  hoja("Ver datos de", ops, (o) => {
    if (o.v !== "custom") { listo(computePreset(o.v)); return; }
    const hoyR = computePreset("hoy"), d7 = computePreset("7d");
    abrirHoja(`<h3>Personalizado</h3><p class="lead">Elige el primer y el último día (hora del negocio).</p>
      <div class="grid2" style="margin-bottom:10px"><label class="flabel" style="margin:0">Desde<input class="inpt" type="date" id="dd1" max="${ymd(hoyR.to)}" value="${ymd(R.preset === "custom" ? R.from : d7.from)}"></label><label class="flabel" style="margin:0">Hasta<input class="inpt" type="date" id="dd2" max="${ymd(hoyR.to)}" value="${ymd(R.preset === "custom" ? R.to : hoyR.to)}"></label></div>
      <button type="button" class="btn blue" style="width:100%" id="ddgo">Ver estos días</button>`, (sh, cerrar) => {
      $("#ddgo", sh).onclick = () => {
        const p = (v) => { const [y, mo, d] = String(v).split("-").map(Number); return new Date(y, mo - 1, d); };
        let a = p($("#dd1", sh).value), b = p($("#dd2", sh).value);
        if (isNaN(a) || isNaN(b)) { toast("Elige las dos fechas", true); return; }
        if (a > b) [a, b] = [b, a];
        cerrar(); listo({ from: a, to: b, preset: "custom" });
      };
    });
  });
}
