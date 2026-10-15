// ⚡ Service worker de la app (14-oct): la app abre DESDE EL CELULAR (copia guardada) en vez de esperar a internet.
// · Archivos de la app (html, js, css, logo, fuente): se sirven de la copia guardada.
// · Cada vez que se abre la app (o vuelve a primer plano) se mira por detrás si se publicó una versión nueva
//   (fecha de index.html). Si sí, se baja TODO de una vez y recién ahí se reemplaza la copia (nunca mitad vieja,
//   mitad nueva); la app se recarga sola si no estás haciendo nada, o se ve la próxima vez que la abras.
// · Supabase, Meta y todo lo que no sea de la app pasa directo, sin tocarlo.
// · Dentro del APK, Capacitor mete su «puente» (avisos, barras del celular) en el HTML que pasa por él con
//   Accept: text/html: por eso index.html se baja siempre con ese encabezado.
const CACHE = "nodo-app";
const BASE = new URL("./", self.location).href;           // …/panel/app/
const HTML = new URL("index.html", BASE).href;
const VER = BASE + "__version__";
const ARCHIVOS = [
  "index.html", "app.js", "app.css", "manifest.webmanifest", "chats.js", "chat.js", "ficha.js", "pagos.js", "t4.js", "hoy.js",
  "mas.js", "notif.js", "push.js", "comun.js", "fechas.js", "sonidos.js",
  "../shell.js", "../shell.css", "../date-range.js", "../orders.js", "../horarios.js",
  "../vendor/supabase.min.js", "../vendor/inter-latin.woff2", "../../assets/logo-128.png",
].map((f) => new URL(f, BASE).href);

const bajar = (u) => fetch(u, { cache: "no-store", headers: u === HTML ? { Accept: "text/html" } : {} });

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Uno por uno: si alguno falla, los demás igual quedan (lo que falte se pide a internet como siempre)
    await Promise.all(ARCHIVOS.map(async (u) => { try { const r = await bajar(u); if (r.ok) await c.put(u, r); } catch (_) { /* */ } }));
    try { const h = await fetch(HTML, { method: "HEAD", cache: "no-store" }); const v = h.headers.get("last-modified") || h.headers.get("etag"); if (v) await c.put(VER, new Response(v)); } catch (_) { /* */ }
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// ¿Hay versión nueva publicada? (como mucho una vez por minuto)
let _ultima = 0, _corriendo = null;
function revisar() {
  if (_corriendo) return _corriendo;
  if (Date.now() - _ultima < 60e3) return Promise.resolve();
  _ultima = Date.now();
  _corriendo = (async () => {
    const h = await fetch(HTML, { method: "HEAD", cache: "no-store" });
    const v = h.ok && (h.headers.get("last-modified") || h.headers.get("etag")); if (!v) return;
    const c = await caches.open(CACHE);
    const antes = await (await c.match(VER))?.text();
    if (v === antes) return;
    const urls = new Set([...ARCHIVOS, ...(await c.keys()).map((k) => k.url)]); urls.delete(VER);
    const nuevos = await Promise.all([...urls].map(async (u) => { try { const r = await bajar(u); return [u, r]; } catch (_) { return [u, null]; } }));
    if (nuevos.some(([u, r]) => !r || (!r.ok && ARCHIVOS.includes(u)))) return;   // algo no bajó: se intenta la próxima vez
    await Promise.all(nuevos.filter(([, r]) => r.ok).map(([u, r]) => c.put(u, r)));
    await c.put(VER, new Response(v));
    if (antes) (await self.clients.matchAll({ type: "window" })).forEach((cl) => cl.postMessage({ tipo: "nueva" }));
  })().catch(() => {}).finally(() => { _corriendo = null; });
  return _corriendo;
}
self.addEventListener("message", (e) => { if (e.data?.tipo === "revisar") e.waitUntil(revisar()); });

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                 // Supabase, Meta, CDN: directo
  if (req.cache === "no-store" || req.cache === "reload") return;  // pedido fresco a propósito
  // Abrir la app: la página guardada al toque y, por detrás, ¿hay versión nueva?
  if (req.mode === "navigate") {
    if (!url.href.startsWith(BASE) || !/\/(index\.html)?$/.test(url.pathname)) return;
    e.respondWith((async () => {
      const guardada = await caches.match(HTML);
      if (guardada) return guardada;
      const r = await bajar(HTML);
      if (r.ok) { const c = await caches.open(CACHE); await c.put(HTML, r.clone()); }
      return r;
    })());
    e.waitUntil(revisar());
    return;
  }
  if (!/\.(js|css|png|woff2|webmanifest|svg)$/.test(url.pathname)) return;
  e.respondWith((async () => {
    const guardada = await caches.match(req);
    if (guardada) return guardada;
    const r = await fetch(req);
    if (r.ok) { const c = await caches.open(CACHE); c.put(req, r.clone()); }
    return r;
  })());
});
