// ═══════════════════════════════════════════════════════════════════
// Nodo · shell.js — cascarón compartido de todo el panel.
//   • Cliente Supabase único (config en un solo lugar).
//   • Sidebar fijo con iconos profesionales + etiquetas + comprimir.
//   • Tema claro/oscuro persistente.
//   • Selector global de bot (canal) + logo dinámico.
//   • toast() reutilizable.
// Uso en cada página:
//   import { supa, toast, mountShell } from "./shell.js";
//   const shell = await mountShell({ active:"productos" });
//   shell.channelId            // canal activo
//   shell.onChannel(cb)        // se llama al cambiar de bot
// ═══════════════════════════════════════════════════════════════════
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const SUPABASE_URL = "https://ahoxdyffbwjlshmdezwi.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFob3hkeWZmYndqbHNobWRlendpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNDU4MTksImV4cCI6MjA5ODYyMTgxOX0.4iY3gl1ZhxILv1kPF8-NYd4a0_MeAZmkyLqxx2BMW-Q";

export const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const FALLBACK_LOGO = "../assets/logo-rounded.png";

// ── Iconos (Lucide, stroke=currentColor) ───────────────────────────
const P = {
  inbox:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  contactos:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  flujos:'<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  productos:'<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  secuencias:'<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  plantillas:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  campanas:'<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  dashboard:'<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  pedidos:'<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  campos:'<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
  etiquetas:'<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  disparadores:'<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  respuestas:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8"/><path d="M8 13h5"/>',
  probar:'<path d="M9 3h6"/><path d="M10 3v6.5L4.6 18.6A1.5 1.5 0 0 0 5.9 21h12.2a1.5 1.5 0 0 0 1.3-2.4L14 9.5V3"/><path d="M7 15h10"/>',
  config:'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  canales:'<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon:'<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  panel:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M5.5 21a7.5 7.5 0 0 1 13 0"/>',
  chevron:'<path d="m6 9 6 6 6-6"/>',
};
const svg = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${P[n]||""}</svg>`;

// Navegación agrupada (DESIGN_SYSTEM.md §7.2). El grupo sin `sec` va
// arriba sin etiqueta; los demás son colapsables (estado en localStorage).
const NAV_GROUPS = [
  { key:"top", items:[
    { id:"inbox",       label:"Bandeja",              href:"index.html",      icon:"inbox", cta:true },
    { id:"dashboard",   label:"Dashboard",            href:"dashboard.html",  icon:"dashboard" },
    { id:"pedidos",     label:"Compras / Pedidos",    href:"pedidos.html",    icon:"pedidos" },
  ]},
  { key:"conv", sec:"Conversaciones", items:[
    { id:"contactos",   label:"Contactos",            href:"contactos.html",  icon:"contactos" },
    { id:"respuestas",  label:"Respuestas rápidas",   href:"respuestas.html", icon:"respuestas" },
    { id:"campanas",    label:"Campañas",             href:"campanas.html",   icon:"campanas" },
  ]},
  { key:"auto", sec:"Automatización", items:[
    { id:"editor",      label:"Flujos",               href:"editor.html",     icon:"flujos" },
    { id:"secuencias",  label:"Secuencias",           href:"secuencias.html", icon:"secuencias" },
    { id:"disparadores",label:"Disparadores",         href:"disparadores.html", icon:"disparadores" },
    { id:"probar",      label:"Probar flujos",        href:"probar.html",     icon:"probar" },
  ]},
  { key:"cat", sec:"Catálogo", items:[
    { id:"productos",   label:"Productos",            href:"productos.html",  icon:"productos" },
    { id:"plantillas",  label:"Plantillas",           href:"plantillas.html", icon:"plantillas" },
    { id:"campos",      label:"Campos",               href:"campos.html",     icon:"campos" },
    { id:"etiquetas",   label:"Etiquetas",            href:"etiquetas.html",  icon:"etiquetas" },
  ]},
  { key:"conf", sec:"Configuración", items:[
    { id:"canales",     label:"Canales",              href:"canales.html",    icon:"canales" },
    { id:"config",      label:"Ajustes",              href:"config.html",     icon:"config" },
  ]},
];

// ── grupos del sidebar colapsados (persistencia) ────────────────────
function closedGroups() {
  try { return JSON.parse(localStorage.getItem("nodo.navClosed") || "[]"); } catch { return []; }
}
function toggleGroup(key, closed) {
  const set = new Set(closedGroups());
  closed ? set.add(key) : set.delete(key);
  localStorage.setItem("nodo.navClosed", JSON.stringify([...set]));
}

// ── toast global (DS §12: esquina inferior derecha, nivel 2) ────────
export function toast(msg, err) {
  let t = document.getElementById("nodo-toast");
  if (!t) {
    t = document.createElement("div"); t.id = "nodo-toast";
    t.style.cssText = "position:fixed;bottom:24px;right:24px;display:flex;align-items:center;gap:9px;padding:10px 16px;border-radius:12px;font-size:13px;font-weight:500;opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s;pointer-events:none;z-index:9999;border:1px solid var(--border-strong,#334);background:var(--surface,#151E32);color:var(--text,#F1F5F9);box-shadow:var(--shadow-2,0 8px 24px rgba(0,0,0,.35));max-width:min(420px,calc(100vw - 48px))";
    t.innerHTML = '<span id="nodo-toast-dot" style="width:8px;height:8px;border-radius:50%;flex:none"></span><span id="nodo-toast-msg"></span>';
    document.body.appendChild(t);
  }
  t.querySelector("#nodo-toast-msg").textContent = msg;
  t.querySelector("#nodo-toast-dot").style.background = err ? "var(--red,#EF4444)" : "var(--green,#10B981)";
  t.style.opacity = "1"; t.style.transform = "translateY(0)";
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateY(8px)"; }, 4000);
}

// ── tema ────────────────────────────────────────────────────────────
export function getTheme() { return localStorage.getItem("nodo.theme") || "dark"; }
export function applyTheme(t) { document.documentElement.dataset.theme = t; localStorage.setItem("nodo.theme", t); }
applyTheme(getTheme()); // aplicar cuanto antes (evita parpadeo)

// ── Cascarón ────────────────────────────────────────────────────────
export async function mountShell({ active, minimal } = {}) {
  const subs = [];
  const state = { channelId: null, channels: [] };

  const nav = document.createElement("aside");
  const startCollapsed = minimal || localStorage.getItem("nodo.collapsed") === "1";
  nav.className = "nodo-nav" + (startCollapsed ? " collapsed" : "") + (minimal ? " minimal" : "");
  nav.innerHTML = minimal
    ? `
    <div class="nodo-brand"><a href="dashboard.html" title="Ir al panel" style="display:flex"><img id="nodoLogo" src="${FALLBACK_LOGO}" alt="" /></a></div>
    <nav class="nodo-links">
      <a class="nodo-link" href="dashboard.html" title="Volver al panel">${svg("panel")}<span class="lbl">Panel</span></a>
      <a class="nodo-link active" href="index.html" title="Bandeja">${svg("inbox")}<span class="lbl">Bandeja</span></a>
      <a class="nodo-link" href="contactos.html" title="Contactos">${svg("contactos")}<span class="lbl">Contactos</span></a>
    </nav>
    <div class="nodo-foot">
      <a class="nodo-link" href="perfil.html" title="Perfil">${svg("user")}<span class="lbl">Perfil</span></a>
      <button class="nodo-link" id="nodoTheme" title="Cambiar tema"></button>
      <button class="nodo-link" id="nodoLogout" title="Cerrar sesión">${svg("logout")}<span class="lbl">Cerrar sesión</span></button>
    </div>`
    : `
    <div class="nodo-brand">
      <img id="nodoLogo" src="${FALLBACK_LOGO}" alt="" />
      <span class="bt" id="nodoBrandName">Nodo</span>
    </div>
    <div class="nodo-bot"><select id="nodoBot" title="Bot / número activo"></select></div>
    <nav class="nodo-links">
      ${NAV_GROUPS.map((g) => {
        const items = g.items.map((it) => it.cta
          ? `<a class="nodo-link nodo-cta${it.id === active ? " active" : ""}" href="${it.href}" title="${it.label}">${svg(it.icon)}<span class="lbl">${it.label}</span><span class="cta-dot"></span></a>`
          : `<a class="nodo-link${it.id === active ? " active" : ""}" href="${it.href}" title="${it.label}">${svg(it.icon)}<span class="lbl">${it.label}</span></a>`
        ).join("");
        if (!g.sec) return items;
        const closed = closedGroups().includes(g.key) && !g.items.some((it) => it.id === active);
        return `<div class="nodo-group${closed ? " closed" : ""}" data-g="${g.key}">
          <button class="nodo-sec" type="button">${g.sec}${svg("chevron")}</button>
          <div class="nodo-gitems">${items}</div>
        </div>`;
      }).join("")}
    </nav>
    <div class="nodo-foot">
      <a class="nodo-link${active === "perfil" ? " active" : ""}" href="perfil.html" title="Perfil">${svg("user")}<span class="lbl">Perfil</span></a>
      <button class="nodo-link" id="nodoTheme" title="Cambiar tema"></button>
      <button class="nodo-link" id="nodoCollapse" title="Comprimir menú">${svg("panel")}<span class="lbl">Comprimir</span></button>
      <button class="nodo-link" id="nodoLogout" title="Cerrar sesión">${svg("logout")}<span class="lbl">Cerrar sesión</span></button>
    </div>`;
  document.body.classList.add("nodo-shelled");
  document.body.insertBefore(nav, document.body.firstChild);

  // Tema toggle
  const themeBtn = nav.querySelector("#nodoTheme");
  const paintTheme = () => {
    const dark = getTheme() === "dark";
    themeBtn.innerHTML = `${svg(dark ? "sun" : "moon")}<span class="lbl">${dark ? "Tema claro" : "Tema oscuro"}</span>`;
  };
  paintTheme();
  themeBtn.onclick = () => { applyTheme(getTheme() === "dark" ? "light" : "dark"); paintTheme(); };

  // Grupos colapsables (persisten en localStorage)
  nav.querySelectorAll(".nodo-group > .nodo-sec").forEach((btn) => {
    btn.onclick = () => {
      const g = btn.parentElement;
      g.classList.toggle("closed");
      toggleGroup(g.dataset.g, g.classList.contains("closed"));
    };
  });

  // Comprimir (no existe en modo minimal)
  const collapseBtn = nav.querySelector("#nodoCollapse");
  if (collapseBtn) collapseBtn.onclick = () => {
    nav.classList.toggle("collapsed");
    localStorage.setItem("nodo.collapsed", nav.classList.contains("collapsed") ? "1" : "0");
  };

  // Logout
  nav.querySelector("#nodoLogout").onclick = async () => { await supa.auth.signOut(); location.href = "index.html"; };

  // Selector de bot + logo dinámico (el select no existe en modo minimal)
  const botSel = nav.querySelector("#nodoBot");
  const logo = nav.querySelector("#nodoLogo");
  const brandName = nav.querySelector("#nodoBrandName");
  // Resiliente: si la columna logo_url aún no está migrada en la BD, reintenta sin ella.
  let { data, error } = await supa.from("channels").select("id,nombre,logo_url").eq("activo", true).order("nombre");
  if (error) ({ data } = await supa.from("channels").select("id,nombre").eq("activo", true).order("nombre"));
  state.channels = data || [];
  if (botSel) {
    botSel.innerHTML = "";
    state.channels.forEach((c) => {
      const o = document.createElement("option"); o.value = c.id; o.textContent = c.nombre; botSel.appendChild(o);
    });
  }
  let saved = localStorage.getItem("nodo.channelId");
  if (!state.channels.find((c) => c.id === saved)) saved = state.channels[0]?.id || null;
  state.channelId = saved;
  if (botSel && saved) botSel.value = saved;

  const paintBrand = () => {
    const c = state.channels.find((x) => x.id === state.channelId);
    if (logo) logo.src = (c && c.logo_url) ? c.logo_url : FALLBACK_LOGO;
    if (brandName) brandName.textContent = c ? c.nombre : "Nodo";
  };
  paintBrand();

  if (botSel) botSel.onchange = () => {
    state.channelId = botSel.value;
    localStorage.setItem("nodo.channelId", state.channelId);
    paintBrand();
    subs.forEach((cb) => { try { cb(state.channelId); } catch (e) { console.error(e); } });
  };

  const api = {
    get channelId() { return state.channelId; },
    get channels() { return state.channels; },
    onChannel(cb) { subs.push(cb); },
    setChannel(id, { silent } = {}) {
      if (!state.channels.find((c) => c.id === id)) return;
      state.channelId = id;
      localStorage.setItem("nodo.channelId", id);
      if (botSel) botSel.value = id;
      paintBrand();
      if (!silent) subs.forEach((cb) => { try { cb(id); } catch (e) { console.error(e); } });
    },
  };
  window.NodoShell = api;
  return api;
}
