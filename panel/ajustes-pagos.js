// ═════════════════════════════════════════════════════════════════════════
// Ajustes de pagos (ventana flotante) — Pagos por validar → «⋯» → «Ajustes de pagos».
// (25-oct, Rodrigo) Lo de los pagos que sirve a CUALQUIER bot salió de «Pagos y avisos» (que es de Pedidos, solo
// físicos, y en un bot digital Pedidos ni aparece): quién aprueba un pago digital, el mensaje al rechazar un
// comprobante y qué hacer si reclama un vuelto. Las claves siguen siendo las mismas de channels.pedidos_config
// (digital, rechazo, vuelto): el motor no cambia. Se guarda sobre el config FRESCO y solo esas tres claves, así no
// pisa lo que se edita en Pagos y avisos ni en IA → Atención.
// ═════════════════════════════════════════════════════════════════════════
import { supa, toast, icon, confirmDialog, updateChannel } from "./shell.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DEF = {
  digital: { validacion: "auto", tolerancia: 1, revisar_sobre_sol: 50 },
  vuelto: { modo: "tranquilizar", mensaje: "" },
  rechazo: { mensaje: "" },
};

const CSS = `
.ajp-ov{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:18px}
.ajp{background:var(--surface);border:1px solid var(--border);border-radius:18px;width:100%;max-width:640px;max-height:90vh;overflow:auto;padding:20px 22px;color:var(--text);font-family:var(--font)}
.ajp-hd{display:flex;align-items:center;gap:10px}
.ajp-hd h3{flex:1;margin:0;font-size:18px;display:flex;align-items:center;gap:8px}
.ajp-hd h3 svg{width:18px;height:18px;color:var(--brand)}
.ajp-x{height:34px;width:34px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text);display:inline-flex;align-items:center;justify-content:center}
.ajp-x svg{width:15px;height:15px}
.ajp-sub{color:var(--muted);font-size:12.5px;line-height:1.55;margin:6px 0 4px}
.ajp-card{border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-top:14px}
.ajp-card h4{margin:0;font-size:14.5px;display:flex;align-items:center;gap:8px}
.ajp-card h4 svg{width:17px;height:17px;color:var(--brand)}
.ajp-desc{color:var(--muted);font-size:12.5px;margin:6px 0 4px;line-height:1.55}
.ajp-lbl{display:block;font-size:12.5px;font-weight:700;margin:12px 0 6px}
.ajp-opt{border:1.5px solid var(--border);border-radius:12px;padding:12px 13px;display:flex;gap:12px;align-items:flex-start;cursor:pointer;margin-top:8px}
.ajp-opt.on{border-color:var(--brand);background:rgba(43,127,255,.10)}
.ajp-dot{width:18px;height:18px;border-radius:50%;border:2px solid var(--border);flex:none;margin-top:2px;display:flex;align-items:center;justify-content:center}
.ajp-opt.on .ajp-dot{border-color:var(--brand)} .ajp-dot i{width:9px;height:9px;border-radius:50%;background:var(--brand);display:none}
.ajp-opt.on .ajp-dot i{display:block}
.ajp-opt b{display:block;font-size:13.5px} .ajp-opt > div > span{display:block;font-size:12px;color:var(--muted);margin-top:3px;line-height:1.5}
.ajp-num{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px;font-size:12.5px}
.ajp-num .box{display:flex;align-items:center;border:1px solid var(--border);border-radius:8px;overflow:hidden}
.ajp-num .box span{color:var(--muted);font-weight:700;padding:0 4px 0 10px}
.ajp-num input{width:76px;height:34px;border:none;background:var(--surface-2);color:var(--text);padding:0 8px;font-family:var(--font)}
.ajp-num small{flex:1;min-width:200px;color:var(--faint);font-size:11.5px;line-height:1.5}
.ajp textarea{width:100%;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;color:var(--text);padding:10px 12px;font-size:13.5px;line-height:1.5;font-family:var(--font);resize:vertical;outline:none}
.ajp textarea:focus{border-color:var(--brand)}
.ajp-hint{font-size:11px;color:var(--faint);margin-top:6px;line-height:1.5}
.ajp-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.ajp-btn{height:38px;padding:0 16px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:13px;font-weight:600}
.ajp-btn.pri{background:var(--brand);border-color:var(--brand);color:#fff}
.ajp-btn:disabled{opacity:.5}
.ajp-sw{width:44px;height:25px;border-radius:20px;background:var(--surface-2);border:1px solid var(--border);position:relative;transition:.15s;flex:none;cursor:pointer}
.ajp-sw::after{content:"";position:absolute;top:2px;left:2px;width:19px;height:19px;border-radius:50%;background:var(--muted);transition:.15s}
.ajp-sw.on{background:var(--brand);border-color:var(--brand)} .ajp-sw.on::after{left:20px;background:#fff}
.ajp-tog{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;border:1px solid var(--border);border-radius:11px;padding:11px 12px;cursor:pointer}
.ajp-tog b{font-size:13px} .ajp-tog small{display:block;font-size:11.5px;color:var(--faint);margin-top:2px;font-weight:400}
.ajp-in{height:36px;background:var(--surface-2);border:1px solid var(--border);border-radius:9px;color:var(--text);padding:0 10px;font-size:13px;font-family:var(--font)}
.ajp-mom{border:1px solid var(--border);border-radius:12px;padding:12px 13px;margin-top:12px}
.ajp-mom > b{display:block;font-size:13.5px} .ajp-mom > small{display:block;font-size:11.5px;color:var(--faint);margin:2px 0 8px}
.ajp-fila{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:12px}
.ajp-fila > span{color:var(--muted);font-weight:700;min-width:150px}
.ajp-nota{display:flex;gap:9px;border:1px solid var(--border);border-radius:11px;padding:10px 12px;margin-top:12px;font-size:12px;color:var(--muted);line-height:1.5;background:rgba(43,127,255,.08)}
`;
let _css = false;
// Estilos de las ventanas de ajustes (los usa también ajustes-pedidos.js).
export function asegurarEstilos() { if (!_css) { const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s); _css = true; } }

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
