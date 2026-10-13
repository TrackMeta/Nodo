// 4.ª pestaña según el tipo de bot: Ventas (digital), Pedidos (físico, como pedidos.html) o Accesos (micro apps,
// por la función edge `microapps`). Los cambios de estado van por order-update, igual que en el panel.
import { A, $, esc, ic, on, emit, supa, invoke, avatar, abrirCapa, abrirHoja, confirmar, pedirTexto, hoja, toast, fmtHora, sol, ir } from "./app.js";
import { pageAll } from "../shell.js";
import { computePreset, startOfDayTZ, endOfDayTZ } from "../date-range.js";
import * as O from "../orders.js";
import { esPrueba } from "./comun.js";

const T = { seg: { digital: "hoy", fisico: "lima", apps: "todos" }, ventas: [], pedidos: [], entregas: null, accesos: [], pend: [], apps: [], cargando: false };
export function init() {
  on("bot", () => { T.ventas = []; T.pedidos = []; T.accesos = []; T.entregas = null; if (A.tab === "t4") cargar(); else badge(); });
  on("orden", () => { if (A.tab === "t4" && A.tipo !== "apps") cargarPronto(); });
  on("resync", () => { if (A.tab === "t4") cargar(); });
  on("tab", (t) => { if (t === "t4") cargar(); });
  on("listo", () => badge());
  $("#t4Pad").addEventListener("click", clic);
}
let _t = null;
function cargarPronto() { clearTimeout(_t); _t = setTimeout(cargar, 800); }
const todo = async (mk) => (await pageAll(mk)).data || [];
async function cargar() {
  if (T.cargando) { cargarPronto(); return; }
  T.cargando = true;
  try { if (A.tipo === "fisico") await cargarPedidos(); else if (A.tipo === "apps") await cargarAccesos(); else await cargarVentas(); }
  catch (e) { console.error(e); $("#t4Pad").innerHTML = `<div class="empty"><b>${ic("alert")}</b>No se pudo cargar.<br>${esc(e.message || e)}</div>`; }
  finally { T.cargando = false; }
}
// Número de la pestaña (pedidos parados / accesos por vencer)
async function badge() {
  if (A.tipo === "fisico") { if (!T.pedidos.length) { try { await cargarPedidos(true); } catch (_) { /* */ } } }
  else if (A.tipo === "apps") { if (!T.accesos.length) { try { await cargarAccesos(true); } catch (_) { /* */ } } }
  else { $("#tb-t4").hidden = true; return; }
  const n = A.tipo === "fisico" ? T.pedidos.filter(parado).length : T.accesos.filter((a) => estadoVis(a) === "porvencer").length;
  $("#tb-t4").hidden = !n; $("#tb-t4").textContent = n;
}
const seg = (opts, sel) => `<div class="seg" data-seg>${opts.map(([k, l]) => `<button type="button" data-f="${k}" class="${k === sel ? "on" : ""}">${l}</button>`).join("")}</div>`;

// ═════════ Ventas (digital) ═════════
async function cargarVentas() {
  const k = T.seg.digital, r = computePreset(k === "7d" ? "7d" : k);
  const desde = startOfDayTZ(r.from).toISOString(), hasta = new Date(endOfDayTZ(r.to).getTime() + 1).toISOString();
  if (!T.ventas.length) $("#t4Pad").innerHTML = `<div class="cargando">Cargando ventas…</div>`;
  const rows = await todo((f, h) => supa.from("orders").select("id,amount,currency,order_bumps,estado,created_at,confirmed_at,shipping,contact_id,contact:contact_id(nombre,wa_id,source),product:product_id(nombre,emoji)").eq("channel_id", A.ch).eq("estado", "confirmada").gte("created_at", desde).lt("created_at", hasta).order("created_at", { ascending: false }).order("id").range(f, h));
  T.ventas = rows.filter((o) => !esPrueba(o.contact));
  const total = T.ventas.reduce((s, o) => s + O.cobrado(o), 0);
  $("#t4Pad").innerHTML = `<h2 class="h">Ventas</h2><p class="sub">Ventas digitales cobradas (confirmadas).</p>
    ${seg([["hoy", "Hoy"], ["ayer", "Ayer"], ["7d", "7 días"]], k)}
    <div class="kpis"><div class="kpi"><small>Ventas</small><b class="num">${T.ventas.length}</b></div><div class="kpi"><small>Cobrado</small><b class="num">${sol(total)}</b></div></div>
    <div class="list">${T.ventas.map((o) => { const c = o.contact || {}; return `<button type="button" class="row" data-chat="${o.contact_id}">
      ${avatar(o.contact_id, c.nombre, c.wa_id)}
      <span class="rmid"><b>${esc(c.nombre || "Cliente")}</b><span>${o.product ? `${o.product.emoji ? esc(o.product.emoji) + " " : ""}${esc(o.product.nombre)}` : "Venta"}${(o.order_bumps || []).length ? " + extras" : ""}</span></span>
      <span class="rend"><b class="num" style="font-size:14px">${sol(O.cobrado(o), o.currency)}</b><time>${fmtHora(o.confirmed_at || o.created_at)}</time></span></button>`; }).join("") || `<div class="empty"><b>${ic("inbox")}</b>Sin ventas en este período.</div>`}</div>
    <p class="note">Toca una venta para abrir el chat (si no le llegó el acceso, reenvíaselo desde ahí).</p>`;
}

// ═════════ Pedidos (físico) ═════════
const PARADO_DEF = { esperando_adelanto: 2, despachado: 3, en_agencia: 5 };
const LIMA_VIVOS = ["carrito", "confirmado", "en_reparto", "reprogramado"];
const PROV_VIVOS = ["adelanto_validado", "por_despachar", "despachado", "en_agencia", "saldo_pagado"];
function diasParado(o) {
  const lim = { ...PARADO_DEF, ...((T.entregas || {}).parado || {}) }[o.estado]; if (!lim) return 0;
  const desde = new Date(o.estado === "esperando_adelanto" ? o.created_at : o.updated_at).getTime();
  const d = Math.floor((Date.now() - desde) / 864e5);
  return d >= lim ? d : 0;
}
const parado = (o) => diasParado(o) > 0;
async function cargarPedidos(soloBadge) {
  if (!soloBadge && !T.pedidos.length) $("#t4Pad").innerHTML = `<div class="cargando">Cargando pedidos…</div>`;
  const sel = "id,amount,currency,order_bumps,estado,order_id,created_at,updated_at,shipping,contact_id,product_id,contact:contact_id(nombre,wa_id,source),product:product_id(nombre,emoji,tipo),version:version_id(nombre)";
  const [rows, ch] = await Promise.all([
    todo((f, h) => supa.from("orders").select(sel).eq("channel_id", A.ch).in("estado", [...LIMA_VIVOS, ...PROV_VIVOS, "esperando_adelanto"]).order("created_at", { ascending: false }).order("id").range(f, h)),
    T.entregas ? Promise.resolve({ data: { entregas: T.entregas } }) : supa.from("channels").select("entregas").eq("id", A.ch).maybeSingle(),
  ]);
  T.entregas = ch.data?.entregas || {};
  T.pedidos = rows.filter((o) => !esPrueba(o.contact) && O.zonaDe(o) !== "digital");
  if (soloBadge) return;
  pintaPedidos(); badge();
}
function pintaPedidos() {
  const f = T.seg.fisico, P = T.pedidos;
  const lima = P.filter((o) => O.zonaDe(o) === "lima" && LIMA_VIVOS.includes(o.estado)), prov = P.filter((o) => O.zonaDe(o) === "provincia" && PROV_VIVOS.includes(o.estado));
  const espera = P.filter((o) => o.estado === "esperando_adelanto"), par = P.filter(parado);
  const vis = { lima, prov, espera, parados: par }[f];
  $("#t4Pad").innerHTML = `<h2 class="h">Pedidos</h2>
    ${seg([["lima", `Lima ${lima.length}`], ["prov", `Provincia ${prov.length}`], ["espera", `Por pagar ${espera.length}`], ["parados", `Parados ${par.length}`]], f)}
    ${f === "espera" ? `<p class="sub" style="margin:0 2px">Se les pidió el adelanto y todavía no pagan.</p>` : ""}
    <div class="stack">${vis.slice(0, 150).map(tarjetaPedido).join("") || `<div class="empty"><b>${ic("box")}</b>Ningún pedido aquí.</div>`}</div>
    <p class="note">El Excel del courier, la edición completa y el stock están en el panel de la compu.</p>`;
}
const TONO = { ok: "var(--green)", warn: "var(--amber)", info: "var(--brand)", bad: "var(--red)" };
function tarjetaPedido(o) {
  const c = o.contact || {}, s = o.shipping || {}, z = O.zonaDe(o), cur = o.currency, d = diasParado(o);
  const prod = `${o.product ? `${o.product.emoji ? esc(o.product.emoji) + " " : ""}${esc(o.product.nombre)}` : "Pedido"}${o.version ? " · " + esc(o.version.nombre) : ""}${(o.order_bumps || []).length ? ` + ${o.order_bumps.length} extra${o.order_bumps.length > 1 ? "s" : ""}` : ""}`;
  let lugar = "";
  if (z === "lima") {
    const dir = String(s.direccion || "");
    const mapa = s.gps ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.gps)}` : /^https?:\/\//i.test(dir) ? dir : dir ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([dir, s.distrito, "Lima"].filter(Boolean).join(", "))}` : "";
    lugar = `${ic("pin")} <b>${esc(/^https?:\/\//i.test(dir) ? "Ubicación compartida" : dir || "Sin dirección")}${s.distrito ? ", " + esc(s.distrito) : ""}</b>${s.referencia ? `<br>${ic("note")} ${esc(s.referencia)}` : ""}${mapa ? `<br><a class="mini" href="${esc(mapa)}" target="_blank" rel="noopener" style="margin-top:6px">${ic("map")} Abrir en el mapa</a>` : ""}`;
  } else {
    lugar = `${ic("building")} <b>${esc([s.agencia ? String(s.agencia).toUpperCase() : "", s.sede || (s.sede_por_confirmar ? "Sede por confirmar" : "")].filter(Boolean).join(" · ") || "Agencia por definir")}</b>${s.destino || s.ciudad ? ` · ${esc(s.destino || s.ciudad)}` : ""}${s.clave_recojo ? `<br>${ic("key")} Clave: <b>${esc(s.clave_recojo)}</b>` : ""}${s.guia || s.codigo_envio ? `<br>${ic("truck")} Guía ${esc(s.guia || "")} ${s.codigo_envio ? "· código " + esc(s.codigo_envio) : ""}` : ""}`;
  }
  const falta = z === "lima" ? O.porCobrarPuerta(o) : O.porCobrar(o), cob = O.cobrado(o);
  const plata = O.esCerrado(o) ? `<div class="money ok">${ic("check")} Pagado completo · ${sol(O.total(o), cur)}</div>`
    : z === "lima" ? `<div class="money">${ic("banknote")} Cobra el motorizado: <b class="num">${sol(falta, cur)}</b></div>`
    : `<div class="money${falta > 0 ? " falta" : " ok"}">${cob > 0 ? `Adelanto ${sol(cob, cur)} · ` : ""}falta <b class="num">${sol(falta, cur)}</b>${falta > 0 ? " antes de la clave" : ""}</div>`;
  const e = O.EST[o.estado] || {};
  return `<article class="ord" data-id="${o.id}"><div class="ordh"><b>${esc(c.nombre || s.cliente || "Cliente")}</b><span class="num">${esc(o.order_id || "#" + String(o.id).slice(0, 6))}</span></div>
    <p>${prod}<br>${lugar}</p>${plata}
    <div class="ordf"><button type="button" class="st" data-mover="${o.id}" style="color:${TONO[e.tono] || "var(--brand)"}">${esc(O.label(o.estado))} ${ic("chevronDown")}</button>
      ${s.tel || /^\d+$/.test(c.wa_id || "") ? `<a class="mini" href="tel:+${esc(String(s.tel || c.wa_id).replace(/\D/g, ""))}" aria-label="Llamar">${ic("directo")}</a>` : ""}
      <button type="button" class="mini" data-chat="${o.contact_id}" aria-label="Abrir el chat">${ic("message")}</button></div>
    ${d ? `<span class="stale">${ic("clock")} ${d} días sin moverse</span>` : ""}</article>`;
}
// Siguientes pasos posibles (primaryAction + menú de pedidos.html)
function siguientes(o) {
  const z = O.zonaDe(o), e = o.estado, out = [];
  const add = (estado, t) => out.push({ estado, t: t || O.label(estado) });
  if (e === "carrito") add(z === "provincia" ? "esperando_adelanto" : "confirmado");
  if (z === "lima") {
    if (e === "confirmado") { add("en_reparto", "Salió a reparto"); add("entregado_cobrado", "Entregado y cobrado"); }
    if (e === "en_reparto") { add("entregado_cobrado", "Entregado y cobrado"); add("reprogramado", "Reprogramado"); add("rechazado", "Lo rechazó en la puerta"); }
    if (e === "reprogramado") add("en_reparto", "Salió a reparto otra vez");
  } else {
    if (e === "esperando_adelanto") add("adelanto_validado", "Adelanto recibido (validar)");
    if (e === "adelanto_validado" || e === "por_despachar") add("despachado", "Despachado (cargar guía)");
    if (e === "despachado") { add("en_agencia", "Llegó a la agencia"); add("saldo_pagado", "Cobré el saldo · dar clave"); add("no_recogido", "No lo recogió"); }
    if (e === "en_agencia") { add("saldo_pagado", "Cobré el saldo · dar clave"); add("no_recogido", "No lo recogió"); }
    if (e === "saldo_pagado") { add("recogido", "Lo recogió"); add("no_recogido", "No lo recogió"); }
  }
  out.push({ estado: "cancelado", t: "Cancelar pedido", peligro: true });
  return out;
}
async function mover(o) {
  const ops = siguientes(o);
  hoja(`Mover pedido de ${(o.contact || {}).nombre || "cliente"}`, ops.map((x) => ({ t: x.t, small: x.peligro ? "" : "", icono: x.peligro ? "ban" : null, v: x })), (op) => moverA(o, op.v), `Ahora: ${O.label(o.estado)}. Al moverlo, Nodo le avisa al cliente si corresponde.`);
}
async function moverA(o, x) {
  const c = o.contact || {}, s = o.shipping || {}, nom = c.nombre || "cliente";
  let ship = null;
  if (x.estado === "despachado") {
    const datos = await new Promise((res) => {
      let r = null;
      abrirHoja(`<h3>Despachar el pedido</h3><p class="lead">${esc(nom)} · ${esc(s.sede || s.destino || "")}</p>
        <label class="flabel">Agencia</label><select class="fsel" id="dAg" style="margin-bottom:10px"><option value="shalom"${(s.agencia || "shalom") === "shalom" ? " selected" : ""}>Shalom</option><option value="olva"${s.agencia === "olva" ? " selected" : ""}>Olva</option></select>
        <label class="flabel" for="dGuia">Número de orden / guía</label><input class="inpt" id="dGuia" value="${esc(s.guia || "")}">
        <label class="flabel" for="dCod">Código de envío</label><input class="inpt" id="dCod" value="${esc(s.codigo_envio || "")}">
        <label class="flabel" for="dClave">Clave de recojo</label><input class="inpt" id="dClave" value="${esc(s.clave_recojo || "")}" placeholder="Se le da cuando pague el saldo">
        <label class="flabel" for="dFlete">Lo que pagaste por el envío (opcional)</label><input class="inpt" id="dFlete" inputmode="decimal" value="${esc(s.flete ?? "")}">
        <button type="button" class="btn blue" style="width:100%" id="dGo">Despachar y avisar</button>`, (sh, cerrar) => {
        $("#dGo", sh).onclick = () => { r = { agencia: $("#dAg", sh).value, guia: $("#dGuia", sh).value.trim(), codigo_envio: $("#dCod", sh).value.trim(), clave_recojo: $("#dClave", sh).value.trim() }; const fl = $("#dFlete", sh).value.trim(); if (fl) r.flete = Number(fl.replace(",", ".")) || 0; cerrar(); };
      });
      const t = setInterval(() => { if (!document.querySelector("#sheet.on")) { clearInterval(t); setTimeout(() => res(r), 50); } }, 150);
    });
    if (!datos) return;
    Object.keys(datos).forEach((k) => { if (datos[k] === "") delete datos[k]; });
    ship = datos;
  } else if (x.estado === "saldo_pagado" && !String(s.clave_recojo || "").trim()) {
    const clave = await pedirTexto("Clave de recojo", { lead: `${nom} ya pagó el saldo. Escribe la clave que le va a pedir la agencia: el bot se la manda.`, ph: "Ej. 4821", boton: "Guardar y avisar" });
    if (clave == null) return; if (!clave.trim()) { toast("Sin la clave el cliente no puede recoger", true); return; }
    ship = { clave_recojo: clave.trim() };
  } else if (O.zonaDe(o) === "lima" && ["entregado_cobrado", "rechazado"].includes(x.estado) && s.flete == null) {
    const def = O.costoZonaLima(T.entregas, s.zona_nombre);
    const v = await pedirTexto(x.estado === "rechazado" ? "Lo rechazó en la puerta" : "Entregado y cobrado", { lead: `${nom} — ¿cuánto le pagaste al motorizado? (déjalo vacío si no sabes)`, valor: def != null ? String(def) : "", ph: "Ej. 10", boton: "Guardar", tipo: "text" });
    if (v == null) return;
    if (v.trim()) ship = { flete: Number(v.replace(",", ".")) || 0 };
  } else if (x.estado === "cancelado") {
    const m = await pedirTexto("Cancelar el pedido", { lead: `${nom} — ¿por qué se cancela? (queda anotado)`, ph: "Ej. ya no lo quiere", boton: "Cancelar pedido" });
    if (m == null) return;
    ship = { anulada_motivo: m.trim() || "Cancelado desde la app", anulada_at: new Date().toISOString() };
  } else if (!(await confirmar(x.t, `${nom} — el pedido pasa a «${O.label(x.estado)}».`, { si: "Confirmar" }))) return;
  let r = await invoke("order-update", { order_id: o.id, estado: x.estado, ...(ship ? { shipping: ship } : {}) });
  if (!r.ok && r.data?.error === "cerrado_confirmar") {
    if (!(await confirmar("Venta ya cerrada", r.data.detalle || "Este pedido ya estaba cerrado. ¿Moverlo igual?", { si: "Mover igual", peligro: true }))) return;
    r = await invoke("order-update", { order_id: o.id, estado: x.estado, forzar: true, ...(ship ? { shipping: ship } : {}) });
  }
  if (!r.ok) { toast(r.data?.detalle || r.data?.error || "No se pudo mover el pedido", true); return; }
  const d = r.data || {};
  toast(d.aviso_error ? `Movido, pero el aviso no salió: ${d.aviso_error}` : d.aviso_enviado ? `Movido a «${O.label(x.estado)}» · se le avisó al cliente` : `Movido a «${O.label(x.estado)}»`, !!d.aviso_error);
  await cargarPedidos();
}

// ═════════ Accesos (micro apps) ═════════
const DIA = 864e5;
function estadoVis(a) { if (a.estado === "activo" && a.vence_at && new Date(a.vence_at).getTime() - Date.now() < 7 * DIA) return "porvencer"; return a.estado; }
const EST_A = { activo: ["Activo", "up"], porvencer: ["Por vencer", "warnc"], vencido: ["Vencido · en pausa", "down"], bloqueado: ["Bloqueado", "mutc"], prueba: ["En prueba", "warnc"], prueba_terminada: ["Prueba terminada", "mutc"] };
function venceTxt(a) {
  if (a.bloqueado) return "Bloqueado";
  if (!a.vence_at) return a.tipo === "prueba" ? "Prueba terminada" : "De por vida";
  const d = Math.ceil((new Date(a.vence_at).getTime() - Date.now()) / DIA);
  if (d < 0) return `Venció hace ${-d} día${d === -1 ? "" : "s"}`;
  if (d === 0) return "Vence hoy"; if (d === 1) return "Vence mañana";
  if (d <= 7) return `Vence en ${d} días`;
  return "Hasta el " + new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short" }).format(new Date(a.vence_at));
}
async function cargarAccesos(soloBadge) {
  if (!soloBadge && !T.accesos.length) $("#t4Pad").innerHTML = `<div class="cargando">Cargando accesos…</div>`;
  const r = await invoke("microapps", { channel_id: A.ch, action: "listar" });
  if (!r.ok) throw new Error(r.data?.error || r.error?.message || "microapps");
  T.accesos = r.data?.accesos || []; T.apps = r.data?.apps || []; T.pend = r.data?.pendientes || [];
  if (soloBadge) return;
  pintaAccesos(); badge();
}
function pintaAccesos() {
  const f = T.seg.apps, L = T.accesos;
  const nV = L.filter((a) => estadoVis(a) === "porvencer").length, nX = L.filter((a) => a.estado === "vencido").length;
  const vis = L.filter((a) => f === "todos" || estadoVis(a) === f || (f === "vencido" && a.estado === "prueba_terminada"));
  const pend = (T.pend || []).filter((p) => p.estado !== "entregado");
  $("#t4Pad").innerHTML = `<h2 class="h">Accesos</h2><p class="sub">${esc(T.apps.map((a) => a.nombre).join(" · ") || "Micro apps")} · quién tiene la app y hasta cuándo.</p>
    ${pend.length ? `<div class="card"><div class="ttl">Pagaron y falta entregar · ${pend.length}</div>${pend.slice(0, 10).map((p) => `<button type="button" class="li" data-chat="${esc(p.contact_id || "")}"><span class="ico">${ic(p.estado === "falta_correo" ? "mail" : "alert")}</span><span class="rmid"><b>${esc(p.contacts?.nombre || p.contacts?.wa_id || "Cliente")}${p.products?.nombre ? " · " + esc(p.products.nombre) : ""}</b><span>${esc({ falta_correo: "Falta su correo (el bot se lo pide)", falta_telefono: "Falta su número", a_humano: "Le toca a una persona", error: "Hubo un error al dar el acceso" }[p.estado] || p.estado)}</span></span></button>`).join("")}</div>` : ""}
    <div class="kpis">
      <button type="button" class="kpi tap${f === "porvencer" ? " on" : ""}" data-f="porvencer"><small>Vencen esta semana</small><b class="num warnc">${nV}</b><span class="mutc">tocar para ver</span></button>
      <button type="button" class="kpi tap${f === "vencido" ? " on" : ""}" data-f="vencido"><small>Vencidos</small><b class="num down">${nX}</b><span class="mutc">la app quedó en pausa</span></button>
    </div>
    ${seg([["todos", "Todos"], ["porvencer", "Por vencer"], ["vencido", "Vencidos"], ["bloqueado", "Bloq."]], f)}
    <div class="list">${vis.slice(0, 200).map((a) => { const ev = estadoVis(a); return `<button type="button" class="row" data-acc="${a.id}">
      ${avatar(a.id, a.nombre, a.wa_id)}
      <span class="rmid"><b>${esc(a.nombre || a.correo || "Cliente")}</b><span>${a.tipo === "mensual" ? "Mensual" : a.tipo === "prueba" ? "Prueba" : "Pago único"} · ${a.ultimo_uso_at ? "usó la app " + fmtHora(a.ultimo_uso_at) : "todavía no entra"}${a.celulares ? ` · ${a.celulares} cel.` : ""}</span></span>
      <span class="vence ${EST_A[ev]?.[1] || ""}">${venceTxt(a)}</span></button>`; }).join("") || `<div class="empty"><b>${ic("key")}</b>Nadie aquí.</div>`}</div>`;
}
async function abrirAcceso(id) {
  const a0 = T.accesos.find((x) => x.id === id);
  $("#accTitle").textContent = a0?.nombre || "Acceso";
  $("#accbody").innerHTML = `<div class="cargando">Cargando…</div>`;
  abrirCapa("acceso");
  const r = await invoke("microapps", { channel_id: A.ch, action: "detalle", id });
  if (!r.ok) { $("#accbody").innerHTML = `<div class="empty">No se pudo cargar el acceso.</div>`; return; }
  const { acceso: a, sesiones = [], eventos = [], max_celulares } = r.data, ev = estadoVis(a);
  $("#accbody").innerHTML = `
    <div class="fsec"><dl class="kv" style="margin:0">
      <dt>Estado</dt><dd class="${EST_A[ev]?.[1] || ""}">${EST_A[ev]?.[0] || ev}</dd>
      <dt>App</dt><dd>${esc(a.app || "")}</dd>
      <dt>Plan</dt><dd>${a.tipo === "mensual" ? "Mensual" : a.tipo === "prueba" ? "Prueba" : "Pago único"} · ${venceTxt(a)}</dd>
      <dt>Correo</dt><dd>${a.correo ? esc(a.correo) : '<span class="warnc">Sin correo</span>'}</dd>
      <dt>WhatsApp</dt><dd>${a.wa_id && /^\d+$/.test(a.wa_id) ? "+" + esc(a.wa_id) : "—"}</dd>
      <dt>Último uso</dt><dd>${a.ultimo_uso_at ? fmtHora(a.ultimo_uso_at) : "Todavía no entra"}</dd>
    </dl></div>
    <div class="grid2">
      <button type="button" class="btn soft" data-aa="reenviar">${ic("refresh")} Reenviar acceso</button>
      <button type="button" class="btn soft" data-aa="extender">${ic("plus")} Extender</button>
      <button type="button" class="btn soft" data-aa="correo">${ic("mail")} Cambiar correo</button>
      <button type="button" class="btn soft" data-aa="chat">${ic("message")} Ver chat</button>
      <button type="button" class="btn ghost" data-aa="bloquear" style="grid-column:span 2">${a.bloqueado ? ic("lock") + " Desbloquear" : ic("ban") + " Bloquear"}</button>
    </div>
    <div class="card"><div class="ttl">Celulares conectados · ${sesiones.length} de ${max_celulares || 2}</div>${sesiones.map((s) => `<div class="li"><span class="ico">${ic("phone")}</span><span class="rmid"><b>${esc(s.etiqueta || "Celular")}</b><span>Usado ${fmtHora(s.ultimo_uso_at || s.creado_at)}</span></span><button type="button" class="btn ghost sm" data-ses="${s.id}">Desconectar</button></div>`).join("") || `<p class="nsub" style="padding:8px 14px 12px">Ninguno todavía.</p>`}</div>
    ${eventos.length ? `<div class="card"><div class="ttl">Historial</div>${eventos.slice(0, 12).map((e) => `<div class="li"><span class="rmid"><b style="font-weight:500">${esc(e.tipo.replace(/_/g, " "))}${e.detalle ? " · " + esc(e.detalle) : ""}</b><span>${fmtHora(e.creado_at)}</span></span></div>`).join("")}</div>` : ""}`;
  $("#accbody").onclick = async (e) => {
    const ses = e.target.closest("[data-ses]");
    if (ses) { if (!(await confirmar("Desconectar celular", "Ese celular tendrá que volver a entrar con el link.", { si: "Desconectar", peligro: true }))) return; const x = await invoke("microapps", { channel_id: A.ch, action: "desconectar", sesion_id: ses.dataset.ses }); toast(x.ok ? "Celular desconectado" : "No se pudo", !x.ok); abrirAcceso(id); return; }
    const b = e.target.closest("[data-aa]"); if (!b) return;
    const k = b.dataset.aa;
    if (k === "chat") { if (a.contact_id) { emit("abrirChat", a.contact_id); } else toast("No tiene chat en este bot", true); return; }
    if (k === "reenviar") { const x = await invoke("microapps", { channel_id: A.ch, action: "reenviar", id }); toast(x.ok && x.data?.ok !== false ? "Acceso reenviado por WhatsApp" : x.data?.error === "ventana_cerrada" ? "Pasaron más de 24 h desde su último mensaje: no se puede escribirle sin plantilla" : "No se pudo reenviar", !(x.ok && x.data?.ok !== false)); return; }
    if (k === "extender") { hoja("¿Cuánto le extiendes?", [{ t: "7 días (cortesía)", v: 7 }, { t: "1 mes", v: 30 }, { t: "3 meses", v: 90 }], async (o) => { const x = await invoke("microapps", { channel_id: A.ch, action: "extender", ids: [id], dias: o.v }); toast(x.ok && x.data?.extendidos ? `Extendido ${o.t}` : "No se pudo extender (¿es de por vida?)", !(x.ok && x.data?.extendidos)); abrirAcceso(id); cargarAccesos(); }); return; }
    if (k === "correo") { const v = await pedirTexto("Cambiar correo", { valor: a.correo || "", ph: "correo@ejemplo.com", tipo: "email" }); if (v == null) return; const x = await invoke("microapps", { channel_id: A.ch, action: "cambiar_correo", id, correo: v.trim() }); toast(x.ok && x.data?.ok !== false ? "Correo cambiado" : x.data?.error === "correo_invalido" ? "Ese correo no es válido" : "No se pudo", !(x.ok && x.data?.ok !== false)); abrirAcceso(id); return; }
    if (k === "bloquear") { const blq = !a.bloqueado; if (!(await confirmar(blq ? "Bloquear acceso" : "Desbloquear acceso", blq ? "No podrá entrar a la app hasta que lo desbloquees." : "Podrá volver a entrar.", { si: blq ? "Bloquear" : "Desbloquear", peligro: blq }))) return; const x = await invoke("microapps", { channel_id: A.ch, action: "bloquear", id, bloqueado: blq }); toast(x.ok ? (blq ? "Acceso bloqueado" : "Acceso desbloqueado") : "No se pudo", !x.ok); abrirAcceso(id); cargarAccesos(); }
  };
}

// ── Clics de la pestaña ──
function clic(e) {
  const sg = e.target.closest("[data-seg] button, .kpi.tap");
  if (sg) { T.seg[A.tipo] = sg.dataset.f; if (A.tipo === "fisico") pintaPedidos(); else if (A.tipo === "apps") pintaAccesos(); else cargar(); return; }
  const ch = e.target.closest("[data-chat]"); if (ch && ch.dataset.chat) { emit("abrirChat", ch.dataset.chat); return; }
  const mv = e.target.closest("[data-mover]"); if (mv) { const o = T.pedidos.find((x) => String(x.id) === mv.dataset.mover); if (o) mover(o); return; }
  const ac = e.target.closest("[data-acc]"); if (ac) abrirAcceso(ac.dataset.acc);
}
