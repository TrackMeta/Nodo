// «Más»: notificaciones, tus bots (encender/apagar, como Canales), qué avisos me llegan (se guardan en
// notificacion_usuario.prefs: los sonidos se COMPARTEN con la campanita web; lo propio del celular en prefs.app),
// tema, panel completo y cerrar sesión.
import { A, $, esc, ic, on, emit, supa, invoke, abrirCapa, confirmar, toast, pintaBot, logoDe, temaPref, ponerTema, cambiarBot, iniciales } from "./app.js";
import { updateChannel } from "../shell.js";
import { N } from "./notif.js";
import { TONOS_URGENTE, TONOS_VENTA, escuchar } from "./sonidos.js";

// Tipos de aviso que puede apagar cada persona en su celular (igual siguen en la campanita).
export const AV_TIPOS = [
  { k: "pagos", lb: "Pagos por validar", d: "Ventas, adelantos, saldos y prepagos de Lima", ic: "banknote", urg: true },
  { k: "humano", lb: "Cliente pide una persona", d: "Cuando el bot se pausa y espera que alguien tome el chat", ic: "user", urg: true },
  { k: "ventas", lb: "Ventas y pedidos nuevos", d: "Cada venta que cierra el bot", ic: "party" },
  { k: "atencion", lb: "Otros avisos de clientes", d: "Mayoristas, cambios de entrega, preguntas, vuelto…", ic: "message" },
  { k: "sistema", lb: "Tu WhatsApp y el sistema", d: "Restricción de Meta, campañas detenidas, stock", ic: "shield", urg: true },
];
const defApp = () => ({ tipos: Object.fromEntries(AV_TIPOS.map((t) => [t.k, true])), otros: "suave", bots: {}, dnd: { on: false, desde: "23:00", hasta: "07:00", urg: true } });
let APP = defApp();

export function init() {
  on("tab", (t) => { if (t === "mas") pintar(); });
  on("notifPrefs", (p) => { APP = { ...defApp(), ...(p?.app || {}) }; APP.dnd = { ...defApp().dnd, ...(APP.dnd || {}) }; });
  on("notifConteo", () => { if (A.tab === "mas") pintar(); });
  on("logos", () => { if (A.tab === "mas") pintar(); });
  $("#masPad").addEventListener("click", clic);
  $("#avbody").addEventListener("click", clicAvisos);
  $("#avbody").addEventListener("change", (e) => { if (e.target.id === "dnd1") { APP.dnd.desde = e.target.value; guardar(); } if (e.target.id === "dnd2") { APP.dnd.hasta = e.target.value; guardar(); } });
}
// Número de WhatsApp (API) del bot que estás viendo: lo pregunta a Meta (channel-config · whatsapp_test, solo lectura)
const NUM = new Map();   // canal → { telefono, nombre, calidad } | { error }
const CALIDAD = { GREEN: ["alta", "up"], YELLOW: ["media", "warnc"], RED: ["baja", "down"] };
async function cargarNumero(ch) {
  if (NUM.has(ch)) return;
  NUM.set(ch, null);
  const x = await invoke("channel-config", { action: "whatsapp_test", channel_id: ch });
  const d = x.data || {};
  NUM.set(ch, d.numero?.telefono ? d.numero : { error: d.configurado === false ? "Este bot todavía no tiene un número de WhatsApp conectado." : d.numero_error || "No se pudo consultar a Meta." });
  if (A.tab === "mas" && A.ch === ch) pintar();
}
function numeroHtml() {
  const n = NUM.get(A.ch);
  if (!n) return `<div class="li"><span class="ico">${ic("phone")}</span><span class="rmid"><b>Número de WhatsApp</b><span>Consultando a Meta…</span></span></div>`;
  if (n.error) return `<div class="li"><span class="ico">${ic("phone")}</span><span class="rmid"><b>Número de WhatsApp</b><span>${esc(n.error)}</span></span></div>`;
  const q = CALIDAD[n.calidad];
  return `<button type="button" class="li" data-go="copiarNum"><span class="ico">${ic("phone")}</span><span class="rmid"><b>${esc(n.telefono)}</b><span>${esc(n.nombre || "Número de WhatsApp")}${q ? ` · calidad <b class="${q[1]}">${q[0]}</b>` : ""}</span></span><span class="mcopy">${ic("copy")}Copiar</span></button>`;
}
// «Más», reordenado (21-oct, «me parece un poco confuso»): quién eres → el bot que estás viendo (encendido + su
// número) → tus otros bots (tocar = verlo) → avisos → apariencia (tema en el momento) → cerrar sesión.
// Se quitó «Abrir el panel completo».
const TEMAS = [["auto", "Automático"], ["light", "Claro"], ["dark", "Oscuro"]];
function pintar() {
  cargarNumero(A.ch);
  const vivas = [...N.rows.values()].filter((n) => n.por_atender && !n.resuelta_at).length;
  const tema = temaPref(), ch = A.channels.find((c) => c.id === A.ch) || {}, otros = A.channels.filter((c) => c.id !== A.ch);
  const estado = (c) => c.bot_apagado ? "Apagado · no contesta a nadie" : "Encendido · contesta solo";
  $("#masPad").innerHTML = `<h2 class="h">Más</h2>
    <div class="mperfil"><span class="mav">${esc(iniciales(A.nombre, A.email))}</span><span class="rmid"><b>${esc(A.nombre || "Tu cuenta")}</b><span>${esc(A.email)}</span></span></div>

    <div class="card"><div class="ttl">Bot que estás viendo</div>
      <div class="li mbot"><span class="ico"><img src="${esc(logoDe(ch.id))}" alt=""></span><span class="rmid"><b>${esc(ch.nombre || "Bot")}</b><span class="${ch.bot_apagado ? "mutc" : "up"}">${estado(ch)}</span></span><button type="button" class="sw${ch.bot_apagado ? "" : " on"}" data-sw="${esc(ch.id)}" aria-label="Encender o apagar ${esc(ch.nombre || "el bot")}"></button></div>
      ${numeroHtml()}
      ${A.tieneApps && A.tipo !== "apps" ? `<button type="button" class="li" data-go="accesos"><span class="ico">${ic("key")}</span><span class="rmid"><b>Accesos de micro apps</b><span>Este bot también vende apps</span></span>${ic("chevronRight")}</button>` : ""}
    </div>

    ${otros.length ? `<div class="card"><div class="ttl">Tus otros bots</div>${otros.map((c) => `<div class="li"><button type="button" class="mver" data-ver="${esc(c.id)}"><span class="ico"><img src="${esc(logoDe(c.id))}" alt=""></span><span class="rmid"><b>${esc(c.nombre)}</b><span>${estado(c)} · toca para verlo</span></span></button><button type="button" class="sw${c.bot_apagado ? "" : " on"}" data-sw="${esc(c.id)}" aria-label="Encender o apagar ${esc(c.nombre)}"></button></div>`).join("")}</div>` : ""}

    <div class="card"><div class="ttl">Avisos</div>
      <button type="button" class="li" data-go="notif"><span class="ico">${ic("bell")}</span><span class="rmid"><b>Notificaciones</b><span>${vivas ? `${vivas} por atender` : "Todo al día"}</span></span>${vivas ? `<span class="mnum">${vivas > 99 ? "99+" : vivas}</span>` : ic("chevronRight")}</button>
      <button type="button" class="li" data-go="avisos"><span class="ico">${ic("config")}</span><span class="rmid"><b>Qué avisos me llegan</b><span>Sonidos, por tipo, por bot y No molestar</span></span>${ic("chevronRight")}</button>
    </div>

    <div class="card"><div class="ttl">Apariencia</div>
      <div class="mtema"><div class="seg" role="group" aria-label="Tema">${TEMAS.map(([k, l]) => `<button type="button" class="${tema === k ? "on" : ""}" data-tema="${k}">${l}</button>`).join("")}</div>
      <p class="nsub">Automático sigue el modo claro u oscuro de tu celular.</p></div>
    </div>

    <button type="button" class="msalir" data-go="salir">${ic("logout")}Cerrar sesión</button>
    <p class="note">Nodo · app ${esc(window.NODO_APP_VERSION || "1.0")}</p>`;
}
async function clic(e) {
  const sw = e.target.closest("[data-sw]");
  if (sw) {
    const c = A.channels.find((x) => x.id === sw.dataset.sw); if (!c) return;
    const prender = !!c.bot_apagado;
    if (!prender && !(await confirmar(`Apagar el bot ${c.nombre}`, "El bot deja de contestar en TODOS los chats de este número hasta que lo vuelvas a encender. Los clientes que escriban quedan sin respuesta automática.", { si: "Apagar el bot", peligro: true }))) return;
    const { error } = await updateChannel(c.id, { bot_apagado: !prender });
    if (error) { toast(error.message || "No se pudo cambiar", true); return; }
    c.bot_apagado = !prender; pintaBot(); pintar();
    toast(prender ? `${c.nombre}: bot encendido` : `${c.nombre}: bot apagado`);
    return;
  }
  const tm = e.target.closest("[data-tema]");
  if (tm) { ponerTema(tm.dataset.tema); pintar(); return; }
  const vb = e.target.closest("[data-ver]");
  if (vb) { await cambiarBot(vb.dataset.ver); toast("Ahora estás viendo " + (A.channels.find((c) => c.id === vb.dataset.ver)?.nombre || "ese bot")); pintar(); return; }
  const g = e.target.closest("[data-go]"); if (!g) return;
  const k = g.dataset.go;
  if (k === "notif") emit("abrirNotif");
  else if (k === "avisos") { pintaAvisos(); abrirCapa("avisos"); }
  else if (k === "copiarNum") { const t = NUM.get(A.ch)?.telefono || ""; try { await navigator.clipboard.writeText(t.replace(/[^\d+]/g, "")); toast("Número copiado"); } catch (_) { toast(t); } }
  else if (k === "accesos") toast("Para ver los accesos, elige un bot de micro apps o ábrelos desde el panel web de Nodo.");
  else if (k === "salir") { if (await confirmar("Cerrar sesión", "Tendrás que volver a entrar con tu correo y contraseña. Este celular dejará de recibir avisos.", { si: "Cerrar sesión", peligro: true })) { emit("salir"); setTimeout(() => supa.auth.signOut(), 400); } }
}

// ═════════ Qué avisos me llegan ═════════
// Los sonidos son LOS MISMOS de la campanita web y se comparten con ella (prefs.sonido, prefs.tonoUrgente,
// prefs.venta): si los cambias aquí, cambian en el panel, y al revés.
const P = () => N.prefs || {};
const tonoU = () => (TONOS_URGENTE.some((t) => t[0] === P().tonoUrgente) ? P().tonoUrgente : "suave");
const venta = () => ({ sonido: true, tono: "caja", volumen: 70, ...(P().venta || {}) });
const tonos = (lista, actual, attr, off) => `<div class="tonos${off ? " off" : ""}">${lista.map(([k, l, d]) => `<button type="button" class="tono${actual === k ? " on" : ""}" ${attr}="${k}" title="${esc(d)}">${ic(actual === k ? "check" : "play")}<span>${l}</span></button>`).join("")}</div>`;
function pintaAvisos() {
  const d = APP.dnd, v = venta();
  $("#avbody").innerHTML = `
    <p class="nsub">Solo para tu usuario. Lo que apagues no suena, pero sigue apareciendo en la campanita. Los sonidos son los mismos del panel web: si los cambias aquí, cambian allá también.</p>
    <div class="card"><div class="ttl">Sonidos</div>
      <div class="arow"><span class="ico">${ic("alert")}</span><span class="rmid"><b>Lo urgente</b><span>Pagos por validar, cliente que pide una persona, tu WhatsApp en riesgo</span></span><button type="button" class="sw${P().sonido !== false ? " on" : ""}" id="swUrg" aria-label="Sonido de lo urgente"></button></div>
      ${tonos(TONOS_URGENTE, tonoU(), "data-tu", P().sonido === false)}
      <div class="arow"><span class="ico">${ic("banknote")}</span><span class="rmid"><b>Las ventas</b><span>Plata que entró o una venta ya comprometida</span></span><button type="button" class="sw${v.sonido !== false ? " on" : ""}" id="swVenta" aria-label="Sonido de las ventas"></button></div>
      ${tonos(TONOS_VENTA, v.tono, "data-tv", v.sonido === false)}
      <div class="arow"><span class="ico">${ic("message")}</span><span class="rmid"><b>Los demás avisos</b><span>Mayoristas, preguntas, cambios de entrega… (con el sonido suave)</span></span><button type="button" class="sw${APP.otros !== "silencio" ? " on" : ""}" id="swOtros" aria-label="Sonido de los demás avisos"></button></div>
      <p class="nsub" style="padding:0 14px 12px">Toca un sonido para escucharlo. El volumen lo pone el celular.</p></div>
    <div class="card"><div class="ttl">Qué avisos me llegan</div>${AV_TIPOS.map((t) => `
      <div class="arow"><span class="ico">${ic(t.ic)}</span><span class="rmid"><b>${t.lb} ${t.urg ? '<span class="urgtag">Urgente</span>' : ""}</b><span>${t.d}</span></span>
        <button type="button" class="sw${APP.tipos[t.k] !== false ? " on" : ""}" data-tipo="${t.k}" aria-label="Avisar: ${t.lb}"></button></div>`).join("")}</div>
    ${A.channels.length > 1 ? `<div class="card"><div class="ttl">Por bot</div>${A.channels.map((c) => `<div class="arow"><span class="ico"><img src="${esc(logoDe(c.id))}" alt=""></span><span class="rmid"><b>${esc(c.nombre)}</b></span><button type="button" class="sw${APP.bots[c.id] !== false ? " on" : ""}" data-avbot="${c.id}" aria-label="Avisos de ${esc(c.nombre)}"></button></div>`).join("")}</div>` : ""}
    <div class="card"><div class="ttl">No molestar</div>
      <div class="arow"><span class="ico">${ic("moon")}</span><span class="rmid"><b>Silenciar de noche</b><span>Los avisos llegan sin sonido en ese horario</span></span><button type="button" class="sw${d.on ? " on" : ""}" id="dndsw" aria-label="No molestar"></button></div>
      ${d.on ? `<div class="horas"><label>Desde <input type="time" id="dnd1" value="${esc(d.desde)}"></label><label>hasta <input type="time" id="dnd2" value="${esc(d.hasta)}"></label></div>
      <div class="arow"><span class="ico">${ic("alert")}</span><span class="rmid"><b>Dejar sonar lo urgente</b><span>Pagos por validar, cliente que pide una persona y tu WhatsApp en riesgo</span></span><button type="button" class="sw${d.urg ? " on" : ""}" id="dndurg" aria-label="Dejar sonar lo urgente"></button></div>` : ""}</div>
    <button type="button" class="btn soft" id="avProbar">${ic("bell")} Mandarme un aviso de prueba</button>`;
}
async function clicAvisos(e) {
  const b = e.target.closest("button"); if (!b) return;
  const pr = { ...P() };
  if (b.dataset.tu) { escuchar(b.dataset.tu); pr.tonoUrgente = b.dataset.tu; pr.sonido = true; N.prefs = pr; }
  else if (b.dataset.tv) { escuchar(b.dataset.tv); pr.venta = { ...venta(), tono: b.dataset.tv, sonido: true }; N.prefs = pr; }
  else if (b.id === "swUrg") {
    if (pr.sonido !== false && !(await confirmar("Silenciar lo urgente", "Los pagos por validar y los clientes que piden una persona llegarán sin sonido (en el celular y en el panel).", { si: "Silenciar igual", peligro: true }))) return;
    pr.sonido = pr.sonido === false; N.prefs = pr;
  }
  else if (b.id === "swVenta") { pr.venta = { ...venta(), sonido: venta().sonido === false }; N.prefs = pr; }
  else if (b.id === "swOtros") APP.otros = APP.otros === "silencio" ? "suave" : "silencio";
  else if (b.dataset.tipo) {
    const t = AV_TIPOS.find((x) => x.k === b.dataset.tipo);
    if (t.urg && APP.tipos[t.k] !== false && !(await confirmar("Apagar un aviso urgente", `Si apagas «${t.lb}» no te llegará al celular cuando pase. Igual lo verás en la campanita.`, { si: "Apagar igual", peligro: true }))) return;
    APP.tipos[t.k] = APP.tipos[t.k] === false;
  }
  else if (b.dataset.avbot) APP.bots[b.dataset.avbot] = APP.bots[b.dataset.avbot] === false;
  else if (b.id === "dndsw") APP.dnd.on = !APP.dnd.on;
  else if (b.id === "dndurg") APP.dnd.urg = !APP.dnd.urg;
  else if (b.id === "avProbar") { emit("pushPrueba"); return; }
  else return;
  await guardar(); pintaAvisos();
}
async function guardar() {
  const prefs = { ...(N.prefs || {}), app: APP };
  N.prefs = prefs;
  const { error } = await supa.from("notificacion_usuario").upsert({ user_id: A.uid, prefs, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) toast("No se pudo guardar: " + error.message, true);
}
