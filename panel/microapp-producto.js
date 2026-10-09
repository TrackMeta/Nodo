// ═══════════════════════════════════════════════════════════════════
// 📱 Producto «Micro app» (8-oct-2026, maqueta aprobada por Rodrigo)
//   Dos secciones de la ficha de Productos cuando el tipo es «microapp»:
//   · renderCobroMicroapp  → «¿Cuánto cuesta?»: pago único y/o mensual, descuento por
//     3 y 6 meses (solo mensual), cuál es la destacada. Cada opción es una presentación
//     (product_versions) con config { modalidad:'unico'|'mensual', meses } — así el motor
//     reusa TODO el cobro digital (precio, datos de pago, OCR) y reconoce la opción por el monto.
//   · renderConfigMicroapp → correo, renovación, prueba gratis y conexión con la app.
//   Todo lo demás de la ficha (la IA, palabras clave, remarketing) es igual que un digital.
// ═══════════════════════════════════════════════════════════════════
import { supa, toast, icon, markDirty } from "./shell.js";

const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const CSS = `
.ma-sec{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin-bottom:12px}
.ma-hd{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.ma-n{width:24px;height:24px;border-radius:50%;background:var(--brand-bg,rgba(43,127,255,.12));color:var(--brand);font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none}
.ma-t{font-size:15px;font-weight:800}
.ma-s{font-size:12.5px;color:var(--muted);margin:0 0 10px;line-height:1.5}
.ma-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13.5px;margin:9px 0}
.ma-lbl{font-size:12.5px;color:var(--muted);min-width:150px}
.ma-in{background:var(--surface-2);border:1px solid var(--border);border-radius:9px;color:var(--text);padding:8px 10px;font:inherit;font-size:13.5px;outline:none}
.ma-in.sm{width:86px}.ma-in.md{width:200px}.ma-in.lg{flex:1;min-width:220px}
textarea.ma-in{width:100%;min-height:58px;box-sizing:border-box;resize:vertical}
.ma-dep{margin-left:24px;padding-left:12px;border-left:2px solid var(--border)}
.ma-dep.off{opacity:.45;pointer-events:none}
.ma-note{font-size:12px;color:var(--muted);background:var(--surface-2);border-radius:9px;padding:8px 11px;margin-top:8px;line-height:1.5}
.ma-warn{background:rgba(245,158,11,.12);color:#b45309}
[data-theme=dark] .ma-warn{color:#fbbf24}
.ma-chip{font-size:11.5px;font-weight:700;padding:3px 10px;border-radius:20px;background:var(--brand-bg,rgba(43,127,255,.12));color:var(--brand)}
.ma-ok{color:var(--green);font-weight:700;font-size:13px}
.ma-bad{color:var(--red,#e2564a);font-weight:700;font-size:13px}
.ma-code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;background:var(--surface-2);border:1px solid var(--border);border-radius:9px;padding:10px;white-space:pre-wrap;word-break:break-all}
.ma-chk{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-weight:600}
.ma-chk input{width:16px;height:16px;accent-color:var(--brand)}`;
function css() { if (!document.getElementById("ma-css")) { const s = document.createElement("style"); s.id = "ma-css"; s.textContent = CSS; document.head.appendChild(s); } }

export function cfgMA(st) {
  const c = st.prod.config = st.prod.config || {};
  const m = c.microapp = c.microapp || {};
  m.correo = m.correo || {}; m.renovacion = m.renovacion || {}; m.prueba = m.prueba || {}; m.conexion = m.conexion || {};
  return m;
}

// ── Presentaciones ↔ opciones de cobro ──────────────────────────────
function opcion(st, modalidad, meses) {
  return (st.versions || []).find((v) => {
    const c = v.config || {};
    if (modalidad === "unico") return c.modalidad === "unico" || (!c.modalidad && !(st.versions || []).some((x) => x.config?.modalidad === "unico") && v === st.versions[0]);
    return c.modalidad === "mensual" && (Number(c.meses) || 1) === meses;
  }) || null;
}
const NOMBRES = { unico: "Pago único", m1: "Mensual", m3: "3 meses", m6: "6 meses" };
function asegurar(st, clave) {
  const [mod, meses] = clave === "unico" ? ["unico", 0] : ["mensual", Number(clave.slice(1))];
  let v = opcion(st, mod, meses);
  if (!v) {
    v = { nombre: NOMBRES[clave], precio: "", cantidad: 1, descripcion: "", entrega: [], activo: false, orden: st.versions.length, config: {} };
    st.versions.push(v);
  }
  v.config = { ...(v.config || {}), modalidad: mod, ...(mod === "mensual" ? { meses } : {}) };
  if (!v.nombre || v.nombre === "Única") v.nombre = NOMBRES[clave];
  return v;
}
// Orden: la destacada primero (es la que la IA nombra primero), luego el resto; 3 y 6 meses ocultas
// (salen solo si el cliente ya eligió mensual o pide más — ver «ofertas ocultas» del motor).
function ordenar(st) {
  const m = cfgMA(st);
  const peso = (v) => { const c = v.config || {}; const k = c.modalidad === "mensual" ? ((Number(c.meses) || 1) === 1 ? "m1" : "mx") : "unico";
    if (k === "mx") return 3; return (m.destacada || "unico") === (k === "unico" ? "unico" : "mensual") ? 0 : 1; };
  st.versions.sort((a, b) => peso(a) - peso(b));
  for (const v of st.versions) {
    const c = v.config || (v.config = {});
    if (c.modalidad === "mensual" && (Number(c.meses) || 1) > 1) c.oculta = true; else delete c.oculta;
  }
}

export function renderCobroMicroapp(host, st, opts = {}) {
  css();
  const m = cfgMA(st);
  const sym = opts.sym || "S/";
  const vU = asegurar(st, "unico"), v1 = asegurar(st, "m1"), v3 = asegurar(st, "m3"), v6 = asegurar(st, "m6");
  // Un producto recién creado trae «Única» activa sin precio: es el pago único.
  const on = (v) => v.activo !== false;
  const precio = (v) => esc(v.precio ?? "");
  host.innerHTML = `
    <div class="ma-sec">
      <div class="ma-hd"><div class="ma-t">Cómo se cobra</div></div>
      <p class="ma-s">Puedes ofrecer una o las dos. El mensual <b>no tiene cobros automáticos</b>: Nodo le recuerda y renueva con Yape.</p>
      <div class="ma-row"><label class="ma-chk"><input type="checkbox" data-op="unico" ${on(vU) ? "checked" : ""}> Pago único</label>
        <span style="color:var(--muted);font-weight:800">${esc(sym)}</span><input class="ma-in sm" data-precio="unico" type="number" min="0" step="0.5" value="${precio(vU)}" placeholder="29">
        <span class="ma-s" style="margin:0">De por vida, mientras la app exista</span></div>
      <div class="ma-row"><label class="ma-chk"><input type="checkbox" data-op="m1" ${on(v1) ? "checked" : ""}> Mensual</label>
        <span style="color:var(--muted);font-weight:800">${esc(sym)}</span><input class="ma-in sm" data-precio="m1" type="number" min="0" step="0.5" value="${precio(v1)}" placeholder="12">
        <span class="ma-s" style="margin:0">al mes</span></div>
      <div class="ma-dep ${on(v1) ? "" : "off"}" id="maDepMes">
        <div class="ma-row"><span class="ma-lbl">Descuento por varios meses</span>
          <label class="ma-chk"><input type="checkbox" data-op="m3" ${on(v3) ? "checked" : ""}> 3 meses</label> ${esc(sym)} <input class="ma-in sm" data-precio="m3" type="number" min="0" step="0.5" value="${precio(v3)}" placeholder="30">
          <label class="ma-chk" style="margin-left:10px"><input type="checkbox" data-op="m6" ${on(v6) ? "checked" : ""}> 6 meses</label> ${esc(sym)} <input class="ma-in sm" data-precio="m6" type="number" min="0" step="0.5" value="${precio(v6)}" placeholder="54"></div>
        <div class="ma-note">El bot nombra el descuento solo cuando el cliente ya eligió el mensual.</div>
      </div>
      <div class="ma-row"><span class="ma-lbl">Destacada</span>
        <select class="ma-in md" id="maDest"><option value="unico" ${(m.destacada || "unico") === "unico" ? "selected" : ""}>Pago único</option><option value="mensual" ${m.destacada === "mensual" ? "selected" : ""}>Mensual</option></select></div>
      <div class="ma-note">Si el cliente no da pistas, el bot le muestra <b>las dos</b> (la destacada primero). Si da pistas, le recomienda una.</div>
      <div id="maCobroAviso" class="ma-note ma-warn" style="display:none"></div>
    </div>`;
  const ref = { unico: vU, m1: v1, m3: v3, m6: v6 };
  const aviso = () => {
    const el = host.querySelector("#maCobroAviso");
    const faltan = Object.entries(ref).filter(([, v]) => on(v) && !(Number(v.precio) > 0)).map(([k]) => NOMBRES[k]);
    const ninguna = !on(vU) && !on(v1);
    el.style.display = (faltan.length || ninguna) ? "" : "none";
    el.textContent = ninguna ? "Activa al menos el pago único o el mensual." : `Falta el precio de: ${faltan.join(", ")}.`;
  };
  host.querySelectorAll("[data-op]").forEach((cb) => cb.onchange = () => {
    const k = cb.dataset.op; ref[k].activo = cb.checked;
    if (k === "m1") { host.querySelector("#maDepMes").classList.toggle("off", !cb.checked); if (!cb.checked) { v3.activo = false; v6.activo = false; host.querySelector('[data-op="m3"]').checked = false; host.querySelector('[data-op="m6"]').checked = false; } }
    ordenar(st); markDirty(); aviso(); opts.onChange?.();
  });
  host.querySelectorAll("[data-precio]").forEach((inp) => inp.oninput = () => {
    const v = ref[inp.dataset.precio]; v.precio = inp.value;
    if (inp.value && Number(inp.value) > 0 && !on(v)) { v.activo = true; const cb = host.querySelector(`[data-op="${inp.dataset.precio}"]`); if (cb) cb.checked = true; }
    markDirty(); aviso(); opts.onChange?.();
  });
  host.querySelector("#maDest").onchange = (e) => { m.destacada = e.target.value; ordenar(st); markDirty(); };
  ordenar(st); aviso();
}

// ── Correo, renovación, prueba y conexión ───────────────────────────
export function renderConfigMicroapp(host, st, opts = {}) {
  css();
  const m = cfgMA(st);
  const c = m.correo, r = m.renovacion, p = m.prueba, k = m.conexion;
  const mensual = (st.versions || []).some((v) => v.activo !== false && v.config?.modalidad === "mensual");
  const chk = (id, v, txt) => `<label class="ma-chk"><input type="checkbox" id="${id}" ${v ? "checked" : ""}> ${txt}</label>`;
  const plantillaSel = (id, val, def) => `<select class="ma-in md" id="${id}"><option value="${esc(val || def)}">${esc(val || def)}</option></select>`;
  host.innerHTML = `
    <div class="ma-sec">
      <div class="ma-hd"><div class="ma-n">1</div><div class="ma-t">Correo del cliente</div><span class="ma-chip">Obligatorio</span></div>
      <p class="ma-s">Se pide apenas se valida el pago. <b>Sin correo no hay acceso.</b> Si no tiene correo: con número visible su llave es su número; si llegó con nombre de usuario, el bot le pide el celular.</p>
      <div class="ma-row"><span class="ma-lbl">Mensaje para pedirlo</span></div>
      <textarea class="ma-in" id="maPedir" placeholder="¡Pago recibido! 🎉 Para crear tu acceso a *{{app}}*, pásame tu correo 📧">${esc(c.mensaje_pedir || "")}</textarea>
      <div class="ma-note">Vacío = el de siempre (incluye «si no quieres novedades, dime»). <b>{{app}}</b> = el nombre de la app.</div>
      <div class="ma-row" style="margin-top:14px">${chk("maRecOn", c.recordar !== false, "Recordar el correo si no lo manda")}</div>
      <div class="ma-dep ${c.recordar === false ? "off" : ""}" id="maRecDep">
        <div class="ma-row"><span class="ma-lbl">Cuántas veces</span><input class="ma-in sm" id="maRecN" type="number" min="1" max="5" value="${esc(c.veces ?? 2)}"></div>
        <div class="ma-row"><span class="ma-lbl">Cada cuánto (minutos)</span><input class="ma-in md" id="maRecCada" value="${esc((c.cada_min || [15, 180]).join(", "))}" placeholder="15, 180"></div>
        <div class="ma-row"><span class="ma-lbl">Mensaje</span></div>
        <textarea class="ma-in" id="maRecMsg" placeholder="Solo me falta tu correo para activar tu acceso 🙌">${esc(c.mensaje || "")}</textarea>
      </div>
      <div class="ma-note ma-warn">Este recordatorio sale aunque el post-venta esté apagado.</div>
    </div>

    <div class="ma-sec" style="${mensual ? "" : "opacity:.5"}">
      <div class="ma-hd"><div class="ma-n">2</div><div class="ma-t">Renovación</div><span class="ma-s" style="margin:0">Solo con mensual${mensual ? "" : " (actívalo en «¿Cuánto cuesta?»)"}</span></div>
      <div class="ma-row">${chk("maPrevOn", r.previo !== false, "Avisar antes de vencer")}<input class="ma-in sm" id="maPrevDias" type="number" min="1" max="15" value="${esc(r.dias ?? 3)}"> días antes</div>
      <div class="ma-dep"><div class="ma-row"><span class="ma-lbl">Plantilla</span>${plantillaSel("maPrevTpl", r.plantilla_previo, "acceso_por_vencer")}</div></div>
      <div class="ma-row">${chk("maVencOn", r.vencido !== false, "Avisar el día que vence")}</div>
      <div class="ma-dep"><div class="ma-row"><span class="ma-lbl">Plantilla</span>${plantillaSel("maVencTpl", r.plantilla_vencido, "acceso_vencido")}</div></div>
      <div class="ma-note ma-warn">Después del recordatorio, Nodo valida el pago de la renovación aunque el post-venta esté apagado. Solo valida y confirma; no conversa.</div>
      <div class="ma-note">El acceso se corta el mismo día que vence. Si paga antes, los meses se suman desde su fecha de vencimiento. Para cambiar el texto del aviso, elige otra plantilla (las tienes en Plantillas → Recomendadas Mini Apps). Con la ventana de 24 h abierta sale como texto normal, sin costo.</div>
    </div>

    <div class="ma-sec">
      <div class="ma-hd"><div class="ma-n">3</div><div class="ma-t">Prueba gratis</div></div>
      <div class="ma-row">${chk("maPrueOn", !!p.activa, "Ofrecer prueba gratis")}</div>
      <div class="ma-dep ${p.activa ? "" : "off"}" id="maPrueDep">
        <div class="ma-row"><span class="ma-lbl">Duración</span><select class="ma-in md" id="maPrueH">${[24, 48, 72, 168].map((h) => `<option value="${h}" ${(Number(p.horas) || 24) === h ? "selected" : ""}>${h === 24 ? "24 horas" : h === 168 ? "7 días" : h / 24 + " días"}</option>`).join("")}</select></div>
        <div class="ma-row"><span class="ma-lbl">Dónde se ofrece</span>Solo en el remarketing, a los que no compraron</div>
        <div class="ma-row"><span class="ma-lbl">Al terminar</span>${plantillaSel("maPrueTpl", p.plantilla_fin, "prueba_terminada")}</div>
        <div class="ma-note">Una prueba por persona. También pide el correo. El mensaje que la ofrece va en un paso del <b>Reenganche</b>: marca ese paso con «🎁 Ofrece la prueba gratis».</div>
      </div>
    </div>

    <div class="ma-sec">
      <div class="ma-hd"><div class="ma-n">4</div><div class="ma-t">Conexión con la app</div></div>
      <p class="ma-s">Dónde vive tu app. Nodo arma el link personal de cada cliente sobre esta dirección.</p>
      <div class="ma-row"><span class="ma-lbl">Link de la app</span><input class="ma-in lg" id="maUrl" value="${esc(k.url || "")}" placeholder="https://mi-app.pages.dev"></div>
      <div class="ma-row"><span class="ma-lbl">Celulares por cliente</span><input class="ma-in sm" id="maMaxCel" type="number" min="1" max="20" value="${esc(k.max_celulares ?? 2)}">
        <span class="ma-s" style="margin:0">Si entra uno más, se desconecta el que lleva más tiempo sin usarse</span></div>
      <div class="ma-row"><span class="ma-lbl">Video de cómo instalarla</span><input class="ma-in lg" id="maVideo" value="${esc(m.video_instalacion || "")}" placeholder="https://… (opcional: se manda junto con el acceso)"></div>
      <div class="ma-row"><button class="btn" id="maProbar" type="button">${icon("activity")} Guardar conexión y probar</button><span id="maEstado" class="ma-s" style="margin:0"></span></div>
      <div id="maKit"></div>
    </div>`;

  const $ = (id) => host.querySelector("#" + id);
  const num = (v, d, a, b) => Math.min(b, Math.max(a, Number(v) || d));
  const sync = () => {
    c.mensaje_pedir = $("maPedir").value.trim() || undefined;
    c.recordar = $("maRecOn").checked; c.veces = num($("maRecN").value, 2, 1, 5);
    c.cada_min = $("maRecCada").value.split(/[,;\s]+/).map(Number).filter((x) => x > 0).slice(0, 5);
    if (!c.cada_min.length) c.cada_min = [15, 180];
    c.mensaje = $("maRecMsg").value.trim() || undefined;
    r.previo = $("maPrevOn").checked; r.dias = num($("maPrevDias").value, 3, 1, 15);
    r.plantilla_previo = $("maPrevTpl").value || "acceso_por_vencer";
    r.vencido = $("maVencOn").checked; r.plantilla_vencido = $("maVencTpl").value || "acceso_vencido";
    p.activa = $("maPrueOn").checked; p.horas = Number($("maPrueH").value) || 24; p.plantilla_fin = $("maPrueTpl").value || "prueba_terminada";
    k.url = $("maUrl").value.trim(); k.max_celulares = num($("maMaxCel").value, 2, 1, 20);
    m.video_instalacion = $("maVideo").value.trim() || undefined;
    $("maRecDep").classList.toggle("off", !c.recordar);
    $("maPrueDep").classList.toggle("off", !p.activa);
    markDirty(); opts.onChange?.();
  };
  host.querySelectorAll("input,textarea,select").forEach((el) => { el.addEventListener("input", sync); el.addEventListener("change", sync); });

  // Plantillas aprobadas del bot para elegir (las de Mini Apps primero).
  (async () => {
    try {
      const { data } = await supa.from("wa_templates").select("name, estado_meta, folder").eq("channel_id", st.channelId).order("name");
      const lista = (data || []);
      for (const [id, def] of [["maPrevTpl", "acceso_por_vencer"], ["maVencTpl", "acceso_vencido"], ["maPrueTpl", "prueba_terminada"]]) {
        const sel = $(id); if (!sel) continue;
        const cur = sel.value || def;
        const nombres = [...new Set([def, cur, ...lista.map((t) => t.name)])];
        sel.innerHTML = nombres.map((n) => { const t = lista.find((x) => x.name === n);
          const est = !t ? " (agrégala en Plantillas)" : t.estado_meta === "aprobada" ? " (aprobada)" : ` (${t.estado_meta || "borrador"})`;
          return `<option value="${esc(n)}" ${n === cur ? "selected" : ""}>${esc(n)}${esc(est)}</option>`; }).join("");
      }
    } catch (_) { /* sin plantillas legibles → queda la de por defecto */ }
  })();

  const pintarEstado = (app) => {
    const est = $("maEstado"), kit = $("maKit");
    if (!app) { est.innerHTML = `<span class="ma-bad">Sin conectar</span>`; kit.innerHTML = ""; return; }
    const visto = app.kit_visto_at ? new Date(app.kit_visto_at) : null;
    est.innerHTML = visto
      ? `<span class="ma-ok">✓ Conectada · nivel ${esc(app.kit_nivel || "reforzado")}</span> · la app se reportó ${visto.toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" })}`
      : `<span class="ma-bad">Registrada, pero la app todavía no se reportó</span> — pon el kit en tu app y ábrela una vez.`;
    const base = new URL("kit/nodo-apps.js", location.href).href;
    kit.innerHTML = `<div class="ma-row"><span class="ma-lbl">Clave de la app</span><input class="ma-in md" value="${esc(app.clave)}" readonly><button class="btn" type="button" id="maCopiar">${icon("copy")} Copiar</button></div>
      <div class="ma-s" style="margin:6px 0">Pega esto en tu app (antes de que cargue su contenido):</div>
      <div class="ma-code">&lt;script src="${esc(base)}"&gt;&lt;/script&gt;
&lt;script&gt;NodoApps.iniciar({ app: "${esc(app.clave)}", alEntrar: (cliente) =&gt; { /* muestra tu app */ } });&lt;/script&gt;</div>`;
    $("maCopiar").onclick = () => { navigator.clipboard?.writeText(app.clave); toast("Clave copiada"); };
  };
  const llamar = async (body) => {
    const { data, error } = await supa.functions.invoke("microapps", { body: { channel_id: st.channelId, product_id: st.prod.id, ...body } });
    if (error) { let d = ""; try { d = (await error.context?.json?.())?.error || ""; } catch (_) {} return { ok: false, error: d || error.message }; }
    return data;
  };
  const errLegible = (e) => e === "apps_sin_configurar" ? "Falta conectar Nodo con la base de Apps (secretos NODO_APPS_URL y NODO_APPS_SECRET)."
    : e === "url_invalida" ? "El link de la app tiene que empezar con https://" : (e || "No se pudo conectar");
  (async () => { const r = await llamar({ action: "estado_app" }); if (r?.ok) pintarEstado(r.app); else $("maEstado").innerHTML = `<span class="ma-bad">${esc(errLegible(r?.error))}</span>`; })();
  $("maProbar").onclick = async () => {
    sync();
    if (!k.url) { toast("Pon el link de tu app", true); return; }
    $("maProbar").disabled = true;
    const r = await llamar({ action: "conectar", url: k.url, max_celulares: k.max_celulares });
    $("maProbar").disabled = false;
    if (!r?.ok) { toast(errLegible(r?.error), true); $("maEstado").innerHTML = `<span class="ma-bad">${esc(errLegible(r?.error))}</span>`; return; }
    pintarEstado(r.app); toast("Conexión guardada. Guarda el producto para el resto de cambios.");
  };
}

// Estado para el hub de Productos: ¿la app está lista para entregarse?
export function estadoConfigMicroapp(st) {
  const m = (st.prod.config || {}).microapp || {};
  const url = String(m.conexion?.url || "").trim();
  return url ? { ok: true, msg: "App conectada · correo obligatorio" } : { ok: false, msg: "Falta conectar la app" };
}
