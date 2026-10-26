// ═════════════════════════════════════════════════════════════════════════
// Nodo · Edge Function: ads-alcance  (AUTENTICADA — la llama Rendimiento)
//   El ALCANCE real de un rango de fechas, por anuncio y de la cuenta entera.
//   (25-oct) Rendimiento sumaba el alcance de cada día (ads_insights.alcance), pero el alcance son PERSONAS
//   distintas: quien vio el anuncio el lunes y el martes contaba dos veces. Medido en Prime (19-25 oct): «34 113» de
//   alcance y frecuencia 1,23, que no cuadran con el Administrador de anuncios. El alcance de un periodo solo se le
//   puede pedir a Meta para ESE periodo completo (no se suma), así que se pregunta en vivo por el rango elegido.
// ═════════════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userOwnsChannel, getAdsToken } from "../_shared/db.ts";
import { fetchConTimeout } from "../_shared/http.ts";

const db = serviceClient();
const GRAPH = "https://graph.facebook.com/v25.0";   // como ads-sync y el resto de Nodo
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const { data: u } = await userClient(req.headers.get("Authorization") ?? "").auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const channelId = String(b?.channel_id ?? "");
  const since = String(b?.since ?? ""), until = String(b?.until ?? "");
  if (!channelId || !(await userOwnsChannel(db, uid, channelId))) return json({ error: "forbidden_channel" }, 403);
  if (!FECHA.test(since) || !FECHA.test(until) || since > until) return json({ error: "fechas" }, 400);

  const { token } = await getAdsToken(db, channelId);
  if (!token) return json({ ok: false, error: "sin_token" });
  const { data: accts } = await db.from("ad_accounts").select("account_id").eq("channel_id", channelId).eq("activo", true).limit(50);
  if (!(accts ?? []).length) return json({ ok: false, error: "sin_cuentas" });

  // El token va en la cabecera, nunca en la URL (ni en los `next` de la paginación).
  const authH = { Authorization: `Bearer ${token}` };
  const rango = encodeURIComponent(JSON.stringify({ since, until }));
  const ads: Record<string, number> = {};
  let total = 0, fallidas = 0;
  for (const a of accts ?? []) {
    const acct = String((a as any).account_id);
    const acctId = acct.startsWith("act_") ? acct : `act_${acct}`;
    try {
      // Por anuncio (paginado).
      let url = `${GRAPH}/${acctId}/insights?level=ad&fields=ad_id,reach&time_range=${rango}&limit=500`, vueltas = 0;
      while (url && vueltas++ < 20) {
        const r = await fetchConTimeout(url, { headers: authH }, 20_000);
        const j = await r.json();
        if (!r.ok || j.error) throw new Error(j?.error?.message ?? `graph ${r.status}`);
        for (const x of j.data ?? []) ads[String(x.ad_id)] = Number(x.reach || 0);
        url = String(j.paging?.next ?? "").replace(/([?&])access_token=[^&]*&?/g, "$1").replace(/[?&]$/, "");
      }
      // De la cuenta entera: personas distintas en TODOS sus anuncios (no es la suma de los anuncios).
      const rc = await fetchConTimeout(`${GRAPH}/${acctId}/insights?level=account&fields=reach&time_range=${rango}`, { headers: authH }, 20_000);
      const jc = await rc.json();
      if (!rc.ok || jc.error) throw new Error(jc?.error?.message ?? `graph ${rc.status}`);
      total += Number(jc.data?.[0]?.reach || 0);   // (dos cuentas distintas casi no comparten personas: se suman)
    } catch (e) {
      fallidas++;
      console.error("[ads-alcance]", acctId, (e as any)?.message ?? e);
    }
  }
  // Si falló alguna cuenta, el total no es confiable: se dice (Rendimiento muestra «—» en vez de un número a medias).
  return json({ ok: fallidas === 0, ads, total: fallidas ? null : total, cuentas: (accts ?? []).length, fallidas });
});
