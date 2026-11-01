// ═════════════════════════════════════════════════════════════════════════
// 🧭 Ángulos: un MAPA (ángulos × países) y una FICHA por ángulo (1-nov, Rodrigo: «una sola pantalla por ángulo»).
// Antes un ángulo se armaba en 4 lugares (banco de anuncios, saludo del producto, cada paso de cada secuencia y
// Rendimiento) y con versiones por país todo eso se multiplicaba sin que se viera qué faltaba. Acá:
//   · el mapa dice, por ángulo y país, si está completo o qué le falta, y cuánto cuesta cada venta;
//   · la ficha junta lo de UN ángulo en UN país: cómo le va, sus anuncios, su gancho, su saludo y su remarketing,
//     y lo copia a las otras versiones.
// No hay datos nuevos: edita lo mismo que las pantallas de siempre (tabla angulos, products.config.ad_bank, el nodo
// rotador de los mensajes iniciales, sequences.pasos[].variantes[].angulo). Lo que cambies acá se ve allá y al revés.
// El motor elige igual que antes: variante del ángulo del cliente → si no hay, la general.
// ═════════════════════════════════════════════════════════════════════════
import { supa, icon, toast, confirmDialog, askText, patchProductConfig, pageAll, getChannel } from "./shell.js";
import { waScreenHtml, waBubbles, seqBrand, subeRevSiCambio, fotoVariantes } from "./seq-editor.js?v=16";
import { gastoAdsEn, llevarAMoneda } from "./cambio.js?v=2";
import * as O from "./orders.js";

const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const uid = () => "v" + Math.random().toString(36).slice(2, 9);
const clon = (x) => JSON.parse(JSON.stringify(x));
const DIAS = 30;
const SEG = { general: "General", solo_inicio: "Curiosos", interactuo: "Interesados", caliente: "Calientes", provincia_sin_adelanto: "Provincia sin adelanto" };
const SIMB = { PEN: "S/", USD: "US$", EUR: "€", BRL: "R$", MXN: "MX$", COP: "COL$", CLP: "CLP$", ARS: "AR$" };

let S = null;   // estado de la pantalla (uno a la vez)

// host: dónde pintar. ctx: { channelId, list (productos de la grilla), paisBot, PAIS_INFO, abrirSaludo(pid,slug), abrirRemarketing(pid) }
export async function montarMapaAngulos(host, ctx) {
  const gen = (S?.gen || 0) + 1;
  S = { host, ctx, gen, vista: S?.ctx?.channelId === ctx.channelId ? (S.vista || { tipo: "mapa" }) : { tipo: "mapa" } };
  cargaCss();
  host.innerHTML = `<div class="amx"><div class="amx-empty">Cargando ángulos…</div></div>`;
  try { await cargar(gen); } catch (e) { if (gen === S.gen && S.host) S.host.innerHTML = `<div class="amx"><div class="amx-empty">No se pudieron cargar los ángulos: ${esc(e?.message || e)}</div></div>`; return; }
  if (gen !== S.gen) return;
  pinta();
}

// ── Datos ─────────────────────────────────────────────────────────────────
async function cargar(gen) {
  const { channelId, list } = S.ctx;
  const prods = (list || []).filter((p) => p.clase !== "extra" && p.clase !== "regalo");
  const desdeISO = new Date(Date.now() - DIAS * 864e5).toISOString();
  const [angR, flR, seqR, metaR, insR, ordR, conR, ch] = await Promise.all([
    supa.from("angulos").select("id,product_id,nombre,slug,ad_ids,gancho_ia,orden").eq("channel_id", channelId).order("orden"),
    supa.from("flows").select("id,product_id").eq("channel_id", channelId).eq("role", "mensajes_iniciales").eq("kind", "flow"),
    supa.from("sequences").select("id,nombre,pasos").eq("channel_id", channelId),
    pageAll((f, t) => supa.from("ads_meta").select("ad_id,ad_name,campaign_name,account_currency").eq("channel_id", channelId).order("ad_id").range(f, t)),
    pageAll((f, t) => supa.from("ads_insights").select("ad_id,fecha,gasto").eq("channel_id", channelId).gte("fecha", desdeISO.slice(0, 10)).order("fecha").order("ad_id").range(f, t)),
    pageAll((f, t) => supa.from("orders").select("id,contact_id,estado,amount,order_bumps,currency,shipping,product_id,created_at,contact:contact_id(wa_id,source)").eq("channel_id", channelId).gte("created_at", desdeISO).order("created_at").range(f, t)),
    pageAll((f, t) => supa.from("contacts").select("id,ad_id,wa_id,source").eq("channel_id", channelId).not("ad_id", "is", null).gte("created_at", desdeISO).order("created_at").range(f, t)),
    getChannel(channelId).catch(() => null),
  ]);
  if (angR.error) throw angR.error;
  const flows = flR.data || [];
  let nodos = [];
  if (flows.length) {
    const { data } = await supa.from("flow_nodes").select("id,flow_id,tipo,config,es_inicial").in("flow_id", flows.map((f) => f.id));
    nodos = data || [];
  }
  if (gen !== S.gen) return;
  S.prods = prods;
  S.angs = {};
  for (const a of angR.data || []) (S.angs[a.product_id] ||= []).push({ ...a, ad_ids: Array.isArray(a.ad_ids) ? a.ad_ids.map(String) : [] });
  S.saludo = {};
  for (const f of flows) {
    const ns = nodos.filter((n) => n.flow_id === f.id);
    const n = ns.find((x) => x.tipo === "rotador") || ns.find((x) => x.es_inicial);
    if (n && f.product_id) { n.config = n.config || {}; if (!Array.isArray(n.config.variantes)) n.config.variantes = []; S.saludo[f.product_id] = n; }
  }
  S.seqs = Object.fromEntries((seqR.data || []).map((s) => [s.id, { ...s, pasos: Array.isArray(s.pasos) ? s.pasos : [] }]));
  S.meta = Object.fromEntries((metaR.data || []).map((m) => [String(m.ad_id), m]));
  // Plata en la moneda de tus reportes (Negocio → Nombre, país y moneda), con el cambio del día de cada cosa, como Inicio.
  S.cur = ch?.moneda_reporte === "USD" ? "USD" : String(ch?.moneda || "PEN").toUpperCase();
  const ads = await gastoAdsEn(metaR.data || [], S.cur, Number(ch?.usd_rate) || 0);
  const prueba = (c) => c && (c.wa_id === "webchat-test" || c.source === "sim");
  const ord = { data: (ordR.data || []).filter((o) => !prueba(o.contact)) };
  await llevarAMoneda(ord, S.cur, O.total, null);
  const st = (S.stats = {});
  const de = (id) => (st[id] ||= { g: 0, c: 0, v: 0, i: 0 });
  for (const i of insR.data || []) de(String(i.ad_id)).g += ads.gastoEn(i);
  for (const c of conR.data || []) if (!prueba(c)) de(String(c.ad_id)).c++;
  for (const o of ord.data || []) { const a = o.shipping && o.shipping.ad_id; if (a && O.esCerrado(o)) { const x = de(String(a)); x.v++; x.i += O.total(o); } }
  S.avisoGasto = ads.aviso || "";
  S.fotoSeq = Object.fromEntries(Object.values(S.seqs).map((s) => [s.id, fotoVariantes(s.pasos)]));
  S.fotoSal = Object.fromEntries(Object.entries(S.saludo).map(([pid, n]) => [pid, fotoVariantes([{ variantes: n.config.variantes }])]));
}

// ── Ayudas del modelo ───────────────────────────────────────────────────────
const famDe = (p) => String((p.config && (p.config.familia || p.config.hermano_de)) || p.id);
const paisDe = (p) => String((p.config && p.config.pais) || S.ctx.paisBot || "PE").toUpperCase();
const paisNom = (cd) => (S.ctx.PAIS_INFO?.[cd] || [cd])[0];
const prodDe = (pid) => S.prods.find((p) => String(p.id) === String(pid));
const angsDe = (pid) => S.angs[pid] || [];
const angDe = (pid, slug) => angsDe(pid).find((a) => a.slug === slug) || null;
function bancoDe(p) {
  const cfg = Array.isArray(p?.config?.ad_bank) ? p.config.ad_bank.map(String) : [];
  return [...new Set([...cfg, ...angsDe(p.id).flatMap((a) => a.ad_ids)])];
}
const sinAngulo = (p) => { const asig = new Set(angsDe(p.id).flatMap((a) => a.ad_ids)); return bancoDe(p).filter((id) => !asig.has(id)); };
function familias() {
  const m = new Map();
  for (const p of S.prods) { const k = famDe(p); if (!m.has(k)) m.set(k, []); m.get(k).push(p); }
  const bot = String(S.ctx.paisBot || "PE").toUpperCase();
  return [...m.values()].map((ms) => ms.sort((a, b) => (paisDe(a) === bot ? -1 : paisDe(b) === bot ? 1 : paisNom(paisDe(a)).localeCompare(paisNom(paisDe(b))))));
}
const famDeProd = (pid) => familias().find((f) => f.some((p) => String(p.id) === String(pid))) || [prodDe(pid)].filter(Boolean);
// Secuencias de remarketing del producto, por audiencia (la General primero).
function seqsDe(p) {
  const c = p?.config || {}, m = c.remarketing_seqs && typeof c.remarketing_seqs === "object" ? c.remarketing_seqs : {};
  const out = [], vistos = new Set();
  const pon = (seg, id) => { if (!id || vistos.has(seg) || !S.seqs[id]) return; vistos.add(seg); out.push({ seg, seq: S.seqs[id] }); };
  pon("general", m.general || c.remarketing_seq_id);
  for (const k of Object.keys(SEG)) pon(k, m[k]);
  return out;
}
const esMsg = (paso) => paso && !paso.template_name && !paso.flow_id;
const conTexto = (v) => v && v.activo !== false && (v.bubbles || []).some((b) => b && (b.media_url || String(b.text || "").trim()));
const propiasDe = (vs, slug) => (vs || []).filter((v) => v && v.angulo === slug && conTexto(v));
const generalesDe = (vs) => (vs || []).filter((v) => v && !String(v.angulo || "").trim() && conTexto(v));
// Las burbujas «generales» de un paso: sus variantes sin ángulo, o el formato viejo (bubbles / mensaje).
function burbujasGenerales(paso) {
  const g = generalesDe(paso.variantes)[0];
  if (g) return clon(g.bubbles);
  if (Array.isArray(paso.bubbles) && paso.bubbles.length) return clon(paso.bubbles);
  if (paso.mensaje) return [{ text: String(paso.mensaje) }];
  return null;
}
function remEstado(p, slug) {
  let total = 0, propios = 0;
  for (const { seq } of seqsDe(p)) for (const paso of seq.pasos) if (esMsg(paso)) { total++; if (propiasDe(paso.variantes, slug).length) propios++; }
  return { total, propios };
}
const saludoPropio = (pid, slug) => propiasDe(S.saludo[pid]?.config?.variantes, slug).length > 0;
function statsDe(ids) {
  const r = { g: 0, c: 0, v: 0, i: 0 };
  for (const id of ids) { const x = S.stats[id]; if (x) { r.g += x.g; r.c += x.c; r.v += x.v; r.i += x.i; } }
  return r;
}
const plata = (n) => { const s = SIMB[S.cur] || S.cur + " "; return s + (s.endsWith(" ") ? "" : " ") + Number(n || 0).toLocaleString("es-PE", { maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 }); };
const nomAd = (id) => { const m = S.meta[String(id)]; return m ? (m.ad_name || m.ad_id) : String(id); };
function estadoCelda(p, a) {
  const nAds = a.ad_ids.length, rem = remEstado(p, a.slug), falta = [];
  if (!nAds) return { tono: "no", txt: "Sin anuncios", ic: "dot" };
  if (!String(a.gancho_ia || "").trim()) falta.push("gancho");
  if (!saludoPropio(p.id, a.slug)) falta.push("saludo");
  if (rem.total && rem.propios < rem.total) falta.push(`remarketing ${rem.propios} de ${rem.total}`);
  return falta.length ? { tono: "wa", txt: "Falta " + falta.join(", "), ic: "alert" } : { tono: "ok", txt: "Completo", ic: "check" };
}
// Precios escritos a mano en un texto (para avisar antes de copiar a otro país).
const RE_PRECIO = /((S\/|US\$|\$|€)\s?\d[\d.,]*\d|(S\/|US\$|\$|€)\s?\d|\b\d[\d.,]*\s?(soles?|pesos?|d[oó]lares?|euros?)\b)/i;
const textos = (vs) => (vs || []).flatMap((v) => (v.bubbles || []).map((b) => String(b.text || b.caption || "")));

// ── Pintar ────────────────────────────────────────────────────────────────
function pinta() {
  if (!S.host || !S.host.isConnected) return;
  const v = S.vista;
  if (v.tipo === "ficha" && prodDe(v.pid) && (v.slug === "" || angDe(v.pid, v.slug))) return pintaFicha(v.pid, v.slug);
  S.vista = { tipo: "mapa" };
  pintaMapa();
}
function ir(vista) { S.vista = vista; pinta(); window.scrollTo({ top: 0, behavior: "smooth" }); }

function pintaMapa() {
  const fams = familias();
  let h = `<div class="amx"><div class="amx-intro">${icon("compass")}<div><b>Ángulos</b><p>Cada fila es una idea con la que anuncias tu producto; cada columna, un país. Toca una casilla para ver y editar todo lo de ese ángulo en ese país: sus anuncios, su gancho, su saludo, su remarketing y cómo le va (últimos ${DIAS} días).</p></div></div>`;
  if (!fams.length) h += `<div class="amx-empty">Todavía no tienes productos principales. Crea uno en el Catálogo.</div>`;
  for (const ms of fams) {
    const p0 = ms[0];
    const slugs = [];
    for (const m of ms) for (const a of angsDe(m.id)) if (!slugs.some((s) => s.slug === a.slug)) slugs.push({ slug: a.slug, nombre: a.nombre });
    const multi = ms.length > 1;
    h += `<div class="amx-fam" data-fam="${esc(famDe(p0))}">
      <div class="amx-fh"><span class="amx-em">${p0.emoji ? esc(p0.emoji) : icon("box")}</span><div><b>${esc(p0.nombre)}</b><span>${multi ? `${ms.length} países` : esc(paisNom(paisDe(p0)))} · ${slugs.length} ángulo${slugs.length === 1 ? "" : "s"}</span></div></div>
      <div class="amx-tw"><table class="amx-mx"><thead><tr><th>Ángulo</th>${ms.map((m) => `<th>${esc(paisNom(paisDe(m)))}</th>`).join("")}</tr></thead><tbody>`;
    for (const s of slugs) {
      const gancho = ms.map((m) => angDe(m.id, s.slug)?.gancho_ia).find(Boolean) || "";
      h += `<tr><td class="amx-an"><b>${esc(s.nombre || s.slug)}</b>${gancho ? `<span>${esc(gancho)}</span>` : ""}</td>`;
      for (const m of ms) {
        const a = angDe(m.id, s.slug);
        if (!a) { h += `<td><button class="amx-cell no" data-crear="${esc(m.id)}" data-slug="${esc(s.slug)}"><span>${icon("plus")} Crear en ${esc(paisNom(paisDe(m)))}</span><small>Copia el de otro país</small></button></td>`; continue; }
        const e = estadoCelda(m, a), x = statsDe(a.ad_ids);
        const num = x.v ? `${plata(x.g / x.v)} por venta` : x.g ? `${plata(x.g)} sin ventas` : "";
        h += `<td><button class="amx-cell ${e.tono}" data-pid="${esc(m.id)}" data-slug="${esc(s.slug)}"><span>${icon(e.ic)} ${esc(e.txt)}</span><small>${a.ad_ids.length} anuncio${a.ad_ids.length === 1 ? "" : "s"}${num ? " · " + num : ""}</small></button></td>`;
      }
      h += `</tr>`;
    }
    h += `<tr class="amx-sin"><td class="amx-an"><span>Sin ángulo</span><span>Llegan al producto con el saludo general</span></td>`;
    for (const m of ms) { const n = sinAngulo(m).length; h += `<td><button class="amx-cell sin" data-pid="${esc(m.id)}" data-slug=""><small>${n ? `${n} anuncio${n === 1 ? "" : "s"} · asignar` : "Agregar anuncios"}</small></button></td>`; }
    h += `</tr></tbody></table></div>
      <button class="amx-btn" data-nuevo="${esc(famDe(p0))}">${icon("plus")} Ángulo</button></div>`;
  }
  h += `</div>`;
  S.host.innerHTML = h;
  S.host.querySelectorAll("[data-pid]").forEach((b) => (b.onclick = () => ir({ tipo: "ficha", pid: b.dataset.pid, slug: b.dataset.slug })));
  S.host.querySelectorAll("[data-crear]").forEach((b) => (b.onclick = () => crearEnPais(b.dataset.crear, b.dataset.slug)));
  S.host.querySelectorAll("[data-nuevo]").forEach((b) => (b.onclick = () => nuevoAngulo(familias().find((f) => famDe(f[0]) === b.dataset.nuevo) || [])));
}

function pintaFicha(pid, slug) {
  const p = prodDe(pid), a = slug ? angDe(pid, slug) : null, fam = famDeProd(pid), pais = paisDe(p);
  const otros = fam.filter((m) => String(m.id) !== String(pid));
  const ids = a ? a.ad_ids : sinAngulo(p);
  const x = statsDe(ids), rem = a ? remEstado(p, slug) : null;
  const chip = (ok, txt) => `<span class="amx-chip ${ok ? "ok" : "wa"}">${ok ? icon("check") : ""}${esc(txt)}</span>`;
  let h = `<div class="amx"><button class="amx-back" data-volver>${icon("chevronLeft")} Volver al mapa</button>
    <div class="amx-card amx-head"><div style="flex:1;min-width:0"><h2>${a ? esc(a.nombre || a.slug) : "Anuncios sin ángulo"}</h2>
      <p>${esc(p.nombre)} · <b>${esc(paisNom(pais))}</b></p></div>
      ${otros.length && a ? `<div class="amx-paises">${fam.map((m) => { const tiene = !!angDe(m.id, slug); return `<button class="amx-pais ${String(m.id) === String(pid) ? "on" : ""}" ${tiene ? `data-ir="${esc(m.id)}"` : "disabled title=\"Este ángulo no existe en ese país\""}>${esc(paisNom(paisDe(m)))}</button>`; }).join("")}</div>` : ""}
    </div>`;
  if (a) h += `<div class="amx-chips">${chip(a.ad_ids.length, `Anuncios ${a.ad_ids.length}`)}${chip(String(a.gancho_ia || "").trim(), "Gancho")}${chip(saludoPropio(pid, slug), "Saludo propio")}${rem.total ? chip(rem.propios === rem.total, `Remarketing ${rem.propios}/${rem.total}`) : ""}</div>`;
  // 1) Cómo le va
  h += `<div class="amx-card"><h3>${icon("rendimiento")} Cómo le va <span>· últimos ${DIAS} días · en ${esc(S.cur)}</span></h3>
    <div class="amx-kpi"><div><b>${plata(x.g)}</b><span>Gasto en anuncios</span></div><div><b>${x.c}</b><span>Conversaciones</span></div><div><b>${x.v}</b><span>Ventas</span></div>
      <div><b>${x.v ? plata(x.g / x.v) : "—"}</b><span>Por venta</span></div><div><b>${x.c ? Math.round((x.v / x.c) * 100) + " %" : "—"}</b><span>Cierra</span></div></div>
    ${S.avisoGasto && x.g ? `<p class="amx-help">${icon("alert")} El gasto puede no estar convertido: ${esc(S.avisoGasto)}.</p>` : ""}
    <p class="amx-help">Ventas cobradas de clientes que llegaron por estos anuncios. <a href="rendimiento.html">Ver en Rendimiento →</a></p></div>`;
  // 2) Anuncios
  h += `<div class="amx-card" id="amxAds"></div>`;
  if (a) {
    // 3) Nombre y gancho
    // Con el violeta/rosa de la IA (como «Gancho para la IA» en el producto): es lo que lee la IA, no un dato del cliente.
    h += `<div class="amx-card amx-ia"><h3><span class="amx-iagl">${icon("robot")}</span><span class="amx-iatt">Nombre y gancho para la IA</span></h3>
      <label class="amx-lbl">Nombre del ángulo</label><input class="amx-in" id="amxNom" value="${esc(a.nombre || "")}" maxlength="60"/>
      <label class="amx-lbl">Gancho para la IA <span>· desde qué idea le vende a este cliente</span></label>
      <input class="amx-in" id="amxGan" value="${esc(a.gancho_ia || "")}" placeholder="Ej. vino por un anuncio sobre bajar la barriga en 21 días"/>
      <div class="amx-acts"><button class="amx-btn ia" id="amxGanG">Guardar</button></div></div>`;
    h += `<div class="amx-card" id="amxSal"></div><div class="amx-card" id="amxRem"></div>`;
    if (otros.length) h += `<div class="amx-card"><h3>${icon("copy")} Copiar a otros países</h3>
      <p class="amx-help">Lleva el nombre, el gancho, el saludo y el remarketing de este ángulo a ${otros.map((m) => esc(paisNom(paisDe(m)))).join(" y ")}. Reemplaza lo que ese ángulo tenga allá. Los anuncios y los precios no se copian.</p>
      <div class="amx-acts"><button class="amx-btn" id="amxCopiar">${icon("copy")} Copiar a ${otros.length === 1 ? esc(paisNom(paisDe(otros[0]))) : "los otros países"}</button></div></div>`;
    h += `<div class="amx-acts" style="justify-content:flex-start;margin-top:4px"><button class="amx-link dang" id="amxDel">${icon("trash")} Eliminar este ángulo en ${esc(paisNom(pais))}</button></div>`;
  }
  h += `</div>`;
  S.host.innerHTML = h;
  S.host.querySelector("[data-volver]").onclick = () => ir({ tipo: "mapa" });
  S.host.querySelectorAll("[data-ir]").forEach((b) => (b.onclick = () => ir({ tipo: "ficha", pid: b.dataset.ir, slug })));
  pintaAds(p, a);
  if (!a) return;
  pintaSaludo(p, a);
  pintaRem(p, a);
  document.getElementById("amxGanG").onclick = (e) => guardarAngulo(e.currentTarget, a);
  const cp = document.getElementById("amxCopiar"); if (cp) cp.onclick = (e) => copiarAOtros(e.currentTarget, p, a, otros);
  document.getElementById("amxDel").onclick = () => eliminarAngulo(p, a);
}

// ── Anuncios ──────────────────────────────────────────────────────────────
function pintaAds(p, a) {
  const box = document.getElementById("amxAds"); if (!box) return;
  const pais = paisDe(p), ids = a ? a.ad_ids : sinAngulo(p), sueltos = a ? sinAngulo(p) : [];
  const enOtro = new Map();
  for (const q of S.prods) if (String(q.id) !== String(p.id)) for (const id of bancoDe(q)) enOtro.set(id, q);
  const enEste = new Set(bancoDe(p));
  const libres = Object.values(S.meta).filter((m) => !enEste.has(String(m.ad_id)) && !enOtro.has(String(m.ad_id)));
  // Sugeridos: nombran el producto y, si hay versiones por país, son de este país (sin país → el del bot).
  const multi = famDeProd(p.id).length > 1, w = norm(p.nombre).split(/\s+/).find((x) => x.length >= 4) || norm(p.nombre);
  const sug = libres.filter((m) => { const t = norm((m.ad_name || "") + " " + (m.campaign_name || "")); return w && t.includes(w) && (!multi || (paisDeAd(m) || String(S.ctx.paisBot || "PE").toUpperCase()) === pais); });
  const resto = libres.filter((m) => !sug.includes(m));
  const opt = (m) => `<option value="${esc(m.ad_id)}">${esc(m.ad_name || m.ad_id)}${m.campaign_name ? " · " + esc(m.campaign_name) : ""}</option>`;
  box.innerHTML = `<h3>${icon("megaphone")} Anuncios de ${esc(paisNom(pais))}</h3>
    <p class="amx-help">${a ? `Quien toque uno de estos anuncios cae en la versión de <b>${esc(paisNom(pais))}</b> y recibe el saludo y el gancho de este ángulo.` : `Llegan a la versión de <b>${esc(paisNom(pais))}</b> con el saludo general. Asígnales un ángulo para que el saludo retome el anuncio.`}</p>
    ${ids.length ? ids.map((id) => `<div class="amx-row"><span class="amx-rt">${esc(nomAd(id))}<small>${esc(id)}</small></span>
      ${a ? `<button class="amx-ib" data-suelta="${esc(id)}" title="Quitar de este ángulo (sigue llegando con el saludo general)">${icon("x")}</button>`
          : `<select class="amx-sel" data-asig="${esc(id)}"><option value="">Asignar a…</option>${angsDe(p.id).map((x) => `<option value="${esc(x.slug)}">${esc(x.nombre || x.slug)}</option>`).join("")}</select>`}
      <button class="amx-ib" data-saca="${esc(id)}" title="Sacar de ${esc(paisNom(pais))} (deja de llevar a este producto)">${icon("trash")}</button></div>`).join("")
      : `<div class="amx-emptyrow">${a ? "Este ángulo no tiene anuncios: nadie llega por aquí." : "No hay anuncios sin ángulo."}</div>`}
    ${sueltos.length ? `<div class="amx-sub">Sin ángulo en ${esc(paisNom(pais))}</div>${sueltos.map((id) => `<div class="amx-row soft"><span class="amx-rt">${esc(nomAd(id))}<small>${esc(id)}</small></span><button class="amx-btn sm" data-mover="${esc(id)}">Mover aquí</button></div>`).join("")}` : ""}
    <div class="amx-add">
      ${libres.length ? `<select class="amx-sel" id="amxAddSel"><option value="">＋ Elegir un anuncio de Meta…</option>${sug.length ? `<optgroup label="Sugeridos para ${esc(paisNom(pais))}">${sug.map(opt).join("")}</optgroup>` : ""}${resto.length ? `<optgroup label="${sug.length ? "Otros" : "Anuncios de Meta"}">${resto.map(opt).join("")}</optgroup>` : ""}</select>` : ""}
      <input class="amx-in" id="amxAddId" placeholder="…o pega el ID del anuncio" inputmode="numeric"/>
      <button class="amx-btn" id="amxAddBtn">Agregar</button>
    </div>
    <p class="amx-help">El ID está en el Administrador de anuncios de Meta, columna «Identificador del anuncio». Un anuncio va en un solo país y un solo ángulo.</p>`;
  const slug = a ? a.slug : "";
  box.querySelectorAll("[data-suelta]").forEach((b) => (b.onclick = () => moverAd(p, b.dataset.suelta, "")));
  box.querySelectorAll("[data-mover]").forEach((b) => (b.onclick = () => moverAd(p, b.dataset.mover, slug)));
  box.querySelectorAll("[data-asig]").forEach((s) => (s.onchange = () => s.value && moverAd(p, s.dataset.asig, s.value)));
  box.querySelectorAll("[data-saca]").forEach((b) => (b.onclick = () => sacarAd(p, b.dataset.saca)));
  const add = () => { const v = String(document.getElementById("amxAddId").value || document.getElementById("amxAddSel")?.value || "").trim(); if (v) agregarAd(p, v, slug); };
  document.getElementById("amxAddBtn").onclick = add;
  document.getElementById("amxAddId").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } };
  const sel = document.getElementById("amxAddSel"); if (sel) sel.onchange = () => sel.value && agregarAd(p, sel.value, slug);
}
let _paisRe = null;
function paisDeAd(m) {
  _paisRe ||= Object.entries(S.ctx.PAIS_INFO || {}).map(([cd, [nm]]) => [cd, new RegExp("\\b" + norm(nm).replace(/\./g, "\\.") + "\\b")]);
  const t = norm((m.ad_name || "") + " " + (m.campaign_name || ""));
  const x = _paisRe.find(([, re]) => re.test(t)); return x ? x[0] : null;
}
// Escribe el banco (config.ad_bank, la fuente de ruteo) y los ad_ids de los ángulos del producto.
async function escribeAds(p, bancoNuevo, angCambiados) {
  for (const a of angCambiados) { const { error } = await supa.from("angulos").update({ ad_ids: a.ad_ids }).eq("id", a.id); if (error) throw error; }
  const r = await patchProductConfig(p.id, (cfg) => { cfg.ad_bank = bancoNuevo; });
  if (!r.ok) throw r.error || new Error("No se pudo guardar");
  p.config = r.config;
}
async function moverAd(p, id, slug) {
  try {
    const cambiados = [];
    for (const a of angsDe(p.id)) {
      const tenia = a.ad_ids.includes(id), debe = a.slug === slug;
      if (tenia && !debe) { a.ad_ids = a.ad_ids.filter((x) => x !== id); cambiados.push(a); }
      if (!tenia && debe) { a.ad_ids = [...a.ad_ids, id]; cambiados.push(a); }
    }
    await escribeAds(p, [...new Set([...bancoDe(p), id])], cambiados);
    toast(slug ? `Anuncio asignado a «${angDe(p.id, slug)?.nombre || slug}»` : "Anuncio sin ángulo: llega con el saludo general");
  } catch (e) { toast(e.message || "No se pudo guardar", true); }
  pinta();
}
async function sacarAd(p, id) {
  if (!(await confirmDialog({ title: "Sacar el anuncio", message: `Quien toque «${nomAd(id)}» ya no va a llegar a ${p.nombre} (${paisNom(paisDe(p))}) por el anuncio. Puedes volver a agregarlo cuando quieras.`, confirmText: "Sacar", danger: true }))) return;
  try {
    const cambiados = angsDe(p.id).filter((a) => a.ad_ids.includes(id));
    cambiados.forEach((a) => (a.ad_ids = a.ad_ids.filter((x) => x !== id)));
    await escribeAds(p, bancoDe(p).filter((x) => x !== id), cambiados);
    toast("Anuncio sacado");
  } catch (e) { toast(e.message || "No se pudo guardar", true); }
  pinta();
}
async function agregarAd(p, id, slug) {
  id = String(id).trim();
  if (!/^\d{6,}$/.test(id)) { toast("El ID del anuncio son solo números (está en Meta, columna «Identificador del anuncio»)", true); return; }
  const otro = S.prods.find((q) => String(q.id) !== String(p.id) && bancoDe(q).includes(id));
  if (otro) { toast(`Ese anuncio ya está en ${otro.nombre} (${paisNom(paisDe(otro))}). Sácalo de ahí primero.`, true); return; }
  if (bancoDe(p).includes(id) && (slug ? angDe(p.id, slug)?.ad_ids.includes(id) : true)) { toast("Ese anuncio ya está aquí", true); return; }
  await moverAd(p, id, slug);
}

// ── Nombre y gancho ───────────────────────────────────────────────────────
async function guardarAngulo(btn, a) {
  const nombre = document.getElementById("amxNom").value.trim(), gancho = document.getElementById("amxGan").value.trim();
  if (!nombre) { toast("Ponle un nombre al ángulo", true); return; }
  btn.disabled = true;
  const { error } = await supa.from("angulos").update({ nombre, gancho_ia: gancho || null }).eq("id", a.id);
  btn.disabled = false;
  if (error) { toast(error.message, true); return; }
  a.nombre = nombre; a.gancho_ia = gancho || null;
  toast("Guardado"); pinta();
}

// ── Editor de burbujas de texto (las de imagen/video se ven, pero se cambian en el editor completo) ──
function burbujasHtml(v, key) {
  return (v.bubbles || []).map((b, bi) => b.media_url
    ? `<div class="amx-media">${icon(b.media_kind === "video" ? "video" : b.media_kind === "audio" ? "mic" : b.media_kind === "document" ? "file" : "image")} ${esc(b.media_kind === "video" ? "Video" : b.media_kind === "audio" ? "Audio" : b.media_kind === "document" ? "Archivo" : "Imagen")}${String(b.text || b.caption || "").trim() ? ` · <i>${esc(String(b.text || b.caption).slice(0, 80))}</i>` : ""}</div>`
    : `<textarea class="amx-ta" data-k="${esc(key)}" data-bi="${bi}" rows="3">${esc(b.text || "")}</textarea>`).join("");
}
function leeBurbujas(box, key, v) {
  box.querySelectorAll(`textarea[data-k="${key}"]`).forEach((t) => { const b = v.bubbles[+t.dataset.bi]; if (b && !b.media_url) b.text = t.value; });
  v.bubbles = (v.bubbles || []).filter((b) => b.media_url || String(b.text || "").trim());
}
// {{precio}} con el precio real de la versión (solo el número, como lo reemplaza el bot).
let _precioPrev = "100";
const prevSmp = (t) => String(t || "").replace(/\{\{\s*nombre\s*\}\}/gi, "Ana").replace(/\{\{\s*precio\s*\}\}/gi, _precioPrev).replace(/\{\{[^}]*\}\}/g, "…");
let _marca = {};
const vistaWa = (v) => waScreenHtml({ title: _marca.nombre, logoUrl: _marca.logo_url, bubblesHtml: waBubbles((v && v.bubbles) || [], prevSmp), empty: "Sin mensajes" });

// ── Saludo ────────────────────────────────────────────────────────────────
function pintaSaludo(p, a) {
  const box = document.getElementById("amxSal"); if (!box) return;
  const pv = (p.product_versions || []).find((v) => v.activo !== false && v.precio != null && v.precio !== ""); _precioPrev = String(pv ? pv.precio : 100);
  const nodo = S.saludo[p.id];
  const editor = `<button class="amx-link" data-full>${icon("edit")} Editor completo (imágenes, botones, varias versiones)</button>`;
  if (!nodo) {
    box.innerHTML = `<h3>${icon("message")} Saludo</h3><p class="amx-help">Este producto todavía no tiene mensajes iniciales.</p><div class="amx-acts" style="justify-content:flex-start">${editor}</div>`;
    box.querySelector("[data-full]").onclick = () => S.ctx.abrirSaludo(p.id, a.slug);
    return;
  }
  const vs = nodo.config.variantes, propias = propiasDe(vs, a.slug);
  if (!propias.length) {
    const gen = generalesDe(vs)[0];
    const deOtro = famDeProd(p.id).filter((m) => String(m.id) !== String(p.id) && propiasDe(S.saludo[m.id]?.config?.variantes, a.slug).length);
    // (1-nov, Rodrigo: «saludo es muy grande») La vista de WhatsApp del general medía ~2000 px: ahora va plegada.
    const nGen = (gen?.bubbles || []).length;
    box.innerHTML = `<h3>${icon("message")} Saludo</h3>
      <div class="amx-warnrow">${icon("alert")} Usa el saludo general: no retoma la idea de este anuncio.</div>
      <div class="amx-acts" style="justify-content:flex-start">${gen ? `<button class="amx-btn pri" data-desde="gen">${icon("plus")} Crear desde el general</button>` : `<button class="amx-btn pri" data-desde="vacio">${icon("plus")} Escribir uno</button>`}
        ${deOtro.map((m) => `<button class="amx-btn" data-desde="${esc(m.id)}">${icon("copy")} Copiar el de ${esc(paisNom(paisDe(m)))}</button>`).join("")}${editor}</div>
      ${gen ? `<details class="amx-det"${S.verPrev ? " open" : ""}><summary>${icon("eye")} Ver el saludo general <span>· ${nGen} mensaje${nGen === 1 ? "" : "s"}</span></summary><div class="amx-prevbox">${vistaWa(gen)}</div></details>` : ""}`;
    box.querySelectorAll("[data-desde]").forEach((b) => (b.onclick = () => crearSaludo(p, a, b.dataset.desde)));
  } else {
    box.innerHTML = `<h3>${icon("message")} Saludo de este ángulo</h3>
      ${propias.map((v, i) => `<div class="amx-var" data-vi="${i}">${propias.length > 1 ? `<div class="amx-sub" style="margin-top:0">${esc(v.nombre || "Versión " + (i + 1))} <span>· el bot las rota</span></div>` : ""}${burbujasHtml(v, "s" + i)}
        <details class="amx-det"${S.verPrev ? " open" : ""}><summary>${icon("eye")} Ver cómo le llega</summary><div class="amx-prevbox amx-prev">${vistaWa(v)}</div></details></div>`).join("")}
      <div class="amx-acts"><button class="amx-link" data-quitar>${icon("x")} Volver al general</button>${editor}<button class="amx-btn pri" data-guardar>Guardar saludo</button></div>`;
    box.querySelectorAll("textarea").forEach((t) => (t.oninput = () => { const i = +t.dataset.k.slice(1), v = clon(propias[i]); leeBurbujas(box, t.dataset.k, v); const pv = box.querySelector(`[data-vi="${i}"] .amx-prev`); if (pv) pv.innerHTML = vistaWa(v); }));
    box.querySelector("[data-guardar]").onclick = async (e) => {
      propias.forEach((v, i) => leeBurbujas(box, "s" + i, v));
      if (propias.some((v) => !v.bubbles.length)) { toast("El saludo no puede quedar vacío", true); return; }
      await guardarSaludo(p.id, e.currentTarget) && toast("Saludo guardado");
      pinta();
    };
    box.querySelector("[data-quitar]").onclick = async () => {
      if (!(await confirmDialog({ title: "Volver al saludo general", message: "Se borra el saludo propio de este ángulo y sus clientes reciben el general.", confirmText: "Volver al general", danger: true }))) return;
      nodo.config.variantes = vs.filter((v) => v.angulo !== a.slug);
      await guardarSaludo(p.id) && toast("Ahora usa el saludo general");
      pinta();
    };
  }
  box.querySelector("[data-full]").onclick = () => S.ctx.abrirSaludo(p.id, a.slug);
  box.querySelectorAll(".amx-det").forEach((d) => d.addEventListener("toggle", () => { S.verPrev = d.open; }));   // abierta o cerrada, igual al volver a pintar
  seqBrand(S.ctx.channelId).then((b) => { if (b && b.nombre !== _marca.nombre) { _marca = b; if (S.vista.tipo === "ficha") pintaSaludo(p, a); } }).catch(() => {});
}
async function crearSaludo(p, a, desde) {
  const nodo = S.saludo[p.id]; let bubbles;
  if (desde === "gen") bubbles = clon(generalesDe(nodo.config.variantes)[0]?.bubbles || [{ text: "" }]);
  else if (desde === "vacio") bubbles = [{ text: "" }];
  else {
    const src = propiasDe(S.saludo[desde]?.config?.variantes, a.slug);
    if (src.some((v) => textos([v]).some((t) => RE_PRECIO.test(t))) && !(await confirmDialog({ title: "Tiene precios escritos", message: `El saludo de ${paisNom(paisDe(prodDe(desde)))} nombra un precio en su moneda. Se copia igual: cámbialo a la de ${paisNom(paisDe(p))} antes de guardar.`, confirmText: "Copiar igual" }))) return;
    nodo.config.variantes = nodo.config.variantes.filter((v) => v.angulo !== a.slug).concat(src.map((v) => ({ ...clon(v), id: uid(), rev: 1, angulo: a.slug })));
    if (await guardarSaludo(p.id)) toast("Saludo copiado: revísalo y guarda si cambias algo");
    pinta(); return;
  }
  nodo.config.variantes.push({ id: uid(), rev: 1, nombre: "Versión A", activo: true, peso: 1, angulo: a.slug, bubbles });
  if (desde === "vacio") { pinta(); return; }   // vacío: se guarda cuando lo escriba
  if (await guardarSaludo(p.id)) toast("Saludo creado desde el general: ahora cámbialo para que retome el anuncio");
  pinta();
}
async function guardarSaludo(pid, btn) {
  const nodo = S.saludo[pid]; if (!nodo) return false;
  nodo.config.variantes = nodo.config.variantes.filter((v) => v.angulo == null || v.angulo === "" || (v.bubbles || []).some((b) => b.media_url || String(b.text || "").trim()));
  subeRevSiCambio([{ variantes: nodo.config.variantes }], S.fotoSal[pid]);
  if (btn) btn.disabled = true;
  const { error } = await supa.from("flow_nodes").update({ config: nodo.config }).eq("id", nodo.id);
  if (btn) btn.disabled = false;
  if (error) { toast("No se pudo guardar el saludo: " + error.message, true); return false; }
  S.fotoSal[pid] = fotoVariantes([{ variantes: nodo.config.variantes }]);
  return true;
}

// ── Remarketing ───────────────────────────────────────────────────────────
function espera(seq, i) {
  const s = seq.pasos.slice(0, i + 1).reduce((t, p) => t + Math.max(0, Number(p.umbral_silencio_seg || 0)), 0);
  if (s >= 86400) { const d = Math.round(s / 86400); return d === 1 ? "1 día" : d + " días"; }
  if (s >= 3600) { const h = Math.round(s / 3600); return h === 1 ? "1 hora" : h + " horas"; }
  return Math.max(1, Math.round(s / 60)) + " min";
}
function pintaRem(p, a) {
  const box = document.getElementById("amxRem"); if (!box) return;
  const seqs = seqsDe(p);
  const full = `<button class="amx-link" data-full>${icon("edit")} Editor completo</button>`;
  if (!seqs.length) {
    box.innerHTML = `<h3>${icon("secuencias")} Remarketing</h3><p class="amx-help">Este producto no tiene secuencia de remarketing.</p><div class="amx-acts" style="justify-content:flex-start">${full}</div>`;
    box.querySelector("[data-full]").onclick = () => S.ctx.abrirRemarketing(p.id);
    return;
  }
  let h = `<h3>${icon("secuencias")} Remarketing de este ángulo</h3><p class="amx-help">A quien llegó por este ángulo y no compró. «Propio» = un mensaje que retoma este anuncio; «general» = el mismo para todos.</p>`;
  for (const { seg, seq } of seqs) {
    if (seqs.length > 1) h += `<div class="amx-sub">${esc(SEG[seg] || seg)} <span>· ${esc(seq.nombre || "")}</span></div>`;
    seq.pasos.forEach((paso, i) => {
      const k = `${seq.id}:${i}`;
      if (!esMsg(paso)) { h += `<div class="amx-step"><div class="amx-sh"><b>Toque ${i + 1}</b><span>· ${espera(seq, i)}</span><span class="amx-chip">${paso.template_name ? "plantilla" : "flujo"}</span></div><p class="amx-help" style="margin:0">Igual para todos los ángulos.</p></div>`; return; }
      const own = propiasDe(paso.variantes, a.slug)[0];
      if (own) h += `<div class="amx-step"><div class="amx-sh"><b>Toque ${i + 1}</b><span>· ${espera(seq, i)}</span><span class="amx-chip ok">propio</span></div>${burbujasHtml(own, k)}
          <div class="amx-acts"><button class="amx-link" data-gen="${k}">${icon("x")} Usar el general</button><button class="amx-btn pri sm" data-gpaso="${k}">Guardar</button></div></div>`;
      else { const g = burbujasGenerales(paso); const t = (g || []).map((b) => b.text || "").join(" ").trim();
        h += `<div class="amx-step"><div class="amx-sh"><b>Toque ${i + 1}</b><span>· ${espera(seq, i)}</span><span class="amx-chip">general</span></div><p class="amx-gtxt">${esc(t.slice(0, 160) || "(sin texto)")}${t.length > 160 ? "…" : ""}</p>
          <div class="amx-acts"><button class="amx-btn sm" data-propio="${k}" ${g ? "" : "disabled"}>${icon("plus")} Crear propio</button></div></div>`; }
    });
  }
  h += `<div class="amx-acts" style="justify-content:flex-start">${full}</div>`;
  box.innerHTML = h;
  const paso = (k) => { const [id, i] = k.split(":"); return { seq: S.seqs[id], paso: S.seqs[id].pasos[+i] }; };
  box.querySelector("[data-full]").onclick = () => S.ctx.abrirRemarketing(p.id);
  box.querySelectorAll("[data-propio]").forEach((b) => (b.onclick = async () => {
    const { seq, paso: ps } = paso(b.dataset.propio);
    asegurarVariantes(ps);
    ps.variantes.push({ id: uid(), rev: 1, nombre: "Versión A", activo: true, peso: 1, angulo: a.slug, bubbles: burbujasGenerales(ps) || [{ text: "" }] });
    ps.rotacion = true;   // el editor de Secuencias lo muestra en modo «según el anuncio»
    if (await guardarSeq(seq, b)) toast("Mensaje propio creado desde el general: cámbialo para que retome el anuncio");
    pinta();
  }));
  box.querySelectorAll("[data-gpaso]").forEach((b) => (b.onclick = async () => {
    const k = b.dataset.gpaso, { seq, paso: ps } = paso(k), own = propiasDe(ps.variantes, a.slug)[0];
    leeBurbujas(box, k, own);
    if (!own.bubbles.length) { toast("El mensaje no puede quedar vacío", true); return; }
    if (await guardarSeq(seq, b)) toast("Guardado");
    pinta();
  }));
  box.querySelectorAll("[data-gen]").forEach((b) => (b.onclick = async () => {
    const { seq, paso: ps } = paso(b.dataset.gen);
    ps.variantes = ps.variantes.filter((v) => v.angulo !== a.slug);
    if (await guardarSeq(seq, b)) toast("Este toque usa el mensaje general");
    pinta();
  }));
}
// Un paso del formato viejo (bubbles/mensaje sueltos) pasa a variantes sin cambiar lo que manda: la general primero.
function asegurarVariantes(paso) {
  if (Array.isArray(paso.variantes) && paso.variantes.length) return;
  const b = burbujasGenerales(paso) || [{ text: "" }];
  paso.variantes = [{ id: uid(), rev: 1, nombre: "Versión A", activo: true, peso: 1, bubbles: b }];
  delete paso.bubbles; delete paso.mensaje;
}
async function guardarSeq(seq, btn) {
  subeRevSiCambio(seq.pasos, S.fotoSeq[seq.id]);
  if (btn) btn.disabled = true;
  const { error } = await supa.from("sequences").update({ pasos: seq.pasos }).eq("id", seq.id);
  if (btn) btn.disabled = false;
  if (error) { toast("No se pudo guardar el remarketing: " + error.message, true); return false; }
  S.fotoSeq[seq.id] = fotoVariantes(seq.pasos);
  return true;
}

// ── Crear, copiar y eliminar ángulos ──────────────────────────────────────
const slugDe = (nombre) => String(nombre || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "ang" + Date.now();
async function insertaAngulo(p, base) {
  const orden = Math.max(-1, ...angsDe(p.id).map((a) => Number(a.orden) || 0)) + 1;
  const { data, error } = await supa.from("angulos").insert({ channel_id: S.ctx.channelId, product_id: p.id, nombre: base.nombre, slug: base.slug, ad_ids: [], gancho_ia: base.gancho_ia || null, orden }).select("id,product_id,nombre,slug,ad_ids,gancho_ia,orden").single();
  if (error) throw error;
  (S.angs[p.id] ||= []).push({ ...data, ad_ids: [] });
  return S.angs[p.id].at(-1);
}
async function nuevoAngulo(fam) {
  if (!fam.length) return;
  const nombre = await askText({ title: "Nuevo ángulo", message: fam.length > 1 ? `Se crea en ${fam.map((m) => paisNom(paisDe(m))).join(", ")}.` : "", placeholder: "Ej. Bajar de peso", confirmText: "Crear" });
  if (!nombre || !String(nombre).trim()) return;
  const usados = new Set(fam.flatMap((m) => angsDe(m.id).map((a) => a.slug)));
  let slug = slugDe(nombre), n = 2; const base = slug; while (usados.has(slug)) slug = base + "-" + n++;
  try { for (const m of fam) await insertaAngulo(m, { nombre: String(nombre).trim(), slug }); }
  catch (e) { toast(e.message || "No se pudo crear", true); pinta(); return; }
  toast("Ángulo creado: ponle sus anuncios, su gancho y su saludo");
  ir({ tipo: "ficha", pid: fam[0].id, slug });
}
async function crearEnPais(pid, slug) {
  const p = prodDe(pid), src = famDeProd(pid).find((m) => angDe(m.id, slug));
  if (!p || !src) return;
  try { await insertaAngulo(p, angDe(src.id, slug)); await copiaAngulo(src, p, slug); }
  catch (e) { toast(e.message || "No se pudo crear", true); pinta(); return; }
  toast(`Ángulo creado en ${paisNom(paisDe(p))} con el saludo y el remarketing de ${paisNom(paisDe(src))}: revisa los precios escritos`);
  ir({ tipo: "ficha", pid: p.id, slug });
}
// Copia gancho, saludo y remarketing del ángulo `slug` de `src` a `dst` (que ya tiene el ángulo). Devuelve qué copió.
async function copiaAngulo(src, dst, slug) {
  const res = { saludo: false, toques: 0 };
  const a = angDe(src.id, slug), b = angDe(dst.id, slug);
  if (a && b && (a.nombre !== b.nombre || (a.gancho_ia || "") !== (b.gancho_ia || ""))) {
    const { error } = await supa.from("angulos").update({ nombre: a.nombre, gancho_ia: a.gancho_ia || null }).eq("id", b.id);
    if (error) throw error; b.nombre = a.nombre; b.gancho_ia = a.gancho_ia;
  }
  const sv = propiasDe(S.saludo[src.id]?.config?.variantes, slug), nd = S.saludo[dst.id];
  if (sv.length && nd) {
    nd.config.variantes = nd.config.variantes.filter((v) => v.angulo !== slug).concat(sv.map((v) => ({ ...clon(v), id: uid(), rev: 1 })));
    if (!(await guardarSaludo(dst.id))) throw new Error("no se pudo copiar el saludo");
    res.saludo = true;
  }
  const dSeqs = Object.fromEntries(seqsDe(dst).map((x) => [x.seg, x.seq]));
  for (const { seg, seq } of seqsDe(src)) {
    const ds = dSeqs[seg]; if (!ds || ds.id === seq.id) continue;   // misma secuencia compartida: ya lo tiene
    let cambio = false;
    seq.pasos.forEach((ps, i) => {
      const pd = ds.pasos[i]; if (!esMsg(ps) || !esMsg(pd)) return;
      const own = propiasDe(ps.variantes, slug); if (!own.length) return;
      asegurarVariantes(pd);
      pd.variantes = pd.variantes.filter((v) => v.angulo !== slug).concat(own.map((v) => ({ ...clon(v), id: uid(), rev: 1 })));
      pd.rotacion = true; cambio = true; res.toques++;
    });
    if (cambio && !(await guardarSeq(ds))) throw new Error("no se pudo copiar el remarketing");
  }
  return res;
}
async function copiarAOtros(btn, p, a, otros) {
  const conPrecio = [...textos(propiasDe(S.saludo[p.id]?.config?.variantes, a.slug)), ...seqsDe(p).flatMap(({ seq }) => seq.pasos.flatMap((ps) => textos(propiasDe(ps.variantes, a.slug))))].filter((t) => RE_PRECIO.test(t));
  const ok = await confirmDialog({
    title: `Copiar «${a.nombre}»`,
    messageHtml: `Se copia a <b>${esc(otros.map((m) => paisNom(paisDe(m))).join(" y "))}</b>: nombre, gancho, saludo y remarketing de este ángulo, reemplazando lo que tenga allá. Los anuncios no se copian.` +
      (conPrecio.length ? `<br><br>⚠️ ${conPrecio.length === 1 ? "Un mensaje nombra" : conPrecio.length + " mensajes nombran"} un precio escrito a mano («${esc(conPrecio[0].match(RE_PRECIO)[0])}»): después de copiar, cámbialo a la moneda de cada país.` : ""),
    confirmText: "Copiar",
  });
  if (!ok) return;
  btn.disabled = true; const txt = btn.innerHTML; btn.textContent = "Copiando…";
  const hechos = [];
  try {
    for (const m of otros) { if (!angDe(m.id, a.slug)) await insertaAngulo(m, a); const r = await copiaAngulo(p, m, a.slug); hechos.push(`${paisNom(paisDe(m))}${r.saludo ? " (saludo" + (r.toques ? ` y ${r.toques} toque${r.toques === 1 ? "" : "s"})` : ")") : r.toques ? ` (${r.toques} toque${r.toques === 1 ? "" : "s"})` : ""}`); }
    toast("Copiado a " + hechos.join(", ") + (conPrecio.length ? ". Revisa los precios escritos." : ""));
  } catch (e) { toast((hechos.length ? `Se copió a ${hechos.join(", ")}, pero falló el resto: ` : "No se pudo copiar: ") + (e.message || e), true); }
  btn.disabled = false; btn.innerHTML = txt;
  pinta();
}
async function eliminarAngulo(p, a) {
  if (!(await confirmDialog({ title: "Eliminar ángulo", message: `Se borra «${a.nombre}» en ${paisNom(paisDe(p))} con su saludo y sus mensajes de remarketing.${a.ad_ids.length ? ` ${a.ad_ids.length === 1 ? "Su anuncio sigue" : `Sus ${a.ad_ids.length} anuncios siguen`} llegando al producto, con el saludo general.` : ""}`, confirmText: "Eliminar", danger: true }))) return;
  try {
    // Los anuncios se quedan en el banco: siguen llevando al producto.
    const r = await patchProductConfig(p.id, (cfg) => { cfg.ad_bank = [...new Set([...(Array.isArray(cfg.ad_bank) ? cfg.ad_bank.map(String) : []), ...a.ad_ids])]; });
    if (!r.ok) throw r.error || new Error("No se pudo guardar");
    p.config = r.config;
    const { error } = await supa.from("angulos").delete().eq("id", a.id);
    if (error) throw error;
    S.angs[p.id] = angsDe(p.id).filter((x) => x.id !== a.id);
    const nodo = S.saludo[p.id];
    if (nodo && nodo.config.variantes.some((v) => v.angulo === a.slug)) { nodo.config.variantes = nodo.config.variantes.filter((v) => v.angulo !== a.slug); await guardarSaludo(p.id); }
    // Sus mensajes de remarketing, solo en secuencias que ningún otro producto con este ángulo use.
    for (const { seq } of seqsDe(p)) {
      const compartida = S.prods.some((q) => String(q.id) !== String(p.id) && angDe(q.id, a.slug) && seqsDe(q).some((x) => x.seq.id === seq.id));
      if (compartida || !seq.pasos.some((ps) => (ps.variantes || []).some((v) => v.angulo === a.slug))) continue;
      seq.pasos.forEach((ps) => { if (Array.isArray(ps.variantes)) ps.variantes = ps.variantes.filter((v) => v.angulo !== a.slug); });
      await guardarSeq(seq);
    }
    toast("Ángulo eliminado");
  } catch (e) { toast(e.message || "No se pudo eliminar", true); }
  ir({ tipo: "mapa" });
}

// ── Estilos ───────────────────────────────────────────────────────────────
function cargaCss() {
  // Siempre se reescribe: si una versión anterior del módulo ya lo puso (el panel navega sin recargar), queda la nueva.
  const s = document.getElementById("amxCss") || document.head.appendChild(Object.assign(document.createElement("style"), { id: "amxCss" }));
  s.textContent = `
  .amx{display:flex;flex-direction:column;gap:14px}
  .amx-empty{padding:28px;text-align:center;color:var(--muted);font-size:13px}
  .amx-intro{display:flex;gap:12px;align-items:flex-start;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px 16px}
  .amx-intro>svg{width:24px;height:24px;color:var(--brand);flex:none;margin-top:2px}
  .amx-intro b{font-size:15px}.amx-intro p{margin:3px 0 0;font-size:12.5px;color:var(--muted);line-height:1.55}
  .amx-fam,.amx-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:16px 18px}
  .amx-fh{display:flex;align-items:center;gap:12px;margin-bottom:12px}
  .amx-fh b{display:block;font-size:15.5px}.amx-fh span{font-size:12px;color:var(--muted)}
  .amx-em{width:40px;height:40px;border-radius:11px;background:var(--surface-2);border:1px solid var(--border);display:grid;place-items:center;font-size:20px;flex:none}
  .amx-em svg{width:20px;height:20px;color:var(--muted)}
  .amx-tw{overflow-x:auto;margin:0 -4px}
  .amx-mx{width:100%;border-collapse:separate;border-spacing:4px;min-width:420px}
  .amx-mx th{font-size:11.5px;font-weight:700;color:var(--muted);text-align:left;padding:2px 6px}
  .amx-mx td{vertical-align:top;padding:0}
  .amx-an{padding:8px 6px!important;min-width:150px;max-width:240px}
  .amx-an b{display:block;font-size:13px}.amx-an span{display:block;font-size:11.5px;color:var(--muted);line-height:1.4;margin-top:2px}
  .amx-sin .amx-an span:first-child{font-size:12.5px;font-weight:600;color:var(--text)}
  .amx-cell{width:100%;min-height:54px;text-align:left;font:inherit;cursor:pointer;border-radius:11px;border:1px solid var(--border);background:var(--surface-2);padding:8px 10px;display:flex;flex-direction:column;gap:3px;color:var(--text)}
  .amx-cell:hover{border-color:var(--brand)}
  .amx-cell span{font-size:12.5px;font-weight:650;display:flex;align-items:center;gap:5px}
  .amx-cell span svg{width:14px;height:14px;flex:none}
  .amx-cell small{font-size:11.5px;color:var(--muted)}
  .amx-cell.ok{background:rgba(34,192,121,.08);border-color:rgba(34,192,121,.35)}.amx-cell.ok span{color:var(--green)}
  .amx-cell.wa{background:rgba(240,169,43,.08);border-color:rgba(240,169,43,.4)}.amx-cell.wa span{color:var(--amber)}
  .amx-cell.no span{color:var(--muted)}
  .amx-cell.sin{min-height:38px;justify-content:center;border-style:dashed}
  .amx-btn{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 13px;border-radius:10px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;margin-top:10px}
  .amx-btn svg{width:15px;height:15px}.amx-btn:hover{border-color:var(--brand)}
  .amx-btn.pri{background:var(--brand);border-color:var(--brand);color:#fff}
  .amx-btn.sm{height:30px;margin-top:0;font-size:12px}
  .amx-btn:disabled{opacity:.5;cursor:default}
  .amx-link{background:none;border:none;color:var(--brand);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:4px 0}
  .amx-link svg{width:14px;height:14px}.amx-link.dang{color:var(--muted)}.amx-link.dang:hover{color:var(--red)}
  .amx-back{align-self:flex-start;background:none;border:none;color:var(--muted);font:inherit;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:0}
  .amx-back svg{width:16px;height:16px}.amx-back:hover{color:var(--text)}
  .amx-head{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
  .amx-head h2{margin:0;font-size:19px;letter-spacing:-.3px}.amx-head p{margin:3px 0 0;font-size:12.5px;color:var(--muted)}
  .amx-paises{display:flex;gap:4px;background:var(--surface-2);border:1px solid var(--border);border-radius:11px;padding:3px}
  .amx-pais{border:none;background:none;font:inherit;font-size:12.5px;font-weight:600;color:var(--muted);padding:6px 11px;border-radius:8px;cursor:pointer}
  .amx-pais.on{background:var(--brand);color:#fff}.amx-pais:disabled{opacity:.4;cursor:default}
  .amx-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:-4px}
  .amx-chip{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:650;padding:3px 9px;border-radius:999px;background:var(--surface-2);border:1px solid var(--border);color:var(--muted)}
  .amx-chip svg{width:12px;height:12px}
  .amx-chip.ok{background:rgba(34,192,121,.1);border-color:rgba(34,192,121,.35);color:var(--green)}
  .amx-chip.wa{background:rgba(240,169,43,.1);border-color:rgba(240,169,43,.4);color:var(--amber)}
  .amx-card h3{margin:0 0 10px;font-size:14.5px;display:flex;align-items:center;gap:7px}
  .amx-card h3 svg{width:17px;height:17px;color:var(--brand)}.amx-card h3 span{font-size:12px;font-weight:500;color:var(--muted)}
  .amx-ia{border-color:var(--ia-brd,rgba(168,85,247,.42));background:radial-gradient(130% 140% at 0% 0%,rgba(168,85,247,.12),transparent 58%),var(--surface)}
  .amx-iagl{width:24px;height:24px;flex:none;border-radius:7px;display:grid;place-items:center;background:linear-gradient(135deg,var(--ia1,#a855f7),var(--ia2,#ec4899));box-shadow:0 3px 8px -3px rgba(168,85,247,.6)}
  .amx-card h3 .amx-iagl svg{width:13px;height:13px;color:#fff}
  .amx-iatt{background:linear-gradient(90deg,var(--ia1,#a855f7),var(--ia2,#ec4899));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .amx-ia .amx-in{width:100%;box-sizing:border-box}
  .amx-ia .amx-in:focus{outline:none;border-color:var(--ia1,#a855f7);box-shadow:0 0 0 3px var(--ia-bg,rgba(168,85,247,.14))}
  .amx-btn.ia{background:linear-gradient(135deg,var(--ia1,#a855f7),var(--ia2,#ec4899));border:none;color:#fff}
  .amx-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}
  .amx-kpi div{background:var(--surface-2);border-radius:10px;padding:9px 11px}
  .amx-kpi b{display:block;font-size:17px;letter-spacing:-.3px}.amx-kpi span{font-size:11.5px;color:var(--muted)}
  .amx-help{font-size:12px;color:var(--muted);line-height:1.55;margin:8px 0 0}
  .amx-help a{color:var(--brand);font-weight:600;text-decoration:none}.amx-help svg{width:13px;height:13px;vertical-align:-2px;color:var(--amber)}
  .amx-row{display:flex;align-items:center;gap:8px;border:1px solid var(--border);border-radius:10px;padding:8px 10px;margin-top:8px;background:var(--surface-2)}
  .amx-row.soft{background:transparent;border-style:dashed}
  .amx-rt{flex:1;min-width:0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .amx-rt small{display:block;font-size:11px;color:var(--faint);font-family:ui-monospace,monospace}
  .amx-ib{flex:none;width:30px;height:30px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--muted);display:grid;place-items:center;cursor:pointer}
  .amx-ib svg{width:14px;height:14px}.amx-ib:hover{color:var(--red);border-color:var(--red)}
  .amx-emptyrow{font-size:12.5px;color:var(--muted);border:1px dashed var(--border);border-radius:10px;padding:12px;text-align:center;margin-top:8px}
  .amx-sub{font-size:12px;font-weight:700;margin:14px 0 2px}.amx-sub span{font-weight:500;color:var(--muted)}
  .amx-add{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}
  .amx-add .amx-btn{margin-top:0}
  .amx-sel,.amx-in{height:36px;border:1px solid var(--border);border-radius:10px;background:var(--surface-2);color:var(--text);font:inherit;font-size:13px;padding:0 10px}
  .amx-sel{flex:1;min-width:180px;max-width:100%}.amx-add .amx-in{flex:1;min-width:170px}
  .amx-row .amx-sel{flex:none;height:30px;font-size:12px;min-width:0;max-width:170px}
  .amx-card>.amx-in{width:100%;box-sizing:border-box}
  .amx-lbl{display:block;font-size:12px;font-weight:650;color:var(--muted);margin:10px 0 5px}.amx-lbl span{font-weight:400}
  .amx-acts{display:flex;gap:10px;align-items:center;justify-content:flex-end;flex-wrap:wrap;margin-top:10px}
  .amx-acts.col{flex-direction:column;align-items:stretch;justify-content:flex-start;margin-top:0}
  .amx-acts .amx-btn{margin-top:0}
  .amx-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(200px,240px);gap:14px;align-items:start;margin-top:10px}
  @media(max-width:640px){.amx-two{grid-template-columns:1fr}}
  .amx-ta{width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:10px;background:var(--surface-2);color:var(--text);font:inherit;font-size:13px;line-height:1.5;padding:8px 11px;margin-bottom:6px;resize:vertical;field-sizing:content;min-height:42px;max-height:220px}
  .amx-var{margin-top:10px}
  .amx-det{margin-top:10px}
  .amx-det>summary{cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--brand)}
  .amx-det>summary::-webkit-details-marker{display:none}
  .amx-det>summary svg{width:14px;height:14px}.amx-det>summary span{font-weight:400;color:var(--muted)}
  .amx-prevbox{max-width:300px;max-height:460px;overflow:auto;margin-top:8px;border-radius:14px}
  .amx-media{font-size:12px;color:var(--muted);border:1px solid var(--border);border-radius:10px;padding:8px 10px;margin-bottom:8px;display:flex;align-items:center;gap:6px}
  .amx-media svg{width:14px;height:14px}
  .amx-warnrow{display:flex;gap:7px;align-items:center;font-size:12.5px;color:var(--amber);background:rgba(240,169,43,.08);border-radius:10px;padding:8px 10px}
  .amx-warnrow svg{width:14px;height:14px;flex:none}
  .amx-step{border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin-top:10px}
  .amx-sh{display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:12.5px}.amx-sh span{color:var(--muted)}.amx-sh .amx-chip{margin-left:auto}
  .amx-gtxt{font-size:12.5px;color:var(--muted);line-height:1.5;margin:0;white-space:pre-wrap}
  `;
}
