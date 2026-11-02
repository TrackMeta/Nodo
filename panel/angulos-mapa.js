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
import { waScreenHtml, waBubbles, seqBrand, subeRevSiCambio, fotoVariantes, newVariant, mountMensajeEditor, mountStepsEditor } from "./seq-editor.js?v=23";
import { limpiaBotones } from "./bubble-buttons.js";
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
  const pid = seqPropiaId(p, slug);
  if (pid) { const n = Math.max(1, (S.seqs[pid].pasos || []).length); return { total: n, propios: n, propia: true }; }
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
  // `foco`: la sección de la ficha que falta (la primera), para llevarte directo ahí al tocar la casilla.
  if (!nAds) return { tono: "no", txt: "Sin anuncios", ic: "dot", foco: "amxAds" };
  let foco = "";
  if (!String(a.gancho_ia || "").trim()) { falta.push("gancho"); foco ||= "amxIa"; }
  if (!saludoPropio(p.id, a.slug)) { falta.push("saludo"); foco ||= "amxSal"; }
  if (rem.total && rem.propios < rem.total) { falta.push(`secuencias ${rem.propios} de ${rem.total}`); foco ||= "amxRem"; }
  return falta.length ? { tono: "wa", txt: "Falta " + falta.join(", "), ic: "alert", foco } : { tono: "ok", txt: "Completo", ic: "check", foco: "" };
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
function ir(vista) {
  S.vista = vista; S.trabajo = null; S.trabajoRem = null; S.trabajoProp = null; pinta();
  const el = vista.foco && document.getElementById(vista.foco);
  if (!el) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  if (el.classList.contains("amx-cerrado")) el.classList.remove("amx-cerrado");   // el saludo plegado se abre
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.add("amx-foco"); setTimeout(() => el.classList.remove("amx-foco"), 2200);
}

function pintaMapa() {
  const fams = familias();
  let h = `<div class="amx"><div class="amx-intro">${icon("compass")}<div><b>Ángulos</b><p>Cada fila es una idea con la que anuncias tu producto; cada columna, un país. Toca una casilla para ver y editar todo lo de ese ángulo en ese país: sus anuncios, su gancho, su saludo, sus secuencias y cómo le va (últimos ${DIAS} días).</p></div></div>`;
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
        h += `<td><button class="amx-cell ${e.tono}" data-pid="${esc(m.id)}" data-slug="${esc(s.slug)}" data-foco="${e.foco}"><span>${icon(e.ic)} ${esc(e.txt)}</span><small>${a.ad_ids.length} anuncio${a.ad_ids.length === 1 ? "" : "s"}${seqPropiaId(m, s.slug) ? " · secuencia propia" : ""}${num ? " · " + num : ""}</small></button></td>`;
      }
      h += `</tr>`;
    }
    // (1-nov, Rodrigo) «Sin ángulo» no es un ángulo: va como franja debajo, y solo si hay anuncios sueltos.
    const sueltos = ms.map((m) => ({ m, n: sinAngulo(m).length })).filter((x) => x.n);
    h += `</tbody></table></div>
      ${sueltos.map(({ m, n }) => `<button type="button" class="amx-sueltos" data-pid="${esc(m.id)}" data-slug="">${icon("megaphone")}<span><b>${n} anuncio${n === 1 ? "" : "s"}${multi ? ` de ${esc(paisNom(paisDe(m)))}` : ""} sin ángulo</b> · llega${n === 1 ? "" : "n"} con el saludo general</span><span class="amx-sueltos-cta">Asignar →</span></button>`).join("")}
      <button class="amx-btn" data-nuevo="${esc(famDe(p0))}">${icon("plus")} Ángulo</button></div>`;
  }
  h += `</div>`;
  S.host.innerHTML = h;
  S.host.querySelectorAll("[data-pid]").forEach((b) => (b.onclick = () => ir({ tipo: "ficha", pid: b.dataset.pid, slug: b.dataset.slug, foco: b.dataset.foco || "" })));
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
    <div class="amx-card amx-head"><div style="flex:1;min-width:0"><h2>${a ? esc(a.nombre || a.slug) : "Anuncios sin ángulo"}</h2>${a ? "" : `<p style="margin:3px 0 0">Estos anuncios llegan con el saludo general. Asígnales un ángulo para que el bot retome la idea del anuncio.</p>`}
      <p>${esc(p.nombre)} · <b>${esc(paisNom(pais))}</b></p></div>
      ${otros.length && a ? `<div class="amx-paises">${fam.map((m) => { const tiene = !!angDe(m.id, slug); return `<button class="amx-pais ${String(m.id) === String(pid) ? "on" : ""}" ${tiene ? `data-ir="${esc(m.id)}"` : "disabled title=\"Este ángulo no existe en ese país\""}>${esc(paisNom(paisDe(m)))}</button>`; }).join("")}</div>` : ""}
    </div>`;
  if (a) h += `<div class="amx-chips">${chip(a.ad_ids.length, `Anuncios ${a.ad_ids.length}`)}${chip(String(a.gancho_ia || "").trim(), "Gancho")}${chip(saludoPropio(pid, slug), "Saludo propio")}${rem.propia ? chip(true, "Secuencia propia") : rem.total ? chip(rem.propios === rem.total, `Secuencias ${rem.propios}/${rem.total}`) : ""}</div>`;
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
    h += `<div class="amx-card amx-ia" id="amxIa"><h3><span class="amx-iagl">${icon("robot")}</span><span class="amx-iatt">Nombre y gancho para la IA</span></h3>
      <label class="amx-lbl">Nombre del ángulo</label><input class="amx-in" id="amxNom" value="${esc(a.nombre || "")}" maxlength="60"/>
      <label class="amx-lbl">Gancho para la IA <span>· desde qué idea le vende a este cliente</span></label>
      <input class="amx-in" id="amxGan" value="${esc(a.gancho_ia || "")}" placeholder="Ej. vino por un anuncio sobre bajar la barriga en 21 días"/>
      <div class="amx-acts"><button class="amx-btn ia" id="amxGanG">Guardar</button></div></div>`;
    h += `<div class="amx-card" id="amxSal"></div><div class="amx-card" id="amxRem"></div>`;
    if (otros.length) h += `<div class="amx-card"><h3>${icon("copy")} Copiar a otros países</h3>
      <p class="amx-help">Lleva el nombre, el gancho, el saludo y las secuencias de este ángulo a ${otros.map((m) => esc(paisNom(paisDe(m)))).join(" y ")}. Reemplaza lo que ese ángulo tenga allá. Los anuncios y los precios no se copian.</p>
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

// {{precio}} con el precio real de la versión (solo el número, como lo reemplaza el bot).
let _precioPrev = "100";
const prevSmp = (t) => String(t || "").replace(/\{\{\s*nombre\s*\}\}/gi, "Ana").replace(/\{\{\s*precio\s*\}\}/gi, _precioPrev).replace(/\{\{[^}]*\}\}/g, "…");
let _marca = {};
const vistaWa = (v) => waScreenHtml({ title: _marca.nombre, logoUrl: _marca.logo_url, bubblesHtml: waBubbles((v && v.bubbles) || [], prevSmp), empty: "Escribe el mensaje para ver cómo llega…" });
const deAngulo = (vs, slug) => (vs || []).filter((v) => v && v.angulo === slug);
const primeraDe = (vs, slug) => deAngulo(vs, slug).find((v) => v.activo !== false) || deAngulo(vs, slug)[0] || null;
// Lo de este ángulo, listo para guardar: sin burbujas vacías ni versiones vacías (las demás versiones, intactas).
function limpiaAngulo(vs, slug) {
  return (vs || []).map((v) => (v && v.angulo === slug ? { ...v, bubbles: limpiaBotones((v.bubbles || []).filter((b) => b && (b.media_url || String(b.text || "").trim()))) } : v))
    .filter((v) => !(v && v.angulo === slug) || v.bubbles.length);
}
// Monta el editor completo (el mismo del reenganche en Secuencias) y la vista de WhatsApp al lado, que sigue lo que escribes.
function montaEditor(cont, obj, p, slug) {
  const ed = cont.querySelector(".amx-ed"), pv = cont.querySelector(".amx-prev");
  mountMensajeEditor(ed, obj, { channelId: S.ctx.channelId, angulos: angsDe(p.id), soloAngulo: slug });
  const upd = () => { if (pv) pv.innerHTML = vistaWa(primeraDe(obj.variantes, slug)); };
  upd(); ed.addEventListener("input", upd); ed.addEventListener("click", () => setTimeout(upd, 0));
}

// ── Saludo ────────────────────────────────────────────────────────────────
// (1-nov, Rodrigo) El editor COMPLETO dentro de la ficha: texto, imágenes, botones y varias versiones que rotan, solo
// las de este ángulo (las generales no se tocan). Si el ángulo no tiene saludo propio, arranca con una copia del general
// y «Guardar como saludo de este ángulo» lo crea. Se edita una copia de trabajo (S.trabajo) hasta guardar.
function pintaSaludo(p, a) {
  const box = document.getElementById("amxSal"); if (!box) return;
  const pv = (p.product_versions || []).find((v) => v.activo !== false && v.precio != null && v.precio !== ""); _precioPrev = String(pv ? pv.precio : 100);
  const nodo = S.saludo[p.id];
  const editor = `<button class="amx-link" data-full>${icon("edit")} Abrir en el producto</button>`;
  if (!nodo) {
    box.innerHTML = `<h3>${icon("message")} Saludo</h3><p class="amx-help">Este producto todavía no tiene mensajes iniciales.</p><div class="amx-acts" style="justify-content:flex-start">${editor}</div>`;
    box.querySelector("[data-full]").onclick = () => S.ctx.abrirSaludo(p.id, a.slug);
    return;
  }
  const clave = `${p.id}|${a.slug}`;
  if (!S.trabajo || S.trabajo.clave !== clave) {
    const vs = clon(nodo.config.variantes), nuevo = !propiasDe(vs, a.slug).length;
    if (nuevo) { const gen = generalesDe(vs)[0]; vs.push({ ...newVariant(0), angulo: a.slug, bubbles: clon(gen?.bubbles || [{ text: "" }]) }); }
    S.trabajo = { clave, nuevo, obj: { variantes: vs, rotacion: true } };
  }
  const T = S.trabajo;
  const deOtro = T.nuevo ? famDeProd(p.id).filter((m) => String(m.id) !== String(p.id) && propiasDe(S.saludo[m.id]?.config?.variantes, a.slug).length) : [];
  // (1-nov, Rodrigo: «que sea comprimible») Se pliega desde el título; plegado muestra un resumen de una línea. Se
  // pliega con una clase (sin volver a pintar), así no se pierde lo que estés escribiendo. Recuerda cómo lo dejaste.
  const v0 = primeraDe(nodo.config.variantes, a.slug) || generalesDe(nodo.config.variantes)[0];
  const t0 = String((v0?.bubbles || []).map((b) => b.text || b.caption || "").find((t) => String(t).trim()) || "").replace(/\s+/g, " ").trim();
  const nB = (v0?.bubbles || []).length;
  let abierto = true; try { abierto = localStorage.getItem("nodo.amx.saludo") !== "0"; } catch (_) {}
  box.classList.toggle("amx-cerrado", !abierto);
  box.innerHTML = `<button type="button" class="amx-tog" data-tog><h3>${icon("message")} ${T.nuevo ? "Saludo" : "Saludo de este ángulo"}</h3>
      <span class="amx-res"><span class="amx-chip ${T.nuevo ? "wa" : "ok"}">${T.nuevo ? "usa el general" : "propio"}</span> ${nB} mensaje${nB === 1 ? "" : "s"}${t0 ? ` · ${esc(t0.slice(0, 90))}${t0.length > 90 ? "…" : ""}` : ""}</span>
      <span class="amx-chev">${icon("chevronRight")}</span></button>
    <div class="amx-colbody">
    ${T.nuevo ? `<div class="amx-warnrow">${icon("alert")} Hoy usa el saludo general. Abajo tienes una copia: cámbiala para que retome la idea del anuncio y guárdala como saludo de este ángulo.</div>`
              : `<p class="amx-help" style="margin-top:-4px">Lo reciben solo los clientes que llegan por los anuncios de este ángulo.</p>`}
    <div class="amx-salg con-vista"><div class="amx-ed"></div><div class="amx-prevbox amx-prev"></div></div>
    <div class="amx-acts">${T.nuevo ? deOtro.map((m) => `<button class="amx-link" data-copia="${esc(m.id)}">${icon("copy")} Copiar el de ${esc(paisNom(paisDe(m)))}</button>`).join("") : `<button class="amx-link" data-quitar>${icon("x")} Volver al general</button>`}
      ${editor}<button class="amx-btn pri" data-guardar>${T.nuevo ? "Guardar como saludo de este ángulo" : "Guardar saludo"}</button></div>
    </div>`;
  box.querySelector("[data-tog]").onclick = () => { const cerrado = box.classList.toggle("amx-cerrado"); try { localStorage.setItem("nodo.amx.saludo", cerrado ? "0" : "1"); } catch (_) {} };
  montaEditor(box, T.obj, p, a.slug);
  box.querySelector("[data-guardar]").onclick = async (e) => {
    const vs = limpiaAngulo(T.obj.variantes, a.slug);
    if (!deAngulo(vs, a.slug).length) { toast("El saludo no puede quedar vacío", true); return; }
    const antes = nodo.config.variantes; nodo.config.variantes = vs;
    if (await guardarSaludo(p.id, e.currentTarget)) { S.trabajo = null; toast(T.nuevo ? "Listo: este ángulo ya tiene su propio saludo" : "Saludo guardado"); }
    else nodo.config.variantes = antes;
    pinta();
  };
  const q = box.querySelector("[data-quitar]");
  if (q) q.onclick = async () => {
    if (!(await confirmDialog({ title: "Volver al saludo general", message: "Se borra el saludo propio de este ángulo y sus clientes reciben el general.", confirmText: "Volver al general", danger: true }))) return;
    nodo.config.variantes = nodo.config.variantes.filter((v) => v.angulo !== a.slug);
    if (await guardarSaludo(p.id)) { S.trabajo = null; toast("Ahora usa el saludo general"); }
    pinta();
  };
  box.querySelectorAll("[data-copia]").forEach((b) => (b.onclick = () => copiarSaludoDe(p, a, b.dataset.copia)));
  box.querySelector("[data-full]").onclick = () => S.ctx.abrirSaludo(p.id, a.slug);
  seqBrand(S.ctx.channelId).then((b) => { if (b && b.nombre !== _marca.nombre) { _marca = b; const pr = box.querySelector(".amx-prev"); if (pr) pr.innerHTML = vistaWa(primeraDe(T.obj.variantes, a.slug)); } }).catch(() => {});
}
// Trae al editor el saludo de este ángulo en otro país (no guarda: revisas el precio y guardas).
function copiarSaludoDe(p, a, desdePid) {
  const src = propiasDe(S.saludo[desdePid]?.config?.variantes, a.slug), nodo = S.saludo[p.id];
  if (!src.length || !nodo) return;
  const vs = clon(nodo.config.variantes).filter((v) => v.angulo !== a.slug).concat(src.map((v) => ({ ...clon(v), id: uid(), rev: 1, angulo: a.slug })));
  S.trabajo = { clave: `${p.id}|${a.slug}`, nuevo: true, obj: { variantes: vs, rotacion: true } };
  pintaSaludo(p, a);
  if (src.some((v) => textos([v]).some((t) => RE_PRECIO.test(t)))) toast(`Copiado de ${paisNom(paisDe(prodDe(desdePid)))}: nombra un precio en su moneda, cámbialo antes de guardar`, true);
  else toast("Copiado: revísalo y guarda");
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
// (1-nov, Rodrigo) Reenganche con el editor COMPLETO por toque (texto, imágenes, botones, versiones), solo las versiones
// de este ángulo. Se edita una copia de los pasos (S.trabajoRem) y «Guardar reenganche» escribe las secuencias que
// cambiaron. La espera y el descuento de cada toque se cambian en el producto («Abrir en el producto»).
// ── Secuencias del ángulo: «Toques del producto» o «Secuencia propia» ─────────
// (2-nov, Rodrigo) Un ángulo puede tener su PROPIA secuencia (otros toques, tiempos, descuentos o modo). Vive como una
// secuencia normal enlazada en products.config.remarketing_seqs_angulo = {slug: sequence_id}; el motor la usa para quien
// llegó por ese ángulo en lugar de las de audiencia (enrolarSegmento). Sin ella, sigue lo de siempre: los toques del
// producto, con el texto propio de cada toque si se escribe.
const seqPropiaId = (p, slug) => { const m = p?.config?.remarketing_seqs_angulo; const id = m && typeof m === "object" ? m[slug] : null; return id && S.seqs[id] ? id : null; };
const carpetaDe = (p) => ((p.emoji ? p.emoji + " " : "") + (p.nombre || "")).slice(0, 60);
function pintaRem(p, a) {
  const box = document.getElementById("amxRem"); if (!box) return;
  const clave = `${p.id}|${a.slug}`, propiaId = seqPropiaId(p, a.slug);
  const vista = S.remVista && S.remVista.clave === clave ? S.remVista.v : (propiaId ? "propia" : "prod");
  box.innerHTML = `<h3>${icon("secuencias")} Secuencias de este ángulo</h3>
    <div class="amx-modos" role="tablist">
      <button type="button" class="amx-modo ${vista === "prod" ? "on" : ""}" data-vista="prod"><b>Toques del producto</b><span>Mismos toques y tiempos que todos; cambias el texto</span></button>
      <button type="button" class="amx-modo ${vista === "propia" ? "on" : ""}" data-vista="propia"><b>Secuencia propia${propiaId ? " ✓" : ""}</b><span>Sus propios toques, tiempos y descuentos</span></button>
    </div>
    <div id="amxRemBody"></div>`;
  box.querySelectorAll("[data-vista]").forEach((b) => (b.onclick = () => { S.remVista = { clave, v: b.dataset.vista }; pintaRem(p, a); }));
  const cont = box.querySelector("#amxRemBody");
  if (vista === "prod") {
    if (propiaId) {
      cont.innerHTML = `<div class="amx-step"><p class="amx-help" style="margin:0">${icon("alert")} Este ángulo usa su <b>secuencia propia</b>: quien llega por sus anuncios no recibe los toques del producto.</p>
        <div class="amx-acts" style="justify-content:flex-start"><button class="amx-btn sm" data-ver>Ver la secuencia propia</button><button class="amx-link dang" data-quitarpropia>${icon("x")} Dejarla y volver a los toques del producto</button></div></div>`;
      cont.querySelector("[data-ver]").onclick = () => { S.remVista = { clave, v: "propia" }; pintaRem(p, a); };
      cont.querySelector("[data-quitarpropia]").onclick = () => quitarSecuenciaPropia(p, a);
      return;
    }
    return pintaRemToques(p, a, cont);
  }
  if (!propiaId) {
    const base = seqsDe(p)[0]?.seq;
    cont.innerHTML = `<div class="amx-propia-vacia">
        <p><b>¿Este anuncio necesita otro ritmo?</b> Por ejemplo, 3 toques en un día con urgencia, mientras el resto recibe 4 toques espaciados.</p>
        <ul><li>Arranca como copia de ${base ? `«${esc(base.nombre)}» (${base.pasos.length} toque${base.pasos.length === 1 ? "" : "s"}), con los textos propios de este ángulo si ya los escribiste` : "un toque en blanco"}.</li>
          <li>Le cambias toques, esperas, descuentos y modo sin tocar la del producto.</li>
          <li>Solo la reciben los que llegan por los anuncios de «${esc(a.nombre)}»; los demás siguen igual.</li></ul>
        <button class="amx-btn pri" data-crearpropia>${icon("plus")} Crear secuencia propia</button>
      </div>`;
    cont.querySelector("[data-crearpropia]").onclick = (e) => crearSecuenciaPropia(p, a, e.currentTarget);
    return;
  }
  pintaRemPropia(p, a, cont, propiaId);
}
async function pintaRemPropia(p, a, cont, seqId) {
  const clave = `${p.id}|${a.slug}|${seqId}`;
  if (!S.trabajoProp || S.trabajoProp.clave !== clave) S.trabajoProp = { clave, seq: clon(S.seqs[seqId]) };
  const T = S.trabajoProp, seq = T.seq;
  cont.innerHTML = `<div class="amx-propia-hd">
      <div><b>${esc(seq.nombre || "Secuencia propia")}</b><span>Solo la reciben los que llegan por «${esc(a.nombre)}», en lugar de las del producto.</span></div>
      <label>Cómo se envía <select class="amx-sel" id="amxModo"><option value="reenganche">Reenganche (espera el silencio)</option><option value="goteo">Goteo (calendario fijo)</option></select></label>
    </div>
    <div id="amxSeqEd"><div class="amx-empty">Cargando…</div></div>
    <div class="amx-acts"><button class="amx-link dang" data-quitarpropia style="margin-right:auto">${icon("x")} Dejarla y volver a los toques del producto</button><button class="amx-btn pri" data-gpropia>Guardar secuencia</button></div>`;
  const modo = cont.querySelector("#amxModo"); modo.value = seq.modo === "goteo" ? "goteo" : "reenganche"; modo.onchange = () => { seq.modo = modo.value; };
  cont.querySelector("[data-quitarpropia]").onclick = () => quitarSecuenciaPropia(p, a);
  // Las opciones del producto, para el descuento de cada toque.
  const { data: vers } = await supa.from("product_versions").select("id,nombre,precio").eq("product_id", p.id).order("orden");
  const edBox = cont.querySelector("#amxSeqEd"); if (!edBox || !edBox.isConnected) return;
  const ed = mountStepsEditor(edBox, { seq, channelId: S.ctx.channelId, angulos: [], presets: [],
    ofertaProducts: [{ id: p.id, nombre: p.nombre, opciones: (vers || []).filter((v) => v.precio != null && v.precio !== "") }],
    seqProductId: p.id, actions: { enabled: false } });
  cont.querySelector("[data-gpropia]").onclick = async (e) => {
    ed.normalize();
    // Un descuento sin precio regalaría el producto (el motor cobraría 0): no se guarda así.
    const gratis = (seq.pasos || []).findIndex((ps) => ps && ps.oferta && ps.oferta.version_id && !(Number(ps.oferta.precio) > 0));
    if (gratis >= 0) { toast(`El descuento del toque ${gratis + 1} no tiene precio: ponle uno mayor a 0 o quítalo`, true); return; }
    const real = S.seqs[seqId];
    subeRevSiCambio(seq.pasos, S.fotoSeq[seqId]);
    const b = e.currentTarget; b.disabled = true;
    const { error } = await supa.from("sequences").update({ pasos: seq.pasos, modo: seq.modo || "reenganche" }).eq("id", seqId);
    b.disabled = false;
    if (error) { toast("No se pudo guardar: " + error.message, true); return; }
    real.pasos = clon(seq.pasos); real.modo = seq.modo; S.fotoSeq[seqId] = fotoVariantes(real.pasos);
    S.trabajoProp = null; toast("Secuencia propia guardada"); pinta();
  };
}
// Copia de la secuencia del producto «aplanada» para este ángulo: en cada toque queda el texto propio del ángulo si lo
// tenía (si no, el general), ya sin marca de ángulo — en la secuencia propia todos sus mensajes son de este ángulo.
function pasosParaAngulo(pasos, slug) {
  return clon(pasos || []).map((ps) => {
    if (!esMsg(ps)) return ps;
    asegurarVariantes(ps);
    const propias = ps.variantes.filter((v) => v.angulo === slug && conTexto(v));
    const gen = generalesDe(ps.variantes);
    const quedan = (propias.length ? propias : gen.length ? gen : ps.variantes.filter((v) => !v.angulo)).map((v) => { const n = { ...v, id: uid(), rev: 1 }; delete n.angulo; return n; });
    ps.variantes = quedan.length ? quedan : [{ ...newVariant(0) }];
    ps.rotacion = ps.variantes.length > 1;
    return ps;
  });
}
async function crearSecuenciaPropia(p, a, btn) {
  const base = seqsDe(p)[0]?.seq;
  const pasos = base ? pasosParaAngulo(base.pasos, a.slug) : [{ umbral_silencio_seg: 86400, rotacion: false, variantes: [{ ...newVariant(0) }] }];
  if (btn) btn.disabled = true;
  const fila = { channel_id: S.ctx.channelId, nombre: `${p.nombre} · ${a.nombre}`.slice(0, 90), activo: true, pasos, folder: carpetaDe(p), segmento: "general", modo: base?.modo || "reenganche" };
  let { data, error } = await supa.from("sequences").insert(fila).select("id,nombre,pasos,modo,activo").single();
  if (error && /modo|folder|segmento|column/.test(error.message)) ({ data, error } = await supa.from("sequences").insert({ channel_id: fila.channel_id, nombre: fila.nombre, activo: true, pasos }).select("id,nombre,pasos,activo").single());
  if (error) { if (btn) btn.disabled = false; toast("No se pudo crear: " + error.message, true); return; }
  const r = await patchProductConfig(p.id, (c) => { c.remarketing_seqs_angulo = { ...(c.remarketing_seqs_angulo && typeof c.remarketing_seqs_angulo === "object" ? c.remarketing_seqs_angulo : {}), [a.slug]: data.id }; });
  if (!r.ok) { await supa.from("sequences").delete().eq("id", data.id); if (btn) btn.disabled = false; toast("No se pudo enlazar la secuencia al ángulo", true); return; }
  p.config = r.config;
  S.seqs[data.id] = { ...data, pasos: Array.isArray(data.pasos) ? data.pasos : [] };
  S.fotoSeq[data.id] = fotoVariantes(S.seqs[data.id].pasos);
  S.remVista = { clave: `${p.id}|${a.slug}`, v: "propia" };
  toast("Secuencia propia creada: cámbiale toques, tiempos o textos y guarda");
  pinta();
}
async function quitarSecuenciaPropia(p, a, sinPreguntar) {
  const id = seqPropiaId(p, a.slug); if (!id) return;
  if (!sinPreguntar && !(await confirmDialog({ title: "Volver a los toques del producto", message: `Se borra la secuencia propia de «${a.nombre}». Los clientes que la estén recibiendo la dejan; desde ahora, los que lleguen por este ángulo reciben los toques del producto.`, confirmText: "Borrarla", danger: true }))) return;
  const r = await patchProductConfig(p.id, (c) => { if (c.remarketing_seqs_angulo && typeof c.remarketing_seqs_angulo === "object") { delete c.remarketing_seqs_angulo[a.slug]; if (!Object.keys(c.remarketing_seqs_angulo).length) delete c.remarketing_seqs_angulo; } });
  if (!r.ok) { toast("No se pudo quitar", true); return; }
  p.config = r.config;
  await supa.from("sequences").delete().eq("id", id);
  delete S.seqs[id]; S.trabajoProp = null; S.remVista = { clave: `${p.id}|${a.slug}`, v: "prod" };
  if (!sinPreguntar) { toast("Ahora usa los toques del producto"); pinta(); }
}
function pintaRemToques(p, a, box) {
  const seqs = seqsDe(p);
  const full = `<button class="amx-link" data-full>${icon("edit")} Abrir en el producto (esperas y descuentos)</button>`;
  if (!seqs.length) {
    box.innerHTML = `<p class="amx-help">Este producto no tiene secuencias.</p><div class="amx-acts" style="justify-content:flex-start">${full}</div>`;
    box.querySelector("[data-full]").onclick = () => S.ctx.abrirRemarketing(p.id);
    return;
  }
  const clave = `${p.id}|${a.slug}`;
  if (!S.trabajoRem || S.trabajoRem.clave !== clave) S.trabajoRem = { clave, pasos: Object.fromEntries(seqs.map(({ seq }) => [seq.id, clon(seq.pasos)])), seq: seqs[0].seq.id, sel: 0 };
  const T = S.trabajoRem;
  // (1-nov, Rodrigo: «que no sea una lista larga») Los toques van en una fila (número, espera y si es propio) y se
  // edita UNO a la vez, como en Secuencias. Con varias audiencias, primero se elige cuál.
  if (!seqs.some((x) => x.seq.id === T.seq)) { T.seq = seqs[0].seq.id; T.sel = 0; }
  const pasos = T.pasos[T.seq];
  if (T.sel >= pasos.length) T.sel = Math.max(0, pasos.length - 1);
  const estado = (ps) => (!esMsg(ps) ? "otro" : deAngulo(ps.variantes, a.slug).length ? "propio" : "general");
  let h = `<p class="amx-help" style="margin-top:0">A quien llegó por este ángulo y no compró. Verde = tiene su propio mensaje; gris = recibe el mismo que todos.</p>`;
  if (seqs.length > 1) h += `<div class="amx-segs">${seqs.map(({ seg, seq }) => `<button type="button" class="amx-seg ${seq.id === T.seq ? "on" : ""}" data-seq="${esc(seq.id)}">${esc(SEG[seg] || seg)}</button>`).join("")}</div>`;
  h += `<div class="amx-toques">${pasos.map((ps, i) => { const e = estado(ps);
    return `<button type="button" class="amx-toque ${e} ${i === T.sel ? "on" : ""}" data-i="${i}" title="${e === "propio" ? "Tiene su propio mensaje" : e === "general" ? "Recibe el mensaje de todos" : "Plantilla o flujo: igual para todos"}">
      <span class="amx-tn">${i + 1}</span><span class="amx-tw">${espera({ pasos }, i)}</span><span class="amx-te">${e === "propio" ? "propio" : e === "general" ? "general" : pasos[i].template_name ? "plantilla" : "flujo"}</span></button>`; }).join(`<span class="amx-tl"></span>`)}</div>`;
  const ps = pasos[T.sel], k = `${T.seq}:${T.sel}`, e = estado(ps);
  if (e === "otro") h += `<div class="amx-step"><p class="amx-help" style="margin:0">El toque ${T.sel + 1} manda ${ps.template_name ? "una plantilla" : "un flujo"}: es igual para todos los ángulos.</p></div>`;
  else if (e === "propio") h += `<div class="amx-step" data-k="${k}"><div class="amx-sh"><b>Toque ${T.sel + 1}</b><span>· ${espera({ pasos }, T.sel)}</span><span class="amx-chip ok">propio</span><button class="amx-link" data-gen="${k}" style="margin-left:8px">${icon("x")} Usar el general</button></div>
      <div class="amx-salg con-vista"><div class="amx-ed"></div><div class="amx-prevbox amx-prev"></div></div></div>`;
  else { const g = burbujasGenerales(ps), t = (g || []).map((b) => b.text || b.caption || "").join(" ").trim();
    h += `<div class="amx-step"><div class="amx-sh"><b>Toque ${T.sel + 1}</b><span>· ${espera({ pasos }, T.sel)}</span><span class="amx-chip">general</span></div>
      <p class="amx-gtxt">${esc(t.slice(0, 220) || "(sin texto)")}${t.length > 220 ? "…" : ""}</p>
      <div class="amx-acts" style="justify-content:flex-start"><button class="amx-btn sm" data-propio="${k}" ${g ? "" : "disabled"}>${icon("plus")} Crear propio para este ángulo</button></div></div>`; }
  h += `<div class="amx-acts">${full}<button class="amx-btn pri" data-grem>Guardar secuencias</button></div>`;
  box.innerHTML = h;
  const pasoDe = (kk) => { const [id, i] = kk.split(":"); return T.pasos[id][+i]; };
  box.querySelectorAll(".amx-step[data-k]").forEach((st) => montaEditor(st, pasoDe(st.dataset.k), p, a.slug));
  box.querySelectorAll("[data-seq]").forEach((b) => (b.onclick = () => { T.seq = b.dataset.seq; T.sel = 0; pintaRem(p, a); }));
  box.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => { T.sel = +b.dataset.i; pintaRem(p, a); }));
  box.querySelector("[data-full]").onclick = () => S.ctx.abrirRemarketing(p.id);
  box.querySelectorAll("[data-propio]").forEach((b) => (b.onclick = () => {
    const x = pasoDe(b.dataset.propio);
    asegurarVariantes(x);
    x.variantes.push({ ...newVariant(0), angulo: a.slug, bubbles: burbujasGenerales(x) || [{ text: "" }] });
    x.rotacion = true;
    pintaRem(p, a);
  }));
  box.querySelectorAll("[data-gen]").forEach((b) => (b.onclick = () => {
    const x = pasoDe(b.dataset.gen);
    x.variantes = x.variantes.filter((v) => v.angulo !== a.slug);
    pintaRem(p, a);
  }));
  box.querySelector("[data-grem]").onclick = async (ev) => {
    let n = 0, ok = true;
    for (const { seq } of seqs) {
      const nuevos = T.pasos[seq.id].map((x) => (esMsg(x) && Array.isArray(x.variantes) ? { ...x, variantes: limpiaAngulo(x.variantes, a.slug) } : x));
      if (JSON.stringify(nuevos) === JSON.stringify(seq.pasos)) continue;
      const antes = seq.pasos; seq.pasos = nuevos;
      if (await guardarSeq(seq, ev.currentTarget)) n++; else { seq.pasos = antes; ok = false; }
    }
    if (ok) { const { seq: s0, sel } = T; S.trabajoRem = null; toast(n ? "Secuencias guardadas" : "No había cambios"); pinta();   // toda la ficha: también las etiquetas de arriba
      if (S.trabajoRem) { S.trabajoRem.seq = s0; S.trabajoRem.sel = sel; pintaRem(p, a); } }   // y te deja en el toque donde estabas
  };
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
  if (error) { toast("No se pudo guardar la secuencia: " + error.message, true); return false; }
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
  toast(`Ángulo creado en ${paisNom(paisDe(p))} con el saludo y las secuencias de ${paisNom(paisDe(src))}: revisa los precios escritos`);
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
    if (cambio && !(await guardarSeq(ds))) throw new Error("no se pudieron copiar las secuencias");
  }
  // La secuencia propia del ángulo también viaja: la de allá se reemplaza (o se crea). Sin descuentos: nombran las
  // opciones y precios de este país, allá se ponen los suyos.
  const sp = seqPropiaId(src, slug);
  if (sp) {
    const pasos = clon(S.seqs[sp].pasos || []).map((ps) => { if (ps && ps.oferta) delete ps.oferta; return ps; });
    const dp = seqPropiaId(dst, slug), modo = S.seqs[sp].modo || "reenganche";
    if (dp) {
      const { error } = await supa.from("sequences").update({ pasos, modo }).eq("id", dp);
      if (error) throw error;
      S.seqs[dp].pasos = pasos; S.seqs[dp].modo = modo; S.fotoSeq[dp] = fotoVariantes(pasos);
    } else {
      const { data, error } = await supa.from("sequences").insert({ channel_id: S.ctx.channelId, nombre: `${dst.nombre} · ${(angDe(dst.id, slug) || {}).nombre || slug}`.slice(0, 90), activo: true, pasos, folder: carpetaDe(dst), segmento: "general", modo }).select("id,nombre,pasos,modo,activo").single();
      if (error) throw error;
      const r = await patchProductConfig(dst.id, (c) => { c.remarketing_seqs_angulo = { ...(c.remarketing_seqs_angulo && typeof c.remarketing_seqs_angulo === "object" ? c.remarketing_seqs_angulo : {}), [slug]: data.id }; });
      if (!r.ok) { await supa.from("sequences").delete().eq("id", data.id); throw new Error("no se pudo enlazar la secuencia propia"); }
      dst.config = r.config; S.seqs[data.id] = { ...data, pasos }; S.fotoSeq[data.id] = fotoVariantes(pasos);
    }
    res.propia = true;
  }
  return res;
}
async function copiarAOtros(btn, p, a, otros) {
  const conPrecio = [...textos(propiasDe(S.saludo[p.id]?.config?.variantes, a.slug)), ...seqsDe(p).flatMap(({ seq }) => seq.pasos.flatMap((ps) => textos(propiasDe(ps.variantes, a.slug))))].filter((t) => RE_PRECIO.test(t));
  const ok = await confirmDialog({
    title: `Copiar «${a.nombre}»`,
    messageHtml: `Se copia a <b>${esc(otros.map((m) => paisNom(paisDe(m))).join(" y "))}</b>: nombre, gancho, saludo y secuencias de este ángulo, reemplazando lo que tenga allá. Los anuncios no se copian.` +
      (conPrecio.length ? `<br><br>⚠️ ${conPrecio.length === 1 ? "Un mensaje nombra" : conPrecio.length + " mensajes nombran"} un precio escrito a mano («${esc(conPrecio[0].match(RE_PRECIO)[0])}»): después de copiar, cámbialo a la moneda de cada país.` : ""),
    confirmText: "Copiar",
  });
  if (!ok) return;
  btn.disabled = true; const txt = btn.innerHTML; btn.textContent = "Copiando…";
  const hechos = [];
  try {
    for (const m of otros) { if (!angDe(m.id, a.slug)) await insertaAngulo(m, a); const r = await copiaAngulo(p, m, a.slug); hechos.push(`${paisNom(paisDe(m))}${r.saludo ? " (saludo" + (r.toques ? ` y ${r.toques} toque${r.toques === 1 ? "" : "s"})` : ")") : r.toques ? ` (${r.toques} toque${r.toques === 1 ? "" : "s"})` : ""}${r.propia ? " con su secuencia propia (sin descuentos: ponle los de ese país)" : ""}`); }
    toast("Copiado a " + hechos.join(", ") + (conPrecio.length ? ". Revisa los precios escritos." : ""));
  } catch (e) { toast((hechos.length ? `Se copió a ${hechos.join(", ")}, pero falló el resto: ` : "No se pudo copiar: ") + (e.message || e), true); }
  btn.disabled = false; btn.innerHTML = txt;
  pinta();
}
async function eliminarAngulo(p, a) {
  if (!(await confirmDialog({ title: "Eliminar ángulo", message: `Se borra «${a.nombre}» en ${paisNom(paisDe(p))} con su saludo y sus mensajes de secuencias.${a.ad_ids.length ? ` ${a.ad_ids.length === 1 ? "Su anuncio sigue" : `Sus ${a.ad_ids.length} anuncios siguen`} llegando al producto, con el saludo general.` : ""}`, confirmText: "Eliminar", danger: true }))) return;
  try {
    // Los anuncios se quedan en el banco: siguen llevando al producto.
    const r = await patchProductConfig(p.id, (cfg) => { cfg.ad_bank = [...new Set([...(Array.isArray(cfg.ad_bank) ? cfg.ad_bank.map(String) : []), ...a.ad_ids])]; });
    if (!r.ok) throw r.error || new Error("No se pudo guardar");
    p.config = r.config;
    await quitarSecuenciaPropia(p, a, true);   // su secuencia propia, si tenía, se va con él
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
  .amx-sueltos{display:flex;align-items:center;gap:9px;width:100%;margin-top:8px;padding:9px 12px;border-radius:11px;border:1px dashed rgba(240,169,43,.55);background:rgba(240,169,43,.06);color:var(--text);font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
  .amx-sueltos:hover{border-style:solid}
  .amx-sueltos>svg{width:15px;height:15px;color:var(--amber);flex:none}
  .amx-sueltos>span:nth-child(2){flex:1;min-width:0;color:var(--muted)}.amx-sueltos b{color:var(--text)}
  .amx-sueltos-cta{font-weight:700;color:var(--brand);white-space:nowrap}
  .amx-card{transition:box-shadow .3s,border-color .3s}
  .amx-foco{border-color:var(--brand)!important;box-shadow:0 0 0 3px var(--brand-bg)}
  .amx-cell{width:100%;min-height:54px;text-align:left;font:inherit;cursor:pointer;border-radius:11px;border:1px solid var(--border);background:var(--surface-2);padding:8px 10px;display:flex;flex-direction:column;gap:3px;color:var(--text)}
  .amx-cell:hover{border-color:var(--brand)}
  .amx-cell span{font-size:12.5px;font-weight:650;display:flex;align-items:center;gap:5px}
  .amx-cell span svg{width:14px;height:14px;flex:none}
  .amx-cell small{font-size:11.5px;color:var(--muted)}
  .amx-cell.ok{background:rgba(34,192,121,.08);border-color:rgba(34,192,121,.35)}.amx-cell.ok span{color:var(--green)}
  .amx-cell.wa{background:rgba(240,169,43,.08);border-color:rgba(240,169,43,.4)}.amx-cell.wa span{color:var(--amber)}
  .amx-cell.no span{color:var(--muted)}
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
  .amx-var{margin-top:10px}
  .amx-tog{display:flex;align-items:center;gap:10px;width:100%;background:none;border:none;padding:0;margin:0;font:inherit;color:inherit;text-align:left;cursor:pointer;flex-wrap:wrap}
  .amx-tog:focus{outline:none}.amx-tog:focus-visible{outline:2px solid var(--brand);outline-offset:4px;border-radius:8px}
  .amx-tog h3{margin:0!important}
  .amx-res{display:none;flex:1;min-width:0;font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;align-items:center;gap:6px}
  .amx-chev{margin-left:auto;display:grid;place-items:center;color:var(--muted);transition:transform .15s}
  .amx-chev svg{width:16px;height:16px}
  .amx-card:not(.amx-cerrado) .amx-chev{transform:rotate(90deg)}
  .amx-card:not(.amx-cerrado) .amx-tog{margin-bottom:10px}
  .amx-cerrado .amx-colbody{display:none}
  .amx-cerrado .amx-res{display:flex}
  .amx-salg{display:grid;grid-template-columns:minmax(0,1fr);gap:18px;align-items:start}
  .amx-salg>.amx-prevbox{display:none}
  .amx-salg.con-vista{grid-template-columns:minmax(0,1fr) 300px}
  .amx-salg.con-vista>.amx-prevbox{display:block}
  @media(max-width:760px){.amx-salg.con-vista{grid-template-columns:1fr}}
  .amx-prevbox{max-height:520px;overflow:auto;border-radius:14px}
  .amx-link small{font-weight:400;color:var(--muted);font-size:12px}
  .amx-link:focus{outline:none}.amx-link:focus-visible{outline:2px solid var(--brand);outline-offset:2px;border-radius:6px}
  .amx-warnrow{display:flex;gap:7px;align-items:center;font-size:12.5px;color:var(--amber);background:rgba(240,169,43,.08);border-radius:10px;padding:8px 10px}
  .amx-warnrow svg{width:14px;height:14px;flex:none}
  .amx-modos{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:2px 0 12px}
  @media(max-width:560px){.amx-modos{grid-template-columns:1fr}}
  .amx-modo{display:flex;flex-direction:column;gap:2px;text-align:left;font:inherit;cursor:pointer;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:var(--surface-2);color:var(--text)}
  .amx-modo b{font-size:13px}.amx-modo span{font-size:11.5px;color:var(--muted);line-height:1.4}
  .amx-modo.on{border-color:var(--brand);background:var(--brand-bg);box-shadow:inset 0 0 0 1px var(--brand)}
  .amx-propia-vacia{border:1px dashed var(--border);border-radius:12px;padding:14px 16px;font-size:13px;line-height:1.55}
  .amx-propia-vacia p{margin:0 0 6px}.amx-propia-vacia ul{margin:0 0 12px;padding-left:18px;color:var(--muted);font-size:12.5px}
  .amx-propia-hd{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin-bottom:8px}
  .amx-propia-hd>div{flex:1;min-width:220px}.amx-propia-hd b{display:block;font-size:13.5px}.amx-propia-hd span{font-size:12px;color:var(--muted)}
  .amx-propia-hd label{font-size:12px;font-weight:650;color:var(--muted);display:flex;flex-direction:column;gap:4px}
  .amx-segs{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 10px}
  .amx-seg{font:inherit;font-size:12px;font-weight:600;padding:5px 12px;border-radius:999px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer}
  .amx-seg.on{background:var(--brand);border-color:var(--brand);color:#fff}
  .amx-toques{display:flex;align-items:flex-start;gap:0;overflow-x:auto;padding:4px 2px 10px}
  .amx-tl{flex:1 1 18px;min-width:12px;max-width:40px;height:0;border-top:1.5px dashed var(--border);margin-top:21px}
  .amx-toque{flex:none;display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:none;font:inherit;cursor:pointer;padding:0 2px;color:var(--muted)}
  .amx-tn{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font-size:14px;font-weight:700;border:1.5px solid var(--border);background:var(--surface-2);color:var(--muted)}
  .amx-toque.propio .amx-tn{border-color:var(--green);color:var(--green);background:rgba(34,192,121,.08)}
  .amx-toque.on .amx-tn{background:var(--brand);border-color:var(--brand);color:#fff}
  .amx-toque.on.propio .amx-tn{background:var(--green);border-color:var(--green)}
  .amx-tw{font-size:11px;color:var(--muted)}
  .amx-te{font-size:10.5px;font-weight:600}
  .amx-toque.propio .amx-te{color:var(--green)}
  .amx-toque.on .amx-tw{color:var(--text)}
  .amx-step{border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin-top:10px}
  .amx-sh{display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:12.5px}.amx-sh span{color:var(--muted)}.amx-sh .amx-chip{margin-left:auto}
  .amx-gtxt{font-size:12.5px;color:var(--muted);line-height:1.5;margin:0;white-space:pre-wrap}
  `;
}
