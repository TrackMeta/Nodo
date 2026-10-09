// Service worker mínimo: hace la app instalable y la abre rápido. Guarda SOLO los archivos de
// la app (no el kit ni las llamadas a la base de Apps: el acceso siempre se revisa en vivo).
const CACHE = "micro-app-v1";
const ARCHIVOS = ["./", "./index.html", "./manifest.webmanifest", "./icono.svg"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;   // kit y base de Apps: siempre por la red
  e.respondWith(fetch(e.request).then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
