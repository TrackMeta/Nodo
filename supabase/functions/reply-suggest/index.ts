// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: reply-suggest  (AUTENTICADA — verify_jwt=true)
//   El botón "IA" del compositor (Bandeja / Probar flujos). Devuelve 3
//   sugerencias de respuesta para el ASESOR HUMANO, con la personalidad del
//   Vendedor IA, mirando toda la conversación + conocimiento + estado del
//   pedido. NO envía nada: el asesor toca una y se escribe en la barra.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/db.ts";
import { sugerirRespuestas } from "../_shared/engine.ts";

const db = serviceClient();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Solo un miembro activo del panel (mismo patrón que order-update).
  const auth = req.headers.get("Authorization") ?? "";
  const { data: u } = await userClient(auth).auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);
  const { data: member } = await db.from("app_users").select("id").eq("id", uid).eq("activo", true).maybeSingle();
  if (!member) return json({ error: "not_member" }, 403);

  let body: { channel_id?: string; contact_id?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!body.channel_id || !body.contact_id) return json({ error: "faltan_datos" }, 400);

  try {
    const sugerencias = await sugerirRespuestas(db, body.channel_id, body.contact_id);
    return json({ ok: true, sugerencias });
  } catch (e) {
    return json({ error: String((e as any)?.message ?? e) }, 500);
  }
});
