// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: ads-sync  (service_role — la llama el cron)
//   Baja de la Marketing API de Meta, para cada canal con token ads_read
//   y cuentas activas, el GASTO + métricas de entrega por anuncio y día,
//   más la jerarquía (nombres de campaña/conjunto/anuncio). Upsert en
//   ads_insights + ads_meta. La sección "Rendimiento" las cruza con las
//   ventas reales (orders por shipping.ad_id) para el CPA real / ganancia.
//
//   Cadencia: la programa un cron (cada ~3 h). Ventana móvil de N días
//   (default 30) para que los días que Meta corrige tarde se actualicen.
//   Idempotente: upsert por (channel_id, ad_id, fecha) y (channel_id, ad_id).
//
//   Seguridad: se protege con x-scheduler-secret (mismo patrón que el
//   scheduler). Sin token/cuentas de un canal → lo salta sin fallar.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, getAdsToken } from "../_shared/db.ts";
import { fetchConTimeout } from "../_shared/http.ts";

const db = serviceClient();
// v25.0 como el resto de Nodo (_shared/meta.ts, channel-config): la v21 (oct-2024) está al borde
// de su fin de soporte y, al vencer, el gasto dejaría de bajar.
const GRAPH = "https://graph.facebook.com/v25.0";
const WINDOW_DAYS = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // Solo el cron (o una invocación interna) puede correr esto.
  const secret = Deno.env.get("SCHEDULER_SECRET") ?? "";
  if (!secret || req.headers.get("x-scheduler-secret") !== secret) {
    return json({ error: "no_auth" }, 401);
  }

  // Canales que tienen al menos una cuenta de anuncios activa.
  // PAGINADO: este cron es GLOBAL de la plataforma, así que acá caben las cuentas de anuncios
  // de TODOS los negocios juntos. PostgREST devuelve como mucho 1000 filas por pedido, y sin
  // `.order()` ni siquiera está definido cuáles entran: pasadas las 1000, los negocios que
  // quedaban afuera dejaban de sincronizar su gasto de Meta PARA SIEMPRE y en silencio — y un
  // negocio sin gasto ve su ROAS y su ganancia infladas, que es la peor forma de mentir.
  const accts: any[] = [];
  for (let desde = 0; desde < 100000; desde += 1000) {
    const { data, error } = await db.from("ad_accounts")
      .select("channel_id, account_id, activo").eq("activo", true)
      .order("channel_id", { ascending: true }).order("account_id", { ascending: true })
      .range(desde, desde + 999);
    if (error) { console.error("[ads-sync] leer cuentas:", error.message); break; }
    const filas = data ?? [];
    accts.push(...filas);
    if (filas.length < 1000) break;
  }
  const porCanal = new Map<string, string[]>();
  for (const a of accts ?? []) {
    const arr = porCanal.get((a as any).channel_id) ?? [];
    arr.push((a as any).account_id);
    porCanal.set((a as any).channel_id, arr);
  }

  // Fechas en hora de LIMA, no UTC: entre las 7 p. m. y medianoche de Lima el «hoy» de UTC ya
  // es mañana, y se le pedía a Meta un día que para la cuenta todavía no existe.
  const diaLima = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  const since = diaLima(Date.now() - WINDOW_DAYS * 864e5);
  const until = diaLima(Date.now());
  const resumen: Record<string, unknown>[] = [];

  for (const [channelId, cuentas] of porCanal) {
    // getChannelSecrets LANZA ante un error transitorio del RPC/Vault. Estaba FUERA de todo
    // try → un hipo al desencriptar el secreto de UN canal tiraba 500 y los canales restantes
    // del loop NO se sincronizaban ese ciclo. Se acota: se salta ese canal, no se mata la corrida.
    let token: string | null = null;
    try { token = (await getAdsToken(db, channelId)).token; }
    catch (e) { resumen.push({ channelId, error: "secreto: " + String((e as any)?.message ?? e) }); continue; }
    if (!token) {
      // Sin token (nunca conectó, o se lo quitaron): limpiar un ads_sync_error RANCIO para que el
      // banner rojo "tu token de anuncios dejó de funcionar" no quede pegado cuando ya no hay nada
      // que sincronizar (antes nunca se tocaba al saltar → el aviso vivía para siempre).
      await db.from("channels").update({ ads_sync_error: null }).eq("id", channelId).then(() => {}, () => {});
      resumen.push({ channelId, saltado: "sin_token" }); continue;
    }
    let authErr: string | null = null;
    let otroErr: string | null = null;
    for (const acct of cuentas) {
      try {
        const n = await syncCuenta(channelId, acct, token, since, until);
        resumen.push({ channelId, acct, filas: n });
      } catch (e) {
        const msg = String((e as any)?.message ?? e);
        resumen.push({ channelId, acct, error: msg });
        if ((e as any)?.authError) authErr = msg;   // token inválido/caducado
        else otroErr = otroErr ?? msg;              // rate limit / permiso / escritura fallida
      }
    }
    // Anota o limpia el estado del canal. ANTES solo un error de AUTH marcaba el canal:
    // un rate-limit, un permiso perdido en una cuenta, o una escritura fallida dejaban
    // `ads_sync_error=null` → el panel decía "sincronizado sano" con el gasto SUBCONTADO
    // (ROAS/ganancia inflados) y CERO señal. Ahora cualquier fallo se anota (el de auth
    // manda porque su mensaje pide reconectar). ads_sync_at solo se actualiza si TODO salió.
    const err = authErr ?? otroErr;
    await db.from("channels").update(
      err ? { ads_sync_error: err } : { ads_sync_error: null, ads_sync_at: new Date().toISOString() },
    ).eq("id", channelId);
  }
  return json({ ok: true, canales: porCanal.size, resumen });
});

// Baja los insights por anuncio y día de UNA cuenta y los upserta.
async function syncCuenta(channelId: string, acct: string, token: string, since: string, until: string): Promise<number> {
  const acctId = acct.startsWith("act_") ? acct : `act_${acct}`;
  // 🔒 El token va en la CABECERA, no en la URL. Antes viajaba como `?access_token=…` en cada
  // request (y en los `next` de paginación), o sea que quedaba escrito en los logs de cada
  // llamada. Pesa más desde hoy: ese token puede traer `business_management`, que es la llave
  // del negocio entero en Meta. Las demás funciones ya lo mandaban así.
  const authH = { Authorization: `Bearer ${token}` };
  // Moneda de facturación de la cuenta: `spend` viene en ESTA moneda (casi siempre USD para
  // un anunciante peruano). Se guarda para que Rendimiento avise si no coincide con la moneda
  // del negocio (los números no están convertidos). Best-effort: si falla, queda null.
  let accountCurrency: string | null = null;
  try {
    const cr = await fetchConTimeout(`${GRAPH}/${acctId}?fields=currency`, { headers: authH });
    const cj = await cr.json();
    if (cr.ok && cj?.currency) accountCurrency = String(cj.currency);
  } catch (_) { /* sin moneda → null */ }
  const fields = [
    "ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name",
    "spend", "impressions", "reach", "clicks",
    // clics a WhatsApp: acciones de tipo click-to-WhatsApp / mensajería
    "actions",
  ].join(",");
  let url =
    `${GRAPH}/${acctId}/insights?level=ad&time_increment=1` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
    `&fields=${fields}&limit=500`;

  const metaRows: any[] = [];
  const insightRows: any[] = [];
  const metaSeen = new Set<string>();
  let guard = 0;

  while (url && guard++ < 50) {
    const res = await fetchConTimeout(url, { headers: authH }, 30_000);
    const body = await res.json();
    if (!res.ok || body.error) {
      const e = body?.error ?? {};
      const err = new Error(e.message ?? `graph ${res.status}`) as Error & { authError?: boolean };
      err.authError = e.code === 190 || /OAuthException/i.test(String(e.type ?? ""));
      throw err;
    }
    for (const r of body.data ?? []) {
      const adId = String(r.ad_id);
      // Jerarquía/nombres: una vez por anuncio.
      if (!metaSeen.has(adId)) {
        metaSeen.add(adId);
        const metaRow: Record<string, unknown> = {
          channel_id: channelId, account_id: acctId, ad_id: adId,
          ad_name: r.ad_name ?? null, adset_id: r.adset_id ?? null, adset_name: r.adset_name ?? null,
          campaign_id: r.campaign_id ?? null, campaign_name: r.campaign_name ?? null,
          updated_at: new Date().toISOString(),
        };
        // Solo se escribe account_currency si el fetch de moneda funcionó: si falló (glitch de
        // red), NO se pisa con null la moneda ya conocida (evita borrarla y disparar un aviso de
        // "moneda desconocida" espurio). accountCurrency es constante por cuenta → filas uniformes.
        if (accountCurrency != null) metaRow.account_currency = accountCurrency;
        metaRows.push(metaRow);
      }
      // Solo el tipo CANÓNICO "conversación iniciada" (messaging_conversation_started, y su
      // variante onsite_conversion.*). Antes sumaba CUALQUIER action_type con "whatsapp"/
      // "messaging" → Meta devuelve varios solapados por fila (started_7d + first_reply + …) y
      // el número salía inflado. Esto es "conversaciones iniciadas" de verdad, sin doble conteo.
      const clicsWA = (r.actions ?? []).reduce((a: number, x: any) =>
        /(^|\.)messaging_conversation_started/i.test(String(x.action_type)) ? a + Number(x.value || 0) : a, 0);
      insightRows.push({
        channel_id: channelId, ad_id: adId, fecha: r.date_start,
        gasto: Number(r.spend || 0), impresiones: Number(r.impressions || 0),
        alcance: Number(r.reach || 0), clics: Number(r.clicks || 0), clics_wa: clicsWA,
        updated_at: new Date().toISOString(),
      });
    }
    // 🔑 El `next` de Meta trae el access_token DENTRO. Se le quita: el token ya va en la
    // cabecera, y dejarlo en la URL lo mete en los logs de cada request paginado.
    url = String(body.paging?.next ?? "").replace(/([?&])access_token=[^&]*&?/g, "$1").replace(/[?&]$/, "");
  }
  // El tope de páginas es una red contra bucles, no un límite de negocio: si Meta todavía
  // tenía más, la sincronización quedó INCOMPLETA y hay que decirlo (ads_sync_error), no marcar
  // el canal como sano con el gasto subcontado. Mismo agujero que ya se cerró arriba para la
  // paginación de ad_accounts.
  if (url) throw new Error(`insights con más de ${guard - 1} páginas: sincronización incompleta, acorta el rango o divide la cuenta`);

  // Se REVISA el .error de cada upsert y se LANZA: sin esto, una escritura fallida (timeout de
  // DB, error transitorio) dejaba syncCuenta devolviendo "éxito" y el canal marcado sano, con el
  // gasto bajado de Meta pero NUNCA aterrizado en la tabla → subconteo silencioso. Al lanzar,
  // el loop de arriba lo captura y marca ads_sync_error.
  if (metaRows.length) {
    const { error } = await db.from("ads_meta").upsert(metaRows, { onConflict: "channel_id,ad_id" });
    if (error) throw new Error("ads_meta upsert: " + error.message);
  }
  // Upsert por chunks para no exceder límites.
  for (let i = 0; i < insightRows.length; i += 500) {
    const { error } = await db.from("ads_insights").upsert(insightRows.slice(i, i + 500), { onConflict: "channel_id,ad_id,fecha" });
    if (error) throw new Error("ads_insights upsert: " + error.message);
  }
  return insightRows.length;
}
