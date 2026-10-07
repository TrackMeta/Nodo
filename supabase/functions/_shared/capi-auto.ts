// ═══════════════════════════════════════════════════════════════════
// Nodo · «Ventas a Meta» sin configurar nada aparte (7-oct-2026).
//
// Antes: además del token de WhatsApp, el dueño tenía que ir al Administrador de eventos, copiar el ID del
// dataset (el «pixel») y generar un token CAPI, y pegar las dos cosas en Ajustes → Pixel de Meta. En Prime Digital
// nadie lo hizo y las primeras ventas reales (con su clic de anuncio guardado) no llegaron a Meta.
// Ahora:
//   · el dataset se le pide a la propia cuenta de WhatsApp Business (GET /{waba}/dataset; si no tiene, se crea con
//     POST): es el dataset de mensajería de ESA WABA, el correcto para atribuir un Click-to-WhatsApp;
//   · el token es el mismo de WhatsApp (capi.ts cae a `access_token` si no hay `capi_token`);
//   · la «prueba» son las ventas reales que no llegaron: Meta no tiene ensayo en seco (un evento de prueba sin el
//     código de Events Manager entra como conversión REAL — ver capi-test), así que se mandan esas y su respuesta
//     dice si la conexión sirve.
// ═══════════════════════════════════════════════════════════════════
import { getChannelSecrets } from "./db.ts";
import { fetchConTimeout } from "./http.ts";
import { maybePurchase, PURCHASE_STATES } from "./capi.ts";

type DB = any;
const GRAPH = "https://graph.facebook.com/v25.0";

async function graph(method: "GET" | "POST", path: string, token: string): Promise<{ status: number; body: any }> {
  try {
    const r = await fetchConTimeout(`${GRAPH}/${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(method === "POST" ? { body: "{}" } : {}),
    }, 15000);
    return { status: r.status, body: await r.json().catch(() => ({})) };
  } catch (e) { return { status: 0, body: { error: { message: String((e as any)?.message ?? e) } } }; }
}

// El id del dataset en cualquiera de las formas en que Meta lo devuelve ({id}, {data:[{id}]}, {data:[{dataset_id}]}).
function idDeDataset(b: any): string {
  const d = Array.isArray(b?.data) ? b.data[0] : b;
  return String(d?.id ?? d?.dataset_id ?? "").trim();
}

export interface ConexionVentas {
  ok: boolean;
  dataset_id?: string;
  creado?: boolean;
  ya_tenia?: string;      // el canal ya tenía OTRO pixel cargado a mano: no se pisa
  detalle?: string;       // por qué no se pudo, en palabras del dueño
}

// Busca (o crea) el dataset de la WABA del canal y lo deja como `pixel_id`. Con `forzar`, reemplaza uno cargado a mano.
export async function conectarVentasMeta(db: DB, channelId: string, opts: { forzar?: boolean } = {}): Promise<ConexionVentas> {
  const { data: ch } = await db.from("channels").select("waba_id, pixel_id").eq("id", channelId).maybeSingle();
  const waba = String((ch as any)?.waba_id ?? "").trim();
  if (!waba) return { ok: false, detalle: "Primero conecta WhatsApp: el dataset de ventas se saca de tu cuenta de WhatsApp Business." };
  const sec = await getChannelSecrets(db, channelId).catch(() => null);
  const token = String(sec?.access_token ?? "").trim();
  if (!token) return { ok: false, detalle: "Falta el token de WhatsApp de este bot." };

  let r = await graph("GET", `${waba}/dataset`, token);
  let ds = r.status === 200 ? idDeDataset(r.body) : "";
  let creado = false;
  if (!ds) {
    const c = await graph("POST", `${waba}/dataset`, token);
    ds = c.status === 200 ? idDeDataset(c.body) : "";
    creado = !!ds;
    if (!ds) r = c;
  }
  if (!ds) {
    const m = String(r.body?.error?.message ?? `Meta respondió ${r.status}`);
    const permiso = /permission|permiso|#200|#10\b|#100/i.test(m);
    return {
      ok: false,
      detalle: permiso
        ? `Meta no dejó leer el dataset de tu WhatsApp con este token (${m.slice(0, 140)}). Dale al usuario del sistema acceso de «control total» a tu cuenta de WhatsApp Business y vuelve a intentarlo.`
        : `Meta no devolvió el dataset de tu WhatsApp: ${m.slice(0, 160)}`,
    };
  }
  const actual = String((ch as any)?.pixel_id ?? "").trim();
  if (actual && actual !== ds && !opts.forzar) return { ok: true, dataset_id: actual, ya_tenia: actual, detalle: `Tu WhatsApp tiene el dataset ${ds}; dejé el que cargaste a mano.` };
  if (actual !== ds) await db.from("channels").update({ pixel_id: ds }).eq("id", channelId);
  return { ok: true, dataset_id: ds, creado };
}

export interface VentaReenviada { order_id: string; cliente: string; monto: number; ok: boolean; error?: string; ya?: boolean }

// Las ventas de los últimos 7 días que vinieron de un anuncio y no llegaron a Meta (sin evento «enviado»). Se mandan
// con la hora de la compra. Más atrás de 7 días Meta ya no las acepta.
export async function reenviarVentasPendientes(db: DB, channelId: string, opts: { soloContar?: boolean } = {}): Promise<{ pendientes: number; enviadas: VentaReenviada[] }> {
  const desde = new Date(Date.now() - 7 * 86400_000 + 3600_000).toISOString();
  const { data: ords } = await db.from("orders")
    .select("id, channel_id, contact_id, estado, amount, currency, shipping, created_at, confirmed_at, updated_at, contact:contacts(nombre, source, wa_id)")
    .eq("channel_id", channelId).gte("created_at", desde).order("created_at", { ascending: true }).limit(200);
  const { data: ya } = await db.from("capi_events").select("order_id").eq("channel_id", channelId)
    .eq("event_name", "Purchase").eq("estado", "enviado").gte("created_at", desde);
  const enviados = new Set(((ya ?? []) as any[]).map((x) => String(x.order_id)));
  const pend = ((ords ?? []) as any[]).filter((o) => PURCHASE_STATES.has(String(o.estado)) && (o.shipping as any)?.ctwa_clid
    && !(o.shipping as any)?.capi_purchase_nodo && !enviados.has(String(o.id))
    && (o.contact as any)?.source !== "sim" && (o.contact as any)?.wa_id !== "webchat-test");
  if (opts.soloContar) return { pendientes: pend.length, enviadas: [] };
  const out: VentaReenviada[] = [];
  for (const o of pend) {
    const t = Date.parse(String(o.confirmed_at ?? o.created_at ?? ""));
    const r: any = await maybePurchase(db, o, { eventTime: Number.isFinite(t) ? Math.floor(t / 1000) : undefined }).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    out.push({ order_id: String(o.id), cliente: String((o.contact as any)?.nombre ?? ""), monto: Number(o.amount) || 0,
      ok: !!r?.ok && !r?.omitido, ya: !!r?.deduped, error: r?.ok ? undefined : String(r?.error ?? "sin respuesta") });
  }
  return { pendientes: pend.length, enviadas: out };
}

// Para la tarjeta de Ajustes: qué dataset, con qué token, la última venta que llegó y las que faltan.
export async function estadoVentasMeta(db: DB, channelId: string) {
  const { data: ch } = await db.from("channels").select("pixel_id, waba_id").eq("id", channelId).maybeSingle();
  const sec = await getChannelSecrets(db, channelId).catch(() => null);
  const { data: ult } = await db.from("capi_events").select("value, currency, created_at, contact_id")
    .eq("channel_id", channelId).eq("event_name", "Purchase").eq("estado", "enviado").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: fallo } = await db.from("capi_events").select("created_at, meta_response")
    .eq("channel_id", channelId).eq("estado", "fallido").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { pendientes } = await reenviarVentasPendientes(db, channelId, { soloContar: true });
  return {
    dataset_id: (ch as any)?.pixel_id ?? null,
    whatsapp: !!(ch as any)?.waba_id && !!sec?.access_token,
    token: sec?.capi_token ? "propio" : (sec?.access_token ? "whatsapp" : null),
    ultima_venta: ult ?? null,
    ultimo_fallo: fallo ? { at: (fallo as any).created_at, error: String(((fallo as any).meta_response as any)?.error ?? JSON.stringify((fallo as any).meta_response ?? "")).slice(0, 200) } : null,
    pendientes,
  };
}
