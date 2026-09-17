// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: whatsapp-webhook  (PÚBLICA — verify_jwt=false)
//   GET  → verificación de Meta (hub.challenge)
//   POST → recepción de mensajes/estados, validando firma por canal.
// ═══════════════════════════════════════════════════════════════════
import { serviceClient, getChannelSecrets, accountOfChannel } from "../_shared/db.ts";
import { fetchMediaBytes } from "../_shared/meta.ts";
import { transcribeAudio } from "../_shared/ai.ts";
import { verifyMetaSignature } from "../_shared/crypto.ts";
import { runEngine, avisarEnvioFallido, esAlucinacionSTT, esOptOut, aplicarOptOut, type EngineEvent } from "../_shared/engine.ts";

// Runtime de Supabase Edge: permite terminar trabajo DESPUÉS de responder
// (Meta exige un 200 rápido; el motor puede tardar por el LLM).
declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined;

const db = serviceClient();
const MAX_BUFFER_SEG = 20; // tope de seguridad para el debounce configurable

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ── GET: verificación del webhook ────────────────────────────────
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token) {
      const { data } = await db
        .from("channels")
        .select("id")
        .eq("verify_token", token)
        .eq("activo", true)
        .limit(1);
      if (data && data.length > 0) {
        return new Response(challenge ?? "", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // ── POST: recepción ──────────────────────────────────────────────
  const raw = await req.text(); // cuerpo CRUDO (necesario para HMAC)
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Ruteo: por phone_number_id (mensajes) o por WABA id (estado de plantillas,
  // que no trae phone_number_id — llega a nivel de la cuenta de WhatsApp).
  const change0 = payload?.entry?.[0]?.changes?.[0];
  // El canal para validar la firma se busca en TODOS los changes, no solo en el primero: el
  // canal está suscrito también a account_alerts / phone_number_quality_update / security, y
  // si Meta batchea uno de esos como changes[0] y los mensajes como changes[1], el `else`
  // de abajo descartaba el POST completo (200 mudo) y esos mensajes se perdían.
  let phoneNumberId: string | undefined;
  for (const en of (payload?.entry ?? []) as any[]) {
    for (const ch of (en?.changes ?? []) as any[]) {
      const p = ch?.value?.metadata?.phone_number_id;
      if (p) { phoneNumberId = String(p); break; }
    }
    if (phoneNumberId) break;
  }
  const esPlantilla = ((payload?.entry ?? []) as any[]).some((en) => (en?.changes ?? []).some((ch: any) => ch?.field === "message_template_status_update"));
  const wabaId = payload?.entry?.[0]?.id as string | undefined;
  let channel: { id: string; buffer_default_seg?: number } | null = null;
  if (phoneNumberId) {
    ({ data: channel } = await db.from("channels").select("id, buffer_default_seg")
      .eq("phone_number_id", phoneNumberId).eq("activo", true).maybeSingle());
  } else if (esPlantilla && wabaId) {
    // waba_id NO es único (un negocio puede tener 2 números bajo una misma WABA): con
    // maybeSingle() eso REVENTABA (múltiples filas) → channel null → el status de la
    // plantilla se descartaba y nunca se reflejaba. Se toma uno (para la firma) y la
    // actualización se hace sobre TODOS los canales de la WABA en processTemplateStatus.
    ({ data: channel } = await db.from("channels").select("id, buffer_default_seg")
      .eq("waba_id", wabaId).eq("activo", true).order("id").limit(1).maybeSingle());
  } else {
    return new Response("OK", { status: 200 }); // eventos sin mensajes ni plantilla
  }
  if (!channel) return new Response("OK", { status: 200 }); // canal desconocido

  // Validar firma con el App Secret del canal.
  const secrets = await getChannelSecrets(db, channel.id);
  if (!secrets?.app_secret) {
    console.error(`[webhook] canal ${channel.id} sin app_secret`);
    return new Response("Unauthorized", { status: 401 });
  }
  const sig = req.headers.get("x-hub-signature-256");
  const ok = await verifyMetaSignature(raw, sig, secrets.app_secret);
  if (!ok) return new Response("Unauthorized", { status: 401 });

  // Procesar (idempotente por wamid). Si falla, devolvemos 500 y Meta reintenta.
  try {
    await processPayload(channel, payload);
  } catch (e) {
    console.error("[webhook] error procesando:", e);
    return new Response("Server Error", { status: 500 });
  }
  return new Response("OK", { status: 200 });
});

// ── Procesamiento del payload ──────────────────────────────────────
async function processPayload(fallback: { id: string; buffer_default_seg?: number }, payload: any) {
  // El canal se resuelve POR CADA change según su phone_number_id, NO una sola vez
  // desde entry[0]. Meta puede meter varias entries/changes en un mismo POST con
  // distinto número; si un negocio tiene 2 números bajo la misma WABA (mismo
  // app_secret → la firma ya validó), procesarlos todos con el canal de entry[0]
  // cruzaría los mensajes del número 2 al canal 1 (contacto fantasma, el motor del
  // canal 1 responde con su número) y perdería los statuses del número 2.
  const cache = new Map<string, { id: string; buffer_default_seg?: number } | null>();
  async function chanFor(pnid: string | undefined) {
    if (!pnid) return fallback; // sin metadata (p.ej. cambios de plantilla): usa el de entry[0]
    if (cache.has(pnid)) return cache.get(pnid) ?? null;
    const { data } = await db.from("channels").select("id, buffer_default_seg")
      .eq("phone_number_id", pnid).eq("activo", true).maybeSingle();
    cache.set(pnid, data ?? null);
    return data ?? null;
  }
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      // Meta avisó que cambió el estado de una plantilla (aprobada/rechazada/…):
      // se refleja solo en Nodo, sin que el usuario toque "Sincronizar".
      if (change.field === "message_template_status_update") {
        await processTemplateStatus(fallback.id, change.value ?? {}, entry.id);
        continue;
      }
      // Meta recategorizó la plantilla (UTILITY→MARKETING): cambia la tarifa y el trato del
      // opt-out. Se refleja en todos los canales de la WABA.
      if (change.field === "template_category_update") {
        const v = change.value ?? {};
        const name = v.message_template_name, language = v.message_template_language ?? "es";
        const cat = String(v.new_category ?? "").toUpperCase();
        if (name && cat) {
          let ids = [fallback.id];
          try {
            const { data: chs } = await db.from("channels").select("id").eq("waba_id", entry.id).eq("activo", true);
            if (chs?.length) ids = (chs as any[]).map((c) => c.id);
          } catch (_) { /* usa el canal resuelto */ }
          await db.from("wa_templates").update({ categoria: cat }).in("channel_id", ids).eq("name", name).eq("language", language);
        }
        continue;
      }
      const value = change.value ?? {};
      const channel = await chanFor(value?.metadata?.phone_number_id as string | undefined);
      if (!channel) continue; // número desconocido en este POST → no lo cruces a otro canal
      // Remitente. Con "nombres de usuario" de WhatsApp (BSUID), contacts[0]
      // trae user_id (BSUID, siempre), username (@handle) y wa_id (el número,
      // solo si lo comparte). Se pasa todo para keyar bien e identificar al
      // cliente sin número. Ver migración 0062.
      const contactos = (value.contacts ?? []) as any[];
      for (const msg of value.messages ?? []) {
        // El remitente se cruza por `msg.from` contra contacts[] (Meta puede meter mensajes
        // de DOS clientes en el mismo change). Con contacts[0] fijo para todos, el mensaje
        // del cliente B se insertaba en el contacto de A y el bot le respondía a A con la
        // conversación de B. contacts[0] queda solo como respaldo (payloads sin `from`).
        const c0 = (contactos.find((c) => c && (c.wa_id === msg?.from || c.user_id === msg?.from)) ?? (contactos.length === 1 ? contactos[0] : {})) as any;
        const sender = {
          profileName: c0.profile?.name as string | undefined,
          phone: c0.wa_id as string | undefined,
          bsuid: c0.user_id as string | undefined,
          username: c0.username as string | undefined,
        };
        await processInbound(channel, msg, sender);
      }
      for (const st of value.statuses ?? []) {
        await processStatus(channel.id, st);
      }
    }
  }
}

// Refleja en wa_templates el estado que Meta acaba de comunicar por webhook.
// Se cruza por name + language dentro del canal dueño del WABA.
async function processTemplateStatus(channelId: string, value: any, wabaId?: string) {
  const name = value?.message_template_name;
  const language = value?.message_template_language ?? "es";
  const event = String(value?.event || "").toUpperCase();
  if (!name) return;
  const estado = event === "APPROVED" ? "aprobada"
    : (event === "PENDING" || event === "IN_APPEAL" || event === "PENDING_DELETION") ? "pendiente"
    : "rechazada"; // REJECTED, PAUSED, DISABLED, FLAGGED…
  // La plantilla pertenece a la WABA (todos sus números): se refleja en TODOS los canales
  // de esa WABA, no solo en uno. Antes actualizaba un único channel_id → en un negocio con
  // 2 números el otro veía la plantilla "pendiente" para siempre.
  let ids = [channelId];
  if (wabaId) {
    try {
      const { data: chs } = await db.from("channels").select("id").eq("waba_id", wabaId).eq("activo", true);
      if (chs?.length) ids = (chs as any[]).map((c) => c.id);
    } catch (_) { /* usa el canal resuelto */ }
  }
  await db.from("wa_templates").update({ estado_meta: estado })
    .in("channel_id", ids).eq("name", name).eq("language", language);
}

async function processInbound(
  channel: { id: string; buffer_default_seg?: number },
  msg: any,
  sender: { profileName?: string; phone?: string; bsuid?: string; username?: string },
) {
  const channelId = channel.id;
  // Llave del contacto: el NÚMERO cuando el usuario lo comparte (compat con todos
  // los contactos existentes), el BSUID cuando usa username sin número, y msg.from
  // como respaldo legacy. Así los contactos de siempre no se re-keyan.
  let waId: string = sender.phone || sender.bsuid || msg.from;
  const { text, type, content } = extractContent(msg);
  const ref = msg.referral; // Click-to-WhatsApp (oro para atribución)
  // Hora REAL del mensaje según Meta (segundos epoch), con el mismo guard NaN del insert.
  // La ventana de 24 h se sellaba con now(): un webhook que Meta entrega en cola 40 min
  // tarde (pasa tras una caída) "regalaba" 40 min de ventana y a la hora 23:40 el motor
  // mandaba texto libre que Meta rechazaba con 131047. Se toma la menor (Meta vs ahora).
  const tsMetaMs = Number.isFinite(Number(msg.timestamp)) && Number(msg.timestamp) > 0 ? Number(msg.timestamp) * 1000 : Date.now();
  const tsCliente = new Date(Math.min(tsMetaMs, Date.now())).toISOString();
  // Una reacción (👍) no es un mensaje que atender ni (con seguridad) reabre la ventana de
  // servicio: no sella ultimo_mensaje_cliente_at ni pisa last_input (el scheduler, el resume
  // y detectarOpcion leían "[reaction]" como lo último que dijo el cliente).
  const esReaccion = msg.type === "reaction";

  // ── Cita y reenviado (msg.context) ──────────────────────────────────────
  // «Este me llevo» citando la foto del producto de hace dos días: sin la cita, la IA solo
  // veía "este me llevo" y el operador tampoco sabía a qué respondía. Se resuelve el texto
  // citado por wamid (puede ser un mensaje nuestro o suyo) y queda en content.quoted; la
  // Bandeja lo pinta como cita y historial() se lo cuenta a la IA. Un reenviado se marca.
  if (msg.context?.id) {
    const quoted: Record<string, unknown> = { wamid: String(msg.context.id) };
    try {
      const { data: q } = await db.from("messages").select("direction, type, content")
        .eq("wamid", String(msg.context.id)).maybeSingle();
      if (q) {
        const qc = (q as any).content ?? {};
        const qt = String(qc.text ?? qc.caption ?? "").trim() || ((q as any).type && (q as any).type !== "text" ? `[${(q as any).type}]` : "");
        quoted.direction = (q as any).direction;
        quoted.text = qt.slice(0, 240);
        if (qc.media_url) quoted.media_url = qc.media_url;
      }
    } catch (_) { /* la cita es un extra: sin ella el mensaje igual se procesa */ }
    (content as any).quoted = quoted;
  }
  if (msg.context?.forwarded || msg.context?.frequently_forwarded) (content as any).forwarded = true;

  // ── Dedup TEMPRANO por wamid (antes de mutar contacto/conversación) ──────
  // Meta reintenta el MISMO mensaje ante cualquier timeout. Si dejamos que el
  // upsert de abajo corra primero, se re-extiende la ventana FEP (+72h) y se
  // bumpean los timestamps del contacto SIN un mensaje nuevo real. wamid es
  // único global, así que basta con verlo una vez. El guard 23505 del insert
  // queda como respaldo ante carreras. (msg.id siempre viene en mensajes.)
  if (msg.id) {
    try {
      const { data: yaProc } = await db.from("messages")
        .select("id").eq("wamid", msg.id).maybeSingle();
      if (yaProc) return; // ya procesado → no re-mutar nada
    } catch (_) { /* si falla el chequeo, sigue: el insert dedup igual protege */ }
  }

  // ── El cliente CAMBIÓ DE NÚMERO (Meta: type "system" / user_changed_number) ──
  // Antes se tiraba: el contacto seguía keyado al número viejo y el primer mensaje desde
  // el nuevo creaba un contacto VACÍO (historial, pedido en curso, run del flujo y
  // atribución huérfanos; el bot arrancaba la venta desde cero con alguien que ya había
  // pagado el adelanto). Se migra el wa_id si el número nuevo no existe ya en el canal.
  if (msg.type === "system" && /changed_number/i.test(String(msg.system?.type ?? ""))) {
    const nuevo = String(msg.system?.new_wa_id ?? msg.system?.wa_id ?? "").replace(/\D/g, "");
    const viejo = String(msg.from ?? waId ?? "").replace(/\D/g, "");
    if (nuevo && viejo && nuevo !== viejo) {
      try {
        const { data: yaNuevo } = await db.from("contacts").select("id")
          .eq("channel_id", channelId).eq("wa_id", nuevo).maybeSingle();
        if (!yaNuevo) {
          const { data: mov } = await db.from("contacts").update({ wa_id: nuevo })
            .eq("channel_id", channelId).eq("wa_id", viejo).select("id");
          if (mov?.length) console.log(`[webhook] contacto ${(mov[0] as any).id} cambió de número ${viejo} → ${nuevo}`);
        } else {
          console.warn(`[webhook] cambio de número ${viejo} → ${nuevo}: el nuevo ya existe en el canal; no se fusiona`);
        }
      } catch (e) { console.error("[webhook] cambio de número:", (e as any)?.message ?? e); }
      waId = nuevo; // el aviso queda en el contacto (ya renombrado, o el que ya tenía ese número)
    }
  }

  // ── Reconciliación username→número (evita contacto huérfano) ─────────────
  // Un cliente sin número entró keyado por BSUID; cuando por fin comparte su
  // número, waId pasa a ser el número y el upsert onConflict(channel_id,wa_id)
  // crearía una FILA NUEVA, dejando huérfano el historial (chat, pedidos). Si
  // ya existe la fila por BSUID y no hay otra con ese número, migramos su wa_id
  // al número para conservar todo. (Defensivo: si la 0062 no está, no hay
  // columna user_id → el try lo absorbe y no pasa nada.)
  if (sender.bsuid && sender.phone && waId === sender.phone) {
    try {
      const { data: prev } = await db.from("contacts")
        .select("id, wa_id").eq("channel_id", channelId)
        .eq("user_id", sender.bsuid).maybeSingle();
      if (prev && (prev as any).wa_id !== sender.phone) {
        const { data: yaNum } = await db.from("contacts")
          .select("id").eq("channel_id", channelId).eq("wa_id", sender.phone).maybeSingle();
        if (!yaNum) {
          await db.from("contacts").update({ wa_id: sender.phone }).eq("id", (prev as any).id);
        }
      }
    } catch (_) { /* sin columna user_id (0062 pendiente) → sin reconciliación */ }
  }

  // Upsert contacto (captura CTWA solo si viene).
  const patch: Record<string, unknown> = {
    channel_id: channelId,
    wa_id: waId,
    ultimo_mensaje_at: new Date().toISOString(),
  };
  if (!esReaccion) patch.ultimo_mensaje_cliente_at = tsCliente;
  // Los tipos que el motor NO procesa (reacción, tarjeta de contacto, no soportado) no deben
  // quedar como "lo último que dijo el cliente".
  if (type !== "system") { patch.last_input = text; patch.last_input_type = type; }
  // El nombre del perfil de WhatsApp NO va en el upsert: pisaba el que el dueño hubiera
  // puesto a mano. Uno renombra al contacto en el panel para reconocerlo ("Ana · mayorista",
  // o corrige "ana" por su nombre real) y al siguiente mensaje del cliente se revertía solo,
  // en silencio. Mismo criterio que ya usa el panel al crear un contacto repetido: no
  // sobrescribir lo que hay. Se aplica más abajo SOLO si el contacto aún no tiene nombre.
  const nombrePerfil = sender.profileName || null;
  // BSUID / username / número real (migración 0062). `telefono` se setea SOLO
  // cuando el número llega (no se pisa con null): telefono==null ⇒ cliente sin
  // número ⇒ el flujo físico se lo pide. El upsert de abajo es defensivo por si
  // la 0062 aún no se aplicó.
  if (sender.bsuid) patch.user_id = sender.bsuid;
  if (sender.username) patch.username = sender.username;
  if (sender.phone) patch.telefono = sender.phone;
  if (ref) {
    // Solo pisar ad_id/ctwa_clid cuando el referral TRAE valor: un referral posterior sin
    // ctwa_clid (un post/story, o un anuncio sin click-to-WhatsApp) NO debe BORRAR el
    // ctwa_clid del anuncio que sí trajo al cliente → si no, la venta se cierra sin ese id
    // y maybePurchase corta (`if(!ship.ctwa_clid) return null`): Meta nunca recibe el
    // Purchase y ese anuncio parece que no vendió.
    if (ref.source_id) patch.ad_id = ref.source_id;
    if (ref.ctwa_clid) patch.ctwa_clid = ref.ctwa_clid;
    patch.source = ref.source_type ?? "ctwa";
    // Free Entry Point: el mensaje que entra desde un anuncio abre 72h en las que Meta NO
    // cobra los mensajes. Ojo con qué significa eso: NO habilita texto libre —para eso hace
    // falta la ventana de 24h— sino que la PLANTILLA sale gratis. Ver ventana24hAbierta.
    // Un clic nuevo en un anuncio la re-abre.
    // Matiz de la letra chica: Meta abre esa conversación cuando el negocio RESPONDE dentro
    // de las 24h, no por el solo hecho de que el cliente escriba. Acá se marca al recibir
    // porque con el bot activo la respuesta sale en segundos y siempre se cumple; si el bot
    // estuviera apagado y nadie contestara, el panel diría "plantilla gratis" y no lo sería.
    patch.fep_hasta = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  }

  let { data: contact, error: upErr } = await db
    .from("contacts")
    .upsert(patch, { onConflict: "channel_id,wa_id" })
    .select("id, bot_activo, fep_hasta, bloqueado")
    .single();
  if (upErr && /user_id|username|telefono|column/i.test(upErr.message)) {
    // Migración 0062 aún no aplicada → reintenta sin las columnas nuevas.
    const { user_id: _u, username: _n, telefono: _t, ...base } = patch as any;
    ({ data: contact, error: upErr } = await db
      .from("contacts").upsert(base, { onConflict: "channel_id,wa_id" })
      .select("id, bot_activo, fep_hasta, bloqueado").single());
  }
  if (upErr || !contact) throw new Error(`upsert contact: ${upErr?.message ?? "sin contacto"}`);

  // El nombre del perfil de WhatsApp solo se pone si el contacto TODAVÍA no tiene uno: sirve
  // para estrenar el contacto, no para revertir lo que el dueño escribió. Best-effort — si
  // falla, el mensaje se procesa igual (el nombre es lo de menos frente a atender al cliente).
  if (nombrePerfil) {
    await db.from("contacts").update({ nombre: nombrePerfil })
      .eq("id", contact.id).or("nombre.is.null,nombre.eq.").then(() => {}, () => {});
  }

  // Asegurar la conversación y refrescar la ventana ANTES de insertar el
  // mensaje (el trigger de no_leidos necesita la fila). La ventana efectiva
  // de escritura es la MAYOR entre la de servicio (últ. msg + 24h) y la
  // Free Entry Point del contacto, si sigue viva.
  const ahora = Date.now();
  const svc = new Date(tsCliente).getTime() + 24 * 60 * 60 * 1000;
  const fepMs = contact.fep_hasta ? new Date(contact.fep_hasta as string).getTime() : 0;
  const convRow: Record<string, unknown> = {
    channel_id: channelId,
    contact_id: contact.id,
    updated_at: new Date().toISOString(),
    // El cliente volvió a escribir → la conversación sale del archivo (como hace WhatsApp).
    // Antes seguía archivada: oculta en la Bandeja y fuera de los contadores; con el bot en
    // pausa en ese contacto era dead air total sin que nadie lo viera.
    archivada: false,
  };
  if (!esReaccion) {
    convRow.window_type = fepMs > ahora ? "fep_72h" : "service_24h";
    convRow.expira_at = new Date(Math.max(svc, fepMs)).toISOString();
  }
  await db.from("conversations").upsert(convRow, { onConflict: "contact_id" });

  // Insertar mensaje entrante (dedup por wamid; el trigger sube no_leidos).
  const { error: msgErr } = await db.from("messages").insert({
    channel_id: channelId,
    contact_id: contact.id,
    direction: "in",
    type,
    content,
    wamid: msg.id,
    status: "delivered",
    // Guard NaN: si `timestamp` viniera ausente/no numérico, `new Date(NaN).toISOString()`
    // LANZA → 500 → Meta reintenta el MISMO payload para siempre (poison). Cae a ahora.
    ts: new Date(tsMetaMs).toISOString(),
  });
  // 23505 = unique_violation → mensaje repetido (reintento de Meta). No
  // volver a correr el motor: la primera entrega ya lo hizo (idempotencia).
  if (msgErr) {
    if ((msgErr as any).code === "23505") return;
    throw new Error(`insert message: ${msgErr.message}`);
  }

  // 📎 Foto / nota de voz / video / archivo / sticker: el mensaje quedó guardado con solo el
  // `media_id` de Meta, que el panel no puede abrir (hace falta el token del canal). La URL
  // recién la generaba el motor, y solo para la foto que llegaba a un nodo de OCR: con el bot
  // en pausa —o sea, justo cuando un HUMANO está atendiendo— la Bandeja mostraba «[audio]» y
  // «[image]» pelados y el operador no podía ni oír ni ver lo que el cliente mandó. Se
  // archiva SIEMPRE, en segundo plano y aparte del motor. Va ANTES del corte por bot en pausa.
  if (MEDIA_ARCHIVABLE.has(type) && content?.media_id) {
    const t = archivarMediaEntrante(channelId, contact.id, msg.id, type, content, (contact as any).bot_activo === false);
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(t);
    else await t;
  }

  // ── Motor de flujos ────────────────────────────────────────────────
  // Bot pausado para este contacto (humano atendiendo) → no responder.
  // Bloqueado desde el panel: el bot NO responde (antes solo se ocultaba de la Bandeja y el
  // bot le seguía vendiendo a ciegas). El mensaje queda guardado igual.
  if ((contact as any).bloqueado === true) return;
  if ((contact as any).bot_activo === false) {
    // «Ya no me escriban» con un humano atendiendo (bot en pausa): la detección de baja vive
    // en el motor y acá no se corría → nadie marcaba no_remarketing y las secuencias seguían.
    if (type === "text" && text && esOptOut(text)) await aplicarOptOut(db, channelId, contact.id);
    return;
  }

  const adId = ref?.source_id ? String(ref.source_id) : undefined;
  const msgTs = new Date(tsMetaMs).toISOString();
  let event: EngineEvent | null = null;
  let debounce = false;
  if (type === "interactive") {
    // Botón tocado → ruteo determinista inmediato (sin buffer).
    if (content?.id) event = { type: "button", buttonId: String(content.id), title: content.title };
    // Subtipo sin id (Flow / catálogo): antes `event` quedaba null → return → silencio.
    else if (text) event = { type: "message", text, msgType: "text", adId, msgTs };
  } else if (type === "button") {
    // Quick-reply de plantilla: botón con su payload (si el flujo no lo espera, el motor lo
    // convierte en texto con el título, como cualquier botón).
    event = { type: "button", buttonId: String(content?.payload || content?.text || ""), title: content?.text };
  } else if (type === "image" || (type === "document" && /^image\/|^application\/pdf$/i.test(String(content?.mime_type ?? "")) && content?.media_id)) {
    // Imagen (ej. comprobante) → inmediata, con referencia para el nodo IA. También un DOCUMENTO
    // con mime de imagen o PDF: en Perú es común mandar el Yape como archivo/PDF en vez de foto —
    // se trata como "imagen" para que el OCR lo lea (Claude procesa imágenes y PDFs).
    event = { type: "message", text, msgType: "image", mediaRef: `wa-media:${content.media_id}`, adId, msgTs };
  } else if (type === "audio") {
    // Nota de voz → referencia para que el motor la transcriba (STT).
    event = { type: "message", text, msgType: "audio", mediaRef: content.media_id ? `wa-media:${content.media_id}` : undefined, adId, msgTs };
  } else if (type === "text") {
    // Texto → con debounce (junta mensajes seguidos, anti respuesta triple).
    event = { type: "message", text, msgType: "text", adId, msgTs };
    debounce = true;
  } else if (type === "sticker") {
    // Un sticker no lleva texto: iba a la IA como el literal "[sticker]" y salía un segundo
    // saludo sin sentido (medido en vivo el 2026-09-17: 👍 de sticker → «Hola, ¿quieres que te
    // cuente…?» encima de la respuesta anterior). Queda guardado y visible; el bot no contesta.
    return;
  } else if (type === "system") {
    // Reacción (👍) o tipo NO soportado (extractContent → type:"system"): el mensaje ya quedó
    // guardado, pero NO se dispara el bot de ventas. Responder a "[reaction]" es ruido y podría
    // reabrir el buffer/relanzar la conversación. Una reacción no es un mensaje que atender.
    return;
  } else {
    // video/document/location → el flujo decide por last_input_type.
    event = { type: "message", text, msgType: type, adId, msgTs };
  }
  if (!event) return;

  const bufferSeg = Math.min(Math.max(Number(channel.buffer_default_seg ?? 4) || 0, 0), MAX_BUFFER_SEG);
  // 📎 TEXTO seguido de IMAGEN/AUDIO: el texto (con buffer) cede el turno a la imagen (más
  // nueva, sin buffer) y su intento SE PERDÍA (el motor solo veía la foto). Si justo antes
  // llegó texto del cliente dentro de la ventana del buffer, se ANTEPONE al evento de la
  // imagen — así "mándame 2 tallas M y una S" + la foto llegan JUNTOS al motor. Los task de
  // esos textos ceden a la imagen (msgs[0] es la imagen) → no se doble-procesan.
  if ((type === "image" || type === "audio") && bufferSeg > 0) {
    try {
      const desde = new Date(Date.now() - (bufferSeg + 2) * 1000).toISOString();
      const { data: prev } = await db.from("messages")
        .select("content").eq("contact_id", contact.id).eq("direction", "in").eq("type", "text")
        // limit(10) (antes 3): con ≥4 textos seguidos + una imagen, los textos 4º/5º quedaban FUERA
        // del plegado y su propio task cedía a la imagen (msgs[0]) → mensaje del cliente PERDIDO para
        // el motor. La ventana ya está acotada por `desde` (bufferSeg+2s), así que 10 cubre la ráfaga.
        .gte("ts", desde).neq("wamid", msg.id).order("ts", { ascending: true }).limit(10);
      const textos = (prev ?? []).map((m: any) => String(m.content?.text ?? "").trim()).filter(Boolean);
      if (textos.length) {
        const combinado = [...textos, (event as { text?: string }).text].filter((t) => t && String(t).trim()).join("\n");
        event = { ...event, text: combinado };
      }
    } catch (e) { console.error("[webhook] fold texto→imagen:", (e as any)?.message ?? e); }
  }
  const task = runEngineTask(channelId, contact.id, event, msg.id, debounce ? bufferSeg : 0);
  // Responder 200 a Meta ya; el motor sigue en segundo plano.
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(task);
  else await task;
}

// Corre el motor tras el buffer configurable del canal. Si durante la espera
// llegó un mensaje más nuevo, NO hace nada: la invocación de ese mensaje se
// encarga (y une toda la cadena de textos seguidos en un solo evento).
async function runEngineTask(
  channelId: string,
  contactId: string,
  event: EngineEvent,
  wamid: string,
  bufferSeg: number,
) {
  try {
    if (bufferSeg > 0 && event.type === "message") {
      await new Promise((r) => setTimeout(r, bufferSeg * 1000));
      const { data: msgsRaw, error: qErr } = await db.from("messages")
        .select("wamid, ts, type, content")
        .eq("contact_id", contactId).eq("direction", "in")
        // `ts` viene de Meta con granularidad de SEGUNDOS: dos mensajes del MISMO segundo
        // empatan. Sin un desempate, dos `runEngineTask` concurrentes podían ver un `msgs[0]`
        // distinto → o ambos ceden (dead-air) o ambos corren (doble respuesta). `wamid` (único)
        // como 2ª clave hace el orden DETERMINÍSTICO: las dos queries coinciden y solo una corre.
        .order("ts", { ascending: false }).order("wamid", { ascending: false }).limit(10);
      // Si la consulta FALLA (hipo de PostgREST), antes se hacía `return`: Meta ya tenía el 200,
      // no hay reintento, y el cliente se quedaba sin respuesta sin dejar rastro. Ahora se corre
      // el motor con el evento propio (a lo sumo se pierde el plegado de textos seguidos).
      if (qErr) console.error("[webhook] consulta del buffer falló, se responde igual:", qErr.message);
      // Solo participan del protocolo "cede el turno a msgs[0]" los tipos que este camino
      // procesa: texto (con buffer) e imagen/audio (que absorben el texto). Una reacción 👍, una
      // tarjeta de contacto o un no-soportado (tipo 'system', que NUNCA corre el motor) y los
      // inmediatos sin plegado (sticker/video/ubicación) NO deben robarle el turno al texto:
      // "sí, 2 talla M" + 👍 dentro del buffer → msgs[0] era la reacción → el texto cedía →
      // nadie contestaba jamás.
      const msgs = qErr ? null : (msgsRaw ?? []).filter((m: any) => m.type === "text" || m.type === "image" || m.type === "audio");
      if (msgs) {
        if (!msgs.length) return;
        // ¿Sigue siendo el último mensaje del cliente? Si no, cede el turno.
        if ((msgs[0] as any).wamid !== wamid) return;
        // Una IMAGEN/AUDIO corre de inmediato (bufferSeg=0) y ABSORBE los textos previos
        // dentro de su ventana de plegado. No entra en el protocolo de `msgs[0]` (el
        // desempate por wamid solo cubre texto-vs-texto), así que en el MISMO segundo con
        // un wamid desfavorable el texto quedaba como msgs[0] y se procesaba DOS VECES
        // (una plegado en la imagen, otra por su propio task). Si hay una imagen/audio con
        // ts >= el de este texto y dentro de la ventana de plegado, ya lo procesó → cede.
        const selfTs = new Date((msgs.find((m: any) => m.wamid === wamid) as any)?.ts ?? 0).getTime();
        const foldWindow = (bufferSeg + 2) * 1000;
        if (selfTs && msgs.some((m: any) => (m.type === "image" || m.type === "audio") && (() => { const it = new Date(m.ts).getTime(); return it >= selfTs && (it - selfTs) <= foldWindow; })())) return;
        // Unir la cadena de textos con separación ≤ buffer (más reciente hacia
        // atrás) en un solo texto, en orden cronológico.
        const chain: string[] = [];
        for (let i = 0; i < msgs.length; i++) {
          const m: any = msgs[i];
          if (m.type !== "text") break;
          if (i > 0) {
            const gap = new Date((msgs[i - 1] as any).ts).getTime() - new Date(m.ts).getTime();
            if (gap > bufferSeg * 1000) break;
          }
          chain.unshift(m.content?.text ?? "");
        }
        if (chain.length > 1) event = { ...event, text: chain.join("\n") };
      }
    }
    // El operador pudo TOMAR el chat DURANTE la espera del buffer (hasta 20s). El chequeo de
    // bot_activo del ingest ocurrió ANTES de esperar → se revalida acá para no responder ENCIMA
    // del operador. (La ruta de aprobación/entrega no pasa por acá, así que no la bloquea.)
    { const { data: ct } = await db.from("contacts").select("bot_activo").eq("id", contactId).maybeSingle();
      if ((ct as any)?.bot_activo === false) return; }
    await runEngine(db, channelId, contactId, event);
  } catch (e) {
    // El mensaje ya quedó guardado; un error del motor no debe hacer que
    // Meta reintente el webhook. Solo se registra.
    console.error("[webhook] engine:", (e as any)?.message ?? e);
  }
}

async function processStatus(channelId: string, st: any) {
  const wamid: string = st.id;
  const status: string = st.status; // sent | delivered | read | failed
  const patch: Record<string, unknown> = { status };
  let esFallo = false;
  if (status === "failed" && st.errors?.[0]) {
    const e = st.errors[0];
    patch.error = { code: e.code, title: e.title, message: e.message };
    // Meta aceptó y DESPUÉS no entregó (bloqueado, ventana): no lo cobra. Sin esto el
    // reporte «Mensajes que Meta cobra» sumaba las 6 burbujas al cliente que te bloqueó.
    patch.ventana = null;
    console.error(`[status] failed wamid=${wamid} code=${e.code} ${e.title}`);
    esFallo = true;
  }
  // Scope por canal: el update es por wamid (id global de Meta). Aunque un webhook llega
  // ya firmado con el app_secret del canal, se acota el update a ESTE canal para que un
  // status con el wamid de OTRO tenant no pueda voltear el estado de su mensaje.
  // NO RETROCEDER: los status de Meta NO llegan ordenados; un 'delivered' tardío no debe
  // pisar un 'read' ya registrado (sent<delivered<read). 'failed' es terminal → siempre.
  const bloquea: Record<string, string> = { sent: "(delivered,read,failed)", delivered: "(read,failed)", read: "(failed)" };
  const ejecutar = () => {
    let q = db.from("messages").update(patch).eq("wamid", wamid).eq("channel_id", channelId);
    if (!esFallo && bloquea[status]) q = q.not("status", "in", bloquea[status]);
    // 'failed' es terminal, pero SIN dedup de statuses un reintento de Meta (o el camino
    // síncrono que ya marcó failed) volvía a matchear y disparaba avisarEnvioFallido OTRA VEZ
    // (alerta de Telegram duplicada). Al exigir que NO estuviera ya en 'failed', el segundo
    // pase devuelve 0 filas → sin re-aviso. El primero sí actualiza y avisa.
    if (esFallo) q = q.neq("status", "failed");
    return q.select("contact_id");
  };
  // 'failed' ASÍNCRONO: Meta aceptó el envío (status 'sent' con wamid) y RECIÉN AHORA
  // reporta que no se entregó (el cliente bloqueó al negocio, ventana vencida). El camino
  // síncrono avisa por Telegram; este NO lo hacía → el operador veía "enviado" y creía que
  // llegó (justo con una clave de recojo o una entrega digital eso es grave). Se avisa igual.
  const avisarSiFallo = async (upd: any[] | null) => {
    if (!esFallo) return;
    const cid = (upd && upd[0] && (upd[0] as any).contact_id) || null;
    if (cid) { try { await avisarEnvioFallido(db, channelId, cid, patch.error); } catch (_) { /* no encadenar fallos */ } }
  };
  const { data: upd } = await ejecutar();
  if (upd?.length || status === "read") { await avisarSiFallo(upd); return; }
  // Carrera con el insert: la fila saliente se guarda DESPUÉS de que Meta responde el POST, y
  // el status (`sent`, o un `failed` inmediato por 131047/131026) puede llegar por webhook
  // antes de que ese insert termine → 0 filas → el status se descartaba para siempre. Con un
  // 'failed' eso dejaba el mensaje "enviado" y sin aviso de Telegram (justo con una clave de
  // recojo). Un único reintento tras 1,5 s, EN SEGUNDO PLANO (el 200 a Meta no espera); si
  // sigue en 0, el wamid no es nuestro (o el estado ya era mayor) y se deja.
  const tarde = (async () => {
    await new Promise((r) => setTimeout(r, 1500));
    const { data: upd2 } = await ejecutar();
    await avisarSiFallo(upd2);
  })();
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(tarde);
  else await tarde;
}

// Extrae texto/tipo/contenido de un mensaje entrante de WhatsApp.
function extractContent(msg: any): { text: string; type: string; content: any } {
  const t = msg.type as string;
  switch (t) {
    case "text":
      return { text: msg.text?.body ?? "", type: "text", content: { text: msg.text?.body ?? "" } };
    case "image":
    case "audio":
    case "video":
    case "document":
    case "sticker": {
      const media = msg[t] ?? {};
      return {
        text: media.caption ?? `[${t}]`,
        type: t,
        // `filename` solo viene en documentos; el panel lo usa como texto del enlace.
        content: { media_id: media.id, mime_type: media.mime_type, caption: media.caption ?? null, ...(media.filename ? { filename: String(media.filename) } : {}) },
      };
    }
    case "interactive": {
      const i = msg.interactive ?? {};
      const reply = i.button_reply ?? i.list_reply;
      if (reply) return { text: reply.title ?? "", type: "interactive", content: { id: reply.id, title: reply.title } };
      // Otro subtipo (respuesta de un Flow `nfm_reply`, catálogo…): sin id no hay ruteo por
      // botón, pero tampoco dead air: va como texto con lo que traiga.
      const nfm = i.nfm_reply ?? {};
      const txt = String(nfm.body ?? nfm.response_json ?? "").trim() || `[${i.type ?? "interactive"}]`;
      return { text: txt, type: "interactive", content: { id: null, title: null, text: txt, raw_type: i.type ?? null } };
    }
    case "button":
      // Quick-reply de una PLANTILLA: `payload` es el id que definió el negocio; se conserva
      // para que un flujo pueda esperar justo ese botón (antes solo quedaba el texto).
      return { text: msg.button?.text ?? "", type: "button", content: { text: msg.button?.text, payload: msg.button?.payload ?? null } };
    case "location": {
      // Compartir la ubicación es de lo más normal para coordinar un delivery, y
      // llegaba como el texto pelado "[ubicación]": el extractor de dirección no
      // sacaba nada y la IA le volvía a pedir la dirección que el cliente cree que
      // ya dio. WhatsApp manda `name`/`address` cuando comparte un LUGAR (no un
      // pin suelto) y se estaban tirando — eso sí es una dirección de verdad, y así
      // el extractor la pesca igual que si la hubiera escrito. Sin lugar, van las
      // coordenadas: no son una dirección, pero al menos quedan a la vista del
      // operador en el chat en vez de perderse.
      const L = msg.location ?? {};
      const lugar = [L.name, L.address].map((x: unknown) => String(x ?? "").trim()).filter(Boolean).join(" · ");
      const coords = L.latitude != null && L.longitude != null ? `${L.latitude}, ${L.longitude}` : "";
      return {
        text: lugar ? `[ubicación] ${lugar}` : coords ? `[ubicación] ${coords}` : "[ubicación]",
        type: "location",
        content: { lat: L.latitude, lng: L.longitude, name: L.name ?? null, address: L.address ?? null },
      };
    }
    case "reaction": {
      // Antes caía al default: burbuja "[system]" en la Bandeja y el emoji se tiraba. Sigue
      // siendo tipo 'system' (no corre el motor); solo se conserva lo que el operador debe ver.
      const r = msg.reaction ?? {};
      const emoji = String(r.emoji ?? "").trim();
      const texto = emoji ? `Reaccionó ${emoji}` : "Quitó su reacción";
      return { text: texto, type: "system", content: { raw_type: "reaction", emoji: emoji || null, message_id: r.message_id ?? null, text: texto } };
    }
    case "contacts": {
      // Tarjeta de contacto compartida (p. ej. "mándaselo a mi hermana"): nombre y números se
      // descartaban por completo. Se guardan y se muestran; no corre el motor (tipo 'system').
      const lista = (Array.isArray(msg.contacts) ? msg.contacts : []).map((c: any) => {
        const n = c?.name ?? {};
        const nombre = String(n.formatted_name ?? [n.first_name, n.last_name].filter(Boolean).join(" ")).trim();
        const telefonos = (Array.isArray(c?.phones) ? c.phones : []).map((p: any) => String(p?.wa_id ?? p?.phone ?? "").trim()).filter(Boolean);
        return { nombre, telefonos };
      });
      const texto = lista.length
        ? "Compartió un contacto: " + lista.map((c: any) => [c.nombre, c.telefonos.join(" / ")].filter(Boolean).join(" · ")).join("; ")
        : "Compartió un contacto";
      return { text: texto, type: "system", content: { raw_type: "contacts", contacts: lista, text: texto } };
    }
    case "system": {
      // Aviso de WhatsApp (cambio de número, etc.): se guarda el texto para que el operador
      // lo lea; el cambio de número se aplica en processInbound.
      const s = msg.system ?? {};
      const body = String(s.body ?? "").trim();
      return { text: body || "[system]", type: "system", content: { raw_type: "system", system_type: s.type ?? null, new_wa_id: s.new_wa_id ?? s.wa_id ?? null, ...(body ? { text: body } : {}) } };
    }
    default:
      return { text: `[${t}]`, type: "system", content: { raw_type: t } };
  }
}

// ── Archivo del media entrante ───────────────────────────────────────
// Descarga el media de Meta con el token del canal, lo sube al bucket PRIVADO (el mismo de
// los comprobantes: una foto del cliente puede ser un Yape, así que nada de bucket público)
// y deja en `messages.content.media_url` una URL firmada de un año, que es lo que el panel
// ya sabe pintar (imagen con visor, <audio>, <video>, enlace de archivo). Best-effort: si
// falla, el mensaje queda como estaba y se registra el motivo. `media-gc` no barre este
// bucket, y además `messages.content` está en su lista de referencias.
const MEDIA_ARCHIVABLE = new Set(["image", "audio", "video", "document", "sticker"]);
const MEDIA_BUCKET = "comprobantes";
// 10 años (igual que el motor): la URL se guarda para siempre y nadie la renueva.
const MEDIA_SIGNED_TTL = 60 * 60 * 24 * 365 * 10;
const MEDIA_MAX_BYTES = 25 * 1024 * 1024; // un video largo no vale la pena guardarlo

function extPorMime(mime: string, tipo: string): string {
  const m = mime.toLowerCase();
  if (m.includes("pdf")) return "pdf";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mpeg") && tipo === "audio") return "mp3";
  if (m.includes("mp4") && tipo === "audio") return "m4a";
  if (m.includes("aac")) return "aac";
  if (m.includes("amr")) return "amr";
  if (m.includes("mp4") || m.includes("3gpp")) return "mp4";
  if (m.includes("spreadsheet") || m.includes("excel")) return "xlsx";
  if (m.includes("wordprocessing") || m.includes("msword")) return "docx";
  if (m.includes("zip")) return "zip";
  if (m.includes("plain")) return "txt";
  return tipo === "image" || tipo === "sticker" ? "jpg" : tipo === "audio" ? "ogg" : tipo === "video" ? "mp4" : "bin";
}

// `botEnPausa`: con el bot activo, el MOTOR transcribe la nota de voz (y la usa para
// responder); con el bot en pausa el motor no corre y el audio se quedaba mudo para el
// operador. En ese caso se transcribe acá, una sola vez, para que la lea en la Bandeja.
async function archivarMediaEntrante(channelId: string, contactId: string, wamid: string, tipo: string, content: any, botEnPausa = false): Promise<void> {
  try {
    const mediaId = String(content?.media_id ?? "");
    if (!mediaId) return;
    const secrets = await getChannelSecrets(db, channelId);
    if (!secrets?.access_token) return;
    let bajada: { bytes: Uint8Array; mime: string };
    try {
      bajada = await fetchMediaBytes(mediaId, secrets.access_token);
    } catch (e) {
      // Token vencido, media caducado en Meta (duran ~30 días), red. Se deja el motivo en
      // el mensaje para que la Bandeja no muestre un «cargando» eterno.
      await marcarErrorMedia(channelId, wamid, "No se pudo descargar de WhatsApp");
      throw e;
    }
    const { bytes, mime: mimeCrudo } = bajada;
    if (!bytes?.length) { await marcarErrorMedia(channelId, wamid, "WhatsApp devolvió un archivo vacío"); return; }
    if (bytes.length > MEDIA_MAX_BYTES) {
      console.warn(`[webhook] media ${tipo} de ${bytes.length} bytes: demasiado grande, no se archiva`);
      await marcarErrorMedia(channelId, wamid, `Archivo de ${(bytes.length / 1048576).toFixed(1)} MB: supera el máximo de ${MEDIA_MAX_BYTES / 1048576} MB, pídeselo por otro medio`);
      return;
    }
    // "audio/ogg; codecs=opus" → el bucket quiere el mime pelado.
    const mime = String(mimeCrudo || content?.mime_type || "application/octet-stream").split(";")[0].trim();
    // Carrera con el motor: para una foto con el bot activo, ingestImage puede haber
    // subido ya su copia y colgado la URL. Si ya hay, no se sube otra igual.
    {
      const { data: ya } = await db.from("messages").select("id, content").eq("wamid", wamid).eq("channel_id", channelId).maybeSingle();
      const c0 = ((ya as any)?.content ?? {}) as Record<string, unknown>;
      if (c0.media_url) {
        if (tipo === "audio" && botEnPausa && ya) await transcribirParaOperador(channelId, contactId, String((ya as any).id), bytes, mime);
        return;
      }
    }
    const acc = await accountOfChannel(db, channelId);
    const path = `${acc || "misc"}/${contactId}/${Date.now()}-${tipo}.${extPorMime(mime, tipo)}`;
    let up = await db.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
    if (up.error && /bucket|not found/i.test(up.error.message)) {
      await db.storage.createBucket(MEDIA_BUCKET, { public: false }).catch(() => {});
      up = await db.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
    }
    if (up.error) { console.error("[webhook] archivar media upload:", up.error.message); await marcarErrorMedia(channelId, wamid, "No se pudo guardar el archivo"); return; }
    const { data: signed } = await db.storage.from(MEDIA_BUCKET).createSignedUrl(path, MEDIA_SIGNED_TTL);
    if (!signed?.signedUrl) { await marcarErrorMedia(channelId, wamid, "No se pudo generar el enlace del archivo"); return; }
    // Se lee la fila de nuevo: si el motor ya le colgó su propia URL (OCR) o una
    // transcripción mientras tanto, no se pisa nada, solo se agrega lo que falta.
    const { data: m } = await db.from("messages").select("id, content").eq("wamid", wamid).eq("channel_id", channelId).maybeSingle();
    if (!m) return;
    const c = ((m as any).content ?? {}) as Record<string, unknown>;
    if (!c.media_url) {
      // `size` en bytes: la Bandeja lo muestra junto al archivo y sirve para medir espacio.
      await db.from("messages").update({ content: { ...c, media_url: signed.signedUrl, mime, size: bytes.length, storage_path: `${MEDIA_BUCKET}/${path}` } }).eq("id", (m as any).id);
    } else {
      // Perdió la carrera contra el motor: la copia que acaba de subir no la referencia nadie
      // y este bucket no se barre → se borra ahora, no queda huérfana para siempre.
      await db.storage.from(MEDIA_BUCKET).remove([path]).catch(() => {});
    }
    if (tipo === "audio" && botEnPausa) await transcribirParaOperador(channelId, contactId, String((m as any).id), bytes, mime);
  } catch (e) {
    console.error("[webhook] archivar media:", (e as any)?.message ?? e);
  }
}

// Deja en el mensaje por qué no hay archivo, para que la Bandeja lo diga en vez de
// quedarse en «Cargando desde WhatsApp…». No pisa una URL que sí se haya conseguido.
async function marcarErrorMedia(channelId: string, wamid: string, motivo: string): Promise<void> {
  try {
    const { data: m } = await db.from("messages").select("id, content").eq("wamid", wamid).eq("channel_id", channelId).maybeSingle();
    if (!m) return;
    const c = ((m as any).content ?? {}) as Record<string, unknown>;
    if (c.media_url) return;
    await db.from("messages").update({ content: { ...c, media_error: motivo } }).eq("id", (m as any).id);
  } catch (_) { /* best-effort */ }
}

// Nota de voz con el bot en PAUSA: el motor no la va a escuchar, así que se transcribe acá
// (Whisper, con la clave de OpenAI del canal) y queda bajo el audio en la Bandeja, en la
// vista previa de la lista y en Actividad. Sin clave de OpenAI no hace nada: el operador
// igual tiene el reproductor. Con el bot activo NO se llama: lo hace el motor (una vez).
async function transcribirParaOperador(channelId: string, contactId: string, msgId: string, bytes: Uint8Array, mime: string): Promise<void> {
  try {
    const { data: aiRows } = await db.rpc("get_channel_ai_active", { p_channel_id: channelId, p_provider: "openai" });
    const ai = Array.isArray(aiRows) ? aiRows[0] : aiRows;
    if (!ai?.api_key) return;
    const texto = String(await transcribeAudio(ai.api_key, bytes, mime, { db, channelId }) ?? "").trim();
    if (esAlucinacionSTT(texto)) {
      await db.from("contact_events").insert({ channel_id: channelId, contact_id: contactId, tipo: "nota", titulo: "🎙️ Audio sin voz", detalle: "No se entendió nada en la nota de voz" }).then(() => {}, () => {});
      return;
    }
    const { data: m } = await db.from("messages").select("content").eq("id", msgId).maybeSingle();
    await db.from("messages").update({ content: { ...(((m as any)?.content ?? {}) as Record<string, unknown>), transcription: texto } }).eq("id", msgId);
    await db.from("contacts").update({ last_input: texto }).eq("id", contactId);
    await db.from("contact_events").insert({ channel_id: channelId, contact_id: contactId, tipo: "nota", titulo: "🎙️ Audio transcrito", detalle: texto.slice(0, 140) }).then(() => {}, () => {});
  } catch (e) {
    console.error("[webhook] transcribir para operador:", (e as any)?.message ?? e);
  }
}
