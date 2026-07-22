// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: ads-schedule  (AUTENTICADA — verify_jwt=true)
//   Lee y cambia CADA CUÁNTO corre ads-sync (el cron global). El panel
//   (Ajustes → Meta) llama acá; esta función tiene el SCHEDULER_SECRET en
//   su env y lo pasa a schedule_nodo_ads_sync para reprogramar el cron.
//   Es un cron GLOBAL (una corrida procesa todos los canales), así que la
//   frecuencia es del despliegue, no por canal.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/db.ts";

const db = serviceClient();

// freq ↔ cron. Minutos desfasados para no chocar con el tope de hora.
const FREQ_CRON: Record<string, string> = {
  "1h": "0 * * * *",
  "3h": "17 */3 * * *",
  "6h": "23 */6 * * *",
  "12h": "31 */12 * * *",
};
const CRON_FREQ: Record<string, string> = Object.fromEntries(
  Object.entries(FREQ_CRON).map(([f, c]) => [c, f]),
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Miembro activo.
  const { data: userRes } = await userClient(req.headers.get("Authorization") ?? "").auth.getUser();
  const uid = userRes?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);
  const { data: member } = await db.from("app_users").select("id").eq("id", uid).eq("activo", true).maybeSingle();
  if (!member) return json({ error: "not_member" }, 403);

  let body: { action?: string; freq?: string };
  try { body = await req.json(); } catch { body = {}; }
  const action = body.action ?? "status";

  // Frecuencia actual del cron.
  const currentFreq = async () => {
    const { data } = await db.rpc("ads_sync_cron");
    const cron = (data as string | null) ?? null;
    return cron ? (CRON_FREQ[cron] ?? "custom") : null;
  };

  if (action === "status") {
    return json({ ok: true, freq: await currentFreq() });
  }

  if (action === "set") {
    const freq = String(body.freq ?? "");
    if (freq === "off") {
      const { error } = await db.rpc("unschedule_nodo_ads_sync");
      if (error) return json({ error: "no_se_pudo", detalle: error.message }, 500);
      return json({ ok: true, freq: null });
    }
    const cron = FREQ_CRON[freq];
    if (!cron) return json({ error: "freq_invalida" }, 400);
    const secret = Deno.env.get("SCHEDULER_SECRET") ?? "";
    if (!secret) return json({ error: "sin_scheduler_secret" }, 500);
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ads-sync`;
    const { error } = await db.rpc("schedule_nodo_ads_sync", { p_url: url, p_secret: secret, p_cron: cron });
    if (error) return json({ error: "no_se_pudo", detalle: error.message }, 500);
    return json({ ok: true, freq });
  }

  return json({ error: "accion_desconocida" }, 400);
});
