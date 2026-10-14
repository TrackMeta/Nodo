// Chats: la lista de la Bandeja en el celular — modo Humano/Bot, buscador, filtros (los mismos grupos que el
// cajón de la Bandeja), filtros guardados y tiempo real. Las consultas son las de loadConversations().
import { A, $, $$, esc, ic, on, emit, supa, avatar, quienDe, fmtHora, abrirCapa, cerrarCapa, abrirHoja, confirmar, toast, pedirTexto } from "./app.js";
import { pageAll, enTrozos, norm } from "../shell.js";
import { computePreset, startOfDayTZ, endOfDayTZ } from "../date-range.js";
import { STAGES, ETAPA, ENTREGA_PROV, ENTREGA_ESTADO_K, RECOMPRA_ESTADOS, previewHtml, esPrueba } from "./comun.js";

const L = { convs: [], tags: [], prods: [], recompra: new Set(), entrega: new Map(), meta: new Set(), tope: false, cargando: false, buscados: [] };
export const CHATS = L;
let MODO = "bot", Q = "";
const vacio = () => ({ range: "max", sinResp: false, seg: false, anuncio: false, organico: false, sinprod: false, img: false, recompra: false, arch: false, meta: false, stages: new Set(), entrega: new Set(), tags: new Set(), prod: "" });
let F = vacio();
const RANGOS = [["hoy", "Hoy"], ["ayer", "Ayer"], ["7d", "Últimos 7 días"], ["30d", "Últimos 30 días"], ["max", "Máximo"]];
const ESTADO_F = [["sinResp", "Sin responder"], ["seg", "Seguimiento", "clock"], ["anuncio", "Llegó por anuncio", "megaphone"], ["organico", "Orgánico"], ["sinprod", "Sin producto aún"], ["img", "Envió imagen", "image"], ["recompra", "Recomprando", "refresh"], ["arch", "Archivados", "archive"]];

export function init() {
  on("bot", () => { F = vacio(); Q = ""; $("#q").value = ""; MODO = "bot"; cargar(); });
  on("conv", () => cargarPronto());
  on("msg:ins", () => cargarPronto());
  on("contacto", (c) => { const cv = L.convs.find((x) => x.contact_id === c.id); if (cv) { Object.assign(cv.contact, c); pintar(); } });
  on("resync", () => cargar());
  on("bloqueo", ({ id, bloqueado }) => { const cv = L.convs.find((x) => x.contact_id === id) || L.buscados.find((x) => x.contact_id === id); if (cv) cv.contact.bloqueado = bloqueado; if (bloqueado) L.convs = L.convs.filter((x) => x.contact_id !== id); else cargarPronto(); pintar(); });
  on("refrescarChats", () => pintar());
  on("verHumano", () => { MODO = "humano"; pintar(); });
  $("#modeseg").addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (b) { MODO = b.dataset.m; pintar(); } });
  $("#fchips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-q]"); if (!b) return;
    if (b.dataset.q === "todo") F = vacio(); else activos()[+b.dataset.q][1]();
    pintar();
  });
  let tq = null;
  $("#q").addEventListener("input", (e) => { Q = e.target.value.trim(); pintar(); clearTimeout(tq); if (Q.length >= 3) tq = setTimeout(buscarServidor, 350); else L.buscados = []; });
  $("#chatlist").addEventListener("click", (e) => { const r = e.target.closest(".row"); if (r) emit("abrirChat", r.dataset.id); });
  $("#fbtn").onclick = () => { pintaFiltros(); abrirCapa("filtros"); };
  $("#nuevobtn").onclick = nuevoContacto;
  $("#fclear").onclick = () => { F = vacio(); pintaFiltros(); pintar(); };
  $("#fver").onclick = () => cerrarCapa("filtros");
  $("#filbody").addEventListener("click", clicFiltro);
  $("#filbody").addEventListener("change", (e) => { if (e.target.id === "fprod") { F.prod = e.target.value; pintaFiltros(); pintar(); } });
}

// ── Carga (loadConversations de la Bandeja) ──
let _tc = null;
function cargarPronto() { clearTimeout(_tc); _tc = setTimeout(cargar, 450); }
export async function cargar() {
  const ch = A.ch; if (!ch || L.cargando) { if (L.cargando) cargarPronto(); return; }
  L.cargando = true;
  if (!L.convs.length) $("#chatlist").innerHTML = `<div class="cargando">Cargando chats…</div>`;
  const sel = "contact_id,no_leidos,updated_at,expira_at,requiere_humano,archivada,contact:contacts(id,nombre,wa_id,last_input,bot_activo,stage,source,fep_hasta,product_id,ultima_imagen_at,product:products(emoji),contact_tags(tag_id),bloqueado)";
  try {
    const [r, tg, pr] = await Promise.all([
      supa.from("conversations").select(sel).eq("channel_id", ch).order("updated_at", { ascending: false }).limit(1000),
      supa.from("tags").select("id,nombre,color").eq("channel_id", ch).order("nombre"),
      supa.from("products").select("id,nombre,emoji,tipo").eq("channel_id", ch).order("nombre"),
    ]);
    if (ch !== A.ch) return;
    if (r.error) throw r.error;
    let convs = r.data || [];
    L.tope = convs.length >= 1000;
    if (L.tope) {
      const { data: hum } = await supa.from("conversations").select(sel).eq("channel_id", ch).eq("requiere_humano", true).limit(500);
      const ya = new Set(convs.map((c) => c.contact_id));
      (hum || []).forEach((c) => { if (!ya.has(c.contact_id)) convs.push(c); });
    }
    L.convs = convs.filter((c) => c.contact && !c.contact.bloqueado && !esPrueba(c.contact));
    L.tags = tg.data || []; L.prods = pr.data || [];
    pintar();
    emit("convs", L.convs);
    extras(ch);   // recompra, entrega y Meta: después, sin frenar la lista
  } catch (e) {
    console.error(e);
    if (!L.convs.length) $("#chatlist").innerHTML = `<div class="empty"><b>${ic("alert")}</b>No se pudieron cargar los chats.<br>${esc(e.message || e)}</div>`;
  } finally { L.cargando = false; }
}
const todo = async (mk) => (await pageAll(mk)).data || [];
async function extras(ch) {
  try {
    const ids = L.convs.map((c) => c.contact_id);
    const comprados = L.convs.filter((c) => c.contact.stage === "comprado").map((c) => c.contact_id);
    const rec = new Set(), ent = new Map();
    for (const t of enTrozos(comprados, 300)) {
      const rows = await todo((f, h) => supa.from("orders").select("contact_id").eq("channel_id", ch).in("estado", RECOMPRA_ESTADOS).in("contact_id", t).order("id").range(f, h));
      rows.forEach((o) => rec.add(o.contact_id));
    }
    const estados = ENTREGA_PROV.flatMap((g) => g.estados);
    for (const t of enTrozos(ids, 300)) {
      const rows = await todo((f, h) => supa.from("orders").select("contact_id,estado,shipping,created_at").eq("channel_id", ch).in("estado", estados).in("contact_id", t).order("created_at", { ascending: false }).order("id").range(f, h));
      rows.forEach((o) => { if ((o.shipping || {}).zona === "provincia" && !ent.has(o.contact_id)) ent.set(o.contact_id, ENTREGA_ESTADO_K[o.estado]); });
    }
    // Falta enviar a Meta: ventas de anuncio (90 días) que no tienen su Purchase enviado
    const desde = new Date(Date.now() - 90 * 864e5).toISOString();
    const ventas = await todo((f, h) => supa.from("orders").select("id,contact_id,shipping").eq("channel_id", ch).in("estado", ["confirmada", "entregado_cobrado", "recogido", "saldo_pagado"]).gte("created_at", desde).order("id").range(f, h));
    const conClid = ventas.filter((o) => (o.shipping || {}).ctwa_clid);
    const meta = new Set();
    if (conClid.length) {
      const enviados = new Set();
      for (const t of enTrozos(conClid.map((o) => o.id), 300)) {
        const { data } = await supa.from("capi_events").select("order_id").eq("event_name", "Purchase").eq("estado", "enviado").in("order_id", t);
        (data || []).forEach((x) => enviados.add(x.order_id));
      }
      conClid.forEach((o) => { if (!enviados.has(o.id)) meta.add(o.contact_id); });
    }
    if (ch !== A.ch) return;
    L.recompra = rec; L.entrega = ent; L.meta = meta;
    pintar();
  } catch (e) { console.warn("extras de la lista", e); }
}
async function buscarServidor() {
  const q = Q, ch = A.ch; const dig = q.replace(/\D/g, "");
  const sel = "contact_id,no_leidos,updated_at,expira_at,requiere_humano,archivada,contact:contacts!inner(id,nombre,wa_id,last_input,bot_activo,stage,source,fep_hasta,product_id,ultima_imagen_at,product:products(emoji),contact_tags(tag_id),bloqueado)";
  const or = [`nombre.ilike.*${q.replace(/[,()*]/g, " ")}*`]; if (dig.length >= 3) or.push(`wa_id.ilike.*${dig}*`);
  const [r, ops] = await Promise.all([
    supa.from("conversations").select(sel).eq("channel_id", ch).or(or.join(","), { referencedTable: "contacts" }).order("updated_at", { ascending: false }).limit(30),
    q.replace(/\s/g, "").length >= 4 ? supa.from("orders").select("contact_id").eq("channel_id", ch).or(["digital_operacion", "adelanto_operacion_leida", "pago_adelantado_operacion", "extra_operacion"].map((k) => `shipping->>${k}.ilike.*${q.replace(/\s/g, "")}*`).join(",")).limit(20) : Promise.resolve({ data: [] }),
  ]);
  if (q !== Q || ch !== A.ch) return;
  const ya = new Set(L.convs.map((c) => c.contact_id));
  L.buscados = (r.data || []).filter((c) => !ya.has(c.contact_id) && !esPrueba(c.contact));
  L.opsIds = new Set((ops.data || []).map((o) => o.contact_id));
  pintar();
}

// ── Nuevo contacto (como «Nuevo contacto» de Contactos en el panel): se crea y se abre su chat para escribirle.
// Sin ventana de 24 h abierta, el chat ofrece mandarle una plantilla aprobada (WhatsApp no deja otra cosa).
function nuevoContacto() {
  abrirHoja(`<h3>Nuevo contacto</h3><p class="lead">Con el código de país y sin «+» (ej. 51 para Perú). Al crearlo se abre su chat.</p>
    <label class="flabel">Nombre<input class="inpt" id="ncNom" placeholder="Nombre del cliente" autocomplete="off"></label>
    <label class="flabel">Teléfono de WhatsApp<input class="inpt" id="ncTel" type="tel" inputmode="numeric" placeholder="51999888777" autocomplete="off"></label>
    <button type="button" class="btn blue" style="width:100%" id="ncGo">Crear y abrir el chat</button>`, (sh, cerrar) => {
    $("#ncGo", sh).onclick = async () => {
      const nombre = $("#ncNom", sh).value.trim(), wa = $("#ncTel", sh).value.replace(/D/g, "");
      if (!wa) { toast("Escribe el teléfono", true); return; }
      if (wa.length < 10 && !(await confirmar("¿Falta el código de país?", `«${wa}» parece no tener el código de país. El número de WhatsApp lo lleva siempre (ej. 51${wa}).`, { si: "Guardar igual" }))) return;
      const btn = $("#ncGo", sh); btn.disabled = true;
      try {
        // No se pisa a uno que ya existe (el upsert le borraría el nombre): se abre su chat
        const { data: ya } = await supa.from("contacts").select("id,nombre,bloqueado").eq("channel_id", A.ch).eq("wa_id", wa).maybeSingle();
        if (ya) { cerrar(); toast(ya.bloqueado ? `${ya.nombre || "Ese número"} está bloqueado: desbloquéalo desde su ficha` : `Ya tenías a ${ya.nombre || "ese número"}: te abro su chat`); emit("abrirChat", ya.id); return; }
        const { data, error } = await supa.from("contacts").insert({ channel_id: A.ch, wa_id: wa, nombre: nombre || null }).select("id").single();
        if (error) { toast("No se pudo crear: " + error.message, true); btn.disabled = false; return; }
        cerrar(); toast("Contacto creado"); emit("abrirChat", data.id);
      } catch (e) { toast("No se pudo crear: " + (e.message || e), true); btn.disabled = false; }
    };
    setTimeout(() => $("#ncNom", sh)?.focus(), 250);
  });
}

// ── Filtros ──
const esBot = (cv) => cv.contact.bot_activo !== false;
const enModo = (cv) => (MODO === "bot" ? esBot(cv) : !esBot(cv));
function rangoDe(k) { if (k === "max") return null; const r = computePreset(k); return [startOfDayTZ(r.from).getTime(), endOfDayTZ(r.to).getTime()]; }
function pasa(cv, f = F) {
  const c = cv.contact;
  if (!!cv.archivada !== f.arch) return false;
  if (f.sinResp && !(cv.no_leidos > 0)) return false;
  if (f.seg && !cv.requiere_humano) return false;
  if (f.recompra && !(c.stage === "comprado" && L.recompra.has(c.id))) return false;
  if (f.stages.size && !f.stages.has(c.stage || "nuevo")) return false;
  if (f.entrega.size && !f.entrega.has(L.entrega.get(c.id))) return false;
  if (f.meta && !L.meta.has(c.id)) return false;
  if (f.anuncio && !c.source) return false;
  if (f.organico && c.source) return false;
  if (f.sinprod && c.product_id) return false;
  if (f.img && !c.ultima_imagen_at) return false;
  if (f.range !== "max") { const r = rangoDe(f.range), t = new Date(cv.updated_at).getTime(); if (t < r[0] || t > r[1]) return false; }
  if (f.prod && c.product_id !== f.prod) return false;
  if (f.tags.size && !(c.contact_tags || []).some((t) => f.tags.has(t.tag_id))) return false;
  return true;
}
const buscar = (cv) => {
  if (!Q) return true;
  const q = norm(Q), dg = Q.replace(/\D/g, ""), c = cv.contact;
  return norm(c.nombre).includes(q) || (dg.length >= 3 && String(c.wa_id || "").includes(dg)) || (L.opsIds && L.opsIds.has(c.id));
};
function activos() {
  const out = [], f = F;
  if (f.range !== "max") out.push([RANGOS.find((r) => r[0] === f.range)[1], () => (f.range = "max")]);
  for (const [k, l] of ESTADO_F) if (f[k]) out.push([l, () => (f[k] = false)]);
  if (f.meta) out.push(["Falta enviar a Meta", () => (f.meta = false)]);
  for (const k of f.stages) out.push([ETAPA[k]?.label || k, () => f.stages.delete(k)]);
  for (const k of f.entrega) out.push([ENTREGA_PROV.find((x) => x.k === k)?.lbl || k, () => f.entrega.delete(k)]);
  for (const k of f.tags) out.push([L.tags.find((t) => t.id === k)?.nombre || "Etiqueta", () => f.tags.delete(k)]);
  if (f.prod) out.push([L.prods.find((p) => p.id === f.prod)?.nombre || "Producto", () => (f.prod = "")]);
  return out;
}
// (tagHex de la Bandeja)
const tagHex = (c) => { const N = { blue: "#2b7fff", green: "#22c079", amber: "#f0a92b", red: "#e2564a", purple: "#9b6cf0", teal: "#18b7be", pink: "#e264a8", gray: "#8a97a8" }; if (!c) return "#2b7fff"; return /^#[0-9a-f]{3,8}$/i.test(c) ? c : (N[c] || "#2b7fff"); };
export { tagHex };

// ── Pintar ──
export function pintar() {
  const base = L.convs.filter((cv) => pasa(cv) && buscar(cv));
  const nH = base.filter((c) => !esBot(c)).length, nB = base.length - nH;
  const esperan = L.convs.some((c) => !esBot(c) && c.requiere_humano && !c.archivada);
  $("#modeseg").innerHTML = `<button type="button" data-m="humano" class="${MODO === "humano" ? "on" : ""}">Humano<b class="${esperan ? "urg" : ""}">${nH}</b></button><button type="button" data-m="bot" class="${MODO === "bot" ? "on" : ""}">Bot<b>${nB}</b></button>`;
  const act = activos();
  $("#fbtn").classList.toggle("has", act.length > 0);
  $("#fbadge").hidden = !act.length; $("#fbadge").textContent = act.length;
  $("#fchips").hidden = !act.length;
  $("#fchips").innerHTML = act.map(([l], i) => `<button type="button" class="fchip" data-q="${i}">${esc(l)} ${ic("x")}</button>`).join("") + (act.length > 1 ? `<button type="button" class="fchip clear" data-q="todo">Limpiar</button>` : "");
  const vis = base.filter(enModo).concat(Q ? L.buscados.filter((cv) => enModo(cv)) : []);
  const vacioTxt = Q ? `Ningún chat coincide con «${esc(Q)}».` : act.length ? "Ningún chat coincide con estos filtros." : MODO === "humano" ? "Nadie espera por ustedes: el bot atiende todo." : "Todavía no hay chats.";
  $("#chatlist").innerHTML = vis.length ? vis.slice(0, 300).map(fila).join("") : `<div class="empty"><b>${ic("inbox")}</b>${vacioTxt}</div>`;
  $("#chatsNota").hidden = !(L.tope || vis.length > 300);
  $("#chatsNota").textContent = vis.length > 300 ? `Se muestran 300 de ${vis.length}. Usa el buscador o los filtros para ver el resto.` : "Se cargaron los 1000 chats más recientes (y todos los que esperan a alguien).";
  const nEsperan = L.convs.filter((c) => !esBot(c) && c.requiere_humano && !c.archivada).length;
  $("#tb-chats").hidden = !nEsperan; $("#tb-chats").textContent = nEsperan;
  emit("pendientesChats", nEsperan);
}
function fila(cv) {
  const c = cv.contact, w = quienDe({ bot_activo: c.bot_activo, requiere_humano: cv.requiere_humano });
  const st = ETAPA[c.stage || "nuevo"] || ETAPA.nuevo;
  const flag = c.bloqueado ? `<span class="flag blq">Bloqueado</span>` : w === "espera" ? `<span class="flag hum">Pide humano</span>` : cv.requiere_humano ? `<span class="flag seg">Seguimiento</span>` : c.stage === "comprado" ? (L.recompra.has(c.id) ? `<span class="flag pago">Recomprando</span>` : `<span class="flag ok">Compró</span>`) : "";
  return `<button class="row" type="button" data-id="${c.id}">
    ${avatar(c.id, c.nombre, c.wa_id, null, c.product?.emoji)}
    <span class="rmid"><b><span class="stage-dot" style="background:${st.color}" title="${st.label}"></span>${esc(c.nombre || "+" + c.wa_id)}${flag}</b><span>${previewHtml(c)}</span></span>
    <span class="rend${cv.no_leidos ? " new" : ""}"><time>${fmtHora(cv.updated_at)}</time>${cv.no_leidos ? `<span class="unread">${cv.no_leidos > 99 ? "99+" : cv.no_leidos}</span>` : ""}</span>
  </button>`;
}

// ── Pantalla de filtros ──
const SAVED_KEY = () => "nodo.app.filtros." + A.ch;
const leerGuardados = () => { try { return JSON.parse(localStorage.getItem(SAVED_KEY()) || "[]"); } catch (_) { return []; } };
function pintaFiltros() {
  const f = F, enM = L.convs.filter(enModo);
  const cuenta = (prueba, arch) => enM.filter((cv) => (arch ? cv.archivada : !cv.archivada) && prueba(cv)).length;
  const tog = (on, attr, nm, n, extra = "") => `<button type="button" class="ftog${on ? " on" : ""}" ${attr}><span class="nm">${extra}${nm}</span><span class="ct">${n}</span></button>`;
  const P = {
    sinResp: (cv) => cv.no_leidos > 0, seg: (cv) => cv.requiere_humano, anuncio: (cv) => !!cv.contact.source, organico: (cv) => !cv.contact.source,
    sinprod: (cv) => !cv.contact.product_id, img: (cv) => !!cv.contact.ultima_imagen_at, recompra: (cv) => cv.contact.stage === "comprado" && L.recompra.has(cv.contact_id), arch: () => true,
  };
  const saved = leerGuardados();
  $("#filbody").innerHTML = `
    ${saved.length ? `<div class="fgrp"><h4>Mis filtros</h4><div class="tagrow">${saved.map((x, i) => `<button type="button" class="tagb" data-saved="${i}">${ic("bookmark")} ${esc(x.name)}</button>`).join("")}</div></div>` : ""}
    <div class="fgrp"><h4>Fechas · última actividad</h4><div class="chips" style="flex-wrap:wrap;margin:0;padding:0">${RANGOS.map(([k, l]) => `<button type="button" class="chip${f.range === k ? " on" : ""}" data-range="${k}">${l}</button>`).join("")}</div></div>
    <div class="fgrp"><h4>Estado</h4>${ESTADO_F.map(([k, l, i]) => tog(f[k], `data-est="${k}"`, l, cuenta(P[k], k === "arch"), i ? ic(i) : "")).join("")}</div>
    <div class="fgrp"><h4>Atribución a Meta</h4>${tog(f.meta, 'data-est="meta"', "Falta enviar a Meta", cuenta((cv) => L.meta.has(cv.contact_id)))}</div>
    <div class="fgrp"><h4>Etapa del embudo</h4>${STAGES.map((s) => tog(f.stages.has(s.k), `data-stage="${s.k}"`, s.label, cuenta((cv) => (cv.contact.stage || "nuevo") === s.k), `<span class="tagdot" style="background:${s.color}"></span>`)).join("")}</div>
    ${A.tipo === "fisico" ? `<div class="fgrp"><h4>Entrega · Provincia</h4>${ENTREGA_PROV.map((g) => tog(f.entrega.has(g.k), `data-entrega="${g.k}"`, g.lbl, cuenta((cv) => L.entrega.get(cv.contact_id) === g.k), `<span class="tagdot" style="background:${g.color}"></span>`)).join("")}</div>` : ""}
    <div class="fgrp"><h4>Etiquetas</h4>${L.tags.length ? L.tags.map((t) => tog(f.tags.has(t.id), `data-tag="${t.id}"`, esc(t.nombre), cuenta((cv) => (cv.contact.contact_tags || []).some((x) => x.tag_id === t.id)), `<span class="tagdot" style="background:${tagHex(t.color)}"></span>`)).join("") : '<p class="nsub">Sin etiquetas en este bot.</p>'}</div>
    <div class="fgrp"><h4>Producto</h4><select class="fsel" id="fprod" aria-label="Producto"><option value="">Todos</option>${L.prods.map((p) => `<option value="${p.id}"${f.prod === p.id ? " selected" : ""}>${p.emoji ? esc(p.emoji) + " " : ""}${esc(p.nombre)}</option>`).join("")}</select></div>
    <button type="button" class="btn soft" id="fsave">${ic("bookmark")} Guardar como filtro</button>`;
  const n = L.convs.filter((cv) => enModo(cv) && pasa(cv) && buscar(cv)).length;
  $("#fver").textContent = `Ver ${n} chat${n === 1 ? "" : "s"}`;
}
async function clicFiltro(e) {
  const b = e.target.closest("button"); if (!b) return; const f = F;
  if (b.dataset.range) f.range = b.dataset.range;
  else if (b.dataset.est) f[b.dataset.est] = !f[b.dataset.est];
  else if (b.dataset.stage) f.stages.has(b.dataset.stage) ? f.stages.delete(b.dataset.stage) : f.stages.add(b.dataset.stage);
  else if (b.dataset.entrega) f.entrega.has(b.dataset.entrega) ? f.entrega.delete(b.dataset.entrega) : f.entrega.add(b.dataset.entrega);
  else if (b.dataset.tag) f.tags.has(b.dataset.tag) ? f.tags.delete(b.dataset.tag) : f.tags.add(b.dataset.tag);
  else if (b.dataset.saved != null) {
    const s = leerGuardados()[+b.dataset.saved]; if (!s) return;
    F = { ...vacio(), ...s.f, stages: new Set(s.f.stages), entrega: new Set(s.f.entrega), tags: new Set(s.f.tags) };
    toast(`Filtro «${s.name}» aplicado`);
  } else if (b.id === "fsave") {
    if (!activos().length) { toast("Elige al menos un filtro para guardarlo", true); return; }
    const name = (await pedirTexto("Guardar filtro", { lead: "Ponle un nombre para usarlo con un toque.", ph: "Ej. Interesados por anuncio" }) || "").trim();
    if (!name) return;
    const lista = leerGuardados(); lista.push({ name, f: { ...F, stages: [...F.stages], entrega: [...F.entrega], tags: [...F.tags] } });
    try { localStorage.setItem(SAVED_KEY(), JSON.stringify(lista)); } catch (_) { /* */ }
    toast("Filtro guardado");
  } else return;
  pintaFiltros(); pintar();
}
