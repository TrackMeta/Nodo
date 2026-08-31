// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: webchat  (AUTENTICADA — verify_jwt=true)
//   Banco de pruebas interno: el panel envía un mensaje "como cliente"
//   a un contacto de prueba → se guarda como entrante → corre el motor.
//   Permite probar flujos SIN un WhatsApp real.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userOwnsChannel } from "../_shared/db.ts";
import { runEngine, startFlowRun, aplicarStock } from "../_shared/engine.ts";

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
  if (!(await userOwnsChannel(db, uid, channel_id))) return json({ error: "forbidden_channel" }, 403);
  const mediaKind = media?.url ? (media.kind || "document") : null;

  // Contacto de prueba del canal.
  const { data: contact } = await db.from("contacts").upsert(
    {
      channel_id, wa_id: TEST_WA_ID, nombre: "Prueba (webchat)",
      last_input: media?.caption ?? text ?? buttonId ?? (mediaKind ? `[${mediaKind}]` : ""),
      last_input_type: mediaKind ?? (buttonId ? "interactive" : "text"),
      ultimo_mensaje_at: new Date().toISOString(),
      ultimo_mensaje_cliente_at: new Date().toISOString(),
    },
    { onConflict: "channel_id,wa_id" },
  ).select("id,bot_activo").single();
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

  // Reiniciar la prueba: BORRÓN Y CUENTA NUEVA. Limpia TODO lo del contacto de
  // prueba (mensajes, runs, secuencias, eventos/timeline, etiquetas, campos y
  // PEDIDOS) y resetea sus datos, para empezar como si fuera un cliente nuevo.
  // Solo aplica al contacto de prueba (wa_id = webchat-test) de este canal.
  // OJO: sin borrar los PEDIDOS y la MEMORIA IA, el contacto seguía siendo
  // "comprador" tras reiniciar → el modo post-venta/recompra lo secuestraba y no
  // se podía volver a probar una venta desde cero. Por eso van acá.
  if (reset) {
    // Devolver el stock RESERVADO de los pedidos de prueba ANTES de borrarlos: el DELETE directo
    // NO dispara la devolución (no hay trigger; el stock vive en products.config.stock y se aplica
    // en JS vía aplicarStock). Sin esto, cada ciclo de prueba con una venta física drenaba
    // permanentemente el stock del producto REAL → agotado falso / alertas de sobreventa / bloqueo
    // de ventas reales. Idempotente por stock_devuelto (igual que la cancelación normal).
    try {
      const { data: ords } = await db.from("orders").select("shipping").eq("contact_id", contactId);
      for (const o of (ords ?? [])) {
        const sh = ((o as any)?.shipping ?? {}) as any;
        if (sh.stock_descontado && !sh.stock_devuelto && Array.isArray(sh.stock_mov) && sh.stock_mov.length) {
          await aplicarStock(db, sh.stock_mov, 1).catch(() => {});
        }
      }
    } catch (_) { /* best-effort: no bloquear el reset */ }
    // 🔓 Soltar las OPERACIONES de pago reclamadas por este contacto de prueba. El candado
    // anti-reúso (payment_operations) es por canal y sobrevivía al reset: la captura de Yape
    // con la que se probaba la validación automática quedaba quemada para siempre, y al
    // reenviarla el motor la marcaba «operación ya usada» → el adelanto caía a validación
    // manual. Se lee exactamente como un fallo del OCR (así se reportó) y no lo era.
    // Solo las de ESTE contacto de prueba: las de clientes reales no se tocan, que es
    // justo lo que el candado existe para proteger. Ver migración 0085.
    try {
      const { data: ops } = await db.from("payment_operations").select("id")
        .eq("channel_id", channel_id).eq("contact_id", contactId);
      if (ops?.length) await db.from("payment_operations").delete().in("id", ops.map((o: any) => o.id));
      // Compat con las operaciones reclamadas ANTES de la 0085 (contact_id vacío): se
      // sueltan por el pedido de prueba al que quedaron colgadas.
      const { data: ords2 } = await db.from("orders").select("id").eq("contact_id", contactId);
      const ids = (ords2 ?? []).map((o: any) => o.id);
      if (ids.length) {
        await db.from("payment_operations").delete()
          .eq("channel_id", channel_id).is("contact_id", null).in("order_id", ids);
      }
    } catch (_) { /* best-effort: no bloquear el reset */ }
    await Promise.all([
      db.from("messages").delete().eq("contact_id", contactId),
      db.from("flow_runs").delete().eq("contact_id", contactId),
      db.from("sequence_subscriptions").delete().eq("contact_id", contactId),
      db.from("contact_events").delete().eq("contact_id", contactId),
      db.from("contact_tags").delete().eq("contact_id", contactId),
      db.from("contact_field_values").delete().eq("contact_id", contactId),
      db.from("orders").delete().eq("contact_id", contactId),
    ]);
    await db.from("contacts").update({
      stage: "nuevo", bot_activo: true, product_id: null, ad_id: null,
      ctwa_clid: null, source: null, last_input: null, last_input_type: null,
      consecutive_failed_reply: 0,
      // memoria_ia es `jsonb NOT NULL default '{}'` (migración 0059): ponerla en
      // `null` viola la constraint y TUMBABA el update entero → la memoria "no se
      // reiniciaba". Se limpia con un objeto VACÍO, no con null.
      memoria_ia: {},
      primera_interaccion: new Date().toISOString(),
      ultimo_mensaje_at: new Date().toISOString(),
      ultimo_mensaje_cliente_at: null,
      ultima_imagen_at: null,
    }).eq("id", contactId);
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

  // Si el bot está en pausa (operador tomó la conversación), NO responder:
  // guarda el mensaje entrante pero no corre el motor. Igual que el webhook.
  if (contact!.bot_activo === false) {
    return json({ ok: true, contact_id: contactId, paused: true });
  }

  // Correr el motor.
  try {
    const event = buttonId
      // `title` importa: si nadie espera este botón, el motor lo convierte en un
      // mensaje de texto con el título (el atajo "escribe por el cliente").
      ? { type: "button" as const, buttonId, title: text ?? buttonId }
      : {
        type: "message" as const, text: media?.caption ?? text ?? "", msgType: mediaKind ?? "text",
        // Media de prueba (URL pública de Storage): imagen → OCR, audio → STT.
        mediaRef: (mediaKind === "image" || mediaKind === "audio") ? media!.url : undefined,
      };
    await runEngine(db, channel_id, contactId, event);
  } catch (e) {
    console.error("[webchat] engine error:", e);
    return json({ error: "engine_error", detalle: String(e) }, 500);
  }
  return json({ ok: true, contact_id: contactId });
});
