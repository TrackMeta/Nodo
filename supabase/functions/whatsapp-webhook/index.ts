// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: whatsapp-webhook  (PÚBLICA — verify_jwt=false)
//   GET  → verificación de Meta (hub.challenge)
//   POST → recepción de mensajes/estados, validando firma por canal.
// ═══════════════════════════════════════════════════════════════════
import { serviceClient, getChannelSecrets } from "../_shared/db.ts";
import { verifyMetaSignature } from "../_shared/crypto.ts";
import { runEngine, avisarEnvioFallido, type EngineEvent } from "../_shared/engine.ts";

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
  const phoneNumberId = change0?.value?.metadata?.phone_number_id as string | undefined;
  const esPlantilla = change0?.field === "message_template_status_update";
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
      const value = change.value ?? {};
      const channel = await chanFor(value?.metadata?.phone_number_id as string | undefined);
      if (!channel) continue; // número desconocido en este POST → no lo cruces a otro canal
      // Remitente. Con "nombres de usuario" de WhatsApp (BSUID), contacts[0]
      // trae user_id (BSUID, siempre), username (@handle) y wa_id (el número,
      // solo si lo comparte). Se pasa todo para keyar bien e identificar al
      // cliente sin número. Ver migración 0062.
      const c0 = (value.contacts?.[0] ?? {}) as any;
      const sender = {
        profileName: c0.profile?.name as string | undefined,
        phone: c0.wa_id as string | undefined,
        bsuid: c0.user_id as string | undefined,
        username: c0.username as string | undefined,
      };

      for (const msg of value.messages ?? []) {
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
  const waId: string = sender.phone || sender.bsuid || msg.from;
  const { text, type, content } = extractContent(msg);
  const ref = msg.referral; // Click-to-WhatsApp (oro para atribución)

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
    last_input: text,
    last_input_type: type,
    ultimo_mensaje_at: new Date().toISOString(),
    ultimo_mensaje_cliente_at: new Date().toISOString(),
  };
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
    .select("id, bot_activo, fep_hasta")
    .single();
  if (upErr && /user_id|username|telefono|column/i.test(upErr.message)) {
    // Migración 0062 aún no aplicada → reintenta sin las columnas nuevas.
    const { user_id: _u, username: _n, telefono: _t, ...base } = patch as any;
    ({ data: contact, error: upErr } = await db
      .from("contacts").upsert(base, { onConflict: "channel_id,wa_id" })
      .select("id, bot_activo, fep_hasta").single());
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
  const svc = ahora + 24 * 60 * 60 * 1000;
  const fepMs = contact.fep_hasta ? new Date(contact.fep_hasta as string).getTime() : 0;
  await db.from("conversations").upsert(
    {
      channel_id: channelId,
      contact_id: contact.id,
      window_type: fepMs > ahora ? "fep_72h" : "service_24h",
      expira_at: new Date(Math.max(svc, fepMs)).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "contact_id" },
  );

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
    ts: new Date((Number.isFinite(Number(msg.timestamp)) && Number(msg.timestamp) > 0 ? Number(msg.timestamp) * 1000 : Date.now())).toISOString(),
  });
  // 23505 = unique_violation → mensaje repetido (reintento de Meta). No
  // volver a correr el motor: la primera entrega ya lo hizo (idempotencia).
  if (msgErr) {
    if ((msgErr as any).code === "23505") return;
    throw new Error(`insert message: ${msgErr.message}`);
  }

  // ── Motor de flujos ────────────────────────────────────────────────
  // Bot pausado para este contacto (humano atendiendo) → no responder.
  if ((contact as any).bot_activo === false) return;

  const adId = ref?.source_id ? String(ref.source_id) : undefined;
  let event: EngineEvent | null = null;
  let debounce = false;
  if (type === "interactive") {
    // Botón tocado → ruteo determinista inmediato (sin buffer).
    if (content?.id) event = { type: "button", buttonId: String(content.id), title: content.title };
  } else if (type === "image" || (type === "document" && /^image\/|^application\/pdf$/i.test(String(content?.mime_type ?? "")) && content?.media_id)) {
    // Imagen (ej. comprobante) → inmediata, con referencia para el nodo IA. También un DOCUMENTO
    // con mime de imagen o PDF: en Perú es común mandar el Yape como archivo/PDF en vez de foto —
    // se trata como "imagen" para que el OCR lo lea (Claude procesa imágenes y PDFs).
    event = { type: "message", text, msgType: "image", mediaRef: `wa-media:${content.media_id}`, adId };
  } else if (type === "audio") {
    // Nota de voz → referencia para que el motor la transcriba (STT).
    event = { type: "message", text, msgType: "audio", mediaRef: content.media_id ? `wa-media:${content.media_id}` : undefined, adId };
  } else if (type === "text") {
    // Texto → con debounce (junta mensajes seguidos, anti respuesta triple).
    event = { type: "message", text, msgType: "text", adId };
    debounce = true;
  } else if (type === "system") {
    // Reacción (👍) o tipo NO soportado (extractContent → type:"system"): el mensaje ya quedó
    // guardado, pero NO se dispara el bot de ventas. Responder a "[reaction]" es ruido y podría
    // reabrir el buffer/relanzar la conversación. Una reacción no es un mensaje que atender.
    return;
  } else {
    // video/document/sticker/location → el flujo decide por last_input_type.
    event = { type: "message", text, msgType: type, adId };
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
      const { data: msgs } = await db.from("messages")
        .select("wamid, ts, type, content")
        .eq("contact_id", contactId).eq("direction", "in")
        // `ts` viene de Meta con granularidad de SEGUNDOS: dos mensajes del MISMO segundo
        // empatan. Sin un desempate, dos `runEngineTask` concurrentes podían ver un `msgs[0]`
        // distinto → o ambos ceden (dead-air) o ambos corren (doble respuesta). `wamid` (único)
        // como 2ª clave hace el orden DETERMINÍSTICO: las dos queries coinciden y solo una corre.
        .order("ts", { ascending: false }).order("wamid", { ascending: false }).limit(10);
      if (!msgs?.length) return;
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
    console.error(`[status] failed wamid=${wamid} code=${e.code} ${e.title}`);
    esFallo = true;
  }
  // Scope por canal: el update es por wamid (id global de Meta). Aunque un webhook llega
  // ya firmado con el app_secret del canal, se acota el update a ESTE canal para que un
  // status con el wamid de OTRO tenant no pueda voltear el estado de su mensaje.
  // NO RETROCEDER: los status de Meta NO llegan ordenados; un 'delivered' tardío no debe
  // pisar un 'read' ya registrado (sent<delivered<read). 'failed' es terminal → siempre.
  const bloquea: Record<string, string> = { sent: "(delivered,read,failed)", delivered: "(read,failed)", read: "(failed)" };
  let q = db.from("messages").update(patch).eq("wamid", wamid).eq("channel_id", channelId);
  if (!esFallo && bloquea[status]) q = q.not("status", "in", bloquea[status]);
  // 'failed' es terminal, pero SIN dedup de statuses un reintento de Meta (o el camino
  // síncrono que ya marcó failed) volvía a matchear y disparaba avisarEnvioFallido OTRA VEZ
  // (alerta de Telegram duplicada). Al exigir que NO estuviera ya en 'failed', el segundo
  // pase devuelve 0 filas → sin re-aviso. El primero sí actualiza y avisa.
  if (esFallo) q = q.neq("status", "failed");
  const { data: upd } = await q.select("contact_id");
  // 'failed' ASÍNCRONO: Meta aceptó el envío (status 'sent' con wamid) y RECIÉN AHORA
  // reporta que no se entregó (el cliente bloqueó al negocio, ventana vencida). El camino
  // síncrono avisa por Telegram; este NO lo hacía → el operador veía "enviado" y creía que
  // llegó (justo con una clave de recojo o una entrega digital eso es grave). Se avisa igual.
  if (esFallo) {
    const cid = (upd && upd[0] && (upd[0] as any).contact_id) || null;
    if (cid) { try { await avisarEnvioFallido(db, channelId, cid, patch.error); } catch (_) { /* no encadenar fallos */ } }
  }
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
        content: { media_id: media.id, mime_type: media.mime_type, caption: media.caption ?? null },
      };
    }
    case "interactive": {
      const i = msg.interactive ?? {};
      const reply = i.button_reply ?? i.list_reply ?? {};
      return { text: reply.title ?? "", type: "interactive", content: { id: reply.id, title: reply.title } };
    }
    case "button":
      return { text: msg.button?.text ?? "", type: "button", content: { text: msg.button?.text } };
    case "location":
      return {
        text: "[ubicación]",
        type: "location",
        content: { lat: msg.location?.latitude, lng: msg.location?.longitude },
      };
    default:
      return { text: `[${t}]`, type: "system", content: { raw_type: t } };
  }
}
