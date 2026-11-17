// 🔌 MCP: usar Nodo desde Claude o ChatGPT (16-nov-2026).
// Ventana flotante que abre ⚙️ Configuración → «MCP» (shell.js). Estuvo como pestaña en Conexiones, pero Conexiones es
// del BOT elegido y el enlace es de la PERSONA: ve los bots de todos sus equipos, con su rol en cada uno. Rodrigo eligió
// el menú del engranaje, junto a «App para celular» (que tampoco es de un bot), y el ícono «cable».
// Cada persona crea su ENLACE PERSONAL (functions/v1/mcp/<llave>) y lo pega en su IA como conector.
// (16-nov, Rodrigo eligió comodidad) «Ver»: la llave también se guarda cifrada en Vault (migración 0150) y su dueño
// puede volver a verla. Las creadas antes de 0150 no tienen copia: esas no muestran «Ver».
// (16/17-nov) ChatGPT = enlace + complemento .zip con logo (mcp-zip.js). El .zip se VINCULA a la conexión que el cliente
// crea con su enlace (ID asdk_app_…). ChatGPT no manda ese ID al conectarse (medido el 17-nov), así que el cliente lo
// pega una vez y Nodo lo guarda (mcp_tokens.app_id, migración 0154). Rodrigo eligió este camino y pidió:
//   1) pasos guiados 1-2-3; 2) detectar solo que ChatGPT ya se conectó (last_used_at); 3) sacar el ID de cualquier texto
//   pegado; 4) recordar el ID y volver a descargar desde la lista. La conexión se llama «Conexión Nodo» para que no se
//   confunda con el complemento «Nodo» (con logo) en el menú @ del chat.
import { supa, SUPABASE_URL, toast, icon, askChoice, confirmDialog, mountModal } from "./shell.js";

const BASE = `${SUPABASE_URL}/functions/v1/mcp/`;
const NOMBRE_CONEXION = "Conexión Nodo";
const IA = {
  Claude: { img: "../assets/apps/claude.png", abrir: "https://claude.ai/settings/connectors", pasos: [
    `Entra a <b>claude.ai → Configuración → Conectores</b>.`,
    `Toca <b>Agregar conector personalizado</b>. Nombre: <b>Nodo</b>. URL: <b>pega tu enlace</b>.`,
    `En un chat, abre el botón de <b>herramientas</b>, activa <b>Nodo</b> y pregúntale lo que quieras.`],
    zip: `<b>Con el complemento (.zip):</b> en claude.ai entra a <b>Personalizar → Plugins → Añadir → Subir plugin</b>, sube <b>nodo-claude.zip</b> y conéctalo en su pestaña <b>Conectores</b>.` },
  ChatGPT: { img: "../assets/apps/chatgpt.png", abrir: "https://chatgpt.com/plugins", pasos: [
    `Crea tu enlace de ChatGPT aquí en Nodo y sigue los <b>3 pasos</b> que aparecen: conectar el enlace, pegar el ID y subir el complemento.`,
    `La conexión se llama <b>${NOMBRE_CONEXION}</b> y el complemento <b>Nodo</b> (con logo). En el chat usa <b>@Nodo</b>.`,
    `No borres <b>${NOMBRE_CONEXION}</b>: el complemento la usa para leer tus datos.`],
    zip: `Si ya hiciste los pasos y perdiste el complemento, tócalo en <b>Tus enlaces → Complemento</b> y vuelve a subirlo.` },
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function haceCuanto(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 2) return "hace un momento"; if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60); if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24); return d === 1 ? "ayer" : `hace ${d} días`;
}
const fechaCorta = (iso) => new Date(iso).toLocaleDateString("es-PE", { day: "numeric", month: "short", timeZone: "America/Lima" });
async function copiar(txt, aviso = "Enlace copiado") {
  try { await navigator.clipboard.writeText(txt); toast(aviso); }
  catch { toast("No se pudo copiar — selecciónalo a mano", true); }
}
// El «ID de la aplicación» dentro de cualquier texto pegado (la pantalla entera de ChatGPT trae también el ID de
// VERSIÓN, asdk_app_v_…, que NO sirve).
const sacarAppId = (t) => (String(t || "").match(/asdk_app_(?!v_)[A-Za-z0-9]+/) || [])[0] || "";
const logo = (nombre) => IA[nombre] ? `<img src="${IA[nombre].img}" alt=""/>` : icon("cable");
const cabecera = (conX) => `
  <div class="mcp-cab"><span class="mcp-ic">${icon("cable")}</span>
    <div><h3>MCP</h3><small>Claude o ChatGPT revisan y manejan Nodo por ti</small></div>
    ${conX ? `<button class="mcp-x" type="button" title="Cerrar" aria-label="Cerrar">${icon("x")}</button>` : ""}</div>`;
const guia = (nombre, abierta) => `
  <details class="mcp-guia" ${abierta ? "open" : ""}>
    <summary><span class="kimg">${logo(nombre)}</span><span class="g-tx">Conectarlo en <b>${nombre}</b></span>${icon("chevronRight", "g-ch")}</summary>
    <ol>${IA[nombre].pasos.map((p, i) => `<li><span class="n">${i + 1}</span><span>${p}${i === 0 && nombre === "Claude" ? ` <a href="${IA[nombre].abrir}" target="_blank" rel="noopener">Abrir ↗</a>` : ""}</span></li>`).join("")}</ol>
    <div class="g-zip">${icon("download")}<span>${IA[nombre].zip}</span></div>
  </details>`;

// Dibujo (con datos de ejemplo) de la pantalla de ChatGPT donde está el ID: «este sí» / «este no».
const dibujoId = `
  <div class="mcp-dib" aria-hidden="true">
    <div class="d-cab"><span class="d-ok">${icon("check")}</span><b>${NOMBRE_CONEXION}</b><span class="d-btn">Ver detalles</span></div>
    <div class="d-sec">Información</div>
    <div class="d-fila"><span>URL</span><span>https://…/mcp/nodo_••••</span></div>
    <div class="d-fila no"><span>ID de versión</span><span>asdk_app_v_6afb…</span><em>este no</em></div>
    <div class="d-fila si"><span>ID de la aplicación</span><span>asdk_app_6afb…</span><em>${icon("check")}este</em></div>
  </div>`;

export function abrirMcp() {
  let nueva = null;      // enlace abierto en la ventana: { id, llave, nombre, visto, appId, usado }
  let sondeo = null;     // revisa cada 4 s si ChatGPT ya se conectó (paso 1)
  const { back, close: cerrar } = mountModal(`<div class="nodo-modal nodo-mcp" role="dialog" aria-modal="true"><div class="mcp-cuerpo">
    ${cabecera(false)}<div class="mcp-skel">Cargando…</div></div></div>`);
  const close = () => { clearInterval(sondeo); cerrar(); };
  back.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  back.addEventListener("mousedown", (e) => { if (e.target === back) clearInterval(sondeo); });

  const descargar = async (ia, url, appId) => {
    const m = await import("./mcp-zip.js?v=6");
    await m.descargarComplemento(ia, url, appId);
    toast("Complemento descargado");
  };

  // ── Los 3 pasos de ChatGPT ──
  const pasosChatGPT = (n) => {
    const p1 = !!n.usado, p2 = !!n.appId;
    const est = (hecho, activo) => hecho ? "hecho" : activo ? "activo" : "";
    return `<div class="mcp-wiz">
      <div class="w-tit">${icon("link")}<b>Conectar Nodo en ChatGPT</b><span>Paso ${p1 ? (p2 ? 3 : 2) : 1} de 3</span></div>

      <div class="w-paso ${est(p1, true)}" data-paso="1">
        <div class="w-n">${p1 ? icon("check") : "1"}</div>
        <div class="w-cuerpo"><b>Conecta tu enlace en ChatGPT</b>
          <ol class="w-mini">
            <li>En ChatGPT: <b>Complementos → Añadir → Agregar servidor MCP personalizado</b>.</li>
            <li>Nombre: <b>${NOMBRE_CONEXION}</b> <button type="button" class="w-chip" id="wNombre">${icon("copy")}Copiar</button></li>
            <li>URL del servidor: tu enlace · Autenticación: <b>Sin autenticación</b>.</li>
            <li>Marca <b>Entiendo y quiero continuar</b> y toca <b>Crear como complemento</b>.</li>
          </ol>
          <div class="mcp-copy"><input readonly value="${esc(BASE + n.llave)}"/>
            <button type="button" id="mcpCopy" title="Copiar enlace">${icon("copy")}</button></div>
          <div class="w-acc"><a class="w-btn" href="${IA.ChatGPT.abrir}" target="_blank" rel="noopener">Abrir ChatGPT ↗</a>
            <span class="w-est" id="wEst1">${p1 ? `${icon("check")}ChatGPT ya se conectó` : `<i class="w-spin"></i>Esperando que ChatGPT se conecte…`}</span></div>
        </div>
      </div>

      <div class="w-paso ${est(p2, p1)}" data-paso="2">
        <div class="w-n">${p2 ? icon("check") : "2"}</div>
        <div class="w-cuerpo"><b>Copia el «ID de la aplicación»</b>
          <small>En ChatGPT abre <b>${NOMBRE_CONEXION}</b>, toca <b>Administrar</b>, baja a <b>Información</b> y copia el <b>ID de la aplicación</b>. También puedes copiar toda esa pantalla: Nodo saca el ID solo.</small>
          ${dibujoId}
          <input class="in w-in" id="mcpAppId" value="${esc(n.appId || "")}" placeholder="Pega aquí el ID (asdk_app_…) o el texto de esa pantalla" autocomplete="off" spellcheck="false"/>
          <span class="w-est" id="wEst2">${p2 ? `${icon("check")}ID guardado` : ""}</span>
        </div>
      </div>

      <div class="w-paso ${est(false, p2)}" data-paso="3">
        <div class="w-n">3</div>
        <div class="w-cuerpo"><b>Instala el complemento con el logo</b>
          <small>En ChatGPT: <b>Complementos → Añadir → Subir archivo comprimido del complemento</b> y sube <b>nodo-chatgpt.zip</b>. Después, en un chat nuevo escribe <b>@Nodo</b>.</small>
          <button type="button" class="mcp-zipbtn" id="mcpZip" ${p2 ? "" : "disabled"}>${icon("download")}Descargar complemento (.zip)</button>
          <small class="zip-nota">No borres <b>${NOMBRE_CONEXION}</b> en ChatGPT: el complemento la usa para leer tus datos.</small>
        </div>
      </div>
    </div>`;
  };

  const pintar = async () => {
    const [{ data, error }, { data: vis }] = await Promise.all([
      supa.from("mcp_tokens").select("id,nombre,prefijo,created_at,last_used_at,app_id").is("revoked_at", null).order("created_at", { ascending: false }),
      supa.rpc("mcp_tokens_visibles"),
    ]);
    const visibles = new Set((vis || []).map((x) => typeof x === "string" ? x : Object.values(x)[0]));
    const caja = back.querySelector(".mcp-cuerpo"); if (!caja) return;
    const lista = error ? [] : (data || []);
    if (nueva) { const k = lista.find((x) => x.id === nueva.id); if (k) { nueva.usado = nueva.usado || !!k.last_used_at; nueva.appId = nueva.appId || k.app_id || ""; } }
    const esGPT = nueva?.nombre === "ChatGPT";
    caja.innerHTML = `
      ${cabecera(true)}
      <p class="mcp-intro">Pega tu enlace en Claude o ChatGPT y háblale como a un asistente: revisa los bots de todos tus equipos
        y <b>siempre te pregunta antes de cambiar algo</b>.</p>

      ${esGPT ? pasosChatGPT(nueva) : nueva ? `<div class="mcp-nueva">
        <div class="nv-t">${icon(nueva.visto ? "link" : "check")}<b>${nueva.visto ? "Tu enlace" : "Listo: tu enlace"} para ${esc(nueva.nombre)}</b></div>
        <small>Ya está copiado. Pégalo en ${esc(nueva.nombre)} con los pasos de abajo. Si lo necesitas otra vez, toca «Ver» en tus enlaces.</small>
        <div class="mcp-copy"><input readonly value="${esc(BASE + nueva.llave)}"/>
          <button type="button" id="mcpCopy" title="Copiar">${icon("copy")}</button></div>
        <button type="button" class="mcp-zipbtn" id="mcpZip">${icon("download")}Descargar complemento para ${esc(nueva.nombre)} (.zip)</button>
        <small class="zip-nota">Trae tu enlace adentro: cuídalo igual que el enlace.</small>
      </div>` : ""}

      <div class="mcp-t">Tus enlaces</div>
      ${lista.length ? `<div class="mcp-keys">${lista.map((k) => `
        <div class="mcp-key"><span class="kimg">${logo(k.nombre)}</span>
          <div class="tx"><b>${esc(k.nombre)}</b><small>Creado el ${fechaCorta(k.created_at)} · <code>${esc(k.prefijo)}…</code></small></div>
          <span class="uso ${k.last_used_at ? "on" : ""}">${k.last_used_at ? "Usado " + haceCuanto(k.last_used_at) : "Sin usar"}</span>
          ${k.nombre === "ChatGPT" && k.app_id ? `<button class="mcp-ver" type="button" data-zip="${k.id}" title="Volver a descargar el complemento con logo">${icon("download")}Complemento</button>` : ""}
          ${visibles.has(k.id) ? `<button class="mcp-ver" type="button" data-ver="${k.id}" data-nm="${esc(k.nombre)}" title="Ver el enlace${k.nombre === "ChatGPT" ? " y los pasos" : ""}">${icon("eye")}Ver</button>` : ""}
          <button class="mcp-off" type="button" data-revocar="${k.id}" data-nm="${esc(k.nombre)}" title="Desactivar este enlace">Desactivar</button></div>`).join("")}</div>`
        : `<div class="mcp-vacio">Todavía no tienes un enlace. Créalo y pégalo en tu IA en un minuto.</div>`}

      <div class="mcp-t">Cómo conectarlo</div>
      ${guia("Claude", nueva?.nombre === "Claude")}
      ${guia("ChatGPT", false)}

      <div class="nb-acts"><button class="nb-btn" type="button" id="mcpCerrar">Cerrar</button>
        <button class="nb-btn primary" type="button" id="mcpCrear">${icon("plus")}${lista.length ? "Crear otro enlace" : "Crear mi enlace"}</button></div>`;

    caja.querySelector(".mcp-x").onclick = close;
    caja.querySelector("#mcpCerrar").onclick = close;
    caja.querySelector("#mcpCrear").onclick = crear;
    caja.querySelectorAll("[data-revocar]").forEach((b) => { b.onclick = () => revocar(b.dataset.revocar, b.dataset.nm); });
    caja.querySelectorAll("[data-ver]").forEach((b) => { b.onclick = () => ver(b.dataset.ver, b.dataset.nm); });
    caja.querySelectorAll("[data-zip]").forEach((b) => { b.onclick = async () => {
      const k = lista.find((x) => x.id === b.dataset.zip); if (!k) return;
      b.disabled = true; try { await descargar("ChatGPT", "", k.app_id); } catch (e) { toast(e.message || "No se pudo armar el complemento", true); } b.disabled = false;
    }; });
    const cp = caja.querySelector("#mcpCopy"); if (cp) cp.onclick = () => copiar(BASE + nueva.llave);
    const zb = caja.querySelector("#mcpZip");
    if (zb) zb.onclick = async () => {
      zb.disabled = true;
      try { await descargar(nueva.nombre, BASE + nueva.llave, nueva.appId); }
      catch (e) { toast(e.message || "No se pudo armar el complemento", true); }
      finally { zb.disabled = esGPT && !nueva.appId; }
    };
    if (esGPT) cablearPasos(caja);
  };

  // Paso 1 (sondeo de la conexión) y paso 2 (pegar el ID) sin repintar todo, para no perder lo que se escribe.
  const cablearPasos = (caja) => {
    const nb = caja.querySelector("#wNombre"); if (nb) nb.onclick = () => copiar(NOMBRE_CONEXION, "Nombre copiado");
    clearInterval(sondeo);
    if (!nueva.usado && nueva.id) sondeo = setInterval(async () => {
      if (!back.isConnected) { clearInterval(sondeo); return; }
      const { data } = await supa.from("mcp_tokens").select("last_used_at").eq("id", nueva.id).maybeSingle();
      if (data?.last_used_at) { clearInterval(sondeo); nueva.usado = true; toast("ChatGPT ya se conectó: sigue con el paso 2"); pintar(); }
    }, 4000);
    const inp = caja.querySelector("#mcpAppId"), est = caja.querySelector("#wEst2");
    if (!inp) return;
    let ultimo = nueva.appId || "";
    const revisar = async () => {
      const crudo = inp.value.trim();
      const id = sacarAppId(crudo);
      if (!crudo) { est.innerHTML = ""; return; }
      if (!id) { est.innerHTML = `<span class="w-mal">${/asdk_app_v_/.test(crudo) ? "Ese es el ID de versión: copia el de abajo, «ID de la aplicación»." : "No veo un ID que empiece con asdk_app_"}</span>`; return; }
      if (inp.value !== id) inp.value = id;
      if (id === ultimo) return;
      const { error } = await supa.rpc("mcp_token_app", { p_id: nueva.id, p_app: id });
      if (error) { est.innerHTML = `<span class="w-mal">No se pudo guardar el ID</span>`; return; }
      ultimo = id; nueva.appId = id; nueva.usado = true;
      toast("ID guardado: descarga el complemento");
      pintar();
    };
    inp.addEventListener("input", revisar);
    inp.addEventListener("paste", () => setTimeout(revisar, 0));
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
    const { data: fila } = await supa.from("mcp_tokens").select("id").eq("prefijo", String(data).slice(0, 11)).is("revoked_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    nueva = { id: fila?.id || null, llave: data, nombre, usado: false, appId: "" };
    await pintar();
    copiar(BASE + data);
  };
  const ver = async (id, nombre) => {
    const { data, error } = await supa.rpc("mcp_token_ver", { p_id: id });
    if (error || !data) { toast("No se pudo mostrar este enlace", true); return; }
    nueva = { id, llave: data, nombre, visto: true };
    await pintar();
    back.querySelector(".mcp-wiz, .mcp-nueva")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (nombre !== "ChatGPT") copiar(BASE + data);
  };
  const revocar = async (id, nombre) => {
    const ok = await confirmDialog({ title: `¿Desactivar el enlace de ${nombre}?`,
      messageHtml: `${esc(nombre)} <b>dejará de tener acceso a Nodo</b> al instante y el enlace se borra. No se puede volver a activar: si lo necesitas, creas uno nuevo.`,
      confirmText: "Sí, desactivar", danger: true });
    if (!ok) return;
    const { error } = await supa.rpc("mcp_token_revocar", { p_id: id });
    if (error) { toast(error.message || "No se pudo desactivar", true); return; }
    if (nueva?.id === id) { nueva = null; clearInterval(sondeo); }
    toast("Enlace desactivado"); pintar();
  };
  pintar();
}
