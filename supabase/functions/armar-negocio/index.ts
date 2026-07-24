// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: armar-negocio  (AUTENTICADA — verify_jwt=true)
//   Asistente "Armar con IA" (capa Crea) para el CONOCIMIENTO DEL NEGOCIO.
//   Del brief del dueño arma el borrador (identidad, qué vende, público,
//   propuesta, horario, políticas, tono, FAQ) sin inventar datos duros. NO
//   guarda: el panel aplica el borrador y el dueño revisa + Guarda. Usa el
//   proveedor de IA activo del canal.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userOwnsChannel } from "../_shared/db.ts";
import { armarNegocio } from "../_shared/engine.ts";

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

  let body: { channel_id?: string; brief?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!body.channel_id || !body.brief || !String(body.brief).trim()) return json({ error: "faltan_datos" }, 400);
  if (!(await userOwnsChannel(db, uid, body.channel_id))) return json({ error: "forbidden_channel" }, 403);

  try {
    const draft = await armarNegocio(db, body.channel_id, String(body.brief).trim());
    return json({ ok: true, draft });
  } catch (e) {
    return json({ error: String((e as any)?.message ?? e) }, 500);
  }
});
