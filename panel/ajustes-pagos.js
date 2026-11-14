// ═════════════════════════════════════════════════════════════════════════
// Ajustes de pagos (ventana flotante) — Pagos por validar → «⋯» → «Ajustes de pagos».
// (25-oct, Rodrigo) Lo de los pagos que sirve a CUALQUIER bot salió de «Pagos y avisos» (que es de Pedidos, solo
// físicos, y en un bot digital Pedidos ni aparece): quién aprueba un pago digital, el mensaje al rechazar un
// comprobante y qué hacer si reclama un vuelto. Las claves siguen siendo las mismas de channels.pedidos_config
// (digital, rechazo, vuelto): el motor no cambia. Se guarda sobre el config FRESCO y solo esas tres claves, así no
// pisa lo que se edita en Pagos y avisos ni en Bot → Atención.
// ═════════════════════════════════════════════════════════════════════════
import { supa, toast, icon, confirmDialog, updateChannel, patchProductConfig } from "./shell.js";
import { asegurarEstilos } from "./ventana-ajustes.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// (6-nov, Rodrigo: «júntalo ahí») TODO lo de «¿quién aprueba el pago y con cuánta tolerancia?» vive acá, que es la
// sección que tienen TODOS los bots y adonde caen todos los pagos por revisar: el digital, el adelanto de provincia y
// el saldo en la agencia. Cada bot ve solo lo que vende (digital → Pagos digitales; físico → adelanto y saldo).
// Antes el adelanto y el saldo se ajustaban en Pedidos (Adelantos de provincia y Agente de logística): tres «¿quién
// aprueba?» repartidos en dos secciones. En Pedidos quedan el recordatorio y el vencimiento del adelanto (manejo del
// pedido, no del pago). Mismas claves de pedidos_config (adelanto.validacion/tolerancia/revisar_sobre_sol y
// log.modo/tolerancia): el motor no cambia.
const DEF = {
  digital: { validacion: "auto", tolerancia: 1, revisar_sobre_sol: 50 },
  adelanto: { validacion: "manual", tolerancia: 1 },
  log: { modo: "manual", tolerancia: 1 },
  vuelto: { modo: "tranquilizar", mensaje: "" },
  rechazo: { mensaje: "" },
};


// Estilos del aviso de productos con ajuste propio: van acá y no en ventana-ajustes.js, que el navegador guarda en
// caché sin ?v= (un cambio ahí tarda en verse).
const CSS_PROP = `.ajp-prop{display:flex;gap:9px;align-items:flex-start;margin-top:10px;padding:10px 12px;border-radius:10px;background:var(--amber-bg,rgba(245,158,11,.12));color:var(--text);font-size:12px;line-height:1.5}
.ajp-prop>svg{width:16px;height:16px;flex:none;color:var(--amber,#F59E0B);margin-top:1px}
.ajp-prow{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:6px;flex-wrap:wrap}
.ajp-link{background:none;border:none;padding:0;color:var(--brand);font-size:12px;font-weight:600;cursor:pointer}
.ajp-link:disabled{opacity:.5}`;

export async function abrirAjustesPagos(channelId) {
  if (!channelId) return;
  asegurarEstilos();
  if (!document.getElementById("ajp-prop-css")) { const st = document.createElement("style"); st.id = "ajp-prop-css"; st.textContent = CSS_PROP; document.head.appendChild(st); }
  const [{ data: ch, error }, { data: prods }, { data: chm }] = await Promise.all([
    supa.from("channels").select("pedidos_config").eq("id", channelId).maybeSingle(),
    supa.from("products").select("id,nombre,tipo,config").eq("channel_id", channelId).order("nombre"),
    supa.from("channels").select("moneda").eq("id", channelId).maybeSingle(),
  ]);
  if (error) { toast("No se pudieron cargar los ajustes", true); return; }
  const src = (ch?.pedidos_config && typeof ch.pedidos_config === "object") ? ch.pedidos_config : {};
  const digital = { ...DEF.digital, ...(src.digital || {}) };
  // (6-nov) Aprobar solo, por tiempo, el pago que nadie revisó.
  const autoA = { activo: false, horas: 3, ...((src.digital || {}).auto_aprobar || {}) };
  const vuelto = { ...DEF.vuelto, ...(src.vuelto || {}) }; if (!vuelto.modo) vuelto.modo = vuelto.activo === false ? "off" : "tranquilizar";
  const rechazo = { ...DEF.rechazo, ...(src.rechazo || {}) };
  // «Pagos digitales» solo si el bot vende algo que no es físico (digital o micro app); adelanto y saldo, si vende algo físico.
  const vendeDigital = (prods || []).some((p) => p.tipo !== "fisico");
  const vendeFisico = (prods || []).some((p) => p.tipo === "fisico");
  const adelanto = { ...DEF.adelanto, ...(src.adelanto || {}) };
  const log = { ...DEF.log, ...(src.log || {}) };
  const sym = (chm?.moneda || "PEN").toUpperCase() === "PEN" ? "S/" : "$";
  // (5-nov) Productos con su PROPIO Automático/Manual (Productos → el producto → ¿Cómo se entrega? → Validación del pago).
  // Ese ajuste manda sobre el del bot (digitalPagoModo en el motor): sin decirlo acá, pasar el bot a Manual dejaba esos
  // productos entregando solos y nadie se enteraba.
  const propios = (prods || []).filter((p) => p.tipo !== "fisico" && ["auto", "manual"].includes(p.config?.validacion_pago));
  const MODO_TXT = { auto: "Automático", manual: "Manual" };
  const propiosHtml = () => !propios.length ? "" : `<div class="ajp-prop" id="ajpProp">${icon("alert")}<div>
      <b>${propios.length === 1 ? "Este producto usa su propio ajuste" : "Estos productos usan su propio ajuste"}</b> y no cambia aunque cambies el de arriba:
      ${propios.map((p) => `<div class="ajp-prow"><span>${esc(p.nombre)} · <b>${MODO_TXT[p.config.validacion_pago]}</b></span><button class="ajp-link" data-quitar="${esc(p.id)}">Que use el del bot</button></div>`).join("")}
      <span class="ajp-hint" style="display:block;margin-top:4px">Se cambia en Productos → el producto → ¿Cómo se entrega? → Validación del pago.</span></div></div>`;

  const opt = (grp, v, on, t, d) => `<div class="ajp-opt ${on ? "on" : ""}" data-grp="${grp}" data-v="${v}"><span class="ajp-dot"><i></i></span><div><b>${t}</b><span>${d}</span></div></div>`;
  const ov = document.createElement("div"); ov.className = "ajp-ov";
  ov.innerHTML = `<div class="ajp" role="dialog" aria-label="Ajustes de pagos">
    <div class="ajp-hd"><h3>${icon("config")} Ajustes de pagos</h3><button class="ajp-x" id="ajpX" title="Cerrar">${icon("x")}</button></div>
    <div class="ajp-sub">Cómo se aprueban los pagos y qué le dice el bot al cliente cuando hay un problema con el suyo.</div>

    ${vendeDigital ? `<div class="ajp-card">
      <h4>${icon("disparadores")} Pagos digitales</h4>
      <div class="ajp-desc">El cliente paga y recibe su producto al instante. Esto decide si esa entrega es automática o espera tu visto bueno. Es lo que usa el bot; cada producto digital puede cambiarlo en su ficha.</div>
      ${opt("dig", "auto", digital.validacion !== "manual", "Automático: si el monto cuadra, entrega sin consultarme", "La IA lee el comprobante y, si el monto coincide, envía el acceso al toque. Ante cualquier duda te lo deja acá, en Pagos por validar.")}
      ${opt("dig", "manual", digital.validacion === "manual", "Manual: cuando llegue un comprobante, avísame para aprobarlo yo", "La IA lo analiza y te deja su lectura hecha, pero no entrega nada hasta que lo apruebes acá.")}
      ${propiosHtml()}
      <!-- (6-nov, auditoría de Rodrigo) Orden: modo → (solo en Automático) revisar si paga de más → perdonar si paga
           de menos → aprobar solo si nadie lo revisa. El freno de sobrepago solo existe para que el modo AUTOMÁTICO no
           apruebe solo un pago raro: en Manual todos pasan por ti, así que ahí se esconde. Perdonar y «aprobar solo»
           se usan en los dos modos (el bot decide con la tolerancia si le dice «te faltan S/ X»). -->
      <div class="ajp-num" id="ajpRevBlk" style="${digital.validacion === "manual" ? "display:none" : ""}">Si paga de más, que lo revise yo cuando se pase por más de <span class="box"><span>${sym}</span><input id="ajpRev" type="number" min="0" step="5" value="${Number(digital.revisar_sobre_sol ?? 50)}"></span>
        <small>Si se pasa un poco, entrega solo y la venta cuenta lo que pagó. Si se pasa mucho, te lo deja acá y lo que sobra queda como vuelto. Ponlo en 0 para revisar cualquier pago de más.</small></div>
      <div class="ajp-num">Si paga de menos, perdonarle hasta <span class="box"><span>${sym}</span><input id="ajpTol" type="number" min="0" step="0.5" value="${Number(digital.tolerancia ?? 1)}"></span>
        <small>Con un producto de ${sym} 19 y esto en 1: si paga ${sym} 18 se acepta; si paga ${sym} 17, el bot le dice que le faltan ${sym} 2.</small></div>
      <div class="ajp-tog" id="ajpAutoT" style="margin-top:14px"><span><b>Si nadie lo revisa, aprobarlo solo</b><small>Para que el cliente no se quede esperando su acceso si no alcanzas a verlo. Te avisamos cuando pase.</small></span><span class="ajp-sw ${autoA.activo ? "on" : ""}" id="ajpAutoSw"></span></div>
      <div class="ajp-num" id="ajpAutoBlk" style="${autoA.activo ? "" : "display:none"}">Aprobarlo a las <input class="ajp-in" id="ajpAutoH" type="number" min="0.5" step="0.5" value="${Number(autoA.horas) || 3}" style="width:80px"> horas de que llegó el comprobante
        <small>Ojo: se aprueba aunque el bot haya tenido dudas (monto que no se leía, pago en partes…). Si no lo quieres así, apágalo y revísalos tú.</small></div>
    </div>` : ""}

    ${vendeFisico ? `<div class="ajp-card">
      <h4>${icon("clock")} Adelanto de provincia</h4>
      <div class="ajp-desc">El pedido de provincia se crea apenas el cliente te da sus datos, <b>antes de pagar</b>. Esto decide quién aprueba su adelanto.</div>
      ${opt("adel", "manual", adelanto.validacion !== "auto", "Manual: cuando llegue un comprobante, avísame para aprobarlo yo", "La IA igual lo analiza y te deja su lectura hecha, pero no aprueba nada: la tarjeta te espera acá, en Pagos por validar.")}
      ${opt("adel", "auto", adelanto.validacion === "auto", "Automático: si el monto cuadra, valida el adelanto sin consultarme", "Ante cualquier duda (monto, fraude o comprobante repetido) te lo deja igual acá.")}
      <div class="ajp-num">Si paga de menos, perdonarle hasta <span class="box"><span>${sym}</span><input id="aTol" type="number" min="0" step="0.5" value="${Number(adelanto.tolerancia ?? 1)}"></span>
        <small>Con un adelanto de ${sym} 20 y esto en 1: si manda ${sym} 19 se acepta y el pedido sale; si manda ${sym} 18, el bot le dice que le faltan ${sym} 2.</small></div>
      <div class="ajp-num" id="aRevBlk" style="${adelanto.validacion === "auto" ? "" : "display:none"}">Si el monto se pasa del TOTAL del pedido por más de <span class="box"><span>${sym}</span><input id="aRev" type="number" min="0" step="5" value="${Number(adelanto.revisar_sobre_sol ?? digital.revisar_sobre_sol ?? 50)}"></span>
        <small>…lo revisas tú (por si el bot lee mal la captura). Si paga más que el adelanto, lo de más se descuenta de lo que paga en la agencia.</small></div>
      <div class="ajp-hint">El recordatorio y el vencimiento si no paga siguen en Pedidos → Ajustes → Adelantos de provincia.</div>
    </div>

    <div class="ajp-card">
      <h4>${icon("key")} Saldo en la agencia (clave de recojo)</h4>
      <div class="ajp-desc">En la agencia el cliente no paga nada: antes de darle la clave de recojo te paga a ti el saldo. Esto decide quién aprueba ese pago.</div>
      ${opt("log", "manual", log.modo !== "auto", "Manual: cuando recibas un pago, avísame para aprobarlo antes de dar la clave", "La IA te avisa cuando recibe un comprobante. Cuando lo apruebes, le da la clave de recojo.")}
      ${opt("log", "auto", log.modo === "auto", "Automático: si paga el saldo, dale su clave sin consultarme", "La IA lee el comprobante y, si el monto coincide, entrega la clave sola. Ante cualquier duda te lo deja acá.")}
      <div class="ajp-num">Si paga de menos, perdonarle hasta <span class="box"><span>${sym}</span><input id="lTol" type="number" min="0" step="0.5" value="${Number(log.tolerancia ?? 1)}"></span>
        <small>Pagar de más siempre se acepta. Si no cuadra, el pago queda acá para que lo revises.</small></div>
    </div>` : ""}

    <div class="ajp-card">
      <h4>${icon("shield")} Cuando rechazas un comprobante</h4>
      <div class="ajp-desc">Si rechazas un pago acá o en la ficha del cliente y eliges <b>«Que el bot le pida otro»</b>, el bot le escribe esto. Al rechazar te lo mostramos igual, por si ese cliente necesita otro motivo.</div>
      <span class="ajp-lbl">Lo que le dice el bot</span>
      <textarea id="ajpRz" rows="3" placeholder="No pude validar ese comprobante. ¿Me lo reenvías, por favor?">${esc(rechazo.mensaje || "")}</textarea>
      <div class="ajp-hint">Le llega así: «Mmm, revisé tu comprobante 🤔», después esta frase y al final el cierre de tu flujo. Vacío = la frase de ejemplo.</div>
    </div>

    <div class="ajp-card">
      <h4>${icon("dollar")} Pago de más (vuelto)</h4>
      <div class="ajp-desc">Qué hace el bot cuando el cliente <b>reclama</b> que pagó de más.</div>
      ${opt("vl", "tranquilizar", vuelto.modo === "tranquilizar", "Tranquilizar y seguir vendiendo", "Le dice que estás gestionando su vuelto, te avisa por Telegram y sigue atendiéndolo.")}
      ${opt("vl", "humano", vuelto.modo === "humano", "Pasar a un humano", "Pausa esa conversación y te la traspasa. Si no estás disponible, el cliente queda esperando.")}
      ${opt("vl", "off", vuelto.modo === "off", "No hacer nada especial", "Lo maneja la IA como cualquier mensaje, sin avisarte.")}
      <div id="ajpVlWrap" style="display:${vuelto.modo === "tranquilizar" ? "block" : "none"}">
        <span class="ajp-lbl">Mensaje al cliente</span>
        <textarea id="ajpVl" rows="4" placeholder="¡No te preocupes! 🙌 Registramos que pagaste de más{{monto}}. Un administrador está gestionando la devolución de tu vuelto y te enviaremos la constancia por aquí en un momentito.">${esc(vuelto.mensaje || "")}</textarea>
        <div class="ajp-hint">Puedes usar <b>{{vuelto}}</b> (el monto) o <b>{{monto}}</b> (agrega « (${sym} 20)»). Vacío = un mensaje por defecto.</div>
      </div>
    </div>

    <div class="ajp-acts"><button class="ajp-btn" id="ajpCancel">Cancelar</button><button class="ajp-btn pri" id="ajpSave">Guardar</button></div>
  </div>`;
  document.body.appendChild(ov);
  const $ = (id) => ov.querySelector("#" + id);
  // «Que use el del bot»: le quita al producto su ajuste propio, al instante (como en su ficha).
  const wireProp = () => ov.querySelectorAll("[data-quitar]").forEach((b) => b.onclick = async () => {
    b.disabled = true;
    const r = await patchProductConfig(b.dataset.quitar, (cfg) => { delete cfg.validacion_pago; });
    if (!r.ok) { b.disabled = false; toast("No se pudo cambiar: " + (r.error?.message || "error"), true); return; }
    const i = propios.findIndex((p) => p.id === b.dataset.quitar); const nom = propios[i]?.nombre || "El producto";
    if (i >= 0) propios.splice(i, 1);
    const box = $("ajpProp"); if (box) { const t = document.createElement("div"); t.innerHTML = propiosHtml(); box.replaceWith(...(t.firstElementChild ? [t.firstElementChild] : [])); wireProp(); }
    toast(`${nom} ahora usa el ajuste del bot`);
  });
  wireProp();
  let sucio = false;
  ov.querySelectorAll("textarea, input").forEach((el) => el.addEventListener("input", () => { sucio = true; }));
  ov.querySelectorAll(".ajp-opt").forEach((o) => o.onclick = () => {
    ov.querySelectorAll(`.ajp-opt[data-grp="${o.dataset.grp}"]`).forEach((x) => x.classList.toggle("on", x === o));
    // El freno «si paga de más, revisarlo yo» solo aparece con Automático (en Manual todo pasa por ti).
    if (o.dataset.grp === "dig") { digital.validacion = o.dataset.v; const rb = $("ajpRevBlk"); if (rb) rb.style.display = o.dataset.v === "manual" ? "none" : ""; }
    if (o.dataset.grp === "adel") { adelanto.validacion = o.dataset.v; const rb = $("aRevBlk"); if (rb) rb.style.display = o.dataset.v === "auto" ? "" : "none"; }
    if (o.dataset.grp === "log") log.modo = o.dataset.v;
    if (o.dataset.grp === "vl") { vuelto.modo = o.dataset.v; $("ajpVlWrap").style.display = vuelto.modo === "tranquilizar" ? "block" : "none"; }
    sucio = true;
  });
  // Cerrar con cambios sin guardar: se pregunta (acá se escriben mensajes; un clic afuera no los tiene que borrar).
  const cerrar = async () => {
    if (sucio && !await confirmDialog({ title: "¿Salir sin guardar?", message: "Tienes cambios en los ajustes de pagos que todavía no guardaste.", confirmText: "Salir sin guardar", danger: true })) return;
    ov.remove();
  };
  const autoT = $("ajpAutoT");
  // Al PRENDERLO se anota desde cuándo: los pagos que ya estaban esperando no se aprueban de golpe (en Prime había uno del 7-oct).
  if (autoT) autoT.onclick = () => { autoA.activo = !autoA.activo; if (autoA.activo) autoA.desde = new Date().toISOString(); $("ajpAutoSw").classList.toggle("on", autoA.activo); $("ajpAutoBlk").style.display = autoA.activo ? "" : "none"; sucio = true; };
  $("ajpX").onclick = cerrar; $("ajpCancel").onclick = cerrar;
  ov.onclick = (e) => { if (e.target === ov) cerrar(); };
  $("ajpSave").onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    if (vendeDigital) {
      digital.tolerancia = Math.max(0, Number($("ajpTol").value) || 0);
      digital.revisar_sobre_sol = Math.max(0, Number($("ajpRev").value) || 0);
      digital.auto_aprobar = { activo: !!autoA.activo, horas: Math.max(0.5, Number($("ajpAutoH").value) || 3), ...(autoA.desde ? { desde: autoA.desde } : {}) };
    }
    rechazo.mensaje = $("ajpRz").value.trim();
    vuelto.mensaje = $("ajpVl").value.trim();
    // Sobre lo FRESCO, y solo estas claves. Del adelanto y del saldo, solo lo del pago: el recordatorio y el vencimiento
    // (adelanto.nudge / adelanto.vencimiento) y las instrucciones de logística (log.instr_*) se quedan como estaban.
    const { data: fresh } = await supa.from("channels").select("pedidos_config").eq("id", channelId).maybeSingle();
    const base = (fresh?.pedidos_config && typeof fresh.pedidos_config === "object") ? fresh.pedidos_config : {};
    const extra = {};
    if (vendeFisico) {
      extra.adelanto = { ...(base.adelanto || {}), validacion: adelanto.validacion,
        tolerancia: Math.max(0, Number($("aTol").value) || 0), revisar_sobre_sol: Math.max(0, Number($("aRev").value) || 0) };
      extra.log = { ...(base.log || {}), modo: log.modo, tolerancia: Math.max(0, Number($("lTol").value) || 0) };
    }
    const { error: e2 } = await updateChannel(channelId, { pedidos_config: { ...base, digital, rechazo, vuelto, ...extra } });
    btn.disabled = false;
    if (e2) { toast(e2.message || "No se pudo guardar", true); return; }
    toast("Ajustes de pagos guardados"); ov.remove();
  };
}
