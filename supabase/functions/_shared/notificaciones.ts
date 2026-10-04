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
  // 🙋 Un cliente preguntó algo que la ficha no trae (0125). Se resuelve sola cuando el dueño revisa todas las del producto.
  pregunta_cliente:     { grupo: "atencion", prioridad: "importante", porAtender: true },
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
// Los datos traen el formato de Telegram («📞 PIDE QUE LO LLAMEN: …»). En el panel el emoji sobra
// (lo pone el icono) y las MAYÚSCULAS gritan: se pasan a oración. Solo tramos de 2+ palabras en
// mayúsculas, para no tocar siglas sueltas (DNI, S/, PRO).
const suave = (s: string) => s
  .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]+\s*/gu, "")
  .replace(/(?<![\p{L}\p{N}])[A-ZÁÉÍÓÚÑ]{2,}(?:\s+[A-ZÁÉÍÓÚÑ]{2,})+(?![\p{L}\p{N}])/gu,
    (w) => w.charAt(0) + w.slice(1).toLowerCase())
  // Palabra suelta en mayúsculas de 5+ letras (AGOTADO, UNIDADES, LINCE): no es sigla, se suaviza.
  // A mitad de frase va entera en minúscula («Pide REPROGRAMAR la entrega» → «Pide reprogramar…»);
  // sola o tras un «·» es un nombre (LINCE → Lince).
  .replace(/(?<![\p{L}\p{N}])[A-ZÁÉÍÓÚÑ]{5,}(?![\p{L}\p{N}])/gu, (w, i: number, todo: string) =>
    /[a-záéíóúñ][^\p{L}·:.]*$/u.test(todo.slice(Math.max(0, i - 3), i)) && /\s$/.test(todo.slice(0, i))
      ? w.toLowerCase() : w.charAt(0) + w.slice(1).toLowerCase())
  .trim();
// Título en oración: «Stock Agotado: …» → «Stock agotado: …», «Piden 50 Unidades» → «Piden 50 unidades».
const tituloSuave = (s: string) => {
  const t = suave(s).replace(/(?<=[\p{L}\p{N}]\s+)([A-ZÁÉÍÓÚÑ])([a-záéíóúñ]{4,})(?![\p{L}])/gu,
    (w, a, b) => (/^[A-ZÁÉÍÓÚÑ]/.test(w) && s.includes(w.toUpperCase()) ? a.toLowerCase() + b : w));
  return t.charAt(0).toUpperCase() + t.slice(1);
};
// Una línea de detalle legible con lo que haya: cliente · monto · producto · lugar.
function detalleDe(datos: Record<string, unknown>): string {
  const mon = limpio(datos.moneda) || "S/";
  // Algunos avisos ya mandan el monto formateado («S/ 69»): no se le antepone otra vez («S/ S/ 69»).
  const din = (x: string) => (/^\d/.test(x) ? `${mon} ${x}` : x);
  const monto = limpio(datos.total_cobrar) || limpio(datos.monto);
  // En los pagos por validar, lo que PAGÓ y contra qué: «pagó S/ 150» (por un curso de S/ 79),
  // «pagó S/ 15 · esperado S/ 20», «pagó S/ 69 · por cobrar S/ 69». Sin esto el prepago de Lima
  // decía solo el nombre del cliente (medido en la batería 2 de la campanita).
  const leido = limpio(datos.monto_leido), esperado = limpio(datos.monto_esperado), porCobrar = limpio(datos.por_cobrar);
  const partes = [
    limpio(datos.cliente),
    monto ? din(monto) : "",
    leido && leido !== monto ? `pagó ${din(leido)}` : "",
    esperado && esperado !== leido ? `esperado ${din(esperado)}` : "",
    porCobrar ? `por cobrar ${din(porCobrar)}` : "",
    [limpio(datos.producto), limpio(datos.opcion)].filter(Boolean).join(" · "),
    limpio(datos.zona_nombre) || limpio(datos.ciudad) || limpio(datos.sede),
    // Qué quiere cambiar («dirección: Av Brasil 1500…» con el pedido ya enviado). Sin esto el aviso
    // decía solo el nombre del cliente (batería 2 de la campanita).
    limpio(datos.cambios),
    limpio(datos.motivo),
  ].filter(Boolean);
  return suave(partes.join(" · ")).slice(0, 220);
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
    const titulo = tituloSuave(limpio(n.titulo) || def?.titulo || "Aviso") || "Aviso";
    const detalle = suave(limpio(n.detalle)) || detalleDe(datos) || null;
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
    const { data: prev } = await db.from("notificaciones").select("id, repeticiones, resuelta_at, created_at")
      .eq("dedupe_key", dedupe).gte("created_at", new Date(Date.now() - VENTANA_JUNTAR_MS).toISOString())
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const ahora = new Date().toISOString();
    if (prev && !(prev as any).resuelta_at) {
      // Sube arriba otra vez, con el conteo y sin leer para todos (es una novedad). Dos avisos del
      // MISMO turno (menos de 2 min) son un solo hecho contado por dos caminos: no suman «×2».
      const seguido = Date.now() - Date.parse((prev as any).created_at) < 2 * 60_000;
      await db.from("notificaciones").update({
        repeticiones: Number((prev as any).repeticiones || 1) + (seguido ? 0 : 1), detalle, datos,
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
  // «Stock AGOTADO: X — quedan -97. Sigues vendiendo…» → título «Stock agotado: X», el resto al detalle.
  // Así el título es ESTABLE (el de stock se usa para juntar repetidos y con el número no juntaba nunca).
  const [cabeza, ...cola] = sinEmoji(lineas[0] ?? "Aviso").replace(/\s{2,}/g, " ").split(/\s+—\s+/);
  const titulo = cabeza.slice(0, 120);
  const _det = [...cola, ...lineas.slice(1).map(sinEmoji)].filter(Boolean).join(" · ").slice(0, 220);
  const detalle = _det.charAt(0).toUpperCase() + _det.slice(1);
  const t = plano.toUpperCase();
  const tipo = /PRECIO POR MAYOR|PIDEN \d+ UNIDADES/.test(t) ? "mayorista"
    : /STOCK AGOTADO/.test(t) ? "stock_agotado"
    : /STOCK BAJO/.test(t) ? "stock_bajo"
    : /D[IÍ]A DE ENTREGA|REPROGRAMAR|CAMBI[OÓ] SU DIRECCI[OÓ]N/.test(t) ? "entrega_pedida"
    : /^\s*(⚠️|🚨)/u.test(String(texto ?? "")) ? "problema"
    : "aviso";
  // Títulos en MAYÚSCULAS de Telegram («TE PIDEN PRECIO POR MAYOR») → en oración para el panel.
  const tituloBonito = /^[^a-záéíóúñ]*$/.test(titulo) ? titulo.charAt(0) + titulo.slice(1).toLowerCase() : tituloSuave(titulo);
  return { tipo, titulo: tituloBonito, detalle };
}
