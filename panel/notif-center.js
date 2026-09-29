// ═══════════════════════════════════════════════════════════════════
// Nodo · notif-center.js — la campanita del sidebar (centro de notificaciones).
//
// Lo carga shell.js con import() dinámico después de montar el menú: el sidebar sale
// igual de rápido y este módulo baja en paralelo. Recibe lo que necesita del shell por
// `ctx` (no lo importa) para no armar un ciclo shell ⇄ campanita.
//
// Datos: tabla `notificaciones` (0113) que escribe SOLO el motor por un único punto
// (_shared/notificaciones.ts). Acá:
//   · «leído» es POR PERSONA: notificacion_lecturas + el corte `leidas_hasta`.
//   · «resuelto» es GLOBAL y casi siempre lo pone la base sola (triggers 0114: validaste el
//     pago en Pedidos o por Telegram → el aviso deja de estar «por atender»).
//   · preferencias (sonido, navegador, tipos ocultos) en notificacion_usuario.prefs.
// En vivo por Realtime; lo urgente suena y sale en tarjeta abajo a la derecha, y si Nodo está
// en otra pestaña, como aviso del navegador (solo lo urgente — decisión de Rodrigo 2026-09-28).
// ═══════════════════════════════════════════════════════════════════

// ── Catálogo del lado del panel ─────────────────────────────────────
// `lb` = cómo se llama en Preferencias; `ic` = icono; `crit` = no se puede ocultar (plata o
// una persona esperando: los mismos que Telegram no deja apagar). Un tipo que el motor
// estrene mañana y no esté acá igual se muestra (con el icono de su grupo).
const TIPOS = {
  adelanto_validar:     { g: "pagos",    lb: "Adelanto por validar",          ic: "banknote", crit: 1 },
  saldo_validar:        { g: "pagos",    lb: "Saldo por validar",             ic: "banknote", crit: 1 },
  pago_digital_validar: { g: "pagos",    lb: "Pago digital por validar",      ic: "banknote", crit: 1 },
  pago_extra_validar:   { g: "pagos",    lb: "Pago de un extra por validar",  ic: "banknote", crit: 1 },
  prepago_lima_validar: { g: "pagos",    lb: "Prepago de Lima por validar",   ic: "banknote", crit: 1 },
  entrega_fallida:      { g: "pagos",    lb: "Entrega digital que falló",     ic: "alert",    crit: 1 },
  reclama_vuelto:       { g: "pagos",    lb: "Cliente reclama su vuelto",     ic: "dollar" },
  pago_de_mas:          { g: "pagos",    lb: "Pagó de más",                   ic: "dollar" },
  adelanto_auto:        { g: "pagos",    lb: "Adelanto aprobado solo",        ic: "check" },
  saldo_auto:           { g: "pagos",    lb: "Saldo aprobado solo",           ic: "check" },
  venta_digital:        { g: "ventas",   lb: "Venta digital",                 ic: "party" },
  pedido_lima:          { g: "ventas",   lb: "Pedido nuevo de Lima",          ic: "truck" },
  pedido_provincia:     { g: "ventas",   lb: "Pedido nuevo de provincia",     ic: "truck" },
  venta_extra:          { g: "ventas",   lb: "Venta de un extra",             ic: "gift" },
  pide_humano:          { g: "atencion", lb: "Cliente pide una persona",      ic: "user",     crit: 1 },
  envio_fallido:        { g: "atencion", lb: "Mensaje que no salió",          ic: "alert",    crit: 1 },
  cambio_tras_despacho: { g: "atencion", lb: "Cambio con el pedido ya enviado", ic: "truck",  crit: 1 },
  pedido_cancelado:     { g: "atencion", lb: "Pedido cancelado",              ic: "ban" },
  mayorista:            { g: "atencion", lb: "Piden precio por mayor",        ic: "users" },
  entrega_pedida:       { g: "atencion", lb: "Cliente pide cambiar la entrega", ic: "calendar" },
  organico_sin_atender: { g: "atencion", lb: "Cliente orgánico sin atender",  ic: "message" },
  whatsapp_salud:       { g: "sistema",  lb: "Salud de tu WhatsApp",          ic: "shield",   crit: 1 },
  campana_detenida:     { g: "sistema",  lb: "Campaña detenida",              ic: "megaphone", crit: 1 },
  problema:             { g: "sistema",  lb: "Algo falló",                    ic: "alert",    crit: 1 },
  anuncio_sin_producto: { g: "sistema",  lb: "Anuncio sin producto",          ic: "megaphone" },
  stock_agotado:        { g: "sistema",  lb: "Stock agotado",                 ic: "box" },
  stock_bajo:           { g: "sistema",  lb: "Stock bajo",                    ic: "box" },
  aviso:                { g: "sistema",  lb: "Otros avisos",                  ic: "bell" },
};
const GRUPOS = [
  { k: "pagos",    lb: "Pagos",    ic: "banknote" },
  { k: "ventas",   lb: "Ventas",   ic: "pedidos" },
  { k: "atencion", lb: "Atención", ic: "message" },
  { k: "sistema",  lb: "Sistema",  ic: "activity" },
];
const VALIDAR = new Set(["adelanto_validar", "saldo_validar", "pago_digital_validar", "pago_extra_validar", "prepago_lima_validar"]);
const RANGO = { urgente: 0, importante: 1, info: 2 };
const SEL = "id,channel_id,contact_id,order_id,tipo,grupo,prioridad,titulo,detalle,datos,por_atender," +
  "resuelta_at,resuelta_por,repeticiones,created_at,contact:contacts(nombre,wa_id)";
const TOAST_MS = 6000;

const N = {
  ctx: null, rows: new Map(), leidas: new Set(), hasta: 0, uid: null,
  prefs: { sonido: true, navegador: true, ocultos: [] },
  tab: "atender", grupo: "todo", bot: "todos", vista: "lista",
  abierto: false, cargando: null, rt: null, ac: null,
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tipoDe = (n) => TIPOS[n.tipo] || { g: n.grupo || "sistema", lb: n.titulo, ic: (GRUPOS.find((g) => g.k === n.grupo) || GRUPOS[3]).ic };
const critico = (n) => !!TIPOS[n.tipo]?.crit || n.prioridad === "urgente";
const oculta = (n) => !critico(n) && (N.prefs.ocultos || []).includes(n.tipo);
// Lo ya resuelto no cuenta como «sin leer»: no queda nada que hacer con eso (se ve igual en «Todas»).
const noLeida = (n) => !n.resuelta_at && new Date(n.created_at).getTime() > N.hasta && !N.leidas.has(n.id);
const pendiente = (n) => n.por_atender && !n.resuelta_at;
const canal = (id) => (N.ctx.S.channels || []).find((c) => c.id === id);
const I = (n) => N.ctx.svg(n);

// ── Arranque ────────────────────────────────────────────────────────
export async function montar(ctx) {
  if (N.ctx) return;                 // una sola campanita por pestaña (el shell persiste entre secciones)
  N.ctx = ctx;
  const bell = ctx.S.nav && ctx.S.nav.querySelector("#nodoBell");
  if (!bell) return;
  N.bell = bell;
  bell.onclick = (e) => { e.stopPropagation(); N.abierto ? cerrar() : abrir(); };

  // El audio del navegador arranca «dormido» hasta que la persona toca algo: se despierta con
  // el primer clic para que el primer aviso urgente sí suene.
  const despertar = () => { try { audio(); } catch (_) {} };
  document.addEventListener("pointerdown", despertar, { once: true, capture: true });

  document.addEventListener("keydown", (e) => {
    if (!N.abierto) return;
    const d = document.getElementById("nodoNotif");
    // Con la lista de bots abierta: Esc cierra SOLO la lista, y las flechas se mueven por ella.
    if (menuBotAbierto()) {
      if (e.key === "Escape") { e.preventDefault(); menuBot(d, false); d.querySelector(".nn-bsel-btn")?.focus(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const its = [...d.querySelectorAll(".nn-bsel-it")], i = its.indexOf(document.activeElement);
        its[(i + (e.key === "ArrowDown" ? 1 : -1) + its.length) % its.length]?.focus();
        return;
      }
    }
    if (e.key === "Escape") cerrar();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!N.abierto) return;
    if (e.target.closest("#nodoNotif") || e.target.closest("#nodoBell") || e.target.closest(".nodo-modal-back,.nodo-modal,[role=dialog]")) return;
    cerrar();
  });
  window.addEventListener("resize", () => { if (N.abierto) ubicar(); });
  // Red de seguridad: si Realtime se cayó sin avisar, cada 5 min (con la pestaña a la vista) se recarga.
  setInterval(() => { if (document.visibilityState === "visible") cargar(); }, 5 * 60_000);
  setInterval(() => { if (N.abierto && N.vista === "lista") pintarLista(); }, 60_000);   // «hace 3 min» al día
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - (N.ultimaCarga || 0) > 60_000) cargar(); });

  await cargar();
  suscribir();
}

async function cargar() {
  if (N.cargando) return N.cargando;
  N.cargando = (async () => {
    const { supa, S } = N.ctx;
    const ids = (S.channels || []).map((c) => c.id);
    if (!ids.length) return;
    try {
      if (!N.uid) { const { data: { session } } = await supa.auth.getSession(); N.uid = session?.user?.id || null; }
      const desde = new Date(Date.now() - 60 * 864e5).toISOString();
      const [pend, todas, lect, yo] = await Promise.all([
        supa.from("notificaciones").select(SEL).in("channel_id", ids).eq("por_atender", true).is("resuelta_at", null)
          .order("created_at", { ascending: false }).limit(300),
        supa.from("notificaciones").select(SEL).in("channel_id", ids).gte("created_at", desde)
          .order("created_at", { ascending: false }).limit(250),
        supa.from("notificacion_lecturas").select("notificacion_id").limit(1000),
        supa.from("notificacion_usuario").select("leidas_hasta,prefs").maybeSingle(),
      ]);
      if (pend.error && todas.error) return;
      const m = new Map();
      for (const r of [...(todas.data || []), ...(pend.data || [])]) m.set(r.id, r);
      N.rows = m;
      N.leidas = new Set((lect.data || []).map((r) => r.notificacion_id));
      if (yo.data) {
        N.hasta = new Date(yo.data.leidas_hasta).getTime();
        N.prefs = { sonido: true, navegador: true, ocultos: [], ...(yo.data.prefs || {}) };
      } else if (N.uid && !yo.error) {
        // Primera vez: arranca con lo de las últimas 24 h sin leer (no 60 días de golpe: un «99+»
        // el primer día enseña a ignorar la campanita).
        const corte = new Date(Date.now() - 864e5).toISOString();
        N.hasta = Date.parse(corte);
        supa.from("notificacion_usuario").insert({ user_id: N.uid, leidas_hasta: corte }).then(() => {}, () => {});
      }
      N.ultimaCarga = Date.now();
      pintarCampana();
      if (N.abierto && N.vista === "lista") pintar();
    } catch (_) { /* sin red: la campanita se queda con lo último que supo */ }
  })().finally(() => { N.cargando = null; });
  return N.cargando;
}

// ── Realtime ────────────────────────────────────────────────────────
function suscribir() {
  const { supa } = N.ctx;
  if (N.rt) return;
  N.rt = supa.channel("nodo-notif-" + Math.random().toString(36).slice(2, 8))
    .on("postgres_changes", { event: "*", schema: "public", table: "notificaciones" }, (p) => alCambio(p))
    .subscribe();
}

function alCambio(p) {
  if (p.eventType === "DELETE") { if (p.old?.id && N.rows.delete(p.old.id)) refrescar(); return; }
  const n = p.new;
  if (!n?.id || !canal(n.channel_id)) return;
  const prev = N.rows.get(n.id);
  const fila = { ...n, contact: prev?.contact || null };
  N.rows.set(n.id, fila);
  // Un aviso repetido (×2) vuelve a subir con created_at nuevo: es una novedad para todos.
  const novedad = !prev || prev.created_at !== n.created_at;
  if (novedad) N.leidas.delete(n.id);
  if (!fila.contact && n.contact_id) completarContacto(fila);
  refrescar();
  if (novedad && !n.resuelta_at && Date.now() - Date.parse(n.created_at) < 5 * 60_000) enVivo(fila);
}

async function completarContacto(fila) {
  try {
    const { data } = await N.ctx.supa.from("contacts").select("nombre,wa_id").eq("id", fila.contact_id).maybeSingle();
    const r = N.rows.get(fila.id);
    if (r && data) { r.contact = data; if (N.abierto) pintarLista(); }
  } catch (_) {}
}

// Preferencias no depende de los avisos: redibujarla con cada aviso la mandaba arriba a mitad de un cambio.
function refrescar() { pintarCampana(); if (N.abierto && N.vista === "lista") pintar(); }

// Llegó algo nuevo con el panel abierto.
function enVivo(n) {
  if (oculta(n)) return;
  N.bell.classList.remove("ring"); void N.bell.offsetWidth; N.bell.classList.add("ring");
  const esVenta = VENTA.has(n.tipo);
  if (n.prioridad !== "urgente" && !esVenta) return;
  // Con dos pestañas de Nodo abiertas, suena y avisa UNA sola. Gana la que estás MIRANDO: una
  // pestaña escondida espera un momento antes de reclamarlo (visto 2026-09-28: con dos pestañas,
  // la escondida se adelantaba, y la tarjeta no salía en la que tenías delante).
  const reclamar = () => {
    try {
      const k = "nodo.nn.visto", ya = JSON.parse(localStorage.getItem(k) || "[]");
      const firma = n.id + "@" + n.created_at;
      if (ya.includes(firma)) return false;
      localStorage.setItem(k, JSON.stringify([firma, ...ya].slice(0, 30)));
    } catch (_) {}
    return true;
  };
  const avisar = () => {
    if (!reclamar()) return;
    // Venta: solo el sonido de venta (si está encendido). Sin tarjeta: no hay nada que hacer con ella.
    if (esVenta) { const v = ventaPrefs(); if (v.sonido) tocar("venta", v.tono, v.volumen); return; }
    if (N.prefs.sonido !== false) tocar("urgente", tonoUrgente());
    if (document.visibilityState === "visible") tarjeta(n);
    else avisoNavegador(n);
  };
  if (document.visibilityState === "visible") avisar(); else setTimeout(avisar, 1500);
}

// ── Sonido: dos notas suaves hechas con WebAudio (sin archivo que bajar) ──
function audio() {
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return null;
  N.ac = N.ac || new C();
  if (N.ac.state === "suspended") N.ac.resume().catch(() => {});
  return N.ac;
}
// ── Sin cruces de sonidos (pedido de Rodrigo 2026-09-28) ─────────────
// Suena UNO a la vez: si llega otro mientras suena, espera su turno; lo urgente pasa delante de la
// venta; y una ráfaga del mismo tipo (5 ventas que entran juntas) suena UNA vez, no cinco seguidas.
// «Libre desde» se comparte entre pestañas (localStorage): dos pestañas abiertas no se pisan.
// Cada sonido va por su propio «bus» para poder cortarlo al probar otro en Preferencias.
const DURACION = { suave: 750, alerta: 500, timbre: 1300, caja: 1000, monedas: 550, campana: 850 };
const PAUSA = 250;                 // aire entre un sonido y el siguiente
const RAFAGA = 1500;               // el mismo tipo dentro de este rato = el mismo sonido
N.cola = []; N.ultimo = {};
const LIBRE_K = "nodo.nn.libre";
const libreDesde = () => { let x = 0; try { x = Number(localStorage.getItem(LIBRE_K)) || 0; } catch (_) {} return Math.max(N.libreEn || 0, x); };
function marcarOcupado(ms) {
  N.libreEn = Date.now() + ms + PAUSA;
  try { localStorage.setItem(LIBRE_K, String(N.libreEn)); } catch (_) {}
}
function nuevoBus(ac) {
  const bus = ac.createGain();
  bus.connect(ac.destination);
  N.bus = bus;
  return bus;
}
function cortarSonido() {
  try { if (N.bus && N.ac) { N.bus.gain.cancelScheduledValues(0); N.bus.gain.setValueAtTime(0, N.ac.currentTime); N.bus.disconnect(); } } catch (_) {}
  N.bus = null;
}
function sonarAhora(x, prueba = false) {
  marcarOcupado(DURACION[x.tono] || 1000);
  if (!prueba) N.ultimo[x.tipo] = Date.now();   // probar en Preferencias no cuenta como «ya sonó»
  if (x.tipo === "urgente") sonar(x.tono); else sonarVenta(x.tono, x.vol);
}
// Un sonido de un aviso que llegó (no de una prueba): entra a la cola.
function tocar(tipo, tono, vol) {
  if (Date.now() - (N.ultimo[tipo] || 0) < RAFAGA) return;          // ráfaga: ya sonó este tipo
  if (N.cola.some((x) => x.tipo === tipo)) return;                  // ya hay uno igual esperando
  const x = { tipo, tono, vol };
  if (Date.now() >= libreDesde() && !N.cola.length) { sonarAhora(x); return; }
  tipo === "urgente" ? N.cola.unshift(x) : N.cola.push(x);
  seguirCola();
}
function seguirCola() {
  if (N.colaT || !N.cola.length) return;
  N.colaT = setTimeout(() => {
    N.colaT = null;
    if (Date.now() < libreDesde()) { seguirCola(); return; }       // otra pestaña tomó el turno
    const x = N.cola.shift();
    if (x) sonarAhora(x);
    seguirCola();
  }, Math.max(30, libreDesde() - Date.now()));
}
// Probar un sonido en Preferencias: corta lo que suene y suena YA (no espera en la cola).
function probarSonido(tipo, tono, vol) {
  cortarSonido();
  sonarAhora({ tipo, tono, vol }, true);
}

// Sonido de lo URGENTE: se elige en Preferencias (pedido de Rodrigo 2026-09-28). «Suave» es el de
// siempre, así que a quien no toque nada no le cambia. Distintos de los de venta: que no se confundan.
const TONOS_URGENTE = [
  { k: "suave",  lb: "Suave",  corto: "Suave",  desc: "dos notas que suben",  ic: "bell" },
  { k: "alerta", lb: "Alerta", corto: "Alerta", desc: "tres pitidos cortos",  ic: "alert" },
  { k: "timbre", lb: "Timbre", corto: "Timbre", desc: "un «din-don»",         ic: "activity" },
];
const tonoUrgente = () => (TONOS_URGENTE.some((t) => t.k === N.prefs.tonoUrgente) ? N.prefs.tonoUrgente : "suave");

function sonar(tono = tonoUrgente()) {
  try {
    const ac = audio(); if (!ac) return;
    const t = ac.currentTime + 0.02, bus = nuevoBus(ac);
    const nota = (f, d, dur, g, tipo = "sine") => {
      const o = ac.createOscillator(), gn = ac.createGain();
      o.type = tipo; o.frequency.value = f;
      gn.gain.setValueAtTime(0.0001, t + d);
      gn.gain.exponentialRampToValueAtTime(g, t + d + 0.02);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + d + dur);
      o.connect(gn).connect(bus);
      o.start(t + d); o.stop(t + d + dur + 0.05);
    };
    if (tono === "alerta") [0, 0.16, 0.32].forEach((d) => nota(988, d, 0.12, 0.08, "square"));
    else if (tono === "timbre") { nota(659, 0, 0.7, 0.12, "triangle"); nota(523, 0.32, 0.9, 0.12, "triangle"); }
    else { nota(784, 0, 0.55, 0.09); nota(1175, 0.13, 0.55, 0.09); }
  } catch (_) {}
}

// Barra de sonidos (la usan lo urgente y la venta): una opción por sonido, el elegido marcado.
function barraTonos(lista, actual, dataP, off) {
  return `<div class="nn-tonos" role="radiogroup">
    <div class="nn-tonos-seg">
      ${lista.map((t) => `<label class="nn-tono${actual === t.k ? " on" : ""}" title="${t.lb}: ${t.desc}">
        <input type="radio" name="${dataP}" value="${t.k}" data-p="${dataP}"${actual === t.k ? " checked" : ""}${off ? " disabled" : ""}>${I(t.ic)}<span>${t.corto}</span></label>`).join("")}
    </div>
  </div>`;
}

// ── Sonido de VENTA (pedido de Rodrigo 2026-09-28): configurable y apagable ──
// Suena con plata que ya entró o una venta ya comprometida; NO con un pedido de provincia recién creado
// (todavía no pagó el adelanto: suena cuando el adelanto se aprueba solo).
const VENTA = new Set(["venta_digital", "pedido_lima", "adelanto_auto", "venta_extra"]);
const TONOS_VENTA = [
  { k: "caja",    lb: "Caja registradora", corto: "Caja",      desc: "el «cha-ching» de una venta", ic: "banknote" },
  { k: "monedas", lb: "Monedas",           corto: "Monedas",   desc: "unas monedas que caen",       ic: "dollar" },
  { k: "campana", lb: "Campanita",         corto: "Campanita", desc: "cuatro notas alegres",        ic: "bell" },
];
const ventaPrefs = () => ({ sonido: true, tono: "caja", volumen: 70, ...(N.prefs.venta || {}) });

function sonarVenta(tono, volumen) {
  try {
    const ac = audio(); if (!ac) return;
    const v = Math.max(0, Math.min(1, Number(volumen) / 100)) * 0.24;
    if (v <= 0) return;
    const t0 = ac.currentTime + 0.02, bus = nuevoBus(ac);
    const nota = (f, t, dur, g, tipo = "sine") => {
      const o = ac.createOscillator(), gn = ac.createGain();
      o.type = tipo; o.frequency.value = f;
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(Math.max(g, 0.0002), t + 0.008);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gn).connect(bus);
      o.start(t); o.stop(t + dur + 0.05);
    };
    if (tono === "monedas") {
      // Cinco «tines» agudos, desparejos, como monedas que rebotan.
      [[3150, 0], [3700, 0.07], [3400, 0.15], [4200, 0.21], [3900, 0.3]].forEach(([f, d]) => {
        nota(f, t0 + d, 0.2, v * 0.75); nota(f * 1.5, t0 + d, 0.12, v * 0.25);
      });
    } else if (tono === "campana") {
      [[1047, 0], [1319, 0.1], [1568, 0.2], [2093, 0.3]].forEach(([f, d]) => nota(f, t0 + d, 0.5, v, "triangle"));
    } else {
      // Caja registradora: el golpe del cajón (ruido corto) y el «ching» metálico doble.
      const n = Math.ceil(ac.sampleRate * 0.05), buf = ac.createBuffer(1, n, ac.sampleRate), ch = buf.getChannelData(0);
      for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ac.createBufferSource(), hp = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = buf; hp.type = "highpass"; hp.frequency.value = 2500; g.gain.value = v * 0.9;
      src.connect(hp).connect(g).connect(bus); src.start(t0);
      nota(2093, t0 + 0.06, 0.25, v * 0.7); nota(2093 * 2.76, t0 + 0.06, 0.18, v * 0.2);
      nota(2637, t0 + 0.2, 0.75, v); nota(2637 * 2.76, t0 + 0.2, 0.35, v * 0.25); nota(2637 * 5.4, t0 + 0.2, 0.2, v * 0.1);
    }
  } catch (_) {}
}

function avisoNavegador(n) {
  try {
    if (N.prefs.navegador === false || !("Notification" in window) || Notification.permission !== "granted") return;
    const c = canal(n.channel_id);
    const nt = new Notification(n.titulo, {
      body: [n.detalle, c && (N.ctx.S.channels.length > 1) ? c.nombre : ""].filter(Boolean).join("\n"),
      icon: c?.logo_url || N.ctx.logoFallback, tag: "nodo-" + n.id, renotify: true,
    });
    nt.onclick = () => { window.focus(); nt.close(); marcarLeida(n); const a = acciones(n)[0]; a ? ejecutar(n, a) : abrir(); };
  } catch (_) {}
}

// ── Tarjeta en vivo (abajo a la derecha, 6 s; se pausa con el mouse encima) ──
function tarjeta(n) {
  let box = document.getElementById("nodoNotifToasts");
  if (!box) { box = document.createElement("div"); box.id = "nodoNotifToasts"; document.body.appendChild(box); }
  const t = tipoDe(n), c = canal(n.channel_id), acc = acciones(n).filter((a) => a.k !== "resolver").slice(0, 1);
  const el = document.createElement("div");
  el.className = "nn-toast pr-" + n.prioridad;
  el.setAttribute("role", "alert");
  el.innerHTML = `
    <span class="nn-ic">${I(t.ic)}</span>
    <div class="nn-tb">
      <b>${esc(n.titulo)}</b>
      ${n.detalle ? `<span>${esc(n.detalle)}</span>` : ""}
      <small>${c && N.ctx.S.channels.length > 1 ? esc(c.nombre) + " · " : ""}ahora</small>
      <div class="nn-acts">
        ${acc.map((a) => `<button class="nn-btn pri" data-k="${a.k}">${I(a.ic)}${esc(a.lb)}</button>`).join("")}
        <button class="nn-btn" data-k="ver">Ver notificaciones</button>
      </div>
    </div>
    <button class="nn-tx" title="Cerrar">${I("x")}</button>
    <i class="nn-bar"></i>`;
  const quitar = () => { el.classList.add("out"); setTimeout(() => el.remove(), 220); };
  el.querySelector(".nn-bar").addEventListener("animationend", quitar);
  el.querySelector(".nn-tx").onclick = quitar;
  el.querySelectorAll("[data-k]").forEach((b) => b.onclick = () => {
    quitar();
    if (b.dataset.k === "ver") { abrir(); return; }
    marcarLeida(n); ejecutar(n, acc[0]);
  });
  box.prepend(el);
  [...box.children].slice(3).forEach((x) => x.remove());   // como mucho 3 a la vista
}

// ── Campanita (insignia) ────────────────────────────────────────────
function pintarCampana() {
  if (!N.bell) return;
  const vis = [...N.rows.values()].filter((n) => !oculta(n) && noLeida(n));
  const b = N.bell.querySelector(".nn-badge");
  const k = vis.length;
  b.hidden = !k;
  b.textContent = k > 99 ? "99+" : String(k);
  b.classList.toggle("urg", vis.some((n) => n.prioridad === "urgente" && pendiente(n)));
  N.bell.setAttribute("aria-label", k ? `Notificaciones: ${k} sin leer` : "Notificaciones");
  N.bell.title = k ? `Notificaciones · ${k} sin leer` : "Notificaciones";
  // El selector de bots del menú lateral muestra cuánto espera en cada uno (lo lee al abrirse).
  N.ctx.S.notifPorBot = conteoPorBot();
}

// Cuánto le falta a cada bot: lo por atender (y si algo es urgente) y lo sin leer.
function conteoPorBot() {
  const m = {};
  for (const n of N.rows.values()) {
    if (oculta(n)) continue;
    const c = m[n.channel_id] || (m[n.channel_id] = { pend: 0, urg: false, noLeidas: 0 });
    if (pendiente(n)) { c.pend++; if (n.prioridad === "urgente") c.urg = true; }
    if (noLeida(n)) c.noLeidas++;
  }
  return m;
}

// Selector de bot del cajón (desplegable propio, no el <select> nativo que se veía pobre y no decía
// cuánto tenía cada bot). Botón con el logo y el nombre del elegido; la lista trae cada bot con su
// número: en «Por atender», lo pendiente (rojo si hay algo urgente); en «Todas», lo sin leer.
// Orden fijo (el de siempre): en un selector, que las cosas no cambien de sitio.
function selectorBot(chs) {
  const cnt = conteoPorBot();
  const cero = { pend: 0, urg: false, noLeidas: 0 };
  const num = (x) => (N.tab === "atender" ? x.pend : x.noLeidas);
  const badge = (k, urg) => !k ? "" :
    `<b class="nn-bc ${N.tab === "atender" ? (urg ? "urg" : "pend") : "soft"}">${k > 99 ? "99+" : k}</b>`;
  const tot = chs.reduce((s, c) => s + num(cnt[c.id] || cero), 0);
  const elegido = chs.find((c) => c.id === N.bot);
  const logo = (c) => `<img src="${esc(c.logo_url || N.ctx.logoFallback)}" alt="">`;
  const todosIc = `<span class="nn-bsel-all">${I("robot")}</span>`;
  const item = (id, ic, nombre, k, urg) => `<button class="nn-bsel-it${N.bot === id ? " on" : ""}" type="button" data-bot="${id}" role="option" aria-selected="${N.bot === id}">
      ${ic}<span>${esc(nombre)}</span>${badge(k, urg)}${N.bot === id ? `<i class="nn-bsel-ok">${I("check")}</i>` : ""}</button>`;
  return `<div class="nn-bsel">
    <button class="nn-bsel-btn" type="button" data-a="bot-menu" aria-haspopup="listbox" aria-expanded="false" title="Ver los avisos de un bot">
      ${elegido ? logo(elegido) : todosIc}<span>${esc(elegido ? elegido.nombre : "Todos los bots")}</span>${I("chevron")}
    </button>
    <div class="nn-bsel-pop" role="listbox" hidden>
      ${item("todos", todosIc, "Todos los bots", tot, chs.some((c) => cnt[c.id]?.urg))}
      <div class="nn-bsel-sep"></div>
      ${chs.map((c) => { const x = cnt[c.id] || cero; return item(c.id, logo(c), c.nombre, num(x), x.urg); }).join("")}
    </div>
  </div>`;
}

// ── Cajón ───────────────────────────────────────────────────────────
function cajon() {
  let d = document.getElementById("nodoNotif");
  if (d) return d;
  d = document.createElement("aside");
  d.id = "nodoNotif";
  d.className = "nn-drawer";
  d.setAttribute("aria-label", "Notificaciones");
  document.body.appendChild(d);
  d.addEventListener("click", onClickCajon);
  d.addEventListener("change", onChangeCajon);
  // El % del volumen se actualiza mientras arrastras (se guarda y suena al soltar, en «change»).
  d.addEventListener("input", (e) => {
    if (e.target.dataset?.p === "venta-vol") {
      const o = e.target.parentElement.querySelector("output"); if (o) o.textContent = e.target.value + "%";
      e.target.style.setProperty("--p", ((e.target.value - 10) / 90 * 100) + "%");   // el tramo lleno de la barra
    }
  });
  return d;
}

function ubicar() {
  const d = cajon(), nav = N.ctx.S.nav;
  // El lado izquierdo lo pone el CSS según el menú esté comprimido o no (.nodo-nav.collapsed ~ .nn-drawer):
  // medir el menú fallaba mientras animaba su ancho y dejaba un hueco de 176 px. Acá solo el alto
  // (el cartel rojo de «sin conexión» empuja el menú hacia abajo).
  const r = nav ? nav.getBoundingClientRect() : { top: 0 };
  d.style.left = "";
  d.style.top = Math.max(0, Math.round(r.top)) + "px";
}

function abrir() {
  const d = cajon();
  N.abierto = true; N.vista = "lista";
  ubicar(); pintar();
  requestAnimationFrame(() => d.classList.add("open"));
  N.bell.classList.add("open");
  if (Date.now() - (N.ultimaCarga || 0) > 30_000) cargar();
}
function cerrar() {
  N.abierto = false;
  const d = document.getElementById("nodoNotif");
  if (d) d.classList.remove("open");
  if (N.bell) N.bell.classList.remove("open");
}

function pintar() {
  const d = cajon();
  if (N.vista === "prefs") { pintarPrefs(d); return; }
  const chs = N.ctx.S.channels || [];
  const pend = [...N.rows.values()].filter((n) => pendiente(n) && !oculta(n) && (N.bot === "todos" || n.channel_id === N.bot));
  const nNo = [...N.rows.values()].filter((n) => noLeida(n) && !oculta(n) && (N.bot === "todos" || n.channel_id === N.bot)).length;
  const nNoTodo = [...N.rows.values()].filter((n) => noLeida(n) && !oculta(n)).length;
  // Un bot que se archivó mientras estaba elegido: vuelve a «Todos».
  if (N.bot !== "todos" && !chs.some((c) => c.id === N.bot)) N.bot = "todos";
  const _menuAbierto = menuBotAbierto();
  d.innerHTML = `
    <header class="nn-head">
      <div class="nn-hl">
        <h2>Notificaciones</h2>
        ${chs.length > 1 ? selectorBot(chs) : ""}
      </div>
      <button class="nn-ib" data-a="leer-todo" title="Marcar todo como leído (todos los bots)"${nNoTodo ? "" : " disabled"}>${I("checkAll")}</button>
      <button class="nn-ib" data-a="prefs" title="Preferencias">${I("config")}</button>
      <button class="nn-ib" data-a="cerrar" title="Cerrar (Esc)">${I("x")}</button>
    </header>
    <div class="nn-tabs" role="tablist">
      <button class="nn-tab${N.tab === "atender" ? " on" : ""}" data-tab="atender" role="tab">Por atender${pend.length ? `<b class="${pend.some((n) => n.prioridad === "urgente") ? "urg" : ""}">${pend.length}</b>` : ""}</button>
      <button class="nn-tab${N.tab === "todas" ? " on" : ""}" data-tab="todas" role="tab">Todas${nNo ? `<b class="soft">${nNo > 99 ? "99+" : nNo}</b>` : ""}</button>
    </div>
    <div class="nn-filt"></div>
    ${bannerNavegador()}
    <div class="nn-list"></div>`;
  // Llegó un aviso o se recargó con la lista de bots abierta: se redibuja todo, pero la lista sigue abierta.
  if (_menuAbierto) menuBot(d, true, false);
  pintarLista();
}

function bannerNavegador() {
  try {
    if (!("Notification" in window) || Notification.permission !== "default" || N.prefs.navegador === false) return "";
    if (localStorage.getItem("nodo.nn.bannerNo") === "1") return "";
  } catch (_) { return ""; }
  return `<div class="nn-banner">
    <span class="nn-ic">${I("bell")}</span>
    <div><b>Entérate aunque estés en otra pestaña</b><span>Te avisamos de lo urgente (pagos por validar, clientes que piden una persona) con un aviso del navegador.</span>
      <div class="nn-acts"><button class="nn-btn pri" data-a="permiso">Activar avisos</button><button class="nn-btn ghost" data-a="banner-no">Ahora no</button></div></div>
  </div>`;
}

function filtradas() {
  const base = [...N.rows.values()].filter((n) => !oculta(n) && (N.bot === "todos" || n.channel_id === N.bot)
    && (N.tab === "todas" || pendiente(n)));
  return base;
}

function pintarLista() {
  const d = document.getElementById("nodoNotif");
  if (!d || N.vista !== "lista") return;
  const base = filtradas();
  const cuenta = (g) => base.filter((n) => (n.grupo || tipoDe(n).g) === g).length;
  const f = d.querySelector(".nn-filt");
  // Sin nada que filtrar, los chips en cero solo ensucian el «Todo al día».
  f.hidden = !base.length;
  f.innerHTML =[`<button class="nn-chip${N.grupo === "todo" ? " on" : ""}" data-g="todo">Todo<i>${base.length}</i></button>`,
    ...GRUPOS.map((g) => { const k = cuenta(g.k); return `<button class="nn-chip${N.grupo === g.k ? " on" : ""}" data-g="${g.k}"${k || N.grupo === g.k ? "" : " disabled"}>${g.lb}${k ? `<i>${k}</i>` : ""}</button>`; })].join("");

  let lista = base.filter((n) => N.grupo === "todo" || (n.grupo || tipoDe(n).g) === N.grupo);
  const box = d.querySelector(".nn-list");
  if (!lista.length) { box.innerHTML = vacio(); return; }

  if (N.tab === "atender") {
    // Lo más grave arriba; dentro de cada nivel, lo más nuevo primero.
    lista.sort((a, b) => (RANGO[a.prioridad] ?? 3) - (RANGO[b.prioridad] ?? 3) || Date.parse(b.created_at) - Date.parse(a.created_at));
    box.innerHTML = lista.map((n) => item(n, true)).join("");
    return;
  }
  lista.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  let html = "", dia = "";
  for (const n of lista) {
    const k = etiquetaDia(n.created_at);
    if (k !== dia) { dia = k; html += `<div class="nn-day">${esc(k)}</div>`; }
    html += item(n, false);
  }
  box.innerHTML = html + `<p class="nn-foot">Se guardan los últimos 60 días. El detalle de cada caso sigue en el chat y en Pedidos.</p>`;
}

function vacio() {
  const filtrado = N.grupo !== "todo" || N.bot !== "todos";
  if (N.tab === "atender") return `<div class="nn-empty">
      <span class="nn-empty-ic ok">${I("check")}</span>
      <b>${filtrado ? "Nada por atender acá" : "Todo al día"}</b>
      <p>${filtrado ? "Prueba con otro filtro o mira la pestaña «Todas»." : "No hay pagos esperando ni clientes pidiendo una persona. Cuando algo te necesite, aparece acá y suena."}</p>
    </div>`;
  return `<div class="nn-empty">
      <span class="nn-empty-ic">${I("bell")}</span>
      <b>${filtrado ? "Sin notificaciones con este filtro" : "Aún no hay notificaciones"}</b>
      <p>${filtrado ? "Prueba con otro filtro." : "Acá te van a llegar los pagos por validar, las ventas, los clientes que piden una persona y las alertas de tu WhatsApp."}</p>
    </div>`;
}

function item(n, conDia) {
  const t = tipoDe(n), c = canal(n.channel_id), res = !!n.resuelta_at, nl = noLeida(n);
  const acc = res ? acciones(n).filter((a) => a.k === "chat" || a.k === "pedido").slice(0, 1) : acciones(n);
  const tags = [];
  if (n.repeticiones > 1) tags.push(`<span class="nn-tag rep">×${n.repeticiones}</span>`);
  if (res) tags.push(`<span class="nn-tag ok">${I("check")}${esc(n.resuelta_por || "Resuelto")}</span>`);
  if (c && N.bot === "todos" && (N.ctx.S.channels || []).length > 1)
    tags.push(`<span class="nn-tag"><img src="${esc(c.logo_url || N.ctx.logoFallback)}" alt="">${esc(c.nombre)}</span>`);
  return `<article class="nn-item pr-${esc(n.prioridad)}${nl ? " unread" : ""}${res ? " done" : ""}" data-id="${n.id}">
    <span class="nn-ic">${I(t.ic)}</span>
    <div class="nn-body">
      <div class="nn-top"><b class="nn-tt">${esc(n.titulo)}</b><time title="${esc(new Date(n.created_at).toLocaleString("es-PE"))}">${esc(cuando(n.created_at, conDia))}</time>${nl ? `<i class="nn-dot" title="Sin leer"></i>` : ""}</div>
      ${n.detalle ? `<div class="nn-dt">${esc(n.detalle)}</div>` : ""}
      ${tags.length ? `<div class="nn-meta">${tags.join("")}</div>` : ""}
      ${acc.length ? `<div class="nn-acts">${acc.map((a, i) => `<button class="nn-btn${a.ghost ? " ghost" : i === 0 && !res ? " pri" : ""}" data-act="${a.k}"${a.href ? ` data-href="${a.href}"` : ""}${a.k === "resolver" ? ' title="Marcar como atendido: sale de «Por atender» para todo el equipo"' : ""}>${I(a.ic)}${esc(a.lb)}</button>`).join("")}</div>` : ""}
    </div>
  </article>`;
}

// Qué se puede hacer con cada aviso. El primero es el botón principal.
function acciones(n) {
  const t = n.tipo, A = [];
  const chat = n.contact_id ? { k: "chat", lb: "Abrir chat", ic: "message" } : null;
  const ped = n.order_id ? { k: "pedido", lb: "Ver pedido", ic: "kanban" } : null;
  if (VALIDAR.has(t)) { A.push({ k: "validar", lb: "Validar pago", ic: "compass" }); if (chat) A.push(chat); }
  else if (["pedido_lima", "pedido_provincia", "venta_extra"].includes(t)) { if (ped) A.push(ped); if (chat) A.push(chat); }
  else if (t === "stock_agotado" || t === "stock_bajo") A.push({ k: "ir", href: "productos.html", lb: "Ver productos", ic: "productos" });
  else if (t === "whatsapp_salud") A.push({ k: "ir", href: "canales.html", lb: "Ver mi WhatsApp", ic: "canales" });
  else if (t === "campana_detenida") A.push({ k: "ir", href: "campanas.html", lb: "Ver campañas", ic: "campanas" });
  else if (t === "anuncio_sin_producto") { A.push({ k: "ir", href: "productos.html", lb: "Asignar producto", ic: "productos" }); if (chat) A.push(chat); }
  else {
    if (chat) A.push(chat);
    if (ped && ["reclama_vuelto", "pago_de_mas", "cambio_tras_despacho", "pedido_cancelado", "entrega_pedida"].includes(t)) A.push(ped);
  }
  const wa = String(n.contact?.wa_id || "");
  if (t === "pide_humano" && /^\d{8,15}$/.test(wa)) A.push({ k: "llamar", lb: "Llamar", ic: "directo" });
  if (pendiente(n)) A.push({ k: "resolver", lb: "Atendido", ic: "check", ghost: 1 });
  return A;
}

async function ejecutar(n, a) {
  if (!a) return;
  if (a.k === "resolver") return resolver(n);
  if (a.k === "llamar") { location.href = "tel:+" + String(n.contact?.wa_id || "").replace(/\D/g, ""); return; }
  const dest = a.k === "chat" ? `index.html?c=${n.contact_id}`
    : a.k === "pedido" ? `pedidos.html?o=${n.order_id}`
    : a.k === "validar" ? "copiloto.html"
    : a.href;
  if (!dest) return;
  cerrar();
  // El chat y el pedido se buscan en el bot ACTIVO: si el aviso es de otro bot, se cambia primero.
  await N.ctx.ir(dest, n.channel_id);
}

async function resolver(n) {
  const r = N.rows.get(n.id);
  if (r) { r.resuelta_at = new Date().toISOString(); r.resuelta_por = "Atendido"; }
  N.leidas.add(n.id);
  refrescar();
  const { data, error } = await N.ctx.supa.rpc("notif_resolver", { p_id: n.id, p_por: null });
  if (error || data === false) {
    if (r) { r.resuelta_at = null; r.resuelta_por = null; }
    refrescar();
    N.ctx.toast("No se pudo marcar como atendido. Prueba de nuevo.", true);
    return;
  }
  N.ctx.toast("Marcado como atendido");
}

function marcarLeida(n) {
  if (!noLeida(n) || !N.uid) return;
  N.leidas.add(n.id);
  refrescar();
  N.ctx.supa.from("notificacion_lecturas").insert({ user_id: N.uid, notificacion_id: n.id }).then(() => {}, () => {});
}

async function leerTodo() {
  const antes = N.hasta;
  N.hasta = Date.now();
  refrescar();
  const { data, error } = await N.ctx.supa.rpc("notif_marcar_todas");
  if (error) { N.hasta = antes; refrescar(); N.ctx.toast("No se pudo marcar todo como leído.", true); return; }
  if (data) N.hasta = Date.parse(data);
  N.leidas.clear();
}

// Lista del selector de bot: abrir/cerrar sin redibujar el cajón.
function menuBot(d, abrirlo, enfocar = true) {
  const pop = d.querySelector(".nn-bsel-pop"), btn = d.querySelector(".nn-bsel-btn");
  if (!pop || !btn) return;
  pop.hidden = !abrirlo;
  btn.classList.toggle("open", abrirlo);
  btn.setAttribute("aria-expanded", String(abrirlo));
  if (abrirlo && enfocar) (pop.querySelector(".nn-bsel-it.on") || pop.querySelector(".nn-bsel-it"))?.focus();
}
const menuBotAbierto = () => { const p = document.querySelector("#nodoNotif .nn-bsel-pop"); return !!p && !p.hidden; };

function onClickCajon(e) {
  const d = e.currentTarget;
  if (!e.target.closest(".nn-bsel")) menuBot(d, false);   // un clic en cualquier otra parte la cierra
  const a = e.target.closest("[data-a]");
  if (a) {
    const k = a.dataset.a;
    if (k === "bot-menu") menuBot(d, !menuBotAbierto());
    else if (k === "cerrar") cerrar();
    else if (k === "leer-todo") leerTodo();
    else if (k === "prefs") { N.vista = "prefs"; pintar(); }
    else if (k === "volver") { N.vista = "lista"; pintar(); }
    else if (k === "probar-sonido") probarSonido("urgente", tonoUrgente());
    else if (k === "probar-venta") probarSonido("venta", a.dataset.tono || ventaPrefs().tono, ventaPrefs().volumen);
    else if (k === "permiso") pedirPermiso();
    else if (k === "banner-no") { try { localStorage.setItem("nodo.nn.bannerNo", "1"); } catch (_) {} pintar(); }
    return;
  }
  const bot = e.target.closest("[data-bot]");
  if (bot) {
    N.bot = bot.dataset.bot; N.grupo = "todo";
    menuBot(d, false);   // elegir cierra la lista (pintar() la dejaría abierta)
    pintar();
    d.querySelector(".nn-list").scrollTop = 0;
    d.querySelector(".nn-bsel-btn")?.focus({ preventScroll: true });
    return;
  }
  const tab = e.target.closest("[data-tab]");
  if (tab) { N.tab = tab.dataset.tab; N.grupo = "todo"; pintar(); d.querySelector(".nn-list").scrollTop = 0; return; }
  const chip = e.target.closest("[data-g]");
  if (chip && !chip.disabled) { N.grupo = chip.dataset.g; pintarLista(); return; }
  const it = e.target.closest(".nn-item");
  if (!it) return;
  const n = N.rows.get(it.dataset.id);
  if (!n) return;
  const btn = e.target.closest("[data-act]");
  marcarLeida(n);
  if (btn) {
    const acc = acciones(n).find((x) => x.k === btn.dataset.act) || { k: btn.dataset.act, href: btn.dataset.href };
    ejecutar(n, acc);
  }
}

function onChangeCajon(e) {
  const el = e.target;
  if (el.dataset.p) {
    const k = el.dataset.p;
    if (k === "sonido") {
      N.prefs.sonido = el.checked;
      const sec = el.closest(".nn-urg");
      sec?.classList.toggle("off", !el.checked);
      sec?.querySelectorAll(".nn-tonos input, .nn-tono-play").forEach((x) => { x.disabled = !el.checked; });
      if (el.checked) probarSonido("urgente", tonoUrgente());
    }
    else if (k === "urgente-tono") {
      N.prefs.tonoUrgente = el.value;
      el.closest(".nn-urg")?.querySelectorAll(".nn-tono").forEach((x) => x.classList.toggle("on", x.contains(el)));
      probarSonido("urgente", el.value);   // al elegirlo, se escucha
    }
    else if (k === "navegador") { N.prefs.navegador = el.checked; if (el.checked) pedirPermiso(); }
    else if (k === "tipo") {
      const set = new Set(N.prefs.ocultos || []);
      el.checked ? set.delete(el.value) : set.add(el.value);
      N.prefs.ocultos = [...set];
    }
    else if (k.startsWith("venta-")) {
      // Sin redibujar la pantalla (saltaría arriba): se cambian solo las clases y los disabled.
      const v = ventaPrefs(), sec = el.closest(".nn-venta");
      if (k === "venta-sonido") {
        v.sonido = el.checked;
        sec?.classList.toggle("off", !v.sonido);
        sec?.querySelectorAll('.nn-tonos input, .nn-tono-play, input[data-p="venta-vol"]').forEach((x) => { x.disabled = !v.sonido; });
        if (v.sonido) probarSonido("venta", v.tono, v.volumen);
      } else if (k === "venta-tono") {
        v.tono = el.value;
        sec?.querySelectorAll(".nn-tono").forEach((x) => x.classList.toggle("on", x.contains(el)));
        probarSonido("venta", v.tono, v.volumen);   // al elegirlo, se escucha
      } else if (k === "venta-vol") {
        v.volumen = Number(el.value) || 70;
        probarSonido("venta", v.tono, v.volumen);   // al soltar la barra, se escucha a ese volumen
      }
      N.prefs.venta = v;
    }
    guardarPrefs();
    pintarCampana();
    if (k === "navegador") pintar();
  }
}

async function pedirPermiso() {
  try {
    if (!("Notification" in window)) { N.ctx.toast("Este navegador no permite avisos.", true); return; }
    const r = await Notification.requestPermission();
    if (r === "granted") { N.prefs.navegador = true; guardarPrefs(); N.ctx.toast("Listo: te avisaremos de lo urgente aunque estés en otra pestaña"); }
    else if (r === "denied") N.ctx.toast("El navegador bloqueó los avisos. Actívalos en el candado junto a la dirección.", true);
  } catch (_) {}
  pintar();
}

let _guardarT = null;
function guardarPrefs() {
  clearTimeout(_guardarT);
  _guardarT = setTimeout(async () => {
    if (!N.uid) return;
    const { error } = await N.ctx.supa.from("notificacion_usuario")
      .upsert({ user_id: N.uid, prefs: N.prefs, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) N.ctx.toast("No se pudieron guardar tus preferencias.", true);
  }, 350);
}

// ── Preferencias ────────────────────────────────────────────────────
function pintarPrefs(d) {
  const perm = "Notification" in window ? Notification.permission : "no";
  const estadoPerm = perm === "granted" ? `<span class="nn-perm ok">${I("check")}Permitido en este navegador</span>`
    : perm === "denied" ? `<span class="nn-perm no">${I("ban")}Bloqueado: actívalo en el candado junto a la dirección</span>`
    : perm === "no" ? `<span class="nn-perm no">Este navegador no permite avisos</span>`
    : `<span class="nn-perm">El navegador te lo va a preguntar</span>`;
  const sw = (attrs, on, dis) => `<label class="nn-sw${dis ? " dis" : ""}"><input type="checkbox" ${attrs}${on ? " checked" : ""}${dis ? " disabled" : ""}><i></i></label>`;
  const ocultos = new Set(N.prefs.ocultos || []);
  const bloques = GRUPOS.map((g) => {
    const filas = Object.entries(TIPOS).filter(([, t]) => t.g === g.k).map(([k, t]) => `
      <div class="nn-prow">
        <span class="nn-pl">${esc(t.lb)}</span>
        ${t.crit ? `<span class="nn-lock" title="Es plata o un cliente esperando: no se puede ocultar">${I("lock")}Siempre</span>` : sw(`data-p="tipo" value="${k}"`, !ocultos.has(k), false)}
      </div>`).join("");
    return `<div class="nn-pgroup"><h4>${I(g.ic)}${g.lb}</h4>${filas}</div>`;
  }).join("");
  d.innerHTML = `
    <header class="nn-head">
      <button class="nn-ib" data-a="volver" title="Volver">${I("chevronLeft")}</button>
      <div class="nn-hl"><h2>Preferencias</h2><small class="nn-sub">Solo para ti: cada persona del equipo elige las suyas</small></div>
      <button class="nn-ib" data-a="cerrar" title="Cerrar (Esc)">${I("x")}</button>
    </header>
    <div class="nn-list nn-prefs">
      <section class="nn-psec nn-urg${N.prefs.sonido === false ? " off" : ""}">
        <div class="nn-prow big">
          <span class="nn-pl"><b>Sonido para lo urgente</b><small>Suena cuando llega un pago por validar o alguien pide una persona.</small></span>
          ${sw('data-p="sonido"', N.prefs.sonido !== false)}
        </div>
        ${barraTonos(TONOS_URGENTE, tonoUrgente(), "urgente-tono", N.prefs.sonido === false)}
        <div class="nn-vol">
          <button class="nn-tono-play" type="button" data-a="probar-sonido" title="Escuchar el sonido elegido"${N.prefs.sonido === false ? " disabled" : ""}>${I("play")}Escuchar</button>
        </div>
      </section>
      ${seccionVenta(sw)}
      <section class="nn-psec">
        <div class="nn-prow big">
          <span class="nn-pl"><b>Avisos del navegador</b><small>Solo lo urgente, y solo cuando Nodo está en otra pestaña o minimizado.</small></span>
          ${sw('data-p="navegador"', N.prefs.navegador !== false && perm === "granted", perm === "denied" || perm === "no")}
        </div>
        ${estadoPerm}
      </section>
      <section class="nn-psec">
        <h3>Qué ver en la campanita</h3>
        <p class="nn-pnote">Lo que apagues deja de salir en la campanita y en el contador. No toca Telegram (eso se configura en Canales → Avisos).</p>
        ${bloques}
      </section>
    </div>`;
}

// Preferencias del sonido de venta: encendido, cuál suena y a qué volumen.
function seccionVenta(sw) {
  const v = ventaPrefs(), off = !v.sonido;
  return `<section class="nn-psec nn-venta${off ? " off" : ""}">
    <div class="nn-prow big">
      <span class="nn-pl"><b>Sonido de venta</b><small>Suena cuando entra plata: venta digital, pedido de Lima confirmado, adelanto de provincia aprobado o un extra vendido.</small></span>
      ${sw('data-p="venta-sonido"', v.sonido)}
    </div>
    ${barraTonos(TONOS_VENTA, v.tono, "venta-tono", off)}
    <div class="nn-vol">
      <button class="nn-tono-play" type="button" data-a="probar-venta" title="Escuchar el sonido elegido"${off ? " disabled" : ""}>${I("play")}Escuchar</button>
      <span>Volumen</span>
      <input type="range" min="10" max="100" step="5" value="${v.volumen}" style="--p:${(v.volumen - 10) / 90 * 100}%" data-p="venta-vol" aria-label="Volumen del sonido de venta"${off ? " disabled" : ""}>
      <output>${v.volumen}%</output>
    </div>
  </section>`;
}

// ── Fechas ──────────────────────────────────────────────────────────
const _mismoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
function etiquetaDia(iso) {
  const d = new Date(iso), hoy = new Date(), ayer = new Date(Date.now() - 864e5);
  if (_mismoDia(d, hoy)) return "Hoy";
  if (_mismoDia(d, ayer)) return "Ayer";
  const s = d.toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "short" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function cuando(iso, conDia) {
  const d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 6 * 3600 && _mismoDia(d, new Date())) return `hace ${Math.floor(s / 3600)} h`;
  const hm = d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (!conDia || _mismoDia(d, new Date())) return hm;
  if (_mismoDia(d, new Date(Date.now() - 864e5))) return "ayer " + hm;
  return d.toLocaleDateString("es-PE", { day: "numeric", month: "short" });
}
