// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: guia-ocr  (AUTENTICADA — verify_jwt=true)
//   Lee una foto de una guía de remisión de Shalom y devuelve el N° de guía,
//   el código y el DNI/nombre del DESTINATARIO. Lo usa "Registrar despacho en
//   lote": el panel sube cada foto, llama acá, y con el DNI empareja la foto
//   con el pedido correcto (auto-rellena guía+código y adjunta la foto).
//   No escribe nada: solo lee. Usa el proveedor de IA activo del canal.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userOwnsChannel } from "../_shared/db.ts";
import { leerGuiaShalom } from "../_shared/engine.ts";

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

  let body: { channel_id?: string; image_url?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!body.channel_id || !body.image_url) return json({ error: "faltan_datos" }, 400);
  if (!(await userOwnsChannel(db, uid, body.channel_id))) return json({ error: "forbidden_channel" }, 403);

  try {
    const guia = await leerGuiaShalom(db, body.channel_id, String(body.image_url));
    return json({ ok: true, guia });
  } catch (e) {
    return json({ error: String((e as any)?.message ?? e) }, 500);
  }
});
