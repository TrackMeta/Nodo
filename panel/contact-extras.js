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
import { toast } from "./shell.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const cap = (s) => { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); };
export function money(v, cur) {
  try { return new Intl.NumberFormat("es-PE", { style: "currency", currency: cur || "PEN" }).format(Number(v || 0)); }
  catch { return (cur || "PEN") + " " + Number(v || 0).toFixed(2); }
}

// Las etapas del embudo — FUENTE ÚNICA (la Bandeja, la ficha y la sección Embudo
// la importan). value=lo que se guarda · label=lo que se muestra · color/desc.
export const EMBUDO_STAGES = [
  { k: "nuevo",      label: "Nuevo",      color: "#378ADD", desc: "Recién escribió" },
  { k: "interesado", label: "Interesado", color: "#EF9F27", desc: "Preguntó, quiere más" },
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
export const esCampoInterno = (key) => String(key || "").startsWith("_");

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

// Tarjeta compacta del pedido dentro de la ficha (producto, estado, zona, plata,
// envío). Devuelve solo el HTML interior; el <h4> y el botón de rótulo los pone
// quien la usa.
export function pedidoResumenHtml(o) {
  if (!o) return "";
  const p = o.product || {}, v = o.version || {}, s = o.shipping || {};
  const zona = O.zonaDe(o);
  const zonaTxt = zona === "lima" ? "LIMA" : zona === "provincia" ? "PROVINCIA" : "DIGITAL";
  const col = TONO_COLOR[O.tono(o.estado)] || "var(--amber)";
  const prod = [p.emoji, p.nombre, v.nombre ? "· " + v.nombre : ""].filter(Boolean).join(" ") || "Pedido";
  const adel = Number(s.adelanto || 0), saldo = Number(s.saldo || 0);
  const moneyLine = adel || saldo
    ? `${adel ? `Adelanto <b>${money(adel, o.currency)}</b>` : ""}${adel && saldo ? " · " : ""}${saldo ? `Saldo <b>${money(saldo, o.currency)}</b>` : ""}`
    : `Total <b>${money(O.total(o), o.currency)}</b>`;
  const bits = [];
  if (s.agencia || s.ciudad) bits.push(esc([s.agencia && cap(s.agencia), s.ciudad && cap(s.ciudad), s.sede].filter(Boolean).join(" · ")));
  if (s.distrito || s.direccion) bits.push(esc([s.distrito, s.direccion].filter(Boolean).join(" · ")));
  if (s.guia) bits.push(`Guía <b>${esc(s.guia)}</b>`);
  if (s.clave_recojo) bits.push(`Clave <b>${esc(s.clave_recojo)}</b>`);
  const atr = Object.entries(s.atributos || {}).map(([k, val]) => `${esc(k)}: ${esc(val)}`).join(" · ");
  if (atr) bits.push(atr);
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
      ${bits.length ? `<div class="pd-ship">${bits.join("<br>")}</div>` : ""}
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
        <div class="zn">${zona === "provincia" ? "AGENCIA" : "CONTRAENTREGA"}</div>
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
  .cpanel .cx-copiloto{border:1.5px solid var(--brand);border-radius:14px;padding:12px;margin:12px 0 4px;background:var(--surface-2);display:flex;flex-direction:column;gap:9px}
  .cpanel .cx-cop2-hd{display:flex;align-items:center;gap:8px;color:var(--brand)}
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
  .cpanel .cx-cop2-btn{flex:1;min-width:120px;height:38px;border-radius:10px;border:none;font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px}
  .cpanel .cx-cop2-btn.main{background:var(--green);color:#04140c}
  .cpanel .cx-cop2-btn.main.blue{background:var(--brand);color:#fff}
  .cpanel .cx-cop2-btn.main.amber{background:var(--amber);color:#231a05}
  .cpanel .cx-cop2-btn.main:hover{filter:brightness(1.07)}
  .cpanel .cx-cop2-btn.danger{flex:none;min-width:0;padding:0 14px;background:transparent;color:var(--red);border:1px solid var(--border)}
  .cpanel .cx-cop2-btn.danger:hover{background:var(--red-bg,rgba(239,68,68,.12))}
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
  .pd-ship{font-size:12px;color:var(--muted);line-height:1.5;border-top:1px dashed var(--border);padding-top:7px} .pd-ship b{color:var(--text)}
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
  .avz-op{display:flex;gap:9px;align-items:flex-start;padding:9px 11px;border:1px solid var(--border);border-radius:11px;
    margin-bottom:7px;cursor:pointer}
  .avz-op.on{border-color:var(--brand);background:var(--brand-bg,rgba(43,127,255,.10))}
  .avz-op.off{opacity:.55}
  .avz-op input{margin-top:2px;flex:none;width:auto;height:auto}
  .avz-op b{display:block;font-size:13px;margin-bottom:2px}
  .avz-op span{color:var(--muted);font-size:11.5px;line-height:1.45;display:block}
  .avz-op select{margin-top:7px}
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
// por defecto de cada uno se configura en Pagos y atención).
export async function cargarAviso(supa, channelId, contactId, momento) {
  const info = { abierta: false, restante: "", tpls: [], preferida: null, flujo: null, flujoId: null };
  try {
    const { data: conv } = await supa.from("conversations").select("expira_at").eq("contact_id", contactId).maybeSingle();
    const t = conv?.expira_at ? new Date(conv.expira_at).getTime() : 0;
    info.abierta = t > Date.now();
    if (info.abierta) {
      const m = Math.floor((t - Date.now()) / 60000);
      info.restante = m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
    }
  } catch (_) { /* sin conversación aún */ }
  try {
    const { data } = await supa.from("wa_templates").select("name,language,estado_meta,activa,body_preview")
      .eq("channel_id", channelId).order("name");
    info.tpls = (data || []).filter((t) => t.activa !== false && (t.estado_meta ?? "aprobada") === "aprobada");
  } catch (_) { /* sin plantillas */ }
  try {
    const { data: ch } = await supa.from("channels").select("pedidos_config").eq("id", channelId).maybeSingle();
    const a = ch?.pedidos_config?.avisos?.[momento];
    if (a && a.template) info.preferida = a;
  } catch (_) { /* sin config */ }
  // ¿QUÉ flujo va a salir? Decir "el aviso que tienes armado en Flujos" sin
  // nombrarlo no ayuda: hay varios y no se sabe cuál escucha este estado. Y si
  // no hay ninguno, hay que decirlo ANTES de guardar, no después.
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
  const hayFlujo = !!info.flujo;
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
    <label style="margin:0 0 8px">¿Cómo le aviso?</label>
    ${op("mensaje",
      hayFlujo ? `Tu aviso: “${esc(info.flujo)}”` : "Tu aviso de siempre",
      !hayFlujo ? "No tienes ningún flujo activo escuchando este estado, así que no se enviaría nada. Ármalo en Flujos con el disparador “Estado de pedido”."
        : info.abierta ? "Es el flujo que se dispara con este estado. Puedes editar su texto en Flujos."
        : "La ventana está cerrada: Meta lo va a rechazar y el cliente no recibirá nada.",
      hayFlujo ? `<a href="editor.html?flow=${encodeURIComponent(info.flujoId)}" target="_blank" style="font-size:11.5px;color:var(--brand);text-decoration:none;display:inline-block;margin-top:5px">Ver o editar este aviso →</a>` : "",
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
        <div><label>Nº de guía</label><input data-d="guia" value="${esc(s.guia || "")}" placeholder="Ej. 034-123456"/></div>
        <div><label>Clave de recojo</label><input data-d="clave" value="${esc(s.clave_recojo || "")}" placeholder="La entrega el remitente"/></div>
      </div>
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
    ov.querySelector(".cancel").onclick = () => cerrar(false);
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
      if (!guia) { toast("Falta el número de guía", true); return; }
      const flete = q("flete").value;
      const aviso = avisoValor(ov);
      const r = await updateOrder({ order_id: o.id, estado: "despachado", aviso, shipping: {
        agencia: q("agencia").value, sede: q("sede").value.trim(), guia,
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
  return B("lleg", "📍 Avisar que llegó");
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
    ${img ? `<img class="cx-cop2-img" src="${esc(img)}" data-full="${esc(img)}" alt="Comprobante"/>`
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
