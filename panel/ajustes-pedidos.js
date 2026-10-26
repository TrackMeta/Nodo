// ═════════════════════════════════════════════════════════════════════════
// Ajustes de Pedidos (ventanas flotantes) — Pedidos → «⋯» → una ventana por sección.
// (25-oct, Rodrigo) «Pagos y avisos» era una página larga; ahora cada sección se elige en el menú «⋯» y abre SU
// ventana: Adelantos de provincia · Agente de logística · Avisos de pedido. Las claves de channels.pedidos_config
// no cambian (adelanto, log, avisos): el motor ni se entera. Cada ventana guarda SOLO su clave, sobre el config
// FRESCO, así no pisa a las otras ni a «Ajustes de pagos» (Pagos por validar) ni a IA → Atención.
// ═════════════════════════════════════════════════════════════════════════
import { supa, toast, icon, confirmDialog, updateChannel } from "./shell.js";
import { attachVarPicker } from "./var-picker.js";
import { asegurarEstilos } from "./ventana-ajustes.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const D = {
  adelanto: { validacion: "manual", tolerancia: 1, nudge: { activo: false, horas: 12, mensaje: "" }, vencimiento: { activo: false, horas: 48 } },
  log: { modo: "manual", tolerancia: 1, instr_cod: "", instr_ag: "" },
};
// Los momentos del pedido físico en que el bot le escribe al cliente por su cuenta (clave = estado del pedido).
const MOMENTOS = [
  ["adelanto_validado", "Adelanto aprobado", "Le confirmas que recibiste su adelanto."],
  ["despachado", "Pedido despachado", "Le mandas la guía cuando lo dejas en la agencia."],
  ["en_agencia", "Llegó a la agencia", "Le avisas que ya puede recogerlo y le pides el saldo."],
];
export const SECCIONES = [
  ["adelantos", "clock", "Adelantos de provincia"],
  ["logistica", "truck", "Agente de logística"],
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
const selTpl = (tpls, id, actual, vacio) => tpls.length
  ? `<select class="ajp-in" ${id} style="min-width:200px"><option value="">${vacio}</option>${tpls.map((x) => `<option value="${esc(x.name)}|${esc(x.language || "es")}" ${actual === x.name ? "selected" : ""}>${esc(x.name)}${x.language ? " · " + esc(x.language) : ""}</option>`).join("")}</select>`
  : `<span style="color:var(--faint)">Necesitas una plantilla aprobada (sección <b>Plantillas</b>)</span>`;
const opt = (grp, v, on, t, d) => `<div class="ajp-opt ${on ? "on" : ""}" data-grp="${grp}" data-v="${v}"><span class="ajp-dot"><i></i></span><div><b>${t}</b><span>${d}</span></div></div>`;

export async function abrirAjustesPedidos(channelId, seccion) {
  if (!channelId) return;
  const sec = SECCIONES.find((x) => x[0] === seccion); if (!sec) return;
  asegurarEstilos();
  const { data: ch, error } = await supa.from("channels").select("pedidos_config").eq("id", channelId).maybeSingle();
  if (error) { toast("No se pudieron cargar los ajustes", true); return; }
  const src = (ch?.pedidos_config && typeof ch.pedidos_config === "object") ? ch.pedidos_config : {};
  const tpls = seccion === "logistica" ? [] : await plantillas(channelId);

  let cuerpo = "", alGuardar = null, alMontar = null;

  // ── Adelantos de provincia ─────────────────────────────────────────
  if (seccion === "adelantos") {
    const a = { ...D.adelanto, ...(src.adelanto || {}) };
    a.nudge = { ...D.adelanto.nudge, ...((src.adelanto || {}).nudge || {}) };
    a.vencimiento = { ...D.adelanto.vencimiento, ...((src.adelanto || {}).vencimiento || {}) };
    cuerpo = `
      <div class="ajp-sub">El pedido de provincia se crea apenas el cliente te da sus datos, <b>antes de pagar</b>.</div>
      <div class="ajp-card"><h4>${icon("shield")} ¿Quién aprueba el adelanto?</h4>
        ${opt("adel", "manual", a.validacion !== "auto", "Manual: cuando llegue un comprobante, avísame para aprobarlo yo", "La IA igual lo analiza y te deja su lectura hecha, pero no aprueba nada: la tarjeta te espera en Pagos por validar.")}
        ${opt("adel", "auto", a.validacion === "auto", "Automático: si el monto cuadra, valida el adelanto sin consultarme", "Ante cualquier duda (monto, fraude o comprobante repetido) te lo deriva igual a Pagos por validar.")}
        <div class="ajp-num">Si paga de menos, perdonarle hasta <span class="box"><span>S/</span><input id="aTol" type="number" min="0" step="0.5" value="${Number(a.tolerancia ?? 1)}"></span>
          <small>Con un adelanto de S/ 20 y esto en 1: si manda S/ 19 se acepta y el pedido sale; si manda S/ 18, el bot le dice que le faltan S/ 2.</small></div>
        <div class="ajp-num">Si el monto se pasa del TOTAL del pedido por más de <span class="box"><span>S/</span><input id="aRev" type="number" min="0" step="5" value="${Number(a.revisar_sobre_sol ?? (src.digital || {}).revisar_sobre_sol ?? 50)}"></span>
          <small>…lo revisas tú (por si el bot lee mal la captura). Si paga más que el adelanto también lo revisas tú: lo de más se descuenta de lo que paga en la agencia.</small></div>
      </div>
      <div class="ajp-card"><h4>${icon("clock")} Si no paga</h4>
        <div class="ajp-desc">Mantiene limpia sola la columna «Esperando adelanto». Con las dos apagadas lo manejas a mano (el botón <b>Cancelar pedido</b> del menú ⋮ siempre está).</div>
        <div class="ajp-tog" id="aNudgeT"><b>Recordarle si no paga</b><span class="ajp-sw ${a.nudge.activo ? "on" : ""}" id="aNudgeSw"></span></div>
        <div class="ajp-num">Recordar a las <input class="ajp-in" id="aNudgeH" type="number" min="1" step="1" value="${Number(a.nudge.horas ?? 12)}" style="width:80px"> horas de creado el pedido</div>
        <span class="ajp-lbl">Mensaje del recordatorio</span>
        <textarea id="aNudgeMsg" rows="4" placeholder="¡Hola {{nombre}}! 👋 Tu pedido de {{producto_nombre}} sigue reservado.&#10;&#10;Para mandártelo solo falta el adelanto de S/ {{adelanto}}. ¿Te ayudo con algo?">${esc(a.nudge.mensaje || "")}</textarea>
        <div class="ajp-fila"><span>Si la ventana de 24h está cerrada</span>${selTpl(tpls, 'id="aNudgeTpl"', a.nudge.template_name, "— Sin plantilla (posponer) —")}</div>
        <div class="ajp-hint">El recordatorio sale horas después, cuando el cliente casi siempre está callado: fuera de las 24 h solo pasa una plantilla aprobada. Sin plantilla, se pospone hasta que vuelva a escribir.</div>
        <div class="ajp-tog" id="aVencT" style="margin-top:16px"><span><b>Vencer el pedido si no paga</b><small>Pasa a «Cancelado» y sale de las columnas activas. No se borra: sigue contando en tus métricas.</small></span><span class="ajp-sw ${a.vencimiento.activo ? "on" : ""}" id="aVencSw"></span></div>
        <div class="ajp-num">Vencer a las <input class="ajp-in" id="aVencH" type="number" min="1" step="1" value="${Number(a.vencimiento.horas ?? 48)}" style="width:80px"> horas de creado el pedido</div>
      </div>`;
    alMontar = (ov, marcar) => {
      ov.querySelector("#aNudgeT").onclick = () => { a.nudge.activo = !a.nudge.activo; ov.querySelector("#aNudgeSw").classList.toggle("on", a.nudge.activo); marcar(); };
      ov.querySelector("#aVencT").onclick = () => { a.vencimiento.activo = !a.vencimiento.activo; ov.querySelector("#aVencSw").classList.toggle("on", a.vencimiento.activo); marcar(); };
      ov.querySelectorAll('.ajp-opt[data-grp="adel"]').forEach((o) => o.addEventListener("click", () => { a.validacion = o.dataset.v; }));
    };
    alGuardar = (ov, base) => {
      a.tolerancia = Math.max(0, Number(ov.querySelector("#aTol").value) || 0);
      a.revisar_sobre_sol = Math.max(0, Number(ov.querySelector("#aRev").value) || 0);
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
      base.adelanto = a;
    };
  }

  // ── Agente de logística ────────────────────────────────────────────
  if (seccion === "logistica") {
    const l = { ...D.log, ...(src.log || {}) };
    cuerpo = `
      <div class="ajp-sub">Cómo el agente IA verifica el pago del saldo antes de entregar la <b>clave de recojo</b>.</div>
      <div class="ajp-card"><h4>${icon("key")} ¿Cómo verifica los pagos para dar la clave?</h4>
        ${opt("log", "manual", l.modo !== "auto", "Manual: cuando recibas un pago, notifícame para aprobarlo antes de dar la clave", "La IA te avisa cuando recibe un comprobante (WhatsApp o Telegram). Cuando lo apruebes, da la clave de recojo.")}
        ${opt("log", "auto", l.modo === "auto", "Automático: si paga el saldo, dale su clave sin consultarme", "La IA analiza el comprobante. Si el monto coincide, entrega la clave sola.")}
        <div class="ajp-num">Tolerancia del monto (modo automático) <span class="box"><span>S/</span><input id="lTol" type="number" min="0" step="0.5" value="${Number(l.tolerancia ?? 0)}"></span>
          <small>Acepta el pago si es al menos el saldo menos esta diferencia. Pagar de más siempre se acepta. Si no cuadra, va a Pagos por validar.</small></div>
        <div class="ajp-nota">${icon("shield")}<span>En automático, si hay cualquier duda (monto, fraude o comprobante repetido) el pago cae en <b>Pagos por validar</b> y te avisamos por <b>Telegram</b>.</span></div>
      </div>`;
    alMontar = (ov) => { ov.querySelectorAll('.ajp-opt[data-grp="log"]').forEach((o) => o.addEventListener("click", () => { l.modo = o.dataset.v; })); };
    alGuardar = (ov, base) => { l.tolerancia = Math.max(0, Number(ov.querySelector("#lTol").value) || 0); base.log = l; };
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
      <div class="ajp-sub">Lo que el bot le escribe al cliente cuando mueves su pedido. Fuera de las <b>24 horas</b> desde su último mensaje WhatsApp solo deja mandar una <b>plantilla aprobada</b>: déjala elegida para esos casos (un pedido se despacha días después).</div>
      ${MOMENTOS.map(([k, t, d]) => { const a = av[k] || {}; const fl = flujos[k]; return `<div class="ajp-mom">
        <b>${t}</b><small>${d}</small>
        <textarea data-avtxt="${k}" rows="3" placeholder="Escribe lo que le va a llegar al cliente…">${esc(a.texto || "")}</textarea>
        <div data-avvars="${k}"></div>
        <div data-avmm="${k}" style="margin-top:9px"></div>
        ${k === "despachado" ? `<div class="ajp-tog" data-avfoto><span><b>Adjuntar la foto de la guía</b><small>La que subes al registrar el despacho. Si no subiste ninguna, sale solo el texto.</small></span><span class="ajp-sw ${a.foto_guia ? "on" : ""}" data-avfotosw></span></div>` : ""}
        <div class="ajp-fila"><span>Si la ventana está cerrada</span>${selTpl(tpls, `data-aviso="${k}"`, a.template, "— Sin plantilla —")}</div>
        ${fl ? `<div class="ajp-hint">También tienes el flujo <b>${esc(fl.nombre)}</b> escuchando este estado. Si escribes un mensaje acá, <b>manda este</b> y el flujo no se dispara. ${AV ? `<a href="editor.html?flow=${encodeURIComponent(fl.id)}" target="_blank" style="color:var(--brand)">verlo →</a>` : ""}</div>` : ""}
      </div>`; }).join("")}
      <div class="ajp-nota">${icon("bulb")}<span>Con <b>Insertar dato</b> pones el número de guía, la sede, etc.: se reemplazan por los datos reales de cada cliente. ${tpls.length ? "En las plantillas también se rellenan solos." : "Sin plantillas aprobadas, fuera de la ventana solo queda «no avisar»."}</span></div>`;
    alMontar = (ov, marcar) => {
      ov.querySelectorAll("[data-avtxt]").forEach((ta) => {
        const cont = ov.querySelector(`[data-avvars="${ta.dataset.avtxt}"]`);
        const btn = attachVarPicker(ta, { supa, channelId });
        if (cont && btn) cont.appendChild(btn);
      });
      // 📎 Archivo pegado a ese aviso (imagen/audio/PDF): sale siempre con él.
      const pintarMM = (k) => {
        const box = ov.querySelector(`[data-avmm="${k}"]`); if (!box) return;
        const m = (av[k] || {}).media;
        if (!m || !m.media_url) {
          box.innerHTML = `<button class="ajp-btn" data-avadd="${k}" style="height:30px;padding:0 11px;font-size:12.5px">📎 Adjuntar imagen o audio</button>`;
          box.querySelector("[data-avadd]").onclick = () => subir(k, () => { pintarMM(k); marcar(); });
          return;
        }
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
