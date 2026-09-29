// ═══════════════════════════════════════════════════════════════════
// Nodo · notificaciones.ts — el centro de notificaciones del panel (la campanita).
//
// TODO aviso que el bot le da al dueño pasa por `registrarNotificacion`, salga o no por Telegram
// (sin Telegram conectado, apagado en Canales → Avisos, token caído): hasta el 2026-09-28 los
// avisos vivían solo en Telegram, y en un bot sin Telegram (Maestría Digital) no le llegaban a
// nadie. La tabla es `notificaciones` (migración 0113); el panel la lee por RLS y en vivo.
//
// UN SOLO PUNTO DE ENTRADA a propósito: cada lugar que avisa (avisar, notifyAdmin, salud de Meta,
// campañas, anuncios) llama a esta función; un aviso nuevo que se agregue mañana no se queda
// fuera de la campanita por olvido. Nunca lanza: registrar un aviso no puede tumbar una venta.
//
// La resolución automática (un pago validado desde Telegram/Pedidos deja de estar «por atender»)
// la hacen triggers de la base (0114), así vale para TODOS los caminos que tocan el pedido.
// ═══════════════════════════════════════════════════════════════════
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AVISOS } from "./avisos.ts";

export type Prioridad = "urgente" | "importante" | "info";
export type Grupo = "pagos" | "ventas" | "atencion" | "sistema";

type Meta = { grupo: Grupo; prioridad: Prioridad; porAtender: boolean };

// Cómo pesa cada aviso del catálogo. Urgente = hay plata esperando o un cliente esperando a una
// persona (los mismos que Telegram no deja apagar: AVISOS_CRITICOS). Importante = hay que
// decidir algo, pero nadie está parado. Info = para enterarte.
const META: Record<string, Meta> = {
  adelanto_validar:     { grupo: "pagos",    prioridad: "urgente",    porAtender: true },
  saldo_validar:        { grupo: "pagos",    prioridad: "urgente",    porAtender: true },
  pago_digital_validar: { grupo: "pagos",    prioridad: "urgente",    porAtender: true },
  pago_extra_validar:   { grupo: "pagos",    prioridad: "urgente",    porAtender: true },
  prepago_lima_validar: { grupo: "pagos",    prioridad: "urgente",    porAtender: true },
  entrega_fallida:      { grupo: "pagos",    prioridad: "urgente",    porAtender: true },
  pide_humano:          { grupo: "atencion", prioridad: "urgente",    porAtender: true },
  envio_fallido:        { grupo: "atencion", prioridad: "urgente",    porAtender: true },
  cambio_tras_despacho: { grupo: "atencion", prioridad: "urgente",    porAtender: true },
  reclama_vuelto:       { grupo: "pagos",    prioridad: "importante", porAtender: true },
  pago_de_mas:          { grupo: "pagos",    prioridad: "importante", porAtender: false },
  pedido_cancelado:     { grupo: "atencion", prioridad: "importante", porAtender: false },
  venta_digital:        { grupo: "ventas",   prioridad: "info",       porAtender: false },
  pedido_lima:          { grupo: "ventas",   prioridad: "info",       porAtender: false },
  pedido_provincia:     { grupo: "ventas",   prioridad: "info",       porAtender: false },
  venta_extra:          { grupo: "ventas",   prioridad: "info",       porAtender: false },
  adelanto_auto:        { grupo: "pagos",    prioridad: "info",       porAtender: false },
  saldo_auto:           { grupo: "pagos",    prioridad: "info",       porAtender: false },
  organico_sin_atender: { grupo: "atencion", prioridad: "info",       porAtender: false },
  // Propios del sistema (no están en el catálogo de Telegram):
  mayorista:            { grupo: "atencion", prioridad: "importante", porAtender: true },
  entrega_pedida:       { grupo: "atencion", prioridad: "importante", porAtender: true },
  stock_agotado:        { grupo: "sistema",  prioridad: "importante", porAtender: false },
  stock_bajo:           { grupo: "sistema",  prioridad: "info",       porAtender: false },
  problema:             { grupo: "sistema",  prioridad: "urgente",    porAtender: true },
  whatsapp_salud:       { grupo: "sistema",  prioridad: "urgente",    porAtender: true },
  campana_detenida:     { grupo: "sistema",  prioridad: "urgente",    porAtender: true },
  anuncio_sin_producto: { grupo: "sistema",  prioridad: "importante", porAtender: true },
  aviso:                { grupo: "sistema",  prioridad: "info",       porAtender: false },
};
// Avisos de PAGO: se enganchan al pedido vivo del cliente para que el trigger los resuelva solos.
const DE_PEDIDO = new Set(["adelanto_validar", "saldo_validar", "pago_digital_validar", "pago_extra_validar",
  "prepago_lima_validar", "entrega_fallida", "pago_de_mas", "reclama_vuelto", "cambio_tras_despacho",
  "pedido_cancelado", "pedido_lima", "pedido_provincia", "venta_digital", "venta_extra", "adelanto_auto", "saldo_auto"]);
// Juntar repetidos: el mismo aviso del mismo cliente/pedido en poco rato suma «×2» en vez de otra fila.
const VENTANA_JUNTAR_MS = 6 * 3600_000;

export type Notif = {
  channelId: string;
  contactId?: string | null;
  orderId?: string | null;
  tipo: string;
  titulo?: string;
  detalle?: string;
  datos?: Record<string, unknown>;
  prioridad?: Prioridad;
  grupo?: Grupo;
  porAtender?: boolean;
  dedupeKey?: string | null;
};

const limpio = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
// Una línea de detalle legible con lo que haya: cliente · monto · producto · lugar.
function detalleDe(datos: Record<string, unknown>): string {
  const mon = limpio(datos.moneda) || "S/";
  const monto = limpio(datos.total_cobrar) || limpio(datos.monto);
  const partes = [
    limpio(datos.cliente),
    monto ? `${mon} ${monto}` : "",
    [limpio(datos.producto), limpio(datos.opcion)].filter(Boolean).join(" · "),
    limpio(datos.zona_nombre) || limpio(datos.ciudad) || limpio(datos.sede),
    limpio(datos.motivo),
  ].filter(Boolean);
  return partes.join(" · ").slice(0, 220);
}

export async function registrarNotificacion(db: SupabaseClient, n: Notif): Promise<string | null> {
  try {
    if (!n?.channelId || !n.tipo) return null;
    // Las simulaciones y el chat de prueba no ensucian la campanita (igual que no mandan Telegram).
    const datos = { ...(n.datos ?? {}) };
    if (n.contactId) {
      const { data: c } = await db.from("contacts").select("wa_id, source, nombre").eq("id", n.contactId).maybeSingle();
      // (salvo los simulados con wa_id «PRUEBA-NOTIF…»: son los que usamos para probar la campanita de punta a punta)
      if ((c as any)?.wa_id === "webchat-test" || ((c as any)?.source === "sim" && !String((c as any)?.wa_id ?? "").startsWith("PRUEBA-NOTIF"))) return null;
      if (datos.cliente == null && (c as any)?.nombre) datos.cliente = (c as any).nombre;
    }
    const meta = META[n.tipo] ?? META.aviso;
    const def = AVISOS.find((a) => a.clave === n.tipo);
    const titulo = limpio(n.titulo) || def?.titulo || "Aviso";
    const detalle = limpio(n.detalle) || detalleDe(datos) || null;
    const grupo: Grupo = n.grupo ?? (def?.grupo as Grupo | undefined) ?? meta.grupo;
    const prioridad: Prioridad = n.prioridad ?? meta.prioridad;
    const porAtender = n.porAtender ?? meta.porAtender;

    let orderId = n.orderId ?? null;
    if (!orderId && n.contactId && DE_PEDIDO.has(n.tipo)) {
      const { data: o } = await db.from("orders").select("id").eq("channel_id", n.channelId).eq("contact_id", n.contactId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      orderId = (o as any)?.id ?? null;
    }

    const dedupe = n.dedupeKey ?? `${n.channelId}:${n.tipo}:${orderId ?? n.contactId ?? limpio(titulo).toLowerCase()}`;
    const { data: prev } = await db.from("notificaciones").select("id, repeticiones, resuelta_at")
      .eq("dedupe_key", dedupe).gte("created_at", new Date(Date.now() - VENTANA_JUNTAR_MS).toISOString())
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const ahora = new Date().toISOString();
    if (prev && !(prev as any).resuelta_at) {
      // Sube arriba otra vez, con el conteo y sin leer para todos (es una novedad).
      await db.from("notificaciones").update({
        repeticiones: Number((prev as any).repeticiones || 1) + 1, detalle, datos,
        prioridad, created_at: ahora, updated_at: ahora,
      }).eq("id", (prev as any).id);
      await db.from("notificacion_lecturas").delete().eq("notificacion_id", (prev as any).id);
      return (prev as any).id;
    }
    const { data: ins } = await db.from("notificaciones").insert({
      channel_id: n.channelId, contact_id: n.contactId ?? null, order_id: orderId,
      tipo: n.tipo, grupo, prioridad, titulo, detalle, datos, por_atender: porAtender, dedupe_key: dedupe,
    }).select("id").single();
    return (ins as any)?.id ?? null;
  } catch (e) {
    console.error("[notificaciones]", (e as any)?.message ?? e);
    return null;
  }
}

// notifyAdmin manda TEXTO LIBRE (no del catálogo): se clasifica por lo que dice. El título es su
// primera línea sin marcas; el detalle, el resto.
export function clasificarTextoLibre(texto: string): { tipo: string; titulo: string; detalle: string } {
  const plano = String(texto ?? "").replace(/<[^>]+>/g, "").replace(/[*_`]/g, "");
  const lineas = plano.split("\n").map((l) => l.trim()).filter(Boolean);
  const sinEmoji = (s: string) => s.replace(/^[\p{Extended_Pictographic}️\s·:—-]+/u, "").trim();
  const titulo = sinEmoji(lineas[0] ?? "Aviso").replace(/\s{2,}/g, " ").slice(0, 120);
  const detalle = lineas.slice(1).map(sinEmoji).filter(Boolean).join(" · ").slice(0, 220);
  const t = plano.toUpperCase();
  const tipo = /PRECIO POR MAYOR|PIDEN \d+ UNIDADES/.test(t) ? "mayorista"
    : /STOCK AGOTADO/.test(t) ? "stock_agotado"
    : /STOCK BAJO/.test(t) ? "stock_bajo"
    : /D[IÍ]A DE ENTREGA|REPROGRAMAR|CAMBI[OÓ] SU DIRECCI[OÓ]N/.test(t) ? "entrega_pedida"
    : /^\s*(⚠️|🚨)/u.test(String(texto ?? "")) ? "problema"
    : "aviso";
  // Títulos en MAYÚSCULAS de Telegram («TE PIDEN PRECIO POR MAYOR») → en oración para el panel.
  const tituloBonito = /^[^a-záéíóúñ]*$/.test(titulo) ? titulo.charAt(0) + titulo.slice(1).toLowerCase() : titulo;
  return { tipo, titulo: tituloBonito, detalle };
}
