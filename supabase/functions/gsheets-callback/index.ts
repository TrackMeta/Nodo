// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: gsheets-callback  (PÚBLICA — verify_jwt=false)
//   Google redirige aquí tras el consentimiento. Canjea el code por el
//   refresh_token, lo guarda en Vault por canal y vuelve al panel.
//   Seguridad: el `state` (nonce) se validó al iniciar (gsheets-connect).
// ═══════════════════════════════════════════════════════════════════
import { serviceClient, userIsChannelAdmin } from "../_shared/db.ts";
import { fetchConTimeout } from "../_shared/http.ts";

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

  // Leer y borrar en UNA sentencia (DELETE … RETURNING): con select + delete por separado, dos
  // callbacks con el mismo `state` que llegaran juntos lo veían vivo los dos. Así lo usa uno solo.
  // `user_id` (0118) es quien inició la conexión; sin la columna todavía, se lee como antes.
  let rSt: any = await db.from("gsheets_oauth_state").delete().eq("nonce", state)
    .select("channel_id, created_at, user_id");
  if (rSt.error && /user_id/.test(String(rSt.error.message))) {
    rSt = await db.from("gsheets_oauth_state").delete().eq("nonce", state).select("channel_id, created_at");
  }
  const st = ((rSt.data ?? []) as any[])[0];
  if (rSt.error || !st) return back("expirado");
  // El `state` es de un solo uso Y ahora también CADUCA. Sin esto, uno generado y nunca
  // usado seguía siendo válido para siempre: es la pieza que protege de que a alguien le
  // cuelen la conexión de OTRA cuenta de Google en su canal, y una ventana infinita es
  // justo lo que no debe tener. 10 minutos sobra para autorizar en Google.
  {
    const nacido = new Date((st as any).created_at ?? 0).getTime();
    if (!nacido || Date.now() - nacido > 10 * 60 * 1000) return back("expirado");
  }
  // Quien inició la conexión (0118) tiene que SEGUIR siendo admin del canal: si en esos minutos
  // le quitaron el rol, su `state` ya no sirve. Un nonce sin usuario (anterior a 0118) pasa
  // como antes, con su TTL de 10 minutos.
  const quien: string | null = (st as any).user_id ?? null;
  if (quien && !(await userIsChannelAdmin(db, quien, (st as any).channel_id))) return back("error");
  // Barrido de los que quedaron colgados (el usuario abrió el consentimiento y no terminó).
  await db.from("gsheets_oauth_state").delete()
    .lt("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString()).then(() => {}, () => {});

  try {
    const tokRes = await fetchConTimeout("https://oauth2.googleapis.com/token", {
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
      const ui = await fetchConTimeout("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } });
      email = (await ui.json())?.email ?? null;
    } catch { /* opcional */ }

    // 🔒 NO se conecta acá: el permiso queda PENDIENTE (0120) hasta que lo confirme, desde el
    // panel, el MISMO usuario de Nodo que inició la conexión (gsheets-connect → `confirmar`).
    // Sin este paso, un admin podía mandarle a un tercero el enlace de Google y, si aceptaba,
    // el permiso sobre TODAS las hojas de ese tercero quedaba en el canal del admin. El código
    // `gc` va SOLO en esta redirección, o sea al navegador que volvió de Google: el tercero lo
    // tiene pero no la sesión del admin; el admin tiene la sesión pero no el código.
    const gc = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(gc)))]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    const { error: ePend } = await db.from("gsheets_oauth_state").insert({
      nonce: "pend:" + crypto.randomUUID(), channel_id: (st as any).channel_id, user_id: quien,
      pendiente_refresh: tok.refresh_token, pendiente_email: email, confirm_hash: hash,
    });
    if (ePend) { console.error("[gsheets-callback] guardar pendiente:", ePend.message); return back("sin_guardar"); }
    return new Response(null, { status: 302, headers: { Location: `${PANEL}?gs=confirmar&gc=${gc}` } });
  } catch (e) {
    console.error("[gsheets-callback]", e);
    return back("error");
  }
});
