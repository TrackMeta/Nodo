// ═══════════════════════════════════════════════════════════════════
// Nodo · contact-extras.js — extras de la FICHA de contacto, compartidos
// entre la Bandeja (index.html) y Probar flujos (probar.html), que antes
// tenían el panel copiado y divergido.
//
// Qué vive acá:
//  · esCampoInterno   — oculta los candados internos del motor (_once_*, _await…)
//  · origenLabel      — "ctwa" → "Anuncio de Meta" (legible para el humano)
//  · latestOrder      — el pedido más reciente del contacto (para resumen + rótulo)
//  · pedidoResumenHtml— tarjeta compacta del pedido en la ficha
//  · printRotulo      — el rótulo imprimible (portado de pedidos.html, misma plantilla)
//  · openDespachoModal— el formulario de despacho, ÚNICO para toda la app: lo
//                       abren el tablero de Pedidos y la ficha del contacto
//  · EXTRAS_CSS       — estilos de las tarjetas nuevas (una sola fuente)
// ═══════════════════════════════════════════════════════════════════
import * as O from "./orders.js";
import { toast, icon, norm } from "./shell.js";
import { cargarListas, sugerirAgencia } from "./courier-export.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const cap = (s) => { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); };
export function money(v, cur) {
  try { return new Intl.NumberFormat("es-PE", { style: "currency", currency: cur || "PEN" }).format(Number(v || 0)); }
  catch { return (cur || "PEN") + " " + Number(v || 0).toFixed(2); }
}

// Las etapas del embudo — FUENTE ÚNICA (la Bandeja, la ficha y la sección Embudo
// la importan). value=lo que se guarda · label=lo que se muestra · color/desc.
export const EMBUDO_STAGES = [
  { k: "nuevo",      label: "Nuevo",      color: "#378ADD", desc: "Llegó, aún genérico" },
  { k: "curioso",    label: "Curioso",    color: "#29B6D8", desc: "Solo tiró la palabra clave" },
  { k: "interesado", label: "Interesado", color: "#EF9F27", desc: "Interactuó, quiere más" },
  { k: "caliente",   label: "Caliente",   color: "#F0612B", desc: "Escribió 4+ mensajes sin comprar — súper enganchado" },
  { k: "confirmado", label: "Confirmado", color: "#8b5cf6", desc: "Confirmó recibir / adelanto validado" },
  { k: "comprado",   label: "Comprado",   color: "#1D9E75", desc: "Venta cerrada, plata dentro" },
  { k: "perdido",    label: "Perdido",    color: "#888780", desc: "Se cayó / no compró" },
];

// Selector de etapa bonito para la ficha: píldoras con el color de cada etapa,
// la actual resaltada. Reemplaza el <select> plano. Los clicks los cablea la
// página (busca [data-stagepick]).
export function stagePickerHtml(current) {
  const cur = String(current || "nuevo");
  return `<div class="cx-stagepick">${EMBUDO_STAGES.map((s) => {
    const on = s.k === cur;
    return `<button type="button" class="cx-stagechip${on ? " on" : ""}" data-stagepick="${s.k}"${on ? ` style="background:${s.color}1c;border-color:${s.color};color:${s.color}"` : ""}><span class="cx-sd" style="background:${s.color}"></span><span class="cx-sl">${esc(s.label)}</span>${on ? `<span class="cx-sck">${icon("check")}</span>` : ""}</button>`;
  }).join("")}</div>`;
}

// Campos internos del motor: candados `una_vez` (_once_venta_…, _once_aviso_…),
// estado persistido (_await) y cualquier clave que empiece con "_". No son datos
// del cliente — se ocultan de "Campos personalizados" (antes ensuciaban la ficha
// con nombres tipo "Once Aviso 3ed11330-3946-45ee-…").
// Claves internas del motor que NO son datos del cliente (guardan veredictos /
// estado del flujo). Se ocultan de "Para vender" y caen a "Campos técnicos"
// (Avanzado), igual que los `_…`. El valor suele ser una frase-veredicto que el
// filtro por valor no puede distinguir de un dato real.
const CLAVES_INTERNAS = new Set([
  "zona_entrega", "zona_distrito_incierto", "entrega_motivo", "menu_eleccion",
  // Datos de la TRANSACCIÓN, no del cliente. `esValorPresentable` filtra por VALOR,
  // y "49" / "0366585427" / "Rodrigo Flores" son valores perfectamente normales, así
  // que se colaban a "Para vender" como si fueran rasgos del comprador. El peor era
  // `pago_titular`: es el titular de TU cuenta — el nombre del dueño del negocio
  // apareciendo en la ficha del cliente, y la IA lo lee como contexto de él.
  "pago_monto", "pago_operacion", "pago_titular", "pago_resultado", "datos_pago",
  // Veredictos del clasificador y banderas de estado del pedido.
  "pedido_creado", "datos_completos",
]);
export const esCampoInterno = (key) => {
  const k = String(key || "");
  // `xt<hash>_*`: el motor crea UNA clave por cada presentación de extra con tallas
  // ("xt" + los 10 primeros del version_id, engine.ts:856). Se acumulan una por
  // variante, con nombre ilegible, y no son datos del cliente sino plumbing.
  // `extra_N_resp` / `extraf_N_resp`: lo que decidió el clasificador ("acepta"), no
  // algo que el cliente contara de sí mismo.
  return k.startsWith("_") || /^xt[0-9a-f]{10}_/.test(k) || /^extraf?_\d+_resp$/i.test(k)
    || CLAVES_INTERNAS.has(k.toLowerCase());
};

// ¿El valor de un campo es un DATO DEL CLIENTE presentable (no un flag/artefacto
// interno del motor)? Se usa en la Memoria IA ("Para vender") para no ensuciar la
// tarjeta con variables de flujo (pedido_creado=true, pago_resultado=PAGO_OK,
// opcion_id=<uuid>, ultima_imagen=<url>, JSON, textos larguísimos…). Solo display:
// el dato sigue existiendo en Avanzado. Devuelve false para vacío.
export function esValorPresentable(v) {
  const s = String(v ?? "").trim();
  if (!s) return false;
  if (s.length > 60) return false;                            // textos largos / JSON crudo
  if (/^https?:\/\//i.test(s)) return false;                  // URLs (ej. ultima_imagen)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(s)) return false; // UUIDs (ej. opcion_id)
  if (/^[\{\[]/.test(s)) return false;                        // JSON
  if (/^(true|false|pago_ok|pago_no|null|undefined)$/i.test(s)) return false; // flags booleanos
  if (/^(si|sí|no|ok|okay|ya|nel|dale|listo)$/i.test(s)) return false;        // respuestas-flag cortas
  return true;
}

// Cablea editar/borrar/agregar de los chips "Quién es" / "Cómo tratar" de la
// Memoria IA (los pinta la IA, pero el humano puede corregir). Los chips llevan
// data-mlayer (quien_es|como_tratar) y data-midx; el botón "+" lleva solo
// data-mlayer. Guarda en contacts.memoria_ia preservando _last (el reloj del
// throttle). reRender = renderContactPanel de la página. Compartido Bandeja/Probar.
export function wireMemoriaChips(p, contact, { supa, toast, reRender }) {
  const getMia = () => {
    const m = (contact.memoria_ia && typeof contact.memoria_ia === "object") ? contact.memoria_ia : {};
    return {
      quien_es: Array.isArray(m.quien_es) ? [...m.quien_es] : [],
      como_tratar: Array.isArray(m.como_tratar) ? [...m.como_tratar] : [],
      _last: m._last,
    };
  };
  const base = getMia(); // snapshot con el que el operador empezó a editar (para el delta)
  const norm = (s) => String(s ?? "").trim().toLowerCase();
  const guardar = async (mia) => {
    // 🔀 Lost-update: la memoria es un perfil VIVO que la IA rellena; mientras el chat está
    // abierto, la IA (o un 2º asesor) puede agregar un insight. Escribir el snapshot en memoria
    // borraría eso (misma clase que directo.html). Se RE-LEE fresco y se aplica el DELTA del
    // operador (lo que agregó/quitó vs `base`) sobre lo fresco: fresco − quitados + agregados.
    let fresh = getMia();
    try {
      const { data } = await supa.from("contacts").select("memoria_ia").eq("id", contact.id).maybeSingle();
      const m = (data?.memoria_ia && typeof data.memoria_ia === "object") ? data.memoria_ia : {};
      fresh = { quien_es: Array.isArray(m.quien_es) ? m.quien_es : [], como_tratar: Array.isArray(m.como_tratar) ? m.como_tratar : [], _last: m._last };
    } catch (_) { /* sin red → cae al snapshot (comportamiento viejo) */ }
    const mergeLayer = (layer) => {
      const baseK = new Set((base[layer] || []).map(norm));
      const nowK = new Set((mia[layer] || []).map(norm));
      const quitados = new Set([...baseK].filter((k) => !nowK.has(k)));   // los que el operador QUITÓ
      const out = [], vis = new Set();
      for (const x of (fresh[layer] || [])) { const k = norm(x); if (k && !quitados.has(k) && !vis.has(k)) { vis.add(k); out.push(x); } }   // fresco − quitados
      for (const x of (mia[layer] || [])) { const k = norm(x); if (k && !baseK.has(k) && !vis.has(k)) { vis.add(k); out.push(x); } }         // + agregados por el operador
      return out;
    };
    const payload = { quien_es: mergeLayer("quien_es"), como_tratar: mergeLayer("como_tratar") };
    const last = fresh._last ?? mia._last;   // preserva el reloj del throttle más reciente
    if (last) payload._last = last;
    contact.memoria_ia = payload; // que el re-render lo vea
    const { error } = await supa.from("contacts").update({ memoria_ia: payload }).eq("id", contact.id);
    if (error) toast("No se pudo guardar la memoria: " + error.message, true);
    else toast("Memoria actualizada");
    reRender();
  };
  // input inline reutilizable (editar o agregar)
  const editarInline = (el, valor, onSave) => {
    const inp = document.createElement("input");
    inp.className = "mia-edit"; inp.value = valor; if (!valor) inp.placeholder = "escribe…";
    el.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const commit = async () => { if (done) return; done = true; await onSave(inp.value.trim()); };
    inp.addEventListener("blur", commit);
    inp.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
      else if (e.key === "Escape") { done = true; reRender(); }
    };
  };
  // editar / borrar (vaciar = borrar) un chip existente
  p.querySelectorAll(".mia-chip[data-mlayer][data-midx]").forEach((chip) => chip.onclick = () => {
    const layer = chip.dataset.mlayer, idx = Number(chip.dataset.midx);
    const cur = getMia()[layer][idx] ?? "";
    editarInline(chip, cur, async (v) => {
      const m = getMia();
      if (v === cur) { reRender(); return; }
      if (!v) m[layer].splice(idx, 1); else m[layer][idx] = v;
      await guardar(m);
    });
  });
  // agregar un chip nuevo a la capa
  p.querySelectorAll(".mia-add[data-mlayer]").forEach((btn) => btn.onclick = () => {
    const layer = btn.dataset.mlayer;
    editarInline(btn, "", async (v) => {
      if (!v) { reRender(); return; }
      const m = getMia(); m[layer].push(v.slice(0, 60)); await guardar(m);
    });
  });
}

// El webhook guarda el origen como código ("ctwa"); acá se muestra legible.
export function origenLabel(source) {
  const s = String(source || "").toLowerCase().trim();
  if (!s) return "Directo";
  if (s === "ctwa" || s === "ad" || s.includes("anuncio") || s.includes("ctwa")) return "Anuncio de Meta";
  if (s === "webchat" || s === "webchat-test") return "Web Chat";
  if (s === "directo") return "Directo";
  return cap(source);
}

// Pedido más reciente del contacto. Degrada con elegancia si faltan columnas /
// relaciones (mismo patrón resiliente que pedidos.html).
export async function latestOrder(supa, contactId) {
  if (!contactId) return null;
  const sel = "id,amount,currency,order_bumps,estado,order_id,created_at,updated_at,shipping,product_id,contact:contact_id(nombre,wa_id),product:product_id(nombre,emoji,tipo),version:version_id(nombre)";
  try {
    const { data, error } = await supa.from("orders").select(sel).eq("contact_id", contactId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!error) return data || null;
  } catch (_) { /* cae al intento simple */ }
  try {
    const { data } = await supa.from("orders").select("id,amount,currency,order_bumps,estado,order_id,created_at,shipping,product_id,product:product_id(nombre,emoji,tipo),version:version_id(nombre)").eq("contact_id", contactId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return data || null;
  } catch (_) { return null; }
}

// Remitente del rótulo = nombre del NEGOCIO; cae al nombre del canal.
export async function remitenteDe(supa, channelId) {
  if (!channelId) return "";
  try {
    const { data } = await supa.from("channels").select("nombre,negocio_form").eq("id", channelId).maybeSingle();
    return (data?.negocio_form?.nombre || data?.nombre || "").trim();
  } catch (_) {
    try { const { data } = await supa.from("channels").select("nombre").eq("id", channelId).maybeSingle(); return (data?.nombre || "").trim(); }
    catch (_) { return ""; }
  }
}

// Sección desplegable (acordeón) de la ficha. `count` pinta una pastilla con el
// número; `open` la deja abierta al cargar. Usa <details> nativo: los hijos
// siguen en el DOM aunque esté cerrada, así los handlers (inputs, selects) que
// se enganchan después por querySelector siguen funcionando.
export function sec(title, body, { open = false, count = null } = {}) {
  const badge = (typeof count === "number" && count > 0) ? `<span class="cx-sec-n">${count}</span>` : "";
  return `<details class="cx-sec"${open ? " open" : ""}><summary><span class="cx-sec-t">${esc(title)}</span>${badge}<span class="cx-sec-ar"></span></summary><div class="cx-sec-body">${body || ""}</div></details>`;
}

const TONO_COLOR = { ok: "var(--green)", warn: "var(--amber)", bad: "var(--red)" };

// Apartado COMPLETO del pedido dentro de la ficha: producto + atributos, ventas
// extra y regalos (order_bumps), y todos los datos del cliente (incluido su
// teléfono) con lo que edites (agencia CONFIRMADA `destino`, guía, clave…).
// Devuelve solo el HTML interior; el <h4> y el botón de rótulo los pone quien la
// usa. Necesita `o.contact` (nombre, wa_id): latestOrder lo trae en el join.
// Progreso logístico del pedido (dónde está AHORA): stepper con los hitos del
// recorrido. Provincia: Adelanto → Despachado → En agencia → Saldo → Recogido.
// Lima: Confirmado → En reparto → Entregado. Digital no lleva logística.
function pedidoProgresoHtml(o) {
  const zona = O.zonaDe(o);
  if (zona !== "provincia" && zona !== "lima") return "";
  const estado = o.estado;
  const NEG = { cancelado: "Cancelado", no_recogido: "No se recogió", rechazado: "Rechazado" };
  if (NEG[estado]) {
    return `<div style="margin:10px 2px 4px;font-size:12px;font-weight:700;color:var(--red,#dc2626)">${esc(NEG[estado])}</div>`;
  }
  // "Saldo" (Pagaron saldo) se cumple apenas el cliente MANDA el comprobante
  // (aunque esté por validar); "Clave" (Clave enviada) recién al aprobarlo
  // (saldo_pagado). Mismos 6 pasos que el panel "Dónde están ahora · provincia".
  const s = o.shipping || {};
  const inc = (...e) => e.includes(estado);
  const saldoRecibido = !!(s.saldo_comprobante || s.saldo_recibido_at) || inc("saldo_pagado", "recogido");
  const pasos = zona === "provincia"
    ? [["Adelanto", inc("adelanto_validado", "por_despachar", "despachado", "en_agencia", "saldo_pagado", "recogido")],
       ["Despacho", inc("despachado", "en_agencia", "saldo_pagado", "recogido")],
       ["Agencia", inc("en_agencia", "saldo_pagado", "recogido")],
       ["Saldo", saldoRecibido],
       ["Clave", inc("saldo_pagado", "recogido")],
       ["Recojo", inc("recogido")]]
    : [["Confirmado", inc("confirmado", "en_reparto", "reprogramado", "entregado_cobrado")],
       ["En reparto", inc("en_reparto", "reprogramado", "entregado_cobrado")],
       ["Entregado", inc("entregado_cobrado")]];
  const done = pasos.map(([, d]) => d);
  const curIdx = done.lastIndexOf(true); // último hito alcanzado
  const parts = [];
  pasos.forEach((p, i) => {
    const isDone = done[i], isNext = !isDone && i === curIdx + 1;
    const dot = isDone
      ? `background:var(--green,#16a34a);color:#fff;border:0`
      : isNext ? `background:transparent;color:var(--brand);border:2px solid var(--brand)`
               : `background:transparent;color:var(--faint);border:1.5px solid var(--border)`;
    const lbl = isDone ? "var(--text)" : isNext ? "var(--brand)" : "var(--faint)";
    if (i > 0) {
      const on = done[i]; // la línea se pinta si el hito de la derecha ya se alcanzó
      parts.push(`<div style="flex:0 0 3px;height:2px;margin-top:6px;background:${on ? "var(--green,#16a34a)" : "var(--border)"}"></div>`);
    }
    parts.push(`<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1 1 0;min-width:0">
      <span style="width:14px;height:14px;flex:0 0 auto;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;${dot}">${isDone ? icon("check") : ""}</span>
      <span style="font-size:7px;line-height:1;text-align:center;font-weight:${isNext ? "700" : "500"};color:${lbl};white-space:nowrap">${esc(p[0])}</span></div>`);
  });
  return `<div style="display:flex;align-items:flex-start;margin:12px 0 4px">${parts.join("")}</div>`;
}

export function pedidoResumenHtml(o) {
  if (!o) return "";
  const c = o.contact || {}, p = o.product || {}, v = o.version || {}, s = o.shipping || {};
  const zona = O.zonaDe(o);
  const zonaTxt = zona === "lima" ? "LIMA" : zona === "provincia" ? "PROVINCIA" : "DIGITAL";
  const col = TONO_COLOR[O.tono(o.estado)] || "var(--amber)";
  const prod = [p.emoji, p.nombre, v.nombre ? "· " + v.nombre : ""].filter(Boolean).join(" ") || "Pedido";
  const adel = Number(s.adelanto || 0), saldo = Number(s.saldo || 0);
  const moneyLine = adel || saldo
    ? `${adel ? `Adelanto <b>${money(adel, o.currency)}</b>` : ""}${adel && saldo ? " · " : ""}${saldo ? `Saldo <b>${money(saldo, o.currency)}</b>` : ""}`
    : `Total <b>${money(O.total(o), o.currency)}</b>`;
  const air = s.aereo ? ` <span class="pd-chip air">${icon("plane")} Aéreo</span>` : "";
  const linesHtml = (arr) => arr.length ? `<div class="pd-info">${arr.join("")}</div>` : "";
  const mkLine = (k, valHtml) => valHtml ? `<div class="pd-line"><span class="pd-k">${esc(k)}</span><span class="pd-v">${valHtml}</span></div>` : "";

  // ── PRODUCTO: atributos del principal (talla, color…) + guía/clave. Los
  //    atributos del regalo/extra NO van acá: se muestran con su bump abajo.
  const prodLines = [];
  for (const [k, val] of Object.entries(s.atributos || {})) {
    if (/regalo|extra/i.test(k)) continue;
    prodLines.push(mkLine(k, esc(val)));
  }
  if (s.guia) prodLines.push(mkLine("Guía", `<b class="mono">${esc(s.guia)}</b>`));
  if (s.clave_recojo) prodLines.push(mkLine("Clave", `<b class="mono">${esc(s.clave_recojo)}</b>`));

  // ── VENTAS EXTRA Y REGALOS: cada order_bump del pedido, con su variante
  //    (parseada del stock_key) y su precio. El regalo va marcado "Gratis".
  const bumps = Array.isArray(o.order_bumps) ? o.order_bumps : [];
  const bumpRows = bumps.map((b) => {
    const esRegalo = b.regalo === true || Number(b.precio || 0) === 0;
    const nom = (String(b.nombre || "")
      .replace(/\s*—\s*S\/\s*[\d.,]+\s*$/i, "")      // quita el sufijo de precio (lo mostramos aparte)
      .replace(/\s*\((?:extra|regalo)\)\s*/ig, " ")   // quita "(extra)"/"(regalo)" (ya lo dice el icono)
      .replace(/\s{2,}/g, " ").trim()) || (esRegalo ? "Regalo" : "Extra");
    const varTxt = (b.stock_key && b.stock_key !== "_")
      ? b.stock_key.split("|").map((kv) => { const [k, val] = kv.split("="); return `${k} ${cap(val || "")}`; }).join(" · ")
      : "";
    const precioTxt = esRegalo ? "Gratis" : money(Number(b.precio || 0), o.currency);
    const flags = (b.stock_pendiente ? ` <span class="pd-chip warn">falta talla</span>` : "")
      + (b.digital ? ` <span class="pd-chip">${b.entregado ? "entregado" : "digital"}</span>` : "");
    return `<div class="pd-bump"><span class="pd-bi">${esRegalo ? icon("gift") : icon("plus")}</span>` +
      `<span class="pd-bn">${esc(nom)}${varTxt ? ` <span class="pd-bvar">${esc(varTxt)}</span>` : ""}${flags}</span>` +
      `<span class="pd-bp">${esc(precioTxt)}</span></div>`;
  }).join("");

  // ── DATOS DEL CLIENTE: nombre, teléfono y a dónde se entrega ──
  const cliLines = [];
  const dest = (s.cliente || c.nombre || "").trim();
  cliLines.push(mkLine("Cliente", dest ? esc(dest) : ""));
  // El contacto de prueba tiene wa_id literal "webchat-test" (no es un número):
  // se muestra como tal, sin el "+" que insinúa un teléfono real.
  const esPrueba = c.wa_id === "webchat-test";
  // Prefiere el número CAPTURADO (shipping.tel) — clave para el cliente que llegó
  // por "nombre de usuario" de WhatsApp sin compartir su número: ahí wa_id es un
  // BSUID, no un teléfono, y el que sirve para el courier es el que dio en el chat.
  // Si hay un número capturado se muestra SIEMPRE (incluso en el contacto de
  // prueba); si no, el de prueba muestra "Web Chat" y el real su wa_id/telefono.
  const telReal = s.tel || (esPrueba ? "" : (c.telefono || c.wa_id));
  const telHtml = telReal ? `<b class="mono">+${esc(telReal)}</b>`
    : (esPrueba ? `<span class="pd-muted">Web Chat (prueba)</span>` : "");
  cliLines.push(mkLine("Teléfono", telHtml));
  if (zona === "provincia") {
    cliLines.push(mkLine("DNI", s.dni ? `<b class="mono">${esc(s.dni)}</b>` : ""));
    if (s.destino) cliLines.push(mkLine("Agencia", `${esc(s.destino)}${air}`));
    else if (s.sede) cliLines.push(mkLine("Agencia", `${esc(s.sede)} <span class="pd-chip warn">sin confirmar</span>${air}`));
    else if (s.ciudad) cliLines.push(mkLine("Agencia", `Shalom ${esc(cap(s.ciudad))}${air}`));
    if (!s.destino && s.ciudad && s.sede) cliLines.push(mkLine("Ciudad", esc(cap(s.ciudad))));
    if (s.mercaderia) cliLines.push(mkLine("Medida", esc(s.mercaderia)));
  } else if (zona === "lima") {
    // El distrito se captura en `zona_nombre` (resolverZonaAccion). Los pedidos
    // viejos no tienen `distrito`, así que caemos a `zona_nombre`. "Lima" a secas
    // es la ciudad genérica, no un distrito → no lo mostramos como distrito.
    const dist = s.distrito || s.zona_nombre || "";
    const distReal = dist && dist.toLowerCase() !== "lima" ? dist : "";
    cliLines.push(mkLine("Dirección", s.direccion ? esc(s.direccion) : ""));
    cliLines.push(mkLine("Distrito", distReal ? esc(cap(distReal)) : ""));
    cliLines.push(mkLine("Provincia", esc(s.provincia || "Lima")));
    cliLines.push(mkLine("Referencia", s.referencia ? esc(s.referencia) : ""));
  }

  return `
    <div class="pd-card">
      <div class="pd-top">
        <span class="pd-prod">${esc(prod)}</span>
        <span class="pd-zona">${zonaTxt}</span>
      </div>
      <div class="pd-row">
        <span class="pd-badge" style="color:${col};background:${col}1e;border-color:${col}55">${esc(O.label(o.estado))}</span>
        <span class="pd-money">${moneyLine}</span>
      </div>
      ${pedidoProgresoHtml(o)}
      ${linesHtml(prodLines.filter(Boolean))}
      ${bumpRows ? `<div class="pd-sub">Ventas extra y regalos</div><div class="pd-bumps">${bumpRows}</div>` : ""}
      <div class="pd-sub">Datos del cliente</div>
      ${linesHtml(cliLines.filter(Boolean))}
    </div>`;
}

// Rótulo imprimible — misma plantilla que pedidos.html (una sola verdad visual).
// Provincia = etiqueta para el paquete que va a la agencia (DNI + sede).
// Lima = hoja para el motorizado con el MONTO A COBRAR grande (contraentrega).
export function printRotulo(o, remitente) {
  if (!o) { toast("Este contacto todavía no tiene un pedido", true); return; }
  const c = o.contact || {}, p = o.product || {}, v = o.version || {}, s = o.shipping || {};
  const zona = O.zonaDe(o);
  const rem = (remitente || "").trim() || "Remitente";
  // Teléfono del rótulo: el CAPTURADO (shipping.tel) manda — es el que el courier
  // llama. Clave para el cliente sin número (username/BSUID): ahí c.wa_id es un
  // BSUID, no un teléfono. Cae a telefono/wa_id real solo si no hay capturado.
  const telNum = s.tel || c.telefono || (c.wa_id === "webchat-test" ? "" : c.wa_id);
  const tel = telNum ? "+" + telNum : "—";
  const pedido = [p.emoji, p.nombre, v.nombre ? "· " + v.nombre : ""].filter(Boolean).join(" ");
  const nro = (o.order_id || o.id || "").toString().slice(0, 8).toUpperCase();
  const row = (k, val, big) => val ? `<tr><td class="k">${esc(k)}</td><td class="v ${big ? "big" : ""}">${esc(val)}</td></tr>` : "";
  // Igual que `row`, pero para los datos SIN los que el envío no se puede despachar. `row`
  // omite la fila cuando el valor está vacío, así que un pedido de provincia sin DNI salía
  // impreso sin ninguna línea de DNI: el que empaca no ve que falta y lo descubre en la
  // agencia, con el paquete ya allá. (El modal de despacho sí marca los vacíos; el rótulo,
  // que es el papel que viaja, no.) Acá la fila SIEMPRE sale, y si falta el dato lo grita.
  const rowReq = (k, val, big) => val
    ? `<tr><td class="k">${esc(k)}</td><td class="v ${big ? "big" : ""}">${esc(val)}</td></tr>`
    : `<tr><td class="k">${esc(k)}</td><td class="v ${big ? "big" : ""}" style="color:#c00;font-weight:800">FALTA</td></tr>`;
  const atrLine = Object.entries(s.atributos || {}).map(([k, val]) => `${k}: ${val}`).join("   ·   ");
  let filas = "";
  if (zona === "provincia") {
    filas =
      rowReq("Destinatario", s.cliente || c.nombre || "", true) +
      rowReq("DNI", s.dni || "", true) +
      row("Teléfono", tel) +
      rowReq("Agencia", [s.ciudad && ("Shalom " + cap(s.ciudad)), s.sede].filter(Boolean).join(" · ") || (s.agencia ? cap(s.agencia) : ""), true) +
      row("Envío", s.aereo ? "AÉREO — despachar por avión" : "", true) +
      row("Pedido", pedido) +
      row("Detalle", atrLine, true) +
      row("N° pedido", nro);
  } else {
    filas =
      rowReq("Destinatario", c.nombre || s.cliente || "", true) +
      row("Teléfono", tel) +
      rowReq("Dirección", s.direccion || "", true) +
      row("Distrito", (() => { const d = s.distrito || s.zona_nombre || ""; return d && d.toLowerCase() !== "lima" ? cap(d) : ""; })()) +
      row("Provincia", s.provincia || "Lima") +
      row("Referencia", s.referencia || "") +
      row("Pedido", pedido) +
      row("Detalle", atrLine, true) +
      row("A COBRAR", money(O.total(o), o.currency) + "  ·  CONTRAENTREGA", true);
  }
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
    <title>Rótulo ${esc(nro)}</title>
    <style>
      *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:26px;color:#000}
      .lbl{border:2px solid #000;border-radius:10px;padding:18px 20px;max-width:520px;margin:0 auto}
      .hd{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px}
      .hd .zn{font-size:13px;font-weight:800;letter-spacing:1px;border:2px solid #000;border-radius:6px;padding:3px 10px}
      .rem{font-size:12px}.rem b{font-size:15px}
      table{width:100%;border-collapse:collapse}
      td{padding:6px 4px;vertical-align:top;border-bottom:1px solid #ccc}
      td.k{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#333;width:34%}
      td.v{font-size:15px;font-weight:600}
      td.v.big{font-size:20px;font-weight:800}
      .ft{margin-top:12px;font-size:10.5px;color:#555;text-align:center}
      @media print{ body{padding:0} .lbl{border-width:3px;max-width:none} .noprint{display:none} }
      .noprint{text-align:center;margin-top:20px} .noprint button{font-size:14px;padding:9px 20px;cursor:pointer}
    </style></head><body>
    <div class="lbl">
      <div class="hd">
        <div class="rem">Remitente:<br><b>${esc(rem)}</b></div>
        <div class="zn">${zona === "provincia" ? (s.aereo ? "AGENCIA · AÉREO" : "AGENCIA") : "CONTRAENTREGA"}</div>
      </div>
      <table>${filas}</table>
      <div class="ft">Generado por Nodo · ${new Date().toLocaleDateString("es-PE")}</div>
    </div>
    <div class="noprint"><button onclick="window.print()">Imprimir</button></div>
    <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script>
    </body></html>`;
  const w = window.open("", "_blank", "width=640,height=800");
  if (!w) { toast("Permite las ventanas emergentes para imprimir el rótulo", true); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

// Estilos de las tarjetas nuevas de la ficha (pago por validar, Pedido, acciones,
// campos técnicos). Se inyectan una vez por página con injectExtrasCss().
export const EXTRAS_CSS = `
  /* Acento IA (violeta/fucsia) para la Memoria IA — disponible donde se inyecte */
  :root{--ia:#a855f7;--ia-2:#ec4899;--ia-bg:rgba(168,85,247,.12);--ia-border:rgba(168,85,247,.4)}
  /* ── Memoria IA (piel de la sección IA) ── */
  .cpanel .mia{position:relative;overflow:hidden;border:1px solid var(--ia-border);border-radius:16px;padding:15px 14px 12px;margin:14px 0 6px;
    background:radial-gradient(120% 140% at 0% 0%,rgba(168,85,247,.22),transparent 55%),radial-gradient(120% 140% at 100% 100%,rgba(236,72,153,.16),transparent 55%),var(--surface-2)}
  .cpanel .mia::after{content:"";position:absolute;right:-42px;top:-42px;width:160px;height:160px;border-radius:50%;background:radial-gradient(circle,rgba(168,85,247,.34),transparent 70%);filter:blur(22px);pointer-events:none}
  .cpanel .mia-hd{position:relative;display:flex;align-items:center;gap:10px;margin-bottom:15px}
  .cpanel .mia-ico{width:32px;height:32px;flex:none;border-radius:9px;background:linear-gradient(135deg,var(--ia),var(--ia-2));color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(168,85,247,.4)}
  .cpanel .mia-ico svg{width:17px;height:17px}
  .cpanel .mia-htx{display:flex;flex-direction:column;min-width:0}
  .cpanel .mia-title{font-size:15.5px;font-weight:800;letter-spacing:-.2px;line-height:1.1;background:linear-gradient(90deg,var(--ia),var(--ia-2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .cpanel .mia-cap{font-size:10.5px;color:var(--faint);margin-top:2px}
  .cpanel .mia-lyr{position:relative;display:flex;align-items:center;gap:6px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#c9b6e8;font-weight:700;margin:0 0 6px}
  .cpanel .mia-lyr::before{content:"";width:6px;height:6px;border-radius:50%;background:linear-gradient(135deg,var(--ia),var(--ia-2));flex:none}
  .cpanel .mia-lyr .mia-sub{color:var(--faint);text-transform:none;letter-spacing:0;font-weight:400}
  .cpanel .mia-chips{position:relative;display:flex;flex-wrap:wrap;gap:5px;margin-bottom:14px}
  .cpanel .mia-chip{font-size:12px;padding:5px 11px;border-radius:999px;border:1px solid transparent;line-height:1;font-family:inherit}
  .cpanel .mia-chip.sell{background:rgba(168,85,247,.18);border-color:rgba(168,85,247,.5);color:#e9d5ff;cursor:pointer}
  .cpanel .mia-chip.ghost{background:rgba(168,85,247,.06);border:1px dashed var(--ia-border);color:var(--muted);cursor:pointer}
  .cpanel .mia-chip.who{background:rgba(236,72,153,.15);border-color:rgba(236,72,153,.5);color:#f9a8d4}
  .cpanel .mia-chip.how{background:rgba(139,110,247,.15);border-color:rgba(139,110,247,.45);color:#c4b5fd}
  .cpanel .mia-chip.sell:hover,.cpanel .mia-chip.ghost:hover{filter:brightness(1.14)}
  .cpanel .mia-chip svg{width:11px;height:11px;vertical-align:-1px;opacity:.7}
  .cpanel .mia-none{font-size:11.5px;color:var(--faint)}
  .cpanel .mia-edit{font-size:12px;height:28px;border-radius:999px;background:var(--surface);border:1px solid var(--ia);color:var(--text);padding:0 11px;outline:none;min-width:90px;font-family:inherit}
  .cpanel .mia-foot{position:relative;display:flex;align-items:center;justify-content:space-between;margin-top:2px;padding-top:10px;border-top:1px solid rgba(168,85,247,.18)}
  .cpanel .mia-hint{font-size:10.5px;color:var(--faint)}
  .cpanel .mia-mini{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--faint);font-weight:700;margin:10px 0 2px}
  .cpanel .mia-mini:first-child{margin-top:0}
  /* Tema claro: los chips llevan texto oscuro (el claro se lee mal sobre el tinte pálido) */
  html[data-theme=light] .cpanel .mia-lyr{color:#7c3aed}
  html[data-theme=light] .cpanel .mia-chip.sell{color:#6b21a8}
  html[data-theme=light] .cpanel .mia-chip.who{color:#9d174d}
  html[data-theme=light] .cpanel .mia-chip.how{background:rgba(124,58,237,.1);border-color:rgba(124,58,237,.35);color:#6d28d9}
  html[data-theme=light] .cpanel .mia-edit{color:var(--text)}
  /* Secciones desplegables (acordeón) */
  .cpanel .cx-sec{border-top:1px solid var(--border)}
  .cpanel .cx-sec>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:13px 2px;
    font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);user-select:none;transition:color .12s}
  .cpanel .cx-sec>summary::-webkit-details-marker{display:none}
  .cpanel .cx-sec>summary:hover{color:var(--text)}
  .cpanel .cx-sec-n{background:var(--surface-2);color:var(--muted);border-radius:999px;font-size:10px;font-weight:700;padding:1px 7px;min-width:18px;text-align:center;line-height:1.6}
  .cpanel .cx-sec-ar{margin-left:auto;width:7px;height:7px;border-right:2px solid var(--faint);border-bottom:2px solid var(--faint);transform:rotate(-45deg);transition:transform .18s;flex:none}
  .cpanel .cx-sec[open]>summary .cx-sec-ar{transform:rotate(45deg)}
  .cpanel .cx-sec-body{padding:2px 0 14px}
  /* Selector de etapa (píldoras bonitas, reemplaza el <select>) */
  .cpanel .cx-stagepick{display:flex;flex-direction:column;gap:6px}
  .cpanel .cx-stagechip{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:11px;border:1px solid var(--border);
    background:var(--surface-2);color:var(--muted);font-size:12.5px;font-family:inherit;cursor:pointer;text-align:left;width:100%;
    transition:border-color .14s,background .14s,transform .05s}
  .cpanel .cx-stagechip:hover{border-color:var(--faint)}
  .cpanel .cx-stagechip:active{transform:scale(.99)}
  .cpanel .cx-stagechip.on{font-weight:700;box-shadow:0 1px 6px rgba(0,0,0,.06)}
  .cpanel .cx-stagechip .cx-sd{width:10px;height:10px;border-radius:50%;flex:none}
  .cpanel .cx-stagechip .cx-sl{flex:1}
  .cpanel .cx-stagechip .cx-sck{font-size:13px;font-weight:800;flex:none;margin-left:1px;display:inline-flex}
  /* Colapso explícito (no depender del user-agent para ocultar el cuerpo) */
  .cpanel .cx-sec:not([open])>.cx-sec-body{display:none}
  .cpanel .cf-tech:not([open])>*:not(summary){display:none}
  /* Pagos por validar, dentro de la ficha */
  .cpanel .cx-copiloto{border:1px solid var(--border-strong,#2f3a48);border-radius:14px;padding:13px;margin:12px 0 4px;background:var(--surface-2);display:flex;flex-direction:column;gap:10px;box-shadow:0 2px 12px rgba(0,0,0,.18)}
  .cpanel .cx-cop2-hd{display:flex;align-items:center;gap:8px;color:var(--muted)}
  .cpanel .cx-cop2-pill{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;padding:3px 9px;border-radius:999px}
  .cpanel .cx-cop2-pill.dig{background:rgba(139,92,246,.16);color:#8b5cf6}
  .cpanel .cx-cop2-pill.ext{background:var(--green-bg,rgba(16,185,129,.13));color:var(--green)}
  .cpanel .cx-cop2-pill.adel{background:var(--amber-bg,rgba(245,158,11,.13));color:var(--amber)}
  .cpanel .cx-cop2-pill.desp{background:var(--green-bg,rgba(16,185,129,.13));color:var(--green)}
  .cpanel .cx-cop2-pill.camino{background:var(--surface);color:var(--muted)}
  .cpanel .cx-cop2-pill.saldo{background:var(--brand-bg);color:var(--brand)}
  .cpanel .cx-cop2-img{width:100%;max-height:190px;object-fit:cover;border-radius:10px;border:1px solid var(--border);cursor:zoom-in;background:var(--surface)}
  .cpanel .cx-cop2-noimg{width:100%;height:74px;border:1px dashed var(--border);border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--faint);font-size:12px}
  .cpanel .cx-cop2-amt{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
  .cpanel .cx-cop2-lbl{font-size:11px;color:var(--muted)}
  .cpanel .cx-cop2-val{font-size:18px;font-weight:800;letter-spacing:-.3px}
  .cpanel .cx-cop2-ia,.cpanel .cx-cop2-warn{display:flex;gap:7px;align-items:flex-start;font-size:12px;line-height:1.4;border-radius:9px;padding:8px 10px}
  .cpanel .cx-cop2-ia svg,.cpanel .cx-cop2-warn svg{flex:none;margin-top:1px}
  .cpanel .cx-cop2-ia.ok{background:var(--green-bg,rgba(16,185,129,.13));color:var(--green)}
  .cpanel .cx-cop2-ia.duda,.cpanel .cx-cop2-warn{background:var(--amber-bg,rgba(245,158,11,.13));color:var(--amber)}
  .cpanel .cx-cop2-acts{display:flex;gap:7px;flex-wrap:wrap;margin-top:2px}
  .cpanel .cx-cop2-btn{flex:1;min-width:132px;height:40px;border-radius:11px;border:none;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px;transition:filter .12s,transform .06s,box-shadow .12s}
  /* Acción primaria (confirmar): relleno sólido + texto blanco crujiente + profundidad sutil */
  .cpanel .cx-cop2-btn.main{background:#12a150;color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.22)}
  .cpanel .cx-cop2-btn.main.blue{background:var(--brand)}
  .cpanel .cx-cop2-btn.main.amber{background:#cf6c0e}
  .cpanel .cx-cop2-btn.main:hover{filter:brightness(1.08)}
  .cpanel .cx-cop2-btn.main:active{transform:scale(.985)}
  /* Acción destructiva (rechazar): silenciosa, no compite con la primaria */
  .cpanel .cx-cop2-btn.danger{flex:none;min-width:0;padding:0 16px;background:transparent;color:var(--red);border:1px solid var(--border-strong,#2f3a48)}
  .cpanel .cx-cop2-btn.danger:hover{background:var(--red-bg,rgba(239,68,68,.12));border-color:var(--red)}
  .cpanel .cx-cop2-btn.danger:active{transform:scale(.985)}
  .cpanel .cx-actions{display:flex;gap:8px;margin:12px 0 2px}
  .cpanel .cx-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:7px;height:38px;
    border-radius:10px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);
    font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:border-color .15s,transform .06s}
  .cpanel .cx-btn:hover{border-color:var(--brand)} .cpanel .cx-btn:active{transform:translateY(1px)}
  .cpanel .cx-btn svg{width:16px;height:16px}
  .cpanel .cx-btn.ia{background:linear-gradient(135deg,#a855f7,#ec4899);border:none;color:#fff;box-shadow:0 3px 10px rgba(168,85,247,.32)}
  .cpanel .cx-btn.ia:hover{background:linear-gradient(135deg,#9333ea,#db2777)}
  .cpanel .cx-btn:disabled{opacity:.5;cursor:not-allowed}
  .cpanel .cx-fichahint{font-size:11.5px;line-height:1.45;color:var(--muted,#8a97a8);background:var(--surface-2,#1b222c);border:1px solid var(--border,#232b36);border-radius:9px;padding:7px 10px;margin:2px 0 6px}
  .cpanel .cx-fichahint summary{display:flex;align-items:center;gap:6px;cursor:pointer;list-style:none;font-weight:600;color:var(--text,#e7ecf2)}
  .cpanel .cx-fichahint summary::-webkit-details-marker{display:none}
  .cpanel .cx-fichahint summary svg{flex:none;width:14px;height:14px;color:var(--green,#22c079)}
  .cpanel .cx-fichahint .cx-fh-q{margin-left:auto;color:var(--brand,#2b7fff);font-weight:600;font-size:10.5px;white-space:nowrap}
  .cpanel .cx-fichahint[open] .cx-fh-q{opacity:.6}
  .cpanel .cx-fichahint .cx-fh-body{margin-top:7px;color:var(--muted,#8a97a8)}
  .cpanel .cx-fichahint b{color:var(--text,#e7ecf2);font-weight:700}
  /* Sugerencias de la IA en la ficha (bloque aparte del pago por validar) */
  .cx-cop{margin-top:8px;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--surface-2)}
  .cx-cop-hd{display:flex;align-items:center;gap:8px;padding:9px 11px;font-size:11px;font-weight:700;
    letter-spacing:.4px;text-transform:uppercase;color:#a855f7;background:linear-gradient(135deg,rgba(168,85,247,.10),rgba(236,72,153,.08))}
  .cx-cop-hd svg{width:15px;height:15px}
  .cx-cop-body{padding:9px 10px;display:flex;flex-direction:column;gap:7px}
  .cx-sug{text-align:left;background:var(--surface);border:1px solid var(--border);border-radius:9px;
    padding:8px 10px;font-size:12.5px;line-height:1.35;color:var(--text);cursor:pointer;font-family:inherit;transition:border-color .15s}
  .cx-sug:hover{border-color:#a855f7}
  .cx-cop-load{display:flex;align-items:center;gap:9px;font-size:12.5px;color:var(--muted);padding:4px 2px}
  .cx-cop-empty{font-size:12.5px;color:var(--faint);padding:2px}
  .cx-spin{width:14px;height:14px;border:2px solid var(--border);border-top-color:#a855f7;border-radius:50%;animation:cxspin .7s linear infinite}
  @keyframes cxspin{to{transform:rotate(360deg)}}
  /* Tarjeta de pedido */
  .pd-card{border:1px solid var(--border);border-radius:12px;padding:11px 12px;background:var(--surface-2);display:flex;flex-direction:column;gap:8px}
  .pd-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .pd-prod{font-size:13px;font-weight:600;color:var(--text);min-width:0;word-break:break-word}
  .pd-zona{flex:none;font-size:10px;font-weight:800;letter-spacing:.5px;color:var(--muted);background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:2px 7px}
  .pd-row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
  .pd-badge{font-size:11px;font-weight:700;border:1px solid;border-radius:999px;padding:2px 9px}
  .pd-money{font-size:12.5px;color:var(--muted)} .pd-money b{color:var(--text)}
  .pd-info{display:flex;flex-direction:column;gap:6px;border-top:1px dashed var(--border);padding-top:8px}
  .pd-line{display:grid;grid-template-columns:72px 1fr;gap:8px;font-size:12px;line-height:1.45;align-items:baseline}
  .pd-k{color:var(--muted);font-size:11px}
  .pd-v{color:var(--text);word-break:break-word} .pd-v b{color:var(--text)}
  .pd-v .mono{font-variant-numeric:tabular-nums;letter-spacing:.4px}
  .pd-chip svg{width:1.2em;height:1.2em;vertical-align:-.25em}
  .pd-chip{display:inline-block;font-size:9.5px;font-weight:800;letter-spacing:.3px;border:1px solid;border-radius:5px;padding:0 5px;vertical-align:middle;white-space:nowrap}
  .pd-chip.air{color:#3b82f6;border-color:#3b82f6}
  .pd-chip.warn{color:var(--amber);border-color:var(--amber)}
  /* Sub-encabezado dentro del apartado del pedido */
  .pd-sub{font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--faint);border-top:1px dashed var(--border);padding-top:8px;margin-top:1px}
  /* Ventas extra y regalos */
  .pd-bumps{display:flex;flex-direction:column;gap:6px}
  .pd-bump{display:flex;align-items:baseline;gap:7px;font-size:12px;line-height:1.4}
  .pd-bi{flex:none;font-size:13px}
  .pd-bn{flex:1;min-width:0;color:var(--text);word-break:break-word}
  .pd-bvar{color:var(--muted);font-size:11px}
  .pd-bp{flex:none;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums}
  .pd-muted{color:var(--muted)}
  /* Campos técnicos (colapsados) */
  .cf-tech{margin-top:10px;font-size:12px}
  .cf-tech summary{cursor:pointer;color:var(--faint);list-style:none;display:flex;align-items:center;gap:6px;padding:2px 0}
  .cf-tech summary::-webkit-details-marker{display:none}
  .cf-tech summary::before{content:"▸";font-size:10px;transition:transform .15s}
  .cf-tech[open] summary::before{transform:rotate(90deg)}
  .cf-tech .cf-trow{display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid var(--border);color:var(--muted)}
  .cf-tech .cf-trow .k{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;color:var(--faint);word-break:break-all;flex:1}
  .cf-tech .cf-trow .v{color:var(--muted);text-align:right;word-break:break-word;max-width:45%}
`;

// ── Registrar despacho: UN solo formulario para toda la app ────────
// Vive acá porque lo abren dos sitios: el tablero de Pedidos y la ficha del
// contacto (desde el chat, que es donde estás cuando vuelves de la agencia).
// Antes cada uno tenía el suyo y guardaban campos DISTINTOS: el del chat no
// guardaba agencia ni sede y dejaba la alerta de sede Shalom puesta, así que el
// pedido quedaba distinto según por dónde lo despacharas. Un formulario, dos
// puertas. Si se le agrega un campo, lo heredan las dos.
// Las clases son las mismas que ya usa pedidos.html (ahí el CSS ya existe; en
// la Bandeja y Probar lo pone injectDespachoCss).
const DESPACHO_CSS = `
  .overlay{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:18px}
  .modal{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:20px;width:100%;max-width:460px;max-height:90vh;overflow:auto}
  .modal h3{margin:0 0 4px;font-size:16.5px}
  .modal .m-sub{font-size:12.5px;color:var(--muted);margin-bottom:12px}
  .modal label{display:block;font-size:11.5px;color:var(--muted);margin:12px 0 5px;font-weight:700}
  .modal input,.modal select{width:100%;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;color:var(--text);height:38px;padding:0 11px;font-size:13.5px;outline:none;font-family:var(--font)}
  .modal input:focus,.modal select:focus{border-color:var(--brand)}
  .modal .m-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}
  .modal .m-foot button{height:38px;padding:0 16px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
  .modal .m-foot .cancel{background:transparent;border:1px solid var(--border);color:var(--text)}
  .modal .m-foot .save{background:var(--brand);border:none;color:#fff}
  .modal .row2{display:flex;gap:10px}.modal .row2>*{flex:1}
  /* Foto de la guía */
  .dsp-foto{display:flex;gap:10px;align-items:center;margin-top:6px}
  .dsp-foto img{width:56px;height:56px;object-fit:cover;border-radius:9px;border:1px solid var(--border);cursor:zoom-in}
  .dsp-foto .dsp-doc{width:56px;height:56px;border-radius:9px;border:1px solid var(--border);background:var(--surface-2);
    display:flex;align-items:center;justify-content:center;font-size:20px}
  .dsp-foto button{height:34px;padding:0 12px;border-radius:9px;border:1px solid var(--border);background:transparent;
    color:var(--text);font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit}
  /* Bloque "¿cómo le aviso?" */
  .avz{margin-top:16px;border-top:1px solid var(--border);padding-top:14px}
  .avz-win{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;padding:8px 11px;border-radius:10px;margin-bottom:10px}
  .avz-win.ok{background:var(--green-bg,rgba(16,185,129,.13));color:var(--green)}
  .avz-win.no{background:var(--amber-bg,rgba(245,158,11,.13));color:var(--amber)}
  .avz-fep{display:flex;align-items:center;gap:7px;font-size:11.5px;font-weight:700;padding:7px 11px;border-radius:10px;margin:-4px 0 10px;
    background:var(--green-bg,rgba(16,185,129,.13));color:var(--green);border:1px solid rgba(16,185,129,.35)}
  .avz-op{display:flex;gap:9px;align-items:flex-start;padding:9px 11px;border:1px solid var(--border);border-radius:11px;
    margin-bottom:7px;cursor:pointer}
  .avz-op.on{border-color:var(--brand);background:var(--brand-bg,rgba(43,127,255,.10))}
  .avz-op.off{opacity:.55}
  .avz-op input{margin-top:2px;flex:none;width:auto;height:auto}
  .avz-op b{display:block;font-size:13px;margin-bottom:2px}
  .avz-op span{color:var(--muted);font-size:11.5px;line-height:1.45;display:block}
  .avz-op select{margin-top:7px}
  /* Registrar despacho en lote */
  .modal.dl-modal{max-width:760px}
  .dl-tools{display:flex;gap:8px;margin-bottom:10px}
  .dl-tools button{height:34px;padding:0 12px;border-radius:9px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit}
  .dl-paste{margin-bottom:12px;display:none}
  .dl-paste.on{display:block}
  .dl-paste textarea{width:100%;min-height:64px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;color:var(--text);padding:8px 10px;font-size:12.5px;font-family:var(--font);resize:vertical}
  .dl-paste .dl-pfoot{display:flex;gap:8px;margin-top:7px}
  .dl-tblwrap{overflow-x:auto;border:1px solid var(--border);border-radius:12px}
  .dl-tbl{width:100%;border-collapse:collapse;min-width:600px}
  .dl-tbl th{font-size:10.5px;font-weight:800;letter-spacing:.3px;color:var(--muted);text-transform:uppercase;text-align:left;padding:9px 8px;border-bottom:1px solid var(--border);white-space:nowrap}
  .dl-tbl td{padding:5px 8px;border-bottom:1px solid var(--border);vertical-align:middle}
  .dl-tbl tbody tr:last-child td{border-bottom:none}
  .dl-tbl .dl-cli{font-size:12.5px;font-weight:600;white-space:nowrap}
  .dl-tbl .dl-cli span{font-weight:500;color:var(--muted);font-size:11px}
  .dl-tbl input{height:32px;font-size:12.5px;padding:0 8px;border-radius:8px}
  .dl-tbl tr.bad input[data-k="guia"],.dl-tbl tr.bad input[data-k="codigo"]{border-color:var(--amber);background:var(--amber-bg,rgba(245,158,11,.08))}
  .dl-foto{height:32px;min-width:38px;padding:0 9px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;font-size:14px;font-family:inherit;display:inline-flex;align-items:center;gap:5px}
  .dl-foto.has{border-color:var(--green);color:var(--green)}
  .dl-lote-ocr{display:flex;align-items:center;gap:6px}
  .dl-lote-ocr input{height:34px;width:150px;font-size:12.5px}
  .dl-lote-ocr button{height:34px;padding:0 12px;border-radius:9px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap}
  .dl-tbl .dl-chk{width:34px;text-align:center}
  .dl-tbl .dl-chk input{width:16px;height:16px;accent-color:var(--brand);cursor:pointer;padding:0}
  /* Paso 1: elegir cuáles despachar (lista bonita) */
  .modal.sel-modal{max-width:520px;padding:0;overflow:hidden;display:flex;flex-direction:column;max-height:88vh}
  .sel-head{display:flex;align-items:center;gap:12px;padding:18px 20px;border-bottom:1px solid var(--border)}
  .sel-ic{width:40px;height:40px;border-radius:12px;flex:none;display:flex;align-items:center;justify-content:center;background:var(--brand);color:#fff;font-size:20px}
  .sel-ttl{font-size:16px;font-weight:800}
  .sel-sub{font-size:12px;color:var(--muted);margin-top:2px}
  .sel-search-wrap{padding:12px 20px 2px}
  .sel-search{width:100%;height:38px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;color:var(--text);padding:0 12px;font-size:13.5px;outline:none;font-family:var(--font)}
  .sel-search:focus{border-color:var(--brand)}
  .sel-allbar{display:flex;align-items:center;justify-content:space-between;padding:10px 20px;border-bottom:1px solid var(--border)}
  .sel-allbar label{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;color:var(--muted);cursor:pointer;margin:0}
  .sel-allbar label input{width:16px;height:16px;accent-color:var(--brand);cursor:pointer}
  .sel-cnt{font-size:12px;font-weight:800;color:var(--brand)}
  .sel-list{overflow:auto;padding:10px 14px;flex:1 1 auto;min-height:0}
  .sel-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;margin-bottom:8px;cursor:pointer;transition:border-color .12s,background .12s}
  .sel-row:hover{border-color:var(--brand)}
  .sel-row.on{border-color:var(--brand);background:var(--brand-bg,rgba(43,127,255,.08))}
  .sel-check{width:22px;height:22px;border-radius:7px;border:2px solid var(--border);flex:none;display:flex;align-items:center;justify-content:center;color:transparent;font-size:13px;font-weight:800}
  .sel-row.on .sel-check{background:var(--brand);border-color:var(--brand);color:#fff}
  .sel-em{width:34px;height:34px;border-radius:9px;background:var(--surface-2);flex:none;display:flex;align-items:center;justify-content:center;font-size:17px}
  .sel-tx{flex:1;min-width:0}
  .sel-nm{font-weight:700;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sel-dest{font-size:11.5px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sel-mon{font-size:11px;color:var(--muted);text-align:right;white-space:nowrap;flex:none;line-height:1.5}
  .sel-mon b{color:var(--text);font-variant-numeric:tabular-nums}
  .sel-foot{display:flex;gap:8px;align-items:center;padding:14px 20px;border-top:1px solid var(--border)}
  .sel-foot .sel-hint{flex:1;font-size:12.5px;color:var(--muted);font-weight:600}
  .sel-foot button{height:40px;padding:0 20px;border-radius:11px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit}
  .sel-foot .cancel{background:transparent;border:1px solid var(--border);color:var(--text)}
  .sel-foot .save{background:var(--brand);border:none;color:#fff}
  .sel-foot .save:disabled{opacity:.45;cursor:default}
  /* Editar pedido (formulario por secciones, compartido Pedidos + ficha del chat) */
  .modal:has(.pedmodal){max-width:580px;padding:0;overflow:hidden}
  .pedmodal{display:flex;flex-direction:column;max-height:90vh}
  .pedmodal .pm-head{display:flex;align-items:center;gap:12px;padding:18px 20px;border-bottom:1px solid var(--border)}
  .pedmodal .pm-ic{width:40px;height:40px;border-radius:12px;flex:none;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--brand),var(--brand-2,var(--brand)));color:#fff}
  .pedmodal .pm-ic svg{width:20px;height:20px}
  .pedmodal .pm-ttl{font-size:16px;font-weight:800;line-height:1.2}
  .pedmodal .pm-sub{font-size:12px;color:var(--muted);margin-top:2px}
  .pedmodal .pm-zona{flex:none;display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:800;padding:6px 11px;border-radius:999px;white-space:nowrap}
  .pedmodal .pm-zona svg{width:14px;height:14px}
  .pedmodal .pm-zona.lima{background:var(--brand-bg,rgba(43,127,255,.13));color:var(--brand)}
  .pedmodal .pm-zona.prov{background:var(--amber-bg,rgba(245,158,11,.13));color:var(--amber)}
  .pedmodal .pm-body{padding:16px 20px;overflow:auto;flex:1 1 auto;min-height:0}
  .pedmodal .pm-sec{border:1px solid var(--border);border-radius:13px;padding:13px 14px;margin-top:14px;background:var(--surface-2)}
  .pedmodal .pm-sec:first-child{margin-top:0}
  .pedmodal .pm-sec-h{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:800;letter-spacing:.5px;color:var(--muted);text-transform:uppercase;margin-bottom:2px}
  .pedmodal .pm-sec-h svg{width:15px;height:15px;color:var(--brand)}
  .pedmodal label{display:block;font-size:11px;color:var(--muted);margin:11px 0 5px;font-weight:700}
  .pedmodal input,.pedmodal select{width:100%;background:var(--surface);border:1px solid var(--border);border-radius:10px;color:var(--text);height:40px;padding:0 12px;font-size:13.5px;outline:none;font-family:var(--font)}
  .pedmodal input:focus,.pedmodal select:focus{border-color:var(--brand)}
  .pedmodal .row2{display:flex;gap:10px}.pedmodal .row2>*{flex:1;min-width:0}
  .pedmodal .hint{font-size:11px;color:var(--faint,var(--muted));margin-top:6px;line-height:1.45}
  .pedmodal .meds{display:flex;gap:8px;flex-wrap:wrap}
  .pedmodal .meds .med{flex:1;min-width:70px}
  .pedmodal .meds .med span{display:block;font-size:10px;color:var(--faint,var(--muted));font-weight:700;margin-bottom:3px;text-transform:uppercase;letter-spacing:.3px}
  .pedmodal .pm-foot{display:flex;gap:8px;justify-content:flex-end;padding:14px 20px;border-top:1px solid var(--border)}
  .pedmodal .pm-foot button{height:40px;padding:0 20px;border-radius:11px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit}
  .pedmodal .pm-foot .cancel{background:transparent;border:1px solid var(--border);color:var(--text)}
  .pedmodal .pm-foot .save{background:var(--brand);border:none;color:#fff}
`;
let despachoCssInjected = false;
function injectDespachoCss() {
  // pedidos.html ya trae estas reglas en su <style>; volver a ponerlas sería
  // inofensivo (son idénticas) pero innecesario.
  if (despachoCssInjected || document.querySelector("[data-despacho-css]")) return;
  despachoCssInjected = true;
  document.head.insertAdjacentHTML("beforeend", `<style data-despacho-css>${DESPACHO_CSS}</style>`);
}

// ── Cómo avisarle al cliente ───────────────────────────────────────
// WhatsApp solo deja escribir libre dentro de las 24h desde el último mensaje
// del cliente. Un pedido físico se despacha DÍAS después, así que la ventana
// casi siempre está cerrada y el aviso normal lo rechaza Meta: te llegaba el
// error y el cliente no recibía nada. Por eso cada aviso se elige a mano, con
// el estado de la ventana a la vista.
// `momento` = "despachado" | "en_agencia" | "adelanto_validado" (la plantilla
// por defecto de cada uno se configura en Pagos y avisos).
export async function cargarAviso(supa, channelId, contactId, momento) {
  const info = { abierta: false, restante: "", fepActivo: false, fepRestante: "", tpls: [], preferida: null, flujo: null, flujoId: null, texto: "" };
  try {
    // Ventana de SERVICIO (24h desde el último mensaje del cliente): es la que habilita
    // mandar texto libre. NO se usa `conversations.expira_at`, que es la MAYOR entre esas
    // 24h y el FEP de 72h del anuncio: las 72h del FEP son sobre el COBRO, no sobre el
    // permiso — con las 24h cerradas solo entra una plantilla (que ahí sale gratis, y eso
    // es justo lo que informa el bloque de abajo). Tomando el máximo, este panel daba la
    // ventana por abierta durante el FEP y ofrecía mandar el aviso como mensaje libre:
    // Meta lo rechaza (131047) y el cliente se queda sin su aviso de despacho.
    const { data: ct24 } = await supa.from("contacts").select("ultimo_mensaje_cliente_at").eq("id", contactId).maybeSingle();
    const ult = ct24?.ultimo_mensaje_cliente_at ? new Date(ct24.ultimo_mensaje_cliente_at).getTime() : 0;
    const t = ult ? ult + 24 * 3600 * 1000 : 0;
    info.abierta = t > Date.now();
    if (info.abierta) {
      const m = Math.floor((t - Date.now()) / 60000);
      // La ventana de WhatsApp dura 24 h (72 h como mucho con FEP). Un `expira_at`
      // que dé MÁS que eso es un dato anómalo, no una ventana larguísima: se deja
      // "abierta" pero sin contador, en vez de escupir cifras imposibles como
      // "87583 h 34 min" (10 años), que solo hacen desconfiar del panel.
      info.restante = m > 72 * 60 ? "" : (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
    }
  } catch (_) { /* sin conversación aún */ }
  // FEP (Free Entry Point): si el cliente llegó por un anuncio hay 72h en las que la
  // PLANTILLA no se cobra (no da texto libre: para eso está la ventana de 24h de arriba).
  // Se muestra para que, al despachar fuera de esa ventana, se vea que avisarle no cuesta.
  //
  // Ojo con la letra chica: esa ventana la abre Meta cuando el NEGOCIO responde dentro de
  // las 24h siguientes al clic, no por el solo hecho de que el cliente escriba. Acá se marca
  // al recibir el mensaje, así que antes de decir "gratis" se comprueba que esa respuesta
  // exista: si nadie contestó y ya pasaron las 24h, la ventana nunca se abrió y la plantilla
  // SÍ se cobra. Prometer gratis ahí es hacerte gastar creyendo que no gastas.
  try {
    const { data: ct } = await supa.from("contacts").select("fep_hasta").eq("id", contactId).maybeSingle();
    const f = ct?.fep_hasta ? new Date(ct.fep_hasta).getTime() : 0;
    let abierto = f > Date.now();
    if (abierto) {
      const inicioFep = f - 72 * 3600 * 1000;
      const { count } = await supa.from("messages").select("id", { count: "exact", head: true })
        .eq("contact_id", contactId).eq("direction", "out")
        .gte("ts", new Date(inicioFep).toISOString())
        .lte("ts", new Date(inicioFep + 24 * 3600 * 1000).toISOString());
      abierto = (count ?? 0) > 0;
    }
    if (abierto) {
      info.fepActivo = true;
      const m = Math.floor((f - Date.now()) / 60000);
      // Mismo tope que la ventana: el FEP dura 72 h. Más que eso es dato anómalo.
      info.fepRestante = m > 72 * 60 ? "" : (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
    }
  } catch (_) { /* sin FEP */ }
  try {
    const { data } = await supa.from("wa_templates").select("name,language,estado_meta,activa,body_preview")
      .eq("channel_id", channelId).order("name");
    info.tpls = (data || []).filter((t) => t.activa !== false && (t.estado_meta ?? "aprobada") === "aprobada");
  } catch (_) { /* sin plantillas */ }
  try {
    const { data: ch } = await supa.from("channels").select("pedidos_config").eq("id", channelId).maybeSingle();
    const a = ch?.pedidos_config?.avisos?.[momento];
    if (a && a.template) info.preferida = a;
    if (a && a.texto) info.texto = String(a.texto);
  } catch (_) { /* sin config */ }
  // Si el negocio no escribió su mensaje en Pagos y avisos, todavía puede
  // haber un FLUJO viejo escuchando este estado. Se nombra para que se sepa qué
  // va a salir; y si no hay ni una cosa ni la otra, hay que decirlo ANTES de
  // guardar, no después.
  if (info.texto) return info;
  try {
    const { data: trigs } = await supa.from("flow_triggers")
      .select("flow_id, config, flows!inner(id,nombre,estado)")
      .eq("channel_id", channelId).eq("tipo", "pedido_estado").eq("activo", true);
    const t = (trigs || []).find((x) =>
      ((x.config?.estados) || []).map(String).includes(momento) && x.flows?.estado === "activo");
    if (t) { info.flujo = t.flows?.nombre || "Aviso"; info.flujoId = t.flow_id; }
  } catch (_) { /* sin disparadores */ }
  return info;
}

export function avisoBlockHtml(info) {
  const hayTpl = info.tpls.length > 0;
  const hayFlujo = !!info.flujo || !!info.texto;
  // Por defecto: lo que de verdad va a llegar. Ventana abierta CON aviso armado
  // → mensaje normal; si no, plantilla (si hay). Nunca proponemos algo que
  // sabemos que no va a llegar.
  const def = (info.abierta && hayFlujo) ? "mensaje" : (hayTpl ? "plantilla" : "ninguno");
  const sel = info.preferida?.template;
  const op = (v, titulo, desc, extra, off) => `
    <label class="avz-op ${v === def ? "on" : ""} ${off ? "off" : ""}" data-op="${v}">
      <input type="radio" name="avzmodo" value="${v}" ${v === def ? "checked" : ""}/>
      <div style="flex:1;min-width:0"><b>${titulo}</b><span>${desc}</span>${extra || ""}</div>
    </label>`;
  return `<div class="avz">
    <div class="avz-win ${info.abierta ? "ok" : "no"}">${info.abierta
      ? (info.restante
          ? `● Ventana abierta — le quedan ${esc(info.restante)} para escribirle libremente`
          : "● Ventana abierta — puedes escribirle libremente")
      : "● Ventana cerrada — WhatsApp solo acepta una plantilla aprobada"}</div>
    ${info.fepActivo ? `<div class="avz-fep">Llegó por anuncio${info.fepRestante ? ` — aún gratis por ${esc(info.fepRestante)}` : " — aún gratis"}: la plantilla no te cuesta</div>` : ""}
    <label style="margin:0 0 8px">¿Cómo le aviso?</label>
    ${op("mensaje",
      info.texto ? "Tu mensaje" : info.flujo ? `Tu aviso: “${esc(info.flujo)}”` : "Tu mensaje",
      !hayFlujo ? "Todavía no escribiste el mensaje de este momento, así que no se enviaría nada. Escríbelo en Pagos y avisos → Avisos de pedido."
        : !info.abierta ? "La ventana está cerrada: Meta lo va a rechazar y el cliente no recibirá nada."
        : info.texto ? `“${esc(info.texto.length > 120 ? info.texto.slice(0, 120) + "…" : info.texto)}”`
        : "Es el flujo que se dispara con este estado.",
      // Siempre a Pagos y avisos → Avisos de pedido (ahí se escribe/edita el
      // mensaje de cada momento; si escribes uno, manda ese y el flujo no dispara).
      `<a href="pagos.html" target="_blank" style="font-size:11.5px;color:var(--brand);text-decoration:none;display:inline-block;margin-top:5px">${info.texto ? "Editar este mensaje →" : info.flujo ? "Editarlo en Pagos y avisos →" : "Escribirlo ahora →"}</a>`,
      !info.abierta || !hayFlujo)}
    ${op("plantilla", "Una plantilla aprobada",
      hayTpl ? "Es lo único que WhatsApp acepta fuera de la ventana." : "No tienes plantillas aprobadas y activas — créalas en Plantillas.",
      hayTpl ? `<select data-avz="tpl">${info.tpls.map((t) =>
        `<option value="${esc(t.name)}|${esc(t.language || "es")}" ${sel === t.name ? "selected" : ""}>${esc(t.name)}${t.language ? " · " + esc(t.language) : ""}</option>`).join("")}</select>` : "",
      !hayTpl)}
    ${op("ninguno", "No avisarle", "Guardo el cambio en silencio; le escribes tú.")}
  </div>`;
}

// Lee la elección. Devuelve { modo, template? } listo para order-update.
export function avisoValor(root) {
  const m = root.querySelector('input[name="avzmodo"]:checked')?.value || "mensaje";
  if (m !== "plantilla") return { modo: m };
  const v = root.querySelector('[data-avz="tpl"]')?.value || "";
  const [name, language] = v.split("|");
  if (!name) return { modo: "ninguno" };
  return { modo: "plantilla", template: { name, language: language || "es" } };
}

function wireAviso(root) {
  root.querySelectorAll(".avz-op").forEach((el) => {
    el.onclick = (e) => {
      // El enlace "ver este aviso" vive DENTRO de la opción: al tocarlo no se
      // debe elegir esa opción de paso (vas a mirar el flujo, no a decidir).
      if (e.target.closest("a")) { e.stopPropagation(); return; }
      root.querySelectorAll(".avz-op").forEach((x) => x.classList.remove("on"));
      el.classList.add("on");
      el.querySelector("input").checked = true;
    };
  });
}

// Modal chico solo para elegir el aviso (lo usa "Avisar que llegó", que no
// tiene formulario propio). Devuelve el aviso, o null si canceló.
export async function pedirAviso(o, deps, momento, titulo, detalle) {
  const { supa, channelId, contactId } = deps;
  injectDespachoCss();
  const info = await cargarAviso(supa, channelId, contactId, momento);
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `<div class="modal">
      <h3>${esc(titulo)}</h3>
      <div class="m-sub">${esc(detalle)}</div>
      ${avisoBlockHtml(info)}
      <div class="m-foot"><button class="cancel">Cancelar</button><button class="save">Confirmar</button></div>
    </div>`;
    const cerrar = (v) => { ov.remove(); resolve(v); };
    ov.onclick = (e) => { if (e.target === ov) cerrar(null); };
    ov.querySelector(".cancel").onclick = () => cerrar(null);
    ov.querySelector(".save").onclick = () => cerrar(avisoValor(ov));
    document.body.appendChild(ov);
    wireAviso(ov);
  });
}

// Abre el formulario de despacho. `deps`:
//   updateOrder(body) -> respuesta de la Edge Function order-update (o null)
//   toast(msg, err?)
//   supa, channelId, contactId — para subir la foto, leer la ventana de 24h y
//     las plantillas aprobadas
//   sugerido: costo de envío a proponer (Pedidos lo saca del último flete a esa
//     misma ciudad; desde la ficha va null y se escribe a mano)
// Devuelve true si se guardó.
export async function openDespachoModal(o, deps) {
  const { updateOrder, toast, supa, channelId, contactId, sugerido = null } = deps;
  const s = o.shipping || {};
  injectDespachoCss();
  const info = await cargarAviso(supa, channelId, contactId || o.contact_id, "despachado");
  // La foto vive en shipping.guia_foto → el motor la publica sola como
  // {{pedido_guia_foto}} (buildContext vuelca TODO shipping a variables), así
  // que el aviso puede mandarla sin que haya que tocar el motor.
  let foto = s.guia_foto || "";
  let fotoKind = s.guia_foto_kind || "image";
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `<div class="modal">
      <h3>Registrar despacho</h3>
      <div class="m-sub">${esc((o.contact || {}).nombre || "")} — al guardar, el pedido pasa a <b>Despachado</b> y el bot puede enviarle la guía al cliente.</div>
      ${s.sede_por_confirmar ? `<div style="margin:0 0 12px;padding:8px 10px;border-radius:9px;border:1px solid var(--amber);background:var(--amber-bg,rgba(245,158,11,.13));color:var(--amber);font-size:12px;font-weight:600;line-height:1.4">${icon("alert")} La sede la capturó el bot y quedó por confirmar (${esc(s.sede_por_confirmar)}). Revisa que sea la oficina exacta antes de despachar.</div>` : ""}
      <div class="row2">
        <div><label>Agencia</label>
          <select data-d="agencia"><option value="shalom" ${s.agencia === "shalom" ? "selected" : ""}>Shalom</option><option value="olva" ${s.agencia === "olva" ? "selected" : ""}>Olva Courier</option><option value="otra" ${s.agencia && !["shalom", "olva"].includes(s.agencia) ? "selected" : ""}>Otra</option></select></div>
        <div><label>Sede / destino</label><input data-d="sede" value="${esc(s.sede || "")}" placeholder="Ej. Shalom Huancayo Centro"/></div>
      </div>
      <div class="row2">
        <div><label>N° de guía</label><input data-d="guia" value="${esc(s.guia || "")}" placeholder="Ej. 034-123456"/></div>
        <div><label>Código de envío</label><input data-d="codigo" value="${esc(s.codigo_envio || "")}" placeholder="Ej. SH-77120"/></div>
      </div>
      <label>Clave de recojo</label><input data-d="clave" value="${esc(s.clave_recojo || "")}" placeholder="La pones tú, el cliente la usa para recoger"/>
      <label>Costo del envío ${sugerido != null ? `<span style="font-weight:400;color:var(--faint)">· sugerido S/ ${esc(sugerido)}</span>` : ""}</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input data-d="flete" type="number" min="0" step="0.5" value="${s.flete ?? sugerido ?? ""}" placeholder="0.00" style="flex:1"/>
        <button type="button" data-d="flete0" class="cancel" style="height:38px;white-space:nowrap;border:1px solid var(--border);background:transparent;color:var(--text);border-radius:10px;padding:0 12px;font-weight:600;cursor:pointer">No pagué nada</button>
      </div>
      <div style="font-size:11px;color:var(--faint);margin-top:5px">Lo que te costó mandarlo (lo tienes en el recibo). Se usa para tu ganancia real; el cliente nunca lo ve.</div>
      <label>Foto de la guía <span style="font-weight:400;color:var(--faint)">· opcional</span></label>
      <div class="dsp-foto" data-d="fotobox"></div>
      <div style="font-size:11px;color:var(--faint);margin-top:5px">Se la puedes mandar al cliente en el aviso con <b>{{pedido_guia_foto}}</b>. Sirve de respaldo si reclama.</div>
      ${avisoBlockHtml(info)}
      <div class="m-foot"><button class="cancel">Cancelar</button><button class="save">Guardar</button></div>
    </div>`;
    const q = (k) => ov.querySelector(`[data-d="${k}"]`);
    const cerrar = (v) => { ov.remove(); resolve(v); };
    ov.onclick = (e) => { if (e.target === ov) cerrar(false); };
    // OJO: "No pagué nada" también usa class="cancel" (por estilo); el Cancelar
    // real es el del pie, hay que apuntarlo con .m-foot para no colgar el otro.
    ov.querySelector(".m-foot .cancel").onclick = () => cerrar(false);
    q("flete0").onclick = () => { q("flete").value = "0"; };

    // ── Foto de la guía ──
    const pintaFoto = () => {
      const box = q("fotobox");
      box.innerHTML = foto
        ? `${fotoKind === "image" ? `<img src="${esc(foto)}" data-ver/>` : `<div class="dsp-doc">${icon("file")}</div>`}
           <button type="button" data-f="cambiar">Cambiar</button><button type="button" data-f="quitar">Quitar</button>`
        : `<button type="button" data-f="subir">${icon("camera")} Subir foto o PDF de la guía</button>`;
      const sub = box.querySelector('[data-f="subir"]') || box.querySelector('[data-f="cambiar"]');
      if (sub) sub.onclick = elegirFoto;
      const qui = box.querySelector('[data-f="quitar"]');
      if (qui) qui.onclick = () => { foto = ""; pintaFoto(); };
      const ver = box.querySelector("[data-ver]");
      if (ver) ver.onclick = () => window.open(foto, "_blank");
    };
    const elegirFoto = () => {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/*,application/pdf";
      inp.onchange = async () => {
        const file = inp.files && inp.files[0]; if (!file) return;
        if (file.size > 16 * 1024 * 1024) { toast("Archivo muy grande (máx 16 MB)", true); return; }
        toast("Subiendo…");
        try {
          const dataURL = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
          const { data, error } = await supa.functions.invoke("media-upload", {
            body: { channel_id: channelId, filename: file.name, content_type: file.type, data: dataURL },
          });
          if (error || !data?.url) { toast("No se pudo subir el archivo", true); return; }
          foto = data.url; fotoKind = data.kind || (file.type.startsWith("image/") ? "image" : "document");
          pintaFoto(); toast("Foto lista");
        } catch (_) { toast("Error al subir", true); }
      };
      inp.click();
    };

    ov.querySelector(".save").onclick = async () => {
      const guia = q("guia").value.trim();
      const codigo = q("codigo").value.trim();
      if (!guia || !codigo) { toast("Shalom necesita el N° de guía Y el código de envío", true); return; }
      const flete = q("flete").value;
      const aviso = avisoValor(ov);
      const r = await updateOrder({ order_id: o.id, estado: "despachado", aviso, shipping: {
        agencia: q("agencia").value, sede: q("sede").value.trim(), guia, codigo_envio: codigo,
        clave_recojo: q("clave").value.trim(), sede_por_confirmar: null,
        guia_foto: foto || null, guia_foto_kind: foto ? fotoKind : null,
        ...(flete === "" || flete == null ? {} : { flete: Number(flete) || 0 }),
      } });
      if (!r) return; // el toast de error lo pone updateOrder
      toast(avisoMsg(r, aviso, "Despacho registrado"));
      cerrar(true);
    };
    document.body.appendChild(ov);
    wireAviso(ov);
    pintaFoto();
    q("guia").focus();
  });
}

// Editar pedido: TODOS los datos de entrega, con los desplegables reales (agencia
// de destino Shalom con sugerencia, distrito Eva, medida Shalom). ÚNICO para toda
// la app: lo abren el tablero de Pedidos y la ficha del chat. deps = { supa }.
// Devuelve true si guardó (el que llama recarga), false si canceló.
// Dos chips por chat: ¿la venta cuenta en el sistema? y ¿se envió a Meta? Se
// derivan del ESTADO del pedido + el evento CAPI del pedido. El de Meta puede
// traer un "reintentar" (data-capi-retry) para las que no llegaron a Meta.
const VM_CLOSED = new Set(["confirmada", "entregado_cobrado", "recogido", "saldo_pagado"]);
const VM_CANCEL = new Set(["cancelado", "anulado", "perdido", "no_recogido", "devuelto"]);
export function ventaChipsHtml(order, capiEvent) {
  const est = order ? String(order.estado || "") : null;
  const ctwa = !!(order && order.shipping && order.shipping.ctwa_clid);
  let sis;
  if (!order) sis = { lbl: "Sin venta", dot: "#9ca3af" };
  else if (VM_CLOSED.has(est)) sis = { lbl: "Contabilizada", dot: "#14b8a6" };
  else if (VM_CANCEL.has(est)) sis = { lbl: "Anulada", dot: "#9ca3af" };
  else sis = { lbl: "En proceso", dot: "#f59e0b" };
  let meta;
  if (!order || !ctwa) meta = { lbl: "Meta · no aplica", dot: "#9ca3af" };
  else if (!VM_CLOSED.has(est)) meta = { lbl: "Meta · aún no", dot: "#9ca3af" };
  else {
    const ce = capiEvent && capiEvent.estado;
    if (ce === "enviado") meta = { lbl: "Meta · enviado", dot: "#14b8a6" };
    else meta = { lbl: ce === "fallido" ? "Meta · error" : "Meta · falta config", dot: "#ef4444", retry: true };
  }
  // El chip de Meta es CLICKEABLE si la venta es de anuncio (ctwa) → abre el
  // detalle de qué se envió/enviaría a Meta (evento, valor, datos de match, respuesta).
  if (ctwa && order) meta.detalle = order.id;
  const chip = (c) => `<span ${c.detalle ? `data-meta-detalle="${c.detalle}" title="Ver el detalle de lo que se envía a Meta" ` : ""}style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;padding:3px 9px;border-radius:20px;border:1px solid var(--border);color:var(--muted);white-space:nowrap${c.detalle ? ";cursor:pointer" : ""}"><span style="width:7px;height:7px;border-radius:50%;background:${c.dot};flex:none"></span>${c.lbl}${c.detalle ? ` <span style="opacity:.6;font-size:10px">ⓘ</span>` : ""}${c.retry ? ` <button data-capi-retry="${order.id}" title="Reintentar el envío a Meta" style="border:none;background:none;color:#e24b4a;cursor:pointer;font-size:11.5px;padding:0 0 0 4px;text-decoration:underline">reintentar</button>` : ""}</span>`;
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px" data-venta-chips>${chip(sis)}${chip(meta)}</div>`;
}

// Detalle de lo que se envía / envió a Meta (Conversions API) para un pedido de
// anuncio. Muestra el evento, el valor, los datos de match (que van HASHEADOS),
// el estado y la respuesta cruda de Meta. Read-only + reintentar si no se envió.
export function openMetaDetalle(order, capiEvent, contact, deps) {
  const { supa, toast, channelId } = deps || {};
  injectVentaManualCss();
  const money = (n) => "S/ " + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  const ship = (order && order.shipping) || {};
  const bumps = Array.isArray(order && order.order_bumps) ? order.order_bumps : [];
  let val = Number(order && order.amount) || 0;
  for (const b of bumps) val += Number(b && b.precio) || 0;
  const est = capiEvent && capiEvent.estado;
  const cerrado = VM_CLOSED.has(String((order && order.estado) || ""));
  const head = est === "enviado" ? { lbl: "Enviado a Meta", dot: "#14b8a6" }
    : est === "fallido" ? { lbl: "Error al enviar", dot: "#ef4444" }
    : !cerrado ? { lbl: "Aún no se envía — se enviará al cerrar la venta", dot: "#f59e0b" }
    : { lbl: "Pendiente · falta cargar Pixel + token CAPI", dot: "#ef4444" };
  const tel = (contact && (contact.telefono || contact.wa_id)) || "";
  const nombre = ship.cliente || (contact && contact.nombre) || "";
  const ciudad = ship.ciudad || "";
  const ctwa = ship.ctwa_clid || "";
  const eventId = (capiEvent && capiEvent.event_id) || ("Purchase:" + (order && order.id));
  const actionSrc = (capiEvent && capiEvent.action_source) || "business_messaging";
  const mr = capiEvent && capiEvent.meta_response;
  let resp = ""; if (mr) { try { resp = typeof mr === "string" ? mr : JSON.stringify(mr, null, 2); } catch (_) { resp = String(mr); } }
  const dt = (capiEvent && (capiEvent.updated_at || capiEvent.created_at)) || null;
  const fecha = dt ? (() => { try { return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(dt)); } catch (_) { return String(dt); } })() : "—";

  const row = (k, v, ok) => `<div class="mdt-row"><span class="mdt-k">${esc(k)}</span><span class="mdt-v">${v ? esc(String(v)) : `<span style="color:var(--faint,#9ca3af)">—</span>`}${(ok && v) ? ` <span style="color:#14b8a6">${icon("check")}</span>` : ""}</span></div>`;

  return new Promise((resolve) => {
    const ov = document.createElement("div"); ov.className = "overlay vm-ov";
    ov.innerHTML = `<div class="vm-card" role="dialog" aria-label="Detalle de envío a Meta" style="max-width:480px">
      <div class="vm-head">
        <div class="vm-ico" style="background:color-mix(in srgb,#1877F2 16%,transparent);color:#1877F2">${icon("megaphone")}</div>
        <div class="vm-htx"><div class="vm-title">Envío a Meta</div><div class="vm-sub">Purchase · pedido de anuncio</div></div>
        <button class="vm-x" id="mdX" title="Cerrar">×</button>
      </div>
      <div class="vm-body">
        <div class="mdt-head"><span style="width:9px;height:9px;border-radius:50%;background:${head.dot};flex:none"></span><b>${esc(head.lbl)}</b></div>

        <div class="mdt-sec">
          <div class="mdt-t">Conversión</div>
          ${row("Evento", "Purchase")}
          ${row("Valor", money(val) + (bumps.length ? ` (producto + ${bumps.length} extra${bumps.length > 1 ? "s" : ""})` : ""))}
          ${row("Moneda", (order && order.currency) || "PEN")}
        </div>

        <div class="mdt-sec">
          <div class="mdt-t">Datos de match <span class="mdt-hint">(se envían cifrados / hasheados)</span></div>
          ${row("Teléfono", tel ? "•••" + String(tel).slice(-4) : "", !!tel)}
          ${row("Nombre", nombre, !!nombre)}
          ${row("Ciudad", ciudad, !!ciudad)}
          ${row("País", "PE", true)}
          ${row("Clic del anuncio (ctwa_clid)", ctwa ? String(ctwa).slice(0, 10) + "…" : "", !!ctwa)}
        </div>

        <div class="mdt-sec">
          <div class="mdt-t">Técnico</div>
          ${row("event_id", eventId)}
          ${row("action_source", actionSrc)}
          ${row("Último intento", fecha)}
        </div>

        ${resp ? `<div class="mdt-sec"><div class="mdt-t">Respuesta de Meta</div><pre class="mdt-pre">${esc(resp)}</pre></div>` : ""}
        <div class="vm-note"><span class="vm-note-ic">${icon("lock")}</span><span>Los datos personales (teléfono, nombre, ciudad) se <b>cifran</b> antes de salir; Meta solo los usa para emparejar la conversión. El <b>ctwa_clid</b> es el id del clic en tu anuncio.</span></div>
      </div>
      <div class="vm-foot">
        <div class="vm-total"><span>Valor</span><b>${money(val)}</b></div>
        <div class="vm-actions">
          ${est !== "enviado" && cerrado ? `<button class="vm-btn" id="mdRetry">Reintentar envío</button>` : ""}
          <button class="vm-btn primary" id="mdClose">Cerrar</button>
        </div>
      </div></div>`;
    document.body.appendChild(ov);
    const g = (s) => ov.querySelector(s);
    const close = (v) => { ov.remove(); resolve(v); };
    g("#mdX").onclick = () => close(false);
    g("#mdClose").onclick = () => close(false);
    ov.onclick = (e) => { if (e.target === ov) close(false); };
    const rb = g("#mdRetry");
    if (rb) rb.onclick = async () => {
      rb.disabled = true; const old = rb.textContent; rb.textContent = "enviando…";
      try {
        const { data, error } = await supa.functions.invoke("capi-retry", { body: { channel_id: channelId, order_id: order.id } });
        if (error || !data?.ok) { toast && toast("No se envió: " + (data?.error || error?.message || "error"), true); rb.disabled = false; rb.textContent = old; return; }
        toast && toast("Enviado a Meta"); close(true);
      } catch (e) { toast && toast("No se envió: " + (e?.message || e), true); rb.disabled = false; rb.textContent = old; }
    };
  });
}

// Registrar una venta a MANO (cerrada por fuera: llamada, número personal). Crea
// el pedido de cero contra ESTE contacto vía la Edge Function venta-manual, que
// congela la atribución del anuncio, entrega el link digital, mueve el embudo y
// dispara el Purchase a Meta si corresponde. Resuelve true si se registró.
export function openVentaManual(contact, deps) {
  const { supa, toast, channelId } = deps;
  return new Promise(async (resolve) => {
    injectVentaManualCss();
    const { data: prods } = await supa.from("products")
      .select("id, nombre, emoji, tipo, clase, config, product_versions(id, nombre, precio)")
      .eq("channel_id", channelId).order("nombre");
    const cat = (prods || []).filter((p) => p.clase !== "regalo" && (p.product_versions || []).length);
    if (!cat.length) { toast("No hay productos con precio para registrar una venta.", true); resolve(false); return; }
    // Atribución del contacto (para el aviso de Meta).
    let tieneAd = false;
    try { const { data: ci } = await supa.from("contacts").select("ctwa_clid, source").eq("id", contact.id).maybeSingle(); tieneAd = !!(ci && (ci.ctwa_clid || ci.source === "ctwa")); } catch (_) {}

    // Datos de entrega (solo venta FÍSICA): se PRE-COMPLETAN con lo que ya se
    // capturó del cliente — sus campos guardados y el último pedido — para no
    // re-tipear. `listas` alimenta los datalists de distrito (Eva) y agencia (Shalom).
    const hayFisico = cat.some((p) => p.tipo === "fisico");
    let listas = { shalom: {}, eva: {} };
    const pre = {}; // { nombre, tel, dni, direccion, distrito, ciudad, sede, referencia }
    if (hayFisico) {
      try { const L = await cargarListas(); listas = { shalom: (L && L.shalom) || {}, eva: (L && L.eva) || {} }; } catch (_) {}
      try {
        const { data: fv } = await supa.from("contact_field_values").select("value, field:custom_fields(key,nombre)").eq("contact_id", contact.id);
        for (const r of (fv || [])) {
          const v = r?.value; if (v == null || String(v).trim() === "") continue;
          const k = ((r.field?.key || "") + " " + (r.field?.nombre || "")).toLowerCase();
          if (/dni|documento|ruc/.test(k)) pre.dni ??= v;
          else if (/direcc/.test(k)) pre.direccion ??= v;
          // "zona_nombre" (nombre de la zona/distrito, ej. San Miguel) va a distrito,
          // NO al nombre del cliente — antes lo capturaba la rama de /nombre/ y ponía
          // la zona como si fuera el nombre de la persona.
          else if (/distrito|zona/.test(k)) pre.distrito ??= v;
          else if (/ciudad|departament|provincia|regi[oó]n/.test(k)) pre.ciudad ??= v;
          else if (/agencia|sede|shalom|oficina|destino/.test(k)) pre.sede ??= v;
          else if (/referen/.test(k)) pre.referencia ??= v;
          // Nombre REAL del cliente: campos de nombre de persona, excluyendo cosas que
          // contienen "nombre" pero no lo son (zona, negocio, producto, usuario).
          else if (/nombre|full|complet|cliente/.test(k) && !/zona|negocio|producto|usuario|empresa/.test(k)) pre.nombre ??= v;
          else if (/tel|celular|whatsapp|n[uú]mero|contacto/.test(k)) pre.tel ??= v;
        }
      } catch (_) {}
      try {
        const { data: lo } = await supa.from("orders").select("shipping").eq("contact_id", contact.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        const sh = (lo && lo.shipping) || {};
        pre.nombre ??= sh.cliente; pre.tel ??= sh.tel; pre.dni ??= sh.dni;
        pre.direccion ??= sh.direccion; pre.distrito ??= sh.distrito; pre.referencia ??= sh.referencia;
        pre.ciudad ??= sh.ciudad; pre.sede ??= (sh.destino || sh.sede);
      } catch (_) {}
    }
    pre.nombre ??= contact.nombre || ""; pre.tel ??= contact.wa_id || "";
    // Zona inicial: si hay pistas de provincia (agencia/DNI/ciudad ≠ Lima), arranca ahí.
    let zona = (pre.sede || pre.dni || (pre.ciudad && !/lima/i.test(String(pre.ciudad)))) ? "provincia" : "lima";

    const money = (n) => "S/ " + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
    const prodOpts = (sel) => cat.map((p) => `<option value="${p.id}"${p.id === sel ? " selected" : ""}>${esc((p.emoji ? p.emoji + " " : "") + p.nombre)} · ${p.tipo === "digital" ? "Digital" : "Físico"}</option>`).join("");
    const verOpts = (p, sel) => (p.product_versions || []).map((v) => `<option value="${v.id}" data-precio="${v.precio ?? 0}"${v.id === sel ? " selected" : ""}>${esc(v.nombre)} — ${money(v.precio)}</option>`).join("");

    // Estado del formulario (fuente de la verdad para el resumen en vivo).
    let estado = "confirmada"; // se ajusta según el tipo del principal
    const extras = []; // { id, productId, versionId, precio }
    let extraSeq = 0;

    const ov = document.createElement("div"); ov.className = "overlay vm-ov";
    ov.innerHTML = `<div class="vm-card" role="dialog" aria-label="Registrar venta a mano">
      <div class="vm-head">
        <div class="vm-ico">${icon("dollar")}</div>
        <div class="vm-htx">
          <div class="vm-title">Registrar venta a mano</div>
          <div class="vm-sub">${esc(contact.nombre || contact.wa_id || "Cliente")} · venta cerrada por fuera</div>
        </div>
        <button class="vm-x" id="vmX" title="Cerrar">×</button>
      </div>
      <div class="vm-body">
        <div class="vm-block">
          <div class="vm-lbl">¿Qué compró?</div>
          <select class="vm-sel" id="vmProd">${prodOpts()}</select>
          <div class="vm-row" style="margin-top:8px">
            <select class="vm-sel" id="vmVer" style="flex:2"></select>
            <div class="vm-money"><span class="vm-cur">S/</span><input class="vm-inp" id="vmMonto" type="number" min="0" step="0.5" inputmode="decimal"/></div>
          </div>
          <div id="vmGift" class="vm-gift" style="display:none"></div>
          <div id="vmAtrWrap" style="display:none;gap:8px;flex-wrap:wrap;margin-top:8px"></div>
        </div>

        <div class="vm-block">
          <div class="vm-lbl">Extras cobrados <span class="vm-hint">(opcional)</span></div>
          <div id="vmExtras" class="vm-extras"></div>
          <button type="button" class="vm-add" id="vmAddExtra">${icon("plus")} Agregar extra</button>
        </div>

        <div class="vm-block vm-ship" id="vmShip" style="display:none">
          <div class="vm-lbl">Datos de entrega</div>
          <div class="vm-seg" id="vmZona">
            <button type="button" class="vm-segb" data-z="lima">${icon("truck")} Lima · contraentrega</button>
            <button type="button" class="vm-segb" data-z="provincia">${icon("building")} Provincia · agencia</button>
          </div>
          <div class="vm-row" style="margin-top:8px">
            <input class="vm-inp" id="vmNom" placeholder="Nombre de quien recibe"/>
            <input class="vm-inp" id="vmTel" placeholder="Teléfono"/>
          </div>
          <div id="vmLima" style="margin-top:8px;flex-direction:column;gap:8px">
            <input class="vm-inp" id="vmDir" placeholder="Dirección"/>
            <div class="vm-row">
              <input class="vm-inp" id="vmDist" list="vmDlDist" placeholder="Distrito"/>
              <input class="vm-inp" id="vmRef" placeholder="Referencia (opcional)"/>
            </div>
            <datalist id="vmDlDist"></datalist>
          </div>
          <div id="vmProv" style="margin-top:8px;flex-direction:column;gap:8px">
            <div class="vm-row">
              <input class="vm-inp" id="vmDni" placeholder="DNI de quien recibe"/>
              <input class="vm-inp" id="vmCiudad" placeholder="Ciudad"/>
            </div>
            <input class="vm-inp" id="vmDest" list="vmDlDest" placeholder="Agencia de destino (Shalom)"/>
            <datalist id="vmDlDest"></datalist>
          </div>
          <div class="vm-shiphint">Se pre-llena con lo que ya diste del cliente. Después lo terminas de completar (guía, medidas, clave) en <b>Editar pedido</b>.</div>
        </div>

        <div class="vm-block">
          <div class="vm-lbl">Estado de la venta</div>
          <div class="vm-seg" id="vmSeg"></div>
          <div class="vm-kbhint" id="vmKbHint"></div>
        </div>

        <label class="vm-switch" id="vmEntWrap">
          <span>Enviarle el link/acceso al cliente ahora</span>
          <input type="checkbox" id="vmEnt" checked/><span class="vm-track"></span>
        </label>

        <div class="vm-note" id="vmNote"></div>
      </div>
      <div class="vm-foot">
        <div class="vm-total"><span>Total</span><b id="vmTotal">S/ 0.00</b></div>
        <div class="vm-actions">
          <button class="vm-btn" id="vmCancel">Cancelar</button>
          <button class="vm-btn primary" id="vmOk">Registrar venta</button>
        </div>
      </div></div>`;
    document.body.appendChild(ov);
    const g = (s) => ov.querySelector(s);
    const close = (val) => { ov.remove(); resolve(val); };

    const selProd = () => cat.find((x) => x.id === g("#vmProd").value) || cat[0];
    const prodById = (id) => cat.find((x) => x.id === id);

    function recomputeTotal() {
      let t = Number(g("#vmMonto").value) || 0;
      for (const ex of extras) t += Number(ex.precio) || 0;
      g("#vmTotal").textContent = money(t);
    }

    function renderExtras() {
      const box = g("#vmExtras");
      box.innerHTML = extras.map((ex) => {
        const p = prodById(ex.productId) || cat[0];
        return `<div class="vm-erow" data-id="${ex.id}">
          <select class="vm-sel vm-ep" data-id="${ex.id}">${prodOpts(ex.productId)}</select>
          <select class="vm-sel vm-ev" data-id="${ex.id}">${verOpts(p, ex.versionId)}</select>
          <div class="vm-money sm"><span class="vm-cur">S/</span><input class="vm-inp vm-eprice" data-id="${ex.id}" type="number" min="0" step="0.5" value="${ex.precio ?? 0}"/></div>
          <button type="button" class="vm-del" data-id="${ex.id}" title="Quitar">${icon("trash")}</button>
        </div>`;
      }).join("");
      box.querySelectorAll(".vm-ep").forEach((s) => s.onchange = () => {
        const ex = extras.find((e) => e.id === s.dataset.id); const p = prodById(s.value);
        ex.productId = s.value; ex.versionId = (p.product_versions[0] || {}).id; ex.precio = (p.product_versions[0] || {}).precio ?? 0;
        renderExtras(); recomputeTotal();
      });
      box.querySelectorAll(".vm-ev").forEach((s) => s.onchange = () => {
        const ex = extras.find((e) => e.id === s.dataset.id);
        ex.versionId = s.value; ex.precio = Number(s.selectedOptions[0]?.dataset.precio) || 0;
        const pr = box.querySelector(`.vm-eprice[data-id="${ex.id}"]`); if (pr) pr.value = ex.precio;
        recomputeTotal();
      });
      box.querySelectorAll(".vm-eprice").forEach((i) => i.oninput = () => {
        const ex = extras.find((e) => e.id === i.dataset.id); ex.precio = Number(i.value) || 0; recomputeTotal();
      });
      box.querySelectorAll(".vm-del").forEach((b) => b.onclick = () => {
        const idx = extras.findIndex((e) => e.id === b.dataset.id); if (idx >= 0) extras.splice(idx, 1);
        renderExtras(); recomputeTotal();
      });
    }

    function segOpts() {
      const tipo = selProd()?.tipo || "digital";
      if (tipo === "digital") return [{ v: "confirmada", l: "Vendido / entregado" }];
      // Por defecto (primera opción) = la plata AÚN no entra, que es lo normal al
      // cerrar por llamada. Solo marcas "cobrado/recogido" si YA te pagó.
      // Provincia da las dos etapas previas al recojo, cada una en su columna real
      // del Kanban (Lima usa `confirmado`, pero provincia NO tiene esa columna).
      if (zona === "provincia") return [
        { v: "esperando_adelanto", l: "Esperando adelanto" },        // aún no paga → col. "Esperando adelanto"
        { v: "por_despachar",      l: "Adelanto pagado · despachar" }, // ya dio adelanto → col. "Confirmado"
        { v: "recogido",           l: "Recogido y pagado" },          // cerrada → col. "Finalizados"
      ];
      return [
        { v: "confirmado",        l: "Por entregar" },        // → col. "Confirmado" del tablero de Lima
        { v: "entregado_cobrado", l: "Entregado y cobrado" }, // cerrada → col. "Finalizados"
      ];
    }
    // Cada estado cae en una columna concreta del Kanban de Pedidos. Este mapa
    // debe coincidir con KB_LIMA / KB_PROV de pedidos.html (si cambian las
    // columnas allá, actualízalo acá).
    function kbColumna(est) {
      const C = {
        // Lima
        confirmado: ["Lima", "Confirmado"], entregado_cobrado: ["Lima", "Finalizados"],
        // Provincia
        esperando_adelanto: ["Provincia", "Esperando adelanto"], por_despachar: ["Provincia", "Confirmado"],
        recogido: ["Provincia", "Finalizados"],
        // Digital (no tiene tablero de envío)
        confirmada: null,
      };
      return C[est];
    }
    function renderSeg() {
      const opts = segOpts();
      if (!opts.some((o) => o.v === estado)) estado = opts[0].v;
      g("#vmSeg").innerHTML = opts.map((o) => `<button type="button" class="vm-segb${o.v === estado ? " on" : ""}" data-v="${o.v}">${o.l}</button>`).join("");
      g("#vmSeg").querySelectorAll(".vm-segb").forEach((b) => b.onclick = () => { estado = b.dataset.v; renderSeg(); });
      // Referencia: a qué columna del Kanban entra el pedido con el estado elegido.
      const hint = g("#vmKbHint");
      if (hint) {
        const kb = kbColumna(estado);
        hint.innerHTML = kb
          ? `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="18" x="3" y="3" rx="1.5"/><rect width="7" height="11" x="14" y="3" rx="1.5"/></svg><span>Entra al Kanban en <b>${esc(kb[0])} · ${esc(kb[1])}</b></span>`
          : `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M2 12h20"/></svg><span>Entrega digital — se envía al toque, sin tablero de envío.</span>`;
      }
    }
    function renderZona() {
      g("#vmZona").querySelectorAll(".vm-segb").forEach((b) => b.classList.toggle("on", b.dataset.z === zona));
      g("#vmLima").style.display = zona === "lima" ? "flex" : "none";
      g("#vmProv").style.display = zona === "provincia" ? "flex" : "none";
    }

    function refreshGiftAndNote() {
      const p = selProd(); const tipo = p?.tipo || "digital";
      const regalos = Array.isArray(p?.config?.regalos) ? p.config.regalos : [];
      if (regalos.length) {
        g("#vmGift").style.display = "flex";
        g("#vmGift").innerHTML = `<span class="vm-gift-ic">${icon("gift")}</span><span>Incluye de regalo: <b>${regalos.map((r) => esc(r.nombre || "regalo")).join(", ")}</b> — se adjunta y entrega solo.</span>`;
      } else g("#vmGift").style.display = "none";
      g("#vmEntWrap").style.display = tipo === "digital" ? "flex" : "none";
      g("#vmNote").className = "vm-note " + (tieneAd ? "ad" : "");
      g("#vmNote").innerHTML = tieneAd
        ? `<span class="vm-note-ic">${icon("compass")}</span><span>Este cliente vino de un <b>anuncio de Meta</b>: la venta se atribuye al anuncio (se envía el Purchase si tienes el Pixel + token CAPI cargados).</span>`
        : `<span class="vm-note-ic">ℹ️</span><span>Este cliente <b>no tiene atribución de anuncio</b>: la venta cuenta en tus números, pero no se envía a Meta.</span>`;
    }

    function onProdChange() {
      const p = selProd();
      g("#vmVer").innerHTML = verOpts(p);
      g("#vmMonto").value = g("#vmVer").selectedOptions[0]?.dataset.precio || 0;
      g("#vmShip").style.display = (p?.tipo === "fisico") ? "flex" : "none";
      // Variante (talla/color) del principal: si el producto la tiene, se captura para
      // descontar el STOCK de la variante correcta y que salga en el rótulo/Excel del courier.
      // Sin esto la venta manual armaba una clave de stock VACÍA → no descontaba nada y no
      // avisaba (sobreventa silenciosa), y el que empaca despachaba sin la talla.
      const aw = g("#vmAtrWrap");
      if (aw) { const ejes = ejesDe(p?.id); aw.innerHTML = ejes.length ? varSelectsHtml(p?.id, {}, "vmatr-ppal") : ""; aw.style.display = ejes.length ? "flex" : "none"; }
      renderSeg(); refreshGiftAndNote(); recomputeTotal();
    }

    // Pre-llena los campos de entrega (una sola vez) + datalists + toggle de zona.
    if (hayFisico) {
      g("#vmNom").value = pre.nombre || ""; g("#vmTel").value = pre.tel || "";
      g("#vmDir").value = pre.direccion || ""; g("#vmDist").value = pre.distrito || ""; g("#vmRef").value = pre.referencia || "";
      g("#vmDni").value = pre.dni || ""; g("#vmCiudad").value = pre.ciudad || ""; g("#vmDest").value = pre.sede || "";
      g("#vmDlDist").innerHTML = ((listas.eva && listas.eva.distrito) || []).map((x) => `<option value="${esc(x)}"></option>`).join("");
      g("#vmDlDest").innerHTML = ((listas.shalom && listas.shalom.destino) || []).map((x) => `<option value="${esc(x)}"></option>`).join("");
      g("#vmZona").querySelectorAll(".vm-segb").forEach((b) => b.onclick = () => { zona = b.dataset.z; renderZona(); renderSeg(); });
      renderZona();
    }

    g("#vmProd").onchange = onProdChange;
    g("#vmVer").onchange = () => { g("#vmMonto").value = g("#vmVer").selectedOptions[0]?.dataset.precio || 0; recomputeTotal(); };
    g("#vmMonto").oninput = recomputeTotal;
    g("#vmAddExtra").onclick = () => {
      const p = cat[0]; const v = p.product_versions[0] || {};
      extras.push({ id: "ex" + (++extraSeq), productId: p.id, versionId: v.id, precio: v.precio ?? 0 });
      renderExtras(); recomputeTotal();
    };
    onProdChange();
    renderExtras();

    g("#vmCancel").onclick = () => close(false);
    g("#vmX").onclick = () => close(false);
    ov.onclick = (e) => { if (e.target === ov) close(false); };
    g("#vmOk").onclick = async () => {
      // El monto DEBE ser > 0: registrar una venta en S/0 la cuenta como cerrada (Dashboard/
      // KPIs), entrega el digital gratis y dispara un Purchase(0) a Meta que ensucia el ROAS.
      const monto = Number(g("#vmMonto").value) || 0;
      if (monto <= 0) { toast("Ponle el monto de la venta (mayor a 0).", true); const mi = g("#vmMonto"); if (mi) mi.focus(); return; }
      const btn = g("#vmOk"); btn.disabled = true; const old = btn.textContent; btn.textContent = "Registrando…";
      const t = (id) => (g(id)?.value || "").trim();
      const fisico = (selProd()?.tipo) === "fisico";
      const envio = !fisico ? null : (zona === "lima"
        ? { zona: "lima", cliente: t("#vmNom"), tel: t("#vmTel"), direccion: t("#vmDir"), distrito: t("#vmDist"), referencia: t("#vmRef") }
        : { zona: "provincia", cliente: t("#vmNom"), tel: t("#vmTel"), dni: t("#vmDni"), ciudad: t("#vmCiudad"), destino: t("#vmDest") });
      // Variante (talla/color) del principal → atributos: crearVentaManual los vuelca a
      // shipping.atributos y así stockKeyEngine arma la clave correcta y descuenta el stock.
      const atributos = {};
      ov.querySelectorAll(".vmatr-ppal").forEach((sl) => { const v = (sl.value || "").trim(); if (v) atributos[sl.dataset.eje] = v; });
      const body = {
        channel_id: channelId, contact_id: contact.id,
        product_id: g("#vmProd").value, version_id: g("#vmVer").value,
        atributos: Object.keys(atributos).length ? atributos : null,
        amount: monto, estado, entregar: g("#vmEnt").checked, envio,
        extras: extras.filter((e) => e.productId && e.versionId).map((e) => {
          const p = prodById(e.productId), v = (p?.product_versions || []).find((x) => x.id === e.versionId);
          return { productId: e.productId, versionId: e.versionId, nombre: (p?.emoji ? p.emoji + " " : "") + (p?.nombre || "extra") + (v && v.nombre && v.nombre !== "Única" ? " · " + v.nombre : ""), precio: Number(e.precio) || 0, digital: (p?.tipo || "digital") !== "fisico" };
        }),
      };
      let data, error;
      try { ({ data, error } = await supa.functions.invoke("venta-manual", { body })); } catch (e) { error = e; }
      if (error || !data?.ok) { toast("No se pudo: " + (data?.error || error?.message || "error"), true); btn.disabled = false; btn.textContent = old; return; }
      toast("Venta registrada"); close(true);
    };
  });
}

// CSS del modal de venta a mano (inyectado una sola vez). Usa las variables del
// panel para respetar claro/oscuro.
function injectVentaManualCss() {
  if (document.getElementById("vm-css")) return;
  const s = document.createElement("style"); s.id = "vm-css";
  s.textContent = `
  .vm-ov{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px}
  .vm-card{background:var(--card,#fff);color:var(--text,#111);width:min(540px,94vw);max-height:90vh;display:flex;flex-direction:column;border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.28);overflow:hidden;border:1px solid var(--border,#e5e7eb)}
  .vm-head{display:flex;align-items:center;gap:12px;padding:18px 20px;border-bottom:1px solid var(--border,#e5e7eb)}
  .vm-ico{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--brand,#2b7fff) 16%,transparent);color:var(--brand,#2b7fff);flex:none}
  .vm-ico svg{width:20px;height:20px}
  .vm-htx{flex:1;min-width:0}
  .vm-title{font-weight:750;font-size:16px;letter-spacing:-.01em}
  .vm-sub{font-size:12px;color:var(--muted,#6b7280);margin-top:1px}
  .vm-x{border:none;background:none;color:var(--muted,#6b7280);font-size:20px;line-height:1;cursor:pointer;padding:4px;border-radius:8px;flex:none}
  .vm-x:hover{background:var(--hover,rgba(0,0,0,.05))}
  .vm-x svg{width:16px;height:16px}
  .vm-body{padding:16px 20px;overflow:auto;display:flex;flex-direction:column;gap:16px}
  .vm-block{display:flex;flex-direction:column}
  .vm-lbl{font-size:12px;font-weight:700;color:var(--muted,#6b7280);text-transform:uppercase;letter-spacing:.03em;margin-bottom:8px}
  .vm-hint{font-weight:500;text-transform:none;letter-spacing:0;color:var(--faint,#9ca3af)}
  .vm-row{display:flex;gap:8px;align-items:center}
  .vm-sel,.vm-inp{width:100%;padding:10px 12px;border:1px solid var(--border,#e5e7eb);border-radius:10px;background:var(--bg,#fff);color:var(--text,#111);font-size:13.5px;font-family:inherit;outline:none}
  .vm-sel:focus,.vm-inp:focus{border-color:var(--brand,#2b7fff);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand,#2b7fff) 18%,transparent)}
  .vm-money{display:flex;align-items:center;gap:0;border:1px solid var(--border,#e5e7eb);border-radius:10px;background:var(--bg,#fff);padding-left:10px;flex:1;min-width:110px}
  .vm-money.sm{min-width:96px;max-width:120px}
  .vm-money .vm-cur{font-size:12.5px;color:var(--muted,#6b7280);font-weight:600}
  .vm-money .vm-inp{border:none;box-shadow:none;padding-left:6px;background:transparent}
  .vm-gift{display:flex;align-items:center;gap:8px;margin-top:10px;padding:9px 11px;border-radius:10px;font-size:12.5px;line-height:1.4;background:color-mix(in srgb,#1D9E75 12%,transparent);color:var(--text,#111);border:1px solid color-mix(in srgb,#1D9E75 30%,transparent)}
  .vm-gift-ic{font-size:15px;flex:none}
  .vm-extras{display:flex;flex-direction:column;gap:8px}
  .vm-extras:empty{display:none}
  .vm-erow{display:flex;align-items:center;gap:6px;padding:8px;border:1px solid var(--border,#e5e7eb);border-radius:12px;background:var(--bg,#fff)}
  .vm-erow .vm-ep{flex:1.4;min-width:0}.vm-erow .vm-ev{flex:1;min-width:0}
  .vm-del{border:none;background:none;color:var(--muted,#6b7280);cursor:pointer;padding:6px;border-radius:8px;flex:none;display:flex}
  .vm-del:hover{background:color-mix(in srgb,#ef4444 14%,transparent);color:#ef4444}
  .vm-del svg{width:15px;height:15px}
  .vm-add{margin-top:8px;border:1px dashed var(--border,#cbd5e1);background:none;color:var(--brand,#2b7fff);border-radius:10px;padding:9px;font-size:12.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;font-family:inherit}
  .vm-add:hover{background:color-mix(in srgb,var(--brand,#2b7fff) 8%,transparent);border-color:var(--brand,#2b7fff)}
  .vm-add svg{width:14px;height:14px}
  .vm-ship .vm-row .vm-inp{flex:1;min-width:0}
  .vm-ship .vm-seg{margin-bottom:2px}
  .vm-shiphint{font-size:11px;color:var(--faint,#9ca3af);line-height:1.5;margin-top:8px}
  .vm-seg{display:flex;gap:6px;background:var(--bg,#f3f4f6);padding:4px;border-radius:11px;border:1px solid var(--border,#e5e7eb)}
  .vm-segb{flex:1;border:none;background:none;color:var(--muted,#6b7280);padding:8px 10px;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:background .12s}
  .vm-segb.on{background:var(--card,#fff);color:var(--text,#111);box-shadow:0 1px 3px rgba(0,0,0,.12)}
  .vm-switch{display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;font-size:13px;font-weight:500;color:var(--text,#111)}
  .vm-switch input{position:absolute;opacity:0;pointer-events:none}
  .vm-track{width:40px;height:23px;border-radius:20px;background:var(--border,#cbd5e1);position:relative;flex:none;transition:background .15s}
  .vm-track::after{content:"";position:absolute;top:2px;left:2px;width:19px;height:19px;border-radius:50%;background:#fff;transition:transform .15s;box-shadow:0 1px 2px rgba(0,0,0,.3)}
  .vm-switch input:checked + .vm-track{background:var(--brand,#2b7fff)}
  .vm-switch input:checked + .vm-track::after{transform:translateX(17px)}
  .mdt-head{display:flex;align-items:center;gap:8px;font-size:13.5px}
  .mdt-sec{display:flex;flex-direction:column;gap:1px}
  .mdt-t{font-size:11px;font-weight:700;color:var(--muted,#6b7280);text-transform:uppercase;letter-spacing:.03em;margin-bottom:5px}
  .mdt-hint{font-weight:500;text-transform:none;letter-spacing:0;color:var(--faint,#9ca3af)}
  .mdt-row{display:flex;justify-content:space-between;gap:12px;font-size:12.5px;padding:4px 0;border-bottom:1px solid color-mix(in srgb,var(--border,#e5e7eb) 55%,transparent)}
  .mdt-k{color:var(--muted,#6b7280);flex:none}
  .mdt-v{color:var(--text,#111);text-align:right;word-break:break-word}
  .mdt-pre{background:var(--bg,#f6f6f6);border:1px solid var(--border,#e5e7eb);border-radius:8px;padding:8px 10px;font-size:11px;line-height:1.45;overflow:auto;max-height:170px;white-space:pre-wrap;word-break:break-word;margin:0;color:var(--text,#111)}
  .vm-kbhint{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:11.5px;font-weight:600;color:var(--muted,#6b7280)}
  .vm-kbhint svg{flex:none;opacity:.75}
  .vm-kbhint b{color:var(--text,#111827);font-weight:700}
  .vm-note{display:flex;gap:8px;font-size:11.5px;line-height:1.5;color:var(--muted,#6b7280);background:var(--bg,#f9fafb);border:1px solid var(--border,#e5e7eb);border-radius:10px;padding:10px 11px}
  .vm-note.ad{background:color-mix(in srgb,var(--brand,#2b7fff) 8%,transparent);border-color:color-mix(in srgb,var(--brand,#2b7fff) 26%,transparent)}
  .vm-note-ic{flex:none;font-size:13px}
  .vm-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-top:1px solid var(--border,#e5e7eb);background:var(--bg,#fafafa)}
  .vm-total{display:flex;flex-direction:column;line-height:1.1}
  .vm-total span{font-size:11px;color:var(--muted,#6b7280);text-transform:uppercase;letter-spacing:.04em;font-weight:600}
  .vm-total b{font-size:19px;font-weight:750;color:var(--text,#111);letter-spacing:-.01em}
  .vm-actions{display:flex;gap:8px}
  .vm-btn{border:1px solid var(--border,#e5e7eb);background:var(--card,#fff);color:var(--text,#111);border-radius:10px;padding:10px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
  .vm-btn:hover{background:var(--hover,rgba(0,0,0,.04))}
  .vm-btn.primary{background:var(--brand,#2b7fff);border-color:var(--brand,#2b7fff);color:#fff}
  .vm-btn.primary:hover{filter:brightness(1.06)}
  .vm-btn:disabled{opacity:.6;cursor:default}
  @media (max-width:520px){.vm-row{flex-wrap:wrap}.vm-money{min-width:100%}.vm-erow{flex-wrap:wrap}}
  `;
  document.head.appendChild(s);
}

export async function openEditarPedido(o, deps) {
  const { supa } = deps;
  injectDespachoCss();
  const s = o.shipping || {}, c = o.contact || {}, p = o.product || {}, v = o.version || {};
  const zona = s.zona || O.zonaDe(o);
  const L = await cargarListas();
  const SH = (L && L.shalom) || {}, EV = (L && L.eva) || {};
  const dl = (arr) => (arr || []).map((x) => `<option value="${esc(x)}"></option>`).join("");
  const optMerc = (arr, val) => `<option value="">— usar la del negocio —</option>` + (arr || []).map((x) => `<option value="${esc(x)}"${String(x) === String(val) ? " selected" : ""}>${esc(x)}</option>`).join("");
  const atr = Object.entries(s.atributos || {}).map(([k, val]) => `${k}: ${val}`).join(" · ");
  const sug = (zona === "provincia" && !s.destino) ? sugerirAgencia(s.sede || s.ciudad, SH.destino) : "";
  const destVal = s.destino || sug || s.sede || "";
  const zonaBadge = zona === "digital"
    ? `<span class="pm-zona lima">${icon("dollar")} Digital</span>`
    : zona === "provincia"
    ? `<span class="pm-zona prov">${icon("building")} Provincia · agencia</span>`
    : `<span class="pm-zona lima">${icon("truck")} Lima · contraentrega</span>`;

  // Estado del pedido FÍSICO editable desde acá (antes solo en el Kanban): para
  // un usuario nuevo era confuso tener que ir a otro lado a cerrar la venta. Al
  // cambiarlo, order-update dispara lo de siempre (Meta si es cierre real, embudo,
  // stock si se cae). NO le manda mensaje al cliente (aviso "ninguno" en el save).
  const estadoOpts = zona === "provincia"
    ? [["esperando_adelanto", "Esperando adelanto (dio datos, no pagó)"], ["adelanto_validado", "Adelanto validado"], ["despachado", "Despachado"], ["en_agencia", "En agencia"], ["recogido", "Recogido y pagado (venta cerrada)"], ["saldo_pagado", "Saldo pagado (venta cerrada)"], ["no_recogido", "No recogido"], ["cancelado", "Cancelado"]]
    : [["confirmado", "Confirmado · por entregar"], ["en_reparto", "En reparto"], ["entregado_cobrado", "Entregado y cobrado (venta cerrada)"], ["reprogramado", "Reprogramado"], ["rechazado", "Rechazado"], ["cancelado", "Cancelado"]];
  const curEnLista = estadoOpts.some(([v]) => v === o.estado);
  const estadoFisicoHtml = zona === "digital" ? "" : `
        <div class="pm-sec">
          <div class="pm-sec-h">${icon("flag")} Estado del pedido</div>
          <select id="eEstadoF">
            ${(!curEnLista && o.estado) ? `<option value="${esc(o.estado)}" selected>${esc(O.label ? O.label(o.estado) : o.estado)}</option>` : ""}
            ${estadoOpts.map(([v, l]) => `<option value="${v}"${v === o.estado ? " selected" : ""}>${esc(l)}</option>`).join("")}
          </select>
          <div class="hint">Muévelo según avance la venta. Si te <b>pagó o recogió por fuera</b> (llamada, otro medio), márcalo como <b>cobrado/recogido</b>: cuenta en tus números y —si vino de anuncio— va a Meta. No le manda mensaje al cliente.</div>
        </div>`;

  // Catálogo del canal → permite CAMBIAR el producto del pedido y AGREGAR
  // extras/regalos a mano. channel_id/version_id no vienen en latestOrder: se leen.
  let channelId = o.channel_id || null, versionId = o.version_id || null;
  try {
    const { data: od } = await supa.from("orders").select("channel_id, version_id").eq("id", o.id).maybeSingle();
    if (od) { channelId = od.channel_id; if (versionId == null) versionId = od.version_id; }
  } catch (_) { /* usa lo que haya */ }
  let catalogo = [];
  if (channelId) {
    try {
      const { data: prods } = await supa.from("products")
        .select("id, nombre, emoji, tipo, config, product_versions(id, nombre, precio)")
        .eq("channel_id", channelId).order("nombre");
      catalogo = Array.isArray(prods) ? prods : [];
    } catch (_) { /* sin catálogo → no se ofrece cambiar de producto */ }
  }
  // Ejes de variante (talla/color…) de un producto del catálogo.
  const ejesDe = (pid) => {
    const pr = catalogo.find((x) => String(x.id) === String(pid));
    const atrs = (pr && pr.config && Array.isArray(pr.config.atributos)) ? pr.config.atributos : [];
    return atrs.map((a) => ({ nombre: a.nombre, vals: Array.isArray(a.valores) ? a.valores : String(a.valores || "").split(",").map((s) => s.trim()).filter(Boolean) }))
      .filter((a) => a.nombre && a.vals.length);
  };
  // stock_key "Talla=m|Color=rojo" → { Talla:"m", Color:"rojo" } (valores en minúscula).
  const parseKey = (key) => { const o = {}; String(key || "").split("|").forEach((p) => { const i = p.indexOf("="); if (i > 0) o[p.slice(0, i)] = p.slice(i + 1); }); return o; };
  // Selects de variante para un producto: clase `cls` para recolectarlos, valores
  // actuales `sel` ({Eje:valor}) preseleccionados por coincidencia sin distinguir may/min.
  const varSelectsHtml = (pid, sel, cls) => ejesDe(pid).map((a) =>
    `<select class="${cls}" data-eje="${esc(a.nombre)}" style="min-width:82px;font-size:12px"><option value="">${esc(a.nombre)}…</option>${a.vals.map((val) => `<option${String((sel || {})[a.nombre] || "").toLowerCase() === String(val).toLowerCase() ? " selected" : ""}>${esc(val)}</option>`).join("")}</select>`).join("");
  // Variante del producto PRINCIPAL (talla/color) → shipping.atributos. Se re-renderiza
  // si se cambia el producto. Cambiarla ahora SÍ ajusta el stock (reconciliación).
  const atrHtml = `
        <div class="pm-sec" id="eAtrSec" ${ejesDe(o.product_id).length ? "" : 'style="display:none"'}>
          <div class="pm-sec-h">${icon("box")} Variante del producto</div>
          <div id="eAtrWrap" style="display:flex;gap:8px;flex-wrap:wrap">${varSelectsHtml(o.product_id, s.atributos || {}, "eatr-ppal")}</div>
          <div class="hint">Corrige la talla/color: ahora ajusta el stock (devuelve la vieja, descuenta la nueva).</div>
        </div>`;
  const versionsFor = (pid) => { const pr = catalogo.find((x) => String(x.id) === String(pid)); return (pr && Array.isArray(pr.product_versions)) ? pr.product_versions : []; };
  const precioVer = (pid, vid) => { const vv = versionsFor(pid).find((x) => String(x.id) === String(vid)); return vv && vv.precio != null && vv.precio !== "" ? Number(vv.precio) : null; };
  const verOpts = (pid, selVid) => `<option value="">— sin presentación —</option>` + versionsFor(pid).map((vv) => `<option value="${esc(vv.id)}"${String(vv.id) === String(selVid) ? " selected" : ""}>${esc(vv.nombre || "Única")}${vv.precio != null && vv.precio !== "" ? ` · S/ ${esc(vv.precio)}` : ""}</option>`).join("");
  const prodHtml = catalogo.length ? `
        <div class="pm-sec">
          <div class="pm-sec-h">${icon("box")} Producto del pedido</div>
          <div class="row2">
            <div><label>Producto</label><select id="eProd">${catalogo.map((pr) => `<option value="${esc(pr.id)}"${String(pr.id) === String(o.product_id) ? " selected" : ""}>${esc([pr.emoji, pr.nombre].filter(Boolean).join(" "))}</option>`).join("")}</select></div>
            <div><label>Presentación</label><select id="eVer">${verOpts(o.product_id, versionId)}</select></div>
          </div>
          <label style="margin-top:10px">Costo del producto (S/) <span style="color:var(--faint,var(--muted));font-weight:400">(la mercadería; el cliente no lo ve · vacío = usa el del producto)</span></label><input id="eCostoProd" type="number" step="0.1" value="${esc(s.costo_producto ?? "")}" placeholder="usa el costo del producto"/>
          <div class="hint">Cambiar el producto o la presentación recalcula el <b>precio base</b> (edítalo abajo si hace falta) y <b>ajusta el stock</b>. El <b>costo del producto</b> se descuenta de tu ganancia real. El saldo lo ajustas a mano.</div>
        </div>` : "";

  // Ventas extra y regalos (order_bumps): quitar/corregir los existentes + AGREGAR nuevos a mano.
  const bumps0 = Array.isArray(o.order_bumps) ? o.order_bumps.map((b) => ({ ...b })) : [];
  // Para recalcular el saldo al vuelo: saldo actual guardado + cuánto sumaban los
  // extras al abrir. El saldo nuevo = base + (extras de ahora − extras de antes),
  // así el envío/precio base quedan intactos y solo se mueve lo que cambió.
  const sumaBumpsVieja = bumps0.reduce((a, b) => a + Number(b.precio || 0), 0);
  const saldoBase = Number(s.saldo || 0);
  const bumpRow = (b, i) => {
    const esRegalo = b.regalo === true || Number(b.precio || 0) === 0;
    const nom = String(b.nombre || (esRegalo ? "Regalo" : "Extra")).replace(/\s*—\s*S\/\s*[\d.,]+\s*$/i, "").replace(/\s*\((?:extra|regalo)\)\s*/ig, " ").trim();
    // Si el producto del bump tiene variantes, muestra sus selects (preseleccionados
    // desde su stock_key) para poder corregir la talla/color y reajustar el stock.
    const varSel = (b.product_id && !b.stock_pendiente) ? varSelectsHtml(b.product_id, parseKey(b.stock_key), "ebx-var") : "";
    return `<div class="eb-row" data-idx="${i}" style="display:flex;align-items:center;gap:8px;margin-bottom:7px;flex-wrap:wrap">
      <span>${esRegalo ? icon("gift") : icon("plus")}</span>
      <span style="flex:1;min-width:0;font-size:13px">${esc(nom)}${esRegalo ? ` <span style="color:var(--green)">Gratis</span>` : ""}</span>
      ${esRegalo ? "" : `<span style="font-size:12px;color:var(--muted)">S/</span><input class="eb-precio" type="number" step="0.1" value="${esc(b.precio ?? "")}" style="width:72px"/>`}
      <button type="button" class="eb-del" title="Quitar del pedido" style="border:0;background:transparent;color:var(--red,#dc2626);cursor:pointer;line-height:1">${icon("x")}</button>
      ${varSel ? `<div class="ebx-vars" style="flex-basis:100%;display:flex;gap:6px;flex-wrap:wrap;padding-left:24px">${varSel}</div>` : ""}
    </div>`;
  };
  // <option>s del catálogo para las filas nuevas (autocompletan nombre + precio).
  const bumpProdOpts = `<option value="">— escribir a mano —</option>` + catalogo.map((pr) => {
    const vs = Array.isArray(pr.product_versions) ? pr.product_versions : [];
    const precio = vs.length && vs[0].precio != null ? vs[0].precio : "";
    return `<option value="${esc(pr.id)}" data-nom="${esc(pr.nombre || "")}" data-precio="${esc(precio)}">${esc([pr.emoji, pr.nombre].filter(Boolean).join(" "))}</option>`;
  }).join("");
  const bumpNewRowHtml = `<div class="eb-new" style="display:flex;align-items:center;gap:6px;margin-bottom:7px;flex-wrap:wrap">
      <select class="ebn-prod" style="flex:1;min-width:130px">${bumpProdOpts}</select>
      <input class="ebn-nom" placeholder="Nombre" style="flex:1;min-width:100px"/>
      <span style="font-size:12px;color:var(--muted)">S/</span><input class="ebn-precio" type="number" step="0.1" placeholder="0" style="width:60px"/>
      <label style="display:flex;align-items:center;gap:3px;font-size:12px;white-space:nowrap"><input type="checkbox" class="ebn-regalo"/> Regalo</label>
      <button type="button" class="ebn-del" title="Quitar" style="border:0;background:transparent;color:var(--red,#dc2626);cursor:pointer;line-height:1">${icon("x")}</button>
      <div class="ebn-vars" style="flex-basis:100%;display:flex;gap:6px;flex-wrap:wrap;padding-left:2px"></div>
    </div>`;
  const bumpHtml = `
        <div class="pm-sec">
          <div class="pm-sec-h">${icon("plus")} Ventas extra y regalos</div>
          <div id="eBumps">${bumps0.map((b, i) => bumpRow(b, i)).join("")}</div>
          <div id="eBumpsNew"></div>
          <button type="button" id="eAddBump" style="margin-top:2px;border:1px dashed var(--line,#d0d0d0);background:transparent;color:var(--accent,#2563eb);border-radius:8px;padding:6px 10px;cursor:pointer;font-size:13px">＋ Agregar extra o regalo</button>
          <div class="hint">Agrega un extra/regalo a mano, quita (×) uno puesto por error o corrige su precio. El <b>saldo se recalcula solo</b>; si el extra es un producto del catálogo con talla/color, elige la variante y el <b>stock se ajusta</b>.</div>
        </div>`;

  return new Promise((resolve) => {
    const ov = document.createElement("div"); ov.className = "overlay";
    ov.innerHTML = `<div class="modal"><div class="pedmodal">
      <div class="pm-head">
        <div class="pm-ic">${icon("edit")}</div>
        <div style="flex:1;min-width:0"><div class="pm-ttl">Editar pedido</div><div class="pm-sub">${esc([p.emoji, p.nombre, v.nombre].filter(Boolean).join(" ")) || "Pedido"}${atr ? ` · ${esc(atr)}` : ""}</div></div>
        ${zonaBadge}
      </div>
      <div class="pm-body">
        <div class="pm-sec" id="eDestSec" ${zona === "digital" ? 'style="display:none"' : ""}>
          <div class="pm-sec-h">${icon("user")} Destinatario</div>
          <div class="row2">
            <div><label>Nombre</label><input id="eNom" value="${esc(s.cliente || c.nombre || "")}"/></div>
            <div><label>Teléfono</label><input id="eTel" value="${esc(s.tel || c.wa_id || "")}"/></div>
          </div>
        </div>
        ${estadoFisicoHtml}
        ${prodHtml}
        <div class="pm-sec" id="eDigital" ${zona === "digital" ? "" : 'style="display:none"'}>
          <div class="pm-sec-h">${icon("dollar")} Pago digital</div>
          <label>Monto cobrado (S/) <span style="color:var(--faint,var(--muted));font-weight:400">(corrige si el bot leyó mal el comprobante)</span></label>
          <input id="eAmountD" type="number" step="0.1" value="${esc(o.amount ?? "")}"/>
          <label style="margin-top:10px">Estado de la venta</label>
          <select id="eEstadoD">
            <option value="confirmada"${(o.estado || "confirmada") !== "anulada" ? " selected" : ""}>Pagado / entregado (cuenta en tus números)</option>
            <option value="anulada"${o.estado === "anulada" ? " selected" : ""}>Anular la venta (deja de contar)</option>
          </select>
          <div class="hint">Corrige el monto y el Dashboard/KPIs se ajustan al instante. Si ya se envió a Meta con el monto viejo, después toca <b>“reintentar”</b> en el chip de Meta del chat.</div>
        </div>
        ${atrHtml}
        ${bumpHtml}
        <div class="pm-sec" id="eLima" ${zona !== "lima" ? 'style="display:none"' : ""}>
          <div class="pm-sec-h">${icon("pin")} Entrega en Lima</div>
          <label>Dirección</label><input id="eDir" value="${esc(s.direccion || "")}"/>
          <div class="row2">
            <div><label>Distrito</label><input id="eDist" list="dlDistrito" value="${esc(s.distrito || "")}"/><datalist id="dlDistrito">${dl(EV.distrito)}</datalist></div>
            <div><label>Referencia</label><input id="eRef" value="${esc(s.referencia || "")}"/></div>
          </div>
          <div class="row2">
            <div><label>Maps / GPS <span style="color:var(--faint,var(--muted));font-weight:400">(opcional)</span></label><input id="eGps" value="${esc(s.gps || "")}" placeholder="URL de Maps o lat, long"/></div>
            <div><label>Importe a cobrar (S/)</label><input id="eAmountL" type="number" step="0.1" value="${esc(o.amount ?? "")}"/></div>
          </div>
          <div class="row2">
            <div><label>Costo del envío (S/) <span style="color:var(--faint,var(--muted));font-weight:400">(motorizado)</span></label><input id="eFleteL" type="number" step="0.1" value="${esc(s.flete ?? "")}" placeholder="0.00"/></div>
            <div><label>Costo de empaque (S/) <span style="color:var(--faint,var(--muted));font-weight:400">(caja, bolsa…)</span></label><input id="eEmpaqueL" type="number" step="0.1" value="${esc(s.empaque ?? "")}" placeholder="0.00"/></div>
          </div>
          <div class="hint" style="margin-top:2px">El envío y el empaque son tus costos (el cliente no los ve); se descuentan de tu ganancia real.</div>
        </div>
        <div class="pm-sec" id="eProv" ${zona === "provincia" ? "" : 'style="display:none"'}>
          <div class="pm-sec-h">${icon("building")} Envío por agencia (Shalom)</div>
          <div class="row2">
            <div><label>DNI de quien recibe</label><input id="eDni" value="${esc(s.dni || "")}"/></div>
            <div><label>Ciudad</label><input id="eCiudad" value="${esc(s.ciudad || "")}"/></div>
          </div>
          <label>Agencia de destino (Shalom)</label>
          <input id="eDestino" list="dlDestino" value="${esc(destVal)}" placeholder="Escribe y elige la agencia de destino"/>
          <datalist id="dlDestino">${dl(SH.destino)}</datalist>
          <div class="hint">${sug && !s.destino ? `${icon("bulb")} <b>Sugerida por el bot</b> — la agencia oficial más parecida a lo que dijo el cliente. Confírmala o cámbiala.<br>` : ""}${s.sede ? `<b>El cliente escribió:</b> “${esc(s.sede)}”` : "La oficina Shalom donde recoge tu cliente. Va en el Excel y en el rótulo."}</div>
          <label>Medida del paquete</label>
          <select id="eMerc">${optMerc(SH.mercaderia, s.mercaderia)}</select>
          <label>Medidas y peso <span style="color:var(--faint,var(--muted));font-weight:400">(vacío = default del negocio)</span></label>
          <div class="meds">
            <div class="med"><span>Alto m</span><input id="eAlto" type="number" step="0.01" value="${esc(s.alto ?? "")}"/></div>
            <div class="med"><span>Ancho m</span><input id="eAncho" type="number" step="0.01" value="${esc(s.ancho ?? "")}"/></div>
            <div class="med"><span>Largo m</span><input id="eLargo" type="number" step="0.01" value="${esc(s.largo ?? "")}"/></div>
            <div class="med"><span>Peso kg</span><input id="ePeso" type="number" step="0.1" value="${esc(s.peso ?? "")}"/></div>
          </div>
          <div class="row2">
            <div><label>Adelanto (S/)</label><input id="eAdel" type="number" step="0.1" value="${esc(s.adelanto || "")}"/></div>
            <div><label>Saldo por cobrar (S/)</label><input id="eSaldo" type="number" step="0.1" value="${esc(s.saldo || "")}"/></div>
          </div>
          <div class="pm-sec-h" style="margin-top:14px">${icon("truck")} Guía, clave y costo</div>
          <div class="row2">
            <div><label>N° de guía</label><input id="eGuia" value="${esc(s.guia || "")}" placeholder="Ej. 034-123456"/></div>
            <div><label>Código de envío</label><input id="eCodigo" value="${esc(s.codigo_envio || "")}" placeholder="Ej. SH-77120"/></div>
          </div>
          <div class="row2">
            <div><label>Clave de recojo</label><input id="eClave" value="${esc(s.clave_recojo || "")}" placeholder="La pones tú; el cliente la usa"/></div>
            <div><label>Costo del envío (S/)</label><input id="eFlete" type="number" step="0.1" value="${esc(s.flete ?? "")}" placeholder="0.00"/></div>
          </div>
          <label style="margin-top:10px">Costo de empaque (S/) <span style="color:var(--faint,var(--muted));font-weight:400">(caja, bolsa…)</span></label><input id="eEmpaqueP" type="number" step="0.1" value="${esc(s.empaque ?? "")}" placeholder="0.00"/>
          <div class="hint">La clave, el envío, el empaque y el costo del producto los puedes poner/corregir en cualquier momento. Son tus costos (el cliente no los ve): se descuentan de tu ganancia real.</div>
        </div>
      </div>
      <div class="pm-foot">
        <button type="button" class="cancel">Cancelar</button>
        <button type="button" class="save">Guardar cambios</button>
      </div>
    </div></div>`;
    const g = (id) => ov.querySelector(id);
    const cerrar = (val) => { ov.remove(); resolve(val); };
    ov.onclick = (e) => { if (e.target === ov) cerrar(false); };
    g(".cancel").onclick = () => cerrar(false);

    // Suma actual de los extras (existentes con precio corregido + nuevos que no
    // son regalo). Los regalos y las filas sin precio no suman.
    const sumaExtras = () => {
      let sum = 0;
      ov.querySelectorAll("#eBumps .eb-row").forEach((row) => { const pin = row.querySelector(".eb-precio"); if (pin) sum += Number(pin.value) || 0; });
      ov.querySelectorAll("#eBumpsNew .eb-new").forEach((row) => { if (!row.querySelector(".ebn-regalo").checked) sum += Number(row.querySelector(".ebn-precio").value) || 0; });
      return sum;
    };
    // Saldo nuevo = saldo guardado + lo que cambiaron los extras. Solo aplica si el
    // pedido tiene un saldo (provincia siempre; Lima cuando se cobra contraentrega)
    // y hay campo visible (#eSaldo, provincia). Lima lo sincroniza al guardar.
    const saldoNuevo = () => saldoBase + (sumaExtras() - sumaBumpsVieja);
    const recalcSaldo = () => { const inp = g("#eSaldo"); if (inp && saldoBase > 0) inp.value = +(saldoNuevo().toFixed(2)); };
    ov.querySelectorAll(".eb-del").forEach((btn) => { btn.onclick = () => { const r = btn.closest(".eb-row"); if (r) r.remove(); recalcSaldo(); }; });
    ov.querySelectorAll("#eBumps .eb-precio").forEach((inp) => { inp.oninput = recalcSaldo; });

    // Cambiar de producto: al elegir otro producto, repueblo las presentaciones;
    // al cambiar la presentación, sugiero su precio en el importe editable (Lima).
    const sugerirImporte = () => {
      const pid = g("#eProd") ? g("#eProd").value : "";
      const vid = g("#eVer") ? g("#eVer").value : "";
      const pr = precioVer(pid, vid);
      const inp = g("#eAmountL") || g("#eAmountD"); // Lima (importe) o digital (monto)
      if (pr != null && inp) inp.value = pr;
    };
    if (g("#eProd")) g("#eProd").onchange = () => {
      const pid = g("#eProd").value; g("#eVer").innerHTML = verOpts(pid, ""); sugerirImporte();
      // Re-render de la variante del principal para el nuevo producto (vacía).
      const ej = ejesDe(pid);
      if (g("#eAtrSec")) g("#eAtrSec").style.display = ej.length ? "" : "none";
      if (g("#eAtrWrap")) g("#eAtrWrap").innerHTML = varSelectsHtml(pid, {}, "eatr-ppal");
    };
    if (g("#eVer")) g("#eVer").onchange = sugerirImporte;

    // Agregar extra/regalo a mano: fila con producto del catálogo (autocompleta
    // nombre+precio) o nombre libre. NO toca stock; el saldo/importe se ajusta aparte.
    const wireNewRow = (row) => {
      const sel = row.querySelector(".ebn-prod"), nom = row.querySelector(".ebn-nom"), pre = row.querySelector(".ebn-precio"), reg = row.querySelector(".ebn-regalo");
      sel.onchange = () => {
        const opt = sel.selectedOptions[0];
        if (opt && opt.value) { if (!nom.value) nom.value = opt.dataset.nom || opt.textContent.trim(); if (!reg.checked && pre.value === "" && opt.dataset.precio) pre.value = opt.dataset.precio; }
        // Producto con variantes → mostrar sus selects (obligatorios al guardar).
        const vwrap = row.querySelector(".ebn-vars");
        if (vwrap) vwrap.innerHTML = (opt && opt.value) ? varSelectsHtml(opt.value, {}, "ebnx-var") : "";
        recalcSaldo();
      };
      reg.onchange = () => { if (reg.checked) { pre.value = ""; pre.disabled = true; } else { pre.disabled = false; } recalcSaldo(); };
      pre.oninput = recalcSaldo;
      row.querySelector(".ebn-del").onclick = () => { row.remove(); recalcSaldo(); };
    };
    if (g("#eAddBump")) g("#eAddBump").onclick = () => {
      const wrap = g("#eBumpsNew"); const tmp = document.createElement("div"); tmp.innerHTML = bumpNewRowHtml.trim();
      const row = tmp.firstElementChild; wrap.appendChild(row); wireNewRow(row); row.querySelector(".ebn-nom").focus();
    };

    g(".save").onclick = async () => {
      const numU = (id) => { const x = g(id).value; return x === "" ? null : Number(x); };
      // OJO: para un pedido DIGITAL no se escribe `zona` en el shipping. Ponerle
      // zona:"digital" hacía que esFisico lo tomara como físico y zonaDe lo
      // clasificara como "provincia" (embudo de provincia en un digital).
      const ship = {};
      if (zona !== "digital") { ship.zona = zona; ship.cliente = g("#eNom").value.trim(); ship.tel = g("#eTel").value.trim(); }
      // Variante (talla/color) del principal → shipping.atributos (rótulo/agencia/stock).
      const ejesP = ejesDe(g("#eProd") ? g("#eProd").value : o.product_id);
      if (ejesP.length) {
        const at = { ...(s.atributos || {}) };
        ov.querySelectorAll(".eatr-ppal").forEach((sl) => { const v = sl.value.trim(); if (v) at[sl.dataset.eje] = v; else delete at[sl.dataset.eje]; });
        ship.atributos = at;
      }
      let amount, estadoNuevo;
      if (zona === "digital") {
        const a = g("#eAmountD").value; if (a !== "") amount = Number(a);
        const es = g("#eEstadoD") ? g("#eEstadoD").value : "";
        if (es && es !== o.estado) estadoNuevo = es;
      } else if (zona === "provincia") {
        const dst = g("#eDestino").value.trim();
        Object.assign(ship, { dni: g("#eDni").value.trim(), ciudad: g("#eCiudad").value.trim(),
          destino: dst, mercaderia: g("#eMerc").value,
          alto: numU("#eAlto"), ancho: numU("#eAncho"), largo: numU("#eLargo"), peso: numU("#ePeso"),
          adelanto: numU("#eAdel"), saldo: numU("#eSaldo"), // número o null (no string): un "80" de texto rompía sumas aguas abajo (concat/NaN)
          guia: g("#eGuia").value.trim(), codigo_envio: g("#eCodigo").value.trim(), clave_recojo: g("#eClave").value.trim(),
          flete: numU("#eFlete"), empaque: numU("#eEmpaqueP") });
        if (dst) ship.sede_por_confirmar = null;
      } else {
        Object.assign(ship, { direccion: g("#eDir").value.trim(), distrito: g("#eDist").value.trim(),
          referencia: g("#eRef").value.trim(), gps: g("#eGps").value.trim(), flete: numU("#eFleteL"), empaque: numU("#eEmpaqueL") });
        const a = g("#eAmountL").value; if (a !== "") amount = Number(a);
        // Lima no muestra campo de saldo, pero la ficha lo lee de shipping.saldo:
        // lo sincronizo con el delta de los extras para que no quede desfasado.
        if (saldoBase > 0) ship.saldo = +(saldoNuevo().toFixed(2));
      }
      // Costo del producto: campo común dentro de "Producto del pedido" (vacío = usa el del producto).
      if (g("#eCostoProd")) ship.costo_producto = numU("#eCostoProd");
      const body = { order_id: o.id, shipping: ship };
      // Cambio de producto / presentación → product_id + version_id (order-update
      // valida que el producto sea del canal). Provincia no tiene campo de importe
      // visible: si cambió y la presentación tiene precio, ajusta el amount base.
      if (g("#eProd")) {
        const pid = g("#eProd").value, vid = g("#eVer") ? g("#eVer").value : "";
        if (pid && (String(pid) !== String(o.product_id) || String(vid || "") !== String(versionId || ""))) {
          body.product_id = pid;
          body.version_id = vid || null;
          if (zona === "provincia") { const pr = precioVer(pid, vid); if (pr != null) amount = pr; }
        }
      }
      if (amount !== undefined) body.amount = amount;
      // Estado del pedido FÍSICO (selector nuevo). El digital ya setea estadoNuevo arriba.
      if (zona !== "digital") { const esF = g("#eEstadoF") ? g("#eEstadoF").value : ""; if (esF && esF !== o.estado) estadoNuevo = esF; }
      if (estadoNuevo) {
        body.estado = estadoNuevo;
        // Cerrar/avanzar desde "Editar pedido" NO le manda mensaje al cliente (el
        // Kanban es el que avisa). Acá solo registra el cambio y ajusta los números.
        body.aviso = { modo: "ninguno" };
      }
      // Ventas extra / regalos: las que quedaron (las quitadas con ✕ ya no están en
      // el DOM, con el precio corregido) + las AGREGADAS a mano. La variante elegida
      // va en `_attrs`; order-update la traduce a stock_key y ajusta el inventario.
      // Un extra de producto del catálogo lleva product_id → descuenta stock; uno
      // escrito a mano (sin product_id) no toca inventario.
      const kept = [];
      let faltaVar = false;
      const leerVars = (row, cls) => {
        const sels = row.querySelectorAll("." + cls);
        if (!sels.length) return null;
        const at = {};
        sels.forEach((sl) => { const v = sl.value.trim(); if (v) at[sl.dataset.eje] = v; else faltaVar = true; });
        return at;
      };
      ov.querySelectorAll("#eBumps .eb-row").forEach((row) => {
        const b = { ...bumps0[Number(row.dataset.idx)] };
        const pin = row.querySelector(".eb-precio");
        if (pin) b.precio = pin.value === "" ? 0 : Number(pin.value);
        const at = leerVars(row, "ebx-var");
        if (at) b._attrs = at;
        kept.push(b);
      });
      ov.querySelectorAll("#eBumpsNew .eb-new").forEach((row) => {
        const regalo = row.querySelector(".ebn-regalo").checked;
        const selOpt = row.querySelector(".ebn-prod").selectedOptions[0];
        const pid = (selOpt && selOpt.value) ? selOpt.value : "";
        const fromProd = pid ? (selOpt.dataset.nom || selOpt.textContent.trim()) : "";
        const nombre = row.querySelector(".ebn-nom").value.trim() || fromProd;
        if (!nombre) return;
        const precio = regalo ? 0 : (Number(row.querySelector(".ebn-precio").value) || 0);
        const nuevo = { nombre, precio, regalo, manual: true };
        if (pid) nuevo.product_id = pid;
        const at = leerVars(row, "ebnx-var");
        if (at) nuevo._attrs = at;
        kept.push(nuevo);
      });
      if (faltaVar) { toast("Elige la talla/color de los productos con variante", true); return; }
      // Solo mando order_bumps si había antes (aunque los borre todos → []) o si
      // agregué algo. Así no piso con [] un pedido que nunca tuvo extras.
      if (bumps0.length || kept.length) body.order_bumps = kept;
      const btn = g(".save"); btn.disabled = true; btn.textContent = "Guardando…";
      const { data, error } = await supa.functions.invoke("order-update", { body });
      if (!error && !(data && data.error)) {
        const al = (data && Array.isArray(data.stock_alerts)) ? data.stock_alerts : [];
        if (al.length) {
          const txt = al.map((x) => `${x.nombre}${x.key !== "_" ? " (" + String(x.key).replace(/=/g, " ").replace(/\|/g, " · ") + ")" : ""}: ${x.agotado ? "AGOTADO" : "quedan " + x.restante}`).join("; ");
          toast("Stock bajo — " + txt, true);
        } else { toast("Pedido actualizado"); }
        cerrar(true);
      }
      else { toast((error && error.message) || (data && data.error) || "No se pudo actualizar", true); btn.disabled = false; btn.textContent = "Guardar cambios"; }
    };
    document.body.appendChild(ov);
  });
}

// PASO 1 del despacho en lote: elegir CUÁLES pedidos se van a despachar ahora
// (los que llevas a la agencia). Devuelve el subconjunto elegido, o null si
// canceló. El registro de guías/códigos viene después con ese subconjunto.
export function elegirPedidosDespacho(orders, deps) {
  const { toast } = deps || {};
  injectDespachoCss();
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "overlay";
    const fila = (o) => {
      const s = o.shipping || {}, c = o.contact || {}, p = o.product || {};
      const dest = s.destino || s.sede || s.ciudad || "—";
      const adel = Number(s.adelanto || 0), saldo = Number(s.saldo || 0);
      const mon = (adel || saldo)
        ? `${adel ? `Adelanto <b>S/ ${adel}</b>` : ""}${adel && saldo ? "<br>" : ""}${saldo ? `Saldo <b>S/ ${saldo}</b>` : ""}`
        : "";
      const q = norm(`${c.nombre || s.cliente || ""} ${dest} ${s.ciudad || ""} ${s.dni || ""}`);
      return `<div class="sel-row on" data-id="${esc(o.id)}" data-q="${esc(q)}">
        <span class="sel-check">${icon("check")}</span>
        <span class="sel-em">${p.emoji ? esc(p.emoji) : icon("box")}</span>
        <div class="sel-tx"><div class="sel-nm">${esc(c.nombre || s.cliente || "Sin nombre")}</div><div class="sel-dest">${esc(dest)}</div></div>
        <div class="sel-mon">${mon}</div>
      </div>`;
    };
    ov.innerHTML = `<div class="modal sel-modal">
      <div class="sel-head"><div class="sel-ic">${icon("box")}</div>
        <div><div class="sel-ttl">¿Cuáles vas a despachar?</div><div class="sel-sub">Marca los pedidos que llevas a la agencia ahora. Después registras sus guías.</div></div></div>
      <div class="sel-search-wrap"><input class="sel-search" data-search placeholder="Buscar cliente, ciudad o destino…"/></div>
      <div class="sel-allbar"><label><input type="checkbox" data-all checked/> Seleccionar todos</label><span class="sel-cnt" data-cnt></span></div>
      <div class="sel-list">${orders.map(fila).join("")}</div>
      <div class="sel-foot"><span class="sel-hint" data-hint></span><button class="cancel">Cancelar</button><button class="save">Continuar</button></div>
    </div>`;
    const cerrar = (v) => { ov.remove(); resolve(v); };
    const sel = new Set(orders.map((o) => o.id));
    const visibles = () => [...ov.querySelectorAll(".sel-row")].filter((r) => r.style.display !== "none");
    const paint = () => {
      ov.querySelectorAll(".sel-row").forEach((r) => r.classList.toggle("on", sel.has(r.dataset.id)));
      const n = sel.size;
      ov.querySelector("[data-cnt]").textContent = `${n} de ${orders.length}`;
      ov.querySelector("[data-hint]").textContent = n ? `${n} pedido${n > 1 ? "s" : ""} seleccionado${n > 1 ? "s" : ""}` : "Marca al menos uno";
      const vis = visibles(), vsel = vis.filter((r) => sel.has(r.dataset.id)).length;
      const all = ov.querySelector("[data-all]");
      all.checked = vis.length > 0 && vsel === vis.length; all.indeterminate = vsel > 0 && vsel < vis.length;
      ov.querySelector(".save").disabled = !n;
    };
    const filtrar = () => {
      const q = norm((ov.querySelector("[data-search]").value || "").trim());
      ov.querySelectorAll(".sel-row").forEach((r) => { r.style.display = (!q || r.dataset.q.includes(q)) ? "" : "none"; });
      paint();
    };
    ov.onclick = (e) => { if (e.target === ov) cerrar(null); };
    ov.querySelector(".cancel").onclick = () => cerrar(null);
    ov.querySelector("[data-search]").oninput = filtrar;
    ov.querySelectorAll(".sel-row").forEach((r) => { r.onclick = () => { const id = r.dataset.id; sel.has(id) ? sel.delete(id) : sel.add(id); paint(); }; });
    ov.querySelector("[data-all]").onchange = (e) => { visibles().forEach((r) => e.target.checked ? sel.add(r.dataset.id) : sel.delete(r.dataset.id)); paint(); };
    ov.querySelector(".save").onclick = () => { if (!sel.size) return; cerrar(orders.filter((o) => sel.has(o.id))); };
    document.body.appendChild(ov);
    paint();
  });
}

// PASO 2 del despacho en lote: registrar guía + código + clave + costo de cada
// pedido elegido (un aviso para todos). "Pegar desde Shalom" reparte por orden;
// "Leer guías de fotos" hace OCR y empareja por DNI. Devuelve cuántos despachó.
export async function openDespachoLoteModal(orders, deps) {
  const { updateOrder, toast, supa, channelId } = deps;
  injectDespachoCss();
  const info = await cargarAviso(supa, channelId, orders[0] && orders[0].contact_id, "despachado");
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "overlay";
    const fotos = {};
    orders.forEach((o) => { const s = o.shipping || {}; if (s.guia_foto) fotos[o.id] = { url: s.guia_foto, kind: s.guia_foto_kind || "image" }; });
    const subirFoto = async (file) => {
      const dataURL = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      const { data, error } = await supa.functions.invoke("media-upload", { body: { channel_id: channelId, filename: file.name, content_type: file.type, data: dataURL } });
      if (error || !data?.url) return null;
      return { url: data.url, kind: data.kind || (file.type.startsWith("image/") ? "image" : "document") };
    };
    const fila = (o) => {
      const s = o.shipping || {}, c = o.contact || {};
      const dest = s.destino || s.sede || s.ciudad || "—";
      return `<tr data-id="${esc(o.id)}">
        <td class="dl-cli">${esc(c.nombre || s.cliente || "—")}<br><span>${esc(dest)}</span></td>
        <td><input data-k="guia" value="${esc(s.guia || "")}" placeholder="N° de guía"/></td>
        <td><input data-k="codigo" value="${esc(s.codigo_envio || "")}" placeholder="Código"/></td>
        <td><input data-k="clave" value="${esc(s.clave_recojo || "")}" placeholder="Clave"/></td>
        <td><input data-k="flete" type="number" min="0" step="0.5" value="${s.flete ?? ""}" placeholder="0" style="width:64px"/></td>
        <td><button type="button" class="dl-foto${s.guia_foto ? " has" : ""}" data-fid="${esc(o.id)}" title="Adjuntar foto del envío / guía">${s.guia_foto ? icon("check") : icon("camera")}</button></td>
      </tr>`;
    };
    ov.innerHTML = `<div class="modal dl-modal">
      <h3>Registrar despacho en lote</h3>
      <div class="m-sub">${orders.length} pedido${orders.length > 1 ? "s" : ""} por despachar. Pon el <b>N° de guía</b> y el <b>código de envío</b> de cada uno (Shalom pide los dos) y la clave. Al guardar pasan a Despachado y el bot avisa.</div>
      <div class="dl-tools">
        <button type="button" data-ocr>${icon("camera")} Leer guías de fotos</button>
        <button type="button" data-pegar>${icon("clipboard")} Pegar (texto)</button>
        <div class="dl-lote-ocr" style="margin-left:auto"><input data-clavetodos placeholder="Clave para todos"/><button type="button" data-clavebtn>Poner a todos</button></div>
      </div>
      <div class="dl-paste" data-pastebox>
        <textarea data-paste placeholder="Una línea por pedido, en el MISMO orden de la tabla: N° de guía y código (separados por tab, coma o espacio). Ej.:&#10;034-882140  SH-77120&#10;034-882141  SH-77121"></textarea>
        <div class="dl-pfoot"><button type="button" data-aplicar style="height:34px;padding:0 14px;border-radius:9px;border:none;background:var(--brand);color:#fff;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit">Aplicar a la tabla</button></div>
      </div>
      <div class="dl-tblwrap"><table class="dl-tbl"><thead><tr>
        <th>Cliente</th><th>N° de guía</th><th>Código de envío</th><th>Clave de recojo</th><th>Costo</th><th>Foto</th></tr></thead>
        <tbody>${orders.map(fila).join("")}</tbody></table></div>
      ${avisoBlockHtml(info)}
      <div class="m-foot"><button class="cancel">Cancelar</button><button class="save">Registrar despachos</button></div>
    </div>`;
    const cerrar = (v) => { ov.remove(); resolve(v); };
    ov.onclick = (e) => { if (e.target === ov) cerrar(0); };
    ov.querySelector(".cancel").onclick = () => cerrar(0);
    wireAviso(ov);
    ov.querySelectorAll(".dl-foto").forEach((btn) => {
      btn.onclick = () => {
        const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*,application/pdf";
        inp.onchange = async () => {
          const f = inp.files && inp.files[0]; if (!f) return;
          if (f.size > 16 * 1024 * 1024) { toast("Archivo muy grande (máx 16 MB)", true); return; }
          toast("Subiendo…"); const up = await subirFoto(f); if (!up) { toast("No se pudo subir la foto", true); return; }
          fotos[btn.dataset.fid] = up; btn.classList.add("has"); btn.innerHTML = icon("check"); toast("Foto lista");
        };
        inp.click();
      };
    });
    ov.querySelector("[data-pegar]").onclick = () => ov.querySelector("[data-pastebox]").classList.toggle("on");
    ov.querySelector("[data-aplicar]").onclick = () => {
      const txt = ov.querySelector("[data-paste]").value.trim();
      if (!txt) return;
      const lineas = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const filas = [...ov.querySelectorAll(".dl-tbl tbody tr")];
      lineas.forEach((linea, i) => {
        const tr = filas[i]; if (!tr) return;
        const p = linea.split(/\t|,|;|\s{2,}|\s+/).filter(Boolean);
        if (p[0]) tr.querySelector('[data-k="guia"]').value = p[0];
        if (p[1]) tr.querySelector('[data-k="codigo"]').value = p[1];
      });
      ov.querySelector("[data-pastebox]").classList.remove("on");
      toast(`Apliqué ${Math.min(lineas.length, filas.length)} línea(s)`);
    };
    // Clave para todos (cuando son iguales)
    ov.querySelector("[data-clavebtn]").onclick = () => {
      const v = ov.querySelector("[data-clavetodos]").value.trim();
      if (!v) { toast("Escribe la clave primero", true); return; }
      ov.querySelectorAll(".dl-tbl tbody tr").forEach((tr) => { tr.querySelector('[data-k="clave"]').value = v; });
      toast("Clave puesta en todos");
    };
    // Leer guías desde fotos: OCR + emparejar por DNI del destinatario
    // El índice guarda TODOS los pedidos de cada DNI, no el último. Antes era `dniMap[d] = o.id`:
    // si un cliente tenía dos pedidos por despachar (recompra, pasa seguido) el segundo pisaba al
    // primero, así que las DOS fotos se asignaban al MISMO pedido —la segunda guía sobreescribía a
    // la primera— y el otro paquete salía sin guía, con el toast diciendo "2 asignadas". El cliente
    // terminaba rastreando el paquete de otro. Con el DNI repetido no se adivina: se deja sin
    // emparejar para que el operador elija, que es un minuto de trabajo y no un paquete perdido.
    const dniMap = {};
    orders.forEach((o) => { const d = String((o.shipping || {}).dni || "").replace(/\D/g, "").replace(/^0+/, ""); if (d) (dniMap[d] = dniMap[d] || []).push(o.id); });
    ov.querySelector("[data-ocr]").onclick = () => {
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
      inp.onchange = async () => {
        const files = [...(inp.files || [])]; if (!files.length) return;
        const btn = ov.querySelector("[data-ocr]"); btn.disabled = true;
        let asign = 0, sin = 0, ambig = 0;
        const yaLeido = {};
        for (let i = 0; i < files.length; i++) {
          btn.textContent = `Leyendo ${i + 1}/${files.length}…`;
          const f = files[i]; if (f.size > 16 * 1024 * 1024) { sin++; continue; }
          const up = await subirFoto(f); if (!up) { sin++; continue; }
          let g = null;
          try { const { data, error } = await supa.functions.invoke("guia-ocr", { body: { channel_id: channelId, image_url: up.url } }); if (!error) g = data && data.guia; } catch (_) { /* sigue */ }
          if (!g) { sin++; continue; }
          const dni = String(g.dni || "").replace(/\D/g, "").replace(/^0+/, "");
          const cand = dni ? (dniMap[dni] || []) : [];
          let id = cand.length === 1 ? cand[0] : null;   // DNI repetido → ambiguo, no se adivina
          if (cand.length > 1) { ambig++; continue; }
          if (!id && g.nombre) {
            // Por nombre solo se empareja si la coincidencia es ÚNICA. Antes tomaba el primer
            // `.find()` que calzara con un `includes` en cualquier dirección: un OCR que leía
            // "Luis" pescaba a cualquier Luis del lote y le pegaba la guía de otro.
            const nn = g.nombre.toLowerCase().trim();
            const hits = nn.length < 4 ? [] : orders.filter((x) => { const nm = ((x.contact || {}).nombre || (x.shipping || {}).cliente || "").toLowerCase(); return nm && (nm.includes(nn) || nn.includes(nm)); });
            if (hits.length > 1) { ambig++; continue; }
            if (hits.length === 1) id = hits[0].id;
          }
          const tr = id && ov.querySelector(`.dl-tbl tbody tr[data-id="${id}"]`);
          if (!tr) { sin++; continue; }
          // Dos fotos distintas que caen en el mismo pedido: la segunda pisaba a la primera en
          // silencio. Se avisa en vez de sobreescribir.
          if (yaLeido[id]) { ambig++; continue; }
          yaLeido[id] = true;
          if (g.guia) tr.querySelector('[data-k="guia"]').value = g.guia;
          if (g.codigo) tr.querySelector('[data-k="codigo"]').value = g.codigo;
          fotos[id] = up; const fb = tr.querySelector(".dl-foto"); if (fb) { fb.classList.add("has"); fb.innerHTML = icon("check"); }
          tr.classList.remove("bad"); asign++;
        }
        btn.disabled = false; btn.innerHTML = icon("camera") + " Leer guías de fotos";
        toast(`${asign} guía(s) leída(s) y asignada(s)${sin ? ` · ${sin} sin emparejar` : ""}${ambig ? ` · ${ambig} ambigua(s): ponlas a mano` : ""}`, (sin > 0 && asign === 0) || ambig > 0);
      };
      inp.click();
    };
    ov.querySelector(".m-foot .save").onclick = async () => {
      const aviso = avisoValor(ov);
      const filas = [...ov.querySelectorAll(".dl-tbl tbody tr")];
      const listos = [];
      filas.forEach((tr) => {
        const g = tr.querySelector('[data-k="guia"]').value.trim();
        const cod = tr.querySelector('[data-k="codigo"]').value.trim();
        tr.classList.toggle("bad", !!(g || cod) && !(g && cod));
        if (g && cod) listos.push({ id: tr.dataset.id, g, cod,
          clave: tr.querySelector('[data-k="clave"]').value.trim(),
          flete: tr.querySelector('[data-k="flete"]').value });
      });
      if (!listos.length) { toast("Ningún pedido tiene N° de guía y código de envío", true); return; }
      const btn = ov.querySelector(".m-foot .save"); btn.disabled = true;
      let ok = 0, fail = 0;
      for (const it of listos) {
        btn.textContent = `Registrando ${ok + fail + 1}/${listos.length}…`;
        const r = await updateOrder({ order_id: it.id, estado: "despachado", aviso, shipping: {
          guia: it.g, codigo_envio: it.cod, clave_recojo: it.clave, sede_por_confirmar: null,
          ...(fotos[it.id] ? { guia_foto: fotos[it.id].url, guia_foto_kind: fotos[it.id].kind } : {}),
          ...(it.flete === "" || it.flete == null ? {} : { flete: Number(it.flete) || 0 }),
        } });
        r ? ok++ : fail++;
      }
      toast(`${ok} despacho(s) registrado(s)${fail ? ` · ${fail} con error` : ""}`);
      cerrar(ok);
    };
    document.body.appendChild(ov);
  });
}

// Qué decirle al humano según lo que REALMENTE pasó con el aviso. Sin esto,
// "Despacho registrado" se leía igual cuando el cliente recibió el aviso y
// cuando no le llegó nada.
export function avisoMsg(r, aviso, base) {
  // "el aviso", no "la plantilla": este mismo error llega también cuando el aviso iba como
  // MENSAJE (p. ej. fuera de la ventana de 24h), y ahí se leía "la plantilla no salió: …usa
  // una plantilla", que se contradice solo.
  if (r.aviso_error) return `${base} · el aviso no salió: ${r.aviso_error}`;
  if (r.aviso_enviado) return `${base} · plantilla enviada`;
  if (aviso.modo === "ninguno") return `${base} · sin avisar al cliente`;
  return r.flow_started ? `${base} · el bot está avisando al cliente` : `${base} · no hay aviso armado para este estado`;
}

// ── Pagos por validar (y acciones del pedido) dentro de la ficha ───
// La misma decisión de copiloto.html pero adaptada al panel angosto y enfocada
// en UN pedido (el del contacto abierto).
// La SECCIÓN "Pagos por validar" es una cola de pagos y solo tiene pagos; acá,
// en cambio, estás viendo a UN cliente y quieres resolverlo sin salir del chat,
// así que también están las dos acciones de logística que le corresponden —
// pero el despacho abre el formulario COMPARTIDO, no una versión recortada.
const ROBOT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="7" r="4"/><path d="M12 11v0M8 16h.01M16 16h.01"/></svg>';

// La etapa de decisión de un pedido (subconjunto de las ETAPAS de copiloto.html).
// null = no hay nada que decidir → la tarjeta no se muestra.
export function copilotoEtapa(o) {
  if (!o) return null;
  const s = o.shipping || {};
  if (o.estado === "pendiente" && s.digital_pendiente) return { id: "digital", titulo: "Pago digital por validar", pill: "dig" };
  if (s.extra_pendiente) return { id: "extra", titulo: "Venta extra por validar", pill: "ext" };
  // Igual que el saldo (abajo): "Adelanto por validar" SOLO si el cliente YA mandó su
  // comprobante. `esperando_adelanto` es "le pedí el adelanto", no "ya me pagó" — sin
  // esta condición la tarjeta salía en todo lead al que se le pidió un adelanto, y como
  // la imagen cae a `fallbackImg` (la última del chat) le pegaba una foto cualquiera
  // como si fuera el comprobante.
  if (o.estado === "esperando_adelanto") {
    return (s.adelanto_comprobante || s.adelanto_recibido_at)
      ? { id: "adelanto", titulo: "Adelanto por validar", pill: "adel" } : null;
  }
  // en_agencia es "Saldo por validar" SOLO si el cliente ya pagó el saldo (llegó
  // su comprobante). En agencia sin pago = esperando que paguen: no hay nada que
  // aprobar y NO se muestra el comprobante del ADELANTO como si fuera el del saldo.
  if (o.estado === "en_agencia") return (s.saldo_comprobante || s.saldo_recibido_at) ? { id: "saldo", titulo: "Saldo por validar", pill: "saldo" } : null;
  if (o.estado === "adelanto_validado" || o.estado === "por_despachar") return { id: "despachar", titulo: "Listo para despachar", pill: "desp" };
  if (o.estado === "despachado") return { id: "camino", titulo: "En camino a la agencia", pill: "camino" };
  return null;
}

// El veredicto del OCR (lo que te ahorra abrir la foto y hacer cuentas).
function ocrVerdictHtml(o, et, sym) {
  const s = o.shipping || {};
  const line = (ok, monto, op, extra) => `<div class="cx-cop2-ia ${ok ? "ok" : "duda"}">${ROBOT}<span>${ok ? "La IA lo leyó y cuadra" : "La IA no lo dio por bueno"}${monto != null && monto !== "" ? ` · leyó <b>${sym} ${esc(monto)}</b>` : ""}${op ? ` · op <b>${esc(op)}</b>` : ""}${extra ? `<br>${esc(extra)}` : ""}</span></div>`;
  if (et.id === "digital" && (s.digital_ok_ia != null || s.digital_monto_leido != null)) return line(s.digital_ok_ia === true, s.digital_monto_leido, s.digital_operacion, s.digital_revisar);
  if (et.id === "extra" && (s.extra_ok_ia != null || s.extra_monto_leido != null)) return line(s.extra_ok_ia === true, s.extra_monto_leido, s.extra_operacion, null);
  if (et.id === "adelanto" && (s.adelanto_revisar || s.adelanto_monto_leido != null)) return line(s.adelanto_ok_ia === true, s.adelanto_monto_leido, s.adelanto_operacion_leida, s.adelanto_revisar);
  if (et.id === "saldo" && s.saldo_revisar) {
    // La nota queda CONGELADA desde que se leyó el comprobante. Si el único motivo
    // era "no tiene clave de recojo" y ya la cargaste, el motivo se resolvió (el
    // pago era legítimo) → muestra que quedó listo, no la advertencia vieja.
    if (/clave de recojo/i.test(s.saldo_revisar) && s.clave_recojo) {
      return `<div class="cx-cop2-ia ok">${ROBOT}<span>La IA leyó el saldo y cuadra${s.saldo_monto_leido != null ? ` · leyó <b>${sym} ${esc(s.saldo_monto_leido)}</b>` : ""} · clave lista, puedes aprobar</span></div>`;
    }
    return `<div class="cx-cop2-ia duda">${ROBOT}<span>La IA no validó el saldo sola: <b>${esc(s.saldo_revisar)}</b></span></div>`;
  }
  return "";
}

function copilotoBtns(et) {
  const B = (a, txt, cls) => `<button class="cx-cop2-btn ${cls || "main"}" data-a="${a}">${txt}</button>`;
  if (et.id === "digital") return B("ok", `${icon("check")} Aprobar y entregar`) + B("no", "Rechazar", "danger");
  if (et.id === "extra") return B("ok", `${icon("check")} Aprobar y entregar`) + B("no", "Rechazar", "danger");
  if (et.id === "adelanto") return B("ok", `${icon("check")} Aprobar y avisar`) + B("no", "Rechazar", "danger");
  if (et.id === "saldo") return B("ok", `${icon("check")} Aprobar y dar clave`, "main blue") + B("no", "Rechazar", "danger");
  if (et.id === "despachar") return B("desp", `${icon("box")} Ya lo envié`, "main amber");
  return B("lleg", "Avisar que llegó a agencia");
}

// La tarjeta compacta de pago por validar para la ficha (imagen, monto, veredicto,
// botones). `fallbackImg` = último comprobante entrante, por si el pedido no lo
// guardó en shipping.
export function copilotoCardHtml(o, et, fallbackImg) {
  const s = o.shipping || {};
  const sym = o.currency === "USD" ? "$" : "S/";
  const img = et.id === "adelanto" ? (s.adelanto_comprobante || fallbackImg)
    : et.id === "saldo" ? s.saldo_comprobante
    : et.id === "digital" ? (s.digital_comprobante || fallbackImg)
    : et.id === "extra" ? (s.extra_comprobante || fallbackImg) : null;
  const monto = et.id === "adelanto" ? s.adelanto : et.id === "saldo" ? s.saldo
    : et.id === "digital" ? (s.digital_monto_leido ?? o.amount)
    : et.id === "extra" ? (s.extra_monto_leido ?? "") : o.amount;
  const montoLbl = et.id === "adelanto" ? "Adelanto" : et.id === "saldo" ? "Saldo a cobrar"
    : et.id === "extra" ? (s.extra_label || "Venta extra") : "Total";
  const needClave = et.id === "saldo" && !s.clave_recojo;
  return `<div class="cx-copiloto" data-order="${esc(o.id)}">
    <div class="cx-cop2-hd">${ROBOT}<span class="cx-cop2-pill ${et.pill}">${esc(et.titulo)}</span></div>
    ${img ? `<img class="cx-cop2-img" src="${esc(img)}" data-full="${esc(img)}" alt="Comprobante" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div class="cx-cop2-noimg" style="display:none">${icon("alert")} No se pudo cargar el comprobante. Ábrelo en la Bandeja para verlo.</div>`
      : (et.id === "adelanto" || et.id === "saldo" || et.id === "digital") ? `<div class="cx-cop2-noimg">Sin comprobante todavía</div>` : ""}
    <div class="cx-cop2-amt"><span class="cx-cop2-lbl">${esc(montoLbl)}</span><span class="cx-cop2-val">${monto != null && monto !== "" ? sym + " " + esc(monto) : "—"}</span></div>
    ${s.clave_recojo ? `<div class="cx-cop2-amt"><span class="cx-cop2-lbl">Clave de recojo</span><span class="cx-cop2-val" style="font-size:15px;color:var(--green)">${esc(s.clave_recojo)}</span></div>` : ""}
    ${ocrVerdictHtml(o, et, sym)}
    ${needClave ? `<div style="margin-top:8px"><label style="display:block;font-size:11.5px;font-weight:600;color:var(--amber,#b45309);margin-bottom:4px">${icon("key")} Clave de recojo — escríbela y aprueba</label><input class="cx-clave-in" type="text" placeholder="Ej. R-4821" autocomplete="off" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--surface,transparent);color:var(--text);box-sizing:border-box"/></div>` : ""}
    <div class="cx-cop2-acts">${copilotoBtns(et)}</div>
  </div>`;
}

// Engancha los botones de la tarjeta. deps = { supa, toast, confirmDialog,
// askChoice, reload } (los provee cada página: la Bandeja y Probar).
export function wireCopiloto(root, o, et, deps) {
  const el = root.querySelector(".cx-copiloto"); if (!el) return;
  const { supa, toast, confirmDialog, askChoice, reload, channelId } = deps;
  const c = o.contact || {};
  const img = el.querySelector(".cx-cop2-img[data-full]");
  if (img) img.onclick = () => window.open(img.dataset.full, "_blank");
  const update = async (body) => {
    const { data, error } = await supa.functions.invoke("order-update", { body });
    if (error) { toast(error.message || "No se pudo actualizar", true); return null; }
    if (data && data.error) { toast(data.error, true); return null; }
    return data;
  };
  const aprobar = async (nuevo, titulo, detalle, extraShip) => {
    if (!await confirmDialog({ title: titulo, message: `${c.nombre || "Cliente"} — ${detalle}`, confirmText: "Confirmar" })) return;
    const r = await update({ order_id: o.id, estado: nuevo, ...(extraShip ? { shipping: extraShip } : {}) });
    if (r) { toast(r.flow_started ? "Listo — el bot le está escribiendo" : "Listo"); reload && reload(); }
  };
  const aprobarExtra = async () => {
    if (!await confirmDialog({ title: "Aprobar la venta extra", message: `${c.nombre || "Cliente"} — el bot le entrega el extra y continúa.`, confirmText: "Confirmar" })) return;
    const r = await update({ order_id: o.id, resume: true, shipping: { extra_pendiente: false, extra_aprobado_at: new Date().toISOString() } });
    if (r) { toast(r.resumed ? "Extra entregado" : "Aprobado"); reload && reload(); }
  };
  const rechazar = async (tipo) => {
    const parqueado = tipo === "digital" || tipo === "extra";
    let quien = "humano";
    if (parqueado) {
      quien = await askChoice({ title: "Rechazar el comprobante", message: `${c.nombre || "Cliente"} — marcas el pago como no válido. ¿Y después?`, value: "bot", options: [
        { value: "bot", label: "Que el bot le pida otro", icon: "robot", desc: "Le dice que no pudo validar ese comprobante y le pide que reenvíe uno correcto. La venta sigue sola." },
        { value: "humano", label: "Lo atiendo yo", icon: "user", desc: "El bot queda en pausa en este chat y le escribes tú." },
      ] });
      if (!quien) return;
    } else if (!await confirmDialog({ title: "Rechazar el comprobante", message: `${c.nombre || "Cliente"} — se marca el ${tipo} como no válido. Escríbele para pedirle un pago correcto.`, confirmText: "Rechazar", danger: true })) return;
    const patch = tipo === "adelanto" ? { adelanto_rechazado_at: new Date().toISOString(), adelanto_revisar: "Lo rechazaste tú" }
      : tipo === "saldo" ? { saldo_rechazado_at: new Date().toISOString(), saldo_revisar: "Lo rechazaste tú" }
      : tipo === "extra" ? { extra_rechazado_at: new Date().toISOString(), extra_revisar: "Lo rechazaste tú", extra_pendiente: false }
      : { digital_rechazado_at: new Date().toISOString(), digital_revisar: "Lo rechazaste tú", digital_pendiente: false };
    const r = await update({ order_id: o.id, shipping: patch, ...(parqueado ? { reject: quien, reject_motivo: "No pude validar ese comprobante. ¿Me lo reenvías, por favor?" } : {}) });
    const pausa = parqueado && quien === "humano";
    if (r && pausa) { try { await supa.from("contacts").update({ bot_activo: false }).eq("id", o.contact_id); } catch (_) { /* */ } }
    if (r) { toast(pausa ? "Rechazado · el bot quedó en pausa" : (r.rejected ? "Rechazado · el bot le pide otro comprobante" : "Marcado como rechazado")); reload && reload(); }
  };
  // El despacho NO se rehace acá: abre el formulario compartido, el mismo que
  // usa el tablero de Pedidos, para que guarde exactamente los mismos campos.
  const despachar = async () => {
    const ok = await openDespachoModal(o, {
      updateOrder: update, toast, supa, channelId, contactId: o.contact_id, sugerido: null,
    });
    if (ok) reload && reload();
  };
  // "Llegó a la agencia" también pregunta cómo avisar: es el aviso que MÁS cae
  // fuera de la ventana de 24h (pasan días desde que el cliente escribió).
  const avisarLlegada = async () => {
    const aviso = await pedirAviso(o, { supa, channelId, contactId: o.contact_id }, "en_agencia",
      "Avisar que llegó",
      `${c.nombre || "Cliente"} — el pedido pasa a "en agencia" y se le pide el saldo para darle la clave.`);
    if (!aviso) return;
    const r = await update({ order_id: o.id, estado: "en_agencia", aviso });
    if (r) { toast(avisoMsg(r, aviso, "Listo")); reload && reload(); }
  };
  const b = (a) => el.querySelector(`[data-a="${a}"]`);
  if (et.id === "digital") { b("ok").onclick = () => aprobar("confirmada", "Aprobar el pago digital", "El bot le entrega el producto al instante y sigue vendiendo."); b("no").onclick = () => rechazar("digital"); }
  else if (et.id === "extra") { b("ok").onclick = aprobarExtra; b("no").onclick = () => rechazar("extra"); }
  else if (et.id === "adelanto") { b("ok").onclick = () => aprobar("adelanto_validado", "Aprobar el adelanto", "El pedido pasa a listo para despachar y el bot le confirma."); b("no").onclick = () => rechazar("adelanto"); }
  else if (et.id === "saldo") {
    b("ok").onclick = () => {
      // Si el pedido aún no tiene clave, se escribe en el input del propio card y
      // se guarda junto con la aprobación (un solo paso, sin abrir "Editar pedido").
      const claveIn = el.querySelector(".cx-clave-in");
      let extraShip;
      if (claveIn) {
        const v = claveIn.value.trim();
        if (!v) { toast("Escribe la clave de recojo antes de aprobar", true); claveIn.focus(); return; }
        extraShip = { clave_recojo: v };
      }
      aprobar("saldo_pagado", "Aprobar el saldo", "El bot le envía la clave de recojo al cliente.", extraShip);
    };
    b("no").onclick = () => rechazar("saldo");
  }
  else if (et.id === "despachar") { b("desp").onclick = despachar; }
  else { b("lleg").onclick = avisarLlegada; }
}

let cssInjected = false;
export function injectExtrasCss() {
  if (cssInjected) return;
  cssInjected = true;
  document.head.insertAdjacentHTML("beforeend", `<style>${EXTRAS_CSS}</style>`);
}
