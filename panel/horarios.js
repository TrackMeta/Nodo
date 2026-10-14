// ═══════════════════════════════════════════════════════════════════
// Horarios de venta (13-oct, Rodrigo: «¿en qué horario vendí más?»). Lo usan el Dashboard del panel y la
// pestaña Hoy de la app de celular. Para las fechas elegidas: barras de ventas (o ingresos) por hora del día y,
// en letras, las mejores horas y las que traen chats pero no venden. Hora del negocio (date-range.js).
// (13-oct) Sin el mapa de calor día × hora: a Rodrigo no le gustó.
// ═══════════════════════════════════════════════════════════════════
import { pageAll } from "./shell.js";
import { getTZ } from "./date-range.js";
import * as O from "./orders.js";

const DIAS_L = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábados", "domingos"];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hora = (h) => (h === 0 ? "12 am" : h < 12 ? `${h} am` : h === 12 ? "12 pm" : `${h - 12} pm`);
const franja = (h) => `${hora(h)} – ${hora((h + 1) % 24)}`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
let _fmt = null, _tz = null;
function diaHora(ts) {
  const tz = getTZ() || "America/Lima";
  if (_tz !== tz) { _fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", hour12: false }); _tz = tz; }
  const p = _fmt.formatToParts(new Date(ts));
  return [{ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[p.find((x) => x.type === "weekday").value] ?? 0, Number(p.find((x) => x.type === "hour").value) % 24];
}
const leer = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
const FLECHA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;

function css() {
  if (document.getElementById("hv-css")) return;
  const s = document.createElement("style"); s.id = "hv-css";
  s.textContent = `
  .hv{display:flex;flex-direction:column;gap:12px}
  .hv-cuerpo{display:flex;flex-direction:column;gap:12px}
  .hv.cerrado .hv-cuerpo{display:none}
  .hv-hd{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}
  .hv-hd h3,.hv-hd h4{margin:0;font-size:16px;font-weight:600}
  .hv-hd p{margin:2px 0 0;font-size:12.5px;color:var(--muted)}
  .hv-tog{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;border:0;background:none;padding:0;font:inherit;color:inherit;text-align:left;cursor:pointer}
  .hv-tog svg{flex:none;width:20px;height:20px;color:var(--faint);transition:transform .2s}
  .hv.cerrado .hv-tog svg{transform:rotate(-90deg)}
  .hv-seg{display:inline-grid;grid-auto-flow:column;background:var(--surface-2);border-radius:10px;padding:3px;gap:2px}
  .hv-seg button{border:0;background:none;color:var(--muted);font:inherit;font-size:12.5px;font-weight:600;padding:6px 10px;border-radius:8px;cursor:pointer}
  .hv-seg button.on{background:var(--surface);color:var(--text);box-shadow:0 1px 3px rgba(15,23,42,.12)}
  .hv-ley{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--faint);flex-wrap:wrap}
  .hv-ley i{display:inline-block;width:14px;height:10px;border-radius:2px}
  .hv-det{font-size:13px;padding:9px 12px;border-radius:10px;background:var(--surface-2);min-height:20px}
  .hv-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
  .hv-box{border:1px solid var(--border);border-radius:12px;padding:10px 12px}
  .hv-box h5{margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--faint)}
  .hv-it{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid var(--border);font-size:13px}
  .hv-it:first-of-type{border-top:0}
  .hv-it b{font-weight:600}
  .hv-it span{color:var(--muted);text-align:right}
  .hv-vacio{font-size:13px;color:var(--muted);padding:6px 0}
  .hv-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .hv-bars{position:relative;display:grid;grid-template-columns:34px 1fr;gap:6px}
  .hv-yax{position:relative;height:220px}
  .hv-yax span{position:absolute;right:0;white-space:nowrap;transform:translateY(50%);font-size:10px;color:var(--faint);font-variant-numeric:tabular-nums}
  .hv-plot{position:relative;height:220px;display:grid;grid-template-columns:repeat(24,minmax(0,1fr));gap:4px;align-items:end;border-bottom:1px solid var(--border)}
  .hv-grid{position:absolute;left:0;right:0;border-top:1px dashed var(--border);pointer-events:none}
  .hv-b{position:relative;border:0;padding:0;border-radius:5px 5px 0 0;cursor:pointer;min-width:0;width:100%;transition:opacity .15s}
  .hv-b:hover,.hv-b.sel{opacity:.82;outline:2px solid var(--text);outline-offset:1px}
  .hv-b.top{background:color-mix(in srgb,var(--green) 78%,var(--surface))}
  .hv-b.med{background:color-mix(in srgb,var(--brand) 62%,var(--surface))}
  .hv-b.baja{background:color-mix(in srgb,var(--amber) 60%,var(--surface))}
  .hv-b.min{background:var(--border-strong)}
  .hv-xax{display:grid;grid-template-columns:34px repeat(24,minmax(0,1fr));gap:0 4px;margin-top:4px}
  .hv-xax span{font-size:10px;color:var(--faint);text-align:center;white-space:nowrap}
  @media(max-width:560px){.hv-xax span:nth-child(2n+1):not(:first-child){visibility:hidden}.hv-plot{gap:2px}.hv-xax{gap:0 2px}.hv-yax,.hv-plot{height:170px}}
  .hv-ley i.top{background:color-mix(in srgb,var(--green) 78%,var(--surface))}.hv-ley i.med{background:color-mix(in srgb,var(--brand) 62%,var(--surface))}.hv-ley i.baja{background:color-mix(in srgb,var(--amber) 60%,var(--surface))}.hv-ley i.min{background:var(--border-strong)}`;
  document.head.appendChild(s);
}

// host: dónde pintar · ventas: pedidos que son venta (ya filtrados como en el Dashboard) · chats: opcional, los
// contactos nuevos del período con {primera_interaccion, stage} (si no vienen, se piden) · money: formato de plata
// plegable: clave de localStorage → el título abre y cierra el reporte (la app: arranca cerrado y se recuerda)
export async function montarHorarios(host, { supa, channelId, fromISO, toISO, ventas, chats, money, titulo = "Horarios de venta", h = "h3", plegable = null }) {
  if (!host) return;
  css();
  let abierto = !plegable || leer(plegable) === "1";
  const cab = (sub) => plegable
    ? `<button type="button" class="hv-tog" data-tog aria-expanded="${abierto}"><div class="hv-hd"><div><${h}>${esc(titulo)}</${h}><p>${sub}</p></div></div>${FLECHA}</button>`
    : `<div class="hv-hd"><div><${h}>${esc(titulo)}</${h}><p>${sub}</p></div></div>`;
  host.innerHTML = `<div class="hv${abierto ? "" : " cerrado"}">${cab("Cargando…")}</div>`;
  if (!chats) {
    chats = (await pageAll((f, t) => supa.from("contacts").select("id,primera_interaccion,stage").eq("channel_id", channelId)
      .or("source.is.null,source.neq.sim").neq("wa_id", "webchat-test").gte("primera_interaccion", fromISO).lt("primera_interaccion", toISO)
      .order("id").range(f, t))).data || [];
  }
  const vH = new Array(24).fill(0), iH = new Array(24).fill(0), cH = new Array(24).fill(0), bH = new Array(24).fill(0);
  const vD = new Array(7).fill(0), iD = new Array(7).fill(0);
  (ventas || []).filter((o) => !O.esPerdido(o)).forEach((o) => { const [d, hh] = diaHora(o.created_at); vH[hh]++; iH[hh] += O.total(o); vD[d]++; iD[d] += O.total(o); });
  chats.forEach((c) => { if (!c.primera_interaccion) return; const [, hh] = diaHora(c.primera_interaccion); cH[hh]++; if (c.stage === "comprado") bH[hh]++; });
  const st = { bm: "ventas", selH: null };
  const totalV = vH.reduce((a, x) => a + x, 0), totalC = cH.reduce((a, x) => a + x, 0);
  const m = money || ((x) => "S/ " + Math.round(x));
  // Barras «Ventas por hora del día (0–23 h)» de todas las fechas elegidas: las 3 mejores en verde, las flojas en
  // ámbar y las casi vacías en gris (como el gráfico que mandó Rodrigo).
  function barras() {
    const vals = st.bm === "ventas" ? vH : iH, max = Math.max(0, ...vals);
    if (!max) return `<div class="hv-vacio">Sin ventas en estas fechas.</div>`;
    const paso = (() => { const crudo = max / 5, p10 = Math.pow(10, Math.floor(Math.log10(crudo))); return [1, 2, 2.5, 5, 10].map((k) => k * p10).find((k) => k >= crudo) || crudo; })();
    const tope = Math.ceil(max / paso) * paso, marcas = []; for (let v = 0; v <= tope + 1e-9; v += paso) marcas.push(v);
    const top3 = [...vals].map((v, hh) => [v, hh]).filter(([v]) => v > 0).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, hh]) => hh);
    const clase = (v, hh) => (top3.includes(hh) ? "top" : v <= max * 0.15 ? "min" : v <= max * 0.45 ? "baja" : "med");
    const etq = (v) => (v >= 10000 ? (v / 1000).toLocaleString("es-PE", { maximumFractionDigits: 1 }) + "k" : Math.round(v).toLocaleString("es-PE"));   // (en ingresos, sin el «S/»: va en la leyenda)
    return `<div class="hv-bars"><div class="hv-yax">${marcas.map((v) => `<span style="bottom:${(v / tope) * 100}%">${esc(etq(v))}</span>`).join("")}</div>
      <div class="hv-plot">${marcas.slice(1).map((v) => `<i class="hv-grid" style="bottom:${(v / tope) * 100}%"></i>`).join("")}${vals.map((v, hh) => `<button type="button" class="hv-b ${clase(v, hh)}${st.selH === hh ? " sel" : ""}" data-hb="${hh}" style="height:${Math.max(v ? 1.5 : 0.6, (v / tope) * 100)}%" title="${esc(franja(hh))}: ${vH[hh]} venta${vH[hh] === 1 ? "" : "s"} · ${esc(m(iH[hh]))}" aria-label="${esc(franja(hh))}: ${vH[hh]} ventas"></button>`).join("")}</div></div>
      <div class="hv-xax"><span></span>${vals.map((_, hh) => `<span>${String(hh).padStart(2, "0")}h</span>`).join("")}</div>
      <div class="hv-ley">${st.bm === "ingresos" ? "<span>Montos en " + esc(String(m(0)).split(" ")[0]) + " ·</span>" : ""}<i class="top"></i><span>mejores horas</span><i class="med"></i><span>normal</span><i class="baja"></i><span>flojas</span><i class="min"></i><span>casi nada</span></div>`;
  }
  function pintar() {
    // Mejores horas (por ventas) y horas flojas (muchos chats, poca conversión)
    const horas = Array.from({ length: 24 }, (_, hh) => ({ hh, v: vH[hh], i: iH[hh], c: cH[hh], b: bH[hh] }));
    const mejores = horas.filter((x) => x.v > 0).sort((a, b) => b.v - a.v || b.i - a.i).slice(0, 3);
    const minC = Math.max(3, Math.round(totalC / 48));
    const flojas = horas.filter((x) => x.c >= minC).sort((a, b) => a.b / a.c - b.b / b.c || b.c - a.c).slice(0, 3);
    const mejorDia = vD.indexOf(Math.max(...vD));
    const sub = `${totalV} venta${totalV === 1 ? "" : "s"} y ${totalC} chat${totalC === 1 ? "" : "s"} nuevos en estas fechas · hora del negocio`;
    host.innerHTML = `<div class="hv${abierto ? "" : " cerrado"}">${cab(sub)}<div class="hv-cuerpo">
      ${totalV || totalC ? `<div class="hv-tools"><div class="hv-seg" role="tablist" aria-label="Qué mostrar">${[["ventas", "Ventas"], ["ingresos", "Ingresos"]].map(([k, l]) => `<button type="button" data-m="${k}" class="${st.bm === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
      ${barras()}
      <div class="hv-det" id="hvDet">${detalle()}</div>
      <div class="hv-cols">
        <div class="hv-box"><h5>Tus mejores horas</h5>${mejores.length ? mejores.map((x) => `<div class="hv-it"><b>${franja(x.hh)}</b><span>${x.v} venta${x.v === 1 ? "" : "s"} · ${m(x.i)}${x.c ? ` · ${pct(x.b, x.c)}% compró` : ""}</span></div>`).join("") : `<div class="hv-vacio">Sin ventas en estas fechas.</div>`}
          ${totalV ? `<div class="hv-it"><b>Mejor día</b><span>los ${DIAS_L[mejorDia]} · ${vD[mejorDia]} venta${vD[mejorDia] === 1 ? "" : "s"} · ${m(iD[mejorDia])}</span></div>` : ""}</div>
        <div class="hv-box"><h5>Llegan chats pero venden poco</h5>${flojas.length ? flojas.map((x) => `<div class="hv-it"><b>${franja(x.hh)}</b><span>${x.c} chats · ${x.b} compr${x.b === 1 ? "ó" : "aron"} (${pct(x.b, x.c)}%)</span></div>`).join("") : `<div class="hv-vacio">Todavía hay pocos chats para comparar horas.</div>`}</div>
      </div>` : `<div class="hv-vacio">Sin ventas ni chats nuevos en estas fechas.</div>`}
    </div></div>`;
  }
  function detalle() {
    if (st.selH == null) return "Toca una barra para ver esa hora.";
    const hh = st.selH;
    return `<b>De ${franja(hh)}</b>: ${vH[hh]} venta${vH[hh] === 1 ? "" : "s"} · ${m(iH[hh])} · ${cH[hh]} chat${cH[hh] === 1 ? "" : "s"} nuevo${cH[hh] === 1 ? "" : "s"}${cH[hh] ? ` · ${pct(bH[hh], cH[hh])}% de ellos compró` : ""}`;
  }
  host.onclick = (e) => {
    const t = e.target.closest("[data-tog]");
    if (t) { abierto = !abierto; guardar(plegable, abierto ? "1" : "0"); t.setAttribute("aria-expanded", String(abierto)); host.querySelector(".hv")?.classList.toggle("cerrado", !abierto); return; }
    const b = e.target.closest("[data-m]"); if (b) { st.bm = b.dataset.m; pintar(); return; }
    const hb = e.target.closest("[data-hb]"); if (hb) { st.selH = Number(hb.dataset.hb); host.querySelectorAll(".hv-b.sel").forEach((x) => x.classList.remove("sel")); hb.classList.add("sel"); const det = host.querySelector("#hvDet"); if (det) det.innerHTML = detalle(); }
  };
  pintar();
}
