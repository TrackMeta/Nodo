// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: capi-test  (AUTENTICADA — miembro del panel)
//   Manda UN evento de prueba a Meta con el pixel_id + token CAPI del
//   canal, para verificar la conexión sin hacer una venta real. Si se
//   pasa un test_event_code (Events Manager → Probar eventos), el evento
//   aparece ahí en vivo. No toca capi_events ni las métricas reales.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, getChannelSecrets, userOwnsChannel } from "../_shared/db.ts";
import { sha256Hex } from "../_shared/crypto.ts";
import { fetchConTimeout } from "../_shared/http.ts";

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
  if (!(await userOwnsChannel(db, uid, body.channel_id))) return json({ error: "forbidden_channel" }, 403);

  const { data: channel } = await db.from("channels")
    .select("pixel_id, waba_id").eq("id", body.channel_id).maybeSingle();
  if (!channel?.pixel_id) return json({ ok: false, error: "Falta el Pixel ID. Cárgalo y guarda antes de probar." }, 200);

  const secrets = await getChannelSecrets(db, body.channel_id);
  const capiToken = secrets?.capi_token;
  if (!capiToken) return json({ ok: false, error: "Falta el token CAPI. Cárgalo y guarda antes de probar." }, 200);

  // EXIGIR el código de prueba: sin él, este Lead de prueba entra como CONVERSIÓN REAL en la data
  // del pixel (Meta la cuenta y la usa para optimización/audiencias) — el comentario "no toca las
  // métricas reales" era falso del lado de Meta. Con el código, el evento cae en Events Manager →
  // Probar eventos y no ensucia nada. Se obliga para que "Probar" NUNCA contamine el pixel real.
  // …pero negarse a secas dejaba al dueño sin forma de saber si sus credenciales sirven: pegaba
  // el Pixel y el token, tocaba el botón, y lo único que recibía era una orden. Así que sin
  // código se hace la comprobación que NO ensucia nada: preguntarle a Meta por ese pixel CON ese
  // token. Si Meta contesta, el par pixel+token es bueno y el dueño ya lo sabe sin ir a ningún
  // lado; el evento de prueba queda para cuando quiera verlo llegar en vivo.
  // 🔴 Probé comprobar el par pixel+token SIN mandar evento (un GET al pixel con el token) y
  // Meta contesta «(#100) Missing Permission»: un token CAPI nace solo para ESCRIBIR eventos
  // en su pixel, no para leerlo. No hay ensayo en seco. Así que el código de prueba es
  // obligatorio de verdad, y lo único honesto es decir dónde sacarlo.
  const code = String(body.test_event_code ?? "").trim();
  if (!code) {
    return json({
      ok: false,
      error: "Falta el código de prueba. En Meta: Events Manager → tu pixel → pestaña «Probar eventos» → copia el código que empieza con TEST y pégalo acá. " +
        "Es obligatorio porque sin él este evento entraría como una conversión REAL en tu pixel, y Meta la contaría para optimizar tus campañas.",
    }, 200);
  }

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
      // 🔴 El mismo campo que manda el evento REAL (capi.ts). Si la prueba no lo lleva, puede
      // pasar verde mientras las ventas de verdad se mandan mal: un banco de pruebas que no
      // imita a lo que prueba no prueba nada.
      ...(channel.waba_id ? { whatsapp_business_account_id: String(channel.waba_id) } : {}),
    },
  };
  const payload: Record<string, unknown> = { data: [evt], access_token: capiToken, test_event_code: code };

  try {
    const res = await fetchConTimeout(`https://graph.facebook.com/${GRAPH_VERSION}/${channel.pixel_id}/events`, {
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
