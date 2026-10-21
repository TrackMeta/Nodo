// «Hoy» (Resumen) en el celular: lo que espera por ti, lo cobrado y la ganancia (con su detalle), el gráfico de
// ventas, los números del Dashboard (Ventas, Publicidad y Rentabilidad), horarios, «Cómo avanzan», anuncios y un bloque
// según el tipo de bot. Mismas consultas y la misma cuenta que dashboard.html (vista «Todo»). Se pone al día solo.
import { A, $, esc, ic, on, emit, supa, invoke, abrirHoja, sol, ir, enReposo } from "./app.js";
import { pageAll, getChannel, getUsdRate, factorAds, adsDeCuentasQuitadas } from "../shell.js";
import { computePreset, startOfDayTZ, endOfDayTZ, ymd, ymdTZ, getTZ } from "../date-range.js";
import * as O from "../orders.js";
import { fDia, fRango, lblDe, botonFechas, elegirFechas } from "./fechas.js";

let R = computePreset("hoy");
let _gen = 0, ULT = null, ULT_KEY = "";
// ⚡ (14-oct) Lo último calculado se guarda (en memoria y en el celular, por bot y fechas): al entrar a Hoy se ve al
// toque y se recalcula por detrás. Sin la lista de pedidos ni de chats (pesan): Horarios espera al cálculo fresco.
const CACHE = new Map();
const clave = (r) => `${A.ch}|${ymd(r.from)}|${ymd(r.to)}|${r.preset}`;
const GKEY = () => `nodo.app.hoy.${A.uid}.${A.ch}`;
function leerGuardado(key) { try { const x = JSON.parse(localStorage.getItem(GKEY()) || "null"); return x && x.key === key ? { n: x.n, apps: x.apps, at: 0 } : null; } catch (_) { return null; } }
function guardar(key, n, apps) { const { ventasOk, conts, ...liviano } = n; try { localStorage.setItem(GKEY(), JSON.stringify({ key, n: liviano, apps })); } catch (_) { /* */ } }
const PEND = { pagos: 0, chats: 0, t4: 0 };
export function init() {
  on("tab", (t) => { if (t === "hoy") cargar(); });
  on("bot", () => { if (A.tab === "hoy") cargar(); else precalentar(); });
  on("listo", () => precalentar());
  on("resync", () => { if (A.tab === "hoy") cargar(); });
  // Se pone al día solo cuando entra una venta o cambia un pedido (con un respiro para juntar ráfagas)
  let t = null; on("orden", () => { CACHE.forEach((c) => { c.at = 0; }); if (A.tab !== "hoy") return; clearTimeout(t); t = setTimeout(() => cargar(true), 4000); });
  on("pendientesPagos", (n) => { PEND.pagos = n; pintaEspera(); });
  on("pendientesChats", (n) => { PEND.chats = n; pintaEspera(); });
  on("pendientesT4", (n) => { PEND.t4 = n; pintaEspera(); });
  $("#hoyPad").addEventListener("click", clic);
}
const todo = async (mk) => (await pageAll(mk)).data || [];
const unDia = (r) => ymd(r.from) === ymd(r.to);
const horaTZ = (ts) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: getTZ(), hour: "2-digit", hour12: false }).format(new Date(ts))) % 24;

async function calcular(r, ligero) {
  const ch = A.ch, fromISO = startOfDayTZ(r.from).toISOString(), toISO = new Date(endOfDayTZ(r.to).getTime() + 1).toISOString();
  // Moneda, tipo de cambio y cuentas de anuncios quitadas van a la par de las consultas (antes, una tras otra)
  const pFuera = adsDeCuentasQuitadas(ch);
  const chan = await getChannel(ch); const CUR = chan?.moneda || "PEN"; const pUsd = CUR === "USD" ? Promise.resolve(1) : getUsdRate(ch);
  const baseC = () => supa.from("contacts").select("id", { count: "exact", head: true }).eq("channel_id", ch).or("source.is.null,source.neq.sim").neq("wa_id", "webchat-test").gte("primera_interaccion", fromISO).lt("primera_interaccion", toISO);
  const [ords, prods, ins, adm, prueba, cAd, cOrg, exp, ia, conts, adsM, llegaron] = await Promise.all([
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
    ligero ? [] : todo((f, t) => supa.from("contacts").select("id,ad_id,stage,etapa_previa,primera_interaccion").eq("channel_id", ch).or("source.is.null,source.neq.sim").neq("wa_id", "webchat-test").gte("primera_interaccion", fromISO).lt("primera_interaccion", toISO).order("id").range(f, t)),
    ligero ? { data: [] } : supa.from("ads_meta").select("ad_id,ad_name,campaign_name").eq("channel_id", ch),
    // «Cómo avanzan»: los contactos que llegaron en estas fechas, como la página Embudo (por created_at)
    ligero ? [] : todo((f, t) => supa.from("contacts").select("id,stage,etapa_previa").eq("channel_id", ch).or("source.is.null,source.neq.sim").neq("wa_id", "webchat-test").gte("created_at", fromISO).lt("created_at", toISO).order("id").range(f, t)),
  ]);
  const pruebaIds = new Set(prueba.map((c) => c.id));
  const todas = ords.filter((o) => !pruebaIds.has(o.contact_id) && String(o.currency || "PEN").toUpperCase() === CUR.toUpperCase());
  const orders = todas.filter(O.esVenta), ventasOk = orders.filter((o) => !O.esPerdido(o));
  let cobrado = 0, porCobrar = 0; orders.forEach((o) => { cobrado += O.cobrado(o); porCobrar += O.porCobrar(o); });
  const prodPorId = {}, cant = {};
  (prods.data || []).forEach((p) => { prodPorId[p.id] = p; (p.product_versions || []).forEach((v) => { cant[v.id] = v.cantidad ?? 1; }); });
  const [fuera, USD] = await Promise.all([pFuera, pUsd]);
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
  const vendido = ventasOk.reduce((a, o) => a + O.total(o), 0);   // «Ingresos» del Dashboard
  // Lo del Dashboard (renderND): costo por venta = gasto ÷ ventas de anuncio cobradas del todo; esperando adelanto
  const vAd = ventasOk.filter((o) => o.shipping?.ad_id && (O.EST[o.estado] || {}).cobro === "todo").length;
  const espAdel = todas.filter((o) => o.estado === "esperando_adelanto").length;
  const vendeFisico = A.tipo === "fisico" || ventasOk.some(O.esFisico);
  const res = { CUR, cobrado, cpa: vAd && gasto > 0 ? gasto / vAd : null, espAdel, vendeFisico, porCobrar, vendido, fromISO, toISO, ventasOk, conts, ventas: ventasOk.length, gasto, bruta, cogs, extra, iaC, neta, pendCobro, sinCosto, roas: gasto > 0 ? cobrado / gasto : 0, chatsAd, chatsOrg, cpc: chatsAd ? gasto / chatsAd : 0 };
  if (ligero) return res;
  // Gráfico: cobrado por hora (un día) o por día
  const serie = new Map();
  if (unDia(r)) for (let h = 0; h < 24; h++) serie.set(h, 0);
  else { const d = new Date(r.from); while (d <= r.to) { serie.set(ymd(d), 0); d.setDate(d.getDate() + 1); } }
  ventasOk.forEach((o) => { const k = unDia(r) ? horaTZ(o.created_at) : ymdTZ(o.created_at); if (serie.has(k)) serie.set(k, serie.get(k) + O.total(o)); });
  res.serie = [...serie];
  // «Cómo avanzan» (la misma cuenta que funnelDe de embudo.html): el perdido CON pedido es una venta caída; el
  // perdido sin pedido cuenta en el escalón que alcanzó (etapa_previa)
  const perdidos = [...new Set([...llegaron, ...conts].filter((c) => c.stage === "perdido").map((c) => c.id))], conPedido = new Set();
  for (let i = 0; i < perdidos.length; i += 150) {
    const { data } = await supa.from("orders").select("contact_id").in("contact_id", perdidos.slice(i, i + 150));
    (data || []).forEach((o) => conPedido.add(o.contact_id));
  }
  res.funnel = funnelDe(llegaron, conPedido);
  // Cierre del bot (ndCierre del Dashboard): de los chats nuevos que conversaron de verdad, cuántos compraron
  const INT = ["interesado", "caliente", "confirmado"];
  res.cierre = { interes: conts.filter((c) => [...INT, "comprado"].includes(c.stage) || (c.stage === "perdido" && (INT.includes(c.etapa_previa) || conPedido.has(c.id)))).length, compraron: conts.filter((c) => c.stage === "comprado").length };
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
// ── «Cómo avanzan»: el embudo de la página Embudo (funnelDe + fugas de embudo.html, vista Todo) ──
const pctN = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
function funnelDe(cs, conPedido) {
  const c = { nuevo: 0, curioso: 0, interesado: 0, caliente: 0, confirmado: 0, comprado: 0, perdido: 0 };
  cs.forEach((x) => { const k = x.stage || "nuevo"; if (k in c) c[k]++; else c.nuevo++; });
  const RANGO = { curioso: 1, interesado: 2, caliente: 3, confirmado: 4 };
  let perdidoVenta = 0; const lp = [0, 0, 0, 0, 0];
  cs.forEach((x) => { if (x.stage !== "perdido") return; if (conPedido.has(x.id)) { perdidoVenta++; return; } const r = RANGO[x.etapa_previa] || 0; for (let i = 1; i <= r; i++) lp[i]++; });
  const N = { llegaron: cs.length, curiosos: c.curioso + c.interesado + c.caliente + c.confirmado + c.comprado + lp[1], interes: c.interesado + c.caliente + c.confirmado + c.comprado + lp[2], calientes: c.caliente + c.confirmado + c.comprado + lp[3], confirmaron: c.confirmado + c.comprado + lp[4], compraron: c.comprado };
  const saltos = [
    { de: "Llegaron", a: "Curiosos", arriba: N.llegaron, paso: pctN(N.curiosos, N.llegaron), tip: "Mejora el anuncio y la palabra clave." },
    { de: "Curiosos", a: "Interés", arriba: N.curiosos, paso: pctN(N.interes, N.curiosos), tip: "Mejora el mensaje inicial." },
    { de: "Interés", a: "Caliente", arriba: N.interes, paso: pctN(N.calientes, N.interes), tip: "Mejora el seguimiento." },
    { de: "Caliente", a: "Confirmaron", arriba: N.calientes, paso: pctN(N.confirmaron, N.calientes), tip: "Trabaja precio y objeciones." },
    { de: "Confirmaron", a: "Compraron", arriba: N.confirmaron, paso: pctN(N.compraron, N.confirmaron), tip: "Revisa el cobro y la entrega." },
  ];
  saltos.forEach((s, i) => { s.i = i; s.drop = s.paso == null ? null : 100 - s.paso; s.seCae = s.paso == null ? 0 : Math.round((s.arriba * s.drop) / 100); });
  // El último salto solo cuenta a los que se cayeron: un confirmado en curso no es fuga, está en camino
  const cierre = saltos[4], caidos = perdidoVenta + lp[4];
  cierre.seCae = caidos; cierre.drop = cierre.arriba > 0 ? Math.min(100, Math.round((caidos / (cierre.arriba + perdidoVenta)) * 100)) : null;
  const validos = saltos.filter((s) => s.arriba > 0 && s.drop != null);
  const peor = validos.length ? validos.reduce((a, b) => (b.seCae > a.seCae ? b : a)) : null;
  return { N, saltos, peor: peor && peor.drop > 25 && peor.seCae >= 2 ? peor : null, enCurso: c.confirmado };
}
function comoAvanzan(F) {
  if (!F || !F.N.llegaron) return `<div class="card"><div class="ttl">Cómo avanzan</div><p class="nsub" style="padding:6px 14px 12px">Nadie llegó en estas fechas.</p></div>`;
  const { N, saltos, peor, enCurso } = F;
  const niveles = [["Llegaron", N.llegaron, "llegaron"], ["Curiosos", N.curiosos, "curioso"], ["Interés", N.interes, "interesado"], ["Caliente", N.calientes, "caliente"], ["Confirmaron", N.confirmaron, "confirmado"], ["Compraron", N.compraron, "comprado"]];
  const flecha = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>`;
  let fun = "";
  niveles.forEach(([l, n, k], i) => {
    fun += `<div class="fbar f-${k}" style="width:${Math.max(66, Math.round((n / N.llegaron) * 100))}%"><span>${l}</span><b class="num">${n} · ${pctN(n, N.llegaron)}%</b></div>`;
    if (i < niveles.length - 1) { const s = saltos[i]; fun += `<div class="fpaso${peor && peor.i === i ? " peor" : ""}">${flecha}<span>${s.drop == null ? "—" : s.drop > 0 ? "−" + s.drop + "%" : "sin caída"}</span></div>`; }
  });
  const aviso = peor ? `<div class="fneck">${ic("alert")}<div><b>Mayor fuga:</b> ${peor.de} → ${peor.a}, se van ${peor.seCae} (${peor.drop}%). ${peor.tip}</div></div>`
    : `<div class="fneck ok">${ic("check")}<div>Tu embudo fluye bien.</div></div>`;
  const curso = enCurso > 0 ? `<div class="fneck ok">${ic("truck")}<div>${enCurso} ${enCurso === 1 ? "venta confirmada sigue" : "ventas confirmadas siguen"} en curso.</div></div>` : "";
  return `<div class="card"><div class="ttl">Cómo avanzan</div><div class="fwrap">${aviso}${curso}<div class="fun">${fun}</div><p class="nsub">Los que llegaron en estas fechas, como en la página Embudo.</p></div></div>`;
}

// ── «Lo que espera por ti» (se pinta con los números que ya tienen las otras pestañas) ──
function pintaEspera() {
  const box = $("#hoyEspera"); if (!box) return;
  const t4lbl = A.tipo === "fisico" ? "pedidos parados" : A.tipo === "apps" ? "accesos por vencer" : "";
  const items = [
    PEND.pagos ? `<button type="button" class="esp urg" data-ir="pagos">${ic("banknote")}<b>${PEND.pagos}</b> pago${PEND.pagos === 1 ? "" : "s"} por validar</button>` : "",
    PEND.t4 && t4lbl ? `<button type="button" class="esp" data-ir="t4">${ic("clock")}<b>${PEND.t4}</b> ${t4lbl}</button>` : "",
  ].filter(Boolean);
  box.innerHTML = items.length ? `<div class="espera">${items.join("")}</div>` : "";   // (14-oct) sin pendientes no se muestra nada
}

// Unos segundos después de abrir la app (o de cambiar de bot) Hoy se calcula por detrás: la primera visita ya es al toque
let _pc = null;
function precalentar() { clearTimeout(_pc); _pc = enReposo(() => { if (A.tab !== "hoy" && !CACHE.has(clave(R))) cargar(true); }, 5000); }
export async function cargar(silencioso) {
  const g = ++_gen, r = R, key = clave(r);
  const c = CACHE.get(key) || leerGuardado(key);
  if (c) {
    if (ULT_KEY !== key || !silencioso) { ULT = c.n; ULT_KEY = key; pintar(r, c.n, c.apps); }
    if (!silencioso && Date.now() - c.at < 20e3) return;   // recién calculado: no se repite
  } else if (!silencioso || ULT_KEY !== key) { ULT_KEY = ""; $("#hoyPad").innerHTML = cabecera(r) + `<div class="cargando">Calculando…</div>`; }
  try {
    const [n, apps] = await Promise.all([calcular(r),
      A.tipo === "apps" ? invoke("microapps", { channel_id: A.ch, action: "listar" }).then((x) => (x.ok ? x.data?.accesos || [] : null)) : null]);
    if (g !== _gen) return;
    ULT = n; ULT_KEY = key;
    CACHE.set(key, { n, apps, at: Date.now() }); guardar(key, n, apps);
    pintar(r, n, apps);
  } catch (e) { console.error(e); if (g === _gen && !c) $("#hoyPad").innerHTML = cabecera(r) + `<div class="empty"><b>${ic("alert")}</b>No se pudo calcular.<br>${esc(e.message || e)}</div>`; }
}
function grafico(n, r) {
  const s = n.serie || [], max = Math.max(1, ...s.map((x) => x[1])), W = 300, H = 70, bw = W / Math.max(1, s.length);
  const total = s.reduce((a, x) => a + x[1], 0);
  if (!total) return `<div class="graf vacio">Sin ventas en este período</div>`;
  const barras = s.map(([k, v], i) => { const h = v ? Math.max(3, (v / max) * (H - 6)) : 1.5; return `<rect x="${(i * bw + bw * 0.15).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${v === max ? "var(--grad-txt, var(--brand))" : "var(--brand-border)"}"><title>${k}: ${sol(v, n.CUR)}</title></rect>`; }).join("");
  const ini = unDia(r) ? "0 h" : fDia(r.from), fin = unDia(r) ? "23 h" : fDia(r.to);
  const top = s.reduce((a, x) => (x[1] > a[1] ? x : a), s[0]);
  const pico = unDia(r) ? `Tu mejor hora: ${top[0]}:00 – ${top[0] + 1}:00` : `Tu mejor día: ${fDia(new Date(top[0] + "T12:00"))}`;
  return `<div class="graf"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" aria-label="Cobrado ${unDia(r) ? "por hora" : "por día"}">${barras}</svg><div class="graf-ejes"><span>${ini}</span><span>${esc(pico)}</span><span>${fin}</span></div></div>`;
}
function pintar(r, n, apps) {
  const m = (x) => sol(x, n.CUR);
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
  // Igual que el Dashboard: la Ganancia neta va destacada (tarjeta de tinta) y Ventas, Ingresos y ROAS en blanco
  const pctCob = n.vendido > 0 ? Math.round((n.cobrado / n.vendido) * 100) : null;
  $("#hoyPad").innerHTML = cabecera(r) + `<div id="hoyEspera"></div>
    <button type="button" class="hero gan" id="verGanancia"><small>Ganancia neta ${ic("help")}</small><div class="big num">${m(n.neta)}</div>
      <div class="hgrid"><span><small>Ingresos</small><b class="num">${m(n.vendido)}</b></span><span><small>Anuncios</small><b class="num">${n.gasto > 0 ? m(n.gasto) : "—"}</b></span></div>
      <div class="row2"><span>tras publicidad, IA y gastos · toca para ver de dónde sale</span></div></button>
    <div class="kpis">
      <div class="kpi"><span class="kic k-azul">${ic("bolsa")}</span><small>Ventas</small><b class="num">${n.ventas}</b><span class="mutc">${n.ventas ? "ticket " + m(n.vendido / n.ventas) : "sin ventas en estas fechas"}</span></div>
      <div class="kpi"><span class="kic k-verde">${ic("banknote")}</span><small>Ingresos</small><b class="num">${m(n.vendido)}</b><span class="${pctCob === 100 ? "up" : "mutc"}">${pctCob == null ? "sin ventas" : "cobrado " + pctCob + "%"}</span></div>
      <div class="kpi"><span class="kic k-violeta">${ic("tendencia")}</span><small>ROAS</small><b class="num">${n.gasto > 0 && n.roas > 0 ? n.roas.toFixed(2) + "×" : "—"}</b><span class="mutc">${n.gasto > 0 ? m(n.gasto) + " en Meta" : "sin gasto en Meta"}</span></div>
      <div class="kpi"><span class="kic k-celeste">${ic("message")}</span><small>Costo por chat</small><b class="num">${n.chatsAd && n.gasto > 0 ? m(n.cpc) : "—"}</b><span class="mutc">${n.chatsAd} chat${n.chatsAd === 1 ? "" : "s"} de anuncio</span></div>
    </div>
    ${tablero(n, m)}
    <div class="card"><div class="ttl">Ingresos ${unDia(r) ? "por hora" : "por día"}</div><div style="padding:0 14px 12px">${grafico(n, r)}</div></div>
    <div class="card"><div style="padding:12px 14px" id="hoyHorarios"></div></div>
    ${comoAvanzan(n.funnel)}
    ${adsHtml}${tipoHtml}${prodHtml}
    <p class="note">Mismo cálculo que el Dashboard del panel (vista Todo) · hora del negocio · se actualiza solo.</p>`;
  pintaEspera();
  if (!n.ventasOk) { const hh = $("#hoyHorarios"); if (hh) hh.innerHTML = `<p class="nsub" style="margin:0">Horarios de venta · actualizando…</p>`; }
  else import("../horarios.js").then((mod) => mod.montarHorarios($("#hoyHorarios"), { supa, channelId: A.ch, fromISO: n.fromISO, toISO: n.toISO, ventas: n.ventasOk, chats: n.conts, money: m, h: "h4", plegable: "nodo.app.horarios" })).catch(() => {});
}
// Las tres tarjetas del Dashboard (renderND): Ventas, Publicidad y Rentabilidad
function tablero(n, m) {
  const fila = (l, v, cls = "") => `<div class="nrow"><span>${l}</span><b class="num ${cls}">${v}</b></div>`;
  const chats = n.chatsAd + n.chatsOrg, ci = n.cierre || { interes: 0, compraron: 0 };
  const ventas = `<div class="card"><div class="ttl">Ventas</div>` +
    fila("Chats nuevos", `${chats}<small>${n.chatsAd} anuncio · ${n.chatsOrg} orgánico${n.chatsOrg === 1 ? "" : "s"}</small>`) +
    fila("Conversión total", chats ? Math.round((n.ventas / chats) * 100) + "%" : "—") +
    fila(`Cierre del bot <i class="nia">IA</i>`, ci.interes ? `${Math.round((ci.compraron / ci.interes) * 100)}%<small>${ci.compraron} de ${ci.interes} que conversaron</small>` : "—") +
    fila("Ticket promedio", n.ventas ? m(n.vendido / n.ventas) : "—") +
    (n.vendeFisico ? fila("Por cobrar", m(n.porCobrar)) + fila("Esperando adelanto", n.espAdel) : "") + `</div>`;
  const pub = `<div class="card"><div class="ttl">Publicidad</div>` + (n.gasto > 0
    ? fila("Gasto en Meta", m(n.gasto)) + fila("Costo por chat", n.chatsAd ? m(n.cpc) : "—") + fila("Costo por venta", n.cpa == null ? "—" : m(n.cpa)) + fila("ROAS", n.roas > 0 ? n.roas.toFixed(2) + "×" : "—")
    : `<p class="nsub" style="padding:4px 14px 12px">Sin gasto de anuncios en estas fechas. Conecta tus anuncios en el panel (Ajustes → Meta) para ver cuánto te cuesta cada chat y cada venta.</p>`) + `</div>`;
  const rent = `<div class="card"><div class="ttl">Rentabilidad</div>` +
    fila(n.vendeFisico ? "Ganancia bruta" : "Ingresos cobrados", m(n.bruta)) +
    (n.gasto > 0 ? fila("− Publicidad", m(n.gasto), "down") : "") +
    (n.iaC > 0.009 ? fila("− IA", m(n.iaC), "down") : "") +
    (n.extra > 0.009 ? fila("− Gastos extra", m(n.extra), "down") : "") +
    `<div class="nrow tot"><span>= Ganancia neta</span><b class="num ${n.neta < 0 ? "down" : "up"}">${m(n.neta)}</b></div></div>`;
  return ventas + pub + rent;
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
  if (e.target.closest("[data-dsel]")) { elegirFechas(R, (r) => { R = r; cargar(); }); return; }
  if (e.target.closest("#verGanancia")) { detalleGanancia(); return; }
  const b = e.target.closest("[data-ir]"); if (!b) return;
  const d = b.dataset.ir;
  if (d === "humano") { ir("chats"); emit("verHumano"); } else ir(d);
}
function cabecera(r) {
  return `<h2 class="h">Resumen</h2>${botonFechas(r)}`;
}
