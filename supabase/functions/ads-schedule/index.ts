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
  const { data: member } = await db.from("app_users").select("id, platform_admin").eq("id", uid).eq("activo", true).maybeSingle();
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
    // 🔒 El cron de ads-sync es GLOBAL de la plataforma (una corrida procesa TODOS los
    // canales de TODOS los tenants), así que su frecuencia NO es por-negocio: solo un
    // platform_admin de Nodo puede cambiarla/apagarla. Antes cualquier miembro activo de
    // cualquier cuenta podía mandar {action:"set",freq:"off"} y apagar el cron de toda la
    // plataforma → el gasto de Meta dejaba de bajar para TODOS (fuga cross-tenant de infra).
    if (!(member as any).platform_admin) return json({ error: "forbidden", detalle: "Solo un administrador de la plataforma puede cambiar la frecuencia del cron global de Meta." }, 403);
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

  // ▶️ Forzar una corrida AHORA. El panel prometía este botón («puedes forzarlo desde
  // Rendimiento») y no existía: el dueño que acababa de conectar su cuenta tenía que esperar
  // a la próxima corrida del cron para saber si había quedado bien — y si estaba mal, se
  // enteraba una hora tarde. Esta función ya tiene el SCHEDULER_SECRET en su env, así que es
  // el único sitio desde donde se puede disparar sin exponerlo al navegador.
  // No lo limitamos a platform_admin (a diferencia de `set`): esto no cambia nada global,
  // solo adelanta trabajo que el cron iba a hacer igual.
  if (action === "run") {
    const secret = Deno.env.get("SCHEDULER_SECRET") ?? "";
    if (!secret) return json({ error: "sin_scheduler_secret" }, 500);
    // ⏱️ Freno: una corrida procesa TODOS los tenants y pega contra la API de Meta por cada
    // cuenta. Sin esto, un doble clic (o alguien machacando el botón) dispara ese trabajo
    // entero varias veces y acerca el límite de peticiones de Meta para todos. Si algo se
    // bajó hace menos de un minuto, no se vuelve a correr: no hay nada nuevo que traer.
    const { data: reciente } = await db.from("channels")
      .select("ads_sync_at").not("ads_sync_at", "is", null)
      .order("ads_sync_at", { ascending: false }).limit(1).maybeSingle();
    const ultima = (reciente as any)?.ads_sync_at ? Date.parse((reciente as any).ads_sync_at) : 0;
    if (ultima && Date.now() - ultima < 60_000) return json({ ok: true, reciente: true });
    try {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ads-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-scheduler-secret": secret },
        body: "{}",
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: "ads_sync", detalle: String((b as any)?.error ?? r.status) }, 400);
      // 🔴 NO se devuelve el resumen de ads-sync: el cron es GLOBAL y su respuesta trae el
      // `channelId` y el `act_…` de TODOS los negocios de la plataforma. Devolverlo tal cual
      // le entregaba a cualquier miembro de cualquier cuenta la lista de canales y cuentas
      // publicitarias ajenas. Solo sale lo que el que apretó el botón necesita: si corrió.
      // Queda dicho: esto dispara trabajo para todos los tenants, así que si algún día hay
      // muchas cuentas conviene limitarlo (una corrida manual cada X minutos).
      return json({ ok: true });
    } catch (e) {
      return json({ error: "ads_sync", detalle: String((e as any)?.message ?? e) }, 400);
    }
  }

  return json({ error: "accion_desconocida" }, 400);
});
