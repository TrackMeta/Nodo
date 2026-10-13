// ═══════════════════════════════════════════════════════════════════
// Nodo · app de celular — núcleo (panel/app/). Reusa el cliente Supabase,
// los íconos y el aviso chico del panel (shell.js) sin montar su cascarón.
// Pantallas: Chats · Pagos · 4.ª según el tipo de bot (Ventas / Pedidos /
// Accesos) · Hoy · Más, y encima: chat, ficha, filtros, notificaciones…
// ═══════════════════════════════════════════════════════════════════
import { supa, SUPABASE_URL, SUPABASE_ANON_KEY, conRegion, icon, toast as toastPanel } from "../shell.js";
import { setTZ } from "../date-range.js";

export { supa, SUPABASE_URL, SUPABASE_ANON_KEY };
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const toast = (m, err) => toastPanel(m, err);

// Íconos: los del panel (icon() de shell.js) + los del compositor de la Bandeja, que allá están escritos en línea.
const svgI = (p) => `<svg class="i" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const APP_IC = {
  qr: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  robot: '<rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  tick: '<path d="M20 6 9 17l-5-5"/>',
  tick2: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
  map: '<path d="M14.1 6 9.9 4 3 6.9V20l6.9-2.9 4.2 2 6.9-2.9V4z"/><path d="M9.9 4v13.1M14.1 6v14"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
};
export const ic = (n) => (APP_IC[n] ? svgI(APP_IC[n]) : icon(n, "i"));
export function pintaIconos(root = document) { $$("[data-ic]", root).forEach((e) => { e.innerHTML = ic(e.dataset.ic); e.removeAttribute("data-ic"); }); }

// ── Estado compartido ──
export const A = {
  uid: null, email: "", nombre: "",
  channels: [], ch: null, tipo: "digital", tieneApps: false, logos: {},
  tab: "chats",
};
const BUS = new Map();
export const on = (ev, fn) => { if (!BUS.has(ev)) BUS.set(ev, new Set()); BUS.get(ev).add(fn); };
export const emit = (ev, d) => (BUS.get(ev) || []).forEach((fn) => { try { fn(d); } catch (e) { console.error(ev, e); } });

// ── Tema: «Automático» sigue al celular (claro u oscuro); también se puede fijar. No toca el tema del panel. ──
const TEMA_KEY = "nodo.app.tema";
export const temaPref = () => { try { return localStorage.getItem(TEMA_KEY) || "auto"; } catch (_) { return "auto"; } };
const _mqClaro = matchMedia("(prefers-color-scheme: light)");
export function aplicarTema() {
  const p = temaPref(), t = p === "auto" ? (_mqClaro.matches ? "light" : "dark") : p;
  document.documentElement.dataset.theme = t;
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = t === "light" ? "#FFFFFF" : "#131A26";
  emit("tema", t);
}
export function ponerTema(p) { try { localStorage.setItem(TEMA_KEY, p); } catch (_) { /* */ } aplicarTema(); }
aplicarTema();
_mqClaro.addEventListener?.("change", () => { if (temaPref() === "auto") aplicarTema(); });

// Logos de los bots (channels.logo_url); sin logo, el de Nodo (como el panel)
export const NODO_LOGO = "../../assets/logo-128.png";
export const logoDe = (id) => (A.logos && A.logos[id]) || NODO_LOGO;

// Funciones edge con la sesión del usuario (igual que callFn de la Bandeja).
export async function callFn(name, body) {
  const { data: { session } } = await supa.auth.getSession();
  const r = await fetch(conRegion(`${SUPABASE_URL}/functions/v1/${name}`), {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch (_) { /* sin cuerpo */ }
  return { ok: r.ok && j?.error == null, status: r.status, data: j };
}
export async function invoke(name, body) {
  const { data, error } = await supa.functions.invoke(name, { body });
  if (error) {
    let det = null; try { det = await error.context?.json?.(); } catch (_) { /* */ }
    return { ok: false, data: det, error };
  }
  return { ok: data?.error == null, data };
}

// ── Formatos ──
const COL = ["#2563EB", "#7C3AED", "#0E9F6E", "#D97706", "#DB2777", "#0891B2", "#4F46E5", "#B42318"];
export const iniciales = (n, wa) => { const s = String(n || wa || "?").trim(); const p = s.split(/\s+/).filter(Boolean); return ((p[0]?.[0] || "?") + (p[1]?.[0] || "")).toUpperCase(); };
export const colorDe = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COL[h % COL.length]; };
const WHO = { bot: ["robot", "Lo atiende el bot"], yo: ["user", "Lo atiende una persona"], espera: ["clock", "Espera que alguien lo tome"] };
export const quienDe = (c) => (c?.bot_activo !== false ? "bot" : c?.requiere_humano ? "espera" : "yo");
export const whoTxt = (w) => WHO[w][1];
// Esquina de la foto: el emoji del producto que le interesa (como la Bandeja); si no hay, quién atiende el chat.
export function avatar(id, nombre, wa, who, emoji) {
  const esquina = emoji ? `<span class="av-emoji">${esc(emoji)}</span>` : who ? `<span class="who ${who}" title="${WHO[who][1]}">${ic(WHO[who][0])}</span>` : "";
  return `<span class="av" style="background:${colorDe(id)}">${esc(iniciales(nombre, wa))}${esquina}</span>`;
}
export const TZ = () => A.channels.find((c) => c.id === A.ch)?.timezone || "America/Lima";
export function fmtHora(ts) {
  if (!ts) return "";
  const d = new Date(ts), tz = TZ();
  const dia = (x) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  const hoy = dia(new Date()), ayer = dia(new Date(Date.now() - 864e5)), dd = dia(d);
  if (dd === hoy) return new Intl.DateTimeFormat("es-PE", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
  if (dd === ayer) return "Ayer";
  if (Date.now() - d < 6 * 864e5) return new Intl.DateTimeFormat("es-PE", { timeZone: tz, weekday: "short" }).format(d);
  return new Intl.DateTimeFormat("es-PE", { timeZone: tz, day: "numeric", month: "short" }).format(d);
}
export const fmtDiaLargo = (ts) => new Intl.DateTimeFormat("es-PE", { timeZone: TZ(), weekday: "long", day: "numeric", month: "long" }).format(new Date(ts));
export const hhmm = (ts) => new Intl.DateTimeFormat("es-PE", { timeZone: TZ(), hour: "numeric", minute: "2-digit" }).format(new Date(ts));
export const sol = (n, cur = "PEN") => (cur === "PEN" ? "S/ " : cur + " ") + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("es-PE", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });

// ═════════ Navegación: pestañas + pantallas encima (con el botón «atrás» de Android) ═════════
// Un solo «centinela» en el historial mientras haya algo abierto encima: el «atrás» del celular cierra lo de más
// arriba (visor → hoja → pantalla) y, si queda algo abierto, se vuelve a poner el centinela.
const PILA = [];   // pantallas abiertas encima, de abajo hacia arriba: {id, cerrar}
let _centinela = false, _saltarPop = 0;
function ponerCentinela() { if (!_centinela) { history.pushState({ nodo: 1 }, ""); _centinela = true; } }
function algoAbierto() { return PILA.length > 0 || !!_hoja || !$("#viewer").hidden; }
function quitarCentinela() { if (_centinela && !algoAbierto()) { _centinela = false; _saltarPop++; history.back(); } }
export function abrirCapa(id, cerrar) {
  const v = $("#v-" + id); if (!v) return;
  if (!PILA.some((p) => p.id === id)) PILA.push({ id, cerrar });
  v.classList.remove("away"); v.setAttribute("aria-hidden", "false");
  ponerCentinela();
}
function ocultarCapa(id) { const v = $("#v-" + id); if (v) { v.classList.add("away"); v.setAttribute("aria-hidden", "true"); } }
export function cerrarCapa(id) {
  const i = PILA.findIndex((p) => p.id === id); if (i < 0) return;
  const quitar = PILA.splice(i);   // la capa y todo lo que tenga encima
  quitar.reverse().forEach((p) => { ocultarCapa(p.id); try { p.cerrar && p.cerrar(); } catch (_) { /* */ } });
  quitarCentinela();
}
export const capaAbierta = (id) => PILA.some((p) => p.id === id);
export const cerrarTodo = () => { if (PILA.length) cerrarCapa(PILA[0].id); };
function cerrarLoDeArriba() {
  if (!$("#viewer").hidden) { $("#viewer").hidden = true; return; }
  if (_hoja) { _hoja = null; $("#sheet").classList.remove("on"); $("#sheetbg").classList.remove("on"); return; }
  const p = PILA.pop(); if (!p) return;
  ocultarCapa(p.id); try { p.cerrar && p.cerrar(); } catch (_) { /* */ }
}
addEventListener("popstate", () => {
  if (_saltarPop > 0) { _saltarPop--; return; }
  _centinela = false;
  cerrarLoDeArriba();
  if (algoAbierto()) ponerCentinela();
});
export const atras = () => { cerrarLoDeArriba(); quitarCentinela(); };
document.addEventListener("click", (e) => { if (e.target.closest("[data-back]")) atras(); });

export function ir(tab) {
  // cerrar todo lo de encima
  if (PILA.length) cerrarCapa(PILA[0].id);
  A.tab = tab;
  $$(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  ["chats", "pagos", "t4", "hoy", "mas"].forEach((v) => ($("#v-" + v).hidden = v !== tab));
  $("#v-" + tab).scrollTop = 0;
  emit("tab", tab);
}
$("#tabs").addEventListener("click", (e) => { const b = e.target.closest(".tab"); if (b) ir(b.dataset.tab); });

// ── Hoja de abajo ──
let _hoja = null;
export function abrirHoja(html, bind) {
  const sh = $("#sheet"), bg = $("#sheetbg");
  sh.innerHTML = `<div class="grab"></div>` + html;
  pintaIconos(sh);
  _hoja = { abierta: true };
  ponerCentinela();
  bg.onclick = () => cerrarHoja();
  bind && bind(sh, cerrarHoja);
  bg.classList.add("on"); sh.classList.add("on");
  sh.scrollTop = 0;
}
export function cerrarHoja() {
  if (!_hoja) return;
  _hoja = null; $("#sheet").classList.remove("on"); $("#sheetbg").classList.remove("on");
  quitarCentinela();
}
export function hoja(titulo, ops, alElegir, lead) {
  abrirHoja(`<h3>${esc(titulo)}</h3>${lead ? `<p class="lead">${esc(lead)}</p>` : ""}` + ops.map((o, i) => `<button type="button" class="opt${o.on ? " on" : ""}" data-i="${i}">${o.img ? `<img class="oimg" src="${esc(o.img)}" alt="">` : ""}${o.icono ? ic(o.icono) : ""}${o.dot ? `<span class="dot" style="background:${o.dot}"></span>` : ""}${esc(o.t)}${o.on ? " " + ic("check") : ""}${o.small ? `<small>${esc(o.small)}</small>` : ""}</button>`).join(""),
    (sh, cerrar) => sh.querySelectorAll(".opt").forEach((b) => (b.onclick = () => { cerrar(); alElegir && setTimeout(() => alElegir(ops[+b.dataset.i]), 200); })));
}
// Confirmación en la hoja (las acciones con plata o con aviso al cliente se confirman)
export function confirmar(titulo, texto, { si = "Sí", no = "Cancelar", peligro = false } = {}) {
  return new Promise((res) => {
    let r = false;
    abrirHoja(`<h3>${esc(titulo)}</h3><p class="lead">${esc(texto)}</p><div class="grid2"><button type="button" class="btn soft" id="cNo">${esc(no)}</button><button type="button" class="btn ${peligro ? "ghost" : "blue"}" id="cSi">${esc(si)}</button></div>`, (sh, cerrar) => {
      $("#cNo", sh).onclick = () => cerrar();
      $("#cSi", sh).onclick = () => { r = true; cerrar(); };
    });
    const t = setInterval(() => { if (!_hoja) { clearInterval(t); res(r); } }, 120);
  });
}
// Pedir un texto en la hoja
export function pedirTexto(titulo, { lead = "", valor = "", ph = "", boton = "Guardar", multilinea = false, tipo = "text" } = {}) {
  return new Promise((res) => {
    let r = null;
    abrirHoja(`<h3>${esc(titulo)}</h3>${lead ? `<p class="lead">${esc(lead)}</p>` : ""}${multilinea ? `<textarea class="inpt" id="ptx" placeholder="${esc(ph)}">${esc(valor)}</textarea>` : `<input class="inpt" id="ptx" type="${tipo}" placeholder="${esc(ph)}" value="${esc(valor)}">`}<button type="button" class="btn blue" style="width:100%" id="pgo">${esc(boton)}</button>`, (sh, cerrar) => {
      $("#pgo", sh).onclick = () => { r = $("#ptx", sh).value; cerrar(); };
    });
    const t = setInterval(() => { if (!_hoja) { clearInterval(t); res(r); } }, 120);
  });
}
// Visor de fotos
export function verFoto(url) {
  const v = $("#viewer");
  v.innerHTML = `<img src="${esc(url)}" alt=""><button type="button" aria-label="Cerrar">${ic("x")}</button>`;
  v.hidden = false; ponerCentinela();
  v.querySelector("button").onclick = () => { v.hidden = true; quitarCentinela(); };
}

// ═════════ Arranque ═════════
pintaIconos();
async function boot() {
  const { data: { session } } = await supa.auth.getSession();
  if (!session) return mostrarLogin();
  A.uid = session.user.id; A.email = session.user.email || "";
  await empezar();
}
function mostrarLogin() {
  $("#boot").hidden = true; $("#app").hidden = true; $("#login").hidden = false;
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    $("#lErr").hidden = true; $("#lGo").disabled = true; $("#lGo").textContent = "Entrando…";
    const { error } = await supa.auth.signInWithPassword({ email: $("#lEmail").value.trim(), password: $("#lPass").value });
    $("#lGo").disabled = false; $("#lGo").textContent = "Entrar";
    if (error) { $("#lErr").textContent = /invalid/i.test(error.message) ? "Correo o contraseña incorrectos." : "No se pudo entrar: " + error.message; $("#lErr").hidden = false; return; }
    location.reload();
  };
}
supa.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") { try { localStorage.removeItem("nodo.channelId"); } catch (_) { /* */ } location.reload(); } });

async function empezar() {
  const [{ data: chs, error }, { data: perfil }] = await Promise.all([
    supa.from("channels").select("id,nombre,timezone,bot_apagado").eq("activo", true).order("nombre"),
    supa.from("app_users").select("nombre").eq("id", A.uid).maybeSingle(),
  ]);
  if (error) { toast("No se pudieron cargar tus bots: " + error.message, true); }
  A.channels = chs || []; A.nombre = perfil?.nombre || A.email.split("@")[0];
  // Los logos van aparte: cada uno pesa ~27 KB (data URI) y no deben frenar el arranque
  if (A.channels.length) supa.from("channels").select("id,logo_url").in("id", A.channels.map((c) => c.id)).then(({ data }) => { (data || []).forEach((c) => { if (c.logo_url) A.logos[c.id] = c.logo_url; }); pintaBot(); emit("logos"); }, () => {});
  if (!A.channels.length) {
    $("#boot").hidden = true; $("#app").hidden = false;
    $("#chatlist").innerHTML = `<div class="empty"><b>${ic("inbox")}</b>Todavía no tienes ningún bot. Créalo desde el panel web de Nodo.</div>`;
    return;
  }
  let guardado = null; try { guardado = localStorage.getItem("nodo.channelId"); } catch (_) { /* */ }
  A.ch = A.channels.some((c) => c.id === guardado) ? guardado : A.channels[0].id;
  const mods = await Promise.all(["chats", "chat", "ficha", "pagos", "t4", "hoy", "mas", "notif", "push"].map((m) => import(`./${m}.js`)));
  mods.forEach((m) => m.init && m.init());
  await cambiarBot(A.ch, true);
  $("#boot").hidden = true; $("#app").hidden = false;
  history.replaceState({ base: 1 }, "");
  emit("listo");
}

// ── Bot activo ──
let _rt = null;
export async function cambiarBot(id, primera) {
  A.ch = id; try { localStorage.setItem("nodo.channelId", id); } catch (_) { /* */ }
  const ch = A.channels.find((c) => c.id === id);
  setTZ(ch?.timezone);
  // Tipo de bot por sus productos (como marcarTipoBot del panel): con físicos → Pedidos; con micro apps → Accesos; si no, Ventas.
  const { data: ps } = await supa.from("products").select("tipo").eq("channel_id", id);
  const tipos = new Set((ps || []).map((p) => p.tipo));
  A.tipo = tipos.has("fisico") ? "fisico" : tipos.has("microapp") ? "apps" : "digital";
  A.tieneApps = tipos.has("microapp");
  pintaBot();
  suscribir();
  if (!primera) { if (PILA.length) cerrarCapa(PILA[0].id); }
  emit("bot", id);
}
const TIPO_LBL = { digital: "Digital", fisico: "Físico", apps: "Micro Apps" };
const T4 = { digital: ["Ventas", "party"], fisico: ["Pedidos", "pedidos"], apps: ["Accesos", "key"] };
export function pintaBot() {
  const ch = A.channels.find((c) => c.id === A.ch) || {};
  $("#botname").textContent = ch.nombre || "Bot";
  $("#botlogo").src = logoDe(A.ch);
  $("#bottipo").textContent = TIPO_LBL[A.tipo];
  $("#botstate").textContent = ch.bot_apagado ? "Bot apagado · contestan ustedes" : "Bot encendido";
  $("#botsel").classList.toggle("off", !!ch.bot_apagado);
  $("#t4lbl").textContent = T4[A.tipo][0];
  $("#t4ico").innerHTML = ic(T4[A.tipo][1]);
}
$("#botsel").onclick = () => {
  if (A.channels.length < 2) { toast("Solo tienes un bot"); return; }
  hoja("Elegir bot", A.channels.map((c) => ({ t: c.nombre, img: logoDe(c.id), small: c.bot_apagado ? "apagado" : "", on: c.id === A.ch, v: c.id })), (o) => cambiarBot(o.v));
};
$("#bellbtn").onclick = () => emit("abrirNotif");

// Tiempo real del bot activo: un solo canal, y cada pantalla escucha lo suyo por el bus.
function suscribir() {
  if (_rt) { supa.removeChannel(_rt); _rt = null; }
  const f = `channel_id=eq.${A.ch}`;
  _rt = supa.channel("nodo-app-" + A.ch)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: f }, (p) => emit("msg:ins", p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: f }, (p) => emit("msg:upd", p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "contacts", filter: f }, (p) => emit("contacto", p.new))
    .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: f }, (p) => emit("conv", p.new || p.old))
    .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: f }, (p) => emit("orden", p.new || p.old))
    .subscribe((st) => { if (st === "SUBSCRIBED") { if (_rtVeces++ > 0) emit("resync"); } });
}
let _rtVeces = 0;
// Al volver a la app (estaba en segundo plano) se pone todo al día.
document.addEventListener("visibilitychange", () => { if (!document.hidden && A.ch) emit("resync"); });
addEventListener("online", () => A.ch && emit("resync"));

boot().catch((e) => { console.error(e); $("#boot").hidden = true; toast("No se pudo abrir la app: " + (e?.message || e), true); });
