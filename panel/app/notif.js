// Notificaciones de la app: las mismas de la campanita del panel (notificaciones + lecturas por persona), en una
// pantalla propia con Pendientes / Historial, filtro por bot, Limpiar y «Marcar todo como leído».
import { A, $, esc, ic, on, emit, supa, abrirCapa, capaAbierta, cambiarBot, ir, toast, fmtHora, logoDe } from "./app.js";
import { mazo } from "../shell.js";

// Catálogo (notif-center.js TIPOS)
export const TIPOS = {
  adelanto_validar: ["pagos", "banknote", 1], saldo_validar: ["pagos", "banknote", 1], pago_digital_validar: ["pagos", "banknote", 1],
  pago_extra_validar: ["pagos", "banknote", 1], prepago_lima_validar: ["pagos", "banknote", 1], entrega_fallida: ["pagos", "alert", 1],
  reclama_vuelto: ["pagos", "dollar"], pago_de_mas: ["pagos", "dollar"], adelanto_auto: ["pagos", "check"], saldo_auto: ["pagos", "check"],
  venta_digital: ["ventas", "party"], pedido_lima: ["ventas", "truck"], pedido_provincia: ["ventas", "truck"], venta_extra: ["ventas", "gift"],
  pide_humano: ["atencion", "user", 1], envio_fallido: ["atencion", "alert", 1], cambio_tras_despacho: ["atencion", "truck", 1],
  pedido_cancelado: ["atencion", "ban"], mayorista: ["atencion", "users"], entrega_pedida: ["atencion", "calendar"], organico_sin_atender: ["atencion", "message"],
  pregunta_cliente: ["atencion", "help"], microapp_sin_correo: ["atencion", "mail"],
  whatsapp_salud: ["sistema", "shield", 1], campana_detenida: ["sistema", "megaphone", 1], problema: ["sistema", "alert", 1],
  anuncio_sin_producto: ["sistema", "megaphone"], stock_agotado: ["sistema", "box"], cuenta_compartida: ["sistema", "key"], stock_bajo: ["sistema", "box"], aviso: ["sistema", "bell"],
};
const VALIDAR = new Set(["adelanto_validar", "saldo_validar", "pago_digital_validar", "pago_extra_validar", "prepago_lima_validar"]);
const SEL = "id,channel_id,contact_id,order_id,tipo,grupo,prioridad,titulo,detalle,datos,por_atender,resuelta_at,resuelta_por,repeticiones,created_at,contact:contacts(nombre,wa_id)";
export const N = { rows: new Map(), leidas: new Set(), quitadas: new Set(), hasta: 0, prefs: {}, tab: "pend", bot: "todos", rt: null, cargando: null };

const icDe = (n) => TIPOS[n.tipo]?.[1] || "bell";
const critico = (n) => !!TIPOS[n.tipo]?.[2] || n.prioridad === "urgente";
const pendiente = (n) => n.por_atender && !n.resuelta_at;
const noLeida = (n) => !n.resuelta_at && new Date(n.created_at).getTime() > N.hasta && !N.leidas.has(n.id);
const quitada = (n) => N.quitadas.has(n.id) || (!pendiente(n) && !noLeida(n) && Date.now() - Date.parse(n.created_at) > 7 * 864e5);
const oculta = (n) => quitada(n) || (!critico(n) && (N.prefs.ocultos || []).includes(n.tipo));
const cuentaSinLeer = (n) => noLeida(n) && (n.grupo || TIPOS[n.tipo]?.[0]) !== "ventas";
const nomBot = (id) => A.channels.find((c) => c.id === id)?.nombre || "Bot";

export function init() {
  on("listo", () => { cargar(); suscribir(); });
  on("abrirNotif", () => { pintar(); abrirCapa("notif"); });
  on("resync", () => cargar());
  on("logos", () => { if (capaAbierta("notif")) pintar(); });
  $("#ntabs").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) { N.tab = b.dataset.t; pintar(); } });
  $("#nbody").addEventListener("click", clic);
  setInterval(() => { if (!document.hidden) cargar(); }, 5 * 60_000);
}
export async function cargar() {
  if (N.cargando) return N.cargando;
  N.cargando = (async () => {
    const ids = A.channels.map((c) => c.id); if (!ids.length) return;
    const desde = new Date(Date.now() - 60 * 864e5).toISOString();
    const [pend, todas, yo] = await Promise.all([
      supa.from("notificaciones").select(SEL).in("channel_id", ids).eq("por_atender", true).is("resuelta_at", null).order("created_at", { ascending: false }).limit(300),
      supa.from("notificaciones").select(SEL).in("channel_id", ids).gte("created_at", desde).order("created_at", { ascending: false }).limit(250),
      supa.from("notificacion_usuario").select("leidas_hasta,prefs").maybeSingle(),
    ]);
    if (pend.error && todas.error) return;
    const m = new Map(); for (const r of [...(todas.data || []), ...(pend.data || [])]) m.set(r.id, r);
    N.rows = m;
    const idsN = [...m.keys()], lect = [];
    for (let i = 0; i < idsN.length; i += 150) { const r = await supa.from("notificacion_lecturas").select("notificacion_id,quitada_at").in("notificacion_id", idsN.slice(i, i + 150)); if (!r.error) lect.push(...(r.data || [])); }
    N.leidas = new Set(lect.map((r) => r.notificacion_id)); N.quitadas = new Set(lect.filter((r) => r.quitada_at).map((r) => r.notificacion_id));
    if (yo.data) { N.hasta = new Date(yo.data.leidas_hasta).getTime(); N.prefs = yo.data.prefs || {}; }
    else if (!yo.error) { const corte = new Date(Date.now() - 864e5).toISOString(); N.hasta = Date.parse(corte); supa.from("notificacion_usuario").insert({ user_id: A.uid, leidas_hasta: corte }).then(() => {}, () => {}); }
    campana(); if (capaAbierta("notif")) pintar();
    emit("notifPrefs", N.prefs);
  })().catch(() => {}).finally(() => { N.cargando = null; });
  return N.cargando;
}
// Tiempo real: una notificación nueva (o repetida) se muestra arriba mientras la app está abierta.
function suscribir() {
  if (N.rt) supa.removeChannel(N.rt);
  N.rt = supa.channel("nodo-app-notif-" + Math.random().toString(36).slice(2)).on("postgres_changes", { event: "*", schema: "public", table: "notificaciones" }, (p) => {
    const n = p.new; if (!n || !n.id) return;
    const antes = N.rows.get(n.id), nueva = !antes || antes.created_at !== n.created_at;
    N.rows.set(n.id, { ...(antes || {}), ...n });
    if (nueva) { N.leidas.delete(n.id); N.quitadas.delete(n.id); if (!document.hidden && (critico(n) || (TIPOS[n.tipo]?.[0] === "ventas"))) tarjeta(N.rows.get(n.id)); }
    campana(); if (capaAbierta("notif")) pintar();
    if (n.contact_id && !n.contact) cargarPronto();
  }).subscribe();
}
let _t = null; function cargarPronto() { clearTimeout(_t); _t = setTimeout(cargar, 1500); }
function tarjeta(n) {
  const el = document.createElement("div");
  el.className = "pr-" + (n.prioridad || "info"); el.setAttribute("role", "alert");
  const linea = [A.channels.length > 1 ? nomBot(n.channel_id) : "", n.detalle].filter(Boolean).join(" · ");
  el.innerHTML = `<span class="nn-ic">${ic(icDe(n))}</span><div class="nn-tb"><b>${esc(n.titulo)}</b>${linea ? `<span>${esc(linea)}</span>` : ""}</div><button class="nn-ver" type="button">Ver</button>`;
  el.querySelector(".nn-ver").onclick = (e) => { e.stopPropagation(); el._quitar && el._quitar(); abrirN(n); };
  mazo(el, 8000);
  try { navigator.vibrate?.(critico(n) ? [80, 60, 80] : 40); } catch (_) { /* */ }
}
function campana() {
  const vivas = [...N.rows.values()].filter((n) => !oculta(n));
  const pend = vivas.filter(pendiente), sinLeer = vivas.filter(cuentaSinLeer).length;
  const b = $("#bellbadge"), k = pend.length;
  b.hidden = !k && !sinLeer;
  b.textContent = k ? (k > 99 ? "99+" : String(k)) : "";
  b.className = "badge" + (k ? (pend.some((n) => n.prioridad === "urgente") ? " urg" : "") : " dot");
  $("#bellbtn").setAttribute("aria-label", k ? `Notificaciones: ${k} pendientes` : sinLeer ? `Notificaciones: ${sinLeer} sin leer` : "Notificaciones");
  emit("notifConteo", { pend: k, sinLeer });
}
function pintar() {
  const vivas = [...N.rows.values()].filter((n) => !oculta(n) && (N.bot === "todos" || n.channel_id === N.bot)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const pend = vivas.filter(pendiente), hist = vivas, sinLeer = hist.filter(cuentaSinLeer).length;
  $("#ntabs").innerHTML = `<button type="button" class="ntab${N.tab === "pend" ? " on" : ""}" data-t="pend">Pendientes${pend.length ? ` <b>${pend.length}</b>` : ""}</button><button type="button" class="ntab${N.tab === "hist" ? " on" : ""}" data-t="hist">Historial${sinLeer ? ` <b class="soft">${sinLeer}</b>` : ""}</button>`;
  const chips = A.channels.length > 1 ? `<div class="chips">${[["todos", "Todos los bots"], ...A.channels.map((c) => [c.id, c.nombre])].map(([k, l]) => `<button type="button" class="chip${N.bot === k ? " on" : ""}" data-b="${k}">${k !== "todos" ? `<img src="${esc(logoDe(k))}" alt="">` : ""}${esc(l)}</button>`).join("")}</div>` : "";
  const fila = (n) => `<button type="button" class="notif${noLeida(n) ? " nu" : ""}" data-n="${n.id}">
    <span class="ico${pendiente(n) && critico(n) ? " urg" : ""}">${ic(icDe(n))}</span>
    <span class="rmid"><b>${esc(n.titulo)}${n.repeticiones > 1 ? ` <span class="nbot">×${n.repeticiones}</span>` : ""}</b><span>${esc([n.contact?.nombre, n.detalle].filter(Boolean).join(" · "))}</span>${A.channels.length > 1 && N.bot === "todos" ? `<span class="nbot"><img src="${esc(logoDe(n.channel_id))}" alt="">${esc(nomBot(n.channel_id))}</span>` : ""}</span>
    <time>${fmtHora(n.created_at)}</time></button>`;
  let body;
  if (N.tab === "pend") {
    body = `<p class="nsub">Lo que espera que hagas algo. Se va solo cuando lo resuelves.</p>${chips}` + (pend.length ? `<div class="card">${pend.map(fila).join("")}</div>` : `<div class="empty"><b>${ic("check")}</b>Todo al día.<br>Nada espera por ustedes.</div>`);
  } else {
    const grupos = new Map();
    hist.forEach((n) => { const d = fmtDia(n.created_at); if (!grupos.has(d)) grupos.set(d, []); grupos.get(d).push(n); });
    body = `<p class="nsub">Todo lo que pasó en tus bots, por día. Lo leído se limpia solo a los 7 días.</p>${chips}
      <div class="nacts"><button type="button" class="btn soft sm" id="nleer"${sinLeer ? "" : " disabled"}>Marcar todo como leído</button><button type="button" class="btn soft sm" id="nlimpiar">Limpiar</button></div>` +
      (hist.length ? [...grupos].map(([d, ns]) => `<div class="nday">${esc(d)}</div><div class="card">${ns.map(fila).join("")}</div>`).join("") : `<div class="empty"><b>${ic("archive")}</b>El historial está limpio.</div>`);
  }
  $("#nbody").innerHTML = body;
}
function fmtDia(ts) {
  const tz = A.channels.find((c) => c.id === A.ch)?.timezone || "America/Lima";
  const k = (x) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(x);
  const d = k(new Date(ts)); if (d === k(new Date())) return "Hoy"; if (d === k(new Date(Date.now() - 864e5))) return "Ayer";
  return new Intl.DateTimeFormat("es-PE", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(ts));
}
function marcarLeida(n) {
  if (!noLeida(n)) return;
  N.leidas.add(n.id); campana();
  supa.from("notificacion_lecturas").insert({ user_id: A.uid, notificacion_id: n.id }).then(() => {}, () => {});
}
async function abrirN(n) {
  marcarLeida(n);
  if (n.channel_id !== A.ch && A.channels.some((c) => c.id === n.channel_id)) await cambiarBot(n.channel_id);
  if (VALIDAR.has(n.tipo)) { ir("pagos"); return; }
  if (["pedido_lima", "pedido_provincia", "cambio_tras_despacho", "entrega_pedida"].includes(n.tipo) && A.tipo === "fisico") { ir("t4"); return; }
  if (["microapp_sin_correo", "cuenta_compartida"].includes(n.tipo)) { ir("t4"); return; }
  if (n.contact_id) { emit("abrirChat", n.contact_id); return; }
  toast("Esto se revisa en el panel de la compu");
}
async function clic(e) {
  const ch = e.target.closest("[data-b]"); if (ch) { N.bot = ch.dataset.b; pintar(); return; }
  if (e.target.closest("#nleer")) {
    const antes = N.hasta; N.hasta = Date.now(); campana(); pintar();
    const { data, error } = await supa.rpc("notif_marcar_todas");
    if (error) { N.hasta = antes; campana(); pintar(); toast("No se pudo marcar todo como leído", true); return; }
    if (data) N.hasta = Date.parse(data); N.leidas.clear(); return;
  }
  if (e.target.closest("#nlimpiar")) {
    const lista = [...N.rows.values()].filter((n) => !oculta(n) && !pendiente(n) && (N.bot === "todos" || n.channel_id === N.bot)).map((n) => n.id);
    if (!lista.length) { toast("No hay nada que limpiar"); return; }
    lista.forEach((id) => N.quitadas.add(id)); campana(); pintar();
    const { error } = await supa.rpc("notif_quitar", { p_ids: lista });
    if (error) { lista.forEach((id) => N.quitadas.delete(id)); campana(); pintar(); toast("No se pudo limpiar", true); return; }
    toast(`Se quitaron ${lista.length} notificaci${lista.length === 1 ? "ón" : "ones"}. Lo pendiente se queda.`); return;
  }
  const it = e.target.closest("[data-n]"); if (!it) return;
  const n = N.rows.get(it.dataset.n); if (n) abrirN(n);
}
