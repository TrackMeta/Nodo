// ✨ MCP: usar Nodo desde Claude o ChatGPT (16-nov-2026).
// Ventana flotante que abre ⚙️ Configuración → «MCP» (shell.js). Estuvo como pestaña en Conexiones, pero Conexiones es
// del BOT elegido y el enlace es de la PERSONA: ve los bots de todos sus equipos, con su rol en cada uno. Rodrigo eligió
// el menú del engranaje, junto a «App para celular» (que tampoco es de un bot).
// Cada persona crea su ENLACE PERSONAL (functions/v1/mcp/<llave>) y lo pega en su IA como conector. La llave se muestra
// UNA sola vez: la base guarda solo su huella (mcp_tokens.token_hash, migración 0149).
import { supa, SUPABASE_URL, toast, icon, askChoice, confirmDialog, mountModal } from "./shell.js";

const BASE = `${SUPABASE_URL}/functions/v1/mcp/`;
const IA = { Claude: "../assets/apps/claude.png", ChatGPT: "../assets/apps/chatgpt.png" };
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

export function abrirMcp() {
  let nueva = null;   // { llave, nombre } recién creada: solo vive en esta ventana
  const { back, close } = mountModal(`<div class="nodo-modal nodo-mcp" role="dialog" aria-modal="true"><div class="mcp-cuerpo">
    <div class="mcp-cab"><span class="mcp-ic">${icon("cable")}</span><div><h3>Usa Nodo desde tu IA</h3>
      <small>Claude o ChatGPT trabajan en Nodo por ti</small></div></div>
    <div class="mcp-skel">Cargando…</div></div></div>`);
  back.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  const pintar = async () => {
    const { data, error } = await supa.from("mcp_tokens").select("id,nombre,prefijo,created_at,last_used_at").is("revoked_at", null).order("created_at", { ascending: false });
    const caja = back.querySelector(".mcp-cuerpo"); if (!caja) return;
    const lista = error ? [] : (data || []);
    caja.innerHTML = `
      <div class="mcp-cab"><span class="mcp-ic">${icon("cable")}</span><div><h3>Usa Nodo desde tu IA</h3>
        <small>Claude o ChatGPT trabajan en Nodo por ti</small></div>
        <button class="mcp-x" type="button" title="Cerrar" aria-label="Cerrar">${icon("x")}</button></div>
      <p>Pega tu enlace personal en Claude o ChatGPT y pídele las cosas con tus palabras. Ve <b>los bots de todos tus equipos</b>
        y, antes de cambiar algo, te muestra lo que va a hacer y espera tu «sí».</p>
      <div class="mcp-ej"><span>¿Cómo me fue esta semana?</span><span>¿Hay algo que deba atender?</span><span>Muéstrame el chat de Juan</span>
        <span>Sube el precio del curso a S/ 15</span><span>Agrega mi Yape</span></div>

      ${nueva ? `<div class="mcp-nueva">
        <b>Tu enlace de ${esc(nueva.nombre)} · cópialo ahora</b>
        <small>Por seguridad Nodo no lo vuelve a mostrar. Si lo pierdes, crea otro.</small>
        <div class="mcp-copy"><input readonly value="${esc(BASE + nueva.llave)}"/>
          <button type="button" id="mcpCopy" title="Copiar">${icon("copy")}</button></div>
      </div>` : ""}

      ${lista.length ? `<div class="mcp-t">Tus enlaces</div><div class="mcp-keys">${lista.map((k) => `
        <div class="mcp-key"><span class="kimg">${IA[k.nombre] ? `<img src="${IA[k.nombre]}" alt=""/>` : icon("sparkles")}</span>
          <div class="tx"><b>${esc(k.nombre)} <code>${esc(k.prefijo)}…</code></b>
            <small>Creado el ${fechaCorta(k.created_at)} · ${k.last_used_at ? "usado " + haceCuanto(k.last_used_at) : "todavía sin usar"}</small></div>
          <button class="mcp-off" type="button" data-revocar="${k.id}" data-nm="${esc(k.nombre)}">Desactivar</button></div>`).join("")}</div>` : ""}

      <details class="mcp-pasos" ${nueva?.nombre === "Claude" ? "open" : ""}>
        <summary>Cómo pegarlo en Claude</summary>
        <ol><li>En claude.ai entra a <b>Configuración → Conectores</b> <a href="https://claude.ai/settings/connectors" target="_blank" rel="noopener">Abrir ↗</a></li>
          <li><b>Agregar conector personalizado</b> · nombre: <b>Nodo</b> · URL: tu enlace</li>
          <li>En un chat nuevo, activa <b>Nodo</b> en el botón de herramientas y pregúntale lo que quieras</li></ol>
      </details>
      <details class="mcp-pasos" ${nueva?.nombre === "ChatGPT" ? "open" : ""}>
        <summary>Cómo pegarlo en ChatGPT</summary>
        <ol><li><b>Configuración → Aplicaciones y conectores → Configuración avanzada</b> → activa <b>Modo desarrollador</b> <a href="https://chatgpt.com/#settings/Connectors" target="_blank" rel="noopener">Abrir ↗</a></li>
          <li><b>Crear</b> · nombre: <b>Nodo</b> · URL del servidor MCP: tu enlace · autenticación: <b>ninguna</b></li>
          <li>En un chat nuevo, elige <b>Nodo</b> en el menú <b>+</b> y pregúntale lo que quieras</li></ol>
      </details>

      <p class="mcp-nota">Conectar WhatsApp y poner las claves de IA se sigue haciendo en el panel. <b>Quien tenga tu enlace puede usar Nodo
        como tú</b>: no lo compartas, y si crees que se filtró, desactívalo.</p>
      <div class="nb-acts"><button class="nb-btn" type="button" id="mcpCerrar">Cerrar</button>
        <button class="nb-btn primary" type="button" id="mcpCrear">${lista.length ? "Crear otro enlace" : "Crear mi enlace"}</button></div>`;
    caja.querySelector(".mcp-x").onclick = close;
    caja.querySelector("#mcpCerrar").onclick = close;
    const cp = caja.querySelector("#mcpCopy"); if (cp) cp.onclick = () => copiar(BASE + nueva.llave);
    caja.querySelector("#mcpCrear").onclick = crear;
    caja.querySelectorAll("[data-revocar]").forEach((b) => { b.onclick = () => revocar(b.dataset.revocar, b.dataset.nm); });
  };
  const crear = async () => {
    const nombre = await askChoice({ title: "¿Dónde vas a usar Nodo?", message: "Es solo para reconocer el enlace después.", options: [
      { value: "Claude", label: "Claude", desc: "claude.ai o la app de Claude", img: IA.Claude },
      { value: "ChatGPT", label: "ChatGPT", desc: "Necesita un plan de pago con modo desarrollador", img: IA.ChatGPT },
      { value: "Otra IA", label: "Otra IA", desc: "Cualquier app compatible con MCP", icon: "sparkles" }] });
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
    const ok = await confirmDialog({ title: `Desactivar el enlace de ${nombre}`,
      messageHtml: "La IA donde lo pegaste <b>deja de tener acceso a Nodo</b> al instante. No se puede volver a activar: si lo necesitas, creas otro.",
      confirmText: "Sí, desactivar", danger: true });
    if (!ok) return;
    const { error } = await supa.rpc("mcp_token_revocar", { p_id: id });
    if (error) { toast(error.message || "No se pudo desactivar", true); return; }
    nueva = null; toast("Enlace desactivado"); pintar();
  };
  pintar();
}
