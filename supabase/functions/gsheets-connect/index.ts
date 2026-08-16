// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: gsheets-connect  (AUTENTICADA — verify_jwt=true)
//   Devuelve la URL de "Acceder con Google" para conectar Sheets por OAuth.
//   Crea un nonce (estado) para asegurar el callback.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userOwnsChannel, userIsChannelAdmin } from "../_shared/db.ts";

const db = serviceClient();
const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
const REDIRECT = "https://ahoxdyffbwjlshmdezwi.supabase.co/functions/v1/gsheets-callback";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const { data: u } = await userClient(auth).auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);
  const { data: member } = await db.from("app_users").select("id").eq("id", uid).eq("activo", true).maybeSingle();
  if (!member) return json({ error: "not_member" }, 403);

  let body: { channel_id?: string; disconnect?: boolean };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!body.channel_id) return json({ error: "falta_channel" }, 400);
  if (!(await userOwnsChannel(db, uid, body.channel_id))) return json({ error: "forbidden_channel" }, 403);
  // 🔒 Conectar/desconectar la sync a Google Sheets toca la integración del canal (enlaza una
  // cuenta de Google arbitraria o corta la sincronización) → solo ADMIN de la cuenta, igual que
  // channel-config/ai-config. Antes un operador podía hacerlo (misma clase de hueco).
  if (!(await userIsChannelAdmin(db, uid, body.channel_id))) return json({ error: "forbidden", detalle: "Solo un administrador puede conectar o desconectar Google Sheets." }, 403);

  // Desconectar: borra el refresh token del Vault (no necesita OAuth configurado).
  if (body.disconnect) {
    await db.rpc("delete_gsheets_token", { p_channel_id: body.channel_id });
    // Limpia también el estado en channels.gsheets (que el callback escribe al conectar). Sin
    // esto el panel seguía mostrando "conectado" y syncPedidoSheet entraba por la rama oauth
    // hasta que el token daba null. Se conserva el resto (spreadsheet_id, webhook_url).
    const { data: chG } = await db.from("channels").select("gsheets").eq("id", body.channel_id).maybeSingle();
    const g = ((chG as any)?.gsheets ?? {}) as Record<string, unknown>;
    await db.from("channels").update({ gsheets: { ...g, connected: false, mode: null } }).eq("id", body.channel_id);
    return json({ ok: true });
  }
  if (!CLIENT_ID) return json({ error: "sin_configurar", detalle: "Falta configurar GOOGLE_OAUTH_CLIENT_ID en el servidor" }, 400);

  const nonce = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  await db.from("gsheets_oauth_state").insert({ nonce, channel_id: body.channel_id });
  await db.from("gsheets_oauth_state").delete().lt("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());

  const p = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: "code",
    scope: SCOPE, access_type: "offline", prompt: "consent",
    include_granted_scopes: "true", state: nonce,
  });
  return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}` });
});
