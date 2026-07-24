// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: opera-parse  (AUTENTICADA — verify_jwt=true)
//   Opera (copiloto que ejecuta). Recibe un comando en lenguaje natural,
//   la IA lo interpreta y el motor lo resuelve/valida a UNA acción concreta
//   (precio / estado_venta / adelanto). NO ejecuta nada: solo devuelve la
//   acción validada + un resumen para que el panel confirme y ejecute (con
//   RLS) y ofrezca deshacer. Usa el proveedor de IA activo del canal.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userOwnsChannel } from "../_shared/db.ts";
import { operaParse } from "../_shared/engine.ts";

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

  let body: { channel_id?: string; comando?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!body.channel_id || !body.comando || !String(body.comando).trim()) return json({ error: "faltan_datos" }, 400);
  if (!(await userOwnsChannel(db, uid, body.channel_id))) return json({ error: "forbidden_channel" }, 403);

  try {
    const action = await operaParse(db, body.channel_id, String(body.comando).trim());
    return json({ ok: true, action });
  } catch (e) {
    return json({ error: String((e as any)?.message ?? e) }, 500);
  }
});
