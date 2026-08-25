// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: gsheets-callback  (PÚBLICA — verify_jwt=false)
//   Google redirige aquí tras el consentimiento. Canjea el code por el
//   refresh_token, lo guarda en Vault por canal y vuelve al panel.
//   Seguridad: el `state` (nonce) se validó al iniciar (gsheets-connect).
// ═══════════════════════════════════════════════════════════════════
import { serviceClient } from "../_shared/db.ts";

const db = serviceClient();
const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";
const REDIRECT = "https://ahoxdyffbwjlshmdezwi.supabase.co/functions/v1/gsheets-callback";
const PANEL = "https://trackmeta.github.io/Nodo/panel/config.html";

function back(status: string) {
  return new Response(null, { status: 302, headers: { Location: `${PANEL}?gs=${status}` } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code || !state) return back("error");

  const { data: st } = await db.from("gsheets_oauth_state").select("channel_id, created_at").eq("nonce", state).maybeSingle();
  if (!st) return back("expirado");
  await db.from("gsheets_oauth_state").delete().eq("nonce", state);
  // El `state` es de un solo uso Y ahora también CADUCA. Sin esto, uno generado y nunca
  // usado seguía siendo válido para siempre: es la pieza que protege de que a alguien le
  // cuelen la conexión de OTRA cuenta de Google en su canal, y una ventana infinita es
  // justo lo que no debe tener. 10 minutos sobra para autorizar en Google.
  {
    const nacido = new Date((st as any).created_at ?? 0).getTime();
    if (!nacido || Date.now() - nacido > 10 * 60 * 1000) return back("expirado");
  }
  // Barrido de los que quedaron colgados (el usuario abrió el consentimiento y no terminó).
  await db.from("gsheets_oauth_state").delete()
    .lt("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString()).then(() => {}, () => {});

  try {
    const tokRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT, grant_type: "authorization_code",
      }),
    });
    const tok = await tokRes.json();
    // Se loguea SOLO el motivo, no la respuesta entera: ese objeto es la respuesta del
    // endpoint de tokens de Google y no tiene por qué acabar en los logs por completo.
    if (!tokRes.ok) {
      console.error("[gsheets-callback] token:", tokRes.status, (tok as any)?.error ?? "", (tok as any)?.error_description ?? "");
      return back("error");
    }
    // refresh_token solo viene si pedimos prompt=consent + access_type=offline.
    if (!tok.refresh_token) return back("sin_refresh");

    let email: string | null = null;
    try {
      const ui = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } });
      email = (await ui.json())?.email ?? null;
    } catch { /* opcional */ }

    await db.rpc("set_gsheets_token", { p_channel_id: (st as any).channel_id, p_refresh_token: tok.refresh_token, p_email: email });
    // Marcar el modo OAuth en channels.gsheets (conservando spreadsheet si ya existía).
    const { data: ch } = await db.from("channels").select("gsheets").eq("id", (st as any).channel_id).maybeSingle();
    const g = ((ch as any)?.gsheets ?? {}) as Record<string, unknown>;
    g.connected = true; g.mode = "oauth"; g.google_email = email;
    await db.from("channels").update({ gsheets: g }).eq("id", (st as any).channel_id);
    return back("ok");
  } catch (e) {
    console.error("[gsheets-callback]", e);
    return back("error");
  }
});
