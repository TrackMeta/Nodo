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
import { getAccessToken, sheetsAppend, sheetsUpdate } from "./gsheets.ts";
import { getChannelSecrets } from "./db.ts";
import { fetchMediaAsDataUri, fetchMediaBytes, MetaApiError, sendButtons, sendMedia, sendText } from "./meta.ts";

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

  // Interceptor de SALDO automático (Agente de Logística · modo auto): si entra
  // un comprobante y el contacto tiene un pedido "en_agencia" esperando el
  // saldo, la IA valida el pago y suelta la clave de recojo — o, ante cualquier
  // duda, lo deriva a "Aprobación de pagos" y avisa por Telegram.
  if (event.type === "message" && event.mediaRef && (event.msgType === "image" || !event.msgType)) {
    try {
      if (await maybeAutoSaldo(db, channelId, contactId, event)) return;
    } catch (e) { console.error("[autoSaldo]", (e as any)?.message ?? e); }
  }

  let run = await getActiveRun(db, contactId);

  if (run) {
    const ready = await resumeRun(db, run, event);
    if (!ready) return; // esperaba otra cosa (ej. buffer) → nada que hacer
  } else {
    if (event.type !== "message") return;
    const decision = await routeDecision(db, channelId, event.text, event.adId);
    const flow = decision.flow;
    if (!flow) return; // ningún flujo maneja este mensaje (ni por IA)
    // Registrar en la Timeline si el ruteo lo decidió la IA (transparencia).
    if (decision.tier === "ia" || decision.tier === "fallback") {
      await logEvent(db, channelId, contactId, "nota", "🧭 Ruteo por IA", decision.reason ?? "").catch(() => {});
    }
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

// ── Ruteo de inicio de chat ────────────────────────────────────────
// Decide qué flujo arranca un mensaje entrante, en cascada de 3 niveles:
//   1) referral (ad_id del anuncio)  2) keyword (frase clave, determinista)
//   3) IA Router (intención) → si ninguno, flujo de respaldo o nada.
export type RouteTier = "referral" | "keyword" | "entrada" | "ia" | "fallback" | "none";
export interface RouteResult {
  tier: RouteTier;
  flow: { id: string; nombre?: string } | null;
  confidence?: number;
  reason?: string;
}

// Niveles 1-2: determinista (referral + keyword + flujo de entrada).
function matchTrigger(db: SupabaseClient, channelId: string, text: string, adId?: string): Promise<RouteResult> {
  return (async () => {
    const norm = normalize(text);
    const { data: triggers } = await db.from("flow_triggers")
      .select("flow_id, tipo, config, flows!inner(id, nombre, estado, es_entrada)")
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
        if (ads.includes(String(adId))) return { tier: "referral", flow };
      }
      if (t.tipo === "keyword") {
        const kws: string[] = (t.config?.keywords ?? []).map(normalize);
        const mode = t.config?.match ?? "contiene";
        const hit = kws.some((k) =>
          k && (mode === "exacta" ? norm === k
            : mode === "empieza" ? norm.startsWith(k)
            : norm.includes(k))
        );
        if (hit && !kwHit) kwHit = flow; // keyword gana sobre entrada
      }
    }
    if (kwHit) return { tier: "keyword", flow: kwHit };
    if (entrada) return { tier: "entrada", flow: entrada };
    return { tier: "none", flow: null };
  })();
}

// Nivel 3: IA Router. Cuando ningún trigger determinista matchea, la IA lee
// el mensaje del cliente + la lista de productos activos (su Descripción/FAQ)
// y elige el que mejor calza. Solo rutea si supera el umbral de confianza; si
// no, cae al flujo de respaldo (menú) o a null. Requiere key de IA en el canal
// y ia_router.activo. Degrada en silencio ante cualquier error (nunca rompe).
async function aiRoute(db: SupabaseClient, channelId: string, text: string): Promise<RouteResult | null> {
  const clean = (text ?? "").trim();
  if (clean.length < 2) return null;
  try {
    const { data: ch } = await db.from("channels")
      .select("ia_router, ia_perfiles").eq("id", channelId).maybeSingle();
    const cfg = (ch as any)?.ia_router ?? {};
    if (!cfg.activo) return null;
    const umbral = Number.isFinite(Number(cfg.umbral)) ? Number(cfg.umbral) : 0.6;

    // Candidatos: flujos ACTIVOS con trigger keyword/entrada (los "puntos de
    // entrada" del canal), con su descripción de intención (producto o flujo).
    const { data: trg } = await db.from("flow_triggers")
      .select("tipo, flows!inner(id, nombre, estado, product_id, descripcion)")
      .eq("channel_id", channelId).eq("activo", true).in("tipo", ["keyword", "entrada"]);
    const flows = new Map<string, any>();
    for (const t of trg ?? []) {
      const f = (t as any).flows;
      if (f && f.estado === "activo" && !flows.has(f.id)) flows.set(f.id, f);
    }
    if (flows.size === 0) return null;

    const prodIds = [...new Set([...flows.values()].map((f) => f.product_id).filter(Boolean))];
    const prods = new Map<string, any>();
    if (prodIds.length) {
      const { data: ps } = await db.from("products").select("id, nombre, config").in("id", prodIds);
      for (const p of ps ?? []) prods.set((p as any).id, p);
    }
    const cands = [...flows.values()].map((f) => {
      const p = f.product_id ? prods.get(f.product_id) : null;
      const c = (p as any)?.config ?? {};
      const intent = c.intencion || c.contexto_producto || c.faq || f.descripcion || "";
      return { flow_id: f.id, label: (p as any)?.nombre || f.nombre || "Flujo", intent: String(intent).slice(0, 500) };
    });

    // Resolver proveedor + key (perfil del router, o el default del canal).
    const perfiles = (ch as any)?.ia_perfiles ?? {};
    const perfil = perfiles?.[cfg.perfil || "extraccion"] ?? null;
    const wantProvider = perfil?.proveedor && perfil.proveedor !== "auto" ? perfil.proveedor : null;
    const { data: aiRows } = await db.rpc("get_channel_ai_active", { p_channel_id: channelId, p_provider: wantProvider });
    const ai = Array.isArray(aiRows) ? aiRows[0] : aiRows;
    if (!ai?.api_key) return null; // sin IA configurada → no rutea (silencioso)
    const model = (perfil?.proveedor === ai.provider ? perfil?.modelo : null) || ai.model || undefined;

    const lista = cands.map((c, i) => `[${i + 1}] ${c.label}: ${c.intent || "(sin descripción)"}`).join("\n");
    const system = "Eres un clasificador de intención para un chatbot de ventas. Debes decidir a qué producto se refiere el mensaje de un cliente. Responde ÚNICAMENTE con un objeto JSON, sin texto adicional ni explicaciones.";
    const prompt = `Mensaje del cliente:\n"${clean}"\n\nProductos disponibles:\n${lista}\n\n` +
      `Elige el número del producto que el cliente quiere. Si el mensaje no calza claramente con ninguno (saludo genérico, spam, off-topic), usa 0.\n` +
      `Responde exactamente: {"idx": <número entre 0 y ${cands.length}>, "confianza": <0.0 a 1.0>}`;

    const raw = await runAI({ provider: ai.provider as Provider, apiKey: ai.api_key, model, system, content: prompt, maxTokens: 120 });
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) return null;
    let parsed: any;
    try { parsed = JSON.parse(m[0]); } catch { return null; }
    const idx = Number(parsed?.idx);
    const conf = Number(parsed?.confianza);

    if (Number.isInteger(idx) && idx >= 1 && idx <= cands.length && Number.isFinite(conf) && conf >= umbral) {
      const c = cands[idx - 1];
      return { tier: "ia", flow: { id: c.flow_id, nombre: c.label }, confidence: conf, reason: `IA eligió "${c.label}" (${Math.round(conf * 100)}%)` };
    }
    // Sin confianza suficiente → flujo de respaldo (menú) si está configurado.
    if (cfg.fallback_flow_id) {
      const { data: fb } = await db.from("flows")
        .select("id, nombre, estado").eq("id", cfg.fallback_flow_id).eq("channel_id", channelId).maybeSingle();
      if (fb && (fb as any).estado === "activo") {
        return { tier: "fallback", flow: { id: (fb as any).id, nombre: (fb as any).nombre }, confidence: Number.isFinite(conf) ? conf : undefined, reason: "IA sin confianza suficiente → flujo de respaldo" };
      }
    }
    return { tier: "none", flow: null, confidence: Number.isFinite(conf) ? conf : undefined, reason: "IA sin confianza suficiente" };
  } catch (e) {
    console.error("[aiRoute]", (e as any)?.message ?? e);
    return null; // decorativo: si la IA falla, el ruteo simplemente no arranca
  }
}

// Cascada completa (niveles 1-3). La usan runEngine (para arrancar) y la
// Edge Function route-test (simulador del panel, sin ejecutar nada).
export async function routeDecision(db: SupabaseClient, channelId: string, text: string, adId?: string): Promise<RouteResult> {
  const det = await matchTrigger(db, channelId, text, adId);
  if (det.flow) return det;
  const ia = await aiRoute(db, channelId, text);
  if (ia) return ia;
  return { tier: "none", flow: null };
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
    if (aw.guardar_en) {
      await setField(db, run.channel_id, run.contact_id, aw.guardar_en, event.text);
      await logEvent(db, run.channel_id, run.contact_id, "campo", "Campo capturado", `${aw.guardar_en}: ${event.text ?? ""}`.slice(0, 140));
    }
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
      case "rotador": {
        // Mensajes iniciales con ROTACIÓN de copy (evita baneos por repetir el
        // mismo saludo a todos). Cada variante = lista de burbujas (texto/media).
        // Elige una variante activa por PESO; si el rotador está apagado, usa
        // siempre la primera variante activa. Luego continúa al flujo de venta/IA.
        const all = (node.config?.variantes ?? []) as any[];
        const active = all.filter((v) => v.activo !== false && (v.bubbles?.length));
        if (active.length) {
          const rotOn = node.config?.activo !== false && active.length > 1;
          const chosen = rotOn ? pickWeighted(active) : active[0];
          for (const b of (chosen.bubbles ?? [])) await emit(db, run, b, ctx);
          await logEvent(db, run.channel_id, run.contact_id, "nota", "🎲 Variante inicial", chosen.nombre ?? "");
        }
        // "Y después": continuar a otro flujo (venta o IA) o terminar. Se guarda
        // dentro del rotador, así el flujo Bienvenida es un solo nodo.
        const des = node.config?.despues ?? {};
        if (des.modo === "flujo" && des.flow_id) {
          const { data: tf } = await db.from("flows")
            .select("id, nombre, product_id, estado").eq("id", des.flow_id).eq("channel_id", run.channel_id).maybeSingle();
          if (tf && (tf as any).estado === "activo") {
            run.flow_id = (tf as any).id;
            const init = await initialNode(db, run.flow_id);
            run.current_node_id = init?.id ?? null;
            await logEvent(db, run.channel_id, run.contact_id, "flujo_inicio", "Flujo iniciado", (tf as any).nombre ?? null);
            await markProduct(db, run.contact_id, (tf as any).product_id);
            break;
          }
        }
        run.current_node_id = await nextNode(db, run.flow_id, node.id, "continuar");
        break;
      }
      case "pregunta": {
        // Adjuntos multimedia (imagen/video/audio) que se envían ANTES de la pregunta.
        for (const b of (node.config?.media ?? [])) await emit(db, run, b, ctx);
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
  const d = run._delivery;

  // ── Burbuja de MEDIA (imagen/video/audio/documento) ──
  // media_url = URL pública (subida por media-upload). En WhatsApp se envía
  // por Graph; en webchat basta con insertar (el panel la renderiza).
  const mediaUrl = bubble.media_url ? resolve(String(bubble.media_url), ctx) : "";
  const mediaKind = bubble.media_kind as ("image" | "video" | "audio" | "document" | undefined);
  if (mediaUrl && mediaKind) {
    const caption = resolve(bubble.caption ?? bubble.text ?? "", ctx);
    let wamid = ""; let status = "sent"; let error: any = null;
    if (d?.mode === "whatsapp" && d.token && ctx.wa_id) {
      try {
        wamid = await sendMedia(d.phoneNumberId, d.token, ctx.wa_id, mediaKind, mediaUrl, caption || undefined, bubble.filename);
      } catch (e) {
        status = "failed";
        error = e instanceof MetaApiError ? e.meta : { message: String((e as any)?.message ?? e) };
        console.error("[emit] fallo envío media:", error);
      }
    }
    await db.from("messages").insert({
      channel_id: run.channel_id, contact_id: run.contact_id,
      direction: "out", type: mediaKind,
      content: { media_url: mediaUrl, caption: caption || "", mime: bubble.mime ?? "", filename: bubble.filename ?? "" },
      status, wamid: wamid || null, error,
    });
    return;
  }

  // ── Burbuja de TEXTO / BOTONES ──
  const isInteractive = !!bubble.buttons?.length;
  const content: any = {};
  if (text) content.text = text;
  if (bubble.media_id) content.media_id = bubble.media_id;
  if (isInteractive) content.buttons = bubble.buttons;

  let wamid = ""; let status = "sent"; let error: any = null;
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

// Emite el texto que generó la IA, resolviendo los marcadores [[media:tag]]:
// por cada marcador envía el archivo correspondiente del catálogo del producto
// (config.ia_multimedia, expuesto en ctx._ia_multimedia) intercalado con el
// texto. Los marcadores desconocidos se descartan (no se filtran al usuario).
async function emitIaText(db: SupabaseClient, run: any, result: string, ctx: any) {
  const re = /\[\[media:([\w-]+)\]\]/g;
  if (!re.test(result)) { if (result.trim()) await emit(db, run, { text: result }, ctx); return; }
  const catalog: any[] = Array.isArray(ctx?._ia_multimedia) ? ctx._ia_multimedia : [];
  re.lastIndex = 0;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(result)) !== null) {
    const before = result.slice(last, m.index).trim();
    if (before) await emit(db, run, { text: before }, ctx);
    const asset = catalog.find((x) => x && x.tag === m![1]);
    if (asset && asset.media_url) {
      await emit(db, run, {
        media_kind: asset.media_kind, media_url: asset.media_url,
        mime: asset.mime, filename: asset.filename, caption: "",
      }, ctx);
    }
    last = m.index + m[0].length;
  }
  const rest = result.slice(last).trim();
  if (rest) await emit(db, run, { text: rest }, ctx);
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
  await deliverStep(db, channelId, contactId, { mensaje: text });
}

// Envía un PASO de secuencia con el mismo motor que los "mensajes iniciales":
// soporta burbujas multimedia (texto/imagen/video/audio) y ROTACIÓN de
// variantes ponderadas (paso.variantes[].bubbles). Formatos aceptados:
//   { mensaje }                         → una burbuja de texto (compat viejo)
//   { bubbles:[...] }                   → una o varias burbujas
//   { rotacion, variantes:[{peso,activo,bubbles}] } → rota una variante
export async function deliverStep(db: SupabaseClient, channelId: string, contactId: string, paso: any) {
  const run: any = { channel_id: channelId, contact_id: contactId, vars: {} };
  const ctx = await buildContext(db, run);

  // Elegir las burbujas a enviar.
  let bubbles: any[] = [];
  const variantes = Array.isArray(paso?.variantes) ? paso.variantes : null;
  if (variantes && variantes.length) {
    const active = variantes.filter((v: any) => v.activo !== false && (v.bubbles?.length));
    if (active.length) {
      const rotOn = paso.rotacion !== false && active.length > 1;
      const chosen = rotOn ? pickWeighted(active) : active[0];
      bubbles = chosen.bubbles ?? [];
    }
  } else if (Array.isArray(paso?.bubbles) && paso.bubbles.length) {
    bubbles = paso.bubbles;
  } else if (paso?.mensaje) {
    bubbles = [{ text: String(paso.mensaje) }];
  }

  for (const b of bubbles) {
    if (b && (b.media_url || (b.text && String(b.text).trim()))) await emit(db, run, b, ctx);
  }
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
        await logEvent(db, run.channel_id, run.contact_id, "campo", "Campo actualizado", `${a.key}: ${v}`.slice(0, 140));
        break;
      }
      case "clear_field":
        delete run.vars[a.key]; await setField(db, run.channel_id, run.contact_id, a.key, null);
        await logEvent(db, run.channel_id, run.contact_id, "campo", "Campo borrado", a.key);
        break;
      case "append_field": {
        const prev = ctx[a.key] ? String(ctx[a.key]) + "\n" : "";
        const v = prev + resolve(String(a.valor ?? ""), ctx);
        run.vars[a.key] = v;
        await setField(db, run.channel_id, run.contact_id, a.key, v);
        await logEvent(db, run.channel_id, run.contact_id, "campo", "Campo actualizado", `${a.key}: ${v}`.slice(0, 140));
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
      // ── Conversación / contacto ──
      case "nota":
        await logEvent(db, run.channel_id, run.contact_id, "nota", resolve(String(a.valor ?? a.texto ?? ""), ctx) || "Nota"); break;
      case "seguimiento_on":
        await db.from("conversations").update({ requiere_humano: true }).eq("contact_id", run.contact_id);
        await logEvent(db, run.channel_id, run.contact_id, "nota", "Marcado para seguimiento"); break;
      case "seguimiento_off":
        await db.from("conversations").update({ requiere_humano: false }).eq("contact_id", run.contact_id);
        await logEvent(db, run.channel_id, run.contact_id, "nota", "Seguimiento quitado"); break;
      case "archivar":
        await db.from("conversations").update({ archivada: true }).eq("contact_id", run.contact_id);
        await logEvent(db, run.channel_id, run.contact_id, "nota", "Conversación archivada"); break;
      case "desarchivar":
        await db.from("conversations").update({ archivada: false }).eq("contact_id", run.contact_id);
        await logEvent(db, run.channel_id, run.contact_id, "nota", "Conversación desarchivada"); break;
      case "bloquear":
        await db.from("contacts").update({ bloqueado: true, bot_activo: false }).eq("id", run.contact_id);
        await logEvent(db, run.channel_id, run.contact_id, "nota", "Contacto bloqueado"); break;
      case "borrar_info":
        await db.from("contact_field_values").delete().eq("contact_id", run.contact_id);
        run.vars = {};
        await logEvent(db, run.channel_id, run.contact_id, "nota", "Información del usuario borrada"); break;
      // ── Bot / atención humana ──
      case "return_bot":
        await db.from("contacts").update({ bot_activo: true }).eq("id", run.contact_id);
        await db.from("conversations").update({ requiere_humano: false }).eq("contact_id", run.contact_id);
        await logEvent(db, run.channel_id, run.contact_id, "humano", "Devuelto al bot"); break;
      // ── Herramientas (calculan un valor y lo guardan en un campo) ──
      case "fecha_formato": {
        const v = formatFechaAhora(a.formato);
        if (a.guardar_en) { run.vars[a.guardar_en] = v; await setField(db, run.channel_id, run.contact_id, a.guardar_en, v); await logEvent(db, run.channel_id, run.contact_id, "campo", "Fecha formateada", `${a.guardar_en}: ${v}`); }
        break;
      }
      case "aleatorio": {
        const v = generarAleatorio(a);
        if (a.guardar_en) { run.vars[a.guardar_en] = v; await setField(db, run.channel_id, run.contact_id, a.guardar_en, v); await logEvent(db, run.channel_id, run.contact_id, "campo", "Valor aleatorio", `${a.guardar_en}: ${v}`); }
        break;
      }
      case "contar_caracteres": {
        const src = resolve(String(a.origen ?? a.valor ?? ""), ctx);
        const v = String([...src].length);
        if (a.guardar_en) { run.vars[a.guardar_en] = v; await setField(db, run.channel_id, run.contact_id, a.guardar_en, v); await logEvent(db, run.channel_id, run.contact_id, "campo", "Contador de caracteres", `${a.guardar_en}: ${v}`); }
        break;
      }
    }
  }
}

// Fecha/hora de AHORA en la zona del negocio, según el formato elegido.
function formatFechaAhora(fmt?: string): string {
  const now = new Date(); const TZ = "America/Lima";
  const p = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-PE", { timeZone: TZ, ...opts }).format(now);
  switch (fmt) {
    case "yyyy-mm-dd": { const [d, m, y] = p({ day: "2-digit", month: "2-digit", year: "numeric" }).split("/"); return `${y}-${m}-${d}`; }
    case "hh:mm": return p({ hour: "2-digit", minute: "2-digit", hour12: false });
    case "dia_semana": return p({ weekday: "long" });
    case "dd/mm/yyyy hh:mm": return `${p({ day: "2-digit", month: "2-digit", year: "numeric" })} ${p({ hour: "2-digit", minute: "2-digit", hour12: false })}`;
    case "dd/mm/yyyy": default: return p({ day: "2-digit", month: "2-digit", year: "numeric" });
  }
}

// Genera un número o texto aleatorio. { modo:"numero"|"texto", min,max,longitud }
function generarAleatorio(a: any): string {
  if (a.modo === "texto") {
    const n = Math.max(1, Number(a.longitud ?? 6));
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = ""; for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  const min = Math.ceil(Number(a.min ?? 1)), max = Math.floor(Number(a.max ?? 100));
  const lo = Math.min(min, max), hi = Math.max(min, max);
  return String(Math.floor(Math.random() * (hi - lo + 1)) + lo);
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

// Dispara los flujos suscritos a un estado de pedido (igual que order-update),
// usado por la validación automática de saldo para soltar la clave de recojo.
async function triggerPedidoEstado(db: SupabaseClient, channelId: string, contactId: string, estado: string) {
  const { data: trigs } = await db.from("flow_triggers")
    .select("flow_id, config, interrumpe, flows!inner(id, estado)")
    .eq("channel_id", channelId).eq("tipo", "pedido_estado").eq("activo", true);
  for (const t of trigs ?? []) {
    const estados: string[] = ((t as any).config?.estados ?? []).map(String);
    if (!estados.includes(estado)) continue;
    if ((t as any).flows?.estado !== "activo") continue;
    try {
      const ok = await startFlowRun(db, channelId, contactId, (t as any).flow_id, { force: !!(t as any).interrumpe });
      if (ok) break;
    } catch (e) { console.error("[triggerPedidoEstado]", (e as any)?.message ?? e); }
  }
}

// Esquema de la validación del comprobante de saldo (salida estructurada).
const SALDO_SCHEMA = {
  type: "object",
  properties: {
    es_pago: { type: "boolean", description: "true si la imagen es un comprobante de pago" },
    valido: { type: "boolean", description: "true si el pago es legítimo según las reglas del negocio" },
    monto: { type: ["number", "null"], description: "monto pagado (número), o null si no se lee" },
    operacion: { type: ["string", "null"], description: "número de operación/constancia, o null" },
    motivo: { type: "string", description: "explicación breve" },
  },
  required: ["es_pago", "valido", "motivo"],
  additionalProperties: false,
} as const;

// Validación AUTOMÁTICA del saldo remanente (modo auto del Agente de Logística).
// Devuelve true si "tomó" el mensaje (no debe seguir el flujo normal).
async function maybeAutoSaldo(db: SupabaseClient, channelId: string, contactId: string, event: EngineEvent): Promise<boolean> {
  // 1) ¿Pedido en agencia esperando el saldo?
  const { data: order } = await db.from("orders")
    .select("id, estado, amount, currency, shipping")
    .eq("channel_id", channelId).eq("contact_id", contactId).eq("estado", "en_agencia")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!order) return false;
  const ship = ((order as any).shipping ?? {}) as Record<string, any>;

  // 2) ¿Modo automático activado en IA · Pedidos?
  const { data: ch } = await db.from("channels").select("pedidos_config, ocr_config").eq("id", channelId).maybeSingle();
  const log = (ch as any)?.pedidos_config?.log ?? {};
  if (log.modo !== "auto") return false;

  // 3) Sube el comprobante a storage propio → URL pública (IA + Telegram).
  const url = await ingestImage(db, channelId, contactId, event.mediaRef!).catch(() => null);
  if (!url) return false; // no se pudo leer → que lo maneje el flujo normal

  const saldo = Number(ship.saldo);
  const clave = ship.clave_recojo;
  const tol = Math.max(0, Number(log.tolerancia ?? 0));
  const runlike = { channel_id: channelId, contact_id: contactId } as any;

  // 4) Valida con la IA (visión) usando el Validador del canal + salida JSON.
  const { data: aiRows } = await db.rpc("get_channel_ai_active", { p_channel_id: channelId, p_provider: null });
  const ai = Array.isArray(aiRows) ? aiRows[0] : aiRows;
  if (!ai?.api_key) return false; // sin IA → que lo tome un humano por el flujo normal
  const ocrSys = buildOcrSystem((ch as any)?.ocr_config) ?? "Eres un validador experto de comprobantes de pago de Perú.";
  const system = ocrSys +
    "\n\nDevuelve SOLO un JSON con los campos: es_pago, valido, monto, operacion, motivo. " +
    "`valido` es true solo si el pago es legítimo, va al destinatario correcto y no hay señales de fraude/montaje.";

  let parsed: any = null;
  try {
    const raw = await runAI({
      provider: ai.provider as Provider, apiKey: ai.api_key, model: ai.model || undefined,
      system,
      content: [imageBlock(url), { type: "text", text: `El cliente debe pagar un SALDO de ${Number.isFinite(saldo) ? saldo : "?"} ${(order as any).currency ?? ""}. Analiza si este comprobante corresponde a ese pago.` }],
      maxTokens: 500, jsonSchema: SALDO_SCHEMA as unknown as Record<string, unknown>,
    });
    parsed = JSON.parse(raw);
  } catch (_) { parsed = null; }

  // Si no es un pago (o no se pudo analizar), no interceptamos: sigue el flujo normal.
  if (!parsed || !parsed.es_pago) return false;

  const monto = Number(parsed.monto);
  const oper = parsed.operacion ? String(parsed.operacion).trim() : null;

  // 5) Anti-reúso: la misma operación no puede validar dos pedidos.
  let reuse = false;
  if (oper) {
    const { data: dup } = await db.from("orders").select("id")
      .eq("channel_id", channelId).eq("shipping->>saldo_operacion", oper).limit(1).maybeSingle();
    reuse = !!dup;
  }
  const montoOk = Number.isFinite(monto) && Number.isFinite(saldo) && saldo > 0 && monto >= (saldo - tol);
  const puedeAuto = !!parsed.valido && montoOk && !reuse && !!clave;

  if (puedeAuto) {
    // ✅ Todo cuadra → saldo_pagado (guarda la operación) + dispara la entrega de clave.
    await db.from("orders").update({
      estado: "saldo_pagado", confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      shipping: { ...ship, saldo_operacion: oper, saldo_validado_auto: true, saldo_comprobante: url },
    }).eq("id", (order as any).id);
    await logEvent(db, channelId, contactId, "nota", "Saldo validado automáticamente", `Monto ${monto}${oper ? " · op " + oper : ""}`);
    await triggerPedidoEstado(db, channelId, contactId, "saldo_pagado");
    await notifyAdmin(db, runlike, `✅ Saldo validado automáticamente y clave de recojo enviada. Monto ${monto}${oper ? " · op " + oper : ""}.`, url);
    return true;
  }

  // ⚠️ Ante cualquier duda → Aprobación de pagos + aviso por Telegram + panel.
  const motivo = reuse ? "operación ya usada"
    : !montoOk ? `monto no coincide (pagó ${Number.isFinite(monto) ? monto : "?"}, saldo ${Number.isFinite(saldo) ? saldo : "?"})`
    : !clave ? "el pedido no tiene clave de recojo cargada"
    : (parsed.motivo || "requiere revisión manual");
  await db.from("orders").update({
    updated_at: new Date().toISOString(),
    shipping: { ...ship, saldo_comprobante: url, saldo_recibido_at: new Date().toISOString(), saldo_revisar: motivo },
  }).eq("id", (order as any).id);
  await logEvent(db, channelId, contactId, "nota", "Comprobante de saldo por aprobar", motivo);
  await notifyAdmin(db, runlike, `🕵️ Comprobante de saldo por revisar (${motivo}). Apruébalo en “Aprobación de pagos”.`, url);
  await deliverMessage(db, channelId, contactId, "¡Gracias! Estoy verificando tu pago del saldo y en breve te confirmo. 🙌").catch(() => {});
  return true;
}

// ── Nodo IA (Claude/ChatGPT): generar texto, analizar imagen o extraer ─
// Conocimiento del canal (negocio + perfiles de IA + validador OCR), cacheado por run.
async function channelIaInfo(db: SupabaseClient, run: Run): Promise<{ negocio: string | null; perfiles: any; ocr: any; pedidos: any }> {
  let info = (run as any)._chIa;
  if (!info) {
    info = { negocio: null, perfiles: {}, ocr: null, pedidos: null };
    try {
      const { data: ch } = await db.from("channels")
        .select("negocio, ia_perfiles, ocr_config, pedidos_config").eq("id", run.channel_id).maybeSingle();
      info.negocio = (ch as any)?.negocio ?? null;
      info.perfiles = (ch as any)?.ia_perfiles ?? {};
      info.ocr = (ch as any)?.ocr_config ?? null;
      info.pedidos = (ch as any)?.pedidos_config ?? null;
    } catch (_) {
      // Reintento sin columnas nuevas por si faltan migraciones (0026/0027).
      try {
        const { data: ch } = await db.from("channels").select("negocio, ia_perfiles, ocr_config").eq("id", run.channel_id).maybeSingle();
        info.negocio = (ch as any)?.negocio ?? null;
        info.perfiles = (ch as any)?.ia_perfiles ?? {};
        info.ocr = (ch as any)?.ocr_config ?? null;
      } catch (_2) {
        try {
          const { data: ch } = await db.from("channels").select("negocio, ia_perfiles").eq("id", run.channel_id).maybeSingle();
          info.negocio = (ch as any)?.negocio ?? null;
          info.perfiles = (ch as any)?.ia_perfiles ?? {};
        } catch (_3) { /* migración 0023 pendiente */ }
      }
    }
    (run as any)._chIa = info;
  }
  return info;
}

// ── Agentes de pedidos físicos (IA · Pedidos) ──────────────────────
// Embudo de un contacto según el estado de su último pedido, para (a) gatear
// la IA por embudo y (b) inyectarle las instrucciones/mensajes correctos.
function funnelOf(estado: any): "mensajeria" | "confirmaciones" | "logistica" {
  const e = String(estado ?? "").toLowerCase();
  if (!e || e === "carrito") return "mensajeria";
  if (e === "esperando_adelanto" || e === "por_confirmar") return "confirmaciones";
  const log = ["confirmado", "adelanto_validado", "por_despachar", "despachado", "en_agencia",
    "saldo_pagado", "recogido", "en_reparto", "entregado_cobrado", "reprogramado", "rechazado",
    "no_recogido", "cancelado", "por_registrar", "por_enviar", "enviado", "despachar"];
  if (log.includes(e)) return "logistica";
  return "mensajeria";
}
// ¿El pedido va por agencia (provincia) o contraentrega (Lima)?
function esAgencia(estado: any): boolean {
  const cod = ["confirmado", "en_reparto", "entregado_cobrado", "reprogramado", "rechazado"];
  return !cod.includes(String(estado ?? "").toLowerCase());
}
// Instrucciones + mensajes del embudo (config de IA · Pedidos) para el system.
function buildPedidosSystem(pedidos: any, funnel: string, agencia: boolean): string | null {
  if (!pedidos) return null;
  const L: string[] = [];
  if (funnel === "confirmaciones") {
    const c = pedidos.conf ?? {};
    const instr = agencia ? c.instr_ag : c.instr_cod;
    if (instr && String(instr).trim()) L.push("## Cómo confirmar este pedido\n" + String(instr).trim());
    if (agencia && c.msg_ag_pago && String(c.msg_ag_pago).trim()) L.push("## Mensaje para presentar los métodos de pago\nCuando el cliente vaya a pagar, envíale este mensaje:\n" + String(c.msg_ag_pago).trim());
    const msg = agencia ? c.msg_ag : c.msg_cod;
    if (msg && String(msg).trim()) L.push("## Mensaje al confirmar el pedido\nCuando el pedido quede confirmado, envía:\n" + String(msg).trim());
    if (!agencia && c.fecha) L.push("Al confirmar, informa también la fecha estimada de envío.");
  } else if (funnel === "logistica") {
    const g = pedidos.log ?? {};
    const instr = agencia ? g.instr_ag : g.instr_cod;
    if (instr && String(instr).trim()) L.push("## Seguimiento logístico de este pedido\n" + String(instr).trim());
    if (agencia && g.modo === "auto") L.push("Si el cliente envía el comprobante del saldo y el monto coincide con lo pendiente, entrega la clave de recojo. Si no coincide o hay cualquier duda, NO la entregues y avisa que un asesor revisará.");
    else if (agencia) L.push("No entregues la clave de recojo por tu cuenta: avisa que un asesor validará el pago del saldo y te la hará llegar.");
  }
  return L.length ? L.join("\n\n") : null;
}

// Construye el contexto de sistema para validar comprobantes de pago a partir
// del "Validador de comprobantes" del canal (Sección IA). Hace que el nodo IA
// de OCR reconozca pagos con criterio de negocio (destinatario correcto, monto,
// fecha, anti-fraude) sin tener que repetirlo en cada flujo.
function buildOcrSystem(ocr: any): string | null {
  if (!ocr || ocr.activo === false) return null;
  const metodos = Array.isArray(ocr.metodos) ? ocr.metodos.filter((m: any) => m && (m.app || m.titular || m.numero)) : [];
  const r = ocr.reglas ?? {};
  const p: string[] = [];
  p.push("Eres un validador experto de comprobantes de pago de Perú (Yape, Plin, y transferencias de BCP, BBVA, Interbank, Scotiabank, etc.). Analiza la captura con el máximo detalle y criterio anti-fraude.");
  if (metodos.length) {
    p.push("## Métodos de pago VÁLIDOS de este negocio\nEl pago solo es válido si va dirigido a uno de estos destinatarios:\n" +
      metodos.map((m: any) => "- " + [m.app && `App/Banco: ${m.app}`, m.titular && `Titular esperado: ${m.titular}`, m.numero && `Número/cuenta: ${m.numero}`, m.notas && `(${m.notas})`].filter(Boolean).join(" · ")).join("\n"));
  }
  const reglas: string[] = [];
  if (metodos.length && r.verificar_titular !== false) reglas.push("El destinatario/titular del comprobante DEBE coincidir con uno de los métodos válidos. Si no coincide, es INVÁLIDO.");
  if (r.verificar_monto) reglas.push("Extrae el monto pagado y verifica que cubra el monto acordado con el cliente" + (r.tolerancia_monto ? ` (tolerancia ±${r.tolerancia_monto}).` : "."));
  if (r.verificar_fecha) reglas.push(`La fecha/hora del comprobante debe ser reciente (no más de ${Number(r.fecha_max_horas ?? 48)} horas). Si es antigua, márcalo como sospechoso.`);
  if (r.operacion_unica) reglas.push("Extrae el número de operación/constancia. Es la clave anti-reuso: si falta o es ilegible, desconfía.");
  if (r.rechazar_editados) reglas.push("Detecta señales de edición/montaje (tipografías inconsistentes, recortes, píxeles alterados, datos que no cuadran). Ante duda razonable, INVÁLIDO.");
  const nivel = r.exigencia === "alta" ? "ALTA (rechaza ante cualquier duda)" : r.exigencia === "baja" ? "BAJA (aprueba si lo esencial coincide)" : "MEDIA (equilibrio entre seguridad y fluidez)";
  reglas.push(`Nivel de exigencia: ${nivel}.`);
  p.push("## Reglas de validación\n" + reglas.map((x) => "- " + x).join("\n"));
  // Consideraciones SIEMPRE presentes (realidad de los pagos en Perú).
  const cons: string[] = [
    "Los pagos en Perú son INTEROPERABLES: un Yape puede llegar a un Plin y viceversa, y las transferencias cruzan bancos (BCP, BBVA, Interbank, Scotiabank…). NO invalides un pago solo porque la app/banco de origen sea distinta a la del destinatario; lo que importa es que el dinero llegue a una de las cuentas/números válidos de arriba.",
    "El nombre del destinatario suele salir PARCIAL o enmascarado (ej. «PER FLO», «P*** F****», «J. PÉREZ N.», solo iniciales o apellidos). Considéralo válido si coincide RAZONABLEMENTE con el titular esperado (mismas iniciales/apellidos/patrón); no exijas el nombre completo exacto.",
    "Distingue una CONSTANCIA de pago ya realizado de un «pago programado» o «en proceso» aún no ejecutado: estos últimos NO son válidos.",
  ];
  p.push("## Consideraciones importantes\n" + cons.map((x) => "- " + x).join("\n"));
  if (ocr.instrucciones && String(ocr.instrucciones).trim()) p.push("## Instrucciones adicionales del negocio\n" + String(ocr.instrucciones).trim());
  p.push('Devuelve tu conclusión en JSON: {"valido":true|false,"monto":number,"moneda":"PEN","operacion":"...","fecha":"...","titular":"...","banco":"...","motivo":"explica en una frase por qué es válido o no"}. Si te piden otro formato en el prompt del nodo, respétalo, pero aplica siempre estas reglas de validación.');
  return p.join("\n\n");
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
  const funnel = funnelOf(ctx.pedido_estado);
  const agencia = esAgencia(ctx.pedido_estado);

  // Control de IA por embudo (IA · Pedidos): si el canal ya configuró Pedidos y
  // el embudo de este contacto está apagado, la IA no responde (lo toma un
  // humano). Solo aplica a respuestas conversacionales (generar_texto) y solo
  // cuando existe pedidos_config, para no alterar canales que no usan la función.
  if (op === "generar_texto" && info.pedidos?.embudos && info.pedidos.embudos[funnel] === false) {
    await logEvent(db, run.channel_id, run.contact_id, "nota", "IA en pausa (embudo " + funnel + ")",
      "El embudo está desactivado en IA · Pedidos; responde un humano.").catch(() => {});
    run.current_node_id =
      (await nextNode(db, run.flow_id, node.id, "exito")) ??
      (await nextNode(db, run.flow_id, node.id, "continuar"));
    return; // sin generar ni enviar
  }

  // Prompt de sistema en 3 niveles (§6-OCTIES): negocio → producto → nodo.
  let system = (cfg.system ?? cfg.contexto) ? resolve(String(cfg.system ?? cfg.contexto), ctx) : undefined;
  if (op === "generar_texto" && cfg.usar_conocimiento !== false) {
    const parts: string[] = [];
    if (info.negocio) parts.push("## Sobre el negocio\n" + info.negocio);
    // Formas de pago (fuente única = Validador de comprobantes): la IA sabe
    // responder "¿cómo pago?" sin repetir los datos en el Conocimiento.
    const pm = (info.ocr?.metodos ?? []).filter((m: any) => m && (m.app || m.numero || m.titular))
      .map((m: any) => "- " + [m.app, m.numero, m.titular ? `(${m.titular})` : ""].filter(Boolean).join(" "));
    if (pm.length) parts.push("## Formas de pago aceptadas\n" + pm.join("\n"));
    if (ctx.contexto_producto) parts.push(`## Sobre el producto${ctx.producto_nombre ? ` (${ctx.producto_nombre})` : ""}\n` + ctx.contexto_producto);
    if (ctx.emojis) parts.push("## Emojis de este producto\nPuedes usar estos emojis (con moderación) cuando hables de este producto: " + ctx.emojis);
    if (ctx.faq) parts.push("## Preguntas frecuentes y objeciones\n" + ctx.faq);
    // Agentes de pedidos físicos: instrucciones y mensajes del embudo actual
    // (confirmaciones/logística) según el estado del pedido y el tipo de envío.
    const ped = buildPedidosSystem(info.pedidos, funnel, agencia);
    if (ped) parts.push(ped);
    if (system) parts.push(system);
    if (parts.length) system = parts.join("\n\n");
  }
  // OCR: inyecta el "Validador de comprobantes" del canal (métodos válidos +
  // reglas anti-fraude) para que la IA reconozca pagos con criterio de negocio.
  if (op === "analizar_imagen" && cfg.usar_validador !== false) {
    const vt = buildOcrSystem(info.ocr);
    if (vt) system = system ? (vt + "\n\n" + system) : vt;
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
      const blocks: ContentBlock[] = [];
      // Imágenes de REFERENCIA del validador (opcional, máx 3): ayudan a la IA a
      // reconocer cómo lucen los pagos, sin ser el único método aceptado.
      const refs = (cfg.usar_validador !== false && Array.isArray(info.ocr?.ejemplos))
        ? info.ocr.ejemplos.filter((e: any) => e?.url).slice(0, 3) : [];
      if (refs.length) {
        blocks.push({ type: "text", text: `A continuación ${refs.length} comprobante(s) de REFERENCIA (válidos, solo para que sepas cómo lucen los pagos de este negocio). NO son el único método: si el comprobante del cliente es de otro tipo/app, ignóralos y valida por las reglas.` });
        for (const e of refs) blocks.push(imageBlock(String(e.url)));
        blocks.push({ type: "text", text: "— Ahora analiza el SIGUIENTE comprobante enviado por el cliente:" });
      }
      blocks.push(imageBlock(src), { type: "text", text: prompt });
      content = blocks;
    }

    const result = await runAI({
      provider, apiKey: ai.api_key, model, system, content, maxTokens,
      jsonSchema: op === "extraer" ? cfg.json_schema : undefined,
    });

    // Guardar el resultado como variable del run y (si existe) campo persistente.
    if (cfg.guardar_en) {
      run.vars[cfg.guardar_en] = result;
      await setField(db, run.channel_id, run.contact_id, cfg.guardar_en, result);
      await logEvent(db, run.channel_id, run.contact_id, "campo", "Campo capturado (IA)", `${cfg.guardar_en}: ${result ?? ""}`.slice(0, 140));
    }
    // Enviar el resultado al usuario (por defecto sí, salvo que se desactive).
    const enviar = cfg.enviar ?? (op === "generar_texto");
    if (enviar && result) await emitIaText(db, run, String(result), ctx);

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
    const g = (ch as any)?.gsheets ?? {};
    const accion = cfg.accion === "update" ? "update" : "append";
    // columnas: [{ col:"Fecha", valor:"{{fecha_compra}}" }, …] → { Fecha: "13/07/2026", … }
    // En "append" = celdas de la fila nueva; en "update" = celdas a modificar.
    const fila: Record<string, string> = {};
    for (const c of cfg.columnas ?? []) {
      if (!c?.col) continue;
      fila[String(c.col)] = resolve(String(c.valor ?? ""), ctx);
    }
    const buscar: Record<string, string> = {};
    if (accion === "update") for (const b of cfg.buscar ?? []) if (b?.col) buscar[String(b.col)] = resolve(String(b.valor ?? ""), ctx);
    const hoja = cfg.hoja || g.tab || undefined;

    if (g.mode === "oauth") {
      // OAuth: llamamos a la Sheets API con el token del canal (Vault).
      const spreadsheetId = g.spreadsheet_id;
      if (!spreadsheetId) throw new Error("Falta elegir la hoja en Ajustes → Google Sheets");
      const { data: refresh } = await db.rpc("get_gsheets_token", { p_channel_id: run.channel_id });
      if (!refresh) throw new Error("Google Sheets desconectado (reconecta en Ajustes)");
      const token = await getAccessToken(String(refresh));
      if (accion === "update") await sheetsUpdate(token, spreadsheetId, hoja, buscar, fila);
      else await sheetsAppend(token, spreadsheetId, hoja, fila);
    } else if (g.webhook_url) {
      // Apps Script: POST a la app web del usuario.
      const payload: Record<string, unknown> = { accion, hoja, fila };
      if (accion === "update") payload.buscar = buscar;
      const res = await fetch(g.webhook_url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Apps Script respondió " + res.status);
    } else {
      throw new Error("Google Sheets no está conectado (Ajustes → Google Sheets)");
    }
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
          // Multimedia que la IA puede enviar (se resuelve por [[media:tag]] al
          // emitir el texto). Se guarda con "_" para no filtrarse a {{...}}.
          const mm = (p as any).config?.ia_multimedia;
          if (Array.isArray(mm)) pc._ia_multimedia = mm;
          const env = (p as any).config?.envio;
          if (env && typeof env === "object") {
            if (env.agencias && env.agencias.shalom) {
              // Forma nueva: adelanto por agencia → {{adelanto_shalom}}, {{adelanto_olva}}.
              for (const agk of ["shalom", "olva"]) {
                const ag = env.agencias[agk];
                if (ag) pc["adelanto_" + agk] = ag.adelanto_valor ?? "";
              }
              const actk = env.agencia_activa || "shalom";
              pc.adelanto = env.agencias[actk]?.adelanto_valor ?? "";
            } else {
              // Forma vieja (compat): checkboxes + adelanto único.
              for (const [k, v] of Object.entries(env)) {
                if (v == null || typeof v === "object") continue;
                pc["envio_" + k] = v;
              }
              const val = Number(env.adelanto_valor ?? 0);
              const precio = Number((p as any).config?.precio);
              pc.adelanto = env.adelanto_modo === "porcentaje" && Number.isFinite(precio) && precio > 0
                ? (precio * val / 100).toFixed(2)
                : val;
            }
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

// Elige una variante al azar PONDERADA por su peso (default 1). Si todos los
// pesos son 0, cae a una selección uniforme.
function pickWeighted<T extends { peso?: number }>(items: T[]): T {
  const weights = items.map((v) => Math.max(0, Number(v.peso ?? 1)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r < 0) return items[i]; }
  return items[items.length - 1];
}
