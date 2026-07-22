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

// Estilos de las tarjetas nuevas de la ficha (Copiloto, Pedido, acciones,
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
  /* Colapso explícito (no depender del user-agent para ocultar el cuerpo) */
  .cpanel .cx-sec:not([open])>.cx-sec-body{display:none}
  .cpanel .cf-tech:not([open])>*:not(summary){display:none}
  .cpanel .cx-actions{display:flex;gap:8px;margin:12px 0 2px}
  .cpanel .cx-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:7px;height:38px;
    border-radius:10px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);
    font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:border-color .15s,transform .06s}
  .cpanel .cx-btn:hover{border-color:var(--brand)} .cpanel .cx-btn:active{transform:translateY(1px)}
  .cpanel .cx-btn svg{width:16px;height:16px}
  .cpanel .cx-btn.ia{background:linear-gradient(135deg,#a855f7,#ec4899);border:none;color:#fff;box-shadow:0 3px 10px rgba(168,85,247,.32)}
  .cpanel .cx-btn.ia:hover{background:linear-gradient(135deg,#9333ea,#db2777)}
  .cpanel .cx-btn:disabled{opacity:.5;cursor:not-allowed}
  /* Copiloto en la ficha */
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

let cssInjected = false;
export function injectExtrasCss() {
  if (cssInjected) return;
  cssInjected = true;
  document.head.insertAdjacentHTML("beforeend", `<style>${EXTRAS_CSS}</style>`);
}
