// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Nodo · Edge Function: mcp  (PÚBLICA — verify_jwt=false; la seguridad es la llave personal)
//   Servidor MCP (Model Context Protocol) de Nodo, para conectarlo a Claude, ChatGPT u otra IA (16-nov-2026, Rodrigo:
//   «¿es posible crear un MCP de Nodo?» → «dale, constrúyelo todo»). Cada usuario saca su ENLACE PERSONAL en
//   Conexiones → MCP: https://<proyecto>.supabase.co/functions/v1/mcp/<llave>. También acepta la llave en
//   «Authorization: Bearer <llave>» o «?k=<llave>».
//
//   Transporte: «Streamable HTTP» sin streaming — cada POST trae un mensaje JSON-RPC 2.0 (o un lote) y se responde JSON.
//   Seguridad: la llave → mcp_tokens (hash sha256) → el usuario → SOLO los bots de los equipos donde está activo, como el
//   panel. Las acciones que cambian algo piden `confirmar: true` (primero devuelven una vista previa para que la IA le
//   pregunte a la persona). Las de configuración, solo un admin del equipo. Nunca se exponen tokens ni claves.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
import { serviceClient, getChannelSecrets } from "../_shared/db.ts";
import { sendText, MetaApiError } from "../_shared/meta.ts";
import { finVentanaAnuncio } from "../_shared/fep.ts";
import { resumirPedidos } from "../_shared/order-stats.ts";
import { appsApi, appsConfigurada } from "../_shared/microapps.ts";
// Las MISMAS reglas de pedidos que el panel (estados, cobrado, margen, zona): panel/orders.js no importa nada.
import * as O from "../../../panel/orders.js";
// El MISMO armado del texto del negocio que usa el panel al guardar (Bot → Tu negocio), para no tener dos versiones.
import { compileNegocio, fusionarNegocio } from "../../../panel/negocio-texto.js";
// La MISMA ficha del producto que compila el panel al guardar (Productos), para configurar productos desde aquí.
import { parseFaq, compileFaq, fusionarFicha, compileProductoIA } from "../../../panel/producto-ia.js";
import { sendTelegram } from "../_shared/telegram.ts";

const db = serviceClient();
const PANEL = "https://trackmeta.github.io/Nodo/panel";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
};
const jres = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ── Quién llama ─────────────────────────────────────────────────────────────────────────────────────────────────
type Ctx = {
  uid: string; nombre: string; tokenId: string;
  equipos: Map<string, { nombre: string; rol: string; tipos: string[] | null }>;
  bots: Array<{ id: string; nombre: string; account_id: string; equipo: string; rol: string; bot_apagado: boolean; timezone: string; moneda: string; wa: boolean; usd_rate: number }>;
};
async function sha256(s: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function llaveDe(req: Request): string | null {
  const m = req.url.match(/nodo_[a-f0-9]{48}/);
  if (m) return m[0];
  const a = req.headers.get("authorization") ?? "";
  const b = a.match(/^Bearer\s+(nodo_[a-f0-9]{48})$/i);
  return b ? b[1] : null;
}
async function contexto(llave: string): Promise<Ctx | null> {
  const { data: t } = await db.from("mcp_tokens").select("id, user_id, revoked_at").eq("token_hash", await sha256(llave)).maybeSingle();
  if (!t || (t as any).revoked_at) return null;
  db.from("mcp_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", (t as any).id).then(() => {}, () => {});
  const uid = String((t as any).user_id);
  const [{ data: u }, { data: ms }] = await Promise.all([
    db.from("app_users").select("nombre, activo").eq("id", uid).maybeSingle(),
    db.from("account_members").select("account_id, role, accounts(nombre, features)").eq("user_id", uid).eq("activo", true),
  ]);
  if (!u || (u as any).activo === false) return null;
  const equipos = new Map<string, { nombre: string; rol: string; tipos: string[] | null }>();
  for (const m of (ms ?? []) as any[]) {
    const t = m.accounts?.features?.tipos;   // null = vende de todo (ver 0145_cuentas_por_tipo)
    equipos.set(m.account_id, { nombre: m.accounts?.nombre ?? "Equipo", rol: m.role, tipos: Array.isArray(t) && t.length ? t : null });
  }
  const ids = [...equipos.keys()];
  const { data: chs } = ids.length
    ? await db.from("channels").select("id, nombre, account_id, bot_apagado, timezone, moneda, moneda_reporte, usd_rate, phone_number_id").in("account_id", ids).eq("activo", true).order("nombre")
    : { data: [] as any[] };
  const bots = ((chs ?? []) as any[]).map((c) => ({
    id: c.id, nombre: c.nombre, account_id: c.account_id, equipo: equipos.get(c.account_id)?.nombre ?? "", rol: equipos.get(c.account_id)?.rol ?? "operador",
    bot_apagado: !!c.bot_apagado, timezone: c.timezone || "America/Lima", moneda: c.moneda || "PEN", wa: !!c.phone_number_id, usd_rate: Number(c.usd_rate) || 0,
  }));
  return { uid, nombre: (u as any).nombre ?? "", tokenId: String((t as any).id), equipos, bots };
}

// ── Utilidades ──────────────────────────────────────────────────────────────────────────────────────────────────
class Fallo extends Error {}
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
function botDe(ctx: Ctx, ref?: unknown) {
  if (!ctx.bots.length) throw new Fallo("No tienes bots en Nodo todavía.");
  const r = norm(ref);
  if (!r) { if (ctx.bots.length === 1) return ctx.bots[0]; throw new Fallo(`Dime de qué bot: ${ctx.bots.map((b) => b.nombre).join(", ")}.`); }
  const exacto = ctx.bots.filter((b) => b.id === String(ref) || norm(b.nombre) === r);
  if (exacto.length === 1) return exacto[0];
  const parecidos = ctx.bots.filter((b) => norm(b.nombre).includes(r));
  if (parecidos.length === 1) return parecidos[0];
  if (parecidos.length > 1) throw new Fallo(`Hay varios bots con «${ref}»: ${parecidos.map((b) => b.nombre).join(", ")}. ¿Cuál?`);
  throw new Fallo(`No encontré el bot «${ref}». Tus bots: ${ctx.bots.map((b) => b.nombre).join(", ")}.`);
}
function exigirAdmin(bot: Ctx["bots"][0]) {
  if (bot.rol !== "admin") throw new Fallo(`Para cambiar la configuración de «${bot.nombre}» hay que ser admin de su equipo.`);
}
const esPrueba = (k: any) => k?.wa_id === "webchat-test" || String(k?.wa_id ?? "").startsWith("exam-") || String(k?.wa_id ?? "").startsWith("PRUEBA-") || k?.source === "sim";
async function contactoDe(botId: string, ref: unknown) {
  const r = String(ref ?? "").trim();
  if (!r) throw new Fallo("Dime de qué cliente (nombre, teléfono o id).");
  if (/^[0-9a-f-]{36}$/i.test(r)) {
    const { data } = await db.from("contacts").select("id, nombre, wa_id, telefono, bot_activo, bloqueado, ultimo_mensaje_cliente_at, stage").eq("id", r).eq("channel_id", botId).maybeSingle();
    if (data) return data as any;
  }
  const dig = r.replace(/\D/g, "");
  let q = db.from("contacts").select("id, nombre, wa_id, telefono, bot_activo, bloqueado, ultimo_mensaje_cliente_at, stage").eq("channel_id", botId);
  q = dig.length >= 6 ? q.ilike("wa_id", `%${dig}%`) : q.ilike("nombre", `%${r.replace(/[%_]/g, "")}%`);
  const { data } = await q.order("ultimo_mensaje_at", { ascending: false, nullsFirst: false }).limit(6);
  const lista = ((data ?? []) as any[]).filter((k) => !esPrueba(k));
  if (!lista.length) throw new Fallo(`No encontré un cliente «${r}» en este bot.`);
  const exacto = lista.filter((k) => norm(k.nombre) === norm(r));
  if (exacto.length === 1 || lista.length === 1) return (exacto[0] ?? lista[0]);
  throw new Fallo(`Hay varios clientes que coinciden con «${r}»: ${lista.map((k) => `${k.nombre ?? "sin nombre"} (${String(k.wa_id ?? "").slice(-4)})`).join(", ")}. ¿Cuál?`);
}
// Desfase en minutos de una zona horaria (p. ej. America/Lima → -300).
function desfase(tz: string, d = new Date()): number {
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(d).find((x) => x.type === "timeZoneName")?.value ?? "GMT-5";
    const m = p.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/); if (!m) return 0;
    return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  } catch { return -300; }
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);
// Periodo en la zona del bot → { desde/hasta en UTC (ISO), días YYYY-MM-DD, etiqueta }.
function periodo(tz: string, p?: unknown, desdeTxt?: unknown, hastaTxt?: unknown) {
  const off = desfase(tz);
  const ahoraLocal = new Date(Date.now() + off * 60_000);
  const hoy = new Date(Date.UTC(ahoraLocal.getUTCFullYear(), ahoraLocal.getUTCMonth(), ahoraLocal.getUTCDate()));
  let a = hoy, b = hoy, etiqueta = "hoy";
  const k = norm(p);
  const reD = /^\d{4}-\d{2}-\d{2}$/;
  if (reD.test(String(desdeTxt ?? ""))) {
    a = new Date(String(desdeTxt) + "T00:00:00Z"); b = reD.test(String(hastaTxt ?? "")) ? new Date(String(hastaTxt) + "T00:00:00Z") : hoy;
    etiqueta = `${ymd(a)} a ${ymd(b)}`;
  } else if (k === "ayer") { a = b = new Date(hoy.getTime() - 864e5); etiqueta = "ayer"; }
  else if (k === "7dias" || k === "7 dias" || k === "semana") { a = new Date(hoy.getTime() - 6 * 864e5); etiqueta = "últimos 7 días"; }
  else if (k === "30dias" || k === "30 dias") { a = new Date(hoy.getTime() - 29 * 864e5); etiqueta = "últimos 30 días"; }
  else if (k === "mes" || k === "este mes") { a = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)); etiqueta = "este mes"; }
  else if (k === "mes pasado") { a = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1)); b = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 0)); etiqueta = "mes pasado"; }
  const desde = new Date(a.getTime() - off * 60_000).toISOString();
  const hasta = new Date(b.getTime() + 864e5 - 1 - off * 60_000).toISOString();
  return { desde, hasta, dDesde: ymd(a), dHasta: ymd(b), etiqueta };
}
const horaLocal = (iso: string | null | undefined, tz: string) => {
  if (!iso) return null;
  try { return new Intl.DateTimeFormat("es-PE", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)); } catch { return iso; }
};
const SIMB: Record<string, string> = { PEN: "S/", USD: "$", MXN: "$", COP: "$", ARS: "$", CLP: "$", BOB: "Bs", EUR: "€" };
const dinero = (n: number, mon: string) => `${SIMB[mon] ?? mon + " "} ${Number(n || 0).toFixed(2)}`;
// Igual que panel/orders.js (esVenta && !esPerdido): lo que Inicio cuenta como venta.
const VENTA = new Set(["confirmada", "confirmado", "en_reparto", "reprogramado", "entregado_cobrado", "adelanto_validado", "por_despachar", "despachado", "en_agencia", "saldo_pagado", "recogido"]);
function confirmacion(args: any, vista: string) {
  if (args?.confirmar === true) return null;
  return { necesita_confirmacion: true, vista_previa: vista,
    instruccion: "Muéstrale esto a la persona y, SOLO si dice que sí, vuelve a llamar a esta herramienta con los mismos datos y confirmar: true." };
}
async function paginar<T>(fn: (f: number, t: number) => any, max = 20000): Promise<T[]> {
  const out: T[] = [];
  for (let f = 0; f < max; f += 1000) {
    const { data, error } = await fn(f, f + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

// ── Herramientas ────────────────────────────────────────────────────────────────────────────────────────────────
const S = (props: Record<string, unknown>, req: string[] = []) => ({ type: "object", properties: props, required: req, additionalProperties: false });
const P_BOT = { type: "string", description: "Nombre (o parte) o id del bot. Si solo tienes uno, puede omitirse." };
const P_PER = { type: "string", description: "hoy, ayer, 7dias, 30dias, mes, mes pasado. O usa desde/hasta." };
const P_D = { type: "string", description: "Fecha AAAA-MM-DD (zona horaria del bot)" };
const P_CONF = { type: "boolean", description: "true solo después de que la persona aprobó la vista previa." };
const P_CLI = { type: "string", description: "Nombre, teléfono o id del cliente." };

type Tool = { name: string; description: string; inputSchema: unknown; run: (ctx: Ctx, a: any) => Promise<unknown>; escribe?: boolean };
const TOOLS: Tool[] = [
  // ─────── Consultas ───────
  { name: "mis_bots", description: "Lista tus bots de Nodo: equipo, tu rol, si está encendido y si tiene WhatsApp conectado. Úsala primero para saber qué bots hay.",
    inputSchema: S({}), run: async (ctx) => ({ usuario: ctx.nombre, bots: ctx.bots.map((b) => ({ id: b.id, nombre: b.nombre, equipo: b.equipo, tu_rol: b.rol, encendido: !b.bot_apagado, whatsapp_conectado: b.wa, moneda: b.moneda })) }) },

  { name: "resumen", description: "Cómo le va a un bot (o a todos) en un periodo, con las MISMAS cuentas que Inicio del panel: chats nuevos, ventas, ingresos cobrados, ticket, conversión, cierre del bot, gasto en Meta, costo por chat, costo por interesado, costo por venta, ROAS, ROI, costos, gasto de IA, ganancia bruta y GANANCIA NETA. Con comparar:true también trae el periodo anterior del mismo largo. Usa estos números tal cual; no los recalcules.",
    inputSchema: S({ bot: { type: "string", description: "Bot; omítelo para ver todos tus bots." }, periodo: P_PER, desde: P_D, hasta: P_D, comparar: { type: "boolean", description: "true = también el periodo anterior (p. ej. esta semana vs la pasada)." } }),
    run: async (ctx, a) => {
      // (18-nov) Misma cuenta que Inicio y el resumen de Telegram (order-stats.ts › resumirPedidos): ver traer()/cuentas().
      const bots = a?.bot ? [botDe(ctx, a.bot)] : ctx.bots;
      const filas = [];
      for (const b of bots) {
        const r = periodo(b.timezone, a?.periodo, a?.desde, a?.hasta);
        const c = cuentas(b, await traer(b, r));
        const fila: Record<string, unknown> = { bot: b.nombre, periodo: r.etiqueta, moneda: String(b.moneda || "PEN").toUpperCase(), ...filaResumen(b, c) };
        const notas = notasDe(c); if (notas.length) fila.notas = notas;
        if (a?.comparar === true) {
          const r2 = periodoAnterior(r); const c2 = cuentas(b, await traer(b, r2 as any));
          const dif = (x: number, y: number) => (y ? `${x >= y ? "+" : ""}${Math.round(((x - y) / Math.abs(y)) * 100)}%` : x ? "nuevo" : "igual");
          fila.periodo_anterior = { periodo: r2.etiqueta, ...filaResumen(b, c2) };
          fila.cambio = { ventas: dif(c.dg.ventas, c2.dg.ventas), ingresos: dif(c.dg.ingresos, c2.dg.ingresos), chats_nuevos: dif(c.chats, c2.chats), gasto_meta: dif(c.gastoAds, c2.gastoAds),
            ganancia_neta: c.neta != null && c2.neta != null ? dif(c.neta, c2.neta) : "—",
            costo_por_chat: c.chatsAds && c2.chatsAds && c2.gastoAds ? dif(c.gastoAds / c.chatsAds, c2.gastoAds / c2.chatsAds) : "—" };
        }
        filas.push(fila);
      }
      return { resumen: filas };
    } },

  { name: "contactos", description: "Clientes de un bot, del más reciente al más antiguo, con cuánto gastó cada uno. Filtra por etapa del embudo (nuevo, curioso, interesado, caliente, confirmado, comprado, perdido), por ETIQUETA o busca por nombre/teléfono.",
    inputSchema: S({ bot: P_BOT, etapa: { type: "string" }, etiqueta: { type: "string", description: "Nombre de la etiqueta (o parte)." }, buscar: { type: "string" }, limite: { type: "number", description: "Máximo 50 (por defecto 20)." } }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot);
      let q = db.from("contacts").select("id, nombre, wa_id, stage, created_at, ultimo_mensaje_at, bot_activo, source, product_id, products(nombre), orders(estado, amount, order_bumps, shipping)").eq("channel_id", b.id);
      if (a?.etapa) q = q.eq("stage", norm(a.etapa));
      if (a?.etiqueta) {
        const { data: tags } = await db.from("tags").select("id, nombre").eq("channel_id", b.id);
        const tg = ((tags ?? []) as any[]).filter((t) => norm(t.nombre).includes(norm(a.etiqueta)));
        if (!tg.length) throw new Fallo(`No hay una etiqueta «${a.etiqueta}». Tus etiquetas: ${((tags ?? []) as any[]).map((t) => t.nombre).join(", ") || "ninguna"}.`);
        const ids = (await paginar<any>((f, t) => db.from("contact_tags").select("contact_id").in("tag_id", tg.map((t) => t.id)).range(f, t), 5000)).map((x) => x.contact_id);
        q = q.in("id", ids.length ? ids.slice(0, 300) : ["00000000-0000-0000-0000-000000000000"]);
      }
      if (a?.buscar) { const d = String(a.buscar).replace(/\D/g, ""); q = d.length >= 6 ? q.ilike("wa_id", `%${d}%`) : q.ilike("nombre", `%${String(a.buscar).replace(/[%_]/g, "")}%`); }
      const { data } = await q.order("ultimo_mensaje_at", { ascending: false, nullsFirst: false }).limit(Math.min(Number(a?.limite) || 20, 50) + 10);
      const lista = ((data ?? []) as any[]).filter((k) => !esPrueba(k)).slice(0, Math.min(Number(a?.limite) || 20, 50));
      return { bot: b.nombre, contactos: lista.map((k) => ({ id: k.id, nombre: k.nombre, telefono: k.wa_id, etapa: k.stage, producto: k.products?.nombre ?? null,
        llego: horaLocal(k.created_at, b.timezone), ultimo_mensaje: horaLocal(k.ultimo_mensaje_at, b.timezone), desde_anuncio: k.source === "ad" || k.source === "ctwa", bot_atiende: k.bot_activo !== false,
        compras: ((k.orders ?? []) as any[]).filter((o) => O.esVenta(o) && !O.esPerdido(o)).length, total_gastado: dinero(((k.orders ?? []) as any[]).filter((o) => O.esVenta(o) && !O.esPerdido(o)).reduce((s, o) => s + O.cobrado(o), 0), b.moneda) })) };
    } },

  { name: "conversacion", description: "Los últimos mensajes de la conversación con un cliente (quién escribió, cuándo y qué).",
    inputSchema: S({ bot: P_BOT, cliente: P_CLI, limite: { type: "number", description: "Máximo 80 (por defecto 30)." } }, ["cliente"]),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); const k = await contactoDe(b.id, a?.cliente);
      const { data } = await db.from("messages").select("direction, type, content, sent_by, status, created_at").eq("contact_id", k.id)
        .order("created_at", { ascending: false }).limit(Math.min(Number(a?.limite) || 30, 80));
      const msgs = ((data ?? []) as any[]).reverse().map((m) => ({
        hora: horaLocal(m.created_at, b.timezone),
        de: m.direction === "in" ? "cliente" : (m.sent_by === "human" ? "persona del equipo" : "bot"),
        tipo: m.type, texto: String(m.content?.text ?? m.content?.caption ?? "").slice(0, 1500) || `[${m.type}]`,
        ...(m.status === "failed" ? { no_salio: true } : {}),
      }));
      return { bot: b.nombre, cliente: { id: k.id, nombre: k.nombre, telefono: k.wa_id, etapa: k.stage, bot_atiende: k.bot_activo !== false }, mensajes: msgs };
    } },

  { name: "pedidos", description: "Pedidos de un bot (como Pedidos): estado, monto, adelanto y saldo, Lima o provincia, agencia/sede, guía, distrito y dirección, extras. Con parados:true trae SOLO los que llevan demasiados días sin moverse (sin adelanto, en camino o en agencia, que Shalom puede devolver). Con zona: lima | provincia | digital.",
    inputSchema: S({ bot: P_BOT, estado: { type: "string" }, zona: { type: "string", enum: ["lima", "provincia", "digital"] }, parados: { type: "boolean" }, periodo: P_PER, desde: P_D, hasta: P_D, limite: { type: "number" } }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); const r = periodo(b.timezone, a?.periodo ?? "30dias", a?.desde, a?.hasta);
      // Parados: días desde la última actualización (desde que se creó si espera el adelanto). Umbrales de Bot → Entrega
      // (channels.entregas.parado), por defecto 2 / 3 / 5 como Pedidos; 0 = no vigilar.
      const { data: ch } = await db.from("channels").select("entregas").eq("id", b.id).maybeSingle();
      const par = ((ch as any)?.entregas?.parado ?? {}) as Record<string, number>;
      const UMB: Record<string, number> = { esperando_adelanto: par.esperando_adelanto ?? 2, despachado: par.despachado ?? 3, en_agencia: par.en_agencia ?? 5 };
      const diasParado = (o: any) => { const u = UMB[o.estado]; if (!u) return null; const desde = o.estado === "esperando_adelanto" ? o.created_at : (o.updated_at || o.created_at); const d = Math.floor((Date.now() - Date.parse(desde)) / 864e5); return d >= u ? d : null; };
      let q = db.from("orders").select("id, estado, amount, order_bumps, shipping, created_at, updated_at, contacts(nombre, wa_id, source), product:product_id(nombre, tipo), product_versions(nombre)").eq("channel_id", b.id);
      if (a?.parados === true) q = q.in("estado", Object.keys(UMB).filter((k) => UMB[k] > 0)); else q = q.gte("created_at", r.desde).lte("created_at", r.hasta);
      if (a?.estado) q = q.eq("estado", String(a.estado));
      const { data } = await q.order("created_at", { ascending: false }).limit(a?.parados === true || a?.zona ? 500 : Math.min(Number(a?.limite) || 30, 100));
      let lista = ((data ?? []) as any[]).filter((o) => !esPrueba(o.contacts));
      if (a?.zona) lista = lista.filter((o) => O.zonaDe(o) === a.zona);
      if (a?.parados === true) lista = lista.filter((o) => diasParado(o) != null);
      const din = (n: number) => dinero(n, b.moneda);
      return { bot: b.nombre, periodo: a?.parados === true ? "todos los pedidos abiertos" : r.etiqueta, cantidad: lista.length,
        pedidos: lista.slice(0, Math.min(Number(a?.limite) || 30, 100)).map((o) => { const sh = o.shipping || {}, z = O.zonaDe(o), ad = O.adelantoDe(o), dp = diasParado(o);
          return { id: o.id, estado: O.label(o.estado), zona: z, total: din(O.total(o)), cobrado: din(O.cobrado(o)), ...(O.porCobrar(o) > 0 ? { por_cobrar: din(O.porCobrar(o)) } : {}),
            ...(z === "provincia" && ad ? { adelanto: din(Number(ad) || 0) } : {}),
            cliente: o.contacts?.nombre ?? sh.cliente ?? null, telefono: o.contacts?.wa_id ?? null, producto: [o.product?.nombre, o.product_versions?.nombre].filter(Boolean).join(" · "),
            ...((o.order_bumps ?? []).length ? { extras: (o.order_bumps as any[]).map((x) => x.nombre ?? x.titulo ?? "extra").join(", ") } : {}),
            ...(z === "provincia" ? { agencia: sh.agencia ?? null, sede: sh.sede ?? sh.destino ?? sh.ciudad ?? null, guia: sh.guia ?? null, clave_recojo: sh.clave_recojo ?? null, aereo: !!sh.aereo } : {}),
            ...(z === "lima" ? { distrito: sh.distrito ?? null, direccion: sh.direccion ?? null, referencia: sh.referencia ?? null } : {}),
            ...(dp != null ? { parado: `${dp} días sin moverse` } : {}), fecha: horaLocal(o.created_at, b.timezone) }; }) };
    } },

  { name: "pendientes", description: "Lo que necesita atención: pagos por validar, clientes que piden una persona, mensajes que no salieron, anuncios sin producto, avisos de WhatsApp y si el bot está apagado. Sin bot, revisa todos.",
    inputSchema: S({ bot: { type: "string", description: "Bot; omítelo para revisar todos." } }),
    run: async (ctx, a) => {
      const bots = a?.bot ? [botDe(ctx, a.bot)] : ctx.bots;
      const out = [];
      for (const b of bots) {
        const desde48 = new Date(Date.now() - 48 * 3600_000).toISOString();
        const [{ data: ns }, { data: fs }] = await Promise.all([
          db.from("notificaciones").select("tipo, titulo, detalle, created_at, repeticiones").eq("channel_id", b.id).eq("por_atender", true).is("resuelta_at", null).order("created_at", { ascending: false }).limit(30),
          db.from("messages").select("error, created_at, contacts(wa_id, source)").eq("channel_id", b.id).eq("status", "failed").gte("created_at", desde48).order("created_at", { ascending: false }).limit(50),
        ]);
        const fallos = ((fs ?? []) as any[]).filter((m) => !esPrueba(m.contacts));
        const ultimoError = fallos[0]?.error?.message ?? null;
        out.push({ bot: b.nombre, encendido: !b.bot_apagado, whatsapp_conectado: b.wa,
          mensajes_que_no_salieron_48h: fallos.length,
          ...(ultimoError ? { ultimo_error_whatsapp: ultimoError, ...(/API access blocked/i.test(ultimoError) ? { alerta: "Meta bloqueó la app de WhatsApp de este bot: no puede enviar nada. Hay que revisar Meta for Developers / Business (pagos o verificación)." } : {}) } : {}),
          por_atender: ((ns ?? []) as any[]).map((n) => ({ tipo: n.tipo, titulo: n.titulo, detalle: n.detalle, desde: horaLocal(n.created_at, b.timezone), veces: n.repeticiones ?? 1 })) });
      }
      return { pendientes: out };
    } },

  { name: "productos", description: "Productos de un bot con sus presentaciones, precios, tipo y palabras clave.",
    inputSchema: S({ bot: P_BOT }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot);
      const [{ data: ps }, { data: trg }] = await Promise.all([
        db.from("products").select("id, nombre, tipo, clase, config, product_versions(id, nombre, precio, activo, orden, costo)").eq("channel_id", b.id).order("created_at"),
        db.from("flow_triggers").select("config, activo, flows!inner(product_id)").eq("channel_id", b.id).eq("tipo", "keyword"),
      ]);
      // Ventas de los últimos 7 días por producto (como la tarjeta de Productos).
      const os7 = await paginar<any>((f, t) => db.from("orders").select("product_id, amount, order_bumps, estado, shipping, contacts(wa_id, source)").eq("channel_id", b.id).gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString()).range(f, t));
      const v7 = new Map<string, { n: number; plata: number }>();
      for (const o of os7) { if (esPrueba(o.contacts) || !O.esVenta(o) || O.esPerdido(o)) continue; const x = v7.get(o.product_id) ?? { n: 0, plata: 0 }; x.n++; x.plata += O.total(o); v7.set(o.product_id, x); }
      const claves = new Map<string, string[]>();
      for (const t of (trg ?? []) as any[]) { const pid = t.flows?.product_id; if (!pid || t.activo === false) continue; claves.set(pid, [...(claves.get(pid) ?? []), ...((t.config?.keywords ?? []) as string[])]); }
      return { bot: b.nombre, productos: ((ps ?? []) as any[]).map((p) => { const stock = p.config?.stock && typeof p.config.stock === "object" ? p.config.stock as Record<string, number> : null; const x = v7.get(p.id);
        return { id: p.id, nombre: p.nombre, tipo: p.tipo, clase: p.clase, palabras_clave: claves.get(p.id) ?? [], vendiendo: claves.has(p.id),
          ventas_7_dias: x?.n ?? 0, ingresos_7_dias: dinero(x?.plata ?? 0, b.moneda),
          ...(Number(p.config?.costo) > 0 ? { costo: dinero(Number(p.config.costo), b.moneda) } : {}),
          ...(stock && Object.keys(stock).length ? { stock: Object.fromEntries(Object.entries(stock).map(([k, v]) => [k === "_" || k === "" ? "total" : k, Number(v) || 0])), stock_total: Object.values(stock).reduce((s, v) => s + (Number(v) || 0), 0) } : {}),
          presentaciones: ((p.product_versions ?? []) as any[]).sort((x, y) => (x.orden ?? 0) - (y.orden ?? 0)).map((v) => ({ id: v.id, nombre: v.nombre, precio: dinero(v.precio, b.moneda), ...(Number(v.costo) > 0 ? { costo: dinero(Number(v.costo), b.moneda) } : {}), activa: v.activo !== false })) }; }) };
    } },

  { name: "configuracion", description: "Cómo está configurado un bot: lo que sabe del negocio, tono, medios de pago (sin números completos), modelo de IA y remarketing.",
    inputSchema: S({ bot: P_BOT }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot);
      const [{ data: c }, { data: ai }] = await Promise.all([
        db.from("channels").select("negocio_form, ocr_config, remarketing, ia_provider, buffer_default_seg, pedidos_config").eq("id", b.id).maybeSingle(),
        db.from("channel_ai").select("provider, model").eq("channel_id", b.id),
      ]);
      const f = ((c as any)?.negocio_form ?? {}) as any;
      const metodos = (((c as any)?.ocr_config?.metodos ?? []) as any[]).map((m) => ({ app: m.app, titular: m.titular, numero: m.numero ? "•••" + String(m.numero).slice(-4) : null }));
      return { bot: b.nombre, equipo: b.equipo, moneda: b.moneda, zona_horaria: b.timezone, encendido: !b.bot_apagado,
        negocio: { nombre: f.nombre, que_vende_y_a_quien: f.rubro, como_se_paga_y_entrega: f.pagos, politicas: f.politicas, cuando_pasar_a_persona: f.transferir, horario: f.horario, tono: f.tono, nombre_del_asistente: f.nombre_ia, preguntas_frecuentes: (f.faq ?? []).length },
        medios_de_pago: metodos, ia: { proveedor: (c as any)?.ia_provider ?? null, modelos: ai ?? [] }, remarketing: (c as any)?.remarketing ?? null };
    } },

  // ─────── Acciones (piden confirmar) ───────
  { name: "encender_bot", escribe: true, description: "Enciende o apaga el bot entero (apagado = no responde a nadie y contestan las personas). Pide confirmación.",
    inputSchema: S({ bot: P_BOT, encendido: { type: "boolean" }, confirmar: P_CONF }, ["encendido"]),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); exigirAdmin(b);
      const quiere = a?.encendido === true;
      if (quiere === !b.bot_apagado) return { ok: true, sin_cambios: `«${b.nombre}» ya está ${quiere ? "encendido" : "apagado"}.` };
      const pre = confirmacion(a, `${quiere ? "Encender" : "Apagar"} el bot «${b.nombre}».${quiere ? "" : " Nadie recibirá respuestas automáticas hasta encenderlo."}`); if (pre) return pre;
      const { error } = await db.from("channels").update({ bot_apagado: !quiere }).eq("id", b.id);
      if (error) throw new Fallo(error.message);
      return { ok: true, hecho: `«${b.nombre}» quedó ${quiere ? "encendido" : "apagado"}.` };
    } },

  { name: "bot_en_chat", escribe: true, description: "Pausa o reactiva el bot SOLO en la conversación de un cliente (pausado = lo atiende una persona). Pide confirmación.",
    inputSchema: S({ bot: P_BOT, cliente: P_CLI, activo: { type: "boolean" }, confirmar: P_CONF }, ["cliente", "activo"]),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); const k = await contactoDe(b.id, a?.cliente); const quiere = a?.activo === true;
      if (quiere === (k.bot_activo !== false)) return { ok: true, sin_cambios: `El bot ya está ${quiere ? "atendiendo" : "en pausa"} con ${k.nombre ?? "ese cliente"}.` };
      const pre = confirmacion(a, `${quiere ? "Reactivar" : "Pausar"} el bot en el chat de ${k.nombre ?? k.wa_id} (bot «${b.nombre}»).`); if (pre) return pre;
      const { error } = await db.from("contacts").update({ bot_activo: quiere }).eq("id", k.id);
      if (error) throw new Fallo(error.message);
      await db.from("contact_events").insert({ channel_id: b.id, contact_id: k.id, tipo: quiere ? "bot_reactiva" : "bot_pausa", titulo: quiere ? "Bot reactivado (desde la IA)" : "Bot en pausa (desde la IA)" }).then(() => {}, () => {});
      return { ok: true, hecho: `Bot ${quiere ? "reactivado" : "en pausa"} con ${k.nombre ?? k.wa_id}.` };
    } },

  { name: "enviar_mensaje", escribe: true, description: "Le manda un WhatsApp de texto a un cliente en nombre del equipo (como si lo escribieras en la Bandeja). Solo si el cliente escribió en las últimas 24 h. Al enviarlo, el bot queda en pausa en ese chat. Pide confirmación.",
    inputSchema: S({ bot: P_BOT, cliente: P_CLI, texto: { type: "string" }, confirmar: P_CONF }, ["cliente", "texto"]),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); const k = await contactoDe(b.id, a?.cliente);
      const texto = String(a?.texto ?? "").trim(); if (!texto) throw new Fallo("Falta el texto del mensaje.");
      if (k.bloqueado) throw new Fallo("Ese contacto está bloqueado.");
      const ult = k.ultimo_mensaje_cliente_at ? Date.parse(k.ultimo_mensaje_cliente_at) : 0;
      if (!(ult > 0 && Date.now() - ult < 24 * 3600_000)) throw new Fallo("Pasaron más de 24 h desde que el cliente escribió: WhatsApp solo deja escribirle con una plantilla aprobada (desde el panel).");
      const pre = confirmacion(a, `Enviar a ${k.nombre ?? k.wa_id} (bot «${b.nombre}»):\n\n${texto}\n\nEl bot quedará en pausa en ese chat.`); if (pre) return pre;
      const { data: ch } = await db.from("channels").select("phone_number_id").eq("id", b.id).maybeSingle();
      const sec = await getChannelSecrets(db, b.id);
      if (!(ch as any)?.phone_number_id || !sec?.access_token) throw new Fallo("Este bot no tiene WhatsApp conectado.");
      try {
        const wamid = await sendText((ch as any).phone_number_id, sec.access_token, k.wa_id, texto);
        const ventana = (await finVentanaAnuncio(db, k.id) > Date.now()) ? "fep" : "servicio";
        await db.from("messages").insert({ channel_id: b.id, contact_id: k.id, direction: "out", type: "text", content: { text: texto }, wamid: wamid || null, status: "sent", sent_by: "human", sent_by_user: ctx.uid, ventana });
        await db.from("contacts").update({ bot_activo: false }).eq("id", k.id);
        await db.from("conversations").update({ no_leidos: 0, requiere_humano: false, updated_at: new Date().toISOString() }).eq("contact_id", k.id).then(() => {}, () => {});
        return { ok: true, hecho: `Mensaje enviado a ${k.nombre ?? k.wa_id}. El bot quedó en pausa en ese chat.` };
      } catch (e) {
        const meta = e instanceof MetaApiError ? (e as any).meta : { message: String((e as any)?.message ?? e) };
        await db.from("messages").insert({ channel_id: b.id, contact_id: k.id, direction: "out", type: "text", content: { text: texto }, status: "failed", error: meta, sent_by: "human", sent_by_user: ctx.uid }).then(() => {}, () => {});
        throw new Fallo("WhatsApp no aceptó el mensaje: " + (meta?.message ?? "error"));
      }
    } },

  { name: "cambiar_precio", escribe: true, description: "Cambia el precio de una presentación de un producto. Pide confirmación.",
    inputSchema: S({ bot: P_BOT, producto: { type: "string" }, presentacion: { type: "string", description: "Nombre de la presentación; si el producto tiene una sola, puede omitirse." }, precio: { type: "number" }, confirmar: P_CONF }, ["producto", "precio"]),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); exigirAdmin(b);
      const precio = Number(a?.precio); if (!(precio > 0)) throw new Fallo("El precio tiene que ser mayor que 0.");
      const { data: ps } = await db.from("products").select("id, nombre, product_versions(id, nombre, precio)").eq("channel_id", b.id);
      const prods = ((ps ?? []) as any[]).filter((p) => norm(p.nombre).includes(norm(a?.producto)));
      if (prods.length !== 1) throw new Fallo(prods.length ? `Hay varios productos con «${a?.producto}»: ${prods.map((p) => p.nombre).join(", ")}.` : `No encontré el producto «${a?.producto}».`);
      const vs = (prods[0].product_versions ?? []) as any[];
      const v = a?.presentacion ? vs.filter((x) => norm(x.nombre).includes(norm(a.presentacion))) : vs;
      if (v.length !== 1) throw new Fallo(v.length ? `¿Qué presentación? ${vs.map((x) => `${x.nombre} (${dinero(x.precio, b.moneda)})`).join(", ")}.` : `No encontré esa presentación. Hay: ${vs.map((x) => x.nombre).join(", ")}.`);
      const pre = confirmacion(a, `«${prods[0].nombre} · ${v[0].nombre}»: de ${dinero(v[0].precio, b.moneda)} a ${dinero(precio, b.moneda)} (bot «${b.nombre}»).`); if (pre) return pre;
      const { error } = await db.from("product_versions").update({ precio }).eq("id", v[0].id);
      if (error) throw new Fallo(error.message);
      return { ok: true, hecho: `Precio cambiado: ${prods[0].nombre} · ${v[0].nombre} = ${dinero(precio, b.moneda)}. El bot ya lo usa en las próximas respuestas.` };
    } },

  // ─────── Configuración (admin, piden confirmar) ───────
  { name: "editar_negocio", escribe: true, description: "Escribe lo que el bot sabe del negocio (Bot → Tu negocio): qué vende y a quién, cómo se paga y entrega, políticas, cuándo pasar a una persona, horario y tono. Solo cambia los campos que mandes. Pide confirmación.",
    inputSchema: S({ bot: P_BOT, nombre: { type: "string" }, rubro: { type: "string", description: "Qué vendes y a quién, por qué te eligen." }, pagos: { type: "string", description: "Cómo se paga y cómo se entrega (en general; los números de pago van en medios_de_pago)." },
      politicas: { type: "string" }, transferir: { type: "string", description: "Cuándo pasar el chat a una persona." }, horario: { type: "string" },
      tono: { type: "string", enum: ["cercano", "formal", "directo", "divertido"] }, nombre_ia: { type: "string", description: "Nombre del asistente." }, confirmar: P_CONF }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); exigirAdmin(b);
      const campos = ["nombre", "rubro", "pagos", "politicas", "transferir", "horario", "tono", "nombre_ia"].filter((k) => typeof a?.[k] === "string" && a[k].trim());
      if (!campos.length) throw new Fallo("No mandaste ningún campo para cambiar.");
      const pre = confirmacion(a, `Bot «${b.nombre}» → Tu negocio:\n` + campos.map((k) => `• ${k}: ${String(a[k]).trim()}`).join("\n")); if (pre) return pre;
      const { data: c } = await db.from("channels").select("negocio_form").eq("id", b.id).maybeSingle();
      const form = { ...(((c as any)?.negocio_form ?? {}) as any) };
      for (const k of campos) form[k] = String(a[k]).trim();
      fusionarNegocio(form);
      const { error } = await db.from("channels").update({ negocio_form: form, negocio: compileNegocio(form).trim() || null }).eq("id", b.id);
      if (error) throw new Fallo(error.message);
      return { ok: true, hecho: `Listo: el bot «${b.nombre}» ya usa lo nuevo (${campos.join(", ")}).` };
    } },

  { name: "medios_de_pago", escribe: true, description: "Agrega o quita un medio de pago (Yape, Plin, banco…) con su titular y número; el validador revisa que los comprobantes lleguen ahí. Nunca inventes números: úsalos solo si la persona te los dio. Pide confirmación.",
    inputSchema: S({ bot: P_BOT, accion: { type: "string", enum: ["agregar", "quitar"] }, app: { type: "string", description: "Yape, Plin, BCP, Interbank…" }, titular: { type: "string" }, numero: { type: "string" }, notas: { type: "string" }, confirmar: P_CONF }, ["accion", "app"]),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); exigirAdmin(b);
      const { data: c } = await db.from("channels").select("ocr_config").eq("id", b.id).maybeSingle();
      const cfg = { ...(((c as any)?.ocr_config ?? {}) as any) }; const metodos = [...((cfg.metodos ?? []) as any[])];
      if (a?.accion === "quitar") {
        const i = metodos.findIndex((m) => norm(m.app) === norm(a.app) && (!a?.numero || String(m.numero ?? "").endsWith(String(a.numero).replace(/\D/g, "").slice(-4))));
        if (i < 0) throw new Fallo(`No hay un medio de pago «${a.app}» en este bot.`);
        const pre = confirmacion(a, `Quitar ${metodos[i].app} (${metodos[i].titular ?? ""}, •••${String(metodos[i].numero ?? "").slice(-4)}) del bot «${b.nombre}».`); if (pre) return pre;
        metodos.splice(i, 1);
      } else {
        const titular = String(a?.titular ?? "").trim(), numero = String(a?.numero ?? "").trim();
        if (!titular || !numero) throw new Fallo("Para agregarlo necesito el titular y el número (pídeselos a la persona; no los inventes).");
        const pre = confirmacion(a, `Agregar al bot «${b.nombre}»: ${a.app} · ${titular} · ${numero}${a?.notas ? ` (${a.notas})` : ""}.`); if (pre) return pre;
        metodos.push({ app: String(a.app).trim(), titular, numero, ...(a?.notas ? { notas: String(a.notas) } : {}) });
      }
      cfg.metodos = metodos;
      const { error } = await db.from("channels").update({ ocr_config: cfg }).eq("id", b.id);
      if (error) throw new Fallo(error.message);
      return { ok: true, hecho: `Medios de pago de «${b.nombre}»: ${metodos.map((m) => m.app).join(", ") || "ninguno"}.` };
    } },

  { name: "crear_producto", escribe: true, description: "Crea un producto con sus presentaciones y precios. Queda como borrador: para que el bot empiece a venderlo, la persona abre el enlace que se devuelve y toca «Poner a vender» (ahí se arma el flujo de venta). Pide confirmación.",
    inputSchema: S({ bot: P_BOT, nombre: { type: "string" }, tipo: { type: "string", enum: ["fisico", "digital"] }, emoji: { type: "string" },
      presentaciones: { type: "array", items: S({ nombre: { type: "string" }, precio: { type: "number" } }, ["nombre", "precio"]), description: "Ej. [{nombre:'1 unidad', precio:79}, {nombre:'Pack x2', precio:149}]" },
      descripcion: { type: "string", description: "Qué es, qué incluye y para quién (lo usa la IA para vender)." }, confirmar: P_CONF }, ["nombre", "tipo", "presentaciones"]),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); exigirAdmin(b);
      const pres = ((a?.presentaciones ?? []) as any[]).filter((p) => p?.nombre && Number(p?.precio) > 0);
      if (!pres.length) throw new Fallo("Necesito al menos una presentación con nombre y precio.");
      const tipos = ctx.equipos.get(b.account_id)?.tipos;
      if (tipos && !tipos.includes(a?.tipo)) throw new Fallo(`El equipo de «${b.nombre}» solo vende productos de tipo ${tipos.join(" / ")}.`);
      const pre = confirmacion(a, `Crear en «${b.nombre}» el producto ${a?.emoji ? a.emoji + " " : ""}«${a.nombre}» (${a.tipo}):\n` + pres.map((p) => `• ${p.nombre}: ${dinero(Number(p.precio), b.moneda)}`).join("\n") + (a?.descripcion ? `\n\n${a.descripcion}` : "")); if (pre) return pre;
      // (28-nov) La descripción va a la FICHA (ia.detalle → contexto_producto), que es lo que lee la IA al vender. Antes iba
      // a ia.descripcion, que solo usa el ruteo: el producto creado desde aquí vendía «sin saber qué era».
      const config: any = {};
      if (a?.descripcion) { config.ia = { descripcion: String(a.descripcion), detalle: String(a.descripcion).trim() }; recompilarFicha(config, String(a.tipo)); }
      const { data: p, error } = await db.from("products").insert({ channel_id: b.id, nombre: String(a.nombre).trim(), tipo: a.tipo, clase: "principal", emoji: a?.emoji ?? null, config }).select("id").single();
      if (error) throw new Fallo(/tipo_no_permitido/.test(error.message) ? `Este equipo no vende productos de tipo ${a.tipo}.` : error.message);
      const { error: e2 } = await db.from("product_versions").insert(pres.map((x, i) => ({ product_id: (p as any).id, nombre: String(x.nombre), precio: Number(x.precio), orden: i, activo: true })));
      if (e2) throw new Fallo("El producto se creó, pero no sus presentaciones: " + e2.message);
      return { ok: true, hecho: `Producto «${a.nombre}» creado en «${b.nombre}» con ${pres.length} presentación(es).`,
        siguiente_paso: "Desde aquí puedes completarlo: ficha_producto (qué es, límites, preguntas), saludo_producto, palabra_clave, imagen_producto, entrega_digital, banco_anuncios, remarketing_producto y medios_pago_producto. Para que el bot lo VENDA falta un paso en el panel: abrir el producto y tocar «Poner a vender» (ahí se arma el flujo de venta).", enlace: `${PANEL}/productos.html` };
    } },

  { name: "crear_bot", escribe: true, description: "Crea un bot nuevo (vacío) en uno de tus equipos. Después hay que conectarle WhatsApp y la clave de IA desde el panel (Conexiones y Bot → Avanzado). Pide confirmación.",
    inputSchema: S({ nombre: { type: "string" }, equipo: { type: "string", description: "Nombre del equipo; si solo eres admin de uno, puede omitirse." }, confirmar: P_CONF }, ["nombre"]),
    run: async (ctx, a) => {
      const admins = [...ctx.equipos.entries()].filter(([, e]) => e.rol === "admin");
      if (!admins.length) throw new Fallo("Solo un admin de un equipo puede crear bots.");
      const eq = a?.equipo ? admins.filter(([, e]) => norm(e.nombre).includes(norm(a.equipo))) : admins;
      if (eq.length !== 1) throw new Fallo(`¿En qué equipo? ${admins.map(([, e]) => e.nombre).join(", ")}.`);
      const nombre = String(a?.nombre ?? "").trim(); if (!nombre) throw new Fallo("Falta el nombre del bot.");
      const pre = confirmacion(a, `Crear el bot «${nombre}» en el equipo «${eq[0][1].nombre}».`); if (pre) return pre;
      const { data, error } = await db.from("channels").insert({ nombre, account_id: eq[0][0], negocio_form: { nombre }, negocio: "# " + nombre }).select("id").single();
      if (error) throw new Fallo(error.message);
      return { ok: true, hecho: `Bot «${nombre}» creado.`, id: (data as any).id,
        siguiente_paso: "Conéctale WhatsApp en Conexiones y pon la clave de IA en Bot → Avanzado → Cuentas y gasto. Después puedo llenarle el negocio y los productos.", enlace: `${PANEL}/canales.html` };
    } },
];


// ═════════ 18-nov-2026 · Todo lo que el panel muestra y el MCP no daba (Rodrigo: «dale todo», tras la revisión
// pantalla por pantalla). Cada cuenta copia la de su pantalla: Inicio (calcular), Rendimiento, Embudo, Pedidos,
// Compras, Pagos por validar, Directo, ficha del cliente, Accesos, Campañas, Secuencias y Horarios. ═════════

// ── Datos de un periodo (una sola vez) y sus cuentas, iguales a Inicio ──
type Filas = { contactos: any[]; pedidos: any[]; ia: any[]; ads: any[]; gx: any[]; am: any[]; activas: Set<string> | null };
async function traer(b: Ctx["bots"][0], r: ReturnType<typeof periodo>): Promise<Filas> {
  const [contactos, pedidos, ia, ads, gx, am, cuentas] = await Promise.all([
    paginar<any>((f, t) => db.from("contacts").select("id, wa_id, source, ad_id, stage, etapa_previa, primera_interaccion, created_at, orders(id)").eq("channel_id", b.id).or(`and(primera_interaccion.gte.${r.desde},primera_interaccion.lte.${r.hasta}),and(primera_interaccion.is.null,created_at.gte.${r.desde},created_at.lte.${r.hasta})`).order("id").range(f, t)),
    paginar<any>((f, t) => db.from("orders").select("id, contact_id, product_id, version_id, amount, currency, order_bumps, estado, shipping, created_at, product:product_id(id, nombre, tipo, config), contacts(wa_id, source)").eq("channel_id", b.id).gte("created_at", r.desde).lte("created_at", r.hasta).order("created_at").order("id").range(f, t)),
    paginar<any>((f, t) => db.from("ai_usage").select("dia, costo_usd").eq("channel_id", b.id).gte("dia", r.dDesde).lte("dia", r.dHasta).order("dia").range(f, t)),
    paginar<any>((f, t) => db.from("ads_insights").select("ad_id, fecha, gasto, impresiones, alcance, clics, clics_link").eq("channel_id", b.id).gte("fecha", r.dDesde).lte("fecha", r.dHasta).order("fecha").order("ad_id").range(f, t)).catch(() => [] as any[]),
    paginar<any>((f, t) => db.from("manual_expenses").select("fecha, monto, descripcion").eq("channel_id", b.id).gte("fecha", r.dDesde).lte("fecha", r.dHasta).order("id").range(f, t)).catch(() => [] as any[]),
    paginar<any>((f, t) => db.from("ads_meta").select("ad_id, account_id, account_currency, ad_name, campaign_name, adset_name, estado").eq("channel_id", b.id).order("ad_id").range(f, t)).catch(() => [] as any[]),
    db.from("ad_accounts").select("account_id").eq("channel_id", b.id).eq("activo", true).then((x: any) => x, () => ({ data: null })),
  ]);
  const cur = String(b.moneda || "PEN").toUpperCase();
  const act = (cuentas as any)?.data ? new Set<string>(((cuentas as any).data as any[]).map((x) => String(x.account_id))) : null;
  return {
    contactos: contactos.filter((k) => !esPrueba(k)),
    pedidos: pedidos.filter((o) => !esPrueba(o.contacts) && String(o.currency || "PEN").toUpperCase() === cur),
    ia, ads, gx, am, activas: act,
  };
}
// Factor del gasto de Meta a la moneda del bot (misma regla que resumen.ts / Inicio) y anuncios de cuentas quitadas.
function reglaAds(b: Ctx["bots"][0], fl: Filas) {
  const cur = String(b.moneda || "PEN").toUpperCase(), tasa = b.usd_rate || 0;
  const monedas = [...new Set(fl.am.map((m) => String(m.account_currency || "").toUpperCase()).filter(Boolean))];
  let factor = 1, sinConvertir = fl.ads.length > 0;
  if (monedas.length && !fl.am.some((m) => !m.account_currency)) {
    if (monedas.every((m) => m === cur)) sinConvertir = false;
    else if (monedas.length === 1 && monedas[0] === "USD" && cur !== "USD" && tasa > 0) { factor = tasa; sinConvertir = false; }
  }
  const fuera = new Set(fl.activas ? fl.am.filter((m) => m.account_id && !fl.activas!.has(String(m.account_id))).map((m) => String(m.ad_id)) : []);
  return { factor, sinConvertir, fuera };
}
const INTERES = ["interesado", "caliente", "confirmado"];
function cuentas(b: Ctx["bots"][0], fl: Filas) {
  const cur = String(b.moneda || "PEN").toUpperCase(), tasa = b.usd_rate || 0;
  const dg = resumirPedidos(fl.pedidos as any);
  const { factor, sinConvertir, fuera } = reglaAds(b, fl);
  const gastoAds = fl.ads.filter((x) => !fuera.has(String(x.ad_id))).reduce((s, x) => s + Number(x.gasto || 0), 0) * factor;
  const gastosExtra = fl.gx.reduce((s, x) => s + Number(x.monto || 0), 0);
  const iaUsd = fl.ia.reduce((s, x) => s + Number(x.costo_usd || 0), 0);
  const gastoIa = cur === "USD" ? iaUsd : tasa > 0 ? iaUsd * tasa : 0;
  const neta = dg.ganancia != null ? dg.ganancia - gastoAds - gastosExtra - gastoIa : null;
  const chats = fl.contactos.length;
  const deAds = fl.contactos.filter((k) => k.ad_id);
  const interesAds = deAds.filter((k) => [...INTERES, "comprado", "perdido"].includes(k.stage)).length;
  // Cierre del bot (Inicio): compraron ÷ (se interesaron + compraron + perdidos que se habían interesado o tuvieron pedido).
  const compraron = fl.contactos.filter((k) => k.stage === "comprado").length;
  const base = fl.contactos.filter((k) => [...INTERES, "comprado"].includes(k.stage)
    || (k.stage === "perdido" && (INTERES.includes(k.etapa_previa) || (k.orders || []).length > 0))).length;
  const inversion = dg.costoProd + dg.envio + gastoAds + gastosExtra + gastoIa;
  const perdidos = fl.pedidos.filter((o) => O.esPerdido(o));
  const esperando = fl.pedidos.filter((o) => o.estado === "esperando_adelanto");
  const vuelto = fl.pedidos.reduce((s, o) => s + (Number(o.shipping?.vuelto) || 0), 0);
  return { dg, gastoAds, gastosExtra, iaUsd, gastoIa, neta, chats, chatsAds: deAds.length, interesAds, compraron, base, inversion,
    perdidos: perdidos.length, esperando: esperando.length, esperandoMonto: esperando.reduce((s, o) => s + O.total(o), 0), vuelto, sinConvertir };
}
type Cuentas = ReturnType<typeof cuentas>;
const pct1 = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "—");
function filaResumen(b: Ctx["bots"][0], c: Cuentas) {
  const din = (n: number) => dinero(n, b.moneda), dg = c.dg;
  return {
    chats_nuevos: c.chats, chats_de_anuncios: c.chatsAds,
    ventas: dg.ventas, ingresos_cobrados: din(dg.ingresos),
    ...(dg.porCobrar > 0 ? { por_cobrar: din(dg.porCobrar) } : {}),
    ticket_promedio: dg.ventas ? din(dg.ticket) : "—",
    conversion: pct1(dg.ventas, c.chats),
    cierre_del_bot: c.base ? `${Math.round((c.compraron / c.base) * 100)}% (${c.compraron} de ${c.base} interesados compraron)` : "—",
    gasto_meta: din(c.gastoAds),
    costo_por_chat: c.gastoAds && c.chatsAds ? din(c.gastoAds / c.chatsAds) : "—",
    costo_por_interesado: c.gastoAds && c.interesAds ? din(c.gastoAds / c.interesAds) : "—",
    costo_por_venta: c.gastoAds && dg.ventas ? din(c.gastoAds / dg.ventas) : "—",
    roas: c.gastoAds ? `${(dg.ingresos / c.gastoAds).toFixed(2)}×` : "—",
    ...(dg.costoProd > 0 ? { costo_de_productos: din(dg.costoProd) } : {}),
    ...(dg.envio > 0 ? { gasto_de_envios: din(dg.envio) } : {}),
    ...(c.gastosExtra > 0 ? { gastos_extra: din(c.gastosExtra) } : {}),
    gasto_ia: c.gastoIa ? din(c.gastoIa) : `$${c.iaUsd.toFixed(3)}`,
    ganancia_bruta: dg.ganancia != null ? din(dg.ganancia) : "—",
    ganancia_neta: c.neta != null ? din(c.neta) : "—",
    roi: c.neta != null && c.inversion > 0 ? `${Math.round((c.neta / c.inversion) * 100)}%` : "—",
    ...(c.perdidos ? { pedidos_perdidos: c.perdidos } : {}),
    ...(c.esperando ? { esperando_adelanto: `${c.esperando} (${din(c.esperandoMonto)})` } : {}),
    ...(c.vuelto > 0 ? { vuelto_por_devolver: din(c.vuelto) } : {}),
  };
}
function notasDe(c: Cuentas): string[] {
  const n: string[] = [];
  if (c.neta == null && c.dg.ventas) n.push("Ninguna venta tiene sus costos registrados: la ganancia no se puede calcular.");
  if (c.dg.gananciaSinDatos) n.push(`${c.dg.gananciaSinDatos} pedido(s) físico(s) sin costo o flete no entran en la ganancia.`);
  if (c.iaUsd > 0 && !c.gastoIa) n.push("El gasto de IA está en dólares y el bot no tiene tipo de cambio: no se restó.");
  if (c.sinConvertir && c.gastoAds) n.push("No se pudo confirmar la moneda de la cuenta de Meta: el gasto va sin convertir.");
  return n;
}
// El periodo anterior del mismo largo (para comparar «esta semana vs la pasada»).
function periodoAnterior(r: ReturnType<typeof periodo>) {
  const len = Date.parse(r.hasta) - Date.parse(r.desde) + 1;
  const desde = new Date(Date.parse(r.desde) - len).toISOString(), hasta = new Date(Date.parse(r.desde) - 1).toISOString();
  const dias = Math.round(len / 864e5);
  const a = new Date(Date.parse(r.dDesde + "T00:00:00Z") - dias * 864e5), z = new Date(Date.parse(r.dDesde + "T00:00:00Z") - 864e5);
  return { desde, hasta, dDesde: ymd(a), dHasta: ymd(z), etiqueta: `${ymd(a)} a ${ymd(z)} (periodo anterior)` };
}
// Día local (YYYY-MM-DD) de un instante, en la zona del bot.
const diaLocal = (iso: string, tz: string) => ymd(new Date(Date.parse(iso) + desfase(tz, new Date(iso)) * 60_000));

// ── Rendimiento «Por copy» (como rendimiento.html › cargaCopys): cada envío de una versión queda en variante_envios con
// si contestó y si compró; la compra solo cuenta si ese cliente tiene HOY una venta viva. Las versiones compiten dentro
// del mismo producto, ámbito (saludo / remarketing), paso y ángulo.
async function porCopy(b: Ctx["bots"][0], r: ReturnType<typeof periodo>) {
  const [envs, os, { data: fls }, { data: ps }] = await Promise.all([
    paginar<any>((f, t) => db.from("variante_envios").select("contact_id, ambito, ref_id, paso, variante_id, variante_rev, variante_nom, angulo, respondio_at, compro_at, monto").eq("channel_id", b.id).gte("enviado_at", r.desde).lte("enviado_at", r.hasta).order("enviado_at").order("id").range(f, t), 60000),
    paginar<any>((f, t) => db.from("orders").select("contact_id, estado").eq("channel_id", b.id).order("id").range(f, t), 60000),
    db.from("flows").select("id, product_id").eq("channel_id", b.id),
    db.from("products").select("id, nombre, config").eq("channel_id", b.id),
  ]);
  const viva = new Set(os.filter((o) => { const e = O.EST[o.estado] || {}; return e.venta && !e.perdido; }).map((o) => o.contact_id));
  const prodNom = new Map(((ps ?? []) as any[]).map((p) => [p.id, p.nombre]));
  const refProd = new Map<string, string>();
  for (const x of (fls ?? []) as any[]) if (x.product_id) refProd.set(String(x.id), x.product_id);
  for (const p of (ps ?? []) as any[]) { const c = p.config || {}; const ids = [c.remarketing_seq_id, ...Object.values(c.remarketing_seqs || {}), ...Object.values(c.remarketing_seqs_angulo || {})]; for (const id of ids) if (id) refProd.set(String(id), p.id); }
  const m = new Map<string, any>();
  for (const x of envs) {
    const prod = prodNom.get(refProd.get(String(x.ref_id)) ?? "") ?? "Sin producto";
    const k = [x.ambito, prod, x.angulo || "", x.paso ?? "", x.variante_id, x.variante_rev].join("|");
    const v = m.get(k) ?? { ambito: x.ambito, prod, ang: x.angulo || "", paso: x.paso ?? null, nombre: x.variante_nom || "—", env: 0, resp: 0, compras: 0, monto: 0 };
    if (x.variante_nom) v.nombre = x.variante_nom;
    v.env++; if (x.respondio_at) v.resp++; if (x.compro_at && viva.has(x.contact_id)) { v.compras++; v.monto += Number(x.monto) || 0; }
    m.set(k, v);
  }
  if (!m.size) return { bot: b.nombre, periodo: r.etiqueta, por: "copy", nota: "No hay copys medidos en este periodo: se mide solo cuando un saludo o un toque de remarketing tiene 2 o más versiones." };
  const grupos = new Map<string, any[]>();
  for (const v of m.values()) { const g = [v.ambito, v.prod, v.ang, v.paso].join("|"); grupos.set(g, [...(grupos.get(g) ?? []), v]); }
  const din = (n: number) => dinero(n, b.moneda);
  return { bot: b.nombre, periodo: r.etiqueta, por: "copy",
    nota: "Cada grupo compara las versiones de UN mensaje (mismo producto, ámbito, toque y ángulo). Con menos de 30 envíos por versión, la diferencia puede ser suerte.",
    grupos: [...grupos.values()].sort((p, q) => String(p[0].prod).localeCompare(String(q[0].prod)) || (p[0].ambito === "inicial" ? -1 : 0) - (q[0].ambito === "inicial" ? -1 : 0) || (Number(p[0].paso) || 0) - (Number(q[0].paso) || 0)).slice(0, 25).map((vs) => {
      const v0 = vs[0], tasa = (x: any) => (x.env ? x.compras / x.env : 0);
      const gana = vs.length > 1 ? [...vs].sort((p, q) => tasa(q) - tasa(p) || q.resp / (q.env || 1) - p.resp / (p.env || 1))[0] : null;
      return { mensaje: v0.ambito === "inicial" ? "Saludo inicial" : `Remarketing · toque ${v0.paso != null ? Number(v0.paso) + 1 : "?"}`, producto: v0.prod, ...(v0.ang ? { angulo: v0.ang } : {}),
        ...(gana && gana.env >= 30 ? { va_ganando: gana.nombre } : vs.length > 1 ? { va_ganando: "aún sin datos suficientes" } : {}),
        versiones: vs.map((x) => ({ version: x.nombre, recibieron: x.env, contestaron: x.resp, tasa_respuesta: pct1(x.resp, x.env), compraron: x.compras, tasa_compra: pct1(x.compras, x.env), ingresos: din(x.monto) })) }; }) };
}

// ── Rendimiento (como la pantalla Rendimiento: ventas atribuidas por shipping.ad_id) ──
function nombreAd(am: any[], id: string) { const m = am.find((x) => String(x.ad_id) === id); return m ? (m.ad_name || id) : id; }


// ── Ayudas para configurar productos (28-nov-2026) ─────────────────────────
const P_PROD = { type: "string", description: "Nombre (o parte del nombre) del producto." };
const corto = (t: unknown, n: number) => { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
// El producto por nombre (como cambiar_precio): exacto, si no el único que lo contiene.
async function productoDe(b: Ctx["bots"][0], ref: unknown) {
  const { data: ps, error } = await db.from("products").select("id, nombre, tipo, emoji, config, product_versions(id, nombre, precio, entrega, entrega_mensaje)").eq("channel_id", b.id);
  if (error) throw new Fallo(error.message);
  const all = (ps ?? []) as any[]; const r = norm(ref);
  if (!all.length) throw new Fallo(`«${b.nombre}» no tiene productos todavía.`);
  if (!r) { if (all.length === 1) return all[0]; throw new Fallo(`Dime de qué producto: ${all.map((p) => p.nombre).join(", ")}.`); }
  const ex = all.filter((p) => p.id === String(ref) || norm(p.nombre) === r); if (ex.length === 1) return ex[0];
  const pa = all.filter((p) => norm(p.nombre).includes(r)); if (pa.length === 1) return pa[0];
  if (pa.length > 1) throw new Fallo(`Hay varios productos con «${ref}»: ${pa.map((p) => p.nombre).join(", ")}. ¿Cuál?`);
  throw new Fallo(`No encontré el producto «${ref}» en «${b.nombre}». Tiene: ${all.map((p) => p.nombre).join(", ")}.`);
}
// Cambia solo lo que toca sobre el config FRESCO (como patchProductConfig del panel): nunca pisa lo que otro guardó.
async function patchProducto(pid: string, fn: (c: any, tipo: string) => void) {
  const { data, error: e0 } = await db.from("products").select("config, tipo").eq("id", pid).maybeSingle();
  if (e0) throw new Fallo(e0.message);
  const c = structuredClone(((data as any)?.config ?? {}) as any);
  fn(c, String((data as any)?.tipo ?? "digital"));
  const { error } = await db.from("products").update({ config: c }).eq("id", pid);
  if (error) throw new Fallo(error.message);
  return c;
}
// La ficha se compila igual que al guardar en el panel (panel/producto-ia.js): el motor lee contexto_producto y faq.
function recompilarFicha(c: any, tipo: string) {
  c.ia = c.ia || {};
  if (!c.ia.detalle && c.contexto_producto && !c.ia._migrado) { c.ia.detalle = c.contexto_producto; c.ia._migrado = true; }
  fusionarFicha(c);
  if (Array.isArray(c.faq_items)) { const f = compileFaq(c.faq_items); if (f) c.faq = f; else delete c.faq; }
  const cx = compileProductoIA(c, tipo || "digital");
  if (cx) c.contexto_producto = cx; else delete c.contexto_producto;
}
// Los mensajes iniciales del producto (flujo «mensajes_iniciales» con su nodo rotador). Si no existen, se crean como
// «Crear mensajes iniciales» del panel; si ya hay flujo de venta, el saludo pasa a él al terminar.
async function flujoInicial(b: Ctx["bots"][0], p: any): Promise<{ flowId: string; nodoId: string; creado: boolean }> {
  const { data: fl } = await db.from("flows").select("id").eq("product_id", p.id).eq("role", "mensajes_iniciales").eq("kind", "flow").order("created_at").limit(1).maybeSingle();
  let flowId = (fl as any)?.id as string | undefined, creado = false;
  if (!flowId) {
    const folder = ((p.emoji ? p.emoji + " " : "") + p.nombre).slice(0, 60);
    const { data: nf, error } = await db.from("flows").insert({ channel_id: b.id, product_id: p.id, kind: "flow", role: "mensajes_iniciales", nombre: "Mensajes iniciales · " + p.nombre, estado: "activo", folder }).select("id").single();
    if (error) throw new Fallo(error.message);
    flowId = (nf as any).id; creado = true;
  }
  const { data: ns } = await db.from("flow_nodes").select("id, tipo, es_inicial").eq("flow_id", flowId);
  let nodo = ((ns ?? []) as any[]).find((n) => n.tipo === "rotador") ?? ((ns ?? []) as any[]).find((n) => n.es_inicial);
  if (!nodo) {
    const { data: venta } = await db.from("flows").select("id").eq("product_id", p.id).eq("role", "venta").eq("estado", "activo").limit(1).maybeSingle();
    const { data: nn, error } = await db.from("flow_nodes").insert({ flow_id: flowId, tipo: "rotador", nombre: "Mensajes iniciales", es_inicial: true, pos_x: 80, pos_y: 80,
      config: { activo: true, variantes: [], despues: (venta as any)?.id ? { modo: "flujo", flow_id: (venta as any).id } : { modo: "nada" } } }).select("id").single();
    if (error) throw new Fallo(error.message);
    nodo = nn;
  }
  return { flowId: flowId!, nodoId: (nodo as any).id, creado };
}
// Imagen por ENLACE → se baja y se sube al almacenamiento de Nodo (bucket «media», misma ruta que media-upload), para que
// WhatsApp la pueda descargar siempre. Solo jpg/png de hasta 5 MB (lo que acepta WhatsApp como imagen).
async function subirImagen(b: Ctx["bots"][0], url: unknown): Promise<{ url: string; mime: string; filename: string }> {
  const u = String(url ?? "").trim();
  if (!/^https?:\/\/\S+$/i.test(u)) throw new Fallo(`«${u}» no es un enlace válido a una imagen.`);
  if (/drive\.google\.com\/(file|drive)|docs\.google\.com/i.test(u)) throw new Fallo("Ese es el enlace de la PÁGINA de Google Drive, no de la imagen. Usa un enlace directo a un .jpg o .png (o súbela en el panel).");
  let res: Response;
  try { res = await fetch(u, { signal: AbortSignal.timeout(20_000), redirect: "follow" }); } catch (e) { throw new Fallo(`No pude descargar la imagen (${String((e as any)?.message ?? e).slice(0, 80)}).`); }
  if (!res.ok) throw new Fallo(`No pude descargar la imagen: el enlace respondió ${res.status}.`);
  const mime = String(res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!["image/jpeg", "image/jpg", "image/png"].includes(mime)) throw new Fallo(`Ese enlace no es una imagen jpg o png (es «${mime || "desconocido"}»).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > 5 * 1024 * 1024) throw new Fallo("La imagen pesa más de 5 MB: WhatsApp no la acepta.");
  const ext = mime === "image/png" ? "png" : "jpg";
  const path = `acct/${b.account_id}/chat/${b.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from("media").upload(path, bytes, { contentType: mime === "image/jpg" ? "image/jpeg" : mime, upsert: false });
  if (error) throw new Fallo("No pude guardar la imagen: " + error.message);
  const pub = db.storage.from("media").getPublicUrl(path).data.publicUrl;
  return { url: pub, mime: mime === "image/jpg" ? "image/jpeg" : mime, filename: path.split("/").pop()! };
}

const NUEVAS: Tool[] = [
  { name: "rendimiento", description: "Cómo le va a cada ANUNCIO, ÁNGULO o PRODUCTO en un periodo (como la pantalla Rendimiento): gasto, impresiones, CTR, CPM, chats, costo por chat, interesados, calientes, ventas, CPA, ingresos, ROAS y ganancia neta. Ordenado por gasto. Úsalo para «¿qué anuncio apago?», «¿qué ángulo vende más barato?».",
    inputSchema: S({ bot: P_BOT, por: { type: "string", enum: ["anuncio", "angulo", "producto", "copy"], description: "Por defecto: anuncio. «copy» = qué saludo y qué mensaje de remarketing venden más (versiones A/B)." }, periodo: P_PER, desde: P_D, hasta: P_D, limite: { type: "number", description: "Máximo 40 filas (por defecto 15)." } }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); const r = periodo(b.timezone, a?.periodo ?? "7dias", a?.desde, a?.hasta);
      if (a?.por === "copy") return porCopy(b, r);
      const por = ["angulo", "producto"].includes(a?.por) ? a.por : "anuncio";
      const fl = await traer(b, r);
      const { factor, fuera } = reglaAds(b, fl);
      const [{ data: angs }, { data: prods }] = await Promise.all([
        db.from("angulos").select("nombre, slug, ad_ids, product_id").eq("channel_id", b.id),
        db.from("products").select("id, nombre, config").eq("channel_id", b.id),
      ]);
      // Anuncio → ángulo y → producto (por el ángulo o el banco de anuncios del producto).
      const angDe = new Map<string, string>(), prodDe = new Map<string, string>();
      for (const g of (angs ?? []) as any[]) for (const id of (g.ad_ids ?? []) as string[]) { angDe.set(String(id), g.nombre || g.slug); if (g.product_id) prodDe.set(String(id), g.product_id); }
      for (const p of (prods ?? []) as any[]) for (const id of ((p.config?.ad_bank ?? []) as string[])) if (!prodDe.has(String(id))) prodDe.set(String(id), p.id);
      const nomProd = new Map(((prods ?? []) as any[]).map((p) => [p.id, p.nombre]));
      const claveDe = (ad: string, prodPedido?: string) => por === "anuncio" ? ad
        : por === "angulo" ? (angDe.get(ad) ?? "Sin ángulo")
        : (nomProd.get(prodDe.get(ad) ?? prodPedido ?? "") ?? "Sin producto");
      const filas = new Map<string, any>();
      const fila = (k: string) => { if (!filas.has(k)) filas.set(k, { k, gasto: 0, impr: 0, clicsLink: 0, imprLink: 0, chats: 0, interes: 0, calientes: 0, compraron: 0, conf: 0, ventas: 0, ingresos: 0, margen: 0, sinMargen: 0 }); return filas.get(k); };
      for (const i of fl.ads) { const ad = String(i.ad_id); if (fuera.has(ad)) continue; const x = fila(claveDe(ad)); x.gasto += Number(i.gasto || 0) * factor; x.impr += Number(i.impresiones || 0); if (i.clics_link != null) { x.clicsLink += Number(i.clics_link || 0); x.imprLink += Number(i.impresiones || 0); } }
      for (const k of fl.contactos) { if (!k.ad_id || fuera.has(String(k.ad_id))) continue; const x = fila(claveDe(String(k.ad_id))); const s = k.stage || "nuevo"; x.chats++;
        if ([...INTERES, "comprado"].includes(s)) x.interes++; if (["caliente", "confirmado", "comprado"].includes(s)) x.calientes++; if (s === "comprado") x.compraron++; }
      for (const o of fl.pedidos) { const ad = o.shipping?.ad_id; if (!ad) continue; const x = fila(claveDe(String(ad), o.product_id)); const e = O.EST[o.estado] || {};
        if (e.venta && !e.perdido) x.conf++;
        if (e.cobro === "todo") { x.ventas++; x.ingresos += O.total(o); const m = !O.esFisico(o) ? O.cobrado(o) - (O.costoProducto(o, o.product, 1) || 0) : O.margen(o, o.product, 1); if (m != null) x.margen += m; else x.sinMargen++; } }
      const din = (n: number) => dinero(n, b.moneda);
      const lista = [...filas.values()].sort((p, q) => q.gasto - p.gasto || q.ventas - p.ventas).slice(0, Math.min(Number(a?.limite) || 15, 40));
      const tot = [...filas.values()].reduce((s, x) => ({ gasto: s.gasto + x.gasto, ventas: s.ventas + x.ventas, ingresos: s.ingresos + x.ingresos, margen: s.margen + x.margen, chats: s.chats + x.chats }), { gasto: 0, ventas: 0, ingresos: 0, margen: 0, chats: 0 });
      // 💸 Mensajes que Meta cobra (como Rendimiento): por origen del contacto, con la tarifa del bot si la tiene.
      const [{ data: vr }, { data: chT }] = await Promise.all([
        db.rpc("gasto_meta_por_origen", { p_channel_id: b.id, p_desde: r.dDesde, p_hasta: r.dHasta }),
        db.from("channels").select("tarifa_msg_usd").eq("id", b.id).maybeSingle(),
      ]);
      const vent = ((vr ?? []) as any[]), tarifa = Number((chT as any)?.tarifa_msg_usd) > 0;
      const cobra = vent.length ? { por_origen: vent.map((v) => ({ origen: v.origen, conversaciones: Number(v.conversaciones), mensajes_gratis_ventana_del_anuncio: Number(v.msgs_gratis), mensajes_cobrables: Number(v.msgs_cobrables), ...(tarifa ? { costo_estimado_usd: Number(v.costo_usd || 0).toFixed(2) } : {}) })),
        total_cobrables: vent.reduce((s2, v) => s2 + Number(v.msgs_cobrables || 0), 0), ...(tarifa ? {} : { nota: "Sin tarifa por mensaje cargada en el bot: no se calcula el costo." }) } : null;
      return { bot: b.nombre, periodo: r.etiqueta, por, nota: "Solo cuenta ventas que llegaron por un anuncio (como Rendimiento). Ganancia neta = margen de esas ventas − su gasto.",
        ...(cobra ? { mensajes_que_meta_cobra: cobra } : {}),
        total: { gasto: din(tot.gasto), chats: tot.chats, ventas: tot.ventas, ingresos: din(tot.ingresos), cpa: tot.ventas ? din(tot.gasto / tot.ventas) : "—", roas: tot.gasto ? `${(tot.ingresos / tot.gasto).toFixed(2)}×` : "—", ganancia_neta: din(tot.margen - tot.gasto) },
        filas: lista.map((x) => {
          const m = por === "anuncio" ? fl.am.find((y) => String(y.ad_id) === x.k) : null;
          return {
            [por]: por === "anuncio" ? nombreAd(fl.am, x.k) : x.k,
            ...(m ? { campana: m.campaign_name, conjunto: m.adset_name, estado_en_meta: m.estado, id: x.k, angulo: angDe.get(x.k) ?? "Sin ángulo" } : {}),
            gasto: din(x.gasto), impresiones: x.impr, ctr: x.imprLink ? `${((x.clicsLink / x.imprLink) * 100).toFixed(2)}%` : "—", cpm: x.impr ? din((x.gasto / x.impr) * 1000) : "—",
            chats: x.chats, costo_por_chat: x.chats ? din(x.gasto / x.chats) : "—", interesados: x.interes, calientes: x.calientes,
            confirmaciones: x.conf, ventas: x.ventas, cpa: x.ventas ? din(x.gasto / x.ventas) : "—", ingresos: din(x.ingresos),
            roas: x.gasto ? `${(x.ingresos / x.gasto).toFixed(2)}×` : "—", ganancia_neta: din(x.margen - x.gasto),
            ...(x.sinMargen ? { aviso: `${x.sinMargen} venta(s) sin costo registrado no entran en la ganancia` } : {}),
          };
        }) };
    } },

  { name: "embudo", description: "El embudo de un periodo (como la pantalla Embudo): de los que llegaron, cuántos fueron curiosos, se interesaron, se pusieron calientes, confirmaron y compraron, con el % que se cae en cada paso y la MAYOR FUGA; el estado actual de los clientes; la conversión por anuncio; y el EMBUDO DE ENTREGA de provincia (tasa de recojo, en agencia, no recogieron, flete perdido) y de Lima (tasa de entrega, en reparto, rechazados).",
    inputSchema: S({ bot: P_BOT, periodo: P_PER, desde: P_D, hasta: P_D }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); const r = periodo(b.timezone, a?.periodo ?? "7dias", a?.desde, a?.hasta);
      const fl = await traer(b, r);
      // Escalera acumulada (como el Embudo): la etapa de hoy (o la de antes de perderse) cuenta para todos los pasos previos.
      const ORDEN = ["nuevo", "curioso", "interesado", "caliente", "confirmado", "comprado"];
      const nivel = (k: any) => { const s = k.stage === "perdido" ? (k.etapa_previa || "nuevo") : (k.stage || "nuevo"); const i = ORDEN.indexOf(s); return i < 0 ? 0 : i; };
      const PASOS: [string, number][] = [["Llegaron", 0], ["Curiosos", 1], ["Se interesaron", 2], ["Calientes", 3], ["Confirmaron", 4], ["Compraron", 5]];
      const n = PASOS.map(([nom, i]) => [nom, fl.contactos.filter((k) => nivel(k) >= i).length] as [string, number]);
      let fuga = { paso: "", se_fueron: 0, pct: 0 };
      const pasos = n.map(([nom, c], i) => {
        const prev = i ? n[i - 1][1] : c, cae = prev - c, pc = prev ? Math.round((cae / prev) * 100) : 0;
        if (i && cae > fuga.se_fueron) fuga = { paso: `${n[i - 1][0]} → ${nom}`, se_fueron: cae, pct: pc };
        return { paso: nom, personas: c, del_total: n[0][1] ? `${Math.round((c / n[0][1]) * 100)}%` : "—", ...(i ? { se_cayeron_aqui: `${cae} (${pc}%)` } : {}) };
      });
      const estado: Record<string, number> = {};
      for (const k of fl.contactos) estado[k.stage || "nuevo"] = (estado[k.stage || "nuevo"] || 0) + 1;
      const porAd = new Map<string, { llegaron: number; pedidos: number; monto: number }>();
      for (const k of fl.contactos) if (k.ad_id) { const x = porAd.get(String(k.ad_id)) ?? { llegaron: 0, pedidos: 0, monto: 0 }; x.llegaron++; porAd.set(String(k.ad_id), x); }
      for (const o of fl.pedidos) { const ad = o.shipping?.ad_id; if (!ad || !O.esVenta(o) || O.esPerdido(o)) continue; const x = porAd.get(String(ad)) ?? { llegaron: 0, pedidos: 0, monto: 0 }; x.pedidos++; x.monto += O.total(o); porAd.set(String(ad), x); }
      const c = cuentas(b, fl);
      // Embudo de ENTREGA: los pedidos (todos, de cualquier fecha) de las personas que llegaron en estas fechas.
      const ids = fl.contactos.map((k) => k.id);
      const ords: any[] = [];
      for (let i = 0; i < ids.length; i += 200) { const { data } = await db.from("orders").select("estado, currency, shipping, product:product_id(tipo)").in("contact_id", ids.slice(i, i + 200)); ords.push(...((data ?? []) as any[])); }
      const cur = String(b.moneda || "PEN").toUpperCase(), enMon = (o: any) => String(o.currency || "PEN").toUpperCase() === cur;
      const din = (n: number) => dinero(n, b.moneda);
      const cuenta = (zona: string) => { const cnt: Record<string, number> = {}; let flete = 0, agConPago = 0;
        for (const o of ords) { if (!O.esFisico(o) || O.zonaDe(o) !== zona) continue; cnt[o.estado] = (cnt[o.estado] || 0) + 1; const sh = o.shipping || {};
          if (zona === "provincia" && o.estado === "en_agencia" && (sh.saldo_comprobante || sh.saldo_recibido_at)) agConPago++;
          if (((zona === "provincia" && o.estado === "no_recogido") || (zona === "lima" && o.estado === "rechazado")) && enMon(o)) flete += Number(sh.flete || 0); }
        return { g: (k: string) => cnt[k] || 0, flete, agConPago }; };
      const p = cuenta("provincia"), g = p.g;
      const conAd = g("adelanto_validado") + g("por_despachar") + g("despachado") + g("en_agencia") + g("saldo_pagado") + g("recogido") + g("no_recogido");
      const provincia = conAd ? (() => { const env = g("despachado") + g("en_agencia") + g("saldo_pagado") + g("recogido") + g("no_recogido"), enAg = g("en_agencia") + g("saldo_pagado") + g("recogido") + g("no_recogido");
        const pago = p.agConPago + g("saldo_pagado") + g("recogido"), clave = g("saldo_pagado") + g("recogido"), rec = g("recogido"), noRec = g("no_recogido");
        return { tasa_de_recojo: rec + noRec ? `${Math.round((rec / (rec + noRec)) * 100)}% (${rec} de ${rec + noRec} ya resueltos)` : "— (aún sin desenlaces)",
          en_agencia_ahora: g("en_agencia"), no_recogieron: noRec, ...(p.flete > 0 ? { flete_perdido: din(p.flete) } : {}),
          pasos: [["Con adelanto", conAd], ["Enviados", env], ["En agencia", enAg], ["Pagaron saldo", pago], ["Clave enviada", clave], ["Recogieron", rec]].map(([n, v]) => ({ paso: n, pedidos: v, de_los_con_adelanto: `${Math.round(((v as number) / conAd) * 100)}%` })) }; })() : null;
      const l = cuenta("lima"), h = l.g;
      const conf = h("confirmado") + h("en_reparto") + h("reprogramado") + h("entregado_cobrado") + h("rechazado");
      const lima = conf ? (() => { const sal = h("en_reparto") + h("reprogramado") + h("entregado_cobrado") + h("rechazado"), ent = h("entregado_cobrado"), rech = h("rechazado");
        return { tasa_de_entrega: ent + rech ? `${Math.round((ent / (ent + rech)) * 100)}% (${ent} de ${ent + rech} ya resueltos)` : "— (aún sin desenlaces)",
          en_reparto_ahora: h("en_reparto"), reprogramados: h("reprogramado"), rechazados: rech, ...(l.flete > 0 ? { flete_perdido: din(l.flete) } : {}), esperando_salir: h("confirmado"),
          pasos: [["Confirmados", conf], ["Salieron", sal], ["Entregados", ent]].map(([n, v]) => ({ paso: n, pedidos: v, de_los_confirmados: `${Math.round(((v as number) / conf) * 100)}%` })) }; })() : null;
      return { bot: b.nombre, periodo: r.etiqueta, nota: "Cuenta a las personas que te escribieron por primera vez en estas fechas, con la etapa que tienen hoy.",
        ...(provincia ? { entrega_provincia: provincia } : {}), ...(lima ? { entrega_lima: lima } : {}),
        conversion_total: pct1(c.dg.ventas, c.chats), efectividad_de_cierre: c.base ? `${Math.round((c.compraron / c.base) * 100)}%` : "—",
        pasos, mayor_fuga: fuga.paso ? fuga : null, estado_actual: estado,
        por_anuncio: [...porAd.entries()].sort((p, q) => q[1].llegaron - p[1].llegaron).slice(0, 12).map(([id, x]) => ({ anuncio: nombreAd(fl.am, id), llegaron: x.llegaron, pedidos: x.pedidos, conversion: pct1(x.pedidos, x.llegaron), monto: dinero(x.monto, b.moneda) })) };
    } },

  { name: "ganancia_por_dia", description: "Ganancia neta, ventas, ingresos, gasto en Meta e IA de cada día del periodo (como el «Profit diario» de Inicio). Máximo 62 días.",
    inputSchema: S({ bot: P_BOT, periodo: P_PER, desde: P_D, hasta: P_D }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); const r = periodo(b.timezone, a?.periodo ?? "mes", a?.desde, a?.hasta);
      const dias: string[] = []; for (let d = Date.parse(r.dDesde + "T00:00:00Z"); d <= Date.parse(r.dHasta + "T00:00:00Z") && dias.length < 62; d += 864e5) dias.push(ymd(new Date(d)));
      const fl = await traer(b, r);
      const din = (n: number) => dinero(n, b.moneda);
      const filas = dias.map((d) => {
        const sub: Filas = { ...fl,
          contactos: fl.contactos.filter((k) => diaLocal(k.primera_interaccion || k.created_at, b.timezone) === d),
          pedidos: fl.pedidos.filter((o) => diaLocal(o.created_at, b.timezone) === d),
          ia: fl.ia.filter((x) => x.dia === d), ads: fl.ads.filter((x) => x.fecha === d), gx: fl.gx.filter((x) => x.fecha === d) };
        const c = cuentas(b, sub);
        return { dia: d, ventas: c.dg.ventas, ingresos: din(c.dg.ingresos), gasto_meta: din(c.gastoAds), gasto_ia: din(c.gastoIa), ganancia_neta: c.neta != null ? din(c.neta) : "—", _n: c.neta ?? 0 };
      });
      const verdes = filas.filter((f) => f._n > 0).length, mejor = filas.reduce((m, f) => (f._n > m._n ? f : m), filas[0]);
      return { bot: b.nombre, periodo: r.etiqueta, dias_en_verde: `${verdes} de ${filas.length}`, mejor_dia: mejor ? `${mejor.dia} (${mejor.ganancia_neta})` : "—",
        total_ganancia_neta: din(filas.reduce((s, f) => s + f._n, 0)), dias: filas.map(({ _n, ...f }) => f) };
    } },

  { name: "compras", description: "Los pagos que ENTRARON en un periodo (como la pantalla Compras): ventas cobradas al 100%, con cliente, producto, monto, medio de pago, número de operación y si ya se verificó con el banco.",
    inputSchema: S({ bot: P_BOT, periodo: P_PER, desde: P_D, hasta: P_D, limite: { type: "number" } }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); const r = periodo(b.timezone, a?.periodo ?? "7dias", a?.desde, a?.hasta);
      const os = await paginar<any>((f, t) => db.from("orders").select("id, amount, currency, order_bumps, estado, created_at, shipping, product:product_id(nombre, tipo), version:version_id(nombre), contacts(nombre, wa_id, source)").eq("channel_id", b.id).gte("created_at", r.desde).lte("created_at", r.hasta).order("created_at", { ascending: false }).order("id").range(f, t));
      const cerr = os.filter((o) => !esPrueba(o.contacts) && O.esCerrado(o));
      const din = (n: number) => dinero(n, b.moneda);
      const sh = (o: any) => o.shipping || {};
      const verif = cerr.filter((o) => !!sh(o).conciliacion).length;
      return { bot: b.nombre, periodo: r.etiqueta, compras: cerr.length, cobrado: din(cerr.reduce((s, o) => s + O.cobrado(o), 0)), verificadas_con_el_banco: `${verif} de ${cerr.length}`,
        lista: cerr.slice(0, Math.min(Number(a?.limite) || 30, 100)).map((o) => ({ fecha: horaLocal(o.created_at, b.timezone), cliente: o.contacts?.nombre ?? null, telefono: o.contacts?.wa_id ?? null,
          producto: [o.product?.nombre, o.version?.nombre].filter(Boolean).join(" · "), monto: din(O.total(o)), zona: O.zonaDe(o),
          medio: sh(o).digital_metodo || sh(o).saldo_metodo || sh(o).adelanto_metodo || null, operacion: sh(o).digital_operacion || sh(o).saldo_operacion || sh(o).adelanto_operacion || null,
          verificada: !!sh(o).conciliacion, ...(Number(sh(o).vuelto) > 0 ? { vuelto_a_favor_del_cliente: din(Number(sh(o).vuelto)) } : {}) })) };
    } },

  { name: "pagos_por_validar", description: "Los pagos que esperan que una persona los revise (como Pagos por validar): cliente, monto que pagó, monto esperado, número de operación, por qué la IA no lo aprobó sola y hace cuánto espera. Solo lectura: aprobarlos se hace en el panel.",
    inputSchema: S({ bot: { type: "string", description: "Bot; omítelo para revisar todos." } }),
    run: async (ctx, a) => {
      const bots = a?.bot ? [botDe(ctx, a.bot)] : ctx.bots;
      const TIPOS = ["adelanto_validar", "saldo_validar", "pago_digital_validar", "pago_extra_validar", "prepago_lima_validar"];
      const NOM: Record<string, string> = { adelanto_validar: "Adelanto", saldo_validar: "Saldo", pago_digital_validar: "Pago digital", pago_extra_validar: "Pago de una venta extra", prepago_lima_validar: "Pago adelantado de Lima" };
      const out = [];
      for (const b of bots) {
        const { data } = await db.from("notificaciones").select("tipo, datos, detalle, created_at, contacts(nombre, wa_id)").eq("channel_id", b.id).in("tipo", TIPOS).eq("por_atender", true).is("resuelta_at", null).order("created_at");
        const din = (x: unknown) => (x == null || x === "" ? null : /^\d/.test(String(x)) ? dinero(Number(x), b.moneda) : String(x));
        const lista = ((data ?? []) as any[]).map((n) => ({ tipo: NOM[n.tipo] ?? n.tipo, cliente: n.contacts?.nombre ?? n.datos?.cliente ?? null, telefono: n.contacts?.wa_id ?? null,
          pago: din(n.datos?.monto_leido), esperado: din(n.datos?.monto_esperado ?? n.datos?.monto), por_cobrar: din(n.datos?.por_cobrar),
          operacion: n.datos?.operacion ?? null, producto: n.datos?.producto ?? null, por_que_revisar: n.datos?.motivo ?? null, espera_desde: horaLocal(n.created_at, b.timezone) }));
        out.push({ bot: b.nombre, esperando: lista.length, pagos: lista });
      }
      return { pagos_por_validar: out, nota: "Para aprobar o rechazar, entra a Nodo → Pagos por validar." };
    } },

  { name: "cliente", description: "La ficha completa de UN cliente: etapa, producto que le interesa, cuánto ha gastado y cuántas compras, su último pedido, sus etiquetas, la MEMORIA IA (quién es y cómo tratarlo), de qué anuncio vino (nombre, campaña) y si el bot lo atiende.",
    inputSchema: S({ bot: P_BOT, cliente: P_CLI }, ["cliente"]),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); const k0 = await contactoDe(b.id, a?.cliente);
      const [{ data: k }, { data: os }, { data: tg }] = await Promise.all([
        db.from("contacts").select("id, nombre, wa_id, telefono, stage, etapa_previa, source, ad_id, ad_ref, bot_activo, bloqueado, no_remarketing, memoria_ia, created_at, primera_interaccion, ultimo_mensaje_at, products(nombre)").eq("id", k0.id).maybeSingle(),
        db.from("orders").select("id, estado, amount, order_bumps, shipping, created_at, product:product_id(nombre, tipo)").eq("contact_id", k0.id).order("created_at", { ascending: false }).limit(20),
        db.from("contact_tags").select("tags(nombre)").eq("contact_id", k0.id),
      ]);
      const c: any = k ?? k0, ords = (os ?? []) as any[];
      const din = (n: number) => dinero(n, b.moneda);
      const ventas = ords.filter((o) => O.esVenta(o) && !O.esPerdido(o));
      let anuncio: any = null;
      if (c.ad_id) { const { data: m } = await db.from("ads_meta").select("ad_name, campaign_name, adset_name, estado").eq("channel_id", b.id).eq("ad_id", c.ad_id).maybeSingle();
        anuncio = { id: c.ad_id, nombre: (m as any)?.ad_name ?? null, campana: (m as any)?.campaign_name ?? null, conjunto: (m as any)?.adset_name ?? null, estado: (m as any)?.estado ?? null, titulo: c.ad_ref?.headline ?? c.ad_ref?.title ?? null }; }
      const mem = c.memoria_ia && typeof c.memoria_ia === "object" ? c.memoria_ia : {};
      const u = ords[0];
      return { bot: b.nombre, cliente: { id: c.id, nombre: c.nombre, telefono: c.wa_id, etapa: c.stage, ...(c.stage === "perdido" && c.etapa_previa ? { etapa_antes_de_perderse: c.etapa_previa } : {}),
        producto_que_le_interesa: c.products?.nombre ?? null, llego: horaLocal(c.primera_interaccion || c.created_at, b.timezone), ultimo_mensaje: horaLocal(c.ultimo_mensaje_at, b.timezone),
        origen: c.ad_id ? "anuncio" : "orgánico", anuncio, bot_atiende: c.bot_activo !== false, bloqueado: !!c.bloqueado, fuera_del_remarketing: !!c.no_remarketing,
        etiquetas: ((tg ?? []) as any[]).map((x) => x.tags?.nombre).filter(Boolean),
        compras: ventas.length, total_gastado: din(ventas.reduce((s, o) => s + O.cobrado(o), 0)),
        ultimo_pedido: u ? { estado: O.label(u.estado), monto: din(O.total(u)), producto: u.product?.nombre ?? null, fecha: horaLocal(u.created_at, b.timezone), zona: O.zonaDe(u) } : null,
        memoria_ia: { quien_es: mem.quien_es ?? null, como_tratarlo: mem.como_tratar ?? null } } };
    } },

  { name: "directo", description: "La cola de Directo: clientes que conviene llamar o escribir HOY, primero los más urgentes (dio sus datos y no pagó, pidió una persona, seguimiento vencido). Con su etapa, último mensaje, intentos y próximo contacto.",
    inputSchema: S({ bot: P_BOT, limite: { type: "number", description: "Máximo 40 (por defecto 15)." } }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot);
      const cs = await paginar<any>((f, t) => db.from("contacts").select("id, nombre, wa_id, stage, bot_activo, directo, ultimo_mensaje_at, created_at, source, products(nombre), orders(estado, amount, created_at), conversations(archivada)").eq("channel_id", b.id).in("stage", ["interesado", "caliente", "confirmado"]).order("ultimo_mensaje_at", { ascending: false, nullsFirst: false }).range(f, t), 3000);
      const hoy = ymd(new Date(Date.now() + desfase(b.timezone) * 60_000));
      const dir = (c: any) => (c.directo && typeof c.directo === "object" ? c.directo : {});
      const ult = (c: any) => ((c.orders || []) as any[]).sort((p, q) => String(q.created_at).localeCompare(String(p.created_at)))[0];
      const W: Record<string, number> = { confirmado: 3, caliente: 2, interesado: 1 };
      const urg = (c: any) => { const o = ult(c); if (!o) return c.bot_activo === false ? 3 : 2; if (["esperando_adelanto", "pendiente"].includes(o.estado)) return 3; const m = O.EST[o.estado] || {}; return m.perdido || m.cobro === "todo" ? 0 : 1; };
      const lista = cs.filter((c) => !esPrueba(c) && !(Array.isArray(c.conversations) ? c.conversations[0]?.archivada : c.conversations?.archivada) && !["cerrado", "descartado"].includes(dir(c).estado))
        .map((c) => ({ c, vence: dir(c).next_call_at && String(dir(c).next_call_at).slice(0, 10) <= hoy ? 0 : 1, u: urg(c) }))
        .sort((p, q) => p.vence - q.vence || q.u - p.u || (W[q.c.stage] ?? 0) - (W[p.c.stage] ?? 0) || String(q.c.ultimo_mensaje_at || "").localeCompare(String(p.c.ultimo_mensaje_at || "")))
        .slice(0, Math.min(Number(a?.limite) || 15, 40));
      const MOT = ["", "pedido en curso", "sin pedido, todavía se puede vender", "dio sus datos y no pagó el adelanto: urge"];
      return { bot: b.nombre, clientes: lista.map(({ c, vence, u }) => { const d = dir(c), o = ult(c), ints = (d.intentos || []) as any[];
        return { nombre: c.nombre, telefono: c.wa_id, etapa: c.stage, producto: c.products?.nombre ?? null, por_que: vence === 0 ? "seguimiento para hoy o vencido" : (!o && c.bot_activo === false) ? "pidió hablar con una persona (bot en pausa): urge" : MOT[u] || "",
          ultimo_mensaje: horaLocal(c.ultimo_mensaje_at, b.timezone), pedido: o ? `${O.label(o.estado)} · ${dinero(Number(o.amount) || 0, b.moneda)}` : null,
          intentos: ints.length, ultimo_intento: ints.length ? (ints[ints.length - 1].resultado ?? ints[ints.length - 1].r ?? null) : null, proximo_contacto: d.next_call_at ?? null, bot_atiende: c.bot_activo !== false }; }) };
    } },

  { name: "accesos", description: "Micro apps (como Accesos): accesos mensuales que vencen esta semana, vencidos, ingreso mensual fijo, % que renovó; pago único vendidas, ingresos del mes, quién usa la app y quién nunca la abrió; y los que pagaron y aún no tienen acceso.",
    inputSchema: S({ bot: P_BOT }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot);
      const { data: prods } = await db.from("products").select("id, nombre, product_versions(precio, activo, config)").eq("channel_id", b.id).eq("tipo", "microapp");
      if (!(prods ?? []).length) return { bot: b.nombre, nota: "Este bot no vende micro apps." };
      if (!appsConfigurada()) return { bot: b.nombre, nota: "Nodo todavía no está conectado con la base de Apps." };
      const r: any = await appsApi("listar", { channel_id: b.id }, 20000);
      if (!r?.ok) throw new Fallo("No se pudieron traer los accesos: " + (r?.error ?? "error"));
      const precios: Record<string, { mes: number; unico: number; nombre: string }> = {};
      for (const p of (prods ?? []) as any[]) { const vs = (p.product_versions ?? []).filter((v: any) => v.activo !== false);
        precios[p.id] = { mes: Number(vs.find((v: any) => v.config?.modalidad === "mensual" && (Number(v.config?.meses) || 1) === 1)?.precio) || 0, unico: Number(vs.find((v: any) => v.config?.modalidad !== "mensual")?.precio) || 0, nombre: p.nombre }; }
      const ahora = Date.now(), DIA = 864e5, acc = (r.accesos ?? []) as any[];
      const men = acc.filter((x) => x.tipo === "mensual"), uni = acc.filter((x) => x.tipo === "unico");
      const viejos = men.filter((x) => ahora - Date.parse(x.creado_at) > 30 * DIA);
      const iniMes = new Date(); iniMes.setUTCDate(1); iniMes.setUTCHours(5, 0, 0, 0);
      const { data: pend } = await db.from("microapp_entregas").select("estado, created_at, contacts(nombre, wa_id), products(nombre)").eq("channel_id", b.id).in("estado", ["falta_correo", "falta_telefono", "error", "a_humano"]).order("created_at", { ascending: false }).limit(50);
      const din = (n: number) => dinero(n, b.moneda);
      return { bot: b.nombre,
        mensual: { vencen_esta_semana: men.filter((x) => x.estado === "activo" && x.vence_at && Date.parse(x.vence_at) - ahora < 7 * DIA).length, vencidos: men.filter((x) => x.estado === "vencido").length,
          ingreso_mensual_fijo: din(men.filter((x) => x.estado === "activo").reduce((s, x) => s + (precios[x.product_id]?.mes || 0), 0)),
          renovaron: viejos.length ? `${Math.round((viejos.filter((x) => x.estado === "activo").length / viejos.length) * 100)}%` : "— (aún no cumplen un mes)" },
        pago_unico: { vendidas: uni.length, ingresos_del_mes: din(uni.filter((x) => Date.parse(x.creado_at) >= iniMes.getTime()).reduce((s, x) => s + (precios[x.product_id]?.unico || 0), 0)) },
        usan_la_app_7_dias: acc.filter((x) => x.ultimo_uso_at && ahora - Date.parse(x.ultimo_uso_at) < 7 * DIA).length,
        nunca_abrieron_su_link: acc.filter((x) => !x.ultimo_uso_at && x.estado !== "bloqueado").length,
        pagaron_sin_acceso: ((pend ?? []) as any[]).map((p) => ({ cliente: p.contacts?.nombre ?? null, telefono: p.contacts?.wa_id ?? null, app: p.products?.nombre ?? null, falta: p.estado, desde: horaLocal(p.created_at, b.timezone) })),
        por_vencer: men.filter((x) => x.estado === "activo" && x.vence_at && Date.parse(x.vence_at) - ahora < 7 * DIA).slice(0, 20).map((x) => ({ cliente: x.nombre ?? x.correo, app: x.app, vence: horaLocal(x.vence_at, b.timezone) })) };
    } },

  { name: "campanas_y_secuencias", description: "Cómo van las campañas (enviados, fallidos, si se detuvo y por qué) y las secuencias de remarketing (activa o pausada, a quién le llega y cuántas personas la están recibiendo ahora).",
    inputSchema: S({ bot: P_BOT }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot);
      const [{ data: camps }, { data: seqs }, subs] = await Promise.all([
        db.from("campaigns").select("nombre, estado, total, enviados, fallidos, programada_at, motivo, created_at").eq("channel_id", b.id).order("created_at", { ascending: false }).limit(15),
        db.from("sequences").select("id, nombre, activo, segmento, modo, pasos").eq("channel_id", b.id).order("created_at"),
        paginar<any>((f, t) => db.from("sequence_subscriptions").select("sequence_id").eq("channel_id", b.id).eq("estado", "activa").range(f, t)).catch(() => [] as any[]),
      ]);
      const enCurso: Record<string, number> = {}; for (const s of subs) enCurso[s.sequence_id] = (enCurso[s.sequence_id] || 0) + 1;
      return { bot: b.nombre,
        campanas: ((camps ?? []) as any[]).map((c) => ({ nombre: c.nombre, estado: c.estado, enviados: `${c.enviados ?? 0} de ${c.total ?? 0}`, fallidos: c.fallidos ?? 0, sale: horaLocal(c.programada_at, b.timezone), ...(c.motivo ? { se_detuvo_por: c.motivo } : {}) })),
        secuencias: ((seqs ?? []) as any[]).map((s) => ({ nombre: s.nombre, activa: s.activo !== false, a_quien: s.segmento ?? null, modo: s.modo ?? null, pasos: Array.isArray(s.pasos) ? s.pasos.length : 0, recibiendola_ahora: enCurso[s.id] || 0 })) };
    } },

  { name: "horarios", description: "En qué horas y días se vende más (como «Horarios de venta» de Inicio): ventas, ingresos y chats nuevos por hora del día, las mejores horas, el mejor día de la semana y las horas con muchos chats pero pocas ventas.",
    inputSchema: S({ bot: P_BOT, periodo: P_PER, desde: P_D, hasta: P_D }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); const r = periodo(b.timezone, a?.periodo ?? "30dias", a?.desde, a?.hasta);
      const fl = await traer(b, r);
      const off = desfase(b.timezone);
      const hora = (iso: string) => new Date(Date.parse(iso) + off * 60_000).getUTCHours();
      const dow = (iso: string) => new Date(Date.parse(iso) + off * 60_000).getUTCDay();
      const H = Array.from({ length: 24 }, (_, h) => ({ h, ventas: 0, ingresos: 0, chats: 0 }));
      const D = Array.from({ length: 7 }, () => ({ ventas: 0, ingresos: 0 }));
      for (const o of fl.pedidos) if (O.esVenta(o) && !O.esPerdido(o)) { const t = O.total(o); H[hora(o.created_at)].ventas++; H[hora(o.created_at)].ingresos += t; D[dow(o.created_at)].ventas++; D[dow(o.created_at)].ingresos += t; }
      for (const k of fl.contactos) H[hora(k.primera_interaccion || k.created_at)].chats++;
      const DN = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];
      const din = (n: number) => dinero(n, b.moneda), lbl = (h: number) => `${h}:00–${h + 1}:00`;
      const mejores = [...H].filter((x) => x.ventas).sort((p, q) => q.ventas - p.ventas || q.ingresos - p.ingresos).slice(0, 3);
      const flojas = [...H].filter((x) => x.chats >= 3 && x.ventas / x.chats < 0.1).sort((p, q) => q.chats - p.chats).slice(0, 3);
      const md = D.map((x, i) => ({ ...x, i })).sort((p, q) => q.ventas - p.ventas)[0];
      return { bot: b.nombre, periodo: r.etiqueta, zona_horaria: b.timezone,
        mejores_horas: mejores.map((x) => ({ hora: lbl(x.h), ventas: x.ventas, ingresos: din(x.ingresos), compro: pct1(x.ventas, x.chats) })),
        mejor_dia: md && md.ventas ? `los ${DN[md.i]} · ${md.ventas} ventas · ${din(md.ingresos)}` : "—",
        llegan_chats_pero_venden_poco: flojas.map((x) => ({ hora: lbl(x.h), chats: x.chats, ventas: x.ventas })),
        por_hora: H.filter((x) => x.ventas || x.chats).map((x) => ({ hora: lbl(x.h), ventas: x.ventas, ingresos: din(x.ingresos), chats_nuevos: x.chats })) };
    } },
  // ─────── Mover pedidos (18-nov, Rodrigo: «mover pedidos de estado si dale») ───────
  // Las MISMAS reglas del ⋮ de Pedidos (panel/pedidos.html openMenu/confirmSet) y el MISMO camino que el panel, el Copiloto
  // de Telegram y courier-sync: order-update con la llave interna (avisos, flujos, stock, CAPI, hoja, candados). Como ese
  // camino interno no revisa de quién es el pedido, se revisa acá: solo pedidos de los bots de esta persona.
  // (18-nov, Rodrigo «sí, agrégalo») También APRUEBA pagos físicos: adelanto validado y saldo pagado (con la clave de recojo),
  // igual que los botones de Pagos por validar (contact-extras.js aprobar). El candado anti-reúso, el crédito al saldo, el
  // stock y la clave los hace order-update. A propósito NO: anular una venta ya cobrada (pide el motivo en el panel) ni
  // pedidos digitales (Pagos por validar y Compras).
  { name: "mover_pedido", escribe: true, description: "Mueve un pedido FÍSICO (Lima o provincia) a otro estado, como el menú ⋮ de Pedidos. Lima: confirmado, en_reparto, entregado_cobrado, reprogramado, rechazado. Provincia: esperando_adelanto, adelanto_validado (APRUEBA el adelanto), despachado (con guía), en_agencia, saldo_pagado (APRUEBA el saldo y le manda la clave de recojo: pide clave_recojo si el pedido no la tiene), recogido (solo después de saldo pagado), no_recogido. Cualquiera: cancelado. Aprobar un pago es solo si la persona VIO que la plata llegó: la vista previa muestra lo que leyó el comprobante. Al cliente le llega el aviso de ese estado salvo avisar:false. Pide confirmación. No anula ventas ya cobradas ni toca pedidos digitales: eso se hace en el panel.",
    inputSchema: S({ bot: P_BOT, pedido: { type: "string", description: "id del pedido (sale en la herramienta pedidos) o nombre/teléfono del cliente (se toma su último pedido físico)." },
      estado: { type: "string", enum: ["confirmado", "en_reparto", "entregado_cobrado", "reprogramado", "rechazado", "esperando_adelanto", "adelanto_validado", "despachado", "en_agencia", "saldo_pagado", "recogido", "no_recogido", "cancelado"] },
      avisar: { type: "boolean", description: "false = moverlo sin avisarle al cliente. Por defecto se le avisa (como el panel)." },
      guia: { type: "string", description: "Número de guía de la agencia (al despachar)." },
      clave_recojo: { type: "string", description: "Al pasar a saldo_pagado: la clave que va a pedir la agencia (el bot se la manda al cliente). Nunca la inventes: pregúntala." },
      flete: { type: "number", description: "Lima, al cerrar (entregado y cobrado / rechazado): lo que le pagaste al motorizado. Si no lo mandas, se usa el costo de su zona." },
      confirmar: P_CONF }, ["pedido", "estado"]),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot);
      const estado = String(a?.estado ?? "");
      const LIMA = ["confirmado", "en_reparto", "entregado_cobrado", "reprogramado", "rechazado"];
      const PROV = ["esperando_adelanto", "adelanto_validado", "despachado", "en_agencia", "saldo_pagado", "recogido", "no_recogido"];
      if (estado === "por_despachar") throw new Fallo("Usa adelanto_validado (es el mismo paso).");
      if (estado === "confirmada") throw new Fallo("Los pagos digitales se aprueban en el panel (Pagos por validar), no desde aquí.");
      if (![...LIMA, ...PROV, "cancelado"].includes(estado)) throw new Fallo(`«${estado}» no es un estado que se pueda poner desde aquí. Lima: ${LIMA.join(", ")}. Provincia: ${PROV.join(", ")}. O cancelado.`);
      // El pedido: por id, o el último pedido físico del cliente.
      const COLS = "id, estado, amount, order_bumps, shipping, created_at, contact_id, contacts(nombre, wa_id, ultimo_mensaje_cliente_at), product:product_id(nombre, tipo), product_versions(nombre)";
      const ref = String(a?.pedido ?? "").trim();
      let o: any = null;
      if (/^[0-9a-f-]{36}$/i.test(ref)) {
        const { data } = await db.from("orders").select(COLS).eq("id", ref).eq("channel_id", b.id).maybeSingle();
        o = data;
      }
      if (!o) {
        const k = await contactoDe(b.id, ref);
        const { data } = await db.from("orders").select(COLS).eq("channel_id", b.id).eq("contact_id", k.id).order("created_at", { ascending: false }).limit(10);
        o = ((data ?? []) as any[]).find((x) => O.esFisico(x)) ?? null;
        if (!o) throw new Fallo(`${k.nombre ?? "Ese cliente"} no tiene pedidos físicos en «${b.nombre}».`);
      }
      const z = O.zonaDe(o), sh = o.shipping ?? {}, origen = String(o.estado ?? ""), cliente = o.contacts?.nombre ?? sh.cliente ?? "el cliente";
      if (z === "digital") throw new Fallo("Es un pedido digital: esos se aprueban o anulan en Pagos por validar y Compras del panel.");
      if (origen === estado) throw new Fallo(`El pedido de ${cliente} ya está «${O.label(estado)}».`);
      if (LIMA.includes(estado) && z !== "lima") throw new Fallo(`«${O.label(estado)}» es de pedidos de Lima y el de ${cliente} es de provincia.`);
      if (PROV.includes(estado) && z !== "provincia") throw new Fallo(`«${O.label(estado)}» es de pedidos de provincia y el de ${cliente} es de Lima.`);
      // Saltos que se saltan pasos de plata o de entrega (los mismos que el panel no ofrece).
      const PRE: Record<string, string[]> = { saldo_pagado: ["despachado", "en_agencia"], recogido: ["saldo_pagado"], entregado_cobrado: ["en_reparto", "confirmado"], no_recogido: ["despachado", "en_agencia", "saldo_pagado"] };
      if (PRE[estado] && !PRE[estado].includes(origen))
        throw new Fallo(`Un pedido «${O.label(origen)}» no puede pasar directo a «${O.label(estado)}»: antes tiene que estar ${PRE[estado].map((e) => `«${O.label(e)}»`).join(" o ")}.` +
          (estado === "recogido" ? " Primero apruébale el saldo (saldo_pagado, con la clave de recojo)." : ""));
      if (estado === "cancelado" && O.EST[origen]?.cobro === "todo")
        throw new Fallo(`El pedido de ${cliente} ya está cobrado («${O.label(origen)}»): eso no se cancela, se ANULA la venta en el panel (Pedidos → ⋮ → Anular venta), que pide el motivo.`);
      const CERRADOS = ["recogido", "entregado_cobrado"], SALIDAS = ["anulada", "cancelado", "devuelto", "rechazado", "no_recogido", ...CERRADOS];
      const reabre = CERRADOS.includes(origen) && !SALIDAS.includes(estado);
      // Datos que se guardan con el cambio.
      const ship: Record<string, unknown> = {};
      if (a?.guia && String(a.guia).trim()) ship.guia = String(a.guia).trim();
      // Saldo pagado sin clave: el aviso no sale y el cliente queda pagado y sin poder recoger (igual que el panel, se exige).
      const claveYa = String(sh.clave_recojo ?? "").trim();
      if (estado === "saldo_pagado") {
        const cl = String(a?.clave_recojo ?? "").trim();
        if (cl) ship.clave_recojo = cl;
        else if (!claveYa) throw new Fallo(`El pedido de ${cliente} no tiene clave de recojo. Pregúntale a la persona cuál es (la que va a pedir la agencia) y vuelve a llamar con clave_recojo: sin ella el cliente paga y no puede recoger.`);
      }
      let flete: number | null = null;
      if (z === "lima" && (estado === "entregado_cobrado" || estado === "rechazado") && sh.flete == null) {
        if (typeof a?.flete === "number" && a.flete >= 0) flete = a.flete;
        else { const { data: ch } = await db.from("channels").select("entregas").eq("id", b.id).maybeSingle(); flete = O.costoZonaLima((ch as any)?.entregas, sh.zona_nombre || sh.distrito); }
        if (flete != null) ship.flete = flete;
      }
      const avisar = a?.avisar !== false;
      const URL_OU = `${Deno.env.get("SUPABASE_URL")}/functions/v1/order-update`;
      const llamar = (body: Record<string, unknown>) => fetch(URL_OU, { method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}` },
        body: JSON.stringify({ order_id: o.id, ...body }) }).then(async (x) => { try { return await x.json(); } catch { return { error: `HTTP ${x.status}` }; } }).catch((e) => ({ error: String(e) }));
      const ult = o.contacts?.ultimo_mensaje_cliente_at, enVentana = !!ult && Date.now() - Date.parse(ult) < 24 * 3600_000;
      if (a?.confirmar !== true) {
        let msj = "";
        if (avisar) { const p: any = await llamar({ estado, preview: true }); msj = String(p?.preview ?? "").trim(); }
        const lineas = [
          `Pedido de ${cliente} (${[o.product?.nombre, o.product_versions?.nombre].filter(Boolean).join(" · ") || "pedido"}, ${dinero(O.total(o), b.moneda)}, ${z === "lima" ? "Lima" : "provincia"}): de «${O.label(origen)}» a «${O.label(estado)}» (bot «${b.nombre}»).`,
          ...(ship.guia ? [`Guía: ${ship.guia}.`] : []),
          ...(estado === "adelanto_validado" || estado === "saldo_pagado" ? (() => {
            const ad = estado === "adelanto_validado", px = ad ? "adelanto" : "saldo";
            const esperado = Number(ad ? sh.adelanto : sh.saldo) || 0;
            const leido = Number(sh[`${px}_abonado`] ?? sh[`${px}_monto_leido`]);
            const op = String(sh[`${px}_operacion`] || sh[`${px}_operacion_leida`] || "").trim();
            const comp = !!(sh[`${px}_comprobante`] || sh[`${px}_recibido_at`]);
            const l = [`💰 Esto APRUEBA el ${px}${esperado ? ` de ${dinero(esperado, b.moneda)}` : ""}: confírmalo solo si viste que la plata llegó a tu cuenta.`,
              comp ? `Comprobante: ${Number.isFinite(leido) && leido > 0 ? `leído ${dinero(leido, b.moneda)}` : "monto no leído"}${op ? `, operación N° ${op}` : ", sin número de operación"}.` : "El cliente no mandó comprobante por el chat.",
              ...(!op ? ["Sin número de operación, el candado contra pagos repetidos no lo puede revisar (queda anotado en la Actividad del cliente)."] : [])];
            if (ad) {
              // La MISMA cuenta que order-update (saldoTrasAdelanto + freno de sobrepago + no re-acreditar el mismo pago).
              const sAct = Number(sh.saldo) || 0, debe = esperado + sAct;
              let pag = Number.isFinite(leido) && leido > 0 ? leido : esperado;
              if (debe > 0 && pag > debe + 50) pag = esperado;
              const resto = Number(sh.pago_acreditado_adelanto) === pag ? sAct : Math.max(0, Math.round((debe - pag) * 100) / 100);
              l.push(resto > 0.009 ? `Saldo que quedará por cobrar en la agencia: ${dinero(resto, b.moneda)}.` : "Con esto queda pagado completo: no debe saldo en la agencia.");
            }
            else l.push(`Clave de recojo que se le manda: ${ship.clave_recojo ?? claveYa}.`);
            return l; })() : []),
          ...(z === "lima" && (estado === "entregado_cobrado" || estado === "rechazado") && sh.flete == null
            ? [flete != null ? `Costo del motorizado: ${dinero(flete, b.moneda)}${typeof a?.flete === "number" ? "" : " (el de su zona; dime otro si fue distinto)"}.` : "Costo del motorizado: no está registrado (dímelo si quieres que cuente en tu ganancia)."] : []),
          ...((estado === "despachado" || estado === "en_agencia") && sh.sede_por_confirmar ? [`⚠️ La agencia «${sh.sede ?? "—"}» la anotó el bot tal como la dijo el cliente y está POR CONFIRMAR: si no existe, al cliente le llega ese nombre igual. Mejor confírmala primero en Pedidos.`] : []),
          ...(reabre ? ["⚠️ Es una venta ya cerrada: si la mueves, deja de contar como venta en Inicio y al cliente le puede llegar el aviso de ese estado."] : []),
          !avisar ? "Al cliente NO se le avisa." :
            !enVentana ? "Al cliente no se le puede avisar por WhatsApp: no escribe hace más de 24 h (haría falta una plantilla, desde el panel). El pedido se mueve igual." :
            msj ? `Al cliente le llega:\n«${msj}»` : "Al cliente le llega el aviso o el flujo que tengas para ese estado (si no tienes ninguno, no se le manda nada).",
        ];
        return confirmacion(a, lineas.join("\n"));
      }
      const r: any = await llamar({ estado, ...(Object.keys(ship).length ? { shipping: ship } : {}), aviso: { modo: avisar ? "mensaje" : "ninguno" }, ...(reabre ? { forzar: true } : {}) });
      if (r?.error) throw new Fallo(`No se pudo mover: ${r.detalle ?? r.error}`);
      if (r?.deduped) return { ok: true, hecho: "Ese pedido ya lo movió alguien más justo ahora: no se cambió nada." };
      return { ok: true, hecho: `Listo: el pedido de ${cliente} quedó «${O.label(estado)}».`,
        aviso_al_cliente: !avisar ? "no se le avisó (así lo pediste)" : r.aviso_error ? `NO salió: ${r.aviso_error}` : r.flow_started ? "el bot le está escribiendo (flujo de ese estado)" : r.aviso_enviado ? "se le avisó" : "no había aviso para ese estado",
        ...(Array.isArray(r.stock_alerts) && r.stock_alerts.length ? { stock: r.stock_alerts } : {}) };
    } },

  // ══════════ 🧩 CONFIGURAR UN PRODUCTO (28-nov-2026, Rodrigo: «dale con todo menos Poner a vender») ══════════
  // Cada herramienta escribe donde escribe el panel (Productos) y en lo que el motor lee EN VIVO: no hace falta
  // regenerar el flujo. «Poner a vender» (armar el flujo de venta) sigue siendo del panel.

  { name: "ficha_producto", escribe: true, description: "Escribe la ficha que usa la IA para vender un producto: qué es y qué incluye, lo que NO incluye o no se promete, y las preguntas frecuentes con su respuesta (también objeciones). Se compila igual que en el panel. Pide confirmación.",
    inputSchema: S({ bot: P_BOT, producto: P_PROD,
      que_es: { type: "string", description: "Qué es, qué incluye y para quién (cuadro 1 de la ficha). Reemplaza el texto actual." },
      no_incluye: { type: "string", description: "Lo que NO incluye, no hace o no se promete (cuadro 2). Reemplaza el texto actual." },
      preguntas: { type: "array", items: S({ pregunta: { type: "string" }, respuesta: { type: "string" } }, ["pregunta", "respuesta"]), description: "Preguntas frecuentes u objeciones con su respuesta (cuadro 3)." },
      preguntas_modo: { type: "string", enum: ["agregar", "reemplazar"], description: "agregar (por defecto): suma a las que ya hay. reemplazar: deja solo estas." },
      confirmar: P_CONF }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); exigirAdmin(b);
      const p = await productoDe(b, a?.producto);
      const qs = ((a?.preguntas ?? []) as any[]).filter((x) => String(x?.pregunta ?? "").trim() && String(x?.respuesta ?? "").trim());
      if (!String(a?.que_es ?? "").trim() && !String(a?.no_incluye ?? "").trim() && !qs.length) throw new Fallo("No mandaste nada para la ficha (qué es, qué no incluye o preguntas).");
      const reempl = a?.preguntas_modo === "reemplazar";
      const pre = confirmacion(a, `Ficha de «${p.nombre}» (${b.nombre}):` +
        (a?.que_es ? `\n• Qué es: ${corto(a.que_es, 300)}` : "") + (a?.no_incluye ? `\n• No incluye: ${corto(a.no_incluye, 200)}` : "") +
        (qs.length ? `\n• ${reempl ? "Reemplazar las preguntas por" : "Agregar"} ${qs.length} pregunta(s):\n` + qs.map((x) => `   – ${corto(x.pregunta, 80)} → ${corto(x.respuesta, 80)}`).join("\n") : "")); if (pre) return pre;
      const c = await patchProducto(p.id, (c, tipo) => {
        c.ia = c.ia || {};
        if (!c.ia.detalle && c.contexto_producto && !c.ia._migrado) { c.ia.detalle = c.contexto_producto; c.ia._migrado = true; }
        if (String(a?.que_es ?? "").trim()) c.ia.detalle = String(a.que_es).trim();
        if (String(a?.no_incluye ?? "").trim()) c.ia.limites = String(a.no_incluye).trim();
        if (qs.length) {
          let items = reempl ? [] : (Array.isArray(c.faq_items) ? c.faq_items : parseFaq(c.faq));
          const ya = new Set(items.map((x: any) => norm(x.q)));
          for (const x of qs) { const k = norm(x.pregunta); if (ya.has(k)) items = items.map((i: any) => norm(i.q) === k ? { q: String(x.pregunta).trim(), a: String(x.respuesta).trim() } : i); else { items.push({ q: String(x.pregunta).trim(), a: String(x.respuesta).trim() }); ya.add(k); } }
          c.faq_items = items;
        }
        recompilarFicha(c, tipo);
      });
      return { ok: true, hecho: `Ficha de «${p.nombre}» guardada: la IA ya la usa desde el próximo mensaje.`, preguntas: (c.faq_items ?? []).length };
    } },

  { name: "entrega_digital", escribe: true, description: "Configura qué recibe el cliente al pagar un producto DIGITAL: links (Drive, curso, grupo…) y el mensaje de bienvenida. Por defecto en todas sus presentaciones. Nunca inventes links. Pide confirmación.",
    inputSchema: S({ bot: P_BOT, producto: P_PROD, presentacion: { type: "string", description: "Solo para esta presentación (por defecto, todas)." },
      links: { type: "array", items: S({ nombre: { type: "string", description: "Ej. «Acceso al curso»" }, url: { type: "string" }, mensaje: { type: "string", description: "Texto que va antes del link (opcional)." } }, ["url"]) },
      mensaje_bienvenida: { type: "string", description: "El primer mensaje de la entrega, ej. «¡Bienvenido! 🎉 Aquí tienes tu acceso»." },
      modo: { type: "string", enum: ["agregar", "reemplazar"], description: "agregar (por defecto): suma los links. reemplazar: quita los links que había (los archivos subidos se quedan)." },
      confirmar: P_CONF }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); exigirAdmin(b);
      const p = await productoDe(b, a?.producto);
      if (p.tipo !== "digital") throw new Fallo(`«${p.nombre}» es un producto ${p.tipo}: la entrega por link es para los digitales.`);
      const links = ((a?.links ?? []) as any[]).map((l) => ({ ...l, url: String(l?.url ?? "").trim() })).filter((l) => l.url);
      const malos = links.filter((l) => !/^https?:\/\/\S+$/i.test(l.url));
      if (malos.length) throw new Fallo(`Estos links no son válidos (deben empezar con https://): ${malos.map((l) => l.url).join(", ")}`);
      if (!links.length && !String(a?.mensaje_bienvenida ?? "").trim()) throw new Fallo("Mándame al menos un link o el mensaje de bienvenida.");
      let vs = ((p.product_versions ?? []) as any[]);
      if (String(a?.presentacion ?? "").trim()) { vs = vs.filter((v) => norm(v.nombre).includes(norm(a.presentacion))); if (vs.length !== 1) throw new Fallo(vs.length ? `Hay varias presentaciones con «${a.presentacion}»: ${vs.map((v) => v.nombre).join(", ")}.` : `No encontré la presentación «${a.presentacion}». Tiene: ${(p.product_versions ?? []).map((v: any) => v.nombre).join(", ")}.`); }
      if (!vs.length) throw new Fallo(`«${p.nombre}» no tiene presentaciones.`);
      const reempl = a?.modo === "reemplazar";
      const pre = confirmacion(a, `Entrega de «${p.nombre}» → ${vs.length === 1 ? `presentación «${vs[0].nombre}»` : `sus ${vs.length} presentaciones`}:` +
        (a?.mensaje_bienvenida ? `\n• Mensaje: ${corto(a.mensaje_bienvenida, 200)}` : "") +
        (links.length ? `\n• ${reempl ? "Reemplazar los links por" : "Agregar"}:\n` + links.map((l) => `   – ${l.nombre || "Acceso"}: ${l.url}`).join("\n") : "")); if (pre) return pre;
      for (const v of vs) {
        let ent = Array.isArray(v.entrega) ? [...v.entrega] : [];
        if (reempl && links.length) ent = ent.filter((e: any) => e?.tipo !== "link");
        for (const l of links) if (!ent.some((e: any) => e?.tipo === "link" && e.url === l.url)) ent.push({ tipo: "link", url: l.url, nombre: String(l.nombre ?? "").trim() || "Acceso", ...(String(l.mensaje ?? "").trim() ? { mensaje: String(l.mensaje).trim() } : {}) });
        const upd: any = { entrega: ent };
        if (String(a?.mensaje_bienvenida ?? "").trim()) upd.entrega_mensaje = String(a.mensaje_bienvenida).trim();
        const { error } = await db.from("product_versions").update(upd).eq("id", v.id);
        if (error) throw new Fallo(error.message);
      }
      return { ok: true, hecho: `Entrega de «${p.nombre}» lista en ${vs.length} presentación(es). Se manda sola cuando se aprueba el pago.` };
    } },

  { name: "banco_anuncios", escribe: true, description: "Vincula o desvincula anuncios de Meta a un producto (Banco de anuncios): quien toque ese anuncio cae en este producto y Rendimiento lo cuenta para él. Acepta el nombre o el ID del anuncio. Pide confirmación.",
    inputSchema: S({ bot: P_BOT, producto: P_PROD,
      agregar: { type: "array", items: { type: "string" }, description: "Nombres o IDs de anuncios a vincular." },
      quitar: { type: "array", items: { type: "string" }, description: "Nombres o IDs de anuncios a desvincular." },
      confirmar: P_CONF }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); exigirAdmin(b);
      const p = await productoDe(b, a?.producto);
      const { data: am } = await db.from("ads_meta").select("ad_id, ad_name, campaign_name, estado").eq("channel_id", b.id);
      const ads = (am ?? []) as any[];
      const resolver = (ref: string) => {
        const r = String(ref ?? "").trim(); if (!r) return null;
        const porId = ads.find((x) => String(x.ad_id) === r.replace(/\D/g, "") && r.replace(/\D/g, "").length >= 10);
        if (porId) return porId;
        if (/^\d{10,}$/.test(r)) return { ad_id: r, ad_name: null };   // un ID que Nodo todavía no conoce
        const exact = ads.filter((x) => norm(x.ad_name) === norm(r)); if (exact.length === 1) return exact[0];
        const par = ads.filter((x) => norm(x.ad_name).includes(norm(r)));
        if (par.length === 1) return par[0];
        throw new Fallo(par.length ? `Hay varios anuncios con «${r}»: ${par.slice(0, 8).map((x) => x.ad_name).join(", ")}. Dime cuál (o su ID).` : `No encontré el anuncio «${r}». Si es nuevo, espera a la próxima actualización (cada hora) o pásame su ID.`);
      };
      const add = ((a?.agregar ?? []) as string[]).map(resolver).filter(Boolean) as any[];
      const del = ((a?.quitar ?? []) as string[]).map(resolver).filter(Boolean) as any[];
      if (!add.length && !del.length) throw new Fallo("Dime qué anuncios agregar o quitar.");
      // Un anuncio vive en UN producto: si ya está en otro, se avisa (no se mueve sin que la persona lo diga).
      const { data: otros } = await db.from("products").select("id, nombre, config").eq("channel_id", b.id).neq("id", p.id);
      const enOtro = add.map((x) => ({ x, o: ((otros ?? []) as any[]).find((q) => Array.isArray(q.config?.ad_bank) && q.config.ad_bank.map(String).includes(String(x.ad_id))) })).filter((y) => y.o);
      if (enOtro.length) throw new Fallo("Estos anuncios ya están en otro producto: " + enOtro.map((y) => `«${y.x.ad_name ?? y.x.ad_id}» → «${y.o.nombre}»`).join(", ") + ". Quítalos de allá primero.");
      const nom = (x: any) => x.ad_name ? `«${x.ad_name}»` : `ID ${x.ad_id}`;
      const pre = confirmacion(a, `Banco de anuncios de «${p.nombre}» (${b.nombre}):` + (add.length ? `\n• Vincular: ${add.map(nom).join(", ")}` : "") + (del.length ? `\n• Desvincular: ${del.map(nom).join(", ")}` : "")); if (pre) return pre;
      const quitar = new Set(del.map((x) => String(x.ad_id)));
      const c = await patchProducto(p.id, (c) => {
        const banco = new Set<string>(Array.isArray(c.ad_bank) ? c.ad_bank.map(String) : []);
        for (const x of add) banco.add(String(x.ad_id));
        for (const id of quitar) banco.delete(id);
        c.ad_bank = [...banco];
      });
      if (quitar.size) {   // también fuera de los ángulos del producto (el panel los mantiene a la par)
        const { data: angs } = await db.from("angulos").select("id, ad_ids").eq("product_id", p.id);
        for (const g of (angs ?? []) as any[]) {
          const ids = (g.ad_ids ?? []).map(String); const nuevos = ids.filter((i: string) => !quitar.has(i));
          if (nuevos.length !== ids.length) await db.from("angulos").update({ ad_ids: nuevos }).eq("id", g.id);
        }
      }
      return { ok: true, hecho: `Banco de anuncios de «${p.nombre}»: ${(c.ad_bank ?? []).length} anuncio(s).`,
        anuncios: (c.ad_bank ?? []).map((id: string) => ads.find((x) => String(x.ad_id) === id)?.ad_name ?? id) };
    } },

  { name: "palabra_clave", escribe: true, description: "Pone las palabras clave de un producto: el mensaje que trae el anuncio (o que escribe el cliente) y que abre la venta de ESE producto con su saludo. Pide confirmación.",
    inputSchema: S({ bot: P_BOT, producto: P_PROD,
      palabras: { type: "array", items: { type: "string" }, description: "Ej. [«quiero más información del protocolo», «calistenia»]" },
      coincidencia: { type: "string", enum: ["contiene", "empieza", "exacta"], description: "contiene (por defecto): el mensaje la incluye en cualquier parte." },
      modo: { type: "string", enum: ["agregar", "reemplazar"], description: "agregar (por defecto) o reemplazar las que hay." },
      confirmar: P_CONF }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); exigirAdmin(b);
      const p = await productoDe(b, a?.producto);
      const pals = [...new Set(((a?.palabras ?? []) as string[]).map((x) => String(x ?? "").trim()).filter(Boolean))];
      if (!pals.length) throw new Fallo("Dime las palabras clave.");
      // Que no choquen con las de OTRO producto del bot (si no, el cliente cae en el producto equivocado).
      const { data: trigs } = await db.from("flow_triggers").select("id, flow_id, config, flows!inner(product_id, estado, products(nombre))").eq("channel_id", b.id).eq("tipo", "keyword");
      const choques: string[] = [];
      for (const t of (trigs ?? []) as any[]) {
        if (t.flows?.product_id === p.id) continue;
        for (const k of (t.config?.keywords ?? []) as string[]) if (pals.some((x) => norm(x) === norm(k))) choques.push(`«${k}» (ya es de «${t.flows?.products?.nombre ?? "otro flujo"}»)`);
      }
      if (choques.length) throw new Fallo("Estas palabras ya las usa otro producto: " + choques.join(", ") + ".");
      const match = ["empieza", "exacta"].includes(a?.coincidencia) ? a.coincidencia : "contiene";
      const pre = confirmacion(a, `Palabras clave de «${p.nombre}» (${b.nombre}) — ${a?.modo === "reemplazar" ? "reemplazar por" : "agregar"} (${match}): ${pals.map((x) => `«${x}»`).join(", ")}`); if (pre) return pre;
      const fi = await flujoInicial(b, p);
      const { data: ya } = await db.from("flow_triggers").select("id, config").eq("flow_id", fi.flowId).eq("tipo", "keyword").maybeSingle();
      const antes: string[] = (ya as any)?.config?.keywords ?? [];
      const lista = a?.modo === "reemplazar" ? pals : [...new Set([...antes, ...pals.filter((x) => !antes.some((y) => norm(y) === norm(x)))])];
      const cfgT = { keywords: lista, match };
      const { error } = ya ? await db.from("flow_triggers").update({ config: cfgT, activo: true }).eq("id", (ya as any).id)
        : await db.from("flow_triggers").insert({ channel_id: b.id, flow_id: fi.flowId, tipo: "keyword", config: cfgT, activo: true });
      if (error) throw new Fallo(error.message);
      return { ok: true, hecho: `Palabras clave de «${p.nombre}»: ${lista.map((x) => `«${x}»`).join(", ")}.` + (fi.creado ? " (Se crearon sus mensajes iniciales vacíos: ponle un saludo con «saludo_producto».)" : "") };
    } },

  { name: "saludo_producto", escribe: true, description: "Escribe los mensajes iniciales (el saludo) de un producto: lo primero que recibe quien llega por su palabra clave o anuncio. Una o varias versiones A/B; cada una con burbujas de texto y/o imágenes (por enlace público, jpg o png). Pide confirmación.",
    inputSchema: S({ bot: P_BOT, producto: P_PROD,
      versiones: { type: "array", items: S({ nombre: { type: "string" }, burbujas: { type: "array", items: S({ texto: { type: "string" }, imagen_url: { type: "string", description: "Enlace público directo a una imagen jpg/png (no la página de Drive)." } }) } }, ["burbujas"]), description: "Máximo 4 versiones; Nodo las reparte entre los clientes (A/B)." },
      modo: { type: "string", enum: ["reemplazar", "agregar"], description: "reemplazar (por defecto): deja solo estas versiones. agregar: las suma a las que hay." },
      confirmar: P_CONF }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); exigirAdmin(b);
      const p = await productoDe(b, a?.producto);
      const vers = ((a?.versiones ?? []) as any[]).map((v) => ({ nombre: String(v?.nombre ?? "").trim(), burbujas: ((v?.burbujas ?? []) as any[]).filter((x) => String(x?.texto ?? "").trim() || String(x?.imagen_url ?? "").trim()) })).filter((v) => v.burbujas.length);
      if (!vers.length) throw new Fallo("Mándame al menos una versión con burbujas.");
      if (vers.length > 4) throw new Fallo("Máximo 4 versiones.");
      const pre = confirmacion(a, `Saludo de «${p.nombre}» (${b.nombre}) — ${a?.modo === "agregar" ? "agregar" : "reemplazar por"} ${vers.length} versión(es):\n` +
        vers.map((v, i) => `• ${v.nombre || "Versión " + String.fromCharCode(65 + i)}:\n` + v.burbujas.map((x) => `   – ${x.imagen_url ? `🖼️ ${x.imagen_url}${x.texto ? ` · «${corto(x.texto, 80)}»` : ""}` : `«${corto(x.texto, 120)}»`}`).join("\n")).join("\n")); if (pre) return pre;
      const variantes: any[] = [];
      for (const [i, v] of vers.entries()) {
        const bubbles: any[] = [];
        for (const x of v.burbujas) {
          if (String(x.imagen_url ?? "").trim()) { const im = await subirImagen(b, x.imagen_url); bubbles.push({ media_kind: "image", media_url: im.url, mime: im.mime, filename: im.filename, ...(String(x.texto ?? "").trim() ? { caption: String(x.texto).trim() } : {}) }); }
          else bubbles.push({ text: String(x.texto).trim() });
        }
        variantes.push({ id: crypto.randomUUID(), rev: 1, nombre: v.nombre, activo: true, peso: 1, angulo: "", bubbles });
      }
      const fi = await flujoInicial(b, p);
      const { data: nodo } = await db.from("flow_nodes").select("id, config").eq("id", fi.nodoId).maybeSingle();
      const cfg = { ...(((nodo as any)?.config ?? {}) as any) };
      const previas = a?.modo === "agregar" ? (Array.isArray(cfg.variantes) ? cfg.variantes : []).filter((x: any) => (x?.bubbles ?? []).some((bb: any) => String(bb?.text ?? "").trim() || bb?.media_url)) : [];
      const todas = [...previas, ...variantes].slice(0, 6);
      todas.forEach((x, i) => { if (!x.nombre) x.nombre = "Versión " + String.fromCharCode(65 + i); });
      cfg.variantes = todas; if (cfg.activo === undefined) cfg.activo = true;
      const { error } = await db.from("flow_nodes").update({ config: cfg }).eq("id", fi.nodoId);
      if (error) throw new Fallo(error.message);
      return { ok: true, hecho: `Saludo de «${p.nombre}» guardado con ${todas.length} versión(es). Sale desde el próximo cliente que llegue por su palabra clave o anuncio.` };
    } },

  { name: "remarketing_producto", escribe: true, description: "Arma la secuencia de remarketing de un producto: los mensajes que le llegan solos a quien escribió y no compró, con la espera entre uno y otro. Reemplaza los pasos de ese segmento. Pide confirmación.",
    inputSchema: S({ bot: P_BOT, producto: P_PROD,
      segmento: { type: "string", enum: ["general", "solo_inicio", "interactuo", "caliente", "provincia_sin_adelanto"], description: "general (por defecto): a todos. solo_inicio: solo saludó. interactuo: conversó. caliente: casi compra. provincia_sin_adelanto: físico a provincia que no pagó el adelanto." },
      pasos: { type: "array", items: S({ espera_horas: { type: "number", description: "Horas después del mensaje anterior (el primero: después del último mensaje del cliente)." }, mensaje: { type: "string" }, imagen_url: { type: "string", description: "Imagen jpg/png por enlace público (opcional)." } }, ["espera_horas", "mensaje"]), description: "Máximo 8 pasos." },
      confirmar: P_CONF }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); exigirAdmin(b);
      const p = await productoDe(b, a?.producto);
      const seg = ["solo_inicio", "interactuo", "caliente", "provincia_sin_adelanto"].includes(a?.segmento) ? a.segmento : "general";
      const pasos = ((a?.pasos ?? []) as any[]).filter((x) => String(x?.mensaje ?? "").trim());
      if (!pasos.length) throw new Fallo("Mándame al menos un paso con su mensaje.");
      if (pasos.length > 8) throw new Fallo("Máximo 8 pasos.");
      const malas = pasos.filter((x) => !(Number(x.espera_horas) >= 1 && Number(x.espera_horas) <= 720));
      if (malas.length) throw new Fallo("Cada espera tiene que ir entre 1 hora y 30 días (720 horas).");
      const c0 = (p.config ?? {}) as any;
      const actualId = (c0.remarketing_seqs ?? {})[seg] ?? (seg === "general" ? c0.remarketing_seq_id : null);
      const { data: actual } = actualId ? await db.from("sequences").select("id, nombre, pasos").eq("id", actualId).eq("channel_id", b.id).maybeSingle() : { data: null };
      const nPrev = Array.isArray((actual as any)?.pasos) ? (actual as any).pasos.length : 0;
      const pre = confirmacion(a, `Remarketing de «${p.nombre}» (${b.nombre}) · segmento ${seg}${nPrev ? ` — REEMPLAZA sus ${nPrev} paso(s) actuales` : ""}:\n` +
        pasos.map((x, i) => `${i + 1}. a las ${Number(x.espera_horas)} h: «${corto(x.mensaje, 140)}»${x.imagen_url ? " 🖼️" : ""}`).join("\n") +
        "\n(El anti-spam del bot manda: si un paso queda más seguido que su límite —18 h por defecto—, sale cuando se cumpla.)"); if (pre) return pre;
      const pasosOk: any[] = [];
      for (const x of pasos) {
        const bubbles: any[] = [];
        if (String(x.imagen_url ?? "").trim()) { const im = await subirImagen(b, x.imagen_url); bubbles.push({ media_kind: "image", media_url: im.url, mime: im.mime, filename: im.filename }); }
        bubbles.push({ text: String(x.mensaje).trim() });
        pasosOk.push({ umbral_silencio_seg: Math.round(Number(x.espera_horas) * 3600), rotacion: false,
          variantes: [{ id: crypto.randomUUID(), rev: 1, nombre: "Versión A", activo: true, peso: 1, angulo: "", bubbles }] });
      }
      let seqId = (actual as any)?.id as string | undefined;
      if (seqId) { const { error } = await db.from("sequences").update({ pasos: pasosOk }).eq("id", seqId); if (error) throw new Fallo(error.message); }
      else {
        const folder = ((p.emoji ? p.emoji + " " : "") + p.nombre).slice(0, 60);
        const { data: s, error } = await db.from("sequences").insert({ channel_id: b.id, nombre: `Remarketing · ${p.nombre}${seg === "general" ? "" : " · " + seg}`, activo: true, pasos: pasosOk, folder, segmento: seg }).select("id").single();
        if (error) throw new Fallo(error.message); seqId = (s as any).id;
        await patchProducto(p.id, (c) => { c.remarketing_seqs = { ...(c.remarketing_seqs ?? {}), [seg]: seqId }; if (seg === "general") c.remarketing_seq_id = seqId; });
      }
      return { ok: true, hecho: `Remarketing de «${p.nombre}» (${seg}) con ${pasosOk.length} paso(s). Les llega a los nuevos que entren a ese segmento.` };
    } },

  { name: "imagen_producto", escribe: true, description: "Agrega (o quita) una imagen que la IA puede mandar cuando la conversación lo pida (foto del producto, testimonio, tabla de precios…). Va por enlace público directo (jpg o png). Pide confirmación.",
    inputSchema: S({ bot: P_BOT, producto: P_PROD, accion: { type: "string", enum: ["agregar", "quitar"] },
      imagen_url: { type: "string", description: "Enlace público directo a la imagen jpg/png." },
      etiqueta: { type: "string", description: "Nombre corto, ej. «testimonio1» o «tabla_precios»." },
      descripcion: { type: "string", description: "Cuándo mandarla, ej. «cuando pregunte si funciona, manda este testimonio»." },
      confirmar: P_CONF }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); exigirAdmin(b);
      const p = await productoDe(b, a?.producto);
      const tag = String(a?.etiqueta ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      const lista: any[] = Array.isArray((p.config ?? {}).ia_multimedia) ? p.config.ia_multimedia : [];
      if (a?.accion === "quitar") {
        const i = lista.findIndex((m) => m?.tag === tag);
        if (i < 0) throw new Fallo(`No hay una imagen «${tag}» en «${p.nombre}». Tiene: ${lista.map((m) => m.tag).join(", ") || "ninguna"}.`);
        const pre = confirmacion(a, `Quitar la imagen «${tag}» de «${p.nombre}».`); if (pre) return pre;
        await patchProducto(p.id, (c, tipo) => { c.ia_multimedia = (c.ia_multimedia ?? []).filter((m: any) => m?.tag !== tag); recompilarFicha(c, tipo); });
        return { ok: true, hecho: `Imagen «${tag}» quitada de «${p.nombre}».` };
      }
      if (!tag) throw new Fallo("Ponle una etiqueta corta a la imagen (ej. «testimonio1»).");
      if (!String(a?.descripcion ?? "").trim()) throw new Fallo("Dime cuándo debe mandarla la IA (la descripción).");
      if (lista.some((m) => m?.tag === tag)) throw new Fallo(`Ya hay una imagen «${tag}»: usa otra etiqueta o quítala primero.`);
      const pre = confirmacion(a, `Agregar a «${p.nombre}» la imagen «${tag}»: ${a?.imagen_url}\nCuándo: ${corto(a.descripcion, 200)}`); if (pre) return pre;
      const im = await subirImagen(b, a?.imagen_url);
      await patchProducto(p.id, (c, tipo) => { c.ia_multimedia = [...(c.ia_multimedia ?? []), { tag, media_kind: "image", media_url: im.url, mime: im.mime, filename: im.filename, descripcion: String(a.descripcion).trim() }]; recompilarFicha(c, tipo); });
      return { ok: true, hecho: `Imagen «${tag}» agregada a «${p.nombre}»: la IA ya la puede mandar.` };
    } },

  { name: "medios_pago_producto", escribe: true, description: "Medios de pago PROPIOS de un producto (reemplazan a los del bot solo para ese producto). Por seguridad: nunca inventes números, y para agregar uno pide a la persona que te escriba los ÚLTIMOS 4 DÍGITOS del número (campo ultimos_4) además de confirmar. Avisa por Telegram al dueño cada vez que cambian.",
    inputSchema: S({ bot: P_BOT, producto: P_PROD, accion: { type: "string", enum: ["agregar", "quitar", "usar_los_del_bot"], description: "usar_los_del_bot: borra los propios y vuelve a cobrar con los del bot." },
      app: { type: "string", description: "Yape, Plin, BCP…" }, titular: { type: "string" }, numero: { type: "string" }, notas: { type: "string" },
      ultimos_4: { type: "string", description: "Los últimos 4 dígitos del número, ESCRITOS POR LA PERSONA (verificación)." },
      confirmar: P_CONF }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); exigirAdmin(b);
      const p = await productoDe(b, a?.producto);
      const actuales: any[] = (((p.config ?? {}).pago_propio ?? {}).metodos ?? []).filter((m: any) => m && (m.app || m.numero || m.titular));
      let nuevos = [...actuales], vista = "";
      if (a?.accion === "usar_los_del_bot") { nuevos = []; vista = `«${p.nombre}» deja de tener medios propios y cobra con los del bot «${b.nombre}».`; }
      else if (a?.accion === "quitar") {
        const i = actuales.findIndex((m) => norm(m.app) === norm(a?.app) && (!a?.numero || String(m.numero ?? "").replace(/\D/g, "").endsWith(String(a.numero).replace(/\D/g, "").slice(-4))));
        if (i < 0) throw new Fallo(`«${p.nombre}» no tiene un medio propio «${a?.app}».`);
        vista = `Quitar de «${p.nombre}»: ${actuales[i].app} (${actuales[i].titular ?? ""}, •••${String(actuales[i].numero ?? "").slice(-4)}).`;
        nuevos.splice(i, 1);
      } else {
        const titular = String(a?.titular ?? "").trim(), numero = String(a?.numero ?? "").trim(), app = String(a?.app ?? "").trim();
        if (!app || !titular || !numero) throw new Fallo("Para agregarlo necesito app, titular y número (pídeselos a la persona; no los inventes).");
        const fin = numero.replace(/\D/g, "").slice(-4);
        vista = `Agregar a «${p.nombre}» (${b.nombre}): ${app} · ${titular} · ${numero}${a?.notas ? ` (${a.notas})` : ""}.\n⚠️ Los pagos de este producto deberán llegar a ESTE número. Para confirmar, la persona tiene que escribir los últimos 4 dígitos.`;
        if (a?.confirmar === true && String(a?.ultimos_4 ?? "").replace(/\D/g, "") !== fin) throw new Fallo("Los últimos 4 dígitos no coinciden con el número. Pídele a la persona que los escriba de nuevo.");
        nuevos.push({ app, titular, numero, ...(String(a?.notas ?? "").trim() ? { notas: String(a.notas).trim() } : {}) });
      }
      const pre = confirmacion(a, vista); if (pre) return pre;
      await patchProducto(p.id, (c, tipo) => { if (nuevos.length) c.pago_propio = { metodos: nuevos }; else delete c.pago_propio; recompilarFicha(c, tipo); });
      // 🔔 Aviso al dueño por Telegram (cambiar a dónde llega la plata no puede pasar en silencio).
      let avisado = false;
      try {
        const { data: ch } = await db.from("channels").select("telegram_chat_ids").eq("id", b.id).maybeSingle();
        const ids = (((ch as any)?.telegram_chat_ids ?? []) as any[]).map(String);
        const sec = await getChannelSecrets(db, b.id);
        if (sec?.telegram_bot_token && ids.length) avisado = (await sendTelegram(sec.telegram_bot_token, ids,
          `⚠️ Cambiaron los medios de pago de «${p.nombre}» (${b.nombre}) desde el MCP, por ${ctx.nombre || "un usuario"}.\n` +
          (nuevos.length ? "Ahora cobra con:\n" + nuevos.map((m) => `• ${m.app} · ${m.titular} · •••${String(m.numero).replace(/\D/g, "").slice(-4)}`).join("\n") : "Ahora cobra con los medios del bot.") +
          "\nSi no fuiste tú, revísalo en Productos → Cómo lo vende la IA.")) > 0;
      } catch (_) { /* sin Telegram configurado */ }
      return { ok: true, hecho: nuevos.length ? `«${p.nombre}» cobra con: ${nuevos.map((m) => `${m.app} •••${String(m.numero).replace(/\D/g, "").slice(-4)}`).join(", ")}.` : `«${p.nombre}» vuelve a cobrar con los medios del bot.`,
        aviso_telegram: avisado ? "enviado" : "no hay Telegram configurado en este bot" };
    } },
];

const TODAS: Tool[] = [...TOOLS, ...NUEVAS];

const INSTRUCCIONES = [
  "Eres un asistente con acceso a Nodo, el CRM de ventas por WhatsApp con IA de esta persona. Habla en español sencillo (Perú, tuteo).",
  "Usa mis_bots primero si no sabes qué bots hay. Las horas que devuelven las herramientas ya están en la zona del bot.",
  "Los números (ganancia, costo por chat, ROAS…) salen calculados igual que en el panel: úsalos tal cual, no los recalcules. Para «¿cómo me fue?» usa resumen; para comparar, resumen con comparar:true; por anuncio/ángulo/producto, rendimiento; dónde se pierden clientes, embudo.",
  "Las herramientas que cambian algo devuelven primero una vista previa: muéstrasela a la persona y vuelve a llamar con confirmar:true SOLO si te dice que sí.",
  "Nunca inventes números de pago, precios ni datos del negocio: pregúntalos. Conectar WhatsApp y poner claves de IA se hace en el panel, no aquí.",
].join("\n");

// ── JSON-RPC ────────────────────────────────────────────────────────────────────────────────────────────────────
async function atender(msg: any, ctx: Ctx): Promise<any | null> {
  const id = msg?.id;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return id === undefined ? null : err(-32600, "Pedido inválido");
  if (id === undefined || id === null) return null;   // notificación (initialized, cancelled…): no lleva respuesta
  switch (msg.method) {
    case "initialize": {
      // (16-nov) Se MIDE qué versión del protocolo pide cada IA (migración 0151) antes de tocar la negociación:
      // hay reportes de que ChatGPT solo lee el logo (icons) con la versión 2025-11-25.
      const p = msg.params ?? {};
      await db.from("mcp_tokens").update({ ultimo_cliente: { protocolVersion: p.protocolVersion ?? null, clientInfo: p.clientInfo ?? null,
        capabilities: Object.keys(p.capabilities ?? {}), at: new Date().toISOString() } }).eq("id", ctx.tokenId).then(() => {}, () => {});
      return ok({ protocolVersion: p.protocolVersion ?? "2025-06-18", capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "nodo", title: "Nodo", version: "1.0.0", websiteUrl: "https://trackmeta.github.io/Nodo/panel/",
          description: "Tu CRM de ventas por WhatsApp con IA: ventas, chats, clientes, pedidos y pagos de tus bots.",
          // (16-nov, Rodrigo) El logo de Nodo, campo `icons` del MCP. Que se vea depende de cada IA (ChatGPT en modo
          // desarrollador puede ignorarlo y poner su ícono genérico).
          icons: [{ src: "https://trackmeta.github.io/Nodo/assets/logo-512.png", mimeType: "image/png", sizes: ["512x512"] },
                  { src: "https://trackmeta.github.io/Nodo/assets/logo-128.png", mimeType: "image/png", sizes: ["128x128"] },
                  { src: "https://trackmeta.github.io/Nodo/assets/logo-96.png", mimeType: "image/png", sizes: ["96x96"] }] },
        instructions: INSTRUCCIONES });
    }
    case "ping": return ok({});
    case "tools/list":
      return ok({ tools: TODAS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema,
        annotations: { readOnlyHint: !t.escribe, destructiveHint: false, openWorldHint: false } })) });
    case "tools/call": {
      const t = TODAS.find((x) => x.name === msg.params?.name);
      if (!t) return err(-32602, `No existe la herramienta «${msg.params?.name}».`);
      try {
        const r = await t.run(ctx, msg.params?.arguments ?? {});
        return ok({ content: [{ type: "text", text: JSON.stringify(r, null, 1) }], structuredContent: r });
      } catch (e) {
        const texto = e instanceof Fallo ? e.message : "Error interno: " + String((e as any)?.message ?? e);
        if (!(e instanceof Fallo)) console.error("[mcp]", t.name, e);
        return ok({ content: [{ type: "text", text: texto }], isError: true });
      }
    }
    case "resources/list": return ok({ resources: [] });
    case "prompts/list": return ok({ prompts: [] });
    default: return err(-32601, `Método no soportado: ${msg.method}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method === "DELETE") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return new Response("El MCP de Nodo se usa con POST (JSON-RPC).", { status: 405, headers: { ...CORS, Allow: "POST" } });
  const llave = llaveDe(req);
  if (!llave) return jres({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Falta la llave de Nodo en el enlace. Cópiala de Conexiones → MCP." } }, 401);
  const ctx = await contexto(llave);
  if (!ctx) return jres({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "La llave no es válida o fue desactivada. Genera otra en Conexiones → MCP." } }, 401);
  let body: any;
  try { body = await req.json(); } catch { return jres({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } }, 400); }
  if (Array.isArray(body)) {
    const res = (await Promise.all(body.map((m) => atender(m, ctx)))).filter(Boolean);
    return res.length ? jres(res) : new Response(null, { status: 202, headers: CORS });
  }
  const r = await atender(body, ctx);
  return r ? jres(r) : new Response(null, { status: 202, headers: CORS });
});
