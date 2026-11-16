// 🔌 MCP: usar Nodo desde Claude o ChatGPT (16-nov-2026).
// Ventana flotante que abre ⚙️ Configuración → «MCP» (shell.js). Estuvo como pestaña en Conexiones, pero Conexiones es
// del BOT elegido y el enlace es de la PERSONA: ve los bots de todos sus equipos, con su rol en cada uno. Rodrigo eligió
// el menú del engranaje, junto a «App para celular» (que tampoco es de un bot), y el ícono «cable».
// Cada persona crea su ENLACE PERSONAL (functions/v1/mcp/<llave>) y lo pega en su IA como conector. La llave se muestra
// UNA sola vez: la base guarda solo su huella (mcp_tokens.token_hash, migración 0149).
// (16-nov, Rodrigo) Textos y diseño rehechos; solo Claude y ChatGPT (sin «Otra IA»).
// (16-nov, Rodrigo eligió comodidad) «Ver»: la llave también se guarda cifrada en Vault (migración 0150) y su dueño
// puede volver a verla. Las creadas antes de 0150 no tienen copia: esas no muestran «Ver».
// (16-nov) «Descargar complemento (.zip)» en la caja verde: el paquete de Claude/ChatGPT con el enlace adentro (mcp-zip.js).
import { supa, SUPABASE_URL, toast, icon, askChoice, confirmDialog, mountModal } from "./shell.js";

const BASE = `${SUPABASE_URL}/functions/v1/mcp/`;
const IA = {
  Claude: { img: "../assets/apps/claude.png", abrir: "https://claude.ai/settings/connectors", pasos: [
    `Entra a <b>claude.ai → Configuración → Conectores</b>.`,
    `Toca <b>Agregar conector personalizado</b>. Nombre: <b>Nodo</b>. URL: <b>pega tu enlace</b>.`,
    `En un chat, abre el botón de <b>herramientas</b>, activa <b>Nodo</b> y pregúntale lo que quieras.`],
    zip: `<b>Con el complemento (.zip):</b> en claude.ai entra a <b>Personalizar → Plugins → Añadir → Subir plugin</b>, sube <b>nodo-claude.zip</b> y conéctalo en su pestaña <b>Conectores</b>.` },
  // (16-nov) Pasos de ChatGPT según su pantalla nueva (captura de Rodrigo): «Complementos → Añadir».
  ChatGPT: { img: "../assets/apps/chatgpt.png", abrir: "https://chatgpt.com/plugins", pasos: [
    `Entra a <b>chatgpt.com → Complementos</b> y toca <b>Añadir</b> (arriba a la derecha).`,
    `Elige <b>Añadir servidor MCP personalizado</b>. Nombre: <b>Nodo</b>. URL: <b>pega tu enlace</b>. Autenticación: <b>ninguna</b>.`,
    `En un chat, toca <b>+</b>, elige <b>Nodo</b> y pregúntale lo que quieras.`],
    zip: `<b>Con el complemento (.zip):</b> en <b>Añadir</b> elige <b>Subir archivo comprimido del complemento</b> y sube <b>nodo-chatgpt.zip</b>.` },
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function haceCuanto(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 2) return "hace un momento"; if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60); if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24); return d === 1 ? "ayer" : `hace ${d} días`;
}
const fechaCorta = (iso) => new Date(iso).toLocaleDateString("es-PE", { day: "numeric", month: "short", timeZone: "America/Lima" });
async function copiar(txt) {
  try { await navigator.clipboard.writeText(txt); toast("Enlace copiado"); }
  catch { toast("No se pudo copiar — selecciónalo a mano", true); }
}
const logo = (nombre) => IA[nombre] ? `<img src="${IA[nombre].img}" alt=""/>` : icon("cable");
const cabecera = (conX) => `
  <div class="mcp-cab"><span class="mcp-ic">${icon("cable")}</span>
    <div><h3>MCP</h3><small>Claude o ChatGPT revisan y manejan Nodo por ti</small></div>
    ${conX ? `<button class="mcp-x" type="button" title="Cerrar" aria-label="Cerrar">${icon("x")}</button>` : ""}</div>`;
const guia = (nombre, abierta) => `
  <details class="mcp-guia" ${abierta ? "open" : ""}>
    <summary><span class="kimg">${logo(nombre)}</span><span class="g-tx">Conectarlo en <b>${nombre}</b></span>${icon("chevronRight", "g-ch")}</summary>
    <ol>${IA[nombre].pasos.map((p, i) => `<li><span class="n">${i + 1}</span><span>${p}${i === 0 ? ` <a href="${IA[nombre].abrir}" target="_blank" rel="noopener">Abrir ↗</a>` : ""}</span></li>`).join("")}</ol>
    <div class="g-zip">${icon("download")}<span>${IA[nombre].zip}</span></div>
  </details>`;

export function abrirMcp() {
  let nueva = null;   // { llave, nombre } recién creada: solo vive en esta ventana
  const { back, close } = mountModal(`<div class="nodo-modal nodo-mcp" role="dialog" aria-modal="true"><div class="mcp-cuerpo">
    ${cabecera(false)}<div class="mcp-skel">Cargando…</div></div></div>`);
  back.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  const pintar = async () => {
    const [{ data, error }, { data: vis }] = await Promise.all([
      supa.from("mcp_tokens").select("id,nombre,prefijo,created_at,last_used_at").is("revoked_at", null).order("created_at", { ascending: false }),
      supa.rpc("mcp_tokens_visibles"),
    ]);
    const visibles = new Set((vis || []).map((x) => typeof x === "string" ? x : Object.values(x)[0]));
    const caja = back.querySelector(".mcp-cuerpo"); if (!caja) return;
    const lista = error ? [] : (data || []);
    caja.innerHTML = `
      ${cabecera(true)}
      <p class="mcp-intro">Pega tu enlace en Claude o ChatGPT y háblale como a un asistente: revisa los bots de todos tus equipos
        y <b>siempre te pregunta antes de cambiar algo</b>.</p>

      ${nueva ? `<div class="mcp-nueva">
        <div class="nv-t">${icon(nueva.visto ? "link" : "check")}<b>${nueva.visto ? "Tu enlace" : "Listo: tu enlace"} para ${esc(nueva.nombre)}</b></div>
        <small>Ya está copiado. Pégalo en ${esc(nueva.nombre)} con los pasos de abajo. Si lo necesitas otra vez, toca «Ver» en tus enlaces.</small>
        <div class="mcp-copy"><input readonly value="${esc(BASE + nueva.llave)}"/>
          <button type="button" id="mcpCopy" title="Copiar">${icon("copy")}</button></div>
        ${IA[nueva.nombre] ? `<button type="button" class="mcp-zipbtn" id="mcpZip">${icon("download")}Descargar complemento para ${esc(nueva.nombre)} (.zip)</button>
        <small class="zip-nota">Trae tu enlace adentro: cuídalo igual que el enlace.</small>` : ""}
      </div>` : ""}

      <div class="mcp-t">Tus enlaces</div>
      ${lista.length ? `<div class="mcp-keys">${lista.map((k) => `
        <div class="mcp-key"><span class="kimg">${logo(k.nombre)}</span>
          <div class="tx"><b>${esc(k.nombre)}</b><small>Creado el ${fechaCorta(k.created_at)} · <code>${esc(k.prefijo)}…</code></small></div>
          <span class="uso ${k.last_used_at ? "on" : ""}">${k.last_used_at ? "Usado " + haceCuanto(k.last_used_at) : "Sin usar"}</span>
          ${visibles.has(k.id) ? `<button class="mcp-ver" type="button" data-ver="${k.id}" data-nm="${esc(k.nombre)}" title="Ver y copiar el enlace">${icon("eye")}Ver</button>` : ""}
          <button class="mcp-off" type="button" data-revocar="${k.id}" data-nm="${esc(k.nombre)}" title="Desactivar este enlace">Desactivar</button></div>`).join("")}</div>`
        : `<div class="mcp-vacio">Todavía no tienes un enlace. Créalo y pégalo en tu IA en un minuto.</div>`}

      <div class="mcp-t">Cómo conectarlo</div>
      ${guia("Claude", nueva?.nombre === "Claude")}
      ${guia("ChatGPT", nueva?.nombre === "ChatGPT")}

      <div class="nb-acts"><button class="nb-btn" type="button" id="mcpCerrar">Cerrar</button>
        <button class="nb-btn primary" type="button" id="mcpCrear">${icon("plus")}${lista.length ? "Crear otro enlace" : "Crear mi enlace"}</button></div>`;
    caja.querySelector(".mcp-x").onclick = close;
    caja.querySelector("#mcpCerrar").onclick = close;
    const cp = caja.querySelector("#mcpCopy"); if (cp) cp.onclick = () => copiar(BASE + nueva.llave);
    const zb = caja.querySelector("#mcpZip");
    if (zb) zb.onclick = async () => {
      zb.disabled = true;
      try { const m = await import("./mcp-zip.js?v=1"); await m.descargarComplemento(nueva.nombre, BASE + nueva.llave); toast("Complemento descargado"); }
      catch (e) { toast("No se pudo armar el complemento", true); }
      zb.disabled = false;
    };
    caja.querySelector("#mcpCrear").onclick = crear;
    caja.querySelectorAll("[data-revocar]").forEach((b) => { b.onclick = () => revocar(b.dataset.revocar, b.dataset.nm); });
    caja.querySelectorAll("[data-ver]").forEach((b) => { b.onclick = () => ver(b.dataset.ver, b.dataset.nm); });
  };
  const crear = async () => {
    const nombre = await askChoice({ title: "¿En qué IA lo vas a usar?", message: "Así te mostramos los pasos para conectarla.", options: [
      { value: "Claude", label: "Claude", desc: "En claude.ai, la app de escritorio o el celular", img: IA.Claude.img },
      { value: "ChatGPT", label: "ChatGPT", desc: "En chatgpt.com · necesita un plan de pago (Plus o Pro)", img: IA.ChatGPT.img }] });
    if (!nombre || !back.isConnected) return;
    const btn = back.querySelector("#mcpCrear"); if (btn) { btn.disabled = true; btn.textContent = "Creando…"; }
    const { data, error } = await supa.rpc("mcp_token_crear", { p_nombre: nombre });
    if (error) {
      if (btn) { btn.disabled = false; btn.textContent = "Crear mi enlace"; }
      toast(/demasiadas_llaves/.test(error.message || "") ? "Tienes 5 enlaces activos: desactiva uno para crear otro" : (error.message || "No se pudo crear el enlace"), true);
      return;
    }
    nueva = { llave: data, nombre };
    await pintar();
    copiar(BASE + data);
  };
  const ver = async (id, nombre) => {
    const { data, error } = await supa.rpc("mcp_token_ver", { p_id: id });
    if (error || !data) { toast("No se pudo mostrar este enlace", true); return; }
    nueva = { llave: data, nombre, visto: true };
    await pintar();
    back.querySelector(".mcp-nueva")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    copiar(BASE + data);
  };
  const revocar = async (id, nombre) => {
    const ok = await confirmDialog({ title: `¿Desactivar el enlace de ${nombre}?`,
      messageHtml: `${esc(nombre)} <b>dejará de tener acceso a Nodo</b> al instante y el enlace se borra. No se puede volver a activar: si lo necesitas, creas uno nuevo.`,
      confirmText: "Sí, desactivar", danger: true });
    if (!ok) return;
    const { error } = await supa.rpc("mcp_token_revocar", { p_id: id });
    if (error) { toast(error.message || "No se pudo desactivar", true); return; }
    nueva = null; toast("Enlace desactivado"); pintar();
  };
  pintar();
}
