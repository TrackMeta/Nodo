// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: capi-test  (AUTENTICADA — miembro del panel)
//   Manda UN evento de prueba a Meta con el pixel_id + token CAPI del
//   canal, para verificar la conexión sin hacer una venta real. Si se
//   pasa un test_event_code (Events Manager → Probar eventos), el evento
//   aparece ahí en vivo. No toca capi_events ni las métricas reales.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, getChannelSecrets } from "../_shared/db.ts";
import { sha256Hex } from "../_shared/crypto.ts";

const db = serviceClient();
const GRAPH_VERSION = "v25.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Solo un miembro del panel (con su JWT).
  const auth = req.headers.get("Authorization") ?? "";
  const { data: u } = await userClient(auth).auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);
  const { data: member } = await db.from("app_users").select("id").eq("id", uid).eq("activo", true).maybeSingle();
  if (!member) return json({ error: "not_member" }, 403);

  let body: { channel_id?: string; test_event_code?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!body.channel_id) return json({ error: "falta_channel" }, 400);

  const { data: channel } = await db.from("channels")
    .select("pixel_id").eq("id", body.channel_id).maybeSingle();
  if (!channel?.pixel_id) return json({ ok: false, error: "Falta el Pixel ID. Cárgalo y guarda antes de probar." }, 200);

  const secrets = await getChannelSecrets(db, body.channel_id);
  const capiToken = secrets?.capi_token;
  if (!capiToken) return json({ ok: false, error: "Falta el token CAPI. Cárgalo y guarda antes de probar." }, 200);

  // Evento de prueba: un Lead que imita a los reales (business_messaging), con
  // datos ficticios. No se guarda en capi_events; es solo para ver la conexión.
  const evt: Record<string, unknown> = {
    event_name: "Lead",
    event_time: Math.floor(Date.now() / 1000),
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    event_id: "nodo-test-" + crypto.randomUUID(),
    user_data: {
      ph: [await sha256Hex("51900000000")],
      ctwa_clid: "NODO_TEST_" + Date.now(),
    },
  };
  const payload: Record<string, unknown> = { data: [evt], access_token: capiToken };
  if (body.test_event_code && body.test_event_code.trim()) payload.test_event_code = body.test_event_code.trim();

  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${channel.pixel_id}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const meta = await res.json();
    if (!res.ok || meta.error) {
      return json({ ok: false, error: meta.error?.message ?? "Meta rechazó el evento", meta }, 200);
    }
    // events_received >= 1 → Meta lo aceptó.
    return json({ ok: true, received: meta.events_received ?? 0, meta }, 200);
  } catch (e) {
    return json({ ok: false, error: String((e as any)?.message ?? e) }, 200);
  }
});
