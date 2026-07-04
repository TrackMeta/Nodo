// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: webchat  (AUTENTICADA — verify_jwt=true)
//   Banco de pruebas interno: el panel envía un mensaje "como cliente"
//   a un contacto de prueba → se guarda como entrante → corre el motor.
//   Permite probar flujos SIN un WhatsApp real.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/db.ts";
import { runEngine, startFlowRun } from "../_shared/engine.ts";

const db = serviceClient();
const TEST_WA_ID = "webchat-test";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Solo miembros.
  const auth = req.headers.get("Authorization") ?? "";
  const { data: u } = await userClient(auth).auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);
  const { data: member } = await db.from("app_users").select("id").eq("id", uid).eq("activo", true).maybeSingle();
  if (!member) return json({ error: "not_member" }, 403);

  let body: {
    channel_id?: string; text?: string; buttonId?: string; reset?: boolean; flow_id?: string;
    media?: { kind?: string; url?: string; mime?: string; caption?: string };
  };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const { channel_id, text, buttonId, reset, media, flow_id } = body;
  if (!channel_id) return json({ error: "falta_channel" }, 400);
  const mediaKind = media?.url ? (media.kind || "document") : null;

  // Contacto de prueba del canal.
  const { data: contact } = await db.from("contacts").upsert(
    {
      channel_id, wa_id: TEST_WA_ID, nombre: "🧪 Prueba (webchat)",
      last_input: media?.caption ?? text ?? buttonId ?? (mediaKind ? `[${mediaKind}]` : ""),
      last_input_type: mediaKind ?? (buttonId ? "interactive" : "text"),
      ultimo_mensaje_at: new Date().toISOString(),
      ultimo_mensaje_cliente_at: new Date().toISOString(),
    },
    { onConflict: "channel_id,wa_id" },
  ).select("id").single();
  const contactId = contact!.id;

  // Ventana siempre abierta para el webchat de pruebas.
  await db.from("conversations").upsert(
    {
      channel_id, contact_id: contactId, window_type: "service_24h",
      expira_at: new Date(Date.now() + 3650 * 24 * 3600 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "contact_id" },
  );

  // Reiniciar la prueba: cancela runs y limpia el hilo.
  if (reset) {
    await db.from("flow_runs").update({ estado: "cancelado" }).eq("contact_id", contactId).in("estado", ["activo", "esperando"]);
    await db.from("messages").delete().eq("contact_id", contactId);
    return json({ ok: true, reset: true, contact_id: contactId });
  }

  // Forzar el arranque de un flujo concreto (selector "Flujo a probar").
  if (flow_id && !text && !buttonId && !mediaKind) {
    try {
      const ok = await startFlowRun(db, channel_id, contactId, flow_id, { force: true });
      if (!ok) return json({ error: "no_se_pudo_iniciar", detalle: "El flujo no tiene nodo inicial" }, 400);
    } catch (e) {
      console.error("[webchat] force flow error:", e);
      return json({ error: "engine_error", detalle: String(e) }, 500);
    }
    return json({ ok: true, contact_id: contactId, started: flow_id });
  }

  // Guardar el mensaje entrante (del "cliente").
  const content = mediaKind
    ? { media_url: media!.url, caption: media?.caption ?? "", mime: media?.mime ?? "" }
    : (buttonId ? { id: buttonId, title: body.text ?? buttonId } : { text: text ?? "" });
  await db.from("messages").insert({
    channel_id, contact_id: contactId, direction: "in",
    type: mediaKind ?? (buttonId ? "interactive" : "text"),
    content, status: "delivered",
  });

  // Correr el motor.
  try {
    const event = buttonId
      ? { type: "button" as const, buttonId }
      : { type: "message" as const, text: media?.caption ?? text ?? "", msgType: mediaKind ?? "text" };
    await runEngine(db, channel_id, contactId, event);
  } catch (e) {
    console.error("[webchat] engine error:", e);
    return json({ error: "engine_error", detalle: String(e) }, 500);
  }
  return json({ ok: true, contact_id: contactId });
});
