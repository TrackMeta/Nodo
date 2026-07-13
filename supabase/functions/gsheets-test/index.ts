// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: gsheets-test  (AUTENTICADA — verify_jwt=true)
//   Escribe una fila de PRUEBA en la app web de Apps Script del usuario.
//   Se hace desde el servidor porque el navegador no puede (CORS de Google).
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/db.ts";

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

  let body: { webhook_url?: string; tab?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const url = body.webhook_url?.trim();
  if (!url || !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(url)) {
    return json({ error: "url_invalida", detalle: "La URL debe ser una app web de Apps Script (/exec)" }, 400);
  }

  const fecha = new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" }).format(new Date());
  try {
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hoja: body.tab || undefined, fila: { Prueba: "Nodo ✓", Fecha: fecha } }),
    });
    const txt = await res.text();
    if (!res.ok) return json({ ok: false, detalle: `HTTP ${res.status}: ${txt.slice(0, 200)}` });
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, detalle: String((e as any)?.message ?? e) });
  }
});
