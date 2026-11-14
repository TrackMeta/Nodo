// 🤖 Sección «Bot» (14-nov-2026, Rodrigo: «renombrar Negocio a Bot y unirlo con IA»).
// Para el usuario es UNA sola sección (un ítem «Bot» en el menú, con el robot), pero por dentro siguen siendo dos páginas
// —negocio.html e ia.html— para no romper lo que ya funciona. Este módulo les da la MISMA cabecera (foto y nombre del
// bot) y la MISMA barra de pestañas, en el orden que eligió Rodrigo («por uso»):
//   Tu negocio · Cómo vende · Atención · Pagos · Entrega · Datos del bot · Avanzado
// Las pestañas de la propia página son <button data-t> (cada página las maneja como siempre); las de la otra página son
// enlaces (<a class="tab tab-ext">) a «otra.html?tab=…». Por eso las páginas buscan `.tab[data-t]`, no `.tab`.

const SV = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const IC = {
  libro: SV('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
  robot: SV('<rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/><path d="M12 4v4"/><circle cx="12" cy="3" r="1"/>'),
  persona: SV('<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>'),
  pago: SV('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/>'),
  camion: SV('<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62L18.3 9.38a1 1 0 0 0-.78-.38H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>'),
  ficha: SV('<rect width="18" height="14" x="3" y="5" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M15 10h3M15 14h3M6 16c.5-1.5 1.7-2 3-2s2.5.5 3 2"/>'),
  ajustes: SV('<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>'),
};

export const TABS_BOT = [
  { k: "conocimiento", p: "negocio", id: "tabCon",   l: "Tu negocio",    ic: "libro" },
  { k: "vendedor",     p: "ia",      id: "tabVend",  l: "Cómo vende",    ic: "robot" },
  { k: "atencion",     p: "ia",      id: "tabAten",  l: "Atención",      ic: "persona" },
  { k: "validador",    p: "ia",      id: "tabVal",   l: "Pagos",         ic: "pago" },
  { k: "entrega",      p: "negocio", id: "tabEnt",   l: "Entrega",       ic: "camion" },
  { k: "datos",        p: "negocio", id: "tabDatos", l: "Datos del bot", ic: "ficha" },
  { k: "perfiles",     p: "ia",      id: "tabPerf",  l: "Avanzado",      ic: "ajustes" },   // Modelos + Cuentas y gasto
];

// Dibuja la barra en #botTabs. `pagina` = "negocio" | "ia"; `activo` = la pestaña abierta.
export function pintarTabsBot(pagina, activo) {
  const box = document.getElementById("botTabs"); if (!box) return;
  const act = activo === "proveedores" ? "perfiles" : activo;
  box.innerHTML = TABS_BOT.map((t) => {
    const cont = `${IC[t.ic]}<span>${t.l}</span>`;
    return t.p === pagina
      ? `<button class="tab${t.k === act ? " active" : ""}" type="button" data-t="${t.k}" id="${t.id}">${cont}</button>`
      : `<a class="tab tab-ext" data-k="${t.k}" id="${t.id}" href="${t.p}.html?tab=${t.k}">${cont}</a>`;
  }).join("");
}

// ¿Llegaste con ?tab=…? (desde la otra página o un enlace viejo). Devuelve la pestaña y limpia la dirección.
export function tabDeUrl(validos, porDefecto) {
  try {
    const t = new URLSearchParams(location.search).get("tab");
    if (t && validos.includes(t)) {
      const q = new URLSearchParams(location.search); q.delete("tab");
      history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : ""));
      return t;
    }
  } catch (_) { /* sin dirección: la de siempre */ }
  return porDefecto;
}

// Cabecera: foto y nombre del bot abierto (los mismos en las dos páginas).
export function pintarIdentidadBot(shell, channelId) {
  const c = (shell && shell.channels || []).find((x) => x.id === channelId) || {};
  const h = document.getElementById("negNombre"); if (h) h.textContent = c.nombre || "Bot";
  const img = document.getElementById("negLogo");
  if (img) { if (c.logo_url) { img.src = c.logo_url; img.style.display = ""; } else img.style.display = "none"; }
}
