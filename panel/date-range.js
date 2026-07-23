// ═══════════════════════════════════════════════════════════════════
// Nodo · date-range.js — el selector de rango de fechas de la app.
//
// Nació dentro de rendimiento.html (estilo Ads Manager: 11 atajos + dos meses
// + rango a mano). Vive acá porque ya lo usan dos pantallas, y copiarlo era
// repetir el error que estuvimos limpiando: dos copias divergen y terminas con
// dos calendarios que no se comportan igual.
//
// Uso:
//   const dr = mountDateRange(contenedor, { valor, onChange });
//   dr.valor()      → { from:Date, to:Date, preset:string|null }
//   dr.set(r)       → cambiarlo desde afuera
// El `onChange` se dispara al tocar "Actualizar", no en cada clic: elegir un
// rango son varios toques y no tiene sentido recargar en cada uno.
// ═══════════════════════════════════════════════════════════════════

const DR_DOW = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const DR_MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DR_MESL = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const d0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dAdd = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dSame = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const dFmt = (d) => `${d.getDate()} ${DR_MES[d.getMonth()]} ${d.getFullYear()}`;
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const PRESETS = [
  ["hoy", "Hoy", () => { const t = d0(new Date()); return [t, t]; }],
  ["ayer", "Ayer", () => { const y = dAdd(d0(new Date()), -1); return [y, y]; }],
  ["7d", "Últimos 7 días", () => { const t = d0(new Date()); return [dAdd(t, -6), t]; }],
  ["14d", "Últimos 14 días", () => { const t = d0(new Date()); return [dAdd(t, -13), t]; }],
  ["28d", "Últimos 28 días", () => { const t = d0(new Date()); return [dAdd(t, -27), t]; }],
  ["30d", "Últimos 30 días", () => { const t = d0(new Date()); return [dAdd(t, -29), t]; }],
  ["semana", "Esta semana", () => { const t = d0(new Date()); return [dAdd(t, -((t.getDay() + 6) % 7)), t]; }],
  ["semanaAnt", "La semana pasada", () => { const t = d0(new Date()); const lun = dAdd(t, -((t.getDay() + 6) % 7)); return [dAdd(lun, -7), dAdd(lun, -1)]; }],
  ["mes", "Este mes", () => { const t = d0(new Date()); return [new Date(t.getFullYear(), t.getMonth(), 1), t]; }],
  ["mesAnt", "El mes pasado", () => { const t = d0(new Date()); return [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)]; }],
  ["max", "Máximo", () => { const t = d0(new Date()); return [dAdd(t, -364), t]; }],
];
export function computePreset(key) { const p = PRESETS.find((x) => x[0] === key) || PRESETS[5]; const [from, to] = p[2](); return { from, to, preset: p[0] }; }
export function rangeLabel(r) {
  if (!r) return "Últimos 30 días";
  if (r.preset) { const p = PRESETS.find((x) => x[0] === r.preset); if (p) return p[1]; }
  return `${dFmt(r.from)} – ${dFmt(r.to)}`;
}

const CSS = `
.drpicker{position:relative}
.drtrigger{height:34px;padding:0 12px;border-radius:10px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);font-size:12.5px;font-weight:600;display:inline-flex;align-items:center;gap:8px;white-space:nowrap;cursor:pointer;font-family:inherit}
.drtrigger:hover{border-color:var(--brand)}
.drtrigger svg{width:14px;height:14px;color:var(--muted);flex:none}
.drpop{position:absolute;top:calc(100% + 6px);left:0;z-index:50;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.45);display:none}
.drpop.show{display:flex}
.drpresets{width:186px;border-right:1px solid var(--border);padding:8px;display:flex;flex-direction:column;gap:1px;max-height:392px;overflow:auto}
.drpreset{display:flex;align-items:center;gap:10px;text-align:left;background:none;border:none;color:var(--text);font-size:12.5px;font-weight:600;padding:8px 10px;border-radius:8px;cursor:pointer;font-family:inherit}
.drpreset:hover{background:var(--surface-2)}
.drpreset .drrad{width:15px;height:15px;border-radius:50%;border:2px solid var(--border);flex:none}
.drpreset.on{color:var(--brand)} .drpreset.on .drrad{border-color:var(--brand);box-shadow:inset 0 0 0 3px var(--surface),inset 0 0 0 6px var(--brand)}
.drright{display:flex;flex-direction:column}
.drcal{padding:14px 16px}
.drmonths{display:flex;gap:26px}
.drmonth{width:224px}
.drmhead{display:flex;align-items:center;justify-content:space-between;font-weight:700;font-size:13px;margin-bottom:8px;text-transform:capitalize}
.drnav{background:none;border:none;color:var(--muted);cursor:pointer;padding:3px;border-radius:6px;display:inline-flex}
.drnav:hover{background:var(--surface-2);color:var(--text)} .drnav svg{width:16px;height:16px}
.drgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.drdow{font-size:9.5px;color:var(--faint);text-align:center;font-weight:700;padding:2px 0}
.drday{height:28px;border:none;background:none;color:var(--text);font-size:12px;border-radius:7px;cursor:pointer;font-variant-numeric:tabular-nums;padding:0;font-family:inherit}
.drday:hover{background:var(--surface-2)}
.drday.muted{visibility:hidden;pointer-events:none}
.drday.inrange{background:var(--brand-bg,rgba(43,127,255,.13));border-radius:0}
.drday.edge{background:var(--brand);color:#fff;font-weight:700}
.drday.edge.start{border-radius:7px 0 0 7px} .drday.edge.end{border-radius:0 7px 7px 0}
.drday.edge.start.end{border-radius:7px}
.drfoot{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 16px;border-top:1px solid var(--border)}
.drfoot .lbl{font-size:12.5px;color:var(--text);line-height:1.5}
.drfoot .acts{display:flex;gap:8px;flex:none}
.drfoot .drbtn{height:36px;padding:0 15px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
.drfoot .drbtn.primary{background:var(--brand);border:none;color:#fff}
@media(max-width:760px){ .drpop{flex-direction:column} .drpresets{width:auto;border-right:none;border-bottom:1px solid var(--border);max-height:150px}
  .drmonths{flex-direction:column;gap:14px} .drmonth{width:auto} }
`;
let cssPuesto = false;
function ponerCss() {
  if (cssPuesto || document.querySelector("[data-dr-css]")) { cssPuesto = true; return; }
  cssPuesto = true;
  document.head.insertAdjacentHTML("beforeend", `<style data-dr-css>${CSS}</style>`);
}

const ICO_CAL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
const ICO_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
const ICO_L = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`;
const ICO_R = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;

export function mountDateRange(host, { valor = null, onChange = null, nota = "Las fechas se muestran en la Hora de Lima" } = {}) {
  ponerCss();
  let rango = valor || computePreset("30d");
  let pk = null;
  host.classList.add("drpicker");
  host.innerHTML = `<button type="button" class="drtrigger">${ICO_CAL}<span class="drlabel"></span>${ICO_DOWN}</button><div class="drpop"></div>`;
  const trigger = host.querySelector(".drtrigger");
  const label = host.querySelector(".drlabel");
  const pop = host.querySelector(".drpop");
  const pintaLabel = () => { label.textContent = rangeLabel(rango); };

  const celdas = (y, m) => {
    const off = (new Date(y, m, 1).getDay() + 6) % 7, dim = new Date(y, m + 1, 0).getDate(), c = [];
    for (let i = 0; i < off; i++) c.push(null);
    for (let d = 1; d <= dim; d++) c.push(new Date(y, m, d));
    return c;
  };
  const mes = (y, m, lado) => {
    const nav = lado === "l"
      ? `<button type="button" class="drnav" data-nav="-1">${ICO_L}</button><span>${DR_MESL[m]} ${y}</span><span></span>`
      : `<span></span><span>${DR_MESL[m]} ${y}</span><button type="button" class="drnav" data-nav="1">${ICO_R}</button>`;
    return `<div class="drmonth"><div class="drmhead">${nav}</div><div class="drgrid">${DR_DOW.map((d) => `<span class="drdow">${d}</span>`).join("")}${celdas(y, m).map((c) => {
      if (!c) return `<span class="drday muted"></span>`;
      const inR = pk.from && pk.to && c >= pk.from && c <= pk.to, isS = dSame(c, pk.from), isE = dSame(c, pk.to);
      return `<button type="button" class="drday${inR ? " inrange" : ""}${(isS || isE) ? " edge" : ""}${isS ? " start" : ""}${isE ? " end" : ""}" data-ymd="${c.getFullYear()}_${c.getMonth()}_${c.getDate()}">${c.getDate()}</button>`;
    }).join("")}</div></div>`;
  };
  function pinta() {
    const y = pk.focus.getFullYear(), m = pk.focus.getMonth(), ny = m === 11 ? y + 1 : y, nm = (m + 1) % 12;
    pop.innerHTML = `
      <div class="drpresets">${PRESETS.map((p) => `<button type="button" class="drpreset ${pk.preset === p[0] ? "on" : ""}" data-preset="${p[0]}"><span class="drrad"></span>${p[1]}</button>`).join("")}</div>
      <div class="drright">
        <div class="drcal"><div class="drmonths">${mes(y, m, "l")}${mes(ny, nm, "r")}</div></div>
        <div class="drfoot"><div class="lbl">${pk.from && pk.to ? `${dFmt(pk.from)} – ${dFmt(pk.to)}` : (pk.from ? `${dFmt(pk.from)} – …` : "Elige un rango")}${nota ? `<br><span style="font-size:11px;color:var(--faint)">${nota}</span>` : ""}</div>
        <div class="acts"><button type="button" class="drbtn" data-dr="cancel">Cancelar</button><button type="button" class="drbtn primary" data-dr="apply">Actualizar</button></div></div>
      </div>`;
    pop.querySelectorAll("[data-preset]").forEach((b) => b.onclick = () => {
      const r = computePreset(b.dataset.preset);
      pk.from = r.from; pk.to = r.to; pk.preset = r.preset;
      pk.focus = new Date(r.to.getFullYear(), r.to.getMonth() - 1, 1); pinta();
    });
    pop.querySelectorAll("[data-nav]").forEach((b) => b.onclick = () => {
      pk.focus = new Date(pk.focus.getFullYear(), pk.focus.getMonth() + Number(b.dataset.nav), 1); pinta();
    });
    pop.querySelectorAll("[data-ymd]").forEach((b) => b.onclick = () => {
      const [yy, mm, dd] = b.dataset.ymd.split("_").map(Number), date = new Date(yy, mm, dd);
      // Primer clic abre un rango nuevo; el segundo lo cierra. Si el segundo es
      // anterior al primero se invierten, para no obligar a empezar de nuevo.
      if (!pk.from || (pk.from && pk.to)) { pk.from = date; pk.to = null; }
      else if (date >= pk.from) pk.to = date;
      else { pk.to = pk.from; pk.from = date; }
      pk.preset = null; pinta();
    });
    pop.querySelector('[data-dr="cancel"]').onclick = () => pop.classList.remove("show");
    pop.querySelector('[data-dr="apply"]').onclick = () => {
      if (!pk.from) return;
      if (!pk.to) pk.to = pk.from;
      rango = { from: pk.from, to: pk.to, preset: pk.preset };
      pop.classList.remove("show"); pintaLabel();
      onChange && onChange(rango);
    };
  }
  trigger.onclick = (e) => {
    e.stopPropagation();
    if (pop.classList.contains("show")) { pop.classList.remove("show"); return; }
    pk = { from: rango.from, to: rango.to, preset: rango.preset || null,
           focus: new Date(rango.to.getFullYear(), rango.to.getMonth() - 1, 1) };
    pinta(); pop.classList.add("show");
  };
  // Un solo listener global para todos los selectores de la página.
  if (!window.__drDocWired) {
    window.__drDocWired = true;
    document.addEventListener("click", (e) => {
      if (e.target.closest(".drpicker")) return;
      document.querySelectorAll(".drpop.show").forEach((p) => p.classList.remove("show"));
    });
  }
  pintaLabel();
  return { valor: () => rango, set: (r) => { rango = r || computePreset("30d"); pintaLabel(); }, el: host };
}
