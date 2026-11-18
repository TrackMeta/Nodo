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
// El MISMO armado del texto del negocio que usa el panel al guardar (Bot → Tu negocio), para no tener dos versiones.
import { compileNegocio, fusionarNegocio } from "../../../panel/negocio-texto.js";

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

  { name: "resumen", description: "Cómo le va a un bot (o a todos) en un periodo, con las MISMAS cuentas que Inicio del panel: chats nuevos, ventas, ingresos cobrados, ticket, conversión, gasto en Meta, costo por chat, costo por venta, ROAS, costos, gasto de IA, ganancia bruta y GANANCIA NETA. Usa estos números tal cual; no los recalcules.",
    inputSchema: S({ bot: { type: "string", description: "Bot; omítelo para ver todos tus bots." }, periodo: P_PER, desde: P_D, hasta: P_D }),
    run: async (ctx, a) => {
      // (18-nov, Rodrigo: «ChatGPT no me pudo decir mi ganancia ni mi costo por chat, lo calculó él») Misma cuenta que
      // Inicio y el resumen de Telegram (_shared/order-stats.ts › resumirPedidos + _shared/resumen.ts):
      //   ganancia neta = bruta − anuncios − gastos extra − IA (en la moneda del bot, con su tipo de cambio);
      //   costo por chat = gasto en Meta ÷ personas que escribieron por un anuncio (primera_interaccion en las fechas).
      const bots = a?.bot ? [botDe(ctx, a.bot)] : ctx.bots;
      const filas = [];
      for (const b of bots) {
        const r = periodo(b.timezone, a?.periodo, a?.desde, a?.hasta);
        const [ks, os, ia, ads, gx, am, cuentas] = await Promise.all([
          // Chats nuevos = primera_interaccion en las fechas (created_at si falta), como Inicio y el Embudo.
          paginar<any>((f, t) => db.from("contacts").select("wa_id, source, ad_id").eq("channel_id", b.id).or(`and(primera_interaccion.gte.${r.desde},primera_interaccion.lte.${r.hasta}),and(primera_interaccion.is.null,created_at.gte.${r.desde},created_at.lte.${r.hasta})`).range(f, t)),
          paginar<any>((f, t) => db.from("orders").select("contact_id, amount, currency, order_bumps, estado, shipping, created_at, product:product_id(tipo), contacts(wa_id, source)").eq("channel_id", b.id).gte("created_at", r.desde).lte("created_at", r.hasta).order("created_at").order("id").range(f, t)),
          paginar<any>((f, t) => db.from("ai_usage").select("costo_usd").eq("channel_id", b.id).gte("dia", r.dDesde).lte("dia", r.dHasta).range(f, t)),
          paginar<any>((f, t) => db.from("ads_insights").select("ad_id, gasto").eq("channel_id", b.id).gte("fecha", r.dDesde).lte("fecha", r.dHasta).order("ad_id").range(f, t)).catch(() => [] as any[]),
          paginar<any>((f, t) => db.from("manual_expenses").select("monto").eq("channel_id", b.id).gte("fecha", r.dDesde).lte("fecha", r.dHasta).order("id").range(f, t)).catch(() => [] as any[]),
          paginar<any>((f, t) => db.from("ads_meta").select("ad_id, account_id, account_currency").eq("channel_id", b.id).order("ad_id").range(f, t)).catch(() => [] as any[]),
          db.from("ad_accounts").select("account_id").eq("channel_id", b.id).eq("activo", true).then((x: any) => x, () => ({ data: null })),
        ]);
        const cur = String(b.moneda || "PEN").toUpperCase(), tasa = b.usd_rate || 0;
        // Pedidos de prueba fuera; y los de otra moneda no se suman como si fueran de la del bot (como Inicio).
        const pedidos = os.filter((o) => !esPrueba(o.contacts) && String(o.currency || "PEN").toUpperCase() === cur);
        const dg = resumirPedidos(pedidos as any);
        // Gasto de Meta en la moneda del bot (misma regla que resumen.ts) y sin las cuentas publicitarias quitadas.
        const monedas = [...new Set(am.map((m: any) => String(m.account_currency || "").toUpperCase()).filter(Boolean))];
        let factor = 1, sinConvertir = ads.length > 0;
        if (monedas.length && !am.some((m: any) => !m.account_currency)) {
          if (monedas.every((m) => m === cur)) sinConvertir = false;
          else if (monedas.length === 1 && monedas[0] === "USD" && cur !== "USD" && tasa > 0) { factor = tasa; sinConvertir = false; }
        }
        const activas = (cuentas as any)?.data ? new Set(((cuentas as any).data as any[]).map((x) => String(x.account_id))) : null;
        const fuera = new Set(activas ? am.filter((m: any) => m.account_id && !activas.has(String(m.account_id))).map((m: any) => String(m.ad_id)) : []);
        const gastoAds = ads.filter((x) => !fuera.has(String(x.ad_id))).reduce((s, x) => s + Number(x.gasto || 0), 0) * factor;
        const gastosExtra = gx.reduce((s, x) => s + Number(x.monto || 0), 0);
        const iaUsd = ia.reduce((s, x) => s + Number(x.costo_usd || 0), 0);
        const gastoIa = cur === "USD" ? iaUsd : tasa > 0 ? iaUsd * tasa : 0;
        const neta = dg.ganancia != null ? dg.ganancia - gastoAds - gastosExtra - gastoIa : null;
        const contactos = ks.filter((k) => !esPrueba(k));
        const chats = contactos.length, chatsAds = contactos.filter((k) => k.ad_id).length;
        const din = (n: number) => dinero(n, b.moneda);
        const fila: Record<string, unknown> = {
          bot: b.nombre, periodo: r.etiqueta, moneda: cur,
          chats_nuevos: chats, chats_de_anuncios: chatsAds,
          ventas: dg.ventas, ingresos_cobrados: din(dg.ingresos),
          ...(dg.porCobrar > 0 ? { por_cobrar: din(dg.porCobrar) } : {}),
          ticket_promedio: dg.ventas ? din(dg.ticket) : "—",
          conversion: chats ? `${Math.round((dg.ventas / chats) * 1000) / 10}%` : "—",
          gasto_meta: din(gastoAds),
          costo_por_chat: gastoAds && chatsAds ? din(gastoAds / chatsAds) : "—",
          costo_por_venta: gastoAds && dg.ventas ? din(gastoAds / dg.ventas) : "—",
          roas: gastoAds ? `${(dg.ingresos / gastoAds).toFixed(2)}×` : "—",
          ...(dg.costoProd > 0 ? { costo_de_productos: din(dg.costoProd) } : {}),
          ...(dg.envio > 0 ? { gasto_de_envios: din(dg.envio) } : {}),
          ...(gastosExtra > 0 ? { gastos_extra: din(gastosExtra) } : {}),
          gasto_ia: gastoIa ? din(gastoIa) : `$${iaUsd.toFixed(3)}`,
          ganancia_bruta: dg.ganancia != null ? din(dg.ganancia) : "—",
          ganancia_neta: neta != null ? din(neta) : "—",
        };
        const notas: string[] = [];
        if (neta == null && dg.ventas) notas.push("Ninguna venta tiene sus costos registrados: la ganancia no se puede calcular.");
        if (dg.gananciaSinDatos) notas.push(`${dg.gananciaSinDatos} pedido(s) físico(s) sin costo o flete no entran en la ganancia.`);
        if (iaUsd > 0 && !gastoIa) notas.push("El gasto de IA está en dólares y el bot no tiene tipo de cambio: no se restó de la ganancia.");
        if (sinConvertir && gastoAds) notas.push("No se pudo confirmar la moneda de la cuenta de Meta: el gasto va sin convertir.");
        if (notas.length) fila.notas = notas;
        filas.push(fila);
      }
      return { resumen: filas };
    } },

  { name: "contactos", description: "Clientes de un bot, del más reciente al más antiguo. Filtra por etapa del embudo (nuevo, curioso, interesado, caliente, confirmado, comprado, perdido) o busca por nombre/teléfono.",
    inputSchema: S({ bot: P_BOT, etapa: { type: "string" }, buscar: { type: "string" }, limite: { type: "number", description: "Máximo 50 (por defecto 20)." } }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot);
      let q = db.from("contacts").select("id, nombre, wa_id, stage, created_at, ultimo_mensaje_at, bot_activo, source, product_id, products(nombre)").eq("channel_id", b.id);
      if (a?.etapa) q = q.eq("stage", norm(a.etapa));
      if (a?.buscar) { const d = String(a.buscar).replace(/\D/g, ""); q = d.length >= 6 ? q.ilike("wa_id", `%${d}%`) : q.ilike("nombre", `%${String(a.buscar).replace(/[%_]/g, "")}%`); }
      const { data } = await q.order("ultimo_mensaje_at", { ascending: false, nullsFirst: false }).limit(Math.min(Number(a?.limite) || 20, 50) + 10);
      const lista = ((data ?? []) as any[]).filter((k) => !esPrueba(k)).slice(0, Math.min(Number(a?.limite) || 20, 50));
      return { bot: b.nombre, contactos: lista.map((k) => ({ id: k.id, nombre: k.nombre, telefono: k.wa_id, etapa: k.stage, producto: k.products?.nombre ?? null,
        llego: horaLocal(k.created_at, b.timezone), ultimo_mensaje: horaLocal(k.ultimo_mensaje_at, b.timezone), desde_anuncio: k.source === "ad" || k.source === "ctwa", bot_atiende: k.bot_activo !== false })) };
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

  { name: "pedidos", description: "Pedidos de un bot en un periodo, con su estado, monto, cliente y producto. Puedes filtrar por estado.",
    inputSchema: S({ bot: P_BOT, estado: { type: "string" }, periodo: P_PER, desde: P_D, hasta: P_D, limite: { type: "number" } }),
    run: async (ctx, a) => {
      const b = botDe(ctx, a?.bot); const r = periodo(b.timezone, a?.periodo ?? "30dias", a?.desde, a?.hasta);
      let q = db.from("orders").select("id, estado, amount, created_at, contacts(nombre, wa_id, source), products(nombre), product_versions(nombre)")
        .eq("channel_id", b.id).gte("created_at", r.desde).lte("created_at", r.hasta);
      if (a?.estado) q = q.eq("estado", String(a.estado));
      const { data } = await q.order("created_at", { ascending: false }).limit(Math.min(Number(a?.limite) || 30, 100));
      const lista = ((data ?? []) as any[]).filter((o) => !esPrueba(o.contacts));
      return { bot: b.nombre, periodo: r.etiqueta, pedidos: lista.map((o) => ({ id: o.id, estado: o.estado, monto: dinero(o.amount, b.moneda), cliente: o.contacts?.nombre ?? null,
        telefono: o.contacts?.wa_id ?? null, producto: [o.products?.nombre, o.product_versions?.nombre].filter(Boolean).join(" · "), fecha: horaLocal(o.created_at, b.timezone) })) };
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
        db.from("products").select("id, nombre, tipo, clase, product_versions(id, nombre, precio, activo, orden)").eq("channel_id", b.id).order("created_at"),
        db.from("flow_triggers").select("config, activo, flows!inner(product_id)").eq("channel_id", b.id).eq("tipo", "keyword"),
      ]);
      const claves = new Map<string, string[]>();
      for (const t of (trg ?? []) as any[]) { const pid = t.flows?.product_id; if (!pid || t.activo === false) continue; claves.set(pid, [...(claves.get(pid) ?? []), ...((t.config?.keywords ?? []) as string[])]); }
      return { bot: b.nombre, productos: ((ps ?? []) as any[]).map((p) => ({ id: p.id, nombre: p.nombre, tipo: p.tipo, clase: p.clase, palabras_clave: claves.get(p.id) ?? [],
        vendiendo: claves.has(p.id),
        presentaciones: ((p.product_versions ?? []) as any[]).sort((x, y) => (x.orden ?? 0) - (y.orden ?? 0)).map((v) => ({ id: v.id, nombre: v.nombre, precio: dinero(v.precio, b.moneda), activa: v.activo !== false })) })) };
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
      const config: any = {}; if (a?.descripcion) config.ia = { descripcion: String(a.descripcion) };
      const { data: p, error } = await db.from("products").insert({ channel_id: b.id, nombre: String(a.nombre).trim(), tipo: a.tipo, clase: "principal", emoji: a?.emoji ?? null, config }).select("id").single();
      if (error) throw new Fallo(/tipo_no_permitido/.test(error.message) ? `Este equipo no vende productos de tipo ${a.tipo}.` : error.message);
      const { error: e2 } = await db.from("product_versions").insert(pres.map((x, i) => ({ product_id: (p as any).id, nombre: String(x.nombre), precio: Number(x.precio), orden: i, activo: true })));
      if (e2) throw new Fallo("El producto se creó, pero no sus presentaciones: " + e2.message);
      return { ok: true, hecho: `Producto «${a.nombre}» creado en «${b.nombre}» con ${pres.length} presentación(es).`,
        siguiente_paso: "Para que el bot lo venda: abre el producto en Nodo, revisa la ficha (o usa «Armar con IA») y toca «Poner a vender».", enlace: `${PANEL}/productos.html` };
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

const INSTRUCCIONES = [
  "Eres un asistente con acceso a Nodo, el CRM de ventas por WhatsApp con IA de esta persona. Habla en español sencillo (Perú, tuteo).",
  "Usa mis_bots primero si no sabes qué bots hay. Las horas que devuelven las herramientas ya están en la zona del bot.",
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
      return ok({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema,
        annotations: { readOnlyHint: !t.escribe, destructiveHint: false, openWorldHint: false } })) });
    case "tools/call": {
      const t = TOOLS.find((x) => x.name === msg.params?.name);
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
