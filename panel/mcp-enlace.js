// 🔌 MCP: usar Nodo desde Claude o ChatGPT (16-nov-2026).
// Ventana flotante que abre ⚙️ Configuración → «MCP» (shell.js). Estuvo como pestaña en Conexiones, pero Conexiones es
// del BOT elegido y el enlace es de la PERSONA: ve los bots de todos sus equipos, con su rol en cada uno. Rodrigo eligió
// el menú del engranaje, junto a «App para celular» (que tampoco es de un bot), y el ícono «cable».
// Cada persona crea su ENLACE PERSONAL (functions/v1/mcp/<llave>) y lo pega en su IA como conector. La llave se muestra
// UNA sola vez: la base guarda solo su huella (mcp_tokens.token_hash, migración 0149).
// (16-nov, Rodrigo) Textos y diseño rehechos; solo Claude y ChatGPT (sin «Otra IA»).
import { supa, SUPABASE_URL, toast, icon, askChoice, confirmDialog, mountModal } from "./shell.js";

const BASE = `${SUPABASE_URL}/functions/v1/mcp/`;
const IA = {
  Claude: { img: "../assets/apps/claude.png", abrir: "https://claude.ai/settings/connectors", pasos: [
    `Entra a <b>claude.ai → Configuración → Conectores</b>.`,
    `Toca <b>Agregar conector personalizado</b>. Nombre: <b>Nodo</b>. URL: <b>pega tu enlace</b>.`,
    `En un chat, abre el botón de <b>herramientas</b>, activa <b>Nodo</b> y pregúntale lo que quieras.`] },
  ChatGPT: { img: "../assets/apps/chatgpt.png", abrir: "https://chatgpt.com/#settings/Connectors", pasos: [
    `Entra a <b>chatgpt.com → Configuración → Aplicaciones y conectores → Configuración avanzada</b> y activa el <b>Modo desarrollador</b>.`,
    `Toca <b>Crear</b>. Nombre: <b>Nodo</b>. URL: <b>pega tu enlace</b>. Autenticación: <b>ninguna</b>.`,
    `En un chat, toca <b>+</b>, elige <b>Nodo</b> y pregúntale lo que quieras.`] },
};
const EJEMPLOS = ["¿Cómo me fue esta semana?", "¿Qué clientes están por comprar?", "¿Hay algo que deba atender?", "Sube el precio del curso a S/ 15"];
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
    <div><h3>Conecta Nodo con tu IA</h3><small>Claude o ChatGPT revisan y manejan Nodo por ti</small></div>
    ${conX ? `<button class="mcp-x" type="button" title="Cerrar" aria-label="Cerrar">${icon("x")}</button>` : ""}</div>`;
const guia = (nombre, abierta) => `
  <details class="mcp-guia" ${abierta ? "open" : ""}>
    <summary><span class="kimg">${logo(nombre)}</span><span class="g-tx">Conectarlo en <b>${nombre}</b></span>${icon("chevronRight", "g-ch")}</summary>
    <ol>${IA[nombre].pasos.map((p, i) => `<li><span class="n">${i + 1}</span><span>${p}${i === 0 ? ` <a href="${IA[nombre].abrir}" target="_blank" rel="noopener">Abrir ↗</a>` : ""}</span></li>`).join("")}</ol>
  </details>`;

export function abrirMcp() {
  let nueva = null;   // { llave, nombre } recién creada: solo vive en esta ventana
  const { back, close } = mountModal(`<div class="nodo-modal nodo-mcp" role="dialog" aria-modal="true"><div class="mcp-cuerpo">
    ${cabecera(false)}<div class="mcp-skel">Cargando…</div></div></div>`);
  back.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  const pintar = async () => {
    const { data, error } = await supa.from("mcp_tokens").select("id,nombre,prefijo,created_at,last_used_at").is("revoked_at", null).order("created_at", { ascending: false });
    const caja = back.querySelector(".mcp-cuerpo"); if (!caja) return;
    const lista = error ? [] : (data || []);
    caja.innerHTML = `
      ${cabecera(true)}
      <p class="mcp-intro">Pega tu enlace en Claude o ChatGPT y háblale como a un asistente: revisa los bots de todos tus equipos
        y <b>siempre te pregunta antes de cambiar algo</b>.</p>
      <div class="mcp-t">Pídele cosas como</div>
      <div class="mcp-ej">${EJEMPLOS.map((e) => `<span>«${esc(e)}»</span>`).join("")}</div>

      ${nueva ? `<div class="mcp-nueva">
        <div class="nv-t">${icon("check")}<b>Listo: tu enlace para ${esc(nueva.nombre)}</b></div>
        <small>Ya está copiado. Pégalo en ${esc(nueva.nombre)} con los pasos de abajo. Guárdalo bien: por seguridad no se vuelve a mostrar.</small>
        <div class="mcp-copy"><input readonly value="${esc(BASE + nueva.llave)}"/>
          <button type="button" id="mcpCopy" title="Copiar">${icon("copy")}</button></div>
      </div>` : ""}

      <div class="mcp-t">Tus enlaces</div>
      ${lista.length ? `<div class="mcp-keys">${lista.map((k) => `
        <div class="mcp-key"><span class="kimg">${logo(k.nombre)}</span>
          <div class="tx"><b>${esc(k.nombre)}</b><small>Creado el ${fechaCorta(k.created_at)} · <code>${esc(k.prefijo)}…</code></small></div>
          <span class="uso ${k.last_used_at ? "on" : ""}">${k.last_used_at ? "Usado " + haceCuanto(k.last_used_at) : "Sin usar"}</span>
          <button class="mcp-off" type="button" data-revocar="${k.id}" data-nm="${esc(k.nombre)}" title="Desactivar este enlace">Desactivar</button></div>`).join("")}</div>`
        : `<div class="mcp-vacio">Todavía no tienes un enlace. Créalo y pégalo en tu IA en un minuto.</div>`}

      <div class="mcp-t">Cómo conectarlo</div>
      ${guia("Claude", nueva?.nombre === "Claude")}
      ${guia("ChatGPT", nueva?.nombre === "ChatGPT")}

      <div class="mcp-seg">${icon("lock")}<span>Tu enlace es como una contraseña: <b>quien lo tenga puede usar Nodo como tú</b>.
        No lo compartas, y si crees que se filtró, desactívalo y crea otro.</span></div>
      <div class="nb-acts"><button class="nb-btn" type="button" id="mcpCerrar">Cerrar</button>
        <button class="nb-btn primary" type="button" id="mcpCrear">${icon("plus")}${lista.length ? "Crear otro enlace" : "Crear mi enlace"}</button></div>`;
    caja.querySelector(".mcp-x").onclick = close;
    caja.querySelector("#mcpCerrar").onclick = close;
    const cp = caja.querySelector("#mcpCopy"); if (cp) cp.onclick = () => copiar(BASE + nueva.llave);
    caja.querySelector("#mcpCrear").onclick = crear;
    caja.querySelectorAll("[data-revocar]").forEach((b) => { b.onclick = () => revocar(b.dataset.revocar, b.dataset.nm); });
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
  const revocar = async (id, nombre) => {
    const ok = await confirmDialog({ title: `¿Desactivar el enlace de ${nombre}?`,
      messageHtml: `${esc(nombre)} <b>dejará de tener acceso a Nodo</b> al instante. No se puede volver a activar: si lo necesitas, creas uno nuevo.`,
      confirmText: "Sí, desactivar", danger: true });
    if (!ok) return;
    const { error } = await supa.rpc("mcp_token_revocar", { p_id: id });
    if (error) { toast(error.message || "No se pudo desactivar", true); return; }
    nueva = null; toast("Enlace desactivado"); pintar();
  };
  pintar();
}
