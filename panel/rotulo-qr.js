// 📍🔳 (24-nov, Rodrigo) La UBICACIÓN que compartió el cliente, separada de la DIRECCIÓN que escribe una persona.
// La dirección la completa el equipo (Editar pedido) mirando el mapa; la ubicación viaja en el rótulo como un QR que el
// motorizado escanea con la cámara y le abre Google Maps en el punto exacto. Lo usan los dos rótulos (pedidos.html y
// contact-extras.js) y la ficha del pedido.

const ES_LINK = /^https?:\/\//i;

// Lo que alguien pega como ubicación → enlace de mapa. Acepta un enlace (de Maps o el que sea) o coordenadas
// «-12.15, -76.97». Cualquier otra cosa → "" (no es una ubicación).
export function aUrlMapa(txt) {
  const t = String(txt || "").trim();
  if (ES_LINK.test(t)) return (t.match(/^\S+/) || [""])[0];
  const m = /^(-?\d{1,3}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)$/.exec(t);
  return m ? `https://maps.google.com/?q=${m[1]},${m[2]}` : "";
}
// El enlace del mapa del pedido: la casilla `ubicacion` (la mandó el cliente o la pegó el equipo); en pedidos de antes,
// el que quedó en la dirección o en la vieja casilla «Maps / GPS» (`gps`).
export function ubicacionDe(s) {
  return aUrlMapa(s?.ubicacion) || aUrlMapa(s?.gps) || (ES_LINK.test(String(s?.direccion || "").trim()) ? aUrlMapa(s.direccion) : "");
}
// La dirección ESCRITA (vacía si lo único que hay es el enlace del mapa).
export function direccionEscrita(s) {
  const d = String(s?.direccion || "").trim();
  return ES_LINK.test(d) ? "" : d;
}

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Fila del rótulo con el QR (vacía si no compartió ubicación). El dibujo lo hace QR_SCRIPT al abrir la hoja.
export function filaQR(url) {
  if (!url) return "";
  return `<tr><td class="k">Coordenadas</td><td class="v"><div class="qrbox"><div class="qr" data-u="${esc(url)}"></div>`
    + `<div class="qrtx">Escanéalo con la cámara del celular: abre el mapa en el punto exacto de la entrega.</div></div></td></tr>`;
}

// Va en el <head> y al final del <body> de la hoja del rótulo. Si la librería no carga (sin internet), la fila
// queda con el texto y sin dibujo — nunca frena la impresión.
export const QR_CSS = `.qrbox{display:flex;gap:12px;align-items:center}.qr{flex:none;width:96px;height:96px}.qr svg{width:96px;height:96px;display:block}.qrtx{font-size:11px;font-weight:600;color:#333}`;
export const QR_HEAD = `<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"><\/script>`;
export const QR_SCRIPT = `<script>(function(){try{if(typeof qrcode!=="function")return;document.querySelectorAll(".qr[data-u]").forEach(function(el){var q=qrcode(0,"M");q.addData(el.getAttribute("data-u"));q.make();el.innerHTML=q.createSvgTag({cellSize:3,margin:0,scalable:true});});}catch(e){}})();<\/script>`;
