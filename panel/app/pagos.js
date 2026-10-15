// Pagos por validar (copiloto.html en el celular): la misma cola, los mismos tipos y la misma función order-update
// para aprobar o rechazar. Lo que la IA leyó del comprobante va en chips; la foto se amplía al tocarla.
import { A, $, esc, ic, on, emit, supa, invoke, avatar, abrirHoja, confirmar, pedirTexto, hoja, toast, verFoto, fmtHora, trasArranque } from "./app.js";
import { pageAll, enTrozos } from "../shell.js";
import * as O from "../orders.js";
import { esPrueba } from "./comun.js";

const ETAPAS = [
  { id: "digital", titulo: "Pago digital", sub: "Al aprobar, el bot entrega al instante y sigue vendiendo." },
  { id: "extra", titulo: "Venta extra", sub: "Al aprobar, el bot entrega el extra y continúa." },
  { id: "adelanto", titulo: "Adelanto", sub: "Al aprobar, el pedido queda listo para enviar y el bot le confirma." },
  { id: "saldo", titulo: "Saldo", sub: "Al aprobar, el bot le manda la clave de recojo." },
  { id: "lima", titulo: "Prepago de Lima", sub: "Al aprobar, baja lo que cobra el motorizado y el bot le confirma." },
];
const P = { lista: [], imgs: {}, dudas: {}, cargando: false, enVuelo: false };

export function init() {
  on("bot", () => { P.lista = []; cargar(); });
  on("orden", () => cargarPronto());
  on("resync", () => cargar());
  on("tab", (t) => { if (t === "pagos") cargar(); });
  $("#pagosPad").addEventListener("click", clic);
}
let _t = null;
function cargarPronto() { clearTimeout(_t); _t = setTimeout(cargar, 700); }
const rechVigente = (s, t) => { const rej = s[t + "_rechazado_at"], rec = s[t + "_recibido_at"]; return !!rej && (!rec || new Date(rej) >= new Date(rec)); };
function etapaDe(o) {
  const s = o.shipping || {};
  if (o.estado === "pendiente" && s.digital_pendiente) return "digital";
  if (s.extra_pendiente) return "extra";
  if (s.pago_adelantado_por_validar === true) return "lima";
  if (o.estado === "esperando_adelanto" && (s.adelanto_comprobante || s.adelanto_recibido_at) && !rechVigente(s, "adelanto")) return "adelanto";
  if (o.estado === "en_agencia" && (s.saldo_comprobante || s.saldo_recibido_at) && !rechVigente(s, "saldo")) return "saldo";
  return null;
}
export async function cargar() {
  const ch = A.ch; if (!ch) return;
  if (P.cargando) { cargarPronto(); return; }
  P.cargando = true;
  if (!P.lista.length) $("#pagosPad").innerHTML = `<div class="cargando">Cargando pagos…</div>`;
  try {
    const sel = "id,amount,currency,estado,shipping,order_bumps,contact_id,product_id,created_at,updated_at,contact:contact_id(nombre,wa_id,source,bot_activo),product:product_id(nombre,emoji)";
    const [base, ex, lm] = await Promise.all([
      pageAll((f, t) => supa.from("orders").select(sel).eq("channel_id", ch).in("estado", ["pendiente", "esperando_adelanto", "en_agencia"]).order("created_at", { ascending: true }).order("id").range(f, t)),
      pageAll((f, t) => supa.from("orders").select(sel).eq("channel_id", ch).eq("shipping->>extra_pendiente", "true").order("created_at", { ascending: true }).order("id").range(f, t)).catch(() => []),
      pageAll((f, t) => supa.from("orders").select(sel).eq("channel_id", ch).eq("shipping->>pago_adelantado_por_validar", "true").order("created_at", { ascending: true }).order("id").range(f, t)).catch(() => []),
    ]);
    const vistos = new Set(), todas = [];
    for (const o of [...(base?.data || base || []), ...(ex?.data || ex || []), ...(lm?.data || lm || [])]) { if (!vistos.has(o.id)) { vistos.add(o.id); todas.push(o); } }
    const lista = todas.filter((o) => !esPrueba(o.contact)).map((o) => ({ ...o, et: etapaDe(o) })).filter((o) => o.et);
    // Comprobante de respaldo: la última imagen que mandó el cliente (como copiloto.html)
    const ids = [...new Set(lista.map((o) => o.contact_id))], imgs = {};
    for (const t of enTrozos(ids, 100)) {
      const { data } = await supa.from("messages").select("contact_id,content,ts").eq("channel_id", ch).in("contact_id", t).eq("direction", "in").eq("type", "image").order("ts", { ascending: false }).limit(300);
      (data || []).forEach((m) => { const u = m.content?.media_url; if (u && !imgs[m.contact_id]) imgs[m.contact_id] = u; });
    }
    const dudas = {};
    for (const t of enTrozos(ids)) {
      const { data } = await supa.from("contact_field_values").select("contact_id,value,custom_fields!inner(key)").in("contact_id", t);
      (data || []).forEach((f) => { const k = f.custom_fields?.key; if (k && k.startsWith("_duda_") && f.value) (dudas[f.contact_id] = dudas[f.contact_id] || []).push(f.value); });
    }
    await trasArranque();
    if (ch !== A.ch) return;
    P.lista = lista; P.imgs = imgs; P.dudas = dudas;
    pintar();
  } catch (e) { console.error(e); $("#pagosPad").innerHTML = `<div class="empty"><b>${ic("alert")}</b>No se pudieron cargar los pagos.<br>${esc(e.message || e)}</div>`; }
  finally { P.cargando = false; }
}
const sym = (o) => (o.currency && o.currency !== "PEN" ? o.currency : "S/");
function compDe(o) {
  const s = o.shipping || {};
  return { digital: s.digital_comprobante, extra: s.extra_comprobante, adelanto: s.adelanto_comprobante, saldo: s.saldo_comprobante, lima: s.pago_adelantado_comprobante }[o.et] || P.imgs[o.contact_id] || null;
}
function montoDe(o) {
  const s = o.shipping || {};
  return { adelanto: s.adelanto, saldo: s.saldo, digital: s.digital_monto_leido ?? o.amount, extra: s.extra_monto_leido ?? "", lima: s.pago_adelantado_monto ?? "" }[o.et];
}
function chips(o) {
  const s = o.shipping || {}, y = sym(o), out = [];
  const lin = (ok, leido, op, revisar) => {
    out.push(ok ? `<span class="ck">${ic("check")} La IA lo leyó y cuadra</span>` : `<span class="ck warn">${ic("alert")} La IA no lo dio por bueno</span>`);
    if (leido != null && leido !== "") out.push(`<span class="ck info">Leyó ${y} ${esc(leido)}</span>`);
    if (op) out.push(`<span class="ck info">Op. ${esc(op)}</span>`);
    if (revisar) out.push(`<span class="ck warn">${esc(revisar)}</span>`);
  };
  if (o.et === "digital" && (s.digital_ok_ia != null || s.digital_monto_leido != null)) lin(s.digital_ok_ia === true, s.digital_monto_leido, s.digital_operacion, s.digital_revisar);
  else if (o.et === "extra" && (s.extra_ok_ia != null || s.extra_monto_leido != null)) lin(s.extra_ok_ia === true, s.extra_monto_leido, s.extra_operacion, null);
  else if (o.et === "adelanto" && (s.adelanto_revisar || s.adelanto_monto_leido != null)) lin(s.adelanto_ok_ia === true, s.adelanto_monto_leido, s.adelanto_operacion_leida, s.adelanto_revisar);
  else if (o.et === "saldo" && s.saldo_revisar) { if (/clave de recojo/i.test(s.saldo_revisar) && s.clave_recojo) out.push(`<span class="ck">${ic("check")} Saldo leído · clave lista</span>`); else lin(false, s.saldo_monto_leido, null, s.saldo_revisar); }
  else if (o.et === "lima") { const leyo = s.pago_adelantado_monto != null && s.pago_adelantado_monto !== ""; out.push(leyo ? `<span class="ck">${ic("check")} La IA leyó ${y} ${esc(s.pago_adelantado_monto)}</span>` : `<span class="ck warn">${ic("alert")} No pudo leer el monto: míralo en la foto</span>`); if (s.pago_adelantado_operacion) out.push(`<span class="ck info">Op. ${esc(s.pago_adelantado_operacion)}</span>`); out.push(`<span class="ck info">Hoy el motorizado cobra ${y} ${esc(O.porCobrarPuerta(o))}</span>`); }
  if (o.et === "digital") { const l = s.digital_monto_leido; if (l != null && l !== "" && Math.abs(Number(l) - Number(o.amount)) > 0.01) out.push(`<span class="ck warn">${ic("alert")} El precio es ${y} ${esc(o.amount)}</span>`); }
  if (o.et !== "digital" && o.amount != null) out.push(`<span class="ck info">Total del pedido ${y} ${esc(O.total(o))}</span>`);
  (P.dudas[o.contact_id] || []).forEach((d) => out.push(`<span class="ck warn">${ic("alert")} ${esc(d)}</span>`));
  return out.join("");
}
const BOTON = { digital: "Aprobar y entregar", extra: "Aprobar y entregar", adelanto: "Aprobar y avisarle", saldo: "Aprobar y dar la clave", lima: "Aprobar y avisarle" };
function pintar() {
  const n = P.lista.length;
  $("#tb-pagos").hidden = !n; $("#tb-pagos").textContent = n;
  emit("pendientesPagos", n);
  const box = $("#pagosPad");
  box.innerHTML = `<div><h2 class="h">Pagos por validar</h2></div><p class="sub">Mira la foto, revisa lo que leyó la IA y decide.</p>` + (n ? P.lista.slice().reverse().map((o) => {
    const c = o.contact || {}, et = ETAPAS.find((e) => e.id === o.et), url = compDe(o), m = montoDe(o), s = o.shipping || {};
    return `<article class="pay" data-id="${o.id}">
      <div class="payh">${avatar(o.contact_id, c.nombre, c.wa_id)}<span class="rmid"><b>${esc(c.nombre || "Cliente")}</b><span>${fmtHora(s[o.et + "_recibido_at"] || o.updated_at)} · ${o.product ? esc(o.product.nombre) : ""}</span></span><span class="amt num">${m != null && m !== "" ? `${sym(o)} ${esc(m)}` : "—"}</span></div>
      <span class="ptype">${esc(et.titulo)} · ${esc(et.sub)}</span>
      ${url ? `<img class="comprob" src="${esc(url)}" data-ver="${esc(url)}" alt="Comprobante" loading="lazy">` : `<div class="sincomp">Sin foto del comprobante. Revísalo en el chat.</div>`}
      <div class="checks">${chips(o)}</div>
      ${o.et === "saldo" && !s.clave_recojo ? `<label class="flabel" for="clave-${o.id}">${ic("key")} Clave de recojo (falta)</label><input class="inpt clave-in" id="clave-${o.id}" inputmode="text" placeholder="Escríbela antes de aprobar">` : ""}
      <div class="acts"><button type="button" class="btn ghost" data-a="no">Rechazar</button><button type="button" class="btn main" data-a="ok">${ic(o.et === "saldo" ? "key" : "check")} ${BOTON[o.et]}</button></div>
      <button type="button" class="btn soft sm" data-a="chat">${ic("message")} Abrir el chat</button>
    </article>`;
  }).join("") : `<div class="empty"><b>${ic("check")}</b>Todo validado.<br>Te avisamos cuando llegue otro pago.</div>`);
}

// ── Acciones (las de copiloto.html) ──
async function updateOrder(body) {
  const r = await invoke("order-update", body);
  if (!r.ok) { toast(r.data?.detalle || r.data?.error || r.error?.message || "No se pudo actualizar", true); return null; }
  if (r.data?.deduped) { toast("Ese pago ya lo decidió alguien más (o fue un doble toque): no se cambió nada", true); return null; }
  return r.data;
}
async function anotar(o, dec, tipo) {
  try { await supa.from("contact_events").insert({ channel_id: A.ch, contact_id: o.contact_id, tipo: "nota", titulo: (dec === "ok" ? "🧾 Pago aprobado " : "🧾 Pago rechazado ") + "· Pagos por validar", detalle: `${tipo} · ${sym(o)} ${o.amount ?? ""} · desde la app`, meta: { decision: dec, tipo, order_id: o.id, por: A.email } }); } catch (_) { /* */ }
}
async function enVuelo(fn) { if (P.enVuelo) return; P.enVuelo = true; try { await fn(); } finally { P.enVuelo = false; } }
function clic(e) {
  const v = e.target.closest("[data-ver]"); if (v) { verFoto(v.dataset.ver); return; }
  const b = e.target.closest("[data-a]"); if (!b) return;
  const card = b.closest(".pay"), o = P.lista.find((x) => String(x.id) === card.dataset.id); if (!o) return;
  if (b.dataset.a === "chat") { emit("abrirChat", o.contact_id); return; }
  if (b.dataset.a === "ok") enVuelo(() => aprobar(o, card));
  else enVuelo(() => rechazar(o, card));
}
const quitar = (card) => { card.classList.add("bye"); setTimeout(() => cargar(), 350); };
async function aprobar(o, card) {
  const c = o.contact || {}, nom = c.nombre || "Cliente";
  if (o.et === "lima") {
    const leido = String((o.shipping || {}).pago_adelantado_monto ?? "").trim();
    const v = await pedirTexto("Aprobar el pago adelantado", { lead: `${nom} — ¿cuánto pagó? Revisa el monto en la foto: es lo que el motorizado deja de cobrar (hoy cobraría ${sym(o)} ${O.porCobrarPuerta(o)}).`, valor: leido, ph: "Ej. 119", boton: "Aprobar", tipo: "text" });
    if (v == null) return;
    const monto = Number(String(v).replace(",", ".").replace(/[^\d.]/g, ""));
    if (!(monto > 0)) { toast("Escribe el monto en números", true); return; }
    const r = await updateOrder({ order_id: o.id, prepago_lima: "aprobar", monto }); if (!r) return;
    await anotar(o, "ok", "lima");
    const resto = Number(r.saldo);
    toast(r.advertencia ? `Aprobado. ${r.advertencia}` : r.aviso_error ? `Aprobado, pero ${r.aviso_error}. Escríbele tú.` : resto > 0.009 ? `Listo · el motorizado cobra ${sym(o)} ${resto}` : "Listo · el motorizado ya no cobra nada", !!(r.advertencia || r.aviso_error));
    quitar(card); return;
  }
  if (o.et === "extra") {
    if (!(await confirmar("Aprobar la venta extra", `${nom} — el bot le entrega el extra al instante y continúa.`, { si: "Aprobar" }))) return;
    const r = await updateOrder({ order_id: o.id, resume: true, shipping: { extra_pendiente: false, extra_aprobado_at: new Date().toISOString() } }); if (!r) return;
    await anotar(o, "ok", "extra");
    toast(r.entrega_pendiente ? "Aprobado, pero el extra NO se entregó solo: entrégaselo a mano desde el chat" : r.resumed ? "Extra entregado · el bot le está escribiendo" : "Aprobado", !!r.entrega_pendiente);
    quitar(card); return;
  }
  const nuevo = { digital: "confirmada", adelanto: "adelanto_validado", saldo: "saldo_pagado" }[o.et];
  const det = { digital: "El bot le entrega el producto al instante y sigue con su venta.", adelanto: "El pedido pasa a listo para enviar y el bot le confirma.", saldo: "El bot le envía la clave de recojo." }[o.et];
  let extraShip;
  if (o.et === "saldo" && !(o.shipping || {}).clave_recojo) {
    const v = (card.querySelector(".clave-in")?.value || "").trim();
    if (!v) { toast("Escribe la clave de recojo antes de aprobar", true); card.querySelector(".clave-in")?.focus(); return; }
    extraShip = { clave_recojo: v };
  }
  if (!(await confirmar({ digital: "Aprobar el pago digital", adelanto: "Aprobar el adelanto", saldo: "Aprobar el saldo" }[o.et], `${nom} — ${det}`, { si: "Aprobar" }))) return;
  const r = await updateOrder({ order_id: o.id, estado: nuevo, ...(extraShip ? { shipping: extraShip } : {}) }); if (!r) return;
  await anotar(o, "ok", nuevo);
  toast(r.entrega_pendiente ? "Aprobado, pero el producto NO se entregó solo: entrégale el acceso a mano desde el chat" : r.flow_started || r.resumed ? "Listo · el bot le está escribiendo" : "Listo", !!r.entrega_pendiente);
  quitar(card);
}
async function rechazar(o, card) {
  const c = o.contact || {}, nom = c.nombre || "Cliente";
  if (o.et === "lima") {
    if (!(await confirmar("Rechazar el pago adelantado", `${nom} — se marca como no válido y el pedido sigue igual: el motorizado cobra ${sym(o)} ${O.porCobrarPuerta(o)} al entregar. El bot no le escribe; explícale tú por el chat.`, { si: "Rechazar", peligro: true }))) return;
    const r = await updateOrder({ order_id: o.id, prepago_lima: "rechazar", motivo: "Lo rechazaste tú" }); if (!r) return;
    await anotar(o, "no", "lima"); toast(`Rechazado · el motorizado cobra ${sym(o)} ${O.porCobrarPuerta(o)} al entregar`); quitar(card); return;
  }
  const parqueado = o.et === "digital" || o.et === "extra";
  let quien = "humano", motivo = null;
  if (parqueado && c.bot_activo === false) {
    if (!(await confirmar("Rechazar el comprobante", `${nom} — el bot está en pausa en este chat: no se le escribirá nada. El rechazo solo queda anotado; escríbele tú si hace falta.`, { si: "Rechazar", peligro: true }))) return;
  } else if (parqueado) {
    quien = await new Promise((res) => {
      let elegido = null;
      hoja("Rechazar el comprobante", [
        { t: "Que el bot le pida otro", small: "la venta sigue sola", icono: "robot", v: "bot" },
        { t: "Lo atiendo yo", small: "el bot queda en pausa", icono: "user", v: "humano" },
      ], (op) => { elegido = op.v; res(elegido); }, `${nom} — marcas el pago como no válido. ¿Y después?`);
      const t = setInterval(() => { if (!document.querySelector("#sheet.on")) { clearInterval(t); setTimeout(() => { if (!elegido) res(null); }, 260); } }, 150);
    });
    if (!quien) return;
    if (quien === "bot") { motivo = await O.pedirMotivoRechazo(supa, (op) => pedirTexto(op.title, { lead: op.message, valor: op.value, boton: op.confirmText, multilinea: true }), A.ch, nom); if (!motivo) return; }
  } else {
    if (!(await confirmar("Rechazar el comprobante", `${nom} — se marca el ${o.et} como no válido. El pedido queda como está; escríbele para pedirle un pago correcto.`, { si: "Rechazar", peligro: true }))) return;
  }
  const ahora = new Date().toISOString();
  const patch = o.et === "adelanto" ? { adelanto_rechazado_at: ahora, adelanto_revisar: "Lo rechazaste tú" }
    : o.et === "saldo" ? { saldo_rechazado_at: ahora, saldo_revisar: "Lo rechazaste tú" }
    : o.et === "extra" ? { extra_rechazado_at: ahora, extra_revisar: "Lo rechazaste tú", extra_pendiente: false }
    : { digital_rechazado_at: ahora, digital_revisar: "Lo rechazaste tú", digital_pendiente: false };
  const r = await updateOrder({ order_id: o.id, shipping: patch, ...(parqueado ? { reject: quien, reject_motivo: motivo || O.MOTIVO_RECHAZO_DEF } : {}) });
  if (!r) return;
  const yaPausado = c.bot_activo === false, pausa = parqueado && quien === "humano" && !yaPausado;
  if (pausa) { const { error } = await supa.from("contacts").update({ bot_activo: false }).eq("id", o.contact_id); if (error) toast("Rechazado, pero NO pude pausar el bot: " + error.message, true); }
  await anotar(o, "no", o.et);
  toast(yaPausado ? "Rechazado · no se le escribió (el bot está en pausa)" : pausa ? "Rechazado · el bot quedó en pausa en ese chat" : r.rejected ? "Rechazado · el bot le está pidiendo otro comprobante" : "Marcado como rechazado");
  quitar(card);
}
