// TEMPORAL — driver de simulación multi-contacto (igual que webchat pero con
// wa_id/nombre parametrizables). Auth: miembro + userOwnsChannel. BORRAR después.
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userOwnsChannel, userIsChannelAdmin } from "../_shared/db.ts";
import { runEngine, aplicarStock } from "../_shared/engine.ts";

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

  let body: { channel_id?: string; wa_id?: string; nombre?: string; text?: string; buttonId?: string; reset?: boolean; media?: { kind?: string; url?: string; mime?: string; caption?: string }; ad_id?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const { channel_id, wa_id, nombre, text, buttonId, reset, media, ad_id } = body;
  if (!channel_id || !wa_id) return json({ error: "faltan_campos" }, 400);
  if (!(await userOwnsChannel(db, uid, channel_id))) return json({ error: "forbidden_channel" }, 403);
  // Solo ADMIN del canal: el simulador crea contactos con cualquier wa_id, corre el motor y su
  // `reset` borra pedidos/mensajes de ese contacto — un operador (que por RLS no puede tocar
  // orders/messages) lo usaba como puerta trasera.
  if (!(await userIsChannelAdmin(db, uid, channel_id))) return json({ error: "forbidden", detalle: "Solo un administrador puede usar el simulador" }, 403);
  const mediaKind = media?.url ? (media.kind || "document") : null;

  // 🔒 Nunca pisar un contacto REAL: el upsert por (channel_id, wa_id) convertía en «sim» a un
  // cliente de verdad si el número coincidía → desaparecía del Dashboard/Embudo, el bot dejaba
  // de escribirle por WhatsApp para siempre (ensureDelivery lo trata como prueba) y un `reset`
  // le borraba pedidos y mensajes. El simulador solo puede tocar contactos que él mismo creó.
  {
    const { data: ya } = await db.from("contacts").select("id, source, wa_id").eq("channel_id", channel_id).eq("wa_id", wa_id).maybeSingle();
    if (ya && (ya as any).source !== "sim" && (ya as any).wa_id !== "webchat-test") {
      return json({ error: "contacto_real", detalle: `El número ${wa_id} es un contacto real de este bot: el simulador no puede usarlo. Elige otro wa_id.` }, 409);
    }
  }

  const { data: contact } = await db.from("contacts").upsert({
    channel_id, wa_id, nombre: nombre || wa_id,
    // 🔴 Marca de SIMULADO: `ensureDelivery` solo eximía a «webchat-test» del envío real. Un
    // script de simulación sobre un canal con WhatsApp conectado hacía POST a Graph con estos
    // números (y si uno coincidía con una persona real, le llegaba el bot). Con `source: "sim"`
    // el motor los trata como prueba y nunca sale nada por Meta.
    source: "sim",
    last_input: media?.caption ?? text ?? buttonId ?? (mediaKind ? `[${mediaKind}]` : ""),
    last_input_type: mediaKind ?? (buttonId ? "interactive" : "text"),
    ...(ad_id ? { ad_id } : {}),
    ultimo_mensaje_at: new Date().toISOString(), ultimo_mensaje_cliente_at: new Date().toISOString(),
  }, { onConflict: "channel_id,wa_id" }).select("id,bot_activo,bloqueado").single();
  const contactId = contact!.id;

  await db.from("conversations").upsert({
    channel_id, contact_id: contactId, window_type: "service_24h", archivada: false,   // igual que el webhook: un mensaje del cliente la reabre
    expira_at: new Date(Date.now() + 3650 * 24 * 3600 * 1000).toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: "contact_id" });

  if (reset) {
    // Devolver el stock reservado antes del DELETE (el borrado directo no lo repone; ver webchat).
    try {
      const { data: ords } = await db.from("orders").select("shipping").eq("contact_id", contactId);
      for (const o of (ords ?? [])) {
        const sh = ((o as any)?.shipping ?? {}) as any;
        if (sh.stock_descontado && !sh.stock_devuelto && Array.isArray(sh.stock_mov) && sh.stock_mov.length) {
          await aplicarStock(db, sh.stock_mov, 1).catch(() => {});
        }
      }
    } catch (_) { /* best-effort */ }
    // 🔓 Soltar las operaciones de pago reclamadas por este contacto (candado anti-reúso de
    // comprobantes): igual que el webchat. Sin esto, un Yape sintético servía UNA sola vez.
    try {
      const { data: ords2 } = await db.from("orders").select("id").eq("contact_id", contactId);
      const ids = (ords2 ?? []).map((o: any) => o.id);
      await db.from("payment_operations").delete().eq("channel_id", channel_id).eq("contact_id", contactId);
      if (ids.length) await db.from("payment_operations").delete().eq("channel_id", channel_id).is("contact_id", null).in("order_id", ids);
    } catch (_) { /* best-effort */ }
    await Promise.all([
      db.from("messages").delete().eq("contact_id", contactId),
      db.from("flow_runs").delete().eq("contact_id", contactId),
      db.from("sequence_subscriptions").delete().eq("contact_id", contactId),
      db.from("contact_events").delete().eq("contact_id", contactId),
      db.from("contact_tags").delete().eq("contact_id", contactId),
      db.from("contact_field_values").delete().eq("contact_id", contactId),
      db.from("orders").delete().eq("contact_id", contactId),
    ]);
    // `angulo`, `oferta_activa` y `ultima_imagen_at` también se limpian: el ángulo sellado y la
    // oferta de remarketing de una prueba anterior contaminaban la siguiente (gancho y precio).
    await db.from("contacts").update({ angulo: null, oferta_activa: null, ultima_imagen_at: null, bloqueado: false }).eq("id", contactId).then(() => {}, () => {});
    await db.from("contacts").update({ stage: "nuevo", bot_activo: true, product_id: null, ctwa_clid: null, source: "sim", last_input: null, last_input_type: null, consecutive_failed_reply: 0, memoria_ia: {}, primera_interaccion: new Date().toISOString(), ultimo_mensaje_at: new Date().toISOString(), ultimo_mensaje_cliente_at: null }).eq("id", contactId);
    return json({ ok: true, reset: true, contact_id: contactId });
  }

  const content = mediaKind ? { media_url: media!.url, caption: media?.caption ?? "", mime: media?.mime ?? "" } : (buttonId ? { id: buttonId, title: body.text ?? buttonId } : { text: text ?? "" });
  const { data: msgRow } = await db.from("messages").insert({ channel_id, contact_id: contactId, direction: "in", type: mediaKind ?? (buttonId ? "interactive" : "text"), content, status: "delivered" }).select("id, ts").single();
  if ((contact as any)?.bloqueado === true) return json({ ok: true, contact_id: contactId, bloqueado: true });   // igual que el webhook: bloqueado = sin motor
  if (contact!.bot_activo === false) return json({ ok: true, contact_id: contactId, paused: true });

  try {
    // `msgTs` como el webhook: sin él, el sello anti-doble-respuesta no actúa en las regresiones.
    const msgTs = String((msgRow as any)?.ts ?? new Date().toISOString());
    const event = buttonId ? { type: "button" as const, buttonId, title: text ?? buttonId }
      : { type: "message" as const, text: media?.caption ?? text ?? "", msgType: mediaKind ?? "text", msgTs, mediaRef: (mediaKind === "image" || mediaKind === "audio") ? media!.url : undefined };
    await runEngine(db, channel_id, contactId, event);
  } catch (e) { console.error("[tmp-sim] engine error:", e); return json({ error: "engine_error", detalle: String(e) }, 500); }
  return json({ ok: true, contact_id: contactId });
});
