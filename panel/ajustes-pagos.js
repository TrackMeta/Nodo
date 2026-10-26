// ═════════════════════════════════════════════════════════════════════════
// Ajustes de pagos (ventana flotante) — Pagos por validar → «⋯» → «Ajustes de pagos».
// (25-oct, Rodrigo) Lo de los pagos que sirve a CUALQUIER bot salió de «Pagos y avisos» (que es de Pedidos, solo
// físicos, y en un bot digital Pedidos ni aparece): quién aprueba un pago digital, el mensaje al rechazar un
// comprobante y qué hacer si reclama un vuelto. Las claves siguen siendo las mismas de channels.pedidos_config
// (digital, rechazo, vuelto): el motor no cambia. Se guarda sobre el config FRESCO y solo esas tres claves, así no
// pisa lo que se edita en Pagos y avisos ni en IA → Atención.
// ═════════════════════════════════════════════════════════════════════════
import { supa, toast, icon, confirmDialog, updateChannel } from "./shell.js";
import { asegurarEstilos } from "./ventana-ajustes.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DEF = {
  digital: { validacion: "auto", tolerancia: 1, revisar_sobre_sol: 50 },
  vuelto: { modo: "tranquilizar", mensaje: "" },
  rechazo: { mensaje: "" },
};


export async function abrirAjustesPagos(channelId) {
  if (!channelId) return;
  asegurarEstilos();
  const [{ data: ch, error }, { data: prods }, { data: chm }] = await Promise.all([
    supa.from("channels").select("pedidos_config").eq("id", channelId).maybeSingle(),
    supa.from("products").select("tipo").eq("channel_id", channelId),
    supa.from("channels").select("moneda").eq("id", channelId).maybeSingle(),
  ]);
  if (error) { toast("No se pudieron cargar los ajustes", true); return; }
  const src = (ch?.pedidos_config && typeof ch.pedidos_config === "object") ? ch.pedidos_config : {};
  const digital = { ...DEF.digital, ...(src.digital || {}) };
  const vuelto = { ...DEF.vuelto, ...(src.vuelto || {}) }; if (!vuelto.modo) vuelto.modo = vuelto.activo === false ? "off" : "tranquilizar";
  const rechazo = { ...DEF.rechazo, ...(src.rechazo || {}) };
  // «Pagos digitales» solo si el bot vende algo que no es físico (digital o micro app).
  const vendeDigital = (prods || []).some((p) => p.tipo !== "fisico");
  const sym = (chm?.moneda || "PEN").toUpperCase() === "PEN" ? "S/" : "$";

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
      <div class="ajp-num">Si paga de menos, perdonarle hasta <span class="box"><span>${sym}</span><input id="ajpTol" type="number" min="0" step="0.5" value="${Number(digital.tolerancia ?? 1)}"></span>
        <small>Con un producto de ${sym} 19 y esto en 1: si paga ${sym} 18 se acepta; si paga ${sym} 17, el bot le dice que le faltan ${sym} 2.</small></div>
      <div class="ajp-num">Si paga de más, que lo revise yo cuando se pase por más de <span class="box"><span>${sym}</span><input id="ajpRev" type="number" min="0" step="5" value="${Number(digital.revisar_sobre_sol ?? 50)}"></span>
        <small>Si se pasa un poco, entrega solo y la venta cuenta lo que pagó. Si se pasa mucho, te lo deja acá y lo que sobra queda como vuelto. Ponlo en 0 para revisar cualquier pago de más.</small></div>
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
  let sucio = false;
  ov.querySelectorAll("textarea, input").forEach((el) => el.addEventListener("input", () => { sucio = true; }));
  ov.querySelectorAll(".ajp-opt").forEach((o) => o.onclick = () => {
    ov.querySelectorAll(`.ajp-opt[data-grp="${o.dataset.grp}"]`).forEach((x) => x.classList.toggle("on", x === o));
    if (o.dataset.grp === "dig") digital.validacion = o.dataset.v;
    if (o.dataset.grp === "vl") { vuelto.modo = o.dataset.v; $("ajpVlWrap").style.display = vuelto.modo === "tranquilizar" ? "block" : "none"; }
    sucio = true;
  });
  // Cerrar con cambios sin guardar: se pregunta (acá se escriben mensajes; un clic afuera no los tiene que borrar).
  const cerrar = async () => {
    if (sucio && !await confirmDialog({ title: "¿Salir sin guardar?", message: "Tienes cambios en los ajustes de pagos que todavía no guardaste.", confirmText: "Salir sin guardar", danger: true })) return;
    ov.remove();
  };
  $("ajpX").onclick = cerrar; $("ajpCancel").onclick = cerrar;
  ov.onclick = (e) => { if (e.target === ov) cerrar(); };
  $("ajpSave").onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    if (vendeDigital) {
      digital.tolerancia = Math.max(0, Number($("ajpTol").value) || 0);
      digital.revisar_sobre_sol = Math.max(0, Number($("ajpRev").value) || 0);
    }
    rechazo.mensaje = $("ajpRz").value.trim();
    vuelto.mensaje = $("ajpVl").value.trim();
    // Sobre lo FRESCO, y solo estas tres claves.
    const { data: fresh } = await supa.from("channels").select("pedidos_config").eq("id", channelId).maybeSingle();
    const base = (fresh?.pedidos_config && typeof fresh.pedidos_config === "object") ? fresh.pedidos_config : {};
    const { error: e2 } = await updateChannel(channelId, { pedidos_config: { ...base, digital, rechazo, vuelto } });
    btn.disabled = false;
    if (e2) { toast(e2.message || "No se pudo guardar", true); return; }
    toast("Ajustes de pagos guardados"); ov.remove();
  };
}
