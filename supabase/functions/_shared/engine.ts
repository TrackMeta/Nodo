// ═══════════════════════════════════════════════════════════════════
// Nodo · flow-runner — intérprete de grafos de flujo.
// Lo invocan el webchat (pruebas) y el webhook de WhatsApp. Ejecuta
// nodos hasta toparse con una espera (Pregunta/Botones/Esperar) o Fin.
// Respeta el lock por contacto (un solo run activo/esperando).
// ═══════════════════════════════════════════════════════════════════
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { imageBlock, runAI, transcribeAudio, type ContentBlock, type Provider } from "./ai.ts";
import { sendCapiEvent } from "./capi.ts";
import { sendTelegram } from "./telegram.ts";
import { sendTemplateToContact } from "./campaigns.ts";
import { getChannelSecrets } from "./db.ts";
import { fetchMediaAsDataUri, fetchMediaBytes, MetaApiError, sendButtons, sendText } from "./meta.ts";

export type EngineEvent =
  // mediaRef: referencia a la imagen del mensaje ("wa-media:<id>" en WhatsApp,
  // URL pública en webchat) — la consume el nodo IA "analizar imagen".
  // adId: source_id del referral CTWA (solo primer mensaje desde un anuncio).
  | { type: "message"; text: string; msgType?: string; mediaRef?: string; adId?: string }
  | { type: "button"; buttonId: string; title?: string }
  | { type: "resume" }; // despertar tras Esperar

const MAX_STEPS = 50; // tope de nodos por invocación (evita bucles infinitos)

interface Run {
  id: string;
  channel_id: string;
  contact_id: string;
  flow_id: string;
  current_node_id: string | null;
  vars: Record<string, any>;
  estado: string;
  wake_at: string | null;
}
interface Node {
  id: string; flow_id: string; tipo: string; nombre: string | null;
  config: any; es_inicial: boolean;
}

// ── Entrada principal ──────────────────────────────────────────────
export async function runEngine(
  db: SupabaseClient, channelId: string, contactId: string, event: EngineEvent,
) {
  // STT: si entra una nota de voz, transcribirla a texto ANTES de todo, para
  // que los triggers de palabra clave, condiciones y la IA la entiendan como
  // si el cliente hubiera escrito. El audio original queda guardado igual.
  if (event.type === "message" && event.msgType === "audio" && event.mediaRef) {
    const texto = await transcribeIncoming(db, channelId, event.mediaRef).catch((e) => {
      console.error("[STT]", (e as any)?.message ?? e); return null;
    });
    if (texto) {
      event = { ...event, text: texto };
      await db.from("contacts").update({ last_input: texto }).eq("id", contactId);
      await annotateAudioTranscript(db, contactId, texto);
      await logEvent(db, channelId, contactId, "nota", "🎙️ Audio transcrito", texto.slice(0, 140));
    }
  }

  let run = await getActiveRun(db, contactId);

  if (run) {
    const ready = await resumeRun(db, run, event);
    if (!ready) return; // esperaba otra cosa (ej. buffer) → nada que hacer
  } else {
    if (event.type !== "message") return;
    const flow = await matchTrigger(db, channelId, event.text, event.adId);
    if (!flow) return; // ningún flujo maneja este mensaje
    run = await startRun(db, channelId, contactId, flow);
    if (!run) {
      // Perdió la carrera del lock (dos webhooks casi simultáneos): otro run
      // ya está activo → entregar este evento a ese run como reanudación.
      run = await getActiveRun(db, contactId);
      if (!run) return;
      const ready = await resumeRun(db, run, event);
      if (!ready) return;
    }
  }
  // Imagen entrante (ej. comprobante): se sube a almacenamiento propio para
  // tener un LINK PÚBLICO reutilizable → {{ultima_imagen}} (Sheets, Telegram)
  // y el nodo IA (OCR) la lee de esa misma URL. Si la subida falla, se usa la
  // referencia original como respaldo.
  if (event.type === "message" && event.mediaRef && (event.msgType === "image" || !event.msgType)) {
    const url = await ingestImage(db, channelId, contactId, event.mediaRef).catch((e) => {
      console.error("[ingestImage]", (e as any)?.message ?? e); return null;
    });
    run.vars._last_image = url ?? event.mediaRef;
    if (url) {
      run.vars.ultima_imagen = url;
      await setField(db, channelId, contactId, "ultima_imagen", url);
    }
  }
  await execute(db, run);
}

// ── Estado del run ─────────────────────────────────────────────────
async function getActiveRun(db: SupabaseClient, contactId: string): Promise<Run | null> {
  const { data } = await db.from("flow_runs").select("*")
    .eq("contact_id", contactId).in("estado", ["activo", "esperando"])
    .maybeSingle();
  return data as Run | null;
}

async function saveRun(db: SupabaseClient, run: Run) {
  await db.from("flow_runs").update({
    current_node_id: run.current_node_id, vars: run.vars,
    estado: run.estado, wake_at: run.wake_at, flow_id: run.flow_id,
    updated_at: new Date().toISOString(),
  }).eq("id", run.id);
}

// ── Triggers ───────────────────────────────────────────────────────
async function matchTrigger(db: SupabaseClient, channelId: string, text: string, adId?: string) {
  const norm = normalize(text);
  const { data: triggers } = await db.from("flow_triggers")
    .select("flow_id, tipo, config, flows!inner(id, estado, es_entrada)")
    .eq("channel_id", channelId).eq("activo", true);

  let entrada: any = null;
  let kwHit: any = null;
  for (const t of triggers ?? []) {
    const flow = (t as any).flows;
    if (!flow || flow.estado !== "activo") continue;
    if (t.tipo === "entrada") { entrada = flow; continue; }
    // Referral CTWA: el anuncio identifica el producto sin depender del texto.
    // Gana sobre keyword (solo viene en el primer mensaje desde el anuncio).
    if (t.tipo === "referral" && adId) {
      const ads: string[] = (t.config?.ad_ids ?? []).map(String);
      if (ads.includes(String(adId))) return flow;
    }
    if (t.tipo === "keyword") {
      const kws: string[] = (t.config?.keywords ?? []).map(normalize);
      const mode = t.config?.match ?? "contiene";
      const hit = kws.some((k) =>
        mode === "exacta" ? norm === k
          : mode === "empieza" ? norm.startsWith(k)
          : norm.includes(k)
      );
      if (hit && !kwHit) kwHit = flow; // keyword gana sobre entrada
    }
  }
  return kwHit ?? entrada; // prioridad: referral > keyword > flujo de entrada
}

async function startRun(db: SupabaseClient, channelId: string, contactId: string, flow: any): Promise<Run | null> {
  const initial = await initialNode(db, flow.id);
  const { data, error } = await db.from("flow_runs").insert({
    channel_id: channelId, contact_id: contactId, flow_id: flow.id,
    current_node_id: initial?.id ?? null, vars: {}, estado: "activo",
  }).select("*").single();
  // 23505 = ya hay un run activo para este contacto (índice idx_runs_lock):
  // dos webhooks simultáneos → el que pierde la carrera lo maneja el caller.
  if (error) {
    if ((error as any).code === "23505") return null;
    throw new Error(`startRun: ${error.message}`);
  }
  // Nombre + producto del flujo (para Timeline y atribución de producto).
  const { data: f } = await db.from("flows").select("nombre, product_id").eq("id", flow.id).maybeSingle();
  await logEvent(db, channelId, contactId, "flujo_inicio", "Flujo iniciado", (f as any)?.nombre ?? null);
  await markProduct(db, contactId, (f as any)?.product_id);
  return data as Run;
}

// ── Reanudar un run que esperaba input/botón/tiempo ────────────────
async function resumeRun(db: SupabaseClient, run: Run, event: EngineEvent): Promise<boolean> {
  const aw = run.vars._await;
  run.estado = "activo";

  if (event.type === "resume") {
    // Despertar tras Esperar: avanzar por 'continuar' desde el nodo actual.
    run.current_node_id = await nextNode(db, run.flow_id, run.current_node_id!, "continuar");
    delete run.vars._await;
    return true;
  }
  if (!aw) {
    // No esperaba nada pero llegó un mensaje mientras corría → al buffer.
    run.vars._buffer = [...(run.vars._buffer ?? []), event];
    await saveRun(db, run);
    return false;
  }
  if (aw.type === "input" && event.type === "message") {
    if (aw.guardar_en) await setField(db, run.channel_id, run.contact_id, aw.guardar_en, event.text);
    run.vars[aw.guardar_en] = event.text;
    run.current_node_id = await nextNode(db, run.flow_id, aw.node_id, "continuar");
    delete run.vars._await;
    return true;
  }
  if (aw.type === "button" && event.type === "button") {
    const handle = `boton:${event.buttonId}`;
    const next = await nextNode(db, run.flow_id, aw.node_id, handle);
    run.current_node_id = next;
    delete run.vars._await;
    return true;
  }
  // Tipo inesperado (ej. escribió texto donde esperábamos botón) → buffer.
  run.vars._buffer = [...(run.vars._buffer ?? []), event];
  await saveRun(db, run);
  return false;
}

// ── Ejecución de nodos ─────────────────────────────────────────────
async function execute(db: SupabaseClient, run: Run) {
  for (let i = 0; i < MAX_STEPS; i++) {
    if (!run.current_node_id) { run.estado = "completado"; break; }
    const node = await getNode(db, run.current_node_id);
    if (!node) { run.estado = "completado"; break; }
    await logEvent(db, run.channel_id, run.contact_id, "nodo", node.nombre || node.tipo, node.tipo);

    const ctx = await buildContext(db, run);

    switch (node.tipo) {
      case "mensaje": {
        const bubbles = node.config?.bubbles ?? [{ text: node.config?.text ?? "" }];
        let hasButtons = false;
        for (const b of bubbles) {
          await emit(db, run, b, ctx);
          if (b.buttons?.length) hasButtons = true;
        }
        if (hasButtons) {
          run.vars._await = { type: "button", node_id: node.id };
          run.estado = "esperando";
          await saveRun(db, run); return;
        }
        run.current_node_id = await nextNode(db, run.flow_id, node.id, "continuar");
        break;
      }
      case "pregunta": {
        await emit(db, run, { text: resolve(node.config?.text ?? "", ctx) }, ctx);
        run.vars._await = { type: "input", node_id: node.id, guardar_en: node.config?.guardar_en };
        run.estado = "esperando";
        await saveRun(db, run); return;
      }
      case "condicion": {
        const handle = await evalCondicion(db, run, node, ctx);
        run.current_node_id = await nextNode(db, run.flow_id, node.id, handle);
        break;
      }
      case "accion": {
        await runAcciones(db, run, node.config?.acciones ?? [], ctx);
        run.current_node_id = await nextNode(db, run.flow_id, node.id, "continuar");
        break;
      }
      case "esperar": {
        const seg = Number(node.config?.segundos ?? 3);
        run.wake_at = new Date(Date.now() + seg * 1000).toISOString();
        run.estado = "esperando";
        await saveRun(db, run); return;
      }
      case "iniciar_flujo": {
        const target = await resolveTargetFlow(db, run.channel_id, node.config);
        if (target) {
          run.flow_id = target;
          const init = await initialNode(db, target);
          run.current_node_id = init?.id ?? null;
          const { data: tf } = await db.from("flows").select("nombre, product_id").eq("id", target).maybeSingle();
          await logEvent(db, run.channel_id, run.contact_id, "flujo_inicio", "Flujo iniciado", (tf as any)?.nombre ?? null);
          await markProduct(db, run.contact_id, (tf as any)?.product_id);
        } else {
          run.current_node_id = null;
        }
        break;
      }
      case "ia": {
        await runIa(db, run, node, ctx);
        break;
      }
      case "evento_fb": {
        await runEventoFb(db, run, node, ctx);
        break;
      }
      case "plantilla": {
        // Plantilla HSM aprobada por Meta — única vía para escribir FUERA de
        // la ventana de 24h (notificaciones de pedido físico en tránsito).
        try {
          await sendTemplateToContact(db, run.channel_id, run.contact_id, {
            name: node.config?.template_name,
            language: node.config?.template_lang,
            params: (node.config?.params ?? []).map((p: string) => resolve(String(p), ctx)),
          });
          run.current_node_id =
            (await nextNode(db, run.flow_id, node.id, "exito")) ??
            (await nextNode(db, run.flow_id, node.id, "continuar"));
        } catch (err) {
          await logEvent(db, run.channel_id, run.contact_id, "error", "Error al enviar plantilla", String((err as any)?.message ?? err));
          run.current_node_id =
            (await nextNode(db, run.flow_id, node.id, "fallo")) ??
            (await nextNode(db, run.flow_id, node.id, "continuar"));
        }
        break;
      }
      case "google_sheets": {
        await runGoogleSheets(db, run, node, ctx);
        break;
      }
      case "fin": run.estado = "completado"; run.current_node_id = null; break;
      default: {
        // Nodo desconocido → se salta siguiendo 'exito' (o 'continuar').
        run.current_node_id =
          (await nextNode(db, run.flow_id, node.id, "exito")) ??
          (await nextNode(db, run.flow_id, node.id, "continuar"));
      }
    }
  }
  if (run.estado === "activo") run.estado = "completado"; // agotó MAX_STEPS
  if (run.estado === "completado") await logEvent(db, run.channel_id, run.contact_id, "flujo_fin", "Flujo finalizado");
  await saveRun(db, run);
}

// ── Modo de entrega del canal (WhatsApp real vs webchat de pruebas) ─
async function ensureDelivery(db: SupabaseClient, run: any) {
  if (run._delivery !== undefined) return;
  const { data: ch } = await db.from("channels")
    .select("channel_type, phone_number_id").eq("id", run.channel_id).maybeSingle();
  if ((ch as any)?.channel_type === "whatsapp" && (ch as any).phone_number_id) {
    const secrets = await getChannelSecrets(db, run.channel_id);
    run._delivery = { mode: "whatsapp", phoneNumberId: (ch as any).phone_number_id, token: secrets?.access_token ?? null };
  } else {
    run._delivery = { mode: "webchat" };
  }
}

// ── Emisión de mensajes salientes ──────────────────────────────────
// En WhatsApp real envía por Graph API; en webchat basta con insertar
// (el panel lo ve por Realtime). Siempre queda registro en messages.
async function emit(db: SupabaseClient, run: any, bubble: any, ctx: any) {
  await ensureDelivery(db, run);
  const text = resolve(bubble.text ?? "", ctx);
  const isInteractive = !!bubble.buttons?.length;
  const content: any = {};
  if (text) content.text = text;
  if (bubble.media_id) content.media_id = bubble.media_id;
  if (isInteractive) content.buttons = bubble.buttons;

  let wamid = ""; let status = "sent"; let error: any = null;
  const d = run._delivery;
  if (d?.mode === "whatsapp" && d.token && ctx.wa_id && (text || isInteractive)) {
    try {
      wamid = isInteractive
        ? await sendButtons(d.phoneNumberId, d.token, ctx.wa_id, text,
            bubble.buttons.map((b: any) => ({ id: b.id, title: b.title })))
        : await sendText(d.phoneNumberId, d.token, ctx.wa_id, text);
    } catch (e) {
      status = "failed";
      error = e instanceof MetaApiError ? e.meta : { message: String((e as any)?.message ?? e) };
      console.error("[emit] fallo envío WhatsApp:", error);
    }
  }
  await db.from("messages").insert({
    channel_id: run.channel_id, contact_id: run.contact_id,
    direction: "out", type: isInteractive ? "interactive" : "text",
    content, status, wamid: wamid || null, error,
  });
}

// Arranca un flujo concreto para un contacto (usado por el scheduler para
// remarketing). No interrumpe una conversación activa.
export async function startFlowRun(
  db: SupabaseClient, channelId: string, contactId: string, flowId: string,
  opts?: { force?: boolean },
): Promise<boolean> {
  if (opts?.force) {
    // Modo prueba: cancela cualquier run y arranca el flujo aunque esté en borrador.
    await db.from("flow_runs").update({ estado: "cancelado" })
      .eq("contact_id", contactId).in("estado", ["activo", "esperando"]);
  } else if (await getActiveRun(db, contactId)) {
    return false;
  }
  const { data: flow } = await db.from("flows").select("id, estado").eq("id", flowId).maybeSingle();
  if (!flow) return false;
  if (!opts?.force && (flow as any).estado !== "activo") return false;
  const run = await startRun(db, channelId, contactId, flow);
  if (!run) return false; // otro run ganó la carrera del lock
  await execute(db, run);
  return true;
}

// Envía un mensaje suelto (paso de secuencia sin flujo).
export async function deliverMessage(db: SupabaseClient, channelId: string, contactId: string, text: string) {
  const run: any = { channel_id: channelId, contact_id: contactId };
  const { data: c } = await db.from("contacts").select("wa_id").eq("id", contactId).maybeSingle();
  await emit(db, run, { text }, { wa_id: (c as any)?.wa_id });
}

// ── STT: descarga el audio entrante y lo transcribe (OpenAI Whisper) ─
// mediaRef = "wa-media:<id>" (WhatsApp, se baja por Graph con el token del
// canal) o una URL pública (webchat de pruebas).
async function transcribeIncoming(db: SupabaseClient, channelId: string, mediaRef: string): Promise<string | null> {
  const { data: aiRows } = await db.rpc("get_channel_ai_active", { p_channel_id: channelId, p_provider: "openai" });
  const ai = Array.isArray(aiRows) ? aiRows[0] : aiRows;
  if (!ai?.api_key) { console.warn("[STT] el canal no tiene API key de OpenAI → no se transcribe el audio"); return null; }

  let bytes: Uint8Array, mime: string;
  if (mediaRef.startsWith("wa-media:")) {
    const secrets = await getChannelSecrets(db, channelId);
    if (!secrets?.access_token) return null;
    ({ bytes, mime } = await fetchMediaBytes(mediaRef.slice("wa-media:".length), secrets.access_token));
  } else {
    const r = await fetch(mediaRef);
    if (!r.ok) return null;
    mime = r.headers.get("content-type") || "audio/ogg";
    bytes = new Uint8Array(await r.arrayBuffer());
  }
  const texto = await transcribeAudio(ai.api_key, bytes, mime);
  return texto || null;
}

// Sube una imagen entrante (comprobante) a Storage y devuelve su URL pública.
// WhatsApp no da URL pública del media; el webchat sí (se devuelve tal cual).
async function ingestImage(db: SupabaseClient, channelId: string, contactId: string, mediaRef: string): Promise<string | null> {
  if (/^https?:/.test(mediaRef)) return mediaRef;            // webchat: ya pública
  if (!mediaRef.startsWith("wa-media:")) return null;
  const secrets = await getChannelSecrets(db, channelId);
  if (!secrets?.access_token) return null;
  const { bytes, mime } = await fetchMediaBytes(mediaRef.slice("wa-media:".length), secrets.access_token);
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const path = `comprobantes/${contactId}/${Date.now()}.${ext}`;
  let up = await db.storage.from("media").upload(path, bytes, { contentType: mime || "image/jpeg", upsert: true });
  if (up.error && /bucket|not found/i.test(up.error.message)) {
    await db.storage.createBucket("media", { public: true }).catch(() => {}); // 1ª vez
    up = await db.storage.from("media").upload(path, bytes, { contentType: mime || "image/jpeg", upsert: true });
  }
  if (up.error) { console.error("[ingestImage] upload:", up.error.message); return null; }
  return db.storage.from("media").getPublicUrl(path).data?.publicUrl ?? null;
}

// Guarda la transcripción dentro de la burbuja del audio → el operador la lee
// en la Bandeja bajo la nota de voz. Best-effort.
async function annotateAudioTranscript(db: SupabaseClient, contactId: string, texto: string) {
  try {
    const { data: m } = await db.from("messages")
      .select("id, content").eq("contact_id", contactId).eq("direction", "in").eq("type", "audio")
      .order("ts", { ascending: false }).limit(1).maybeSingle();
    if (m) await db.from("messages").update({ content: { ...((m as any).content ?? {}), transcription: texto } }).eq("id", (m as any).id);
  } catch (_) { /* best-effort */ }
}

// ── Condiciones ────────────────────────────────────────────────────
async function evalCondicion(db: SupabaseClient, run: Run, node: Node, ctx: any): Promise<string> {
  for (const ruta of node.config?.rutas ?? []) {
    const modo = ruta.match ?? "todas";
    const res = [];
    for (const c of ruta.condiciones ?? []) res.push(await evalCond(db, run, c, ctx));
    const ok = modo === "cualquiera" ? res.some(Boolean) : res.every(Boolean);
    if (ok) return ruta.handle ?? `ruta:${ruta.nombre}`;
  }
  return "si_no_cumple";
}
async function evalCond(db: SupabaseClient, run: Run, c: any, ctx: any): Promise<boolean> {
  switch (c.op) {
    case "tiene_tag":    return await hasTag(db, run.contact_id, c.valor);
    case "no_tiene_tag": return !(await hasTag(db, run.contact_id, c.valor));
    case "campo_igual":     return String(ctx[c.campo] ?? "") === String(c.valor);
    case "campo_contiene":  return String(ctx[c.campo] ?? "").toLowerCase().includes(String(c.valor).toLowerCase());
    case "campo_existe":    return ctx[c.campo] != null && ctx[c.campo] !== "";
    default: return false;
  }
}

// ── Acciones ───────────────────────────────────────────────────────
async function runAcciones(db: SupabaseClient, run: Run, acciones: any[], ctx: any) {
  for (const a of acciones) {
    switch (a.tipo) {
      case "add_tag":    await addTag(db, run.channel_id, run.contact_id, a.valor); await logEvent(db, run.channel_id, run.contact_id, "etiqueta_add", "Etiqueta añadida", a.valor); break;
      case "remove_tag": await removeTag(db, run.channel_id, run.contact_id, a.valor); await logEvent(db, run.channel_id, run.contact_id, "etiqueta_del", "Etiqueta quitada", a.valor); break;
      case "set_field": {
        const v = resolve(String(a.valor ?? ""), ctx);
        run.vars[a.key] = v; // disponible ya en este run (Condiciones posteriores)
        await setField(db, run.channel_id, run.contact_id, a.key, v);
        await logEvent(db, run.channel_id, run.contact_id, "campo", "Campo actualizado", a.key);
        break;
      }
      case "clear_field": delete run.vars[a.key]; await setField(db, run.channel_id, run.contact_id, a.key, null); break;
      case "append_field": {
        const prev = ctx[a.key] ? String(ctx[a.key]) + "\n" : "";
        const v = prev + resolve(String(a.valor ?? ""), ctx);
        run.vars[a.key] = v;
        await setField(db, run.channel_id, run.contact_id, a.key, v);
        break;
      }
      case "stage":      await db.from("contacts").update({ stage: a.valor }).eq("id", run.contact_id); await logEvent(db, run.channel_id, run.contact_id, "nota", "Etapa: " + a.valor); break;
      case "notify_admin": {
        // `foto` opcional: adjunta la imagen (p.ej. {{ultima_imagen}}) como foto.
        const foto = a.foto ? resolve(String(a.foto), ctx) : undefined;
        await notifyAdmin(db, run, resolve(String(a.mensaje ?? a.valor ?? ""), ctx), foto);
        break;
      }
      case "transfer_human": {
        await db.from("contacts").update({ bot_activo: false }).eq("id", run.contact_id);
        await db.from("conversations").update({ requiere_humano: true }).eq("contact_id", run.contact_id);
        const msg = a.mensaje ? resolve(String(a.mensaje), ctx) : `🙋 ${ctx.nombre || ctx.wa_id} necesita atención humana`;
        await notifyAdmin(db, run, msg);
        await logEvent(db, run.channel_id, run.contact_id, "humano", "Transferido a un humano");
        break;
      }
      case "subscribe_seq": await subscribeSeq(db, run, a); await logEvent(db, run.channel_id, run.contact_id, "secuencia_inicio", "Secuencia suscrita", a.nombre ?? null); break;
      case "unsubscribe_seq": await unsubscribeSeq(db, run, a); await logEvent(db, run.channel_id, run.contact_id, "secuencia_cancel", "Secuencia cancelada", a.nombre ?? null); break;
      case "crear_pedido": await crearPedido(db, run, a, ctx); break;
      case "actualizar_pedido": await actualizarPedido(db, run, a, ctx); break;
    }
  }
}

// ── Pedidos (productos físicos, DEFINICION §6-SEPTIES) ─────────────
// Estados FINALES de un pedido (no se "reabre" con actualizar_pedido).
const ORDER_FINAL = ["confirmada", "anulada", "entregado_cobrado", "recogido", "cancelado", "rechazado", "no_recogido"];

function parseMonto(raw: unknown, ctx: any): number | undefined {
  const s = resolve(String(raw ?? ""), ctx).trim().replace(",", ".");
  if (!s) return undefined;
  const n = Number(s.replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

// Acción crear_pedido: { estado?, monto?, datos?: { zona:"{{zona_entrega}}", … } }
async function crearPedido(db: SupabaseClient, run: Run, a: any, ctx: any) {
  try {
    const ship: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(a.datos ?? {})) ship[k] = resolve(String(v ?? ""), ctx);
    const { data: c } = await db.from("contacts").select("product_id").eq("id", run.contact_id).maybeSingle();
    const { data: ord, error } = await db.from("orders").insert({
      channel_id: run.channel_id, contact_id: run.contact_id,
      product_id: (c as any)?.product_id ?? null,
      amount: parseMonto(a.monto ?? a.amount, ctx) ?? 0,
      estado: a.estado || "carrito", shipping: ship,
    }).select("id").single();
    if (error) throw new Error(error.message);
    run.vars._order_id = (ord as any).id;
    await logEvent(db, run.channel_id, run.contact_id, "nota", "Pedido creado", a.estado || "carrito");
  } catch (err) {
    await logEvent(db, run.channel_id, run.contact_id, "error", "Error al crear pedido", String((err as any)?.message ?? err));
  }
}

// Acción actualizar_pedido: { estado?, monto?, datos? } — actúa sobre el
// pedido del run (_order_id) o el último pedido NO final del contacto.
async function actualizarPedido(db: SupabaseClient, run: Run, a: any, ctx: any) {
  try {
    let orderId = run.vars._order_id as string | undefined;
    if (!orderId) {
      const { data: o } = await db.from("orders").select("id")
        .eq("contact_id", run.contact_id)
        .not("estado", "in", `(${ORDER_FINAL.map((e) => `"${e}"`).join(",")})`)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      orderId = (o as any)?.id;
    }
    if (!orderId) return;
    run.vars._order_id = orderId;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (a.estado) {
      patch.estado = resolve(String(a.estado), ctx);
      if (["confirmada", "entregado_cobrado", "recogido", "saldo_pagado"].includes(patch.estado as string)) {
        patch.confirmed_at = new Date().toISOString();
      }
    }
    const monto = parseMonto(a.monto ?? a.amount, ctx);
    if (monto !== undefined) patch.amount = monto;
    if (a.datos && Object.keys(a.datos).length) {
      const { data: cur } = await db.from("orders").select("shipping").eq("id", orderId).maybeSingle();
      const ship: Record<string, unknown> = { ...((cur as any)?.shipping ?? {}) };
      for (const [k, v] of Object.entries(a.datos)) ship[k] = resolve(String(v ?? ""), ctx);
      patch.shipping = ship;
    }
    const { error } = await db.from("orders").update(patch).eq("id", orderId);
    if (error) throw new Error(error.message);
    if (a.estado) await logEvent(db, run.channel_id, run.contact_id, "nota", "Pedido → " + patch.estado);
  } catch (err) {
    await logEvent(db, run.channel_id, run.contact_id, "error", "Error al actualizar pedido", String((err as any)?.message ?? err));
  }
}

// Suscribe (o reactiva) al contacto en una secuencia de remarketing.
async function subscribeSeq(db: SupabaseClient, run: Run, a: any) {
  let seqId = a.sequence_id;
  if (!seqId && a.nombre) {
    const { data } = await db.from("sequences").select("id")
      .eq("channel_id", run.channel_id).eq("nombre", a.nombre).maybeSingle();
    seqId = (data as any)?.id;
  }
  if (!seqId) return;
  await db.from("sequence_subscriptions").upsert({
    channel_id: run.channel_id, contact_id: run.contact_id, sequence_id: seqId,
    estado: "activa", paso_actual: 0, updated_at: new Date().toISOString(),
  }, { onConflict: "contact_id,sequence_id" });
}
async function unsubscribeSeq(db: SupabaseClient, run: Run, a: any) {
  let q = db.from("sequence_subscriptions").update({ estado: "cancelada", updated_at: new Date().toISOString() })
    .eq("contact_id", run.contact_id);
  if (a.sequence_id) q = q.eq("sequence_id", a.sequence_id);
  await q;
}

// Notifica a los admins del canal por Telegram (bot token en Vault).
async function notifyAdmin(db: SupabaseClient, run: Run, text: string, photoUrl?: string) {
  if (!text) return;
  const { data: channel } = await db.from("channels")
    .select("telegram_chat_ids, nombre").eq("id", run.channel_id).maybeSingle();
  const chatIds = (channel as any)?.telegram_chat_ids ?? [];
  if (!chatIds.length) return;
  const secrets = await getChannelSecrets(db, run.channel_id);
  const token = secrets?.telegram_bot_token;
  if (!token) { console.warn("[notify_admin] canal sin telegram_bot_token"); return; }
  const prefix = (channel as any)?.nombre ? `[${(channel as any).nombre}] ` : "";
  await sendTelegram(token, chatIds, prefix + text, photoUrl);
}

// ── Nodo IA (Claude/ChatGPT): generar texto, analizar imagen o extraer ─
// Conocimiento del canal (negocio + perfiles de IA por rol), cacheado por run.
async function channelIaInfo(db: SupabaseClient, run: Run): Promise<{ negocio: string | null; perfiles: any }> {
  let info = (run as any)._chIa;
  if (!info) {
    info = { negocio: null, perfiles: {} };
    try {
      const { data: ch } = await db.from("channels")
        .select("negocio, ia_perfiles").eq("id", run.channel_id).maybeSingle();
      info.negocio = (ch as any)?.negocio ?? null;
      info.perfiles = (ch as any)?.ia_perfiles ?? {};
    } catch (_) { /* migración 0023 pendiente */ }
    (run as any)._chIa = info;
  }
  return info;
}
// Perfil por defecto según la operación del nodo (§6-OCTIES).
const PERFIL_POR_OP: Record<string, string> = {
  generar_texto: "ventas", analizar_imagen: "ocr", extraer: "extraccion",
};

async function runIa(db: SupabaseClient, run: Run, node: Node, ctx: any) {
  const cfg = node.config ?? {};
  const op = cfg.operacion ?? "generar_texto";
  const maxTokens = cfg.max_tokens ? Number(cfg.max_tokens) : undefined;
  const prompt = resolve(String(cfg.prompt ?? ""), ctx);
  const info = await channelIaInfo(db, run);

  // Prompt de sistema en 3 niveles (§6-OCTIES): negocio → producto → nodo.
  let system = (cfg.system ?? cfg.contexto) ? resolve(String(cfg.system ?? cfg.contexto), ctx) : undefined;
  if (op === "generar_texto" && cfg.usar_conocimiento !== false) {
    const parts: string[] = [];
    if (info.negocio) parts.push("## Sobre el negocio\n" + info.negocio);
    if (ctx.contexto_producto) parts.push(`## Sobre el producto${ctx.producto_nombre ? ` (${ctx.producto_nombre})` : ""}\n` + ctx.contexto_producto);
    if (ctx.faq) parts.push("## Preguntas frecuentes y objeciones\n" + ctx.faq);
    if (system) parts.push(system);
    if (parts.length) system = parts.join("\n\n");
  }

  try {
    // Resolver proveedor + modelo: override del nodo > perfil del rol > default del canal.
    const perfilKey = cfg.perfil || PERFIL_POR_OP[op];
    const perfil = perfilKey ? (info.perfiles?.[perfilKey] ?? null) : null;
    const wantProvider = cfg.proveedor && cfg.proveedor !== "auto"
      ? cfg.proveedor
      : (perfil?.proveedor && perfil.proveedor !== "auto" ? perfil.proveedor : null);
    const { data: aiRows } = await db.rpc("get_channel_ai_active", {
      p_channel_id: run.channel_id, p_provider: wantProvider,
    });
    const ai = Array.isArray(aiRows) ? aiRows[0] : aiRows;
    if (!ai?.api_key) throw new Error("IA no configurada en este canal (Configuraciones)");
    const provider = ai.provider as Provider;
    const model = cfg.modelo || (perfil?.proveedor === ai.provider ? perfil?.modelo : null) || ai.model || undefined;

    let content: string | ContentBlock[] = prompt;
    if (op === "analizar_imagen") {
      // La imagen viene de una variable de config, o del último input del contacto.
      const img = cfg.imagen_var ? ctx[cfg.imagen_var] : (ctx.last_image ?? run.vars._last_image);
      if (!img) throw new Error("no hay imagen para analizar");
      let src = String(img);
      // "wa-media:<id>" = media privado de WhatsApp → descargar con el token
      // del canal y pasarlo como base64 (el LLM no puede leer URLs firmadas).
      if (src.startsWith("wa-media:")) {
        const secrets = await getChannelSecrets(db, run.channel_id);
        if (!secrets?.access_token) throw new Error("canal sin access_token para leer el media");
        src = await fetchMediaAsDataUri(src.slice("wa-media:".length), secrets.access_token);
      }
      content = [imageBlock(src), { type: "text", text: prompt }];
    }

    const result = await runAI({
      provider, apiKey: ai.api_key, model, system, content, maxTokens,
      jsonSchema: op === "extraer" ? cfg.json_schema : undefined,
    });

    // Guardar el resultado como variable del run y (si existe) campo persistente.
    if (cfg.guardar_en) {
      run.vars[cfg.guardar_en] = result;
      await setField(db, run.channel_id, run.contact_id, cfg.guardar_en, result);
    }
    // Enviar el resultado al usuario (por defecto sí, salvo que se desactive).
    const enviar = cfg.enviar ?? (op === "generar_texto");
    if (enviar && result) await emit(db, run, { text: result }, ctx);

    run.current_node_id =
      (await nextNode(db, run.flow_id, node.id, "exito")) ??
      (await nextNode(db, run.flow_id, node.id, "continuar"));
  } catch (err) {
    console.error("nodo ia falló:", (err as any)?.message ?? err);
    run.vars._ia_error = String((err as any)?.message ?? err);
    await logEvent(db, run.channel_id, run.contact_id, "error", "Error en nodo IA", String((err as any)?.message ?? err));
    run.current_node_id =
      (await nextNode(db, run.flow_id, node.id, "fallo")) ??
      (await nextNode(db, run.flow_id, node.id, "continuar"));
  }
}

// ── Nodo Google Sheets: registra una fila vía webhook de Apps Script ─
// El usuario publica un Apps Script en su hoja (Ajustes → Google Sheets) que
// recibe { hoja, fila } y agrega la fila. Nodo solo hace POST a esa URL.
async function runGoogleSheets(db: SupabaseClient, run: Run, node: Node, ctx: any) {
  const cfg = node.config ?? {};
  try {
    const { data: ch } = await db.from("channels").select("gsheets").eq("id", run.channel_id).maybeSingle();
    const url = (ch as any)?.gsheets?.webhook_url;
    if (!url) throw new Error("Google Sheets no está conectado (Ajustes → Google Sheets)");
    const accion = cfg.accion === "update" ? "update" : "append";
    // columnas: [{ col:"Fecha", valor:"{{fecha_compra}}" }, …] → { Fecha: "13/07/2026", … }
    // En "append" = celdas de la fila nueva; en "update" = celdas a modificar.
    const fila: Record<string, string> = {};
    for (const c of cfg.columnas ?? []) {
      if (!c?.col) continue;
      fila[String(c.col)] = resolve(String(c.valor ?? ""), ctx);
    }
    const payload: Record<string, unknown> = { accion, hoja: cfg.hoja || undefined, fila };
    if (accion === "update") {
      // buscar: [{ col:"Nº Operación", valor:"{{op}}" }] → localizar la fila.
      const buscar: Record<string, string> = {};
      for (const b of cfg.buscar ?? []) if (b?.col) buscar[String(b.col)] = resolve(String(b.valor ?? ""), ctx);
      payload.buscar = buscar;
    }
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Apps Script respondió " + res.status);
    await logEvent(db, run.channel_id, run.contact_id, "nota", accion === "update" ? "📊 Fila actualizada en Google Sheets" : "📊 Fila enviada a Google Sheets");
    run.current_node_id =
      (await nextNode(db, run.flow_id, node.id, "exito")) ??
      (await nextNode(db, run.flow_id, node.id, "continuar"));
  } catch (err) {
    await logEvent(db, run.channel_id, run.contact_id, "error", "Error al escribir en Google Sheets", String((err as any)?.message ?? err));
    run.current_node_id =
      (await nextNode(db, run.flow_id, node.id, "fallo")) ??
      (await nextNode(db, run.flow_id, node.id, "continuar"));
  }
}

// ── Nodo Evento Facebook (CAPI): Lead / InitiateCheckout / Purchase ─
async function runEventoFb(db: SupabaseClient, run: Run, node: Node, ctx: any) {
  const cfg = node.config ?? {};
  const eventName = cfg.event_name ?? "Lead";
  const valRaw = resolve(String(cfg.value ?? ""), ctx).trim();
  const value = valRaw ? Number(valRaw.replace(",", ".")) : undefined;
  const orderId = cfg.order_id ? resolve(String(cfg.order_id), ctx).trim() || undefined : undefined;
  const currency = cfg.currency || "PEN";

  const res = await sendCapiEvent(db, run.channel_id, run.contact_id, {
    eventName, value: Number.isFinite(value as number) ? value : undefined,
    currency, orderId,
  });
  if (!res.ok) { run.vars._capi_error = res.error; await logEvent(db, run.channel_id, run.contact_id, "error", "Error al enviar evento a Meta", String(res.error ?? "")); }

  // En una compra confirmada, registrar la orden (métricas de producto del
  // Dashboard) y un evento de compra en el Timeline.
  if (res.ok && eventName === "Purchase") {
    const { data: c } = await db.from("contacts").select("product_id").eq("id", run.contact_id).maybeSingle();
    await db.from("orders").insert({
      channel_id: run.channel_id, contact_id: run.contact_id,
      product_id: (c as any)?.product_id ?? null,
      amount: Number.isFinite(value as number) ? value : 0,
      currency, order_id: orderId ?? null, estado: "confirmada",
      confirmed_at: new Date().toISOString(),
    }); // si la tabla orders no existe (0017 pendiente) o el order_id se repite, el error se ignora
    await logEvent(db, run.channel_id, run.contact_id, "compra", "Compra registrada", value ? `${currency} ${value}` : "");
  }

  const handle = res.ok ? "exito" : "fallo";
  run.current_node_id =
    (await nextNode(db, run.flow_id, node.id, handle)) ??
    (await nextNode(db, run.flow_id, node.id, "continuar"));
}

// ── Contexto y resolución de variables {{ }} ───────────────────────
async function buildContext(db: SupabaseClient, run: Run) {
  const { data: c } = await db.from("contacts")
    .select("nombre, wa_id, stage, last_input, last_input_type, product_id, ad_id, ctwa_clid, source, created_at")
    .eq("id", run.contact_id).maybeSingle();
  const { data: fields } = await db.from("contact_field_values")
    .select("value, custom_fields!inner(key)").eq("contact_id", run.contact_id);
  // Fecha/hora actuales en la zona del negocio (para {{fecha}}, {{fecha_hora}}).
  const now = new Date();
  const fFecha = new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric" }).format(now);
  const fHora = new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit" }).format(now);
  const ctx: any = {
    nombre: c?.nombre ?? "", telefono: c?.wa_id ?? "", wa_id: c?.wa_id ?? "",
    stage: c?.stage ?? "", last_input: c?.last_input ?? "",
    last_input_type: (c as any)?.last_input_type ?? "",
    // Atribución del anuncio (Click-to-WhatsApp) capturada en el primer mensaje.
    ad_id: (c as any)?.ad_id ?? "", ctwa_clid: (c as any)?.ctwa_clid ?? "", origen: (c as any)?.source ?? "",
    // Fecha/hora de AHORA (para sellar {{fecha}} de compra con un set_field).
    fecha: fFecha, hora: fHora, fecha_hora: `${fFecha} ${fHora}`,
  };
  // PRECEDENCIA (de menos a más específico; lo de abajo pisa a lo de arriba):
  //   Campos del Bot (global) → datos del Producto → run.vars → Campos del
  //   contacto. Así lo específico gana: el dato de un producto pisa al global,
  //   y el dato propio del contacto pisa a todo.

  // 1) Campos del Bot (sección Campos → "Campos del Bot"): globales fijos del
  //    canal, su valor vive en custom_fields.valor y aplica a TODA conversación.
  try {
    let bf = (run as any)._botFields;
    if (!bf) {
      bf = {};
      const { data: fixed } = await db.from("custom_fields")
        .select("key, valor").eq("channel_id", run.channel_id).eq("modo", "fijo");
      for (const f of fixed ?? []) if ((f as any).valor != null) bf[(f as any).key] = (f as any).valor;
      (run as any)._botFields = bf;
    }
    for (const [k, v] of Object.entries(bf)) ctx[k] = v;
  } catch (_) { /* columna valor pendiente (0013) */ }

  // 2) Campos FIJOS del producto (§6-SEXIES): la ficha del producto expone sus
  // datos como variables ({{precio}}, {{link_entrega}}, {{producto_nombre}},
  // {{adelanto}}, {{envio_*}}…). Cacheado por run (no cambian a mitad).
  try {
    const prodId = (c as any)?.product_id;
    if (prodId) {
      let pc = (run as any)._prodCtx;
      if (!pc || pc._id !== prodId) {
        const { data: p } = await db.from("products").select("nombre, config").eq("id", prodId).maybeSingle();
        pc = { _id: prodId };
        if (p) {
          pc.producto_nombre = (p as any).nombre;
          for (const [k, v] of Object.entries((p as any).config ?? {})) {
            if (v == null || typeof v === "object") continue;
            pc[k] = v;
          }
          const env = (p as any).config?.envio;
          if (env && typeof env === "object") {
            for (const [k, v] of Object.entries(env)) {
              if (v == null || typeof v === "object") continue;
              pc["envio_" + k] = v;
            }
            // {{adelanto}} listo para usar (modo fijo; % se calcula sobre precio)
            const val = Number(env.adelanto_valor ?? 0);
            const precio = Number((p as any).config?.precio);
            pc.adelanto = env.adelanto_modo === "porcentaje" && Number.isFinite(precio) && precio > 0
              ? (precio * val / 100).toFixed(2)
              : val;
          }
        }
        (run as any)._prodCtx = pc;
      }
      for (const [k, v] of Object.entries(pc)) if (k !== "_id") ctx[k] = v;
    }
  } catch (_) { /* columnas pendientes */ }
  // 3) Variables del run en curso, y 4) Campos del contacto (lo más específico).
  Object.assign(ctx, run.vars);
  for (const f of fields ?? []) ctx[(f as any).custom_fields.key] = (f as any).value;
  // Último pedido del contacto → variables {{pedido_*}} para los flujos de
  // notificación de físicos (guía, saldo, clave de recojo…). Best-effort.
  try {
    const { data: o } = await db.from("orders")
      .select("estado, amount, currency, shipping").eq("contact_id", run.contact_id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (o) {
      ctx.pedido_estado = (o as any).estado;
      ctx.pedido_monto = (o as any).amount;
      for (const [k, v] of Object.entries((o as any).shipping ?? {})) ctx["pedido_" + k] = v;
    }
  } catch (_) { /* columna/tabla pendiente */ }
  return ctx;
}
function resolve(text: string, ctx: any): string {
  return (text ?? "").replace(/\{\{\s*([\w\-.]+)\s*\}\}/g, (_, k) => (ctx[k] ?? "").toString());
}

// ── Helpers de datos ───────────────────────────────────────────────
async function initialNode(db: SupabaseClient, flowId: string): Promise<Node | null> {
  const { data } = await db.from("flow_nodes").select("*")
    .eq("flow_id", flowId).eq("es_inicial", true).maybeSingle();
  if (data) return data as Node;
  const { data: any0 } = await db.from("flow_nodes").select("*")
    .eq("flow_id", flowId).order("created_at").limit(1).maybeSingle();
  return any0 as Node | null;
}
async function getNode(db: SupabaseClient, nodeId: string): Promise<Node | null> {
  const { data } = await db.from("flow_nodes").select("*").eq("id", nodeId).maybeSingle();
  return data as Node | null;
}
async function nextNode(db: SupabaseClient, flowId: string, nodeId: string, handle: string): Promise<string | null> {
  const { data } = await db.from("flow_edges").select("target_node")
    .eq("flow_id", flowId).eq("source_node", nodeId).eq("source_handle", handle)
    .limit(1).maybeSingle();
  return (data as any)?.target_node ?? null;
}
async function resolveTargetFlow(db: SupabaseClient, channelId: string, config: any): Promise<string | null> {
  if (config?.target_flow_id) return config.target_flow_id;
  if (config?.target_role) {
    const { data } = await db.from("flows").select("id")
      .eq("channel_id", channelId).eq("role", config.target_role).eq("estado", "activo")
      .limit(1).maybeSingle();
    return (data as any)?.id ?? null;
  }
  return null;
}
// ── Bitácora de actividad del contacto (Timeline de la Bandeja) ────
// Best-effort: si la tabla contact_events no existe aún (migración 0021
// pendiente), el error se ignora silenciosamente.
async function logEvent(
  db: SupabaseClient, channelId: string, contactId: string,
  tipo: string, titulo: string, detalle?: string | null,
) {
  try {
    await db.from("contact_events").insert({
      channel_id: channelId, contact_id: contactId, tipo, titulo, detalle: detalle ?? null,
    });
  } catch (_) { /* tabla pendiente de migrar */ }
}

// Atribuye el contacto al producto del flujo (para el emoji y filtros de la
// Bandeja). Se activa al entrar a un flujo ligado a un producto.
async function markProduct(db: SupabaseClient, contactId: string, productId?: string | null) {
  if (!productId) return;
  try { await db.from("contacts").update({ product_id: productId }).eq("id", contactId); } catch (_) { /* columna pendiente */ }
}

async function setField(db: SupabaseClient, channelId: string, contactId: string, key: string, value: string | null) {
  if (!key) return;
  let { data: f } = await db.from("custom_fields").select("id")
    .eq("channel_id", channelId).eq("key", key).limit(1).maybeSingle();
  // Si el flujo escribe en un campo que no existe, se crea solo (dinámico) →
  // el dato persiste y aparece en el panel del contacto. Cumple "declarar
  // campos desde los nodos" sin obligar a crearlos antes en la sección Campos.
  if (!f) {
    const nombre = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    await db.from("custom_fields").upsert(
      { channel_id: channelId, key, nombre, tipo: "text", modo: "dinamico" },
      { onConflict: "channel_id,key", ignoreDuplicates: true },
    );
    ({ data: f } = await db.from("custom_fields").select("id")
      .eq("channel_id", channelId).eq("key", key).maybeSingle());
  }
  if (!f) return;
  await db.from("contact_field_values").upsert(
    { contact_id: contactId, field_id: (f as any).id, value, updated_at: new Date().toISOString() },
    { onConflict: "contact_id,field_id" },
  );
}
async function hasTag(db: SupabaseClient, contactId: string, tagName: string): Promise<boolean> {
  const { data } = await db.from("contact_tags")
    .select("tag_id, tags!inner(nombre)").eq("contact_id", contactId);
  return (data ?? []).some((r: any) => r.tags?.nombre === tagName);
}
async function addTag(db: SupabaseClient, channelId: string, contactId: string, tagName: string) {
  let { data: tag } = await db.from("tags").select("id")
    .eq("channel_id", channelId).eq("nombre", tagName).maybeSingle();
  if (!tag) {
    const ins = await db.from("tags").insert({ channel_id: channelId, nombre: tagName }).select("id").single();
    tag = ins.data;
  }
  if (tag) await db.from("contact_tags").upsert({ contact_id: contactId, tag_id: (tag as any).id }, { onConflict: "contact_id,tag_id" });
}
async function removeTag(db: SupabaseClient, channelId: string, contactId: string, tagName: string) {
  const { data: tag } = await db.from("tags").select("id")
    .eq("channel_id", channelId).eq("nombre", tagName).maybeSingle();
  if (tag) await db.from("contact_tags").delete().eq("contact_id", contactId).eq("tag_id", (tag as any).id);
}
function normalize(s: string): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}
