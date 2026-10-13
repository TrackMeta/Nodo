// «Más»: notificaciones, tus bots (encender/apagar, como Canales), qué avisos me llegan (se guardan en
// notificacion_usuario.prefs.app y los usa la función `push`), tema, panel completo y cerrar sesión.
import { A, $, esc, ic, on, emit, supa, abrirCapa, hoja, confirmar, toast, pintaBot, logoDe, temaPref, ponerTema } from "./app.js";
import { updateChannel } from "../shell.js";
import { N } from "./notif.js";

// Tipos de aviso que puede silenciar cada persona en su celular. Lo urgente (pagos por validar, pide humano,
// WhatsApp en riesgo) se puede bajar de volumen pero nunca apagar del todo (igual que en la campanita).
export const AV_TIPOS = [
  { k: "pagos", lb: "Pagos por validar", d: "Ventas, adelantos, saldos y prepagos de Lima", ic: "banknote", urg: true, son: "alarma" },
  { k: "humano", lb: "Cliente pide una persona", d: "Cuando el bot se pausa y espera que alguien tome el chat", ic: "user", urg: true, son: "alarma" },
  { k: "ventas", lb: "Ventas y pedidos nuevos", d: "Cada venta que cierra el bot", ic: "party", son: "caja" },
  { k: "atencion", lb: "Otros avisos de clientes", d: "Mayoristas, cambios de entrega, preguntas, vuelto…", ic: "message", son: "campana" },
  { k: "sistema", lb: "Tu WhatsApp y el sistema", d: "Restricción de Meta, campañas detenidas, stock", ic: "shield", urg: true, son: "alarma" },
];
export const SONIDOS = [["alarma", "Alarma insistente"], ["campana", "Campana"], ["caja", "Caja registradora"], ["normal", "Sonido del celular"], ["silencio", "Sin sonido (solo aparece)"]];
const defApp = () => ({ tipos: Object.fromEntries(AV_TIPOS.map((t) => [t.k, true])), sonidos: Object.fromEntries(AV_TIPOS.map((t) => [t.k, t.son])), bots: {}, dnd: { on: false, desde: "23:00", hasta: "07:00", urg: true } });
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
function pintar() {
  const vivas = [...N.rows.values()].filter((n) => n.por_atender && !n.resuelta_at).length;
  const tema = temaPref(), TEMA_LBL = { auto: "Automático (como el celular)", light: "Claro", dark: "Oscuro" };
  $("#masPad").innerHTML = `<h2 class="h">Más</h2>
    <div class="card"><button type="button" class="li" data-go="notif"><span class="ico">${ic("bell")}</span><span class="rmid"><b>Notificaciones</b><span>${vivas ? `${vivas} pendiente${vivas === 1 ? "" : "s"}` : "Todo al día"}</span></span>${ic("chevronRight")}</button>
      <button type="button" class="li" data-go="avisos"><span class="ico">${ic("config")}</span><span class="rmid"><b>Qué avisos me llegan</b><span>Por tipo, por bot, sonido y No molestar</span></span>${ic("chevronRight")}</button>
      ${A.tieneApps && A.tipo !== "apps" ? `<button type="button" class="li" data-go="accesos"><span class="ico">${ic("key")}</span><span class="rmid"><b>Accesos de micro apps</b><span>Este bot también vende apps</span></span>${ic("chevronRight")}</button>` : ""}</div>
    <div class="card"><div class="ttl">Tus bots</div>${A.channels.map((c) => `<div class="li"><span class="ico"><img src="${esc(logoDe(c.id))}" alt=""></span><span class="rmid"><b>${esc(c.nombre)}</b><span>${c.bot_apagado ? "Apagado · el bot no contesta" : "Encendido"}${c.id === A.ch ? " · el que estás viendo" : ""}</span></span><button type="button" class="sw${c.bot_apagado ? "" : " on"}" data-sw="${c.id}" aria-label="Encender o apagar ${esc(c.nombre)}"></button></div>`).join("")}</div>
    <div class="card"><div class="ttl">Pantalla</div>
      <button type="button" class="li" data-go="tema"><span class="ico">${ic(tema === "light" ? "sun" : "moon")}</span><span class="rmid"><b>Tema</b><span>${TEMA_LBL[tema] || TEMA_LBL.auto}</span></span>${ic("chevronRight")}</button></div>
    <div class="card"><div class="ttl">Cuenta</div>
      <a class="li" href="../index.html" style="color:inherit;text-decoration:none"><span class="ico">${ic("panel")}</span><span class="rmid"><b>Abrir el panel completo</b><span>Productos, flujos, campañas y ajustes</span></span>${ic("chevronRight")}</a>
      <button type="button" class="li" data-go="salir"><span class="ico">${ic("logout")}</span><span class="rmid"><b>Cerrar sesión</b><span>${esc(A.email)}</span></span></button></div>
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
  const g = e.target.closest("[data-go]"); if (!g) return;
  const k = g.dataset.go;
  if (k === "notif") emit("abrirNotif");
  else if (k === "avisos") { pintaAvisos(); abrirCapa("avisos"); }
  else if (k === "accesos") toast("Cambia a un bot de micro apps o ábrelo en el panel");
  else if (k === "tema") hoja("Tema", [{ t: "Automático (como el celular)", v: "auto", on: temaPref() === "auto" }, { t: "Claro", v: "light", on: temaPref() === "light" }, { t: "Oscuro", v: "dark", on: temaPref() === "dark" }], (o) => { ponerTema(o.v); pintar(); });
  else if (k === "salir") { if (await confirmar("Cerrar sesión", "Tendrás que volver a entrar con tu correo y contraseña. Este celular dejará de recibir avisos.", { si: "Cerrar sesión", peligro: true })) { emit("salir"); setTimeout(() => supa.auth.signOut(), 400); } }
}

// ═════════ Qué avisos me llegan ═════════
function pintaAvisos() {
  const d = APP.dnd;
  $("#avbody").innerHTML = `
    <p class="nsub">Esto es solo para este usuario y su celular. Lo que apagues no suena, pero sigue apareciendo en la campanita.</p>
    <div class="card"><div class="ttl">Por tipo</div>${AV_TIPOS.map((t) => `
      <div class="arow"><span class="ico">${ic(t.ic)}</span>
        <button type="button" class="rmid" data-son="${t.k}"><b>${t.lb} ${t.urg ? '<span class="urgtag">Urgente</span>' : ""}</b><span>${t.d}</span><span style="color:var(--brand)">Sonido: ${esc((SONIDOS.find((s) => s[0] === APP.sonidos[t.k]) || SONIDOS[3])[1])}</span></button>
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
  if (b.dataset.tipo) { const t = AV_TIPOS.find((x) => x.k === b.dataset.tipo); if (t.urg && APP.tipos[t.k] !== false && !(await confirmar("Apagar un aviso urgente", `Si apagas «${t.lb}» no te sonará el celular cuando pase. Igual lo verás en la campanita.`, { si: "Apagar igual", peligro: true }))) return; APP.tipos[t.k] = APP.tipos[t.k] === false; }
  else if (b.dataset.avbot) APP.bots[b.dataset.avbot] = APP.bots[b.dataset.avbot] === false;
  else if (b.dataset.son) { const t = AV_TIPOS.find((x) => x.k === b.dataset.son); hoja(`Sonido · ${t.lb}`, SONIDOS.map(([k, l]) => ({ t: l, v: k, on: APP.sonidos[t.k] === k })), (o) => { APP.sonidos[t.k] = o.v; guardar(); pintaAvisos(); }); return; }
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
