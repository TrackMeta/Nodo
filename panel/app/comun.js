// Datos fijos compartidos por las pantallas de la app (espejo de la Bandeja y de contact-extras.js).
import { ic, esc } from "./app.js";

// Etapas del embudo — mismas claves, nombres y colores que EMBUDO_STAGES (contact-extras.js).
export const STAGES = [
  { k: "nuevo", label: "Nuevo", color: "#667085", desc: "Llegó, aún genérico" },
  { k: "curioso", label: "Curioso", color: "#667085", desc: "Solo tiró la palabra clave" },
  { k: "interesado", label: "Interesado", color: "#2563EB", desc: "Interactuó, quiere más" },
  { k: "caliente", label: "Caliente", color: "#EA580C", desc: "Escribió 4+ mensajes sin comprar" },
  { k: "confirmado", label: "Confirmado", color: "#CA8A04", desc: "Confirmó recibir / adelanto validado" },
  { k: "comprado", label: "Comprado", color: "#16A34A", desc: "Venta cerrada, plata dentro" },
  { k: "perdido", label: "Perdido", color: "#DC2626", desc: "Se cayó / no compró" },
];
export const ETAPA = Object.fromEntries(STAGES.map((s) => [s.k, s]));
// Entrega · Provincia (index.html ENTREGA_PROV)
export const ENTREGA_PROV = [
  { k: "con_adelanto", lbl: "Con adelanto", color: "#8b5cf6", estados: ["adelanto_validado", "por_despachar"] },
  { k: "en_camino", lbl: "En camino", color: "#3b82f6", estados: ["despachado"] },
  { k: "en_agencia", lbl: "En agencia", color: "#0ea5e9", estados: ["en_agencia"] },
  { k: "clave", lbl: "Clave enviada", color: "#10b981", estados: ["saldo_pagado"] },
  { k: "recogido", lbl: "Recogido", color: "#16a34a", estados: ["recogido"] },
];
export const ENTREGA_ESTADO_K = Object.fromEntries(ENTREGA_PROV.flatMap((g) => g.estados.map((e) => [e, g.k])));
export const RECOMPRA_ESTADOS = ["carrito", "pendiente", "esperando_adelanto", "confirmado", "en_reparto", "reprogramado", "adelanto_validado", "por_despachar", "despachado", "en_agencia"];
export const MEDIA_LABEL = { image: ["image", "Foto"], sticker: ["image", "Sticker"], audio: ["mic", "Nota de voz"], video: ["video", "Video"], document: ["file", "Archivo"] };
// Vista previa de la lista (previewText de la Bandeja)
export function previewHtml(c) {
  const t = String(c?.last_input || "");
  const mt = /^\[(image|sticker|audio|video|document)\]$/i.exec(t.trim());
  if (mt) { const l = MEDIA_LABEL[mt[1].toLowerCase()]; return `${ic(l[0])} ${l[1]}`; }
  const mm = /^\[ubicaci[oó]n\]\s*(.*)$/i.exec(t);
  if (!mm) return esc(t);
  const resto = mm[1].trim();
  const esPin = !resto || /^-?\d{1,3}\.\d+[,\s]+-?\d{1,3}\.\d+$/.test(resto);
  return `${ic("pin")} ${esPin ? "Ubicación compartida" : esc(resto)}`;
}
export const esPrueba = (c) => c?.wa_id === "webchat-test" || c?.source === "sim";

// ¿El pedido tiene algo que decidir? (copilotoEtapa de contact-extras.js, la misma regla)
export function copilotoEtapa(o) {
  if (!o) return null;
  const s = o.shipping || {};
  if (o.estado === "pendiente" && s.digital_pendiente) return { id: "digital", titulo: "Pago digital por validar" };
  if (s.extra_pendiente) return { id: "extra", titulo: "Venta extra por validar" };
  if (s.pago_adelantado_por_validar === true) return { id: "lima", titulo: "Pago adelantado de Lima" };
  const rechazado = (t) => { const rej = s[t + "_rechazado_at"], rec = s[t + "_recibido_at"]; return !!rej && (!rec || new Date(rej) >= new Date(rec)); };
  if (o.estado === "esperando_adelanto") return ((s.adelanto_comprobante || s.adelanto_recibido_at) && !rechazado("adelanto")) ? { id: "adelanto", titulo: "Adelanto por validar" } : null;
  if (o.estado === "en_agencia") return ((s.saldo_comprobante || s.saldo_recibido_at) && !rechazado("saldo")) ? { id: "saldo", titulo: "Saldo por validar" } : null;
  if (o.estado === "adelanto_validado" || o.estado === "por_despachar") return { id: "despachar", titulo: "Listo para despachar" };
  if (o.estado === "despachado") return { id: "camino", titulo: "En camino a la agencia" };
  return null;
}
