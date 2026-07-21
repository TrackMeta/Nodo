// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: flow-start  (AUTENTICADA — verify_jwt=true)
//   Inicia manualmente un flujo sobre un contacto real desde la Bandeja
//   ("enviar flujo"). Reactiva el bot y arranca el flujo (aunque esté en
//   borrador), cancelando cualquier run activo previo.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userOwnsChannel } from "../_shared/db.ts";
import { startFlowRun } from "../_shared/engine.ts";

const db = serviceClient();

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
  let body: { channel_id?: string; contact_id?: string; flow_id?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const { channel_id, contact_id, flow_id } = body;
  if (!channel_id || !contact_id || !flow_id) return json({ error: "faltan_campos" }, 400);
  if (!(await userOwnsChannel(db, uid, channel_id))) return json({ error: "forbidden_channel" }, 403);

  // Validar que el flujo pertenece al canal.
  const { data: flow } = await db
    .from("flows").select("id, channel_id, nombre").eq("id", flow_id).maybeSingle();
  if (!flow || flow.channel_id !== channel_id) return json({ error: "flujo_invalido" }, 400);

  // Reactivar el bot (el flujo lo gestiona) y arrancar.
  await db.from("contacts").update({ bot_activo: true }).eq("id", contact_id);
  try {
    const ok = await startFlowRun(db, channel_id, contact_id, flow_id, { force: true });
    if (!ok) return json({ error: "no_iniciado", detalle: "No se pudo iniciar el flujo" }, 400);
    return json({ ok: true });
  } catch (e) {
    console.error("[flow-start] error:", (e as any)?.message ?? e);
    return json({ error: "engine_error", detalle: String((e as any)?.message ?? e) }, 500);
  }
});
