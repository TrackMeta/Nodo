// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: asesor-ia  (AUTENTICADA — verify_jwt=true)
//   Asesor IA (capas Mide + Aconseja). Recibe un resumen de los números
//   REALES del negocio (que arma el panel) y devuelve recomendaciones
//   priorizadas y accionables. La IA razona sobre esos números — no los
//   inventa — y solo PROPONE (no ejecuta). Usa el proveedor activo del canal.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userOwnsChannel } from "../_shared/db.ts";
import { asesorIa } from "../_shared/engine.ts";

const db = serviceClient();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const { data: u } = await userClient(auth).auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);
  const { data: member } = await db.from("app_users").select("id").eq("id", uid).eq("activo", true).maybeSingle();
  if (!member) return json({ error: "not_member" }, 403);

  let body: { channel_id?: string; resumen?: unknown };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!body.channel_id) return json({ error: "faltan_datos" }, 400);
  if (!(await userOwnsChannel(db, uid, body.channel_id))) return json({ error: "forbidden_channel" }, 403);

  try {
    const out = await asesorIa(db, body.channel_id, body.resumen ?? {});
    return json({ ok: true, ...out });
  } catch (e) {
    return json({ error: String((e as any)?.message ?? e) }, 500);
  }
});
