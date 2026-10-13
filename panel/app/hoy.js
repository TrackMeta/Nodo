// «Hoy» (Resumen): los números principales del Dashboard con su selector de fechas (los mismos atajos de
// date-range.js + Personalizado). Mismas consultas y la misma cuenta que dashboard.html, vista «Todo».
import { A, $, esc, ic, on, supa, abrirHoja, hoja, toast, sol } from "./app.js";
import { pageAll, getChannel, getUsdRate, factorAds, adsDeCuentasQuitadas } from "../shell.js";
import { PRESETS, computePreset, startOfDayTZ, endOfDayTZ, ymd } from "../date-range.js";
import * as O from "../orders.js";

let R = computePreset("hoy");
let _gen = 0;
export function init() {
  on("tab", (t) => { if (t === "hoy") cargar(); });
  on("bot", () => { if (A.tab === "hoy") cargar(); });
  on("resync", () => { if (A.tab === "hoy") cargar(); });
  $("#hoyPad").addEventListener("click", (e) => { if (e.target.closest("#dsel")) elegirFechas(); });
}
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fDia = (d) => `${d.getDate()} ${MES[d.getMonth()]}`;
const fRango = (r) => (ymd(r.from) === ymd(r.to) ? fDia(r.to) : `${fDia(r.from)} – ${fDia(r.to)}`);
const lblDe = (r) => (r.preset === "custom" ? "Personalizado" : (PRESETS.find((p) => p[0] === r.preset) || [, "Período"])[1]);
const todo = async (mk) => (await pageAll(mk)).data || [];

async function calcular(r, ligero) {
  const ch = A.ch, fromISO = startOfDayTZ(r.from).toISOString(), toISO = new Date(endOfDayTZ(r.to).getTime() + 1).toISOString();
  const chan = await getChannel(ch); const CUR = chan?.moneda || "PEN"; const USD = CUR === "USD" ? 1 : await getUsdRate(ch);
  const baseC = () => supa.from("contacts").select("id", { count: "exact", head: true }).eq("channel_id", ch).or("source.is.null,source.neq.sim").neq("wa_id", "webchat-test").gte("primera_interaccion", fromISO).lt("primera_interaccion", toISO);
  const [ords, prods, ins, adm, prueba, cAd, cOrg, exp, ia] = await Promise.all([
    todo((f, t) => supa.from("orders").select("contact_id,product_id,version_id,amount,currency,order_bumps,estado,shipping,created_at").eq("channel_id", ch).gte("created_at", fromISO).lt("created_at", toISO).order("created_at", { ascending: false }).order("id").range(f, t)),
    supa.from("products").select("id,nombre,clase,tipo,config,product_versions(id,nombre,cantidad)").eq("channel_id", ch),
    todo((f, t) => supa.from("ads_insights").select("ad_id,fecha,gasto").eq("channel_id", ch).gte("fecha", ymd(r.from)).lte("fecha", ymd(r.to)).order("fecha", { ascending: false }).order("ad_id", { ascending: false }).range(f, t)),
    supa.from("ads_meta").select("account_currency").eq("channel_id", ch),
    todo((f, t) => supa.from("contacts").select("id").eq("channel_id", ch).or("wa_id.eq.webchat-test,source.eq.sim").order("id").range(f, t)),
    baseC().not("ad_id", "is", null),
    baseC().is("ad_id", null),
    ligero ? Promise.resolve([]) : todo((f, t) => supa.from("manual_expenses").select("id,monto").eq("channel_id", ch).gte("fecha", ymd(r.from)).lte("fecha", ymd(r.to)).order("fecha").order("id").range(f, t)),
    ligero ? Promise.resolve([]) : todo((f, t) => supa.from("ai_usage").select("dia,costo_usd").eq("channel_id", ch).gte("dia", ymd(r.from)).lte("dia", ymd(r.to)).order("dia").order("provider").order("model").order("origen").range(f, t)),
  ]);
  const pruebaIds = new Set(prueba.map((c) => c.id));
  const todas = ords.filter((o) => !pruebaIds.has(o.contact_id) && String(o.currency || "PEN").toUpperCase() === CUR.toUpperCase());
  const orders = todas.filter(O.esVenta), ventasOk = orders.filter((o) => !O.esPerdido(o));
  let cobrado = 0, porCobrar = 0; orders.forEach((o) => { cobrado += O.cobrado(o); porCobrar += O.porCobrar(o); });
  const prodPorId = {}, cant = {};
  (prods.data || []).forEach((p) => { prodPorId[p.id] = p; (p.product_versions || []).forEach((v) => { cant[v.id] = v.cantidad ?? 1; }); });
  const fuera = await adsDeCuentasQuitadas(ch);
  const f = factorAds(adm.data || [], CUR, USD);
  const gasto = ins.filter((i) => !fuera.has(String(i.ad_id))).reduce((a, i) => a + Number(i.gasto || 0) * f.factor, 0);
  let bruta = 0;
  ventasOk.forEach((o) => {
    if (!O.esFisico(o)) { const cd = O.costoProducto(o, prodPorId[o.product_id], cant[o.version_id] ?? 1); bruta += O.cobrado(o) - (cd || 0); return; }
    if (O.cobrado(o) < O.total(o) - 0.009) return;
    const m = O.margen(o, prodPorId[o.product_id], cant[o.version_id] ?? 1); if (m != null) bruta += m;
  });
  const perd = orders.filter(O.esPerdido);
  bruta -= perd.reduce((a, o) => a + (O.flete(o) || 0), 0); bruta += perd.reduce((a, o) => a + O.cobrado(o), 0);
  const extra = exp.reduce((a, e) => a + Number(e.monto || 0), 0), iaC = USD > 0 ? ia.reduce((a, x) => a + Number(x.costo_usd || 0), 0) * USD : 0;
  const neta = bruta - gasto - extra - iaC;
  const chatsAd = cAd.count || 0, chatsOrg = cOrg.count || 0;
  let cohorte = null;
  if (!ligero) {
    const bc = (sel = "id") => supa.from("contacts").select(sel, { count: "exact", head: true }).eq("channel_id", ch).or("source.is.null,source.neq.sim").neq("wa_id", "webchat-test").gte("primera_interaccion", fromISO).lt("primera_interaccion", toISO);
    const [tAll, tBuy] = await Promise.all([bc(), bc().eq("stage", "comprado")]);
    if (!tAll.error && !tBuy.error) cohorte = { total: tAll.count || 0, compraron: tBuy.count || 0 };
  }
  return { CUR, cobrado, porCobrar, ventas: ventasOk.length, cerradas: ventasOk.filter(O.esCerrado).length, gasto, neta, roas: gasto > 0 ? cobrado / gasto : 0, chatsAd, chatsOrg, cpc: chatsAd ? gasto / chatsAd : 0, cohorte, espera: todas.filter((o) => o.estado === "esperando_adelanto").length };
}
// Período anterior del mismo largo
function anterior(r) { const n = Math.round((r.to - r.from) / 864e5) + 1; const to = new Date(r.from); to.setDate(to.getDate() - 1); const from = new Date(to); from.setDate(from.getDate() - (n - 1)); return { from, to, preset: "prev" }; }
const flecha = (act, prev, inv, fmt) => {
  if (!prev || !isFinite(prev) || prev === 0) return `<span class="mutc">—</span>`;
  const d = (act - prev) / Math.abs(prev); if (Math.abs(d) < 0.005) return `<span class="mutc">igual que antes</span>`;
  const bueno = (d > 0) !== !!inv;
  return `<span class="${bueno ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${fmt ? fmt(Math.abs(act - prev)) : Math.round(Math.abs(d) * 100) + "%"} vs antes</span>`;
};
export async function cargar() {
  const g = ++_gen, r = R;
  $("#hoyPad").innerHTML = cabecera(r) + `<div class="cargando">Calculando…</div>`;
  try {
    const [n, p] = await Promise.all([calcular(r), calcular(anterior(r), true)]);
    if (g !== _gen) return;
    const m = (x) => sol(x, n.CUR), conv = n.cohorte && n.cohorte.total ? Math.round((n.cohorte.compraron / n.cohorte.total) * 100) : null;
    const chats = n.chatsAd + n.chatsOrg, chatsP = p.chatsAd + p.chatsOrg;
    $("#hoyPad").innerHTML = cabecera(r) + `
      <div class="hero"><small>Cobrado · ${esc(lblDe(r).toLowerCase())}</small><div class="big num">${m(n.cobrado)}</div>
        <div class="row2 num"><span>${n.ventas} venta${n.ventas === 1 ? "" : "s"}</span><span>Ganancia ${m(n.neta)}</span>${n.porCobrar > 0.009 ? `<span>Por cobrar ${m(n.porCobrar)}</span>` : ""}</div></div>
      <div class="kpis">
        <div class="kpi"><small>Chats nuevos</small><b class="num">${chats}</b><span class="mutc">${n.chatsAd} por anuncio · ${n.chatsOrg} orgánico${n.chatsOrg === 1 ? "" : "s"}</span>${flecha(chats, chatsP)}</div>
        <div class="kpi"><small>Costo por chat</small><b class="num">${n.chatsAd ? m(n.cpc) : "—"}</b>${flecha(n.cpc, p.cpc, true)}</div>
        <div class="kpi"><small>Conversión total</small><b class="num">${conv != null ? conv + "%" : "—"}</b><span class="mutc">${n.cohorte ? `${n.cohorte.compraron} de ${n.cohorte.total} compraron` : ""}</span></div>
        <div class="kpi"><small>ROAS</small><b class="num">${n.gasto > 0 ? n.roas.toFixed(2) : "—"}</b>${flecha(n.roas, p.roas)}</div>
        <div class="kpi"><small>Gasto en Meta</small><b class="num">${m(n.gasto)}</b>${flecha(n.gasto, p.gasto, true)}</div>
        <div class="kpi"><small>Ventas</small><b class="num">${n.ventas}</b>${flecha(n.ventas, p.ventas)}</div>
      </div>
      <p class="note">Mismo cálculo que el Dashboard del panel (vista Todo) · hora del negocio. Las flechas comparan con el período anterior del mismo largo.</p>`;
  } catch (e) { console.error(e); if (g === _gen) $("#hoyPad").innerHTML = cabecera(r) + `<div class="empty"><b>${ic("alert")}</b>No se pudo calcular.<br>${esc(e.message || e)}</div>`; }
}
function cabecera(r) {
  return `<h2 class="h">Resumen</h2><button type="button" class="dsel" id="dsel">${ic("calendar")}<span><b>${esc(lblDe(r))}</b><small>${fRango(r)}</small></span>${ic("chevronDown")}</button>`;
}
function elegirFechas() {
  const ops = PRESETS.map((p) => { const r = computePreset(p[0]); return { t: p[1], small: p[0] === "max" ? "desde el inicio" : fRango(r), on: R.preset === p[0], v: p[0] }; });
  ops.push({ t: "Personalizado…", small: R.preset === "custom" ? fRango(R) : "elige desde y hasta", on: R.preset === "custom", v: "custom" });
  hoja("Ver datos de", ops, (o) => {
    if (o.v !== "custom") { R = computePreset(o.v); cargar(); return; }
    const hoyR = computePreset("hoy"), d7 = computePreset("7d");
    abrirHoja(`<h3>Personalizado</h3><p class="lead">Elige el primer y el último día (hora del negocio).</p>
      <div class="grid2" style="margin-bottom:10px"><label class="flabel" style="margin:0">Desde<input class="inpt" type="date" id="dd1" max="${ymd(hoyR.to)}" value="${ymd(R.preset === "custom" ? R.from : d7.from)}"></label><label class="flabel" style="margin:0">Hasta<input class="inpt" type="date" id="dd2" max="${ymd(hoyR.to)}" value="${ymd(R.preset === "custom" ? R.to : hoyR.to)}"></label></div>
      <button type="button" class="btn blue" style="width:100%" id="ddgo">Ver estos días</button>`, (sh, cerrar) => {
      $("#ddgo", sh).onclick = () => {
        const p = (v) => { const [y, m, d] = String(v).split("-").map(Number); return new Date(y, m - 1, d); };
        let a = p($("#dd1", sh).value), b = p($("#dd2", sh).value);
        if (isNaN(a) || isNaN(b)) { toast("Elige las dos fechas", true); return; }
        if (a > b) [a, b] = [b, a];
        R = { from: a, to: b, preset: "custom" }; cerrar(); cargar();
      };
    });
  });
}
