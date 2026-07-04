// ═══════════════════════════════════════════════════════════════════
// Nodo · flow-runner — intérprete de grafos de flujo.
// Lo invocan el webchat (pruebas) y el webhook de WhatsApp. Ejecuta
// nodos hasta toparse con una espera (Pregunta/Botones/Esperar) o Fin.
// Respeta el lock por contacto (un solo run activo/esperando).
// ═══════════════════════════════════════════════════════════════════
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { imageBlock, runAI, type ContentBlock, type Provider } from "./ai.ts";
import { sendCapiEvent } from "./capi.ts";
import { sendTelegram } from "./telegram.ts";
import { getChannelSecrets } from "./db.ts";
import { MetaApiError, sendButtons, sendText } from "./meta.ts";

export type EngineEvent =
  | { type: "message"; text: string; msgType?: string }
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
  let run = await getActiveRun(db, contactId);

  if (run) {
    const ready = await resumeRun(db, run, event);
    if (!ready) return; // esperaba otra cosa (ej. buffer) → nada que hacer
  } else {
    if (event.type !== "message") return;
    const flow = await matchTrigger(db, channelId, event.text);
    if (!flow) return; // ningún flujo maneja este mensaje
    run = await startRun(db, channelId, contactId, flow);
  }
  await execute(db, run!);
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
async function matchTrigger(db: SupabaseClient, channelId: string, text: string) {
  const norm = normalize(text);
  const { data: triggers } = await db.from("flow_triggers")
    .select("flow_id, tipo, config, flows!inner(id, estado, es_entrada)")
    .eq("channel_id", channelId).eq("activo", true);

  let entrada: any = null;
  for (const t of triggers ?? []) {
    const flow = (t as any).flows;
    if (!flow || flow.estado !== "activo") continue;
    if (t.tipo === "entrada") { entrada = flow; continue; }
    if (t.tipo === "keyword") {
      const kws: string[] = (t.config?.keywords ?? []).map(normalize);
      const mode = t.config?.match ?? "contiene";
      const hit = kws.some((k) =>
        mode === "exacta" ? norm === k
          : mode === "empieza" ? norm.startsWith(k)
          : norm.includes(k)
      );
      if (hit) return flow; // keyword gana (más específico)
    }
  }
  return entrada; // fallback: flujo de entrada
}

async function startRun(db: SupabaseClient, channelId: string, contactId: string, flow: any): Promise<Run> {
  const initial = await initialNode(db, flow.id);
  const { data } = await db.from("flow_runs").insert({
    channel_id: channelId, contact_id: contactId, flow_id: flow.id,
    current_node_id: initial?.id ?? null, vars: {}, estado: "activo",
  }).select("*").single();
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
    if (aw.guardar_en) await setField(db, run.contact_id, aw.guardar_en, event.text);
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
      case "fin": run.estado = "completado"; run.current_node_id = null; break;
      default: {
        // google_sheets y otros → se implementan más adelante.
        // Por ahora se saltan siguiendo 'exito' (o 'continuar').
        run.current_node_id =
          (await nextNode(db, run.flow_id, node.id, "exito")) ??
          (await nextNode(db, run.flow_id, node.id, "continuar"));
      }
    }
  }
  if (run.estado === "activo") run.estado = "completado"; // agotó MAX_STEPS
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
  await execute(db, run);
  return true;
}

// Envía un mensaje suelto (paso de secuencia sin flujo).
export async function deliverMessage(db: SupabaseClient, channelId: string, contactId: string, text: string) {
  const run: any = { channel_id: channelId, contact_id: contactId };
  const { data: c } = await db.from("contacts").select("wa_id").eq("id", contactId).maybeSingle();
  await emit(db, run, { text }, { wa_id: (c as any)?.wa_id });
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
      case "add_tag":    await addTag(db, run.channel_id, run.contact_id, a.valor); break;
      case "remove_tag": await removeTag(db, run.channel_id, run.contact_id, a.valor); break;
      case "set_field":  await setField(db, run.contact_id, a.key, resolve(String(a.valor ?? ""), ctx)); break;
      case "clear_field":await setField(db, run.contact_id, a.key, null); break;
      case "append_field": {
        const prev = ctx[a.key] ? String(ctx[a.key]) + "\n" : "";
        await setField(db, run.contact_id, a.key, prev + resolve(String(a.valor ?? ""), ctx)); break;
      }
      case "stage":      await db.from("contacts").update({ stage: a.valor }).eq("id", run.contact_id); break;
      case "notify_admin": await notifyAdmin(db, run, resolve(String(a.mensaje ?? a.valor ?? ""), ctx)); break;
      case "transfer_human": {
        await db.from("contacts").update({ bot_activo: false }).eq("id", run.contact_id);
        await db.from("conversations").update({ requiere_humano: true }).eq("contact_id", run.contact_id);
        const msg = a.mensaje ? resolve(String(a.mensaje), ctx) : `🙋 ${ctx.nombre || ctx.wa_id} necesita atención humana`;
        await notifyAdmin(db, run, msg);
        break;
      }
      case "subscribe_seq": await subscribeSeq(db, run, a); break;
      case "unsubscribe_seq": await unsubscribeSeq(db, run, a); break;
    }
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
async function notifyAdmin(db: SupabaseClient, run: Run, text: string) {
  if (!text) return;
  const { data: channel } = await db.from("channels")
    .select("telegram_chat_ids, nombre").eq("id", run.channel_id).maybeSingle();
  const chatIds = (channel as any)?.telegram_chat_ids ?? [];
  if (!chatIds.length) return;
  const secrets = await getChannelSecrets(db, run.channel_id);
  const token = secrets?.telegram_bot_token;
  if (!token) { console.warn("[notify_admin] canal sin telegram_bot_token"); return; }
  const prefix = (channel as any)?.nombre ? `[${(channel as any).nombre}] ` : "";
  await sendTelegram(token, chatIds, prefix + text);
}

// ── Nodo IA (Claude/ChatGPT): generar texto, analizar imagen o extraer ─
async function runIa(db: SupabaseClient, run: Run, node: Node, ctx: any) {
  const cfg = node.config ?? {};
  const op = cfg.operacion ?? "generar_texto";
  const maxTokens = cfg.max_tokens ? Number(cfg.max_tokens) : undefined;
  const system = (cfg.system ?? cfg.contexto) ? resolve(String(cfg.system ?? cfg.contexto), ctx) : undefined;
  const prompt = resolve(String(cfg.prompt ?? ""), ctx);

  try {
    // Resolver proveedor + key del canal (Vault). `proveedor` del nodo o el
    // proveedor por defecto del canal si el nodo dice "auto".
    const wantProvider = cfg.proveedor && cfg.proveedor !== "auto" ? cfg.proveedor : null;
    const { data: aiRows } = await db.rpc("get_channel_ai_active", {
      p_channel_id: run.channel_id, p_provider: wantProvider,
    });
    const ai = Array.isArray(aiRows) ? aiRows[0] : aiRows;
    if (!ai?.api_key) throw new Error("IA no configurada en este canal (Configuraciones)");
    const provider = ai.provider as Provider;
    const model = cfg.modelo || ai.model || undefined;

    let content: string | ContentBlock[] = prompt;
    if (op === "analizar_imagen") {
      // La imagen viene de una variable de config, o del último input del contacto.
      const img = cfg.imagen_var ? ctx[cfg.imagen_var] : (ctx.last_image ?? run.vars._last_image);
      if (!img) throw new Error("no hay imagen para analizar");
      content = [imageBlock(String(img)), { type: "text", text: prompt }];
    }

    const result = await runAI({
      provider, apiKey: ai.api_key, model, system, content, maxTokens,
      jsonSchema: op === "extraer" ? cfg.json_schema : undefined,
    });

    // Guardar el resultado como variable del run y (si existe) campo persistente.
    if (cfg.guardar_en) {
      run.vars[cfg.guardar_en] = result;
      await setField(db, run.contact_id, cfg.guardar_en, result);
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
  if (!res.ok) run.vars._capi_error = res.error;

  const handle = res.ok ? "exito" : "fallo";
  run.current_node_id =
    (await nextNode(db, run.flow_id, node.id, handle)) ??
    (await nextNode(db, run.flow_id, node.id, "continuar"));
}

// ── Contexto y resolución de variables {{ }} ───────────────────────
async function buildContext(db: SupabaseClient, run: Run) {
  const { data: c } = await db.from("contacts")
    .select("nombre, wa_id, stage, last_input").eq("id", run.contact_id).maybeSingle();
  const { data: fields } = await db.from("contact_field_values")
    .select("value, custom_fields!inner(key)").eq("contact_id", run.contact_id);
  const ctx: any = {
    nombre: c?.nombre ?? "", telefono: c?.wa_id ?? "", wa_id: c?.wa_id ?? "",
    stage: c?.stage ?? "", last_input: c?.last_input ?? "",
    ...run.vars,
  };
  for (const f of fields ?? []) ctx[(f as any).custom_fields.key] = (f as any).value;
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
async function setField(db: SupabaseClient, contactId: string, key: string, value: string | null) {
  const { data: f } = await db.from("custom_fields").select("id, channel_id")
    .eq("key", key).limit(1).maybeSingle();
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
