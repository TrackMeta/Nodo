// ═══════════════════════════════════════════════════════════════════
// Nodo · resumen.ts — Arma el texto del resumen diario de KPIs.
//
// Lo usan DOS caminos: el scheduler (los avisos programados de mañana/noche)
// y el telegram-webhook (los comandos /hoy, /ayer, /fecha). Vive acá para que
// los dos manden EXACTAMENTE el mismo resumen; si estuviera duplicado, se
// separarían al primer cambio.
// ═══════════════════════════════════════════════════════════════════
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resumirPedidos, type Order } from "./order-stats.ts";

export const CUR_SYM: Record<string, string> = {
  PEN: "S/", USD: "$", MXN: "$", COP: "$", ARS: "$", CLP: "$", BOB: "Bs", EUR: "€",
  BRL: "R$", UYU: "$U", PYG: "₲", VES: "Bs", GTQ: "Q", CRC: "₡", DOP: "RD$", GBP: "£",
};
export const money = (n: number, sym: string) =>
  `${sym} ${Math.round(Number(n) || 0).toLocaleString("es-PE")}`;

// ── Zona horaria (con Intl, correcto incluso con horario de verano) ──
export function tzOffsetMs(instant: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) m[p.type] = p.value;
  const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, (+m.hour) % 24, +m.minute, +m.second);
  return asUTC - instant.getTime();
}
// Instante UTC del inicio (00:00 local) del día Y-M-D en la zona tz.
export function localDayStartUTC(y: number, mo: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, 0, 0, 0);
  return new Date(guess - tzOffsetMs(new Date(guess), tz));
}
export function localParts(instant: Date, tz: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) m[p.type] = p.value;
  return { y: +m.year, mo: +m.month, d: +m.day, hh: (+m.hour) % 24, mm: +m.minute };
}
export const ymd = (y: number, mo: number, d: number) =>
  `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// Rango [from, to) UTC de un día local (Date.UTC maneja el fin de mes/año).
export function rangoDia(y: number, mo: number, d: number, tz: string): { from: Date; to: Date } {
  return { from: localDayStartUTC(y, mo, d, tz), to: localDayStartUTC(y, mo, d + 1, tz) };
}

export type Cual = "ayer" | "hoy" | "fecha";
const TITULO: Record<Cual, string> = {
  ayer: "🌅 <b>RESUMEN DE AYER</b>",
  hoy: "🌙 <b>CÓMO VA HOY</b>",
  fecha: "📅 <b>RESUMEN DEL DÍA</b>",
};

// Construye el texto del resumen de un día (diaYmd = "YYYY-MM-DD" en hora local).
export async function construirResumen(
  db: SupabaseClient, ch: any, diaYmd: string, cual: Cual,
): Promise<string> {
  const tz = ch?.timezone || "America/Lima";
  const sym = CUR_SYM[ch?.moneda] || ch?.moneda || "S/";
  const [y, mo, d] = diaYmd.split("-").map((x) => parseInt(x, 10));
  const { from, to } = rangoDia(y, mo, d, tz);
  const fromISO = from.toISOString(), toISO = to.toISOString();
  const chId = ch.id;

  const [ordR, contR, leadR, adsR, expR] = await Promise.all([
    db.from("orders").select("amount, order_bumps, estado, shipping, created_at")
      .eq("channel_id", chId).gte("created_at", fromISO).lt("created_at", toISO),
    db.from("contacts").select("id", { count: "exact", head: true })
      .eq("channel_id", chId).neq("wa_id", "webchat-test")
      .gte("created_at", fromISO).lt("created_at", toISO),
    db.from("capi_events").select("event_name")
      .eq("channel_id", chId).eq("event_name", "Lead")
      .gte("created_at", fromISO).lt("created_at", toISO),
    db.from("ads_insights").select("gasto").eq("channel_id", chId).eq("fecha", diaYmd),
    db.from("manual_expenses").select("monto").eq("channel_id", chId).eq("fecha", diaYmd),
  ]);

  const orders = (ordR.data ?? []) as Order[];
  const dg = resumirPedidos(orders);
  const nuevosContactos = typeof contR.count === "number" ? contR.count : 0;
  const leads = (leadR.data ?? []).length;
  const gastoAds = (adsR.data ?? []).reduce((a: number, r: any) => a + Number(r?.gasto || 0), 0);
  const gastosExtra = (expR.data ?? []).reduce((a: number, r: any) => a + Number(r?.monto || 0), 0);
  // Ganancia neta = bruta − anuncios − gastos extra (igual que la banda del Dashboard).
  const neta = dg.ganancia != null ? dg.ganancia - gastoAds - gastosExtra : null;
  // ROAS = lo cobrado por cada S/ 1 gastado en anuncios (mismo que el Dashboard).
  const roas = gastoAds > 0 ? dg.ingresos / gastoAds : 0;

  const fechaLbl = new Intl.DateTimeFormat("es-PE", {
    timeZone: tz, weekday: "long", day: "numeric", month: "long",
  }).format(new Date(from.getTime() + 12 * 3600 * 1000));

  const prefix = ch?.nombre ? `<b>[${ch.nombre}]</b>\n` : "";
  const L: string[] = [];
  L.push(`${TITULO[cual]} · <i>${fechaLbl}</i>`);
  L.push("");
  L.push(`💰 Ventas cerradas: <b>${dg.ventas}</b>`);
  L.push(`💵 Ingresos: <b>${money(dg.ingresos, sym)}</b>`);
  if (dg.ventas > 0) L.push(`🎟 Ticket promedio: ${money(dg.ticket, sym)}`);
  if (dg.porCobrar > 0) L.push(`⏳ Por cobrar: ${money(dg.porCobrar, sym)}`);
  L.push("");
  // Rentabilidad: ingresos − costos − publicidad − gastos extra = neta (como el Dashboard).
  if (dg.costoProd > 0) L.push(`📦 Costo de productos: ${money(dg.costoProd, sym)}`);
  if (dg.envio > 0) L.push(`🚚 Gasto de envíos: ${money(dg.envio, sym)}`);
  if (dg.ganancia != null) {
    L.push(`📈 Ganancia bruta: ${money(dg.ganancia, sym)}${dg.gananciaSinDatos ? ` <i>(${dg.gananciaSinDatos} sin costo)</i>` : ""}`);
  }
  if (gastoAds > 0) L.push(`📣 Gasto en anuncios: ${money(gastoAds, sym)}${roas > 0 ? ` · <b>ROAS ${roas.toFixed(1)}×</b>` : ""}`);
  if (gastosExtra > 0) L.push(`📋 Gastos extra: ${money(gastosExtra, sym)}`);
  if (neta != null && (gastoAds > 0 || gastosExtra > 0)) L.push(`💚 Ganancia neta: <b>${money(neta, sym)}</b>`);
  if (dg.ganancia != null || gastoAds > 0 || gastosExtra > 0) L.push("");
  const desglose = (dg.digital || dg.fisico) ? ` <i>(${dg.digital} digital · ${dg.fisico} físico)</i>` : "";
  L.push(`📦 Pedidos nuevos: ${dg.pedidosNuevos}${desglose}`);
  L.push(`👥 Nuevos contactos: ${nuevosContactos}`);
  if (leads > 0) L.push(`🎯 Leads (anuncios): ${leads}`);
  if (dg.perdidos > 0) L.push(`❌ Perdidos: ${dg.perdidos}`);

  // Sin ninguna venta ni movimiento, un mensaje honesto en vez de puros ceros.
  if (dg.pedidosNuevos === 0 && nuevosContactos === 0 && gastoAds === 0 && gastosExtra === 0) {
    return prefix + `${TITULO[cual]} · <i>${fechaLbl}</i>\n\n😴 Sin movimiento este día.`;
  }
  return prefix + L.join("\n");
}

// Parsea la fecha de /fecha: "2026-07-20", "20/07/2026", "20-07", etc. → "YYYY-MM-DD".
export function parseFecha(arg: string, hoyY: number): string | null {
  const s = String(arg || "").trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);       // YYYY-MM-DD
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?$/);     // DD/MM[/YYYY]
  if (m) {
    let yy = m[3] ? +m[3] : hoyY;
    if (yy < 100) yy += 2000;
    return ymd(yy, +m[2], +m[1]);
  }
  return null;
}
