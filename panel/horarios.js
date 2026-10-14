// ═══════════════════════════════════════════════════════════════════
// Horarios de venta (13-oct, Rodrigo: «¿en qué horario vendí más?»). Lo usan el Dashboard del panel y la
// pestaña Hoy de la app de celular. Para las fechas elegidas: mapa de calor día × hora de las ventas, los
// chats nuevos o la conversión (de los que escribieron a esa hora, cuántos compraron), y en letras las
// mejores horas y las que traen chats pero no venden. Hora del negocio (date-range.js).
// ═══════════════════════════════════════════════════════════════════
import { pageAll } from "./shell.js";
import { getTZ } from "./date-range.js";
import * as O from "./orders.js";

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
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
const matriz = () => Array.from({ length: 7 }, () => new Array(24).fill(0));

function css() {
  if (document.getElementById("hv-css")) return;
  const s = document.createElement("style"); s.id = "hv-css";
  s.textContent = `
  .hv{display:flex;flex-direction:column;gap:12px}
  .hv-hd{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}
  .hv-hd h3,.hv-hd h4{margin:0;font-size:16px;font-weight:600}
  .hv-hd p{margin:2px 0 0;font-size:12.5px;color:var(--muted)}
  .hv-seg{display:inline-grid;grid-auto-flow:column;background:var(--surface-2);border-radius:10px;padding:3px;gap:2px}
  .hv-seg button{border:0;background:none;color:var(--muted);font:inherit;font-size:12.5px;font-weight:600;padding:6px 10px;border-radius:8px;cursor:pointer}
  .hv-seg button.on{background:var(--surface);color:var(--text);box-shadow:0 1px 3px rgba(15,23,42,.12)}
  .hv-mapa{display:grid;grid-template-columns:32px repeat(24,minmax(0,1fr));gap:2px;align-items:center}
  .hv-mapa .dl{font-size:11px;color:var(--muted);font-weight:600}
  .hv-mapa .hl{font-size:10px;color:var(--faint);text-align:left;white-space:nowrap;overflow:visible}
  .hv-c{aspect-ratio:1;border-radius:3px;border:0;padding:0;cursor:pointer;background:var(--surface-2);min-width:0}
  .hv-c.sel{outline:2px solid var(--text);outline-offset:1px}
  .hv-ley{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--faint)}
  .hv-ley i{display:inline-block;width:14px;height:10px;border-radius:2px}
  .hv-det{font-size:13px;padding:9px 12px;border-radius:10px;background:var(--surface-2);min-height:20px}
  .hv-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
  .hv-box{border:1px solid var(--border);border-radius:12px;padding:10px 12px}
  .hv-box h5{margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--faint)}
  .hv-it{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid var(--border);font-size:13px}
  .hv-it:first-of-type{border-top:0}
  .hv-it b{font-weight:600}
  .hv-it span{color:var(--muted);text-align:right}
  .hv-vacio{font-size:13px;color:var(--muted);padding:6px 0}`;
  document.head.appendChild(s);
}

// host: dónde pintar · ventas: pedidos que son venta (ya filtrados como en el Dashboard) · chats: opcional, los
// contactos nuevos del período con {primera_interaccion, stage} (si no vienen, se piden) · money: formato de plata
export async function montarHorarios(host, { supa, channelId, fromISO, toISO, ventas, chats, money, titulo = "Horarios de venta", h = "h3" }) {
  if (!host) return;
  css();
  host.innerHTML = `<div class="hv"><div class="hv-hd"><div><${h}>${esc(titulo)}</${h}><p>Cargando…</p></div></div></div>`;
  if (!chats) {
    chats = (await pageAll((f, t) => supa.from("contacts").select("id,primera_interaccion,stage").eq("channel_id", channelId)
      .or("source.is.null,source.neq.sim").neq("wa_id", "webchat-test").gte("primera_interaccion", fromISO).lt("primera_interaccion", toISO)
      .order("id").range(f, t))).data || [];
  }
  const V = matriz(), I = matriz(), C = matriz(), B = matriz();
  (ventas || []).filter((o) => !O.esPerdido(o)).forEach((o) => { const [d, hh] = diaHora(o.created_at); V[d][hh]++; I[d][hh] += O.total(o); });
  chats.forEach((c) => { if (!c.primera_interaccion) return; const [d, hh] = diaHora(c.primera_interaccion); C[d][hh]++; if (c.stage === "comprado") B[d][hh]++; });
  const st = { m: "ventas", sel: null };
  const totH = (M) => Array.from({ length: 24 }, (_, hh) => M.reduce((a, fila) => a + fila[hh], 0));
  const vH = totH(V), iH = totH(I), cH = totH(C), bH = totH(B);
  const vD = V.map((f) => f.reduce((a, x) => a + x, 0)), iD = I.map((f) => f.reduce((a, x) => a + x, 0));
  const totalV = vH.reduce((a, x) => a + x, 0), totalC = cH.reduce((a, x) => a + x, 0);
  const valor = (d, hh) => (st.m === "ventas" ? V[d][hh] : st.m === "chats" ? C[d][hh] : C[d][hh] >= 2 ? B[d][hh] / C[d][hh] : null);
  function pintar() {
    let max = 0; for (let d = 0; d < 7; d++) for (let hh = 0; hh < 24; hh++) { const v = valor(d, hh); if (v != null && v > max) max = v; }
    const color = (v) => (v == null || v === 0 || !max ? "var(--surface-2)" : `color-mix(in srgb, var(--brand) ${Math.round(18 + 82 * (v / max))}%, var(--surface-2))`);
    let celdas = "";
    for (let d = 0; d < 7; d++) {
      celdas += `<span class="dl">${DIAS[d]}</span>`;
      for (let hh = 0; hh < 24; hh++) {
        const v = valor(d, hh), tit = `${DIAS_L[d]} ${franja(hh)}: ${V[d][hh]} venta${V[d][hh] === 1 ? "" : "s"} · ${C[d][hh]} chat${C[d][hh] === 1 ? "" : "s"}`;
        celdas += `<button type="button" class="hv-c${st.sel && st.sel[0] === d && st.sel[1] === hh ? " sel" : ""}" data-d="${d}" data-h="${hh}" title="${esc(tit)}" aria-label="${esc(tit)}" style="background:${color(v)}"></button>`;
      }
    }
    celdas += `<span></span>` + Array.from({ length: 24 }, (_, hh) => `<span class="hl">${hh % 6 === 0 ? hora(hh).replace(" ", "") : ""}</span>`).join("");
    // Mejores horas (por ventas) y horas flojas (muchos chats, poca conversión)
    const horas = Array.from({ length: 24 }, (_, hh) => ({ hh, v: vH[hh], i: iH[hh], c: cH[hh], b: bH[hh] }));
    const mejores = horas.filter((x) => x.v > 0).sort((a, b) => b.v - a.v || b.i - a.i).slice(0, 3);
    const minC = Math.max(3, Math.round(totalC / 48));
    const flojas = horas.filter((x) => x.c >= minC).sort((a, b) => a.b / a.c - b.b / b.c || b.c - a.c).slice(0, 3);
    const mejorDia = vD.indexOf(Math.max(...vD));
    const m = money || ((x) => "S/ " + Math.round(x));
    host.innerHTML = `<div class="hv">
      <div class="hv-hd"><div><${h}>${esc(titulo)}</${h}><p>${totalV} venta${totalV === 1 ? "" : "s"} y ${totalC} chat${totalC === 1 ? "" : "s"} nuevos en estas fechas · hora del negocio</p></div>
        <div class="hv-seg" role="tablist">${[["ventas", "Ventas"], ["chats", "Chats"], ["conv", "Conversión"]].map(([k, l]) => `<button type="button" data-m="${k}" class="${st.m === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
      ${totalV || totalC ? `<div class="hv-mapa">${celdas}</div>
      <div class="hv-ley"><span>menos</span><i style="background:var(--surface-2)"></i><i style="background:color-mix(in srgb, var(--brand) 40%, var(--surface-2))"></i><i style="background:color-mix(in srgb, var(--brand) 70%, var(--surface-2))"></i><i style="background:var(--brand)"></i><span>más</span>${st.m === "conv" ? "<span>· conversión = de los que escribieron a esa hora, cuántos compraron</span>" : ""}</div>
      <div class="hv-det" id="hvDet">${detalle()}</div>
      <div class="hv-cols">
        <div class="hv-box"><h5>Tus mejores horas</h5>${mejores.length ? mejores.map((x) => `<div class="hv-it"><b>${franja(x.hh)}</b><span>${x.v} venta${x.v === 1 ? "" : "s"} · ${m(x.i)}${x.c ? ` · ${pct(x.b, x.c)}% compró` : ""}</span></div>`).join("") : `<div class="hv-vacio">Sin ventas en estas fechas.</div>`}
          ${totalV ? `<div class="hv-it"><b>Mejor día</b><span>los ${DIAS_L[mejorDia]} · ${vD[mejorDia]} venta${vD[mejorDia] === 1 ? "" : "s"} · ${m(iD[mejorDia])}</span></div>` : ""}</div>
        <div class="hv-box"><h5>Llegan chats pero venden poco</h5>${flojas.length ? flojas.map((x) => `<div class="hv-it"><b>${franja(x.hh)}</b><span>${x.c} chats · ${x.b} compr${x.b === 1 ? "ó" : "aron"} (${pct(x.b, x.c)}%)</span></div>`).join("") : `<div class="hv-vacio">Todavía hay pocos chats para comparar horas.</div>`}</div>
      </div>` : `<div class="hv-vacio">Sin ventas ni chats nuevos en estas fechas.</div>`}
    </div>`;
  }
  function detalle() {
    if (!st.sel) return "Toca un cuadrito para ver ese día y esa hora.";
    const [d, hh] = st.sel, c = C[d][hh], v = V[d][hh];
    return `<b>Los ${DIAS_L[d]} de ${franja(hh)}</b>: ${v} venta${v === 1 ? "" : "s"}${v ? ` (${(money || ((x) => "S/ " + Math.round(x)))(I[d][hh])})` : ""} · ${c} chat${c === 1 ? "" : "s"} nuevo${c === 1 ? "" : "s"}${c ? ` · ${pct(B[d][hh], c)}% de ellos compró` : ""}`;
  }
  host.onclick = (e) => {
    const b = e.target.closest("[data-m]"); if (b) { st.m = b.dataset.m; pintar(); return; }
    const c = e.target.closest(".hv-c"); if (c) { st.sel = [Number(c.dataset.d), Number(c.dataset.h)]; host.querySelectorAll(".hv-c.sel").forEach((x) => x.classList.remove("sel")); c.classList.add("sel"); const det = host.querySelector("#hvDet"); if (det) det.innerHTML = detalle(); }
  };
  pintar();
}
