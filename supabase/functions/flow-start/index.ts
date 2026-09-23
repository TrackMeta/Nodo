// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: flow-start  (AUTENTICADA — verify_jwt=true)
//   Inicia manualmente un flujo sobre un contacto real desde la Bandeja
//   ("enviar flujo"). Reactiva el bot y arranca el flujo (aunque esté en
//   borrador), cancelando cualquier run activo previo.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userOwnsChannel } from "../_shared/db.ts";
import { startFlowRun, runEngine, ventana24hAbierta, type EngineEvent } from "../_shared/engine.ts";

const db = serviceClient();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // ── Auth: miembro activo ──
  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userRes } = await userClient(authHeader).auth.getUser();
  const uid = userRes?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);
  const { data: member } = await db
    .from("app_users").select("id").eq("id", uid).eq("activo", true).maybeSingle();
  if (!member) return json({ error: "not_member" }, 403);

  // ── Body ──
  let body: { channel_id?: string; contact_id?: string; flow_id?: string; reanudar?: boolean };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const { channel_id, contact_id, flow_id } = body;

  // ── Reactivar el bot y CONTESTAR lo pendiente ──
  // Prender el bot desde la Bandeja solo cambiaba el flag: lo que el cliente escribió mientras
  // estaba en pausa se quedaba sin respuesta hasta que volviera a escribir. Ahora se juntan los
  // mensajes suyos posteriores a la ÚLTIMA respuesta (del bot o tuya) y el motor los contesta
  // como si recién llegaran. Si ya le contestaste tú después, no hay nada pendiente.
  if (body.reanudar === true) {
    if (!channel_id || !contact_id) return json({ error: "faltan_campos" }, 400);
    if (!(await userOwnsChannel(db, uid, channel_id))) return json({ error: "forbidden_channel" }, 403);
    const { data: ct } = await db.from("contacts").select("id, bloqueado").eq("id", contact_id).eq("channel_id", channel_id).maybeSingle();
    if (!ct) return json({ error: "contacto_invalido" }, 400);
    if ((ct as any).bloqueado === true) return json({ error: "contacto_bloqueado" }, 400);
    await db.from("contacts").update({ bot_activo: true }).eq("id", contact_id);
    await db.from("conversations").update({ requiere_humano: false }).eq("contact_id", contact_id).then(() => {}, () => {});

    const { data: ultOut } = await db.from("messages").select("ts").eq("contact_id", contact_id).eq("direction", "out")
      .order("ts", { ascending: false }).limit(1).maybeSingle();
    let q = db.from("messages").select("type, content, ts").eq("contact_id", contact_id).eq("direction", "in")
      .not("type", "in", "(system,sticker)");
    if ((ultOut as any)?.ts) q = q.gt("ts", (ultOut as any).ts);
    const { data: pend } = await q.order("ts", { ascending: true }).limit(10);
    const lista = (pend ?? []) as any[];
    if (!lista.length) return json({ ok: true, pendientes: 0 });
    // Texto libre fuera de las 24 h lo rechaza Meta: no se intenta (el panel ofrece plantilla).
    if (!(await ventana24hAbierta(db, contact_id))) return json({ ok: true, pendientes: lista.length, ventana: false });

    const ultimo = lista[lista.length - 1];
    const textos = lista.map((m) => String(m.content?.text ?? m.content?.caption ?? "").trim())
      .filter((t) => t && !/^\[(image|audio|video|document|location|sticker)\]$/i.test(t));
    const tipo = String(ultimo.type);
    const media = ultimo.content?.media_id ? `wa-media:${ultimo.content.media_id}` : (ultimo.content?.media_url || ultimo.content?.url || undefined);
    const event: EngineEvent = (tipo === "image" || tipo === "audio") && media
      ? { type: "message", text: textos.join("\n") || `[${tipo}]`, msgType: tipo, mediaRef: media, msgTs: ultimo.ts }
      : { type: "message", text: textos.join("\n"), msgType: tipo === "text" ? "text" : tipo, msgTs: ultimo.ts };
    if (!String(event.text ?? "").trim() && !(event as any).mediaRef) return json({ ok: true, pendientes: 0 });
    try {
      await runEngine(db, channel_id, contact_id, event);
      return json({ ok: true, pendientes: lista.length, respondido: true });
    } catch (e) {
      console.error("[flow-start] reanudar:", (e as any)?.message ?? e);
      return json({ error: "engine_error", detalle: String((e as any)?.message ?? e) }, 500);
    }
  }

  if (!channel_id || !contact_id || !flow_id) return json({ error: "faltan_campos" }, 400);
  if (!(await userOwnsChannel(db, uid, channel_id))) return json({ error: "forbidden_channel" }, 403);

  // Validar que el flujo pertenece al canal.
  const { data: flow } = await db
    .from("flows").select("id, channel_id, nombre").eq("id", flow_id).maybeSingle();
  if (!flow || flow.channel_id !== channel_id) return json({ error: "flujo_invalido" }, 400);
  // …y que el CONTACTO también: sin esto un miembro del tenant A podría prender el bot y
  // arrancar un flujo sobre un contacto del tenant B (corre con service_role, salta RLS).
  const { data: okContact } = await db.from("contacts").select("id, bloqueado").eq("id", contact_id).eq("channel_id", channel_id).maybeSingle();
  if (!okContact) return json({ error: "contacto_invalido" }, 400);
  // Bloqueado: no se le reactiva el bot en silencio (quedaba bloqueado:true + bot_activo:true).
  if ((okContact as any).bloqueado === true) return json({ error: "contacto_bloqueado", detalle: "Este contacto está bloqueado. Desbloquéalo primero si quieres enviarle un flujo." }, 400);

  // Reactivar el bot (el flujo lo gestiona) y arrancar.
  await db.from("contacts").update({ bot_activo: true }).eq("id", contact_id);
  try {
    const ok = await startFlowRun(db, channel_id, contact_id, flow_id, { force: true });
    if (!ok) return json({ error: "no_iniciado", detalle: "No se pudo iniciar el flujo" }, 400);
    return json({ ok: true });
  } catch (e) {
    console.error("[flow-start] error:", (e as any)?.message ?? e);
    return json({ error: "engine_error", detalle: String((e as any)?.message ?? e) }, 500);
  }
});
