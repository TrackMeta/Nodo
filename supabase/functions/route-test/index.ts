// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: route-test  (AUTENTICADA — verify_jwt=true)
//   Simulador de "Palabras Clave": recibe una frase de prueba y devuelve
//   QUÉ flujo se activaría y POR QUÉ (referral / keyword / IA / respaldo /
//   nada), SIN ejecutar nada ni tocar contactos. Alimenta el simulador del
//   panel para depurar el ruteo antes de gastar en anuncios.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userOwnsChannel } from "../_shared/db.ts";
import { routeDecision } from "../_shared/engine.ts";

const db = serviceClient();

const TIER_LABEL: Record<string, string> = {
  referral: "Anuncio (referral)",
  keyword: "Palabra clave",
  entrada: "Flujo de entrada",
  ia: "IA Router (intención)",
  fallback: "Flujo de respaldo",
  none: "Ningún flujo",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // ── Auth: miembro activo ──
  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userRes } = await userClient(authHeader).auth.getUser();
  const uid = userRes?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);
  const { data: member } = await db
    .from("app_users").select("id").eq("id", uid).eq("activo", true).maybeSingle();
  if (!member) return json({ error: "not_member" }, 403);

  // ── Body ──
  let body: { channel_id?: string; text?: string; ad_id?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const { channel_id, text, ad_id } = body;
  if (!channel_id || typeof text !== "string") return json({ error: "faltan_campos" }, 400);
  if (!(await userOwnsChannel(db, uid, channel_id))) return json({ error: "forbidden_channel" }, 403);

  try {
    const d = await routeDecision(db, channel_id, text, ad_id || undefined);
    return json({
      ok: true,
      tier: d.tier,
      tier_label: TIER_LABEL[d.tier] ?? d.tier,
      flow: d.flow,           // { id, nombre } | null
      confidence: d.confidence ?? null,
      reason: d.reason ?? null,
    });
  } catch (e) {
    console.error("[route-test] error:", (e as any)?.message ?? e);
    return json({ error: "engine_error", detalle: String((e as any)?.message ?? e) }, 500);
  }
});
