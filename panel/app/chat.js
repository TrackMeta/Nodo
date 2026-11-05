// Chat abierto: hilo, enviar (texto, archivos, nota de voz, respuestas rápidas, plantillas), sugerencias de la IA,
// tomar/devolver al bot y la ventana de 24 h. Mismas funciones edge y reglas que la Bandeja.
import { A, $, $$, esc, ic, on, emit, supa, callFn, invoke, avatar, quienDe, whoTxt, hhmm, fmtDiaLargo, abrirCapa, capaAbierta, cerrarCapa, cerrarTodo, ir, abrirHoja, cerrarHoja, hoja, confirmar, toast, verFoto, TZ } from "./app.js";
import { CHATS } from "./chats.js";
import { copilotoEtapa, MEDIA_LABEL } from "./comun.js";
import { waFmt } from "../shell.js";

const C = { cid: null, contacto: null, conv: null, msgs: [], orden: null, agentes: new Map(), ventana: true, okManual: new Set(), qr: [], qrCh: null, tmp: 0, vista: "chat", evs: [], borradores: {} };
export const CHAT = C;

export function init() {
  on("abrirChat", (cid) => abrir(cid));
  on("msg:ins", (m) => { if (m.contact_id === C.cid) agregar(m); });
  on("msg:upd", (m) => { if (m.contact_id !== C.cid) return; const i = C.msgs.findIndex((x) => x.id === m.id); if (i >= 0) { C.msgs[i] = m; const el = $(`#msgs [data-mid="${m.id}"]`); if (el) el.outerHTML = burbuja(m); } });
  on("contacto", (c) => { if (c.id === C.cid) { Object.assign(C.contacto, c); pintaBotbar(); calcVentana(); } });
  on("conv", (cv) => { if (cv && cv.contact_id === C.cid) { C.conv = { ...C.conv, ...cv }; pintaBotbar(); } });
  on("orden", (o) => { if (o && o.contact_id === C.cid) cargarOrden(); });
  on("resync", () => { if (C.cid && capaAbierta("chat")) recargarHilo(); });
  on("bot", () => { C.qrCh = null; });
  $("#takebtn").onclick = alternarBot;
  $("#sendbtn").onclick = () => enviarTexto();
  $("#inp").addEventListener("input", () => { autoAlto(); alEscribir(); });
  $("#copibtn").onclick = sugerencias;
  $("#actbtn").onclick = alternarVista;
  $("#qrbtn").onclick = () => { if (!$("#qr").hidden && $("#qr").dataset.modo === "qr") { $("#qr").hidden = true; return; } mostrarQR("", true); };
  $("#qr").addEventListener("click", clicQR);
  $("#attbtn").onclick = () => $("#fileInput").click();
  $("#fileInput").onchange = (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) prepararArchivo(f); };
  $("#tplbtn").onclick = elegirPlantilla;
  $("#msgs").addEventListener("click", clicHilo);
  microfono();
  setInterval(() => { if (C.cid) calcVentana(); }, 60000);
}

// ═════════ Abrir ═════════
async function abrir(cid) {
  // Lo que esté abierto encima (notificaciones, un acceso…) se cierra: el chat va debajo de esas capas.
  if (A.tab !== "chats") ir("chats"); else cerrarTodo();
  guardarBorrador();
  C.cid = cid; C.msgs = []; C.orden = null; C.vista = "chat"; C.evs = []; pintaVistaBtn();
  const cv = CHATS.convs.find((x) => x.contact_id === cid) || CHATS.buscados?.find((x) => x.contact_id === cid);
  C.conv = cv ? { requiere_humano: cv.requiere_humano, archivada: cv.archivada } : { requiere_humano: false };
  C.contacto = cv ? { ...cv.contact } : null;
  pintaCabecera();
  $("#msgs").innerHTML = `<div class="cargando">Cargando…</div>`;
  $("#qr").hidden = true; $("#inp").value = C.borradores[cid] || ""; autoAlto(); alEscribir();
  abrirCapa("chat", () => { guardarBorrador(); C.cid = null; });
  // Marcar leído (como openChat de la Bandeja)
  if (cv) cv.no_leidos = 0;
  supa.from("conversations").update({ no_leidos: 0 }).eq("contact_id", cid).then(() => emit("conv", { contact_id: cid, no_leidos: 0 }), () => {});
  const [ct, hilo, cvr] = await Promise.all([
    supa.from("contacts").select("id,nombre,wa_id,stage,bot_activo,source,ad_id,ad_ref,memoria_ia,ultimo_mensaje_cliente_at,product_id,primera_interaccion,created_at,channel_id,product:products(emoji)").eq("id", cid).maybeSingle(),
    supa.from("messages").select("*").eq("contact_id", cid).order("ts", { ascending: false }).order("id", { ascending: false }).limit(150),
    supa.from("conversations").select("requiere_humano,archivada").eq("contact_id", cid).maybeSingle(),
    cargarAgentes(),
  ]);
  if (C.cid !== cid) return;
  if (!ct.data || ct.data.channel_id !== A.ch) { toast("No se encontró ese chat en este bot", true); cerrarCapa("chat"); return; }
  C.contacto = ct.data; if (cvr.data) C.conv = cvr.data;
  C.msgs = (hilo.data || []).reverse();
  pintaCabecera(); pintaHilo(); calcVentana();
  cargarOrden();
}
async function recargarHilo() {
  const cid = C.cid;
  const { data } = await supa.from("messages").select("*").eq("contact_id", cid).order("ts", { ascending: false }).order("id", { ascending: false }).limit(150);
  if (C.cid !== cid || !data) return;
  C.msgs = data.reverse(); pintaHilo(); calcVentana();
}
async function cargarAgentes() {
  if (C.agentes.size) return;
  const { data } = await supa.from("app_users").select("id,nombre");
  (data || []).forEach((u) => C.agentes.set(u.id, u.nombre));
}
async function cargarOrden() {
  const cid = C.cid;
  const { data } = await supa.from("orders").select("id,estado,shipping,amount,currency,created_at").eq("contact_id", cid).order("created_at", { ascending: false }).limit(1);
  if (C.cid === cid) C.orden = (data || [])[0] || null;
}
function pintaCabecera() {
  const c = C.contacto || {};
  const w = quienDe({ bot_activo: c.bot_activo, requiere_humano: C.conv?.requiere_humano });
  $("#cavbox").innerHTML = avatar(c.id || C.cid, c.nombre, c.wa_id, w, c.product?.emoji);
  $("#cname").textContent = c.nombre || (c.wa_id ? "+" + c.wa_id : "Cliente");
  $("#cinfo").textContent = c.wa_id && /^\d+$/.test(c.wa_id) ? "+" + c.wa_id : whoTxt(w);
  pintaBotbar();
}
function pintaBotbar() {
  if (!C.contacto) return;
  const w = quienDe({ bot_activo: C.contacto.bot_activo, requiere_humano: C.conv?.requiere_humano });
  $("#botbar").className = "botbar" + (w === "bot" ? "" : " " + w);
  $("#botbartxt").innerHTML = {
    bot: ic("robot") + "<b>El bot está atendiendo</b> este chat.",
    espera: ic("user") + "<b>Pidió hablar con alguien.</b> El bot está en pausa hasta que alguien lo tome.",
    yo: ic("user") + "<b>Lo atienden ustedes.</b> El bot no contesta hasta que se lo devuelvan.",
  }[w];
  $("#takebtn").textContent = w === "yo" ? "Devolver al bot" : "Tomar chat";
  const av = $("#cavbox .who"); if (av) { av.className = "who " + w; }
}

// ═════════ Hilo ═════════
const diaDe = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ() }).format(new Date(ts));
function pintaHilo() {
  let html = "", dAnt = "";
  if (C.msgs.length >= 150) html += `<p class="note">Se muestran los últimos 150 mensajes.</p>`;
  const items = C.vista === "actividad"
    ? [...C.msgs.map((m) => ({ ts: m.ts, m })), ...C.evs.map((e) => ({ ts: e.created_at, e }))].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    : C.msgs.map((m) => ({ ts: m.ts, m }));
  for (const it of items) {
    const d = diaDe(it.ts);
    if (d !== dAnt) { html += `<span class="day">${esc(etiquetaDia(it.ts))}</span>`; dAnt = d; }
    html += it.m ? burbuja(it.m) : eventoHtml(it.e);
  }
  $("#msgs").innerHTML = html || `<div class="empty"><b>${ic("message")}</b>Todavía no hay mensajes.</div>`;
  $("#msgs").insertAdjacentHTML("beforeend", `<span class="window" id="winchip" hidden></span>`);
  calcVentana();
  requestAnimationFrame(() => { $("#msgs").scrollTop = $("#msgs").scrollHeight; });
  setTimeout(() => { $("#msgs").scrollTop = $("#msgs").scrollHeight; }, 60);
}
// ═════════ Vista «Actividad» (como la Bandeja web): lo que hizo el bot —nodos, etiquetas, flujos, errores— intercalado
// con los mensajes y con «por quién» cuando lo hizo una persona ═════════
const ACT_ICON = { etiqueta_add: "etiquetas", etiqueta_del: "etiquetas", campo: "edit", flujo_inicio: "flujos", flujo_fin: "flag", secuencia_inicio: "secuencias", secuencia_cancel: "stop", compra: "dollar", humano: "user", bot_pausa: "pause", bot_reactiva: "play", nodo: "node", error: "alert", nota: "note" };
function eventoHtml(e) {
  const por = e.meta && e.meta.por ? ` · por ${esc(String(e.meta.por))}` : "";
  return `<div class="actline${e.tipo === "error" ? " err" : ""}"><span class="ai">${ic(ACT_ICON[e.tipo] || "node")}</span><span class="atx"><b>${esc(e.titulo || "")}</b>${e.detalle ? `<span>${esc(e.detalle)}</span>` : ""}<small>${hhmm(e.created_at)}${por}</small></span></div>`;
}
function pintaVistaBtn() {
  const b = $("#actbtn"); if (!b) return;
  b.classList.toggle("on", C.vista === "actividad"); b.setAttribute("aria-pressed", C.vista === "actividad" ? "true" : "false");
}
async function alternarVista() {
  if (!C.cid) return;
  C.vista = C.vista === "actividad" ? "chat" : "actividad"; pintaVistaBtn();
  if (C.vista === "chat") { pintaHilo(); return; }
  const cid = C.cid;
  toast("Mostrando lo que hizo el bot en este chat");
  const { data } = await supa.from("contact_events").select("*").eq("contact_id", cid).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(300);
  if (C.cid !== cid || C.vista !== "actividad") return;
  C.evs = (data || []).reverse(); pintaHilo();
}
// Borrador por chat (como la web): lo que dejaste escrito vuelve al reabrir ese chat, y no se cuela en otro
function guardarBorrador() {
  if (!C.cid) return;
  const v = $("#inp").value;
  if (v.trim()) C.borradores[C.cid] = v; else delete C.borradores[C.cid];
}
function etiquetaDia(ts) {
  const d = diaDe(ts), hoy = diaDe(Date.now()), ayer = diaDe(Date.now() - 864e5);
  if (d === hoy) return "Hoy"; if (d === ayer) return "Ayer";
  const t = fmtDiaLargo(ts); return t.charAt(0).toUpperCase() + t.slice(1);
}
function agregar(m) {
  if (C.msgs.some((x) => x.id === m.id)) return;
  // quita el globo provisorio del mismo texto (enviado desde aquí)
  if (m.direction === "out") { const t = $(`#msgs .m.tmp[data-txt="${CSS.escape(String(m.content?.text || "").slice(0, 60))}"]`); if (t) t.remove(); }
  const ult = C.msgs[C.msgs.length - 1];
  C.msgs.push(m);
  const abajo = $("#msgs").scrollHeight - $("#msgs").scrollTop - $("#msgs").clientHeight < 140;
  if (!ult || diaDe(ult.ts) !== diaDe(m.ts)) $("#winchip").insertAdjacentHTML("beforebegin", `<span class="day">${esc(etiquetaDia(m.ts))}</span>`);
  $("#winchip").insertAdjacentHTML("beforebegin", burbuja(m, true));
  if (m.direction === "in") { C.contacto.ultimo_mensaje_cliente_at = m.ts; calcVentana(); supa.from("conversations").update({ no_leidos: 0 }).eq("contact_id", C.cid).then(() => {}, () => {}); }
  if (abajo || m.direction === "out") $("#msgs").scrollTop = $("#msgs").scrollHeight;
}
const tick = (st) => st === "read" ? `<span class="tk read" title="Leído">${ic("tick2")}</span>` : st === "delivered" ? `<span class="tk" title="Entregado">${ic("tick2")}</span>` : st === "sent" ? `<span class="tk" title="Enviado">${ic("tick")}</span>` : st === "failed" ? `<span class="tk fail" title="No se envió">${ic("alert")}</span>` : `<span class="tk" title="Enviando">${ic("clock")}</span>`;
const MOTIVO = { 131047: "pasaron más de 24 h: usa una plantilla", 131026: "el número no tiene WhatsApp o no lo puede recibir", 131051: "tipo de mensaje no soportado", 131053: "Meta no pudo procesar el archivo", 130472: "Meta lo frenó (experimento de Meta)", 131049: "Meta lo frenó para cuidar la calidad", 131056: "demasiados mensajes seguidos a este número" };
function burbuja(m, nueva) {
  const k = m.content || {}, t = m.type || "text", out = m.direction === "out";
  if (t === "system") return `<div class="m sys" data-mid="${m.id}">${esc(k.text || "")}</div>`;
  const bot = out && m.sent_by !== "human";
  let cuerpo = "";
  // Cita como en la Bandeja web: quién la escribió, la foto si era una, y al tocarla lleva al mensaje citado
  const qd = k.quoted;
  if (qd && (qd.text || qd.media_url)) cuerpo += `<div class="quoted"${qd.wamid ? ` data-qw="${esc(qd.wamid)}"` : ""}><b class="qwho">${qd.direction === "out" ? "Tú" : qd.direction === "in" ? esc(C.contacto?.nombre || "Cliente") : "Mensaje"}</b>${qd.media_url ? `<img src="${esc(qd.media_url)}" alt="">` : ""}<span>${esc(qd.text || "Foto")}</span></div>`;
  if (k.forwarded) cuerpo += `<div class="fwd">${ic("refresh")} Reenviado</div>`;
  const peso = fmtBytes(k.size);
  if (!k.media_url && ["image", "sticker", "video", "audio", "document"].includes(t)) cuerpo += sinArchivo(m);
  else if (t === "image" || t === "sticker") cuerpo += `<img class="media" src="${esc(k.media_url)}" data-ver="${esc(k.media_url)}" alt="" loading="lazy">`;
  else if (t === "video") cuerpo += `<video class="media" src="${esc(k.media_url)}" controls preload="metadata" playsinline></video>${peso ? `<div class="mmeta">${ic("video")} Video · ${peso}</div>` : ""}`;
  else if (t === "audio") cuerpo += `<div class="aud" data-src="${esc(k.media_url)}"><button type="button" class="play" aria-label="Reproducir">${ic("play")}</button><span class="bar"><i></i></span><span class="dur num">0:00</span></div>`;
  else if (t === "document") cuerpo += `<a class="doc" href="${esc(k.media_url)}" target="_blank" rel="noopener">${ic("file")}<span>${esc(k.filename || "Archivo")}</span>${peso ? `<small class="fsz">${peso}</small>` : ""}</a>`;
  else if (t === "location") cuerpo += ubiHtml(k);
  else if (t === "template") cuerpo += `<div class="tplh">${ic("message")} Plantilla${k.template ? " · " + esc(k.template) : ""}</div>`;
  if (k.raw_type === "contacts") cuerpo += tarjetaContacto(k);
  const texto = k.text ?? k.caption ?? "";
  // *negrita*, _cursiva_ y ~tachado~ como en WhatsApp (waFmt de la Bandeja web). La ubicación ya trae su lugar en el
  // mapa: su texto «[ubicación] -12.1, -77.0» no se repite.
  if (texto && !(t === "audio" && !k.caption) && t !== "location") cuerpo += waFmt(texto);
  if (t === "audio" && k.transcription) cuerpo += `<div class="tr">${ic("note")}<span>${esc(k.transcription)}</span></div>`;
  if (Array.isArray(k.buttons) && k.buttons.length) cuerpo += `<div class="checks" style="margin-top:6px">${k.buttons.map((b) => `<span class="ck info">${esc(b.title || "")}</span>`).join("")}</div>`;
  let quien = "";
  if (out && m.sent_by === "human" && m.sent_by_user && m.sent_by_user !== A.uid) quien = `<span class="who-l">${esc(C.agentes.get(m.sent_by_user) || "Equipo")}</span>`;
  const err = out && m.status === "failed" ? `<span class="err">No se envió: ${esc(MOTIVO[m.error?.code] || m.error?.message || "Meta lo rechazó")}</span>` : "";
  const meta = `<div class="meta">${bot ? '<span title="Respondió el bot">IA</span>' : ""}<span>${hhmm(m.ts)}</span>${out ? tick(m.status) : ""}</div>`;
  return `<div class="m ${out ? "out" : "in"}${bot ? " bot" : ""}${nueva ? " nueva" : ""}" data-mid="${m.id}">${quien}${cuerpo}${err}${meta}</div>`;
}
// ── Lo mismo que la Bandeja web (index.html · mediaHtml / ubiHtml / contactCardHtml) ──
function fmtBytes(n) { n = Number(n); if (!Number.isFinite(n) || n <= 0) return ""; if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`; return `${(n / 1048576).toFixed(1)} MB`; }
// Media sin archivo: recién llegado = se está bajando de WhatsApp (la burbuja se repinta sola); si no, el motivo o
// «Archivo no disponible». Antes un video o documento sin archivo se quedaba diciendo «Bajando…» para siempre.
function sinArchivo(m) {
  const k = m.content || {}, lab = MEDIA_LABEL[m.type] || ["file", "Archivo"];
  const reciente = m.ts && Date.now() - new Date(m.ts).getTime() < 3 * 60 * 1000;
  const nota = k.media_error ? String(k.media_error) : k.media_id && reciente ? "Cargando desde WhatsApp…" : "Archivo no disponible";
  return `<div class="doc mph${k.media_error ? " err" : ""}">${ic(lab[0])}<span><b>${esc(lab[1])}</b><small>${esc(nota)}</small></span></div>`;
}
// Ubicación: mapa chico (4 mosaicos de OpenStreetMap con el pin al centro), el lugar, las coordenadas y el enlace.
function ubiHtml(k) {
  let lat = Number(k.lat), lng = Number(k.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { const mm = /(-?\d{1,3}\.\d+)[,\s]+(-?\d{1,3}\.\d+)/.exec(String(k.text || "")); if (mm) { lat = Number(mm[1]); lng = Number(mm[2]); } }
  const lugar = [k.name, k.address].map((x) => String(x ?? "").trim()).filter(Boolean).join(" · ");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return `<div class="ubi"><div class="ubi-t">${ic("pin")} Ubicación compartida</div><div class="ubi-d">${esc(lugar || "Sin coordenadas")}</div></div>`;
  const gmaps = `https://maps.google.com/?q=${lat},${lng}`;
  const z = 16, n = 2 ** z, W = 240, H = 140, latR = (lat * Math.PI) / 180;
  const xf = ((lng + 180) / 360) * n, yf = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  const x0 = Math.floor(xf - 0.5), y0 = Math.floor(yf - 0.5), offX = W / 2 - (xf - x0) * 256, offY = H / 2 - (yf - y0) * 256;
  let tiles = "";
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const tx = (((x0 + dx) % n) + n) % n, ty = y0 + dy; if (ty < 0 || ty >= n) continue;
    tiles += `<img src="https://tile.openstreetmap.org/${z}/${tx}/${ty}.png" alt="" loading="lazy" style="left:${(offX + dx * 256).toFixed(1)}px;top:${(offY + dy * 256).toFixed(1)}px">`;
  }
  return `<div class="ubi"><a class="ubi-map" href="${esc(gmaps)}" target="_blank" rel="noopener">${tiles}<span class="ubi-pin">${ic("pin")}</span><span class="ubi-attr">© OpenStreetMap</span></a>` +
    `<div class="ubi-t">${ic("pin")} ${lugar ? esc(lugar) : "Ubicación compartida"}</div><div class="ubi-d num">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>` +
    `<a class="ubi-o" href="${esc(gmaps)}" target="_blank" rel="noopener">Abrir en Google Maps ↗</a></div>`;
}
// Contacto compartido: tarjeta con «Mensaje» (abre su chat o lo crea) y «Copiar número».
function tarjetaContacto(k) {
  const lista = Array.isArray(k.contacts) ? k.contacts : [];
  if (!lista.length) return `<div class="ccard"><div class="cc-head"><span class="cc-av">${ic("user")}</span><span class="cc-info"><b>Contacto compartido</b><small>Sin número</small></span></div></div>`;
  return lista.map((x) => {
    const tel = String((x.telefonos || [])[0] || "").replace(/\D/g, ""), nombre = x.nombre || (tel ? "+" + tel : "Contacto");
    const ini = (String(nombre).replace(/[^\p{L}\p{N}\s]/gu, "").trim().split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2) || "?").toUpperCase();
    return `<div class="ccard"><div class="cc-head"><span class="cc-av">${esc(ini)}</span><span class="cc-info"><b>${esc(nombre)}</b><small>${tel ? "+" + esc(tel) : "Sin número"}</small></span></div>` +
      (tel ? `<div class="cc-actions"><button type="button" data-ccmsg="${esc(tel)}" data-ccname="${esc(x.nombre || "")}">Mensaje</button><button type="button" data-cccopy="${esc(tel)}">Copiar número</button></div>` : "") + `</div>`;
  }).join("");
}
async function abrirChatDe(tel, nombre) {
  const { data: ya } = await supa.from("contacts").select("id").eq("channel_id", A.ch).eq("wa_id", tel).maybeSingle();
  if (ya) { emit("abrirChat", ya.id); return; }
  const ok = await confirmar("Todavía no tienes chat con ese número", `${nombre || "+" + tel} nunca te ha escrito. Si creas el contacto podrás escribirle con una plantilla (WhatsApp no deja mandar texto libre hasta que responda). El bot queda en pausa para ese chat.`, { si: "Crear contacto" });
  if (!ok) return;
  const { data: nuevo, error } = await supa.from("contacts").insert({ channel_id: A.ch, wa_id: tel, nombre: nombre || null, bot_activo: false }).select("id").single();
  if (error) { toast("No se pudo crear el contacto: " + error.message, true); return; }
  await supa.from("conversations").upsert({ channel_id: A.ch, contact_id: nuevo.id, expira_at: new Date(0).toISOString() }, { onConflict: "contact_id" }).then(() => {}, () => {});
  supa.from("contact_events").insert({ channel_id: A.ch, contact_id: nuevo.id, tipo: "nota", titulo: "Contacto creado desde una tarjeta compartida", meta: { por: A.nombre, desde: "app" } }).then(() => {}, () => {});
  toast("Contacto creado"); emit("refrescarChats"); emit("abrirChat", nuevo.id);
}
let _audio = null;
function clicHilo(e) {
  const v = e.target.closest("[data-ver]"); if (v) { verFoto(v.dataset.ver); return; }
  const cp = e.target.closest("[data-cccopy]");
  if (cp) { (navigator.clipboard?.writeText(cp.dataset.cccopy) || Promise.reject()).then(() => toast("Número copiado"), () => toast("No se pudo copiar el número", true)); return; }
  const cm = e.target.closest("[data-ccmsg]"); if (cm) { abrirChatDe(cm.dataset.ccmsg, cm.dataset.ccname || ""); return; }
  const qe = e.target.closest(".quoted[data-qw]");
  if (qe) {
    const obj = C.msgs.find((x) => x.wamid === qe.dataset.qw), b = obj && $(`#msgs [data-mid="${CSS.escape(String(obj.id))}"]`);
    if (b) { b.scrollIntoView({ behavior: "smooth", block: "center" }); b.classList.add("hl"); setTimeout(() => b.classList.remove("hl"), 1500); }
    else toast("Ese mensaje no está entre los últimos 150");
    return;
  }
  const p = e.target.closest(".aud .play"); if (!p) return;
  const box = p.closest(".aud"), src = box.dataset.src;
  if (_audio && _audio._box === box) { if (_audio.paused) _audio.play(); else _audio.pause(); return; }
  if (_audio) { _audio.pause(); _audio._box.querySelector(".play").innerHTML = ic("play"); }
  const a = new Audio(src); a._box = box; _audio = a;
  const bar = box.querySelector(".bar i"), dur = box.querySelector(".dur");
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  a.onplay = () => (p.innerHTML = ic("pause"));
  a.onpause = () => (p.innerHTML = ic("play"));
  a.ontimeupdate = () => { if (a.duration) { bar.style.width = (100 * a.currentTime) / a.duration + "%"; dur.textContent = fmt(a.currentTime); } };
  a.onended = () => { bar.style.width = "0"; dur.textContent = fmt(a.duration || 0); };
  a.onerror = () => toast("No se pudo reproducir el audio", true);
  a.play().catch(() => toast("No se pudo reproducir el audio", true));
}

// ═════════ Ventana de 24 h ═════════
function calcVentana() {
  const ult = C.contacto?.ultimo_mensaje_cliente_at;
  const hasta = ult ? new Date(ult).getTime() + 24 * 3600e3 : 0;
  C.ventana = hasta > Date.now();
  const chip = $("#winchip");
  if (chip) {
    chip.hidden = false;
    if (C.ventana) { const h = Math.max(1, Math.round((hasta - Date.now()) / 3600e3)); chip.className = "window"; chip.textContent = `Ventana abierta · queda${h === 1 ? "" : "n"} ${h} h`; }
    else { chip.className = "window off"; chip.innerHTML = `${ic("clock")} Ventana cerrada · pasaron más de 24 h`; }
  }
  $("#winbar").hidden = C.ventana; $("#comp").hidden = !C.ventana;
}

// ═════════ Tomar / devolver ═════════
async function alternarBot() {
  const c = C.contacto; if (!c) return;
  const on = c.bot_activo !== false, cid = C.cid;
  const { error } = await supa.from("contacts").update({ bot_activo: !on }).eq("id", cid);
  if (error) { toast("No se pudo cambiar el bot: " + error.message, true); return; }
  if (on) {
    // Tomar el chat = ya está atendido: deja de contar como «pide humano» (decisión de Rodrigo para la app)
    await supa.from("conversations").update({ requiere_humano: false }).eq("contact_id", cid).then(() => {}, () => {});
    C.conv.requiere_humano = false;
  } else {
    await supa.from("conversations").update({ requiere_humano: false }).eq("contact_id", cid).then(() => {}, () => {});
    C.conv.requiere_humano = false;
  }
  c.bot_activo = !on;
  supa.from("contact_events").insert({ channel_id: A.ch, contact_id: cid, tipo: on ? "bot_pausa" : "bot_reactiva", titulo: on ? "Bot pausado" : "Bot reactivado", meta: { por: A.nombre, desde: "app" } }).then(() => {}, () => {});
  pintaCabecera();
  emit("conv", { contact_id: cid, requiere_humano: false });
  const cv = CHATS.convs.find((x) => x.contact_id === cid); if (cv) { cv.contact.bot_activo = !on; cv.requiere_humano = false; }
  emit("refrescarChats");
  toast(on ? "Tomaste el chat · el bot quedó en pausa" : "El bot vuelve a atender");
  if (!on) {
    invoke("flow-start", { reanudar: true, channel_id: A.ch, contact_id: cid }).then(({ data }) => {
      if (!data) return;
      if (data.ventana === false && data.pendientes) toast(`Tiene ${data.pendientes} mensaje${data.pendientes > 1 ? "s" : ""} sin responder, pero pasaron más de 24 h: escríbele con una plantilla`, true);
      else if (data.respondido) toast("El bot está respondiendo lo que escribió mientras estaba en pausa");
    });
  }
}

// ═════════ Enviar ═════════
function autoAlto() { const t = $("#inp"); t.style.height = "auto"; t.style.height = Math.min(120, t.scrollHeight) + "px"; }
function alEscribir() {
  const v = $("#inp").value; const vacio = !v.trim();
  $("#sendbtn").hidden = vacio; $("#micbtn").hidden = !vacio;
  if (v.startsWith("/")) mostrarQR(v.slice(1).split(/\s/)[0]);
  else if ($("#qr").dataset.modo === "qr" && !$("#qr").hidden && v) $("#qr").hidden = true;
}
// Escribir a mano con un pedido en curso pausa el bot y no mueve el pedido: se avisa una vez por chat.
async function okManual() {
  const cet = copilotoEtapa(C.orden);
  if (!cet || !["adelanto", "saldo", "despachar", "camino"].includes(cet.id) || C.okManual.has(C.cid)) return true;
  const ok = await confirmar("Este cliente tiene un pedido en curso", `El pedido está en «${cet.titulo}». Escribirle a mano PAUSA el bot y NO cambia el estado del pedido. Para avanzarlo usa la pestaña Pagos o Pedidos. ¿Enviar igual?`, { si: "Enviar igual", peligro: true });
  if (ok) C.okManual.add(C.cid);
  return ok;
}
function errorEnvio(d) {
  if (d?.error === "ventana_cerrada") { C.contacto.ultimo_mensaje_cliente_at = null; calcVentana(); return "La ventana de 24 h se cerró: usa una plantilla"; }
  const code = d?.detalle?.code;
  return MOTIVO[code] ? "No salió: " + MOTIVO[code] : "No se pudo enviar" + (d?.detalle?.message ? ": " + d.detalle.message : d?.error ? ": " + d.error : "");
}
async function enviarTexto(texto) {
  const t = String(texto ?? $("#inp").value).trim(); if (!t || !C.cid) return false;
  if (!C.ventana) { toast("La ventana está cerrada: usa una plantilla", true); return false; }
  if (!(await okManual())) return false;
  const cid = C.cid;
  if (texto == null) { $("#inp").value = ""; delete C.borradores[cid]; autoAlto(); alEscribir(); }
  $("#qr").hidden = true;
  const id = "tmp" + ++C.tmp;
  $("#winchip").insertAdjacentHTML("beforebegin", `<div class="m out tmp nueva" id="${id}" data-txt="${esc(t.slice(0, 60))}">${esc(t)}<div class="meta"><span>${hhmm(Date.now())}</span>${tick("")}</div></div>`);
  $("#msgs").scrollTop = $("#msgs").scrollHeight;
  const r = await callFn("whatsapp-send", { channel_id: A.ch, contact_id: cid, text: t.slice(0, 4096) });
  if (!r.ok) {
    const el = document.getElementById(id); if (el) el.querySelector(".meta").insertAdjacentHTML("beforebegin", `<span class="err">${esc(errorEnvio(r.data))}</span>`);
    toast(errorEnvio(r.data), true); return false;
  }
  if (r.data?.aviso) toast(r.data.aviso);
  if (C.contacto && C.cid === cid) { C.contacto.bot_activo = false; C.conv.requiere_humano = false; pintaCabecera(); }
  setTimeout(() => { const el = document.getElementById(id); if (el && C.cid === cid) recargarHilo(); }, 4000);
  return true;
}

// ── Sugerencias de la IA (reply-suggest) ──
async function sugerencias() {
  const q = $("#qr");
  if (!q.hidden && q.dataset.modo === "ia") { q.hidden = true; return; }
  q.dataset.modo = "ia"; q.hidden = false;
  q.innerHTML = `<div class="qrh ia">Sugerencias de la IA</div><div class="cargando">Pensando…</div>`;
  const cid = C.cid;
  const r = await callFn("reply-suggest", { channel_id: A.ch, contact_id: cid });
  if (C.cid !== cid || q.dataset.modo !== "ia" || q.hidden) return;
  const sug = r.data?.sugerencias || [];
  q.innerHTML = `<div class="qrh ia">Sugerencias de la IA</div>` + (sug.length ? sug.map((t) => `<button type="button" class="sug" data-s="${esc(t)}"><span>${esc(t)}</span></button>`).join("") : `<div class="cargando">${esc(r.data?.error ? "No se pudo sugerir: " + r.data.error : "Sin sugerencias por ahora")}</div>`);
}

// ── Respuestas rápidas (quick_replies, modelo de burbujas) ──
async function cargarQR() {
  if (C.qrCh === A.ch) return;
  const { data } = await supa.from("quick_replies").select("*").eq("channel_id", A.ch).order("orden");
  C.qr = data || []; C.qrCh = A.ch;
}
// Como en la Bandeja web: con el botón se abre con buscador y agrupadas por carpeta, con su color y cuántos archivos
// llevan; escribiendo «/atajo» se filtra por el atajo sin buscador.
async function mostrarQR(filtro, conBuscador) {
  await cargarQR();
  const q = $("#qr"); q.dataset.modo = "qr"; q.hidden = false;
  q.innerHTML = `<div class="qrh">Respuestas rápidas</div>` + (conBuscador && C.qr.length ? `<div class="qrs"><input id="qrSearch" class="inpt" placeholder="Buscar respuesta…" autocomplete="off"></div>` : "") + `<div id="qrList"></div>`;
  listaQR(String(filtro || ""), !conBuscador);
  const s = $("#qrSearch"); if (s) s.oninput = () => listaQR(s.value, false);
}
function listaQR(filtro, porAtajo) {
  const box = $("#qrList"); if (!box) return;
  const f = filtro.toLowerCase().trim();
  const lista = C.qr.map((r, i) => [r, i]).filter(([r]) => !f || (porAtajo
    ? String(r.atajo || "").toLowerCase().replace(/^\//, "").startsWith(f) || String(r.titulo || "").toLowerCase().includes(f)
    : `${r.titulo || ""} ${r.atajo || ""} ${r.cuerpo || ""}`.toLowerCase().includes(f)));
  if (!lista.length) { box.innerHTML = `<div class="cargando">${C.qr.length ? (porAtajo ? "Ninguna empieza así" : "Sin coincidencias") : "Este bot no tiene respuestas rápidas. Créalas desde el panel."}</div>`; return; }
  const carpetas = {}; lista.forEach(([r, i]) => { const k = r.folder || "__none"; (carpetas[k] = carpetas[k] || []).push([r, i]); });
  const nombres = Object.keys(carpetas).sort((a, b) => a === "__none" ? 1 : b === "__none" ? -1 : a.localeCompare(b));
  box.innerHTML = nombres.map((k) => (nombres.length > 1 || k !== "__none" ? `<div class="qrfold">${k === "__none" ? "Sin carpeta" : esc(k)}</div>` : "") + carpetas[k].map(([r, i]) => {
    const col = r.color && /^#[0-9a-f]{3,8}$/i.test(r.color) ? r.color : null;
    const nM = (Array.isArray(r.media) ? r.media : []).filter((m) => m && m.media_url).length;
    return `<button type="button" data-i="${i}"${col ? ` style="border-left:3px solid ${col}"` : ""}><b>${col ? `<i class="qrdot" style="background:${col}"></i>` : ""}${esc(r.titulo || (r.atajo ? "/" + String(r.atajo).replace(/^\//, "") : "Respuesta"))}${r.atajo && r.titulo ? `<em class="qatajo">/${esc(String(r.atajo).replace(/^\//, ""))}</em>` : ""}${nM ? `<em class="qatajo f">${ic("file")} ${nM}</em>` : ""}</b><span>${esc(burbujasDe(r).map((b) => b.text || (b.media_kind === "image" ? "Foto" : b.filename || "Archivo")).join(" · "))}</span></button>`;
  }).join("")).join("");
}
function burbujasDe(r) {
  const raw = Array.isArray(r.media) ? r.media : [];
  if (raw.some((b) => b && typeof b.text === "string" && !b.media_url)) return raw.map((b) => ({ ...b }));
  const bubs = []; if (r.cuerpo && r.cuerpo.trim()) bubs.push({ text: r.cuerpo }); raw.forEach((m) => { if (m && m.media_url) bubs.push({ ...m }); });
  return bubs;
}
const conNombre = (t) => { const nom = String(C.contacto?.nombre || "").trim().split(/\s+/)[0] || ""; return String(t || "").replace(/[ \t]*\{\{\s*nombre\s*\}\}/gi, nom ? " " + nom : "").replace(/^ /gm, ""); };
function clicQR(e) {
  const s = e.target.closest("[data-s]"); if (s) { $("#inp").value = s.dataset.s; $("#qr").hidden = true; autoAlto(); alEscribir(); $("#inp").focus(); return; }
  const b = e.target.closest("[data-i]"); if (!b) return;
  const r = C.qr[+b.dataset.i]; $("#qr").hidden = true;
  if ($("#inp").value.startsWith("/")) { $("#inp").value = ""; autoAlto(); alEscribir(); }
  const bubs = burbujasDe(r).map((x) => ({ ...x, text: x.text != null ? conNombre(x.text) : x.text, caption: x.caption != null ? conNombre(x.caption) : x.caption }));
  // Revisar antes de enviar (como en la Bandeja)
  abrirHoja(`<h3>${esc(r.titulo || "Respuesta rápida")}</h3><p class="lead">Revisa y envía. Se mandan en este orden.</p>` + bubs.map((x, i) => x.media_url
    ? `<div class="fsec" style="margin-bottom:8px">${x.media_kind === "image" ? `<img src="${esc(x.media_url)}" style="max-width:100%;max-height:160px;border-radius:8px">` : `<p>${ic(x.media_kind === "audio" ? "mic" : x.media_kind === "video" ? "video" : "file")} ${esc(x.filename || "Archivo")}</p>`}${x.media_kind !== "audio" ? `<input class="inpt" data-cap="${i}" value="${esc(x.caption || "")}" placeholder="Texto sobre el archivo (opcional)" style="margin:6px 0 0">` : ""}</div>`
    : `<textarea class="inpt" data-txt="${i}">${esc(x.text || "")}</textarea>`).join("") + `<button type="button" class="btn blue" style="width:100%" id="qrGo">${ic("send")} Enviar</button>`, (sh, cerrar) => {
    $("#qrGo", sh).onclick = async () => {
      sh.querySelectorAll("[data-txt]").forEach((t) => (bubs[+t.dataset.txt].text = t.value));
      sh.querySelectorAll("[data-cap]").forEach((t) => (bubs[+t.dataset.cap].caption = t.value));
      cerrar(); await enviarBurbujas(bubs);
    };
  });
}
async function enviarBurbujas(bubs) {
  if (!bubs.some((b) => b.media_url || (b.text || "").trim())) { toast("Esta respuesta no tiene nada que enviar", true); return; }
  if (!C.ventana) { toast("La ventana está cerrada: usa una plantilla", true); return; }
  if (!(await okManual())) return;
  const cid = C.cid;
  for (const b of bubs) {
    if (C.cid !== cid) { toast("Cambiaste de chat: dejé de enviar el resto", true); return; }
    let ok;
    if (b.media_url) { const r = await callFn("whatsapp-send", { channel_id: A.ch, contact_id: cid, media: { kind: b.media_kind, url: b.media_url, mime: b.mime, filename: b.filename }, text: (b.caption || "").slice(0, 1024) }); ok = r.ok; if (!ok) toast(errorEnvio(r.data), true); }
    else { const t = (b.text || "").trim(); ok = t ? await enviarTexto(t) : true; }
    if (!ok) { toast("Una burbuja no salió; las anteriores sí", true); return; }
  }
}

// ── Plantillas (ventana cerrada) ──
async function elegirPlantilla() {
  const { data } = await supa.from("wa_templates").select("id,name,language,categoria,body_preview,estado_meta,activa,soporta_envio").eq("channel_id", A.ch).order("name");
  const tpls = (data || []).filter((t) => t.activa !== false && (t.estado_meta ?? "aprobada") === "aprobada" && t.soporta_envio !== false);
  if (!tpls.length) { toast("No tienes plantillas aprobadas. Créalas desde el panel (Plantillas).", true); return; }
  abrirHoja(`<h3>Enviar plantilla</h3><p class="lead">Solo plantillas aprobadas por Meta. Las variables las completa Nodo.</p>` + tpls.map((t, i) => `<button type="button" class="opt" data-tp="${i}" style="flex-direction:column;align-items:flex-start;gap:3px"><b style="font-size:13px;color:var(--brand)">${esc(t.name)}${t.categoria ? ` <small style="color:var(--muted);font-weight:500">· ${esc(t.categoria)}</small>` : ""}</b><span style="font-size:13px;color:var(--muted);white-space:normal">${esc(t.body_preview || "")}</span></button>`).join(""), (sh, cerrar) => {
    sh.querySelectorAll("[data-tp]").forEach((b) => (b.onclick = async () => {
      const t = tpls[+b.dataset.tp]; cerrar();
      // Como en la Bandeja web: se confirma, porque Meta la cobra y no se puede deshacer
      await new Promise((ok) => setTimeout(ok, 300));   // que termine de cerrarse la hoja de la lista
      if (!(await confirmar("Enviar plantilla", `¿Enviar «${t.name}» a ${C.contacto?.nombre || "este cliente"}? Meta la cobra y no se puede deshacer.`, { si: "Enviar" }))) return;
      const r = await callFn("whatsapp-send", { channel_id: A.ch, contact_id: C.cid, template: { name: t.name, language: t.language || "es" } });
      if (!r.ok) { toast(errorEnvio(r.data), true); return; }
      toast("Plantilla enviada · si responde, se abre la ventana");
    }));
  });
}

// ── Archivos ──
const WA_MIME_OK = /^(image\/(jpeg|jpg|png)|video\/(mp4|3gpp)|audio\/(aac|mp4|mpeg|mp3|amr|ogg|x-m4a)|application\/(pdf|msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))|text\/plain)$/i;
const POR_EXT = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", mp4: "video/mp4", "3gp": "video/3gpp", mp3: "audio/mpeg", ogg: "audio/ogg", m4a: "audio/x-m4a", aac: "audio/aac", amr: "audio/amr", pdf: "application/pdf", txt: "text/plain", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
const tipoDe = (f) => String(f.type || POR_EXT[String(f.name || "").split(".").pop().toLowerCase()] || "application/octet-stream").toLowerCase();
const kindDe = (ct) => ct.startsWith("image/") ? "image" : ct.startsWith("video/") ? "video" : ct.startsWith("audio/") ? "audio" : "document";
function prepararArchivo(f) {
  if (!C.ventana) { toast("La ventana está cerrada: usa una plantilla", true); return; }
  const ct = tipoDe(f);
  if (!WA_MIME_OK.test(ct)) { toast("WhatsApp no acepta este formato. Usa JPG/PNG, MP4, MP3/OGG o PDF" + (/quicktime/.test(ct) ? " (el .mov hay que pasarlo a MP4)" : ""), true); return; }
  const lim = ct.startsWith("image/") ? 5 : 16;
  if (f.size > lim * 1048576) { toast(`El archivo pesa más de ${lim} MB (límite de WhatsApp)`, true); return; }
  const kind = kindDe(ct), url = URL.createObjectURL(f);
  abrirHoja(`<h3>Enviar ${kind === "image" ? "foto" : kind === "video" ? "video" : kind === "audio" ? "audio" : "archivo"}</h3>` +
    (kind === "image" ? `<img src="${url}" style="max-width:100%;max-height:260px;border-radius:12px;display:block;margin:0 auto 10px">` : kind === "video" ? `<video src="${url}" controls style="max-width:100%;max-height:240px;border-radius:12px;display:block;margin:0 auto 10px"></video>` : `<p class="lead">${ic(kind === "audio" ? "mic" : "file")} ${esc(f.name)}</p>`) +
    (kind !== "audio" ? `<input class="inpt" id="capt" placeholder="Texto (opcional)">` : "") + `<button type="button" class="btn blue" style="width:100%" id="fGo">${ic("send")} Enviar</button>`, (sh, cerrar) => {
    $("#fGo", sh).onclick = async () => { const cap = $("#capt", sh)?.value || ""; cerrar(); URL.revokeObjectURL(url); await subirYEnviar(f, ct, kind, cap); };
  });
}
async function subirYEnviar(blob, ct, kind, caption, nombre) {
  if (!(await okManual())) return;
  const cid = C.cid;
  toast(kind === "audio" ? "Enviando nota de voz…" : "Subiendo…");
  const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
  const filename = nombre || blob.name || `archivo.${ct.split("/")[1] || "bin"}`;
  const up = await callFn("media-upload", { channel_id: A.ch, filename, content_type: ct, data });
  if (!up.ok || !up.data?.url) { toast("No se pudo subir: " + (up.data?.detalle || up.data?.error || "error"), true); return; }
  const r = await callFn("whatsapp-send", { channel_id: A.ch, contact_id: cid, media: { kind: up.data.kind || kind, url: up.data.url, mime: ct, filename }, text: (caption || "").slice(0, 1024) });
  if (!r.ok) { toast(errorEnvio(r.data), true); return; }
  if (C.cid === cid && C.contacto) { C.contacto.bot_activo = false; pintaCabecera(); }
}

// ── Nota de voz: mantener apretado el micrófono ──
// WhatsApp acepta audio en MP4/AAC u OGG/Opus (no WebM): se graba en el primero que el celular soporte.
function formatoAudio() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"]) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return null;
}
function microfono() {
  const mic = $("#micbtn"); let rec = null, chunks = [], t0 = 0, x0 = 0, cancela = false, timer = null, stream = null;
  const tickT = () => { const s = Math.floor((Date.now() - t0) / 1000); $("#rect").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const parar = () => { clearInterval(timer); $("#rec").hidden = true; mic.classList.remove("grabando"); if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
  mic.addEventListener("pointerdown", async (e) => {
    if (!C.cid) return; e.preventDefault();
    if (!C.ventana) { toast("La ventana está cerrada: usa una plantilla", true); return; }
    const fmt = formatoAudio();
    if (!fmt) { toast("Este celular no puede grabar en un formato que WhatsApp acepte. Manda el audio como archivo.", true); return; }
    try { mic.setPointerCapture(e.pointerId); } catch (_) { /* */ }
    t0 = Date.now(); x0 = e.clientX; cancela = false; chunks = [];
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (_) { t0 = 0; toast("Nodo necesita permiso para usar el micrófono", true); return; }
    if (!t0) { stream.getTracks().forEach((t) => t.stop()); return; }   // ya soltó mientras pedía permiso
    rec = new MediaRecorder(stream, { mimeType: fmt });
    rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
    rec.start();
    $("#rec").hidden = false; $("#rec").classList.remove("cancel"); mic.classList.add("grabando"); tickT(); timer = setInterval(tickT, 250);
    try { navigator.vibrate?.(30); } catch (_) { /* */ }
  });
  mic.addEventListener("pointermove", (e) => { if (!t0) return; cancela = x0 - e.clientX > 80; $("#rec").classList.toggle("cancel", cancela); });
  const soltar = () => {
    if (!t0) return; const ms = Date.now() - t0; t0 = 0;
    if (!rec) { parar(); return; }
    const r = rec; rec = null;
    r.onstop = () => {
      parar();
      if (cancela) { toast("Nota de voz cancelada"); return; }
      if (ms < 700) { toast("Mantén apretado el micrófono para grabar"); return; }
      const ct = r.mimeType.split(";")[0], ext = ct.includes("ogg") ? "ogg" : "m4a";
      subirYEnviar(new Blob(chunks, { type: ct }), ct === "audio/mp4" ? "audio/mp4" : "audio/ogg", "audio", "", `nota-de-voz.${ext}`);
    };
    try { r.stop(); } catch (_) { parar(); }
  };
  mic.addEventListener("pointerup", soltar);
  mic.addEventListener("pointercancel", () => { cancela = true; soltar(); });
}

// Ficha: la abre ficha.js con los datos del chat
$("#fichabtn").onclick = () => C.cid && emit("abrirFicha", C.cid);
$("#cinfoBtn").onclick = () => C.cid && emit("abrirFicha", C.cid);
