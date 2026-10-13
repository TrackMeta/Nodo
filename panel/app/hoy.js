// «Hoy» (Resumen) en el celular: lo que espera por ti, lo cobrado y la ganancia (con su detalle), el gráfico de
// ventas, los números del Dashboard con flechas contra el período anterior, el embudo, tus anuncios y un bloque
// según el tipo de bot. Mismas consultas y la misma cuenta que dashboard.html (vista «Todo»). Se pone al día solo.
import { A, $, esc, ic, on, emit, supa, invoke, abrirHoja, hoja, toast, sol, ir } from "./app.js";
import { pageAll, getChannel, getUsdRate, factorAds, adsDeCuentasQuitadas } from "../shell.js";
import { PRESETS, computePreset, startOfDayTZ, endOfDayTZ, ymd, ymdTZ, getTZ } from "../date-range.js";
import * as O from "../orders.js";

let R = computePreset("hoy");
let _gen = 0, ULT = null;
const PEND = { pagos: 0, chats: 0, t4: 0 };
export function init() {
  on("tab", (t) => { if (t === "hoy") cargar(); });
  on("bot", () => { if (A.tab === "hoy") cargar(); });
  on("resync", () => { if (A.tab === "hoy") cargar(); });
  // Se pone al día solo cuando entra una venta o cambia un pedido (con un respiro para juntar ráfagas)
  let t = null; on("orden", () => { if (A.tab !== "hoy") return; clearTimeout(t); t = setTimeout(() => cargar(true), 4000); });
  on("pendientesPagos", (n) => { PEND.pagos = n; pintaEspera(); });
  on("pendientesChats", (n) => { PEND.chats = n; pintaEspera(); });
  on("pendientesT4", (n) => { PEND.t4 = n; pintaEspera(); });
  $("#hoyPad").addEventListener("click", clic);
}
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fDia = (d) => `${d.getDate()} ${MES[d.getMonth()]}`;
const fRango = (r) => (ymd(r.from) === ymd(r.to) ? fDia(r.to) : `${fDia(r.from)} – ${fDia(r.to)}`);
const lblDe = (r) => (r.preset === "custom" ? "Personalizado" : (PRESETS.find((p) => p[0] === r.preset) || [, "Período"])[1]);
const todo = async (mk) => (await pageAll(mk)).data || [];
const unDia = (r) => ymd(r.from) === ymd(r.to);
const horaTZ = (ts) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: getTZ(), hour: "2-digit", hour12: false }).format(new Date(ts))) % 24;

async function calcular(r, ligero) {
  const ch = A.ch, fromISO = startOfDayTZ(r.from).toISOString(), toISO = new Date(endOfDayTZ(r.to).getTime() + 1).toISOString();
  const chan = await getChannel(ch); const CUR = chan?.moneda || "PEN"; const USD = CUR === "USD" ? 1 : await getUsdRate(ch);
  const baseC = () => supa.from("contacts").select("id", { count: "exact", head: true }).eq("channel_id", ch).or("source.is.null,source.neq.sim").neq("wa_id", "webchat-test").gte("primera_interaccion", fromISO).lt("primera_interaccion", toISO);
  const [ords, prods, ins, adm, prueba, cAd, cOrg, exp, ia, conts, adsM] = await Promise.all([
    todo((f, t) => supa.from("orders").select("contact_id,product_id,version_id,amount,currency,order_bumps,estado,shipping,created_at").eq("channel_id", ch).gte("created_at", fromISO).lt("created_at", toISO).order("created_at", { ascending: false }).order("id").range(f, t)),
    supa.from("products").select("id,nombre,emoji,clase,tipo,config,product_versions(id,nombre,cantidad)").eq("channel_id", ch),
    todo((f, t) => supa.from("ads_insights").select("ad_id,fecha,gasto").eq("channel_id", ch).gte("fecha", ymd(r.from)).lte("fecha", ymd(r.to)).order("fecha", { ascending: false }).order("ad_id", { ascending: false }).range(f, t)),
    supa.from("ads_meta").select("account_currency").eq("channel_id", ch),
    todo((f, t) => supa.from("contacts").select("id").eq("channel_id", ch).or("wa_id.eq.webchat-test,source.eq.sim").order("id").range(f, t)),
    baseC().not("ad_id", "is", null),
    baseC().is("ad_id", null),
    ligero ? [] : todo((f, t) => supa.from("manual_expenses").select("id,monto").eq("channel_id", ch).gte("fecha", ymd(r.from)).lte("fecha", ymd(r.to)).order("fecha").order("id").range(f, t)),
    ligero ? [] : todo((f, t) => supa.from("ai_usage").select("dia,costo_usd").eq("channel_id", ch).gte("dia", ymd(r.from)).lte("dia", ymd(r.to)).order("dia").order("provider").order("model").order("origen").range(f, t)),
    // Los chats nuevos del período (para el embudo y los chats por anuncio)
    ligero ? [] : todo((f, t) => supa.from("contacts").select("id,ad_id,stage,etapa_previa").eq("channel_id", ch).or("source.is.null,source.neq.sim").neq("wa_id", "webchat-test").gte("primera_interaccion", fromISO).lt("primera_interaccion", toISO).order("id").range(f, t)),
    ligero ? { data: [] } : supa.from("ads_meta").select("ad_id,ad_name,campaign_name").eq("channel_id", ch),
  ]);
  const pruebaIds = new Set(prueba.map((c) => c.id));
  const todas = ords.filter((o) => !pruebaIds.has(o.contact_id) && String(o.currency || "PEN").toUpperCase() === CUR.toUpperCase());
  const orders = todas.filter(O.esVenta), ventasOk = orders.filter((o) => !O.esPerdido(o));
  let cobrado = 0, porCobrar = 0; orders.forEach((o) => { cobrado += O.cobrado(o); porCobrar += O.porCobrar(o); });
  const prodPorId = {}, cant = {};
  (prods.data || []).forEach((p) => { prodPorId[p.id] = p; (p.product_versions || []).forEach((v) => { cant[v.id] = v.cantidad ?? 1; }); });
  const fuera = await adsDeCuentasQuitadas(ch);
  const f = factorAds(adm.data || [], CUR, USD);
  const insOk = ins.filter((i) => !fuera.has(String(i.ad_id)));
  const gasto = insOk.reduce((a, i) => a + Number(i.gasto || 0) * f.factor, 0);
  // Ganancia bruta (dashboard.html): digital = cobrado − mercadería; físico = margen solo si ya se cobró todo y tiene flete
  let bruta = 0, cogs = 0, pendCobro = 0, sinCosto = 0;
  ventasOk.forEach((o) => {
    if (!O.esFisico(o)) { const cd = O.costoProducto(o, prodPorId[o.product_id], cant[o.version_id] ?? 1); bruta += O.cobrado(o) - (cd || 0); cogs += cd || 0; return; }
    if (O.cobrado(o) < O.total(o) - 0.009) { pendCobro++; return; }
    const m = O.margen(o, prodPorId[o.product_id], cant[o.version_id] ?? 1);
    if (m != null) { bruta += m; cogs += O.cobrado(o) - m; } else sinCosto++;
  });
  const perd = orders.filter(O.esPerdido);
  const fletePerd = perd.reduce((a, o) => a + (O.flete(o) || 0), 0), cobPerd = perd.reduce((a, o) => a + O.cobrado(o), 0);
  bruta += cobPerd - fletePerd; cogs += fletePerd;
  const extra = exp.reduce((a, e) => a + Number(e.monto || 0), 0), iaC = USD > 0 ? ia.reduce((a, x) => a + Number(x.costo_usd || 0), 0) * USD : 0;
  const neta = bruta - gasto - extra - iaC;
  const chatsAd = cAd.count || 0, chatsOrg = cOrg.count || 0;
  const res = { CUR, cobrado, porCobrar, ventas: ventasOk.length, gasto, bruta, cogs, extra, iaC, neta, pendCobro, sinCosto, roas: gasto > 0 ? cobrado / gasto : 0, chatsAd, chatsOrg, cpc: chatsAd ? gasto / chatsAd : 0 };
  if (ligero) return res;
  // Gráfico: cobrado por hora (un día) o por día
  const serie = new Map();
  if (unDia(r)) for (let h = 0; h < 24; h++) serie.set(h, 0);
  else { const d = new Date(r.from); while (d <= r.to) { serie.set(ymd(d), 0); d.setDate(d.getDate() + 1); } }
  ventasOk.forEach((o) => { const k = unDia(r) ? horaTZ(o.created_at) : ymdTZ(o.created_at); if (serie.has(k)) serie.set(k, serie.get(k) + O.cobrado(o)); });
  res.serie = [...serie];
  // Embudo (cohorte de los chats nuevos, como renderMetricas del Dashboard)
  const INT = ["interesado", "caliente", "confirmado"], conOrden = new Set(todas.map((o) => o.contact_id));
  res.embudo = { total: conts.length, interes: conts.filter((c) => [...INT, "comprado"].includes(c.stage) || (c.stage === "perdido" && (INT.includes(c.etapa_previa) || conOrden.has(c.id)))).length, compraron: conts.filter((c) => c.stage === "comprado").length };
  // Anuncios: gasto, chats, costo por chat, ventas y cobrado de cada uno
  const nom = new Map((adsM.data || []).map((a) => [String(a.ad_id), a]));
  const ads = new Map();
  const ad = (id) => { id = String(id); if (!ads.has(id)) ads.set(id, { id, gasto: 0, chats: 0, ventas: 0, cobrado: 0 }); return ads.get(id); };
  insOk.forEach((i) => (ad(i.ad_id).gasto += Number(i.gasto || 0) * f.factor));
  conts.forEach((c) => { if (c.ad_id) ad(c.ad_id).chats++; });
  ventasOk.forEach((o) => { const a = o.shipping?.ad_id; if (a) { const x = ad(a); x.ventas++; x.cobrado += O.cobrado(o); } });
  res.ads = [...ads.values()].filter((a) => a.gasto > 0.009 || a.ventas || a.chats).map((a) => ({ ...a, nombre: nom.get(a.id)?.ad_name || "Anuncio " + a.id.slice(-6), campana: nom.get(a.id)?.campaign_name || "" }))
    .sort((a, b) => b.cobrado - a.cobrado || b.ventas - a.ventas || b.gasto - a.gasto);
  // Por producto y, en físicos, Lima / provincia
  const porProd = new Map();
  ventasOk.forEach((o) => { const p = prodPorId[o.product_id]; const k = p ? `${p.emoji ? p.emoji + " " : ""}${p.nombre}` : "Sin producto"; const x = porProd.get(k) || { n: 0, cob: 0 }; x.n++; x.cob += O.cobrado(o); porProd.set(k, x); });
  res.porProd = [...porProd].sort((a, b) => b[1].cob - a[1].cob);
  const zona = { lima: { n: 0, cob: 0, falta: 0 }, provincia: { n: 0, cob: 0, falta: 0 } };
  ventasOk.forEach((o) => { const z = O.zonaDe(o); if (zona[z]) { zona[z].n++; zona[z].cob += O.cobrado(o); zona[z].falta += O.porCobrar(o); } });
  res.zona = zona;
  return res;
}
// Período anterior del mismo largo
function anterior(r) { const n = Math.round((r.to - r.from) / 864e5) + 1; const to = new Date(r.from); to.setDate(to.getDate() - 1); const from = new Date(to); from.setDate(from.getDate() - (n - 1)); return { from, to, preset: "prev" }; }
const flecha = (act, prev, inv) => {
  if (!prev || !isFinite(prev) || prev === 0) return `<span class="mutc">sin dato anterior</span>`;
  const d = (act - prev) / Math.abs(prev); if (Math.abs(d) < 0.005) return `<span class="mutc">igual que antes</span>`;
  return `<span class="${(d > 0) !== !!inv ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${Math.round(Math.abs(d) * 100)}% vs antes</span>`;
};

// ── «Lo que espera por ti» (se pinta con los números que ya tienen las otras pestañas) ──
function pintaEspera() {
  const box = $("#hoyEspera"); if (!box) return;
  const t4lbl = A.tipo === "fisico" ? "pedidos parados" : A.tipo === "apps" ? "accesos por vencer" : "";
  const items = [
    PEND.pagos ? `<button type="button" class="esp urg" data-ir="pagos">${ic("banknote")}<b>${PEND.pagos}</b> pago${PEND.pagos === 1 ? "" : "s"} por validar</button>` : "",
    PEND.chats ? `<button type="button" class="esp urg" data-ir="humano">${ic("user")}<b>${PEND.chats}</b> ${PEND.chats === 1 ? "pide" : "piden"} una persona</button>` : "",
    PEND.t4 && t4lbl ? `<button type="button" class="esp" data-ir="t4">${ic("clock")}<b>${PEND.t4}</b> ${t4lbl}</button>` : "",
  ].filter(Boolean);
  box.innerHTML = items.length ? `<div class="espera">${items.join("")}</div>` : `<div class="espera ok">${ic("check")} Nada espera por ustedes ahora</div>`;
}

export async function cargar(silencioso) {
  const g = ++_gen, r = R;
  if (!silencioso || !ULT) $("#hoyPad").innerHTML = cabecera(r) + `<div class="cargando">Calculando…</div>`;
  try {
    const [n, p] = await Promise.all([calcular(r), calcular(anterior(r), true)]);
    if (g !== _gen) return;
    ULT = n;
    let apps = null;
    if (A.tipo === "apps") { const x = await invoke("microapps", { channel_id: A.ch, action: "listar" }); if (x.ok) apps = x.data?.accesos || []; }
    if (g !== _gen) return;
    pintar(r, n, p, apps);
  } catch (e) { console.error(e); if (g === _gen) $("#hoyPad").innerHTML = cabecera(r) + `<div class="empty"><b>${ic("alert")}</b>No se pudo calcular.<br>${esc(e.message || e)}</div>`; }
}
function grafico(n, r) {
  const s = n.serie || [], max = Math.max(1, ...s.map((x) => x[1])), W = 300, H = 70, bw = W / Math.max(1, s.length);
  const total = s.reduce((a, x) => a + x[1], 0);
  if (!total) return `<div class="graf vacio">Sin ventas en este período</div>`;
  const barras = s.map(([k, v], i) => { const h = v ? Math.max(3, (v / max) * (H - 6)) : 1.5; return `<rect x="${(i * bw + bw * 0.15).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${v === max ? "var(--brand)" : "var(--brand-border)"}"><title>${k}: ${sol(v, n.CUR)}</title></rect>`; }).join("");
  const ini = unDia(r) ? "0 h" : fDia(r.from), fin = unDia(r) ? "23 h" : fDia(r.to);
  const top = s.reduce((a, x) => (x[1] > a[1] ? x : a), s[0]);
  const pico = unDia(r) ? `Tu mejor hora: ${top[0]}:00 – ${top[0] + 1}:00` : `Tu mejor día: ${fDia(new Date(top[0] + "T12:00"))}`;
  return `<div class="graf"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" aria-label="Cobrado ${unDia(r) ? "por hora" : "por día"}">${barras}</svg><div class="graf-ejes"><span>${ini}</span><span>${esc(pico)}</span><span>${fin}</span></div></div>`;
}
function pintar(r, n, p, apps) {
  const m = (x) => sol(x, n.CUR), chats = n.chatsAd + n.chatsOrg, chatsP = p.chatsAd + p.chatsOrg, e = n.embudo;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  let tipoHtml = "";
  if (A.tipo === "fisico") {
    const z = n.zona;
    tipoHtml = `<div class="card"><div class="ttl">Lima y provincia</div>
      <div class="li"><span class="ico">${ic("pin")}</span><span class="rmid"><b>Lima · ${z.lima.n} venta${z.lima.n === 1 ? "" : "s"}</b><span>Cobrado ${m(z.lima.cob)}${z.lima.falta > 0.009 ? ` · cobra el motorizado ${m(z.lima.falta)}` : ""}</span></span></div>
      <div class="li"><span class="ico">${ic("truck")}</span><span class="rmid"><b>Provincia · ${z.provincia.n} venta${z.provincia.n === 1 ? "" : "s"}</b><span>Cobrado ${m(z.provincia.cob)}${z.provincia.falta > 0.009 ? ` · falta cobrar ${m(z.provincia.falta)} (saldos)` : ""}</span></span></div></div>`;
  } else if (A.tipo === "apps" && apps) {
    const ahora = Date.now(), act = apps.filter((a) => a.estado === "activo"), pv = act.filter((a) => a.vence_at && new Date(a.vence_at) - ahora < 7 * 864e5).length, ven = apps.filter((a) => a.estado === "vencido").length;
    tipoHtml = `<div class="card"><div class="ttl">Tus micro apps · ahora</div>
      <div class="li"><span class="ico">${ic("key")}</span><span class="rmid"><b>${act.length} accesos activos</b><span>${act.filter((a) => a.tipo === "mensual").length} mensuales · ${act.filter((a) => a.tipo !== "mensual").length} de por vida</span></span></div>
      <button type="button" class="li" data-ir="t4"><span class="ico">${ic("clock")}</span><span class="rmid"><b>${pv} vencen esta semana · ${ven} vencidos</b><span>Toca para verlos en Accesos</span></span>${ic("chevronRight")}</button></div>`;
  }
  const prodHtml = n.porProd.length > 1 || A.tipo === "digital" ? `<div class="card"><div class="ttl">Por producto</div>${n.porProd.slice(0, 6).map(([k, x]) => `<div class="li"><span class="rmid"><b>${esc(k)}</b><span>${x.n} venta${x.n === 1 ? "" : "s"}</span></span><b class="num">${m(x.cob)}</b></div>`).join("") || `<p class="nsub" style="padding:6px 14px 12px">Sin ventas en este período.</p>`}</div>` : "";
  const adsHtml = `<div class="card"><div class="ttl">Tus anuncios · ${esc(lblDe(r).toLowerCase())}</div>${n.ads.length ? n.ads.slice(0, 8).map((a) => {
    const cpc = a.chats ? a.gasto / a.chats : null, roas = a.gasto > 0 ? a.cobrado / a.gasto : null;
    const tono = roas == null ? "" : roas >= 1.5 ? "up" : roas >= 1 ? "warnc" : "down";
    return `<div class="li ad"><span class="rmid"><b>${esc(a.nombre)}</b><span>${a.campana ? esc(a.campana) + " · " : ""}gasto ${m(a.gasto)} · ${a.chats} chat${a.chats === 1 ? "" : "s"}${cpc != null ? ` · ${m(cpc)} por chat` : ""}</span></span><span class="rend"><b class="num">${a.ventas} venta${a.ventas === 1 ? "" : "s"}</b>${roas != null ? `<span class="${tono}" style="font-size:11.5px;font-weight:600">ROAS ${roas.toFixed(2)}</span>` : ""}</span></div>`;
  }).join("") : `<p class="nsub" style="padding:6px 14px 12px">Sin gasto de anuncios en este período.</p>`}</div>`;
  $("#hoyPad").innerHTML = cabecera(r) + `<div id="hoyEspera"></div>
    <div class="hero"><small>Cobrado · ${esc(lblDe(r).toLowerCase())}</small><div class="big num">${m(n.cobrado)}</div>
      <div class="row2 num"><span>${n.ventas} venta${n.ventas === 1 ? "" : "s"}</span>${n.ventas ? `<span>Ticket ${m(n.cobrado / Math.max(1, n.ventas))}</span>` : ""}${n.porCobrar > 0.009 ? `<span>Por cobrar ${m(n.porCobrar)}</span>` : ""}</div>
      ${grafico(n, r)}</div>
    <button type="button" class="kpi gan" id="verGanancia"><small>Ganancia ${ic("help")}</small><b class="num ${n.neta >= 0 ? "up" : "down"}">${m(n.neta)}</b>${flecha(n.neta, p.neta)}<span class="mutc">Toca para ver de dónde sale</span></button>
    <div class="kpis">
      <div class="kpi"><small>Chats nuevos</small><b class="num">${chats}</b><span class="mutc">${n.chatsAd} por anuncio · ${n.chatsOrg} orgánico${n.chatsOrg === 1 ? "" : "s"}</span>${flecha(chats, chatsP)}</div>
      <div class="kpi"><small>Costo por chat</small><b class="num">${n.chatsAd ? m(n.cpc) : "—"}</b>${flecha(n.cpc, p.cpc, true)}</div>
      <div class="kpi"><small>ROAS</small><b class="num">${n.gasto > 0 ? n.roas.toFixed(2) : "—"}</b>${flecha(n.roas, p.roas)}</div>
      <div class="kpi"><small>Gasto en Meta</small><b class="num">${m(n.gasto)}</b>${flecha(n.gasto, p.gasto, true)}</div>
    </div>
    <div class="card embudo"><div class="ttl">Embudo de los chats nuevos</div>
      ${[["Chats nuevos", e.total, 100], ["Se interesaron", e.interes, pct(e.interes, e.total)], ["Compraron", e.compraron, pct(e.compraron, e.total)]].map(([l, v, p2]) => `<div class="emb"><span>${l}</span><div class="emb-bar"><i style="width:${Math.max(p2, v ? 3 : 0)}%"></i></div><b class="num">${v}${l !== "Chats nuevos" ? ` · ${p2}%` : ""}</b></div>`).join("")}
      <p class="nsub" style="padding:2px 14px 12px">De los que escribieron por primera vez en este período${e.interes ? ` · cierre: ${pct(e.compraron, e.interes)}% de los interesados` : ""}.</p></div>
    ${adsHtml}${tipoHtml}${prodHtml}
    <p class="note">Mismo cálculo que el Dashboard del panel (vista Todo) · hora del negocio · se actualiza solo.</p>`;
  pintaEspera();
}
function detalleGanancia() {
  const n = ULT; if (!n) return;
  const m = (x) => sol(x, n.CUR);
  const fila = (l, v, signo, nota) => `<div class="gfila"><span>${l}${nota ? `<small>${nota}</small>` : ""}</span><b class="num">${signo}${m(Math.abs(v))}</b></div>`;
  abrirHoja(`<h3>De dónde sale la ganancia</h3><p class="lead">${esc(lblDe(R))} · ${fRango(R)}</p>
    <div class="gcuenta">
      ${fila("Cobrado", n.cobrado, "", "lo que ya entró")}
      ${fila("Mercadería y envíos", n.cogs, "− ", "costo del producto, flete y empaque")}
      ${fila("Anuncios de Meta", n.gasto, "− ")}
      ${n.iaC > 0.009 ? fila("Costo de la IA", n.iaC, "− ") : ""}
      ${n.extra > 0.009 ? fila("Otros gastos", n.extra, "− ", "los que cargaste en el panel") : ""}
      <div class="gfila total"><span>Ganancia</span><b class="num ${n.neta >= 0 ? "up" : "down"}">${n.neta < 0 ? "− " : ""}${m(Math.abs(n.neta))}</b></div>
    </div>
    ${n.pendCobro ? `<p class="alert">${n.pendCobro} pedido${n.pendCobro === 1 ? "" : "s"} todavía no se cobra${n.pendCobro === 1 ? "" : "n"} completo: su ganancia entra cuando se cobre.</p>` : ""}
    ${n.sinCosto ? `<p class="alert">A ${n.sinCosto} pedido${n.sinCosto === 1 ? "" : "s"} le falta el costo del producto o el flete: no suman a la ganancia hasta cargarlos en el panel.</p>` : ""}`);
}
function clic(e) {
  if (e.target.closest("#dsel")) { elegirFechas(); return; }
  if (e.target.closest("#verGanancia")) { detalleGanancia(); return; }
  const b = e.target.closest("[data-ir]"); if (!b) return;
  const d = b.dataset.ir;
  if (d === "humano") { ir("chats"); emit("verHumano"); } else ir(d);
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
        const p = (v) => { const [y, mo, d] = String(v).split("-").map(Number); return new Date(y, mo - 1, d); };
        let a = p($("#dd1", sh).value), b = p($("#dd2", sh).value);
        if (isNaN(a) || isNaN(b)) { toast("Elige las dos fechas", true); return; }
        if (a > b) [a, b] = [b, a];
        R = { from: a, to: b, preset: "custom" }; cerrar(); cargar();
      };
    });
  });
}
