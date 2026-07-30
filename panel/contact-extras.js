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
    return `<button type="button" class="cx-stagechip${on ? " on" : ""}" data-stagepick="${s.k}"${on ? ` style="background:${s.color}1c;border-color:${s.color};color:${s.color}"` : ""}><span class="cx-sd" style="background:${s.color}"></span><span class="cx-sl">${esc(s.label)}</span>${on ? '<span class="cx-sck">✓</span>' : ""}</button>`;
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
]);
export const esCampoInterno = (key) => {
  const k = String(key || "");
  return k.startsWith("_") || CLAVES_INTERNAS.has(k.toLowerCase());
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
  const guardar = async (mia) => {
    const payload = { quien_es: mia.quien_es, como_tratar: mia.como_tratar };
    if (mia._last) payload._last = mia._last;
    contact.memoria_ia = payload; // que el re-render lo vea
    const { error } = await supa.from("contacts").update({ memoria_ia: payload }).eq("id", contact.id);
    if (error) toast("No se pudo guardar la memoria: " + error.message, true);
    else toast("Memoria actualizada ✓");
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
  const sel = "id,amount,currency,order_bumps,estado,order_id,created_at,updated_at,shipping,contact:contact_id(nombre,wa_id),product:product_id(nombre,emoji,tipo),version:version_id(nombre)";
  try {
    const { data, error } = await supa.from("orders").select(sel).eq("contact_id", contactId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!error) return data || null;
  } catch (_) { /* cae al intento simple */ }
  try {
    const { data } = await supa.from("orders").select("id,amount,currency,order_bumps,estado,order_id,created_at,shipping,product:product_id(nombre,emoji,tipo),version:version_id(nombre)").eq("contact_id", contactId).order("created_at", { ascending: false }).limit(1).maybeSingle();
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
  const air = s.aereo ? ` <span class="pd-chip air">✈ Aéreo</span>` : "";
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
      + (b.digital ? ` <span class="pd-chip">${b.entregado ? "entregado ✓" : "digital"}</span>` : "");
    return `<div class="pd-bump"><span class="pd-bi">${esRegalo ? "🎁" : "➕"}</span>` +
      `<span class="pd-bn">${esc(nom)}${varTxt ? ` <span class="pd-bvar">${esc(varTxt)}</span>` : ""}${flags}</span>` +
      `<span class="pd-bp">${esc(precioTxt)}</span></div>`;
  }).join("");

  // ── DATOS DEL CLIENTE: nombre, teléfono y a dónde se entrega ──
  const cliLines = [];
  const dest = (s.cliente || c.nombre || "").trim();
  cliLines.push(mkLine("Cliente", dest ? esc(dest) : ""));
  cliLines.push(mkLine("Teléfono", c.wa_id ? `<b class="mono">+${esc(c.wa_id)}</b>` : ""));
  if (zona === "provincia") {
    cliLines.push(mkLine("DNI", s.dni ? `<b class="mono">${esc(s.dni)}</b>` : ""));
    if (s.destino) cliLines.push(mkLine("Agencia", `${esc(s.destino)}${air}`));
    else if (s.sede) cliLines.push(mkLine("Agencia", `${esc(s.sede)} <span class="pd-chip warn">sin confirmar</span>${air}`));
    else if (s.ciudad) cliLines.push(mkLine("Agencia", `Shalom ${esc(cap(s.ciudad))}${air}`));
    if (!s.destino && s.ciudad && s.sede) cliLines.push(mkLine("Ciudad", esc(cap(s.ciudad))));
    if (s.mercaderia) cliLines.push(mkLine("Medida", esc(s.mercaderia)));
  } else if (zona === "lima") {
    cliLines.push(mkLine("Dirección", s.direccion ? esc(s.direccion) : ""));
    cliLines.push(mkLine("Distrito", s.distrito ? esc(cap(s.distrito)) : ""));
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
  const tel = c.wa_id ? "+" + c.wa_id : "—";
  const pedido = [p.emoji, p.nombre, v.nombre ? "· " + v.nombre : ""].filter(Boolean).join(" ");
  const nro = (o.order_id || o.id || "").toString().slice(0, 8).toUpperCase();
  const row = (k, val, big) => val ? `<tr><td class="k">${esc(k)}</td><td class="v ${big ? "big" : ""}">${esc(val)}</td></tr>` : "";
  const atrLine = Object.entries(s.atributos || {}).map(([k, val]) => `${k}: ${val}`).join("   ·   ");
  let filas = "";
  if (zona === "provincia") {
    filas =
      row("Destinatario", s.cliente || c.nombre || "", true) +
      row("DNI", s.dni || "", true) +
      row("Teléfono", tel) +
      row("Agencia", [s.ciudad && ("Shalom " + cap(s.ciudad)), s.sede].filter(Boolean).join(" · ") || (s.agencia ? cap(s.agencia) : ""), true) +
      row("Envío", s.aereo ? "✈ AÉREO — despachar por avión" : "", true) +
      row("Pedido", pedido) +
      row("Detalle", atrLine, true) +
      row("N° pedido", nro);
  } else {
    filas =
      row("Destinatario", c.nombre || s.cliente || "", true) +
      row("Teléfono", tel) +
      row("Dirección", s.direccion || "", true) +
      row("Distrito", s.distrito || "") +
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
        <div class="zn">${zona === "provincia" ? (s.aereo ? "AGENCIA · ✈ AÉREO" : "AGENCIA") : "CONTRAENTREGA"}</div>
      </div>
      <table>${filas}</table>
      <div class="ft">Generado por Nodo · ${new Date().toLocaleDateString("es-PE")}</div>
    </div>
    <div class="noprint"><button onclick="window.print()">🖨️ Imprimir</button></div>
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
  .cpanel .mia{position:relative;overflow:hidden;border:1px solid var(--ia-border);border-radius:14px;padding:13px 13px 11px;margin:14px 0 6px;
    background:radial-gradient(120% 130% at 0% 0%,rgba(168,85,247,.20),transparent 55%),radial-gradient(120% 130% at 100% 100%,rgba(236,72,153,.14),transparent 55%),var(--surface-2)}
  .cpanel .mia::after{content:"";position:absolute;right:-38px;top:-38px;width:140px;height:140px;border-radius:50%;background:radial-gradient(circle,rgba(168,85,247,.30),transparent 70%);filter:blur(20px);pointer-events:none}
  .cpanel .mia-hd{position:relative;display:flex;align-items:center;justify-content:space-between;margin-bottom:13px}
  .cpanel .mia-badge{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ia);background:var(--ia-bg);border:1px solid var(--ia-border);border-radius:999px;padding:4px 10px}
  .cpanel .mia-badge svg{width:13px;height:13px}
  .cpanel .mia-cap{font-size:10px;color:var(--faint)}
  .cpanel .mia-lyr{position:relative;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;margin:0 0 5px}
  .cpanel .mia-lyr .mia-sub{color:var(--faint);text-transform:none;letter-spacing:0;font-weight:400}
  .cpanel .mia-chips{position:relative;display:flex;flex-wrap:wrap;gap:5px;margin-bottom:13px}
  .cpanel .mia-chip{font-size:12px;padding:5px 10px;border-radius:999px;border:1px solid transparent;line-height:1;font-family:inherit}
  .cpanel .mia-chip.sell{background:rgba(168,85,247,.18);border-color:rgba(168,85,247,.5);color:#e9d5ff;cursor:pointer}
  .cpanel .mia-chip.ghost{background:rgba(168,85,247,.05);border:1px dashed var(--ia-border);color:var(--muted);cursor:pointer}
  .cpanel .mia-chip.who{background:rgba(236,72,153,.12);border-color:rgba(236,72,153,.45);color:#f9a8d4}
  .cpanel .mia-chip.how{background:rgba(168,85,247,.05);border:1px dashed #4a3a63;color:#9a8bb0}
  .cpanel .mia-chip.sell:hover,.cpanel .mia-chip.ghost:hover{filter:brightness(1.14)}
  .cpanel .mia-chip svg{width:11px;height:11px;vertical-align:-1px;opacity:.7}
  .cpanel .mia-none{font-size:11.5px;color:var(--faint)}
  .cpanel .mia-edit{font-size:12px;height:28px;border-radius:999px;background:var(--surface);border:1px solid var(--ia);color:var(--text);padding:0 11px;outline:none;min-width:90px;font-family:inherit}
  .cpanel .mia-foot{position:relative;display:flex;align-items:center;justify-content:space-between;margin-top:2px;padding-top:10px;border-top:1px solid var(--border)}
  .cpanel .mia-hint{font-size:10.5px;color:var(--faint)}
  .cpanel .mia-mini{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--faint);font-weight:700;margin:10px 0 2px}
  .cpanel .mia-mini:first-child{margin-top:0}
  /* Tema claro: los chips llevan texto oscuro (el claro se lee mal sobre el tinte pálido) */
  html[data-theme=light] .cpanel .mia-chip.sell{color:#6b21a8}
  html[data-theme=light] .cpanel .mia-chip.who{color:#9d174d}
  html[data-theme=light] .cpanel .mia-chip.how{color:#6d28d9}
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
  .cpanel .cx-stagechip .cx-sck{font-size:13px;font-weight:800;flex:none}
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
    const { data: conv } = await supa.from("conversations").select("expira_at").eq("contact_id", contactId).maybeSingle();
    const t = conv?.expira_at ? new Date(conv.expira_at).getTime() : 0;
    info.abierta = t > Date.now();
    if (info.abierta) {
      const m = Math.floor((t - Date.now()) / 60000);
      info.restante = m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
    }
  } catch (_) { /* sin conversación aún */ }
  // FEP (Free Entry Point): si el cliente llegó por un anuncio, tiene 72h en las
  // que TODO —incluida la plantilla— es GRATIS. Se muestra para que, al despachar
  // fuera de la ventana de 24h, se vea que mandar la plantilla no cuesta.
  try {
    const { data: ct } = await supa.from("contacts").select("fep_hasta").eq("id", contactId).maybeSingle();
    const f = ct?.fep_hasta ? new Date(ct.fep_hasta).getTime() : 0;
    if (f > Date.now()) {
      info.fepActivo = true;
      const m = Math.floor((f - Date.now()) / 60000);
      info.fepRestante = m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
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
      ? `● Ventana abierta — le quedan ${esc(info.restante)} para escribirle libremente`
      : "● Ventana cerrada — WhatsApp solo acepta una plantilla aprobada"}</div>
    ${info.fepActivo ? `<div class="avz-fep">Llegó por anuncio — aún gratis por ${esc(info.fepRestante)}: la plantilla no te cuesta</div>` : ""}
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
      <h3>📦 Registrar despacho</h3>
      <div class="m-sub">${esc((o.contact || {}).nombre || "")} — al guardar, el pedido pasa a <b>Despachado</b> y el bot puede enviarle la guía al cliente.</div>
      ${s.sede_por_confirmar ? `<div style="margin:0 0 12px;padding:8px 10px;border-radius:9px;border:1px solid var(--amber);background:var(--amber-bg,rgba(245,158,11,.13));color:var(--amber);font-size:12px;font-weight:600;line-height:1.4">⚠ La sede la capturó el bot y quedó por confirmar (${esc(s.sede_por_confirmar)}). Revisa que sea la oficina exacta antes de despachar.</div>` : ""}
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
        ? `${fotoKind === "image" ? `<img src="${esc(foto)}" data-ver/>` : `<div class="dsp-doc">📄</div>`}
           <button type="button" data-f="cambiar">Cambiar</button><button type="button" data-f="quitar">Quitar</button>`
        : `<button type="button" data-f="subir">📷 Subir foto o PDF de la guía</button>`;
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
          pintaFoto(); toast("Foto lista ✓");
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
  const zonaBadge = zona === "provincia"
    ? `<span class="pm-zona prov">${icon("building")} Provincia · agencia</span>`
    : `<span class="pm-zona lima">${icon("truck")} Lima · contraentrega</span>`;
  return new Promise((resolve) => {
    const ov = document.createElement("div"); ov.className = "overlay";
    ov.innerHTML = `<div class="modal"><div class="pedmodal">
      <div class="pm-head">
        <div class="pm-ic">${icon("edit")}</div>
        <div style="flex:1;min-width:0"><div class="pm-ttl">Editar pedido</div><div class="pm-sub">${esc([p.emoji, p.nombre, v.nombre].filter(Boolean).join(" ")) || "Pedido"}${atr ? ` · ${esc(atr)}` : ""}</div></div>
        ${zonaBadge}
      </div>
      <div class="pm-body">
        <div class="pm-sec">
          <div class="pm-sec-h">${icon("user")} Destinatario</div>
          <div class="row2">
            <div><label>Nombre</label><input id="eNom" value="${esc(s.cliente || c.nombre || "")}"/></div>
            <div><label>Teléfono</label><input id="eTel" value="${esc(s.tel || c.wa_id || "")}"/></div>
          </div>
        </div>
        <div class="pm-sec" id="eLima" ${zona === "provincia" ? 'style="display:none"' : ""}>
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
          <div class="hint">${sug && !s.destino ? `💡 <b>Sugerida por el bot</b> — la agencia oficial más parecida a lo que dijo el cliente. Confírmala o cámbiala.<br>` : ""}${s.sede ? `🗣 <b>El cliente escribió:</b> “${esc(s.sede)}”` : "La oficina Shalom donde recoge tu cliente. Va en el Excel y en el rótulo."}</div>
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
    g(".save").onclick = async () => {
      const numU = (id) => { const x = g(id).value; return x === "" ? null : Number(x); };
      const ship = { cliente: g("#eNom").value.trim(), tel: g("#eTel").value.trim(), zona };
      let amount;
      if (zona === "provincia") {
        const dst = g("#eDestino").value.trim();
        Object.assign(ship, { dni: g("#eDni").value.trim(), ciudad: g("#eCiudad").value.trim(),
          destino: dst, mercaderia: g("#eMerc").value,
          alto: numU("#eAlto"), ancho: numU("#eAncho"), largo: numU("#eLargo"), peso: numU("#ePeso"),
          adelanto: g("#eAdel").value, saldo: g("#eSaldo").value });
        if (dst) ship.sede_por_confirmar = null;
      } else {
        Object.assign(ship, { direccion: g("#eDir").value.trim(), distrito: g("#eDist").value.trim(),
          referencia: g("#eRef").value.trim(), gps: g("#eGps").value.trim() });
        const a = g("#eAmountL").value; if (a !== "") amount = Number(a);
      }
      const body = { order_id: o.id, shipping: ship };
      if (amount !== undefined) body.amount = amount;
      const btn = g(".save"); btn.disabled = true; btn.textContent = "Guardando…";
      const { data, error } = await supa.functions.invoke("order-update", { body });
      if (!error && !(data && data.error)) { toast("Pedido actualizado ✓"); cerrar(true); }
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
        <span class="sel-check">✓</span>
        <span class="sel-em">${p.emoji ? esc(p.emoji) : "📦"}</span>
        <div class="sel-tx"><div class="sel-nm">${esc(c.nombre || s.cliente || "Sin nombre")}</div><div class="sel-dest">${esc(dest)}</div></div>
        <div class="sel-mon">${mon}</div>
      </div>`;
    };
    ov.innerHTML = `<div class="modal sel-modal">
      <div class="sel-head"><div class="sel-ic">📦</div>
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
        <td><button type="button" class="dl-foto${s.guia_foto ? " has" : ""}" data-fid="${esc(o.id)}" title="Adjuntar foto del envío / guía">${s.guia_foto ? "✓" : "📷"}</button></td>
      </tr>`;
    };
    ov.innerHTML = `<div class="modal dl-modal">
      <h3>📦 Registrar despacho en lote</h3>
      <div class="m-sub">${orders.length} pedido${orders.length > 1 ? "s" : ""} por despachar. Pon el <b>N° de guía</b> y el <b>código de envío</b> de cada uno (Shalom pide los dos) y la clave. Al guardar pasan a Despachado y el bot avisa.</div>
      <div class="dl-tools">
        <button type="button" data-ocr>📷 Leer guías de fotos</button>
        <button type="button" data-pegar>📋 Pegar (texto)</button>
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
          fotos[btn.dataset.fid] = up; btn.classList.add("has"); btn.textContent = "✓"; toast("Foto lista ✓");
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
    const dniMap = {};
    orders.forEach((o) => { const d = String((o.shipping || {}).dni || "").replace(/\D/g, "").replace(/^0+/, ""); if (d) dniMap[d] = o.id; });
    ov.querySelector("[data-ocr]").onclick = () => {
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
      inp.onchange = async () => {
        const files = [...(inp.files || [])]; if (!files.length) return;
        const btn = ov.querySelector("[data-ocr]"); btn.disabled = true;
        let asign = 0, sin = 0;
        for (let i = 0; i < files.length; i++) {
          btn.textContent = `Leyendo ${i + 1}/${files.length}…`;
          const f = files[i]; if (f.size > 16 * 1024 * 1024) { sin++; continue; }
          const up = await subirFoto(f); if (!up) { sin++; continue; }
          let g = null;
          try { const { data, error } = await supa.functions.invoke("guia-ocr", { body: { channel_id: channelId, image_url: up.url } }); if (!error) g = data && data.guia; } catch (_) { /* sigue */ }
          if (!g) { sin++; continue; }
          const dni = String(g.dni || "").replace(/\D/g, "").replace(/^0+/, "");
          let id = dni ? dniMap[dni] : null;
          if (!id && g.nombre) {
            const nn = g.nombre.toLowerCase();
            const o = orders.find((x) => { const nm = ((x.contact || {}).nombre || (x.shipping || {}).cliente || "").toLowerCase(); return nm && (nm.includes(nn) || nn.includes(nm)); });
            if (o) id = o.id;
          }
          const tr = id && ov.querySelector(`.dl-tbl tbody tr[data-id="${id}"]`);
          if (!tr) { sin++; continue; }
          if (g.guia) tr.querySelector('[data-k="guia"]').value = g.guia;
          if (g.codigo) tr.querySelector('[data-k="codigo"]').value = g.codigo;
          fotos[id] = up; const fb = tr.querySelector(".dl-foto"); if (fb) { fb.classList.add("has"); fb.textContent = "✓"; }
          tr.classList.remove("bad"); asign++;
        }
        btn.disabled = false; btn.textContent = "📷 Leer guías de fotos";
        toast(`${asign} guía(s) leída(s) y asignada(s)${sin ? ` · ${sin} sin emparejar` : ""}`, sin > 0 && asign === 0);
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
  if (r.aviso_error) return `${base} · ⚠ la plantilla no salió: ${r.aviso_error}`;
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
  if (o.estado === "esperando_adelanto") return { id: "adelanto", titulo: "Adelanto por validar", pill: "adel" };
  if (o.estado === "en_agencia") return { id: "saldo", titulo: "Saldo por validar", pill: "saldo" };
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
  if (et.id === "saldo" && s.saldo_revisar) return `<div class="cx-cop2-ia duda">${ROBOT}<span>La IA no validó el saldo sola: <b>${esc(s.saldo_revisar)}</b></span></div>`;
  return "";
}

function copilotoBtns(et) {
  const B = (a, txt, cls) => `<button class="cx-cop2-btn ${cls || "main"}" data-a="${a}">${txt}</button>`;
  if (et.id === "digital") return B("ok", "✓ Aprobar y entregar") + B("no", "Rechazar", "danger");
  if (et.id === "extra") return B("ok", "✓ Aprobar y entregar") + B("no", "Rechazar", "danger");
  if (et.id === "adelanto") return B("ok", "✓ Aprobar y avisar") + B("no", "Rechazar", "danger");
  if (et.id === "saldo") return B("ok", "✓ Aprobar y dar clave", "main blue") + B("no", "Rechazar", "danger");
  if (et.id === "despachar") return B("desp", "📦 Ya lo envié", "main amber");
  return B("lleg", "Avisar que llegó a agencia");
}

// La tarjeta compacta de pago por validar para la ficha (imagen, monto, veredicto,
// botones). `fallbackImg` = último comprobante entrante, por si el pedido no lo
// guardó en shipping.
export function copilotoCardHtml(o, et, fallbackImg) {
  const s = o.shipping || {};
  const sym = o.currency === "USD" ? "$" : "S/";
  const img = et.id === "adelanto" ? (s.adelanto_comprobante || fallbackImg)
    : et.id === "saldo" ? (s.saldo_comprobante || fallbackImg)
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
    ${img ? `<img class="cx-cop2-img" src="${esc(img)}" data-full="${esc(img)}" alt="Comprobante" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div class="cx-cop2-noimg" style="display:none">⚠ No se pudo cargar el comprobante. Ábrelo en la Bandeja para verlo.</div>`
      : (et.id === "adelanto" || et.id === "saldo" || et.id === "digital") ? `<div class="cx-cop2-noimg">Sin comprobante todavía</div>` : ""}
    <div class="cx-cop2-amt"><span class="cx-cop2-lbl">${esc(montoLbl)}</span><span class="cx-cop2-val">${monto != null && monto !== "" ? sym + " " + esc(monto) : "—"}</span></div>
    ${s.clave_recojo ? `<div class="cx-cop2-amt"><span class="cx-cop2-lbl">Clave de recojo</span><span class="cx-cop2-val" style="font-size:15px;color:var(--green)">${esc(s.clave_recojo)}</span></div>` : ""}
    ${ocrVerdictHtml(o, et, sym)}
    ${needClave ? `<div class="cx-cop2-warn">${ROBOT}<span>Este pedido no tiene clave de recojo — ponla antes de aprobar.</span></div>` : ""}
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
  const aprobar = async (nuevo, titulo, detalle) => {
    if (!await confirmDialog({ title: titulo, message: `${c.nombre || "Cliente"} — ${detalle}`, confirmText: "Confirmar" })) return;
    const r = await update({ order_id: o.id, estado: nuevo });
    if (r) { toast(r.flow_started ? "Listo ✓ · el bot le está escribiendo" : "Listo ✓"); reload && reload(); }
  };
  const aprobarExtra = async () => {
    if (!await confirmDialog({ title: "Aprobar la venta extra", message: `${c.nombre || "Cliente"} — el bot le entrega el extra y continúa.`, confirmText: "Confirmar" })) return;
    const r = await update({ order_id: o.id, resume: true, shipping: { extra_pendiente: false, extra_aprobado_at: new Date().toISOString() } });
    if (r) { toast(r.resumed ? "Extra entregado ✓" : "Aprobado ✓"); reload && reload(); }
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
    if (r) { toast(avisoMsg(r, aviso, "Listo ✓")); reload && reload(); }
  };
  const b = (a) => el.querySelector(`[data-a="${a}"]`);
  if (et.id === "digital") { b("ok").onclick = () => aprobar("confirmada", "Aprobar el pago digital", "El bot le entrega el producto al instante y sigue vendiendo."); b("no").onclick = () => rechazar("digital"); }
  else if (et.id === "extra") { b("ok").onclick = aprobarExtra; b("no").onclick = () => rechazar("extra"); }
  else if (et.id === "adelanto") { b("ok").onclick = () => aprobar("adelanto_validado", "Aprobar el adelanto", "El pedido pasa a listo para despachar y el bot le confirma."); b("no").onclick = () => rechazar("adelanto"); }
  else if (et.id === "saldo") { b("ok").onclick = () => aprobar("saldo_pagado", "Aprobar el saldo", "El bot le envía la clave de recojo al cliente."); b("no").onclick = () => rechazar("saldo"); }
  else if (et.id === "despachar") { b("desp").onclick = despachar; }
  else { b("lleg").onclick = avisarLlegada; }
}

let cssInjected = false;
export function injectExtrasCss() {
  if (cssInjected) return;
  cssInjected = true;
  document.head.insertAdjacentHTML("beforeend", `<style>${EXTRAS_CSS}</style>`);
}
