// ═════════════════════════════════════════════════════════════════════════
// Ajustes de Pedidos (ventanas flotantes) — Pedidos → «⋯» → una ventana por sección.
// (25-oct, Rodrigo) «Pagos y avisos» era una página larga; ahora cada sección se elige en el menú «⋯» y abre SU
// ventana: Adelantos de provincia · Agente de logística · Avisos de pedido. Las claves de channels.pedidos_config
// no cambian (adelanto, log, avisos): el motor ni se entera. Cada ventana guarda SOLO su clave, sobre el config
// FRESCO, así no pisa a las otras ni a «Ajustes de pagos» (Pagos por validar) ni a IA → Atención.
// ═════════════════════════════════════════════════════════════════════════
import { supa, toast, icon, confirmDialog, updateChannel } from "./shell.js";
import { attachVarPicker } from "./var-picker.js?v=2";
import { asegurarEstilos } from "./ventana-ajustes.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const D = {
  adelanto: { validacion: "manual", tolerancia: 1, nudge: { activo: false, horas: 12, mensaje: "" }, vencimiento: { activo: false, horas: 48 } },
};
// Los momentos del pedido físico en que el bot le escribe al cliente por su cuenta (clave = estado del pedido).
const MOMENTOS = [
  ["adelanto_validado", "Adelanto aprobado", "Le confirmas que recibiste su adelanto."],
  ["despachado", "Pedido despachado", "Le mandas la guía cuando lo dejas en la agencia."],
  ["en_agencia", "Llegó a la agencia", "Le avisas que ya puede recogerlo y le pides el saldo."],
];
// (6-nov) «Agente de logística» se fue: todo lo que tenía era quién aprueba el saldo, que ahora vive en Pagos por
// validar → Ajustes junto con los demás pagos. De «Adelantos de provincia» quedan el recordatorio y el vencimiento.
// Lo que el bot manda si dejas el aviso VACÍO (resumen de mensajeEstadoDefault en engine.ts): va de ejemplo en gris
// dentro de la caja, así se ve que vacío no es «no avisar».
const POR_DEFECTO = {
  adelanto_validado: "Vacío = el bot manda: «✅ ¡Recibí tu adelanto! Ya estoy preparando tu pedido para mandártelo a la agencia de…» con el resumen del pedido y cuándo llega.",
  despachado: "Vacío = el bot manda: «📦 ¡Ya te mandé tu pedido a la agencia…! Tu guía es… Te aviso apenas llegue.»",
  en_agencia: "Vacío = el bot manda: «📦 ¡Tu pedido ya llegó a la agencia…! Para recogerlo, paga el saldo de S/… y mándame la captura» (o su clave, si ya pagó todo).",
};
export const SECCIONES = [
  ["adelantos", "clock", "Adelantos de provincia"],
  ["avisos", "message", "Avisos de pedido"],
];

// ¿La cuenta ve «Avanzado»? (el enlace al editor de flujos). Import dinámico: un shell.js viejo no rompe nada.
async function avPermitido() {
  let ok = (() => { try { return localStorage.getItem("nodo.avanzado") === "1"; } catch (_) { return false; } })();
  try { const m = await import("./shell.js"); if (typeof m.avanzadoPermitido === "function") ok = await m.avanzadoPermitido(); } catch (_) { /* */ }
  return ok;
}
async function plantillas(channelId) {
  try {
    const { data: t } = await supa.from("wa_templates").select("name,language,estado_meta,soporta_envio,activa").eq("channel_id", channelId).order("name");
    return (t || []).filter((x) => x.activa !== false && (x.estado_meta ?? "aprobada") === "aprobada" && x.soporta_envio !== false);
  } catch (_) { return []; }
}
// (6-nov, Rodrigo: «audita el diseño») Estilos propios de estas dos ventanas: van acá (con ?v=) y no en
// ventana-ajustes.js, que el navegador guarda en caché sin versión.
const CSS_PED = `.ajp-blk{border-left:2px solid var(--border);margin:2px 0 4px 6px;padding:2px 0 2px 14px}
.ajp-blk[hidden]{display:none}
.ajp-tpl{margin-top:12px;padding-top:11px;border-top:1px solid var(--border)}
.ajp-tpl .t{font-size:12.5px;font-weight:600;margin-bottom:6px}
.ajp-tpl a{color:var(--brand);font-weight:600;text-decoration:none}
.ajp-brow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}
.ajp-brow .vpk-btn{margin-top:0;height:30px}
.ajp-mom textarea::placeholder,#aNudgeMsg::placeholder{font-style:italic}`;
function ponerCssPed() { if (document.getElementById("ajp-ped-css")) return; const st = document.createElement("style"); st.id = "ajp-ped-css"; st.textContent = CSS_PED; document.head.appendChild(st); }
// Datos que tienen sentido en un mensaje de PEDIDO (recordatorio y avisos): el cliente y su pedido. Sin «Link de
// entrega» (digital), «Último comprobante», «Foto de la guía» (tiene su propio interruptor) ni los repetidos
// «Adelanto»/«Saldo»/«Precio» del producto (acá valen los del pedido).
const VARS_PEDIDO = ["cliente", "nombre", "telefono", "producto_nombre", "pedido_monto", "pedido_adelanto", "pedido_saldo",
  "datos_pago", "pedido_guia", "pedido_agencia", "pedido_sede", "pedido_clave_recojo", "pedido_cliente", "pedido_dni", "pedido_ciudad"];
// Qué hacer si pasaron más de 24 h desde su último mensaje (WhatsApp solo deja mandar una plantilla aprobada).
const filaTpl = (tpls, id, actual, vacio, hint) => `<div class="ajp-tpl">
  <div class="t">Si pasaron más de 24 horas desde su último mensaje</div>
  ${tpls.length ? selTpl(tpls, id, actual, vacio) : `<span style="font-size:12.5px;color:var(--muted)">No tienes plantillas aprobadas. <a href="plantillas.html">Crear una →</a></span>`}
  ${hint ? `<div class="ajp-hint" style="margin-top:6px">${hint}</div>` : ""}</div>`;
const selTpl = (tpls, id, actual, vacio) => tpls.length
  ? `<select class="ajp-in" ${id} style="min-width:200px"><option value="">${vacio}</option>${tpls.map((x) => `<option value="${esc(x.name)}|${esc(x.language || "es")}" ${actual === x.name ? "selected" : ""}>${esc(x.name)}${x.language ? " · " + esc(x.language) : ""}</option>`).join("")}</select>`
  : `<span style="color:var(--faint)">Necesitas una plantilla aprobada (sección <b>Plantillas</b>)</span>`;
const opt = (grp, v, on, t, d) => `<div class="ajp-opt ${on ? "on" : ""}" data-grp="${grp}" data-v="${v}"><span class="ajp-dot"><i></i></span><div><b>${t}</b><span>${d}</span></div></div>`;

export async function abrirAjustesPedidos(channelId, seccion) {
  if (!channelId) return;
  // Enlaces viejos a «Agente de logística»: ahora es Pagos por validar → Ajustes.
  if (seccion === "logistica") { location.href = "copiloto.html?ajustes=1"; return; }
  const sec = SECCIONES.find((x) => x[0] === seccion); if (!sec) return;
  asegurarEstilos(); ponerCssPed();
  const { data: ch, error } = await supa.from("channels").select("pedidos_config").eq("id", channelId).maybeSingle();
  if (error) { toast("No se pudieron cargar los ajustes", true); return; }
  const src = (ch?.pedidos_config && typeof ch.pedidos_config === "object") ? ch.pedidos_config : {};
  const tpls = await plantillas(channelId);

  let cuerpo = "", alGuardar = null, alMontar = null;

  // ── Adelantos de provincia ─────────────────────────────────────────
  if (seccion === "adelantos") {
    const a = { ...D.adelanto, ...(src.adelanto || {}) };
    a.nudge = { ...D.adelanto.nudge, ...((src.adelanto || {}).nudge || {}) };
    a.vencimiento = { ...D.adelanto.vencimiento, ...((src.adelanto || {}).vencimiento || {}) };
    cuerpo = `
      <div class="ajp-sub">El pedido de provincia se crea apenas el cliente te da sus datos, <b>antes de pagar</b>.</div>
      <div class="ajp-nota" style="margin:0 0 12px">${icon("shield")}<span>Quién aprueba el adelanto y cuánto se le perdona si paga de menos se ajustan en <a href="copiloto.html?ajustes=1" style="color:var(--brand);font-weight:600">Pagos por validar → Ajustes</a>, junto con los demás pagos.</span></div>
      <div class="ajp-card"><h4>${icon("clock")} Si no paga</h4>
        <div class="ajp-desc">Mantiene limpia sola la columna «Esperando adelanto». Con las dos apagadas lo manejas a mano (el botón <b>Cancelar pedido</b> del menú ⋮ siempre está).</div>
        <div class="ajp-tog" id="aNudgeT"><span><b>Recordarle si no paga</b><small>Le escribe una vez, a las horas que digas, si todavía no mandó el adelanto.</small></span><span class="ajp-sw ${a.nudge.activo ? "on" : ""}" id="aNudgeSw"></span></div>
        <div class="ajp-blk" id="aNudgeBlk" ${a.nudge.activo ? "" : "hidden"}>
          <div class="ajp-num">Recordar a las <input class="ajp-in" id="aNudgeH" type="number" min="1" step="1" value="${Number(a.nudge.horas ?? 12)}" style="width:80px"> horas de creado el pedido</div>
          <span class="ajp-lbl">Mensaje del recordatorio</span>
          <textarea id="aNudgeMsg" rows="4" placeholder="Escribe lo que le va a llegar…">${esc(a.nudge.mensaje || "")}</textarea>
          <div class="ajp-brow" id="aNudgeVars"></div>
          ${filaTpl(tpls, 'id="aNudgeTpl"', a.nudge.template_name, "— Sin plantilla: esperar a que escriba —", "El recordatorio sale horas después, cuando el cliente casi siempre está callado. Sin plantilla, se espera a que vuelva a escribir.")}
        </div>
        <div class="ajp-tog" id="aVencT" style="margin-top:16px"><span><b>Vencer el pedido si no paga</b><small>Pasa a «Cancelado» y sale de las columnas activas. No se borra: sigue contando en tus métricas.</small></span><span class="ajp-sw ${a.vencimiento.activo ? "on" : ""}" id="aVencSw"></span></div>
        <div class="ajp-blk" id="aVencBlk" ${a.vencimiento.activo ? "" : "hidden"}>
          <div class="ajp-num">Vencer a las <input class="ajp-in" id="aVencH" type="number" min="1" step="1" value="${Number(a.vencimiento.horas ?? 48)}" style="width:80px"> horas de creado el pedido</div>
        </div>
      </div>`;
    // Texto de arranque: al prender el recordatorio con el mensaje vacío se escribe este (antes era solo un ejemplo
    // en gris que parecía texto real, y al guardar salía «El recordatorio necesita un mensaje»).
    const EJ_NUDGE = "¡Hola {{cliente}}! 👋 Tu pedido de {{producto_nombre}} sigue reservado.\n\nPara mandártelo solo falta el adelanto de S/ {{pedido_adelanto}}. ¿Te ayudo con algo?";
    alMontar = (ov, marcar) => {
      ov.querySelector("#aNudgeT").onclick = () => {
        a.nudge.activo = !a.nudge.activo; ov.querySelector("#aNudgeSw").classList.toggle("on", a.nudge.activo);
        ov.querySelector("#aNudgeBlk").hidden = !a.nudge.activo;
        const msg = ov.querySelector("#aNudgeMsg"); if (a.nudge.activo && !msg.value.trim()) msg.value = EJ_NUDGE;
        marcar();
      };
      ov.querySelector("#aVencT").onclick = () => { a.vencimiento.activo = !a.vencimiento.activo; ov.querySelector("#aVencSw").classList.toggle("on", a.vencimiento.activo); ov.querySelector("#aVencBlk").hidden = !a.vencimiento.activo; marcar(); };
      // «Insertar dato» también acá (el recordatorio usa el nombre y el adelanto, y no había cómo ponerlos).
      const bv = attachVarPicker(ov.querySelector("#aNudgeMsg"), { supa, channelId, solo: VARS_PEDIDO });
      if (bv) ov.querySelector("#aNudgeVars").appendChild(bv);
    };
    alGuardar = (ov, base) => {
      a.nudge.horas = Math.max(1, parseInt(ov.querySelector("#aNudgeH").value, 10) || 12);
      a.nudge.mensaje = ov.querySelector("#aNudgeMsg").value.trim();
      const tsel = ov.querySelector("#aNudgeTpl");
      if (tsel) {
        const [tn, tl] = (tsel.value || "").split("|");
        if (tn) { a.nudge.template_name = tn; a.nudge.template_lang = tl || "es"; } else { delete a.nudge.template_name; delete a.nudge.template_lang; }
      }
      a.vencimiento.horas = Math.max(1, parseInt(ov.querySelector("#aVencH").value, 10) || 48);
      if (a.nudge.activo && !a.nudge.mensaje) return "El recordatorio necesita un mensaje";
      if (a.vencimiento.activo && a.nudge.activo && a.vencimiento.horas <= a.nudge.horas) return "El vencimiento tiene que ser DESPUÉS del recordatorio";
      // Solo lo de esta ventana: quién aprueba / tolerancia (Pagos por validar) quedan como estén en la base.
      base.adelanto = { ...(base.adelanto || {}), nudge: a.nudge, vencimiento: a.vencimiento };
    };
  }

  // ── Avisos de pedido ───────────────────────────────────────────────
  if (seccion === "avisos") {
    const av = JSON.parse(JSON.stringify(src.avisos || {}));
    const AV = await avPermitido();
    // Qué flujo escucha cada estado («el mensaje de siempre» vive en un flujo).
    const flujos = {};
    try {
      const { data: tr } = await supa.from("flow_triggers").select("flow_id, config, flows!inner(id,nombre,estado)")
        .eq("channel_id", channelId).eq("tipo", "pedido_estado").eq("activo", true);
      (tr || []).forEach((t) => { if (t.flows?.estado !== "activo") return; ((t.config?.estados) || []).map(String).forEach((e) => { if (!flujos[e]) flujos[e] = { id: t.flow_id, nombre: t.flows?.nombre || "Aviso" }; }); });
    } catch (_) { /* sin disparadores */ }
    cuerpo = `
      <div class="ajp-sub">Lo que el bot le escribe al cliente cuando mueves su pedido. Si dejas uno vacío, el bot manda <b>el suyo</b> (lo ves en gris dentro de cada caja).</div>
      ${MOMENTOS.map(([k, t, d]) => { const a = av[k] || {}; const fl = flujos[k]; return `<div class="ajp-mom">
        <b>${t}</b><small>${d}</small>
        <textarea data-avtxt="${k}" rows="3" placeholder="${esc(POR_DEFECTO[k] || "Escribe lo que le va a llegar al cliente…")}">${esc(a.texto || "")}</textarea>
        <div class="ajp-brow"><span data-avvars="${k}"></span><span data-avadd="${k}"></span></div>
        <div data-avmm="${k}"></div>
        ${k === "despachado" ? `<div class="ajp-tog" data-avfoto><span><b>Adjuntar la foto de la guía</b><small>La que subes al registrar el despacho. Si no subiste ninguna, sale solo el texto.</small></span><span class="ajp-sw ${a.foto_guia ? "on" : ""}" data-avfotosw></span></div>` : ""}
        ${filaTpl(tpls, `data-aviso="${k}"`, a.template, "— Sin plantilla: no avisarle —", "")}
        ${fl ? `<div class="ajp-hint">También tienes el flujo <b>${esc(fl.nombre)}</b> escuchando este estado. Si escribes un mensaje acá, <b>manda este</b> y el flujo no se dispara. ${AV ? `<a href="editor.html?flow=${encodeURIComponent(fl.id)}" target="_blank" style="color:var(--brand)">verlo →</a>` : ""}</div>` : ""}
      </div>`; }).join("")}
      <div class="ajp-nota">${icon("bulb")}<span>Con <b>Insertar dato</b> pones el número de guía, la sede, la clave, etc.: se reemplazan por los datos reales de cada cliente. Fuera de las 24 horas WhatsApp solo deja mandar una <b>plantilla aprobada</b>: un pedido se despacha días después, así que conviene dejarla elegida.</span></div>`;
    alMontar = (ov, marcar) => {
      ov.querySelectorAll("[data-avtxt]").forEach((ta) => {
        const cont = ov.querySelector(`[data-avvars="${ta.dataset.avtxt}"]`);
        const btn = attachVarPicker(ta, { supa, channelId, solo: VARS_PEDIDO });
        if (cont && btn) cont.appendChild(btn);
      });
      // 📎 Archivo pegado a ese aviso (imagen/audio/PDF): sale siempre con él.
      const pintarMM = (k) => {
        const box = ov.querySelector(`[data-avmm="${k}"]`); if (!box) return;
        const slot = ov.querySelector(`span[data-avadd="${k}"]`);
        const m = (av[k] || {}).media;
        if (!m || !m.media_url) {
          box.innerHTML = "";
          if (slot) { slot.innerHTML = `<button class="ajp-btn" type="button" style="height:30px;padding:0 11px;font-size:12px">Adjuntar imagen o audio</button>`;
            slot.querySelector("button").onclick = () => subir(k, () => { pintarMM(k); marcar(); }); }
          return;
        }
        if (slot) slot.innerHTML = "";
        box.style.marginTop = "9px";
        const prev = m.media_kind === "image" ? `<img src="${esc(m.media_url)}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;flex:none"/>`
          : `<div style="width:52px;height:52px;border-radius:8px;flex:none;background:var(--surface-2);display:flex;align-items:center;justify-content:center;color:var(--muted)">${icon(m.media_kind === "audio" ? "mic" : "file")}</div>`;
        box.innerHTML = `<div style="display:flex;align-items:center;gap:10px;border:1px solid var(--border);border-radius:10px;padding:8px 10px">${prev}
          <div style="flex:1;min-width:0;font-size:12px;color:var(--muted)">Va junto a este aviso<div style="font-size:10.5px;color:var(--faint)">${esc(m.filename || "")}</div></div>
          <button class="ajp-btn" data-avdel="${k}" style="height:30px;padding:0 10px">${icon("trash")}</button></div>`;
        box.querySelector("[data-avdel]").onclick = () => { delete (av[k] || {}).media; pintarMM(k); marcar(); };
      };
      const subir = (k, listo) => {
        const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*,audio/*,application/pdf";
        inp.onchange = async () => {
          const file = inp.files && inp.files[0]; if (!file) return;
          if (file.size > 16 * 1024 * 1024) { toast("Archivo muy grande (máx 16 MB)", true); return; }
          toast("Subiendo…");
          try {
            const dataURL = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
            const { data, error: e } = await supa.functions.invoke("media-upload", { body: { channel_id: channelId, filename: file.name, content_type: file.type, data: dataURL } });
            if (e || !data?.url) { toast("No se pudo subir el archivo", true); return; }
            (av[k] = av[k] || {}).media = { media_kind: data.kind || "image", media_url: data.url, mime: file.type, filename: file.name };
            toast("Archivo adjunto — recuerda guardar"); listo();
          } catch (_) { toast("Error al subir", true); }
        };
        inp.click();
      };
      MOMENTOS.forEach(([k]) => pintarMM(k));
      const foto = ov.querySelector("[data-avfoto]");
      if (foto) foto.onclick = () => { const a = av.despachado = av.despachado || {}; a.foto_guia = !a.foto_guia; foto.querySelector("[data-avfotosw]").classList.toggle("on", !!a.foto_guia); marcar(); };
    };
    alGuardar = (ov, base) => {
      const nuevo = {};
      MOMENTOS.forEach(([k]) => {
        const a = {};
        const t = ov.querySelector(`[data-avtxt="${k}"]`).value.trim(); if (t) a.texto = t;
        const prev = av[k] || {};
        if (prev.media) a.media = prev.media;
        if (k === "despachado" && prev.foto_guia) a.foto_guia = true;
        const sel = ov.querySelector(`[data-aviso="${k}"]`);
        const [name, language] = ((sel && sel.value) || "").split("|");
        if (name) { a.template = name; a.language = language || "es"; }
        if (Object.keys(a).length) nuevo[k] = a;
      });
      // Momentos que esta ventana no conoce (si los hubiera): se conservan.
      Object.keys(base.avisos || {}).forEach((k) => { if (!MOMENTOS.some(([m]) => m === k)) nuevo[k] = base.avisos[k]; });
      base.avisos = nuevo;
    };
  }

  // ── La ventana ─────────────────────────────────────────────────────
  const ov = document.createElement("div"); ov.className = "ajp-ov";
  ov.innerHTML = `<div class="ajp" role="dialog" aria-label="${esc(sec[2])}">
    <div class="ajp-hd"><h3>${icon(sec[1])} ${esc(sec[2])}</h3><button class="ajp-x" data-x title="Cerrar">${icon("x")}</button></div>
    ${cuerpo}
    <div class="ajp-acts"><button class="ajp-btn" data-cancel>Cancelar</button><button class="ajp-btn pri" data-save>Guardar</button></div>
  </div>`;
  document.body.appendChild(ov);
  let sucio = false;
  const marcar = () => { sucio = true; };
  ov.querySelectorAll("textarea, input, select").forEach((el) => { el.addEventListener("input", marcar); el.addEventListener("change", marcar); });
  ov.querySelectorAll(".ajp-opt").forEach((o) => o.addEventListener("click", () => {
    ov.querySelectorAll(`.ajp-opt[data-grp="${o.dataset.grp}"]`).forEach((x) => x.classList.toggle("on", x === o)); marcar();
  }));
  if (alMontar) alMontar(ov, marcar);
  // Con cambios sin guardar se pregunta antes de cerrar: acá se escriben mensajes.
  const cerrar = async () => {
    if (sucio && !await confirmDialog({ title: "¿Salir sin guardar?", message: "Tienes cambios que todavía no guardaste.", confirmText: "Salir sin guardar", danger: true })) return;
    ov.remove();
  };
  ov.querySelector("[data-x]").onclick = cerrar; ov.querySelector("[data-cancel]").onclick = cerrar;
  ov.onclick = (e) => { if (e.target === ov) cerrar(); };
  ov.querySelector("[data-save]").onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const { data: fresh } = await supa.from("channels").select("pedidos_config").eq("id", channelId).maybeSingle();
      const base = { ...((fresh?.pedidos_config && typeof fresh.pedidos_config === "object") ? fresh.pedidos_config : {}) };
      const err = alGuardar(ov, base);
      if (err) { toast(err, true); return; }
      const { error: e2 } = await updateChannel(channelId, { pedidos_config: base });
      if (e2) { toast(e2.message || "No se pudo guardar", true); return; }
      toast(`${sec[2]}: guardado`); ov.remove();
    } finally { btn.disabled = false; }
  };
}
