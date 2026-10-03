// ═══════════════════════════════════════════════════════════════════
// Nodo · examen — el EXAMEN FIJO del bot de ventas (PLAN_MOTOR_IA.md, fase 0).
//
// Corre una batería fija de conversaciones (bateria.ts) contra el motor REAL —igual que tmp-sim,
// con contactos de prueba `source: "sim"` que nunca salen por WhatsApp— y un juez IA marca cada
// respuesta del bot. Cada corrida queda en `examenes` / `examen_conversaciones` para comparar un
// cambio del motor con el anterior.
//
// Acciones (POST JSON):
//   iniciar  {channel_id, bateria?, etiqueta?, modelo?}  → crea la corrida
//   correr   {examen_id, conv}   → avanza la conversación (vuelve con `pendiente` si se le acaba el tiempo)
//   juzgar   {examen_id, conv}   → el juez IA la califica
//   ver      {examen_id}         → la corrida con sus conversaciones
//   listar   {channel_id}        → las últimas corridas con su nota
// Acceso: admin del canal (JWT del panel) o la cabecera `x-examen-secret` (scripts/examen.ps1).
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userIsChannelAdmin } from "../_shared/db.ts";
import { runEngine, aplicarStock, forzarModeloVenta } from "../_shared/engine.ts";
import { runAI } from "../_shared/ai.ts";
import { BATERIAS, BATERIA_ECOGUARD, type ConvExamen } from "./bateria.ts";

const db = serviceClient();
const MODELO_JUEZ = "gpt-4.1";
// Una invocación de Edge Function muere a los ~150 s: se corta antes y la conversación sigue en la próxima llamada.
const PRESUPUESTO_MS = 95_000;

async function autoriza(req: Request, channelId: string): Promise<{ ok: boolean; uid?: string }> {
  const sec = Deno.env.get("EXAMEN_SECRET") ?? "";
  const hdr = req.headers.get("x-examen-secret") ?? "";
  if (sec.length >= 24 && hdr === sec) return { ok: true };
  const { data: u } = await userClient(req.headers.get("Authorization") ?? "").auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return { ok: false };
  return { ok: await userIsChannelAdmin(db, uid, channelId), uid };
}

function convDe(bateriaId: string, conv: string): ConvExamen | null {
  const b = BATERIAS[bateriaId] ?? BATERIA_ECOGUARD;
  return b.conversaciones.find((c) => c.id === conv) ?? null;
}

// ── Contacto de prueba: igual que tmp-sim (source «sim», nunca un contacto real) ──────────────
async function contactoDePrueba(channelId: string, waId: string): Promise<string> {
  const { data: ya } = await db.from("contacts").select("id, source").eq("channel_id", channelId).eq("wa_id", waId).maybeSingle();
  if (ya && (ya as any).source !== "sim") throw new Error(`el wa_id ${waId} es un contacto real`);
  const { data: c } = await db.from("contacts").upsert({
    channel_id: channelId, wa_id: waId, nombre: waId, source: "sim",
    ultimo_mensaje_at: new Date().toISOString(), ultimo_mensaje_cliente_at: new Date().toISOString(),
  }, { onConflict: "channel_id,wa_id" }).select("id").single();
  const contactId = (c as any).id as string;
  await db.from("conversations").upsert({
    channel_id: channelId, contact_id: contactId, window_type: "service_24h", archivada: false,
    expira_at: new Date(Date.now() + 3650 * 24 * 3600 * 1000).toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: "contact_id" });
  return contactId;
}

async function reiniciar(channelId: string, contactId: string): Promise<void> {
  try {
    const { data: ords } = await db.from("orders").select("id, shipping").eq("contact_id", contactId);
    for (const o of (ords ?? [])) {
      const sh = ((o as any)?.shipping ?? {}) as any;
      if (sh.stock_descontado && !sh.stock_devuelto && Array.isArray(sh.stock_mov) && sh.stock_mov.length) {
        await aplicarStock(db, sh.stock_mov, 1).catch(() => {});
      }
    }
    await db.from("payment_operations").delete().eq("channel_id", channelId).eq("contact_id", contactId);
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
  await db.from("contacts").update({
    angulo: null, oferta_activa: null, ultima_imagen_at: null, bloqueado: false, stage: "nuevo", bot_activo: true,
    product_id: null, ctwa_clid: null, source: "sim", last_input: null, last_input_type: null, consecutive_failed_reply: 0,
    memoria_ia: {}, primera_interaccion: new Date().toISOString(), ultimo_mensaje_at: new Date().toISOString(), ultimo_mensaje_cliente_at: null,
  }).eq("id", contactId);
}

// Un turno del cliente: guarda el mensaje, corre el motor y devuelve las burbujas que salieron.
async function turno(channelId: string, contactId: string, texto: string): Promise<string[]> {
  await db.from("contacts").update({
    last_input: texto, last_input_type: "text",
    ultimo_mensaje_at: new Date().toISOString(), ultimo_mensaje_cliente_at: new Date().toISOString(),
  }).eq("id", contactId);
  const { data: m } = await db.from("messages").insert({
    channel_id: channelId, contact_id: contactId, direction: "in", type: "text", content: { text: texto }, status: "delivered",
  }).select("id, ts").single();
  const ts = String((m as any)?.ts ?? new Date().toISOString());
  await runEngine(db, channelId, contactId, { type: "message", text: texto, msgType: "text", msgTs: ts } as any);
  const { data: out } = await db.from("messages").select("content, type, ts").eq("contact_id", contactId)
    .eq("direction", "out").gt("ts", ts).order("ts", { ascending: true }).limit(20);
  return ((out ?? []) as any[]).map((o) => String(o?.content?.text ?? o?.content?.caption ?? `[${o?.type ?? "media"}]`));
}

// ── El juez ─────────────────────────────────────────────────────────
const JUICIO_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    fallas: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          turno: { type: "integer" },
          tipo: { type: "string", enum: ["no_contesto", "cortada", "invento", "dato_erroneo", "supuso_zona", "fuera_de_orden", "repite", "robotico", "otro"] },
          grave: { type: "boolean" },
          cita: { type: "string" },
          explicacion: { type: "string" },
        },
        required: ["turno", "tipo", "grave", "cita", "explicacion"],
      },
    },
    resumen: { type: "string" },
  },
  required: ["fallas", "resumen"],
};

const SISTEMA_JUEZ = `Eres un auditor de calidad de un bot de ventas por WhatsApp de una tienda peruana. Lees UNA conversación
entre un cliente de prueba (C) y el bot (B) y marcas las FALLAS de las respuestas del bot. Eres exigente pero justo:
no marques como falla lo que está bien, y no inventes problemas.

El bot combina dos cosas:
· Texto que escribe una IA vendedora (tono cercano, emojis, primera persona). Un poco de floreo vendedor está BIEN.
· Bloques fijos que pone el sistema y que son CORRECTOS por definición si coinciden con las reglas del negocio: la lista
  de precios («💰 Estos son los precios…» o «Estas son las opciones»), la lista de sedes de Shalom («📍 …»), la petición
  de datos («📌 Nombre…»), la línea del adelanto («Solo te pido un adelanto de S/ 20 y el resto me lo pagas por acá
  cuando llegue a la agencia»), «Garantía formal no manejamos 🙏…», los datos de pago y el resumen del pedido.
· El TURNO 1 son mensajes de bienvenida escritos por el dueño: NO los evalúes.

Tipos de falla (usa exactamente estos):
· no_contesto (GRAVE): el cliente preguntó algo concreto y ese turno no lo contesta (decir con honestidad «ese dato no
  lo tengo» SÍ cuenta como contestar). Si hizo varias preguntas, cada una sin contestar es una falla.
· cortada (GRAVE): frase incompleta o cortada a la mitad, palabras pegadas, un trozo suelto que no se entiende, o un
  mensaje que no tiene sentido en ese momento.
· invento (GRAVE): afirma o niega algo concreto del producto, la garantía, devoluciones, seguridad (personas, niños,
  mascotas), plazos o políticas que la FICHA no dice o que la contradice. Si es un detalle genérico, inofensivo y obvio
  («es fácil de usar»), márcalo como invento NO grave.
· dato_erroneo (GRAVE): precio, adelanto, cantidad o forma de pago/entrega distintos a la ficha y las reglas.
· supuso_zona (GRAVE): habla de Shalom, agencia, contraentrega, adelanto o días de entrega como si supiera de dónde es
  el cliente, cuando el cliente todavía no lo dijo.
· fuera_de_orden (leve): pide datos, sede o pago antes de tiempo, o se salta un paso.
· repite (leve): repite una pregunta o un bloque que ya se dijo, o dice lo mismo dos veces en el mismo turno.
· robotico (leve): suena a formulario, frío, o habla en tercera persona («te llega», «el sistema te manda»).
· otro (leve): cualquier otro defecto que un cliente notaría.

Responde SOLO el JSON. Para cada falla: el número de turno, el tipo, si es grave, una cita corta (máx. 15 palabras) del
texto del bot y una explicación de máx. 25 palabras. Máximo 10 fallas. «resumen»: una frase sobre la conversación.`;

function transcriptTexto(tr: Array<{ c: string; b: string[] }>): string {
  const corto = (s: string) => {
    // las listas de sedes largas se resumen (el juez no necesita las 12 oficinas)
    const lines = s.split("\n");
    const sedes = lines.filter((l) => /^📍/u.test(l.trim()));
    if (sedes.length > 4) {
      let n = 0;
      return lines.filter((l) => !/^📍/u.test(l.trim()) || ++n <= 3).join("\n").replace(/(📍[^\n]*\n?)(?![\s\S]*📍)/u, `$1(… ${sedes.length - 3} sedes más)\n`);
    }
    return s;
  };
  return tr.map((t, i) => `── TURNO ${i + 1}\nC: ${t.c}\nB: ${t.b.length ? t.b.map((x, j) => `[burbuja ${j + 1}] ${corto(x)}`).join("\n") : "(el bot no respondió nada)"}`).join("\n\n");
}

async function juzgar(examen: any, conv: ConvExamen, tr: Array<{ c: string; b: string[] }>) {
  const bat = BATERIAS[examen.bateria ?? ""] ?? BATERIA_ECOGUARD;
  const [{ data: prod }, { data: ch }, { data: aiRows }] = await Promise.all([
    db.from("products").select("nombre, config").eq("channel_id", examen.channel_id).ilike("nombre", bat.producto).limit(1).maybeSingle(),
    db.from("channels").select("negocio, entregas").eq("id", examen.channel_id).maybeSingle(),
    db.rpc("get_channel_ai_active", { p_channel_id: examen.channel_id, p_provider: "openai" }),
  ]);
  const ai = Array.isArray(aiRows) ? aiRows[0] : aiRows;
  if (!ai?.api_key) throw new Error("El canal no tiene una clave de OpenAI para el juez");
  const cfg = ((prod as any)?.config ?? {}) as any;
  const txt = (x: unknown) => typeof x === "string" ? x : JSON.stringify(x ?? "");
  const ent = ((ch as any)?.entregas ?? {}) as any;
  const reglas = {
    adelanto_provincia: ent?.adelanto_default ?? null,
    envio: ent?.envio ?? ent?.modo_envio ?? null,
    pos_tarjeta: ent?.pos_tarjeta ?? null,
  };
  const contenido =
    `## FICHA DEL PRODUCTO «${(prod as any)?.nombre ?? bat.producto}»\n${txt(cfg.contexto_producto).slice(0, 6000)}\n\n` +
    `## PREGUNTAS FRECUENTES\n${txt(cfg.faq).slice(0, 3000)}\n\n` +
    `## LÍMITES (lo que NO se promete)\n${txt(cfg?.ia?.limites).slice(0, 1500)}\n\n` +
    `## REGLAS DEL NEGOCIO\nLima: entrega a domicilio, contraentrega (paga al recibir). Provincia: por agencia Shalom, con un ` +
    `adelanto y el resto se paga por el chat cuando llega a la agencia; en la agencia solo recoge con su clave.\n` +
    `Datos de configuración: ${JSON.stringify(reglas)}\n${txt((ch as any)?.negocio).slice(0, 2000)}\n\n` +
    `## QUÉ SE PRUEBA EN ESTA CONVERSACIÓN\n${conv.foco}\n\n## CONVERSACIÓN\n${transcriptTexto(tr)}`;
  const raw = await runAI({
    db, channelId: examen.channel_id, origen: "otro", provider: ai.provider, apiKey: ai.api_key, model: MODELO_JUEZ,
    system: SISTEMA_JUEZ, content: contenido, maxTokens: 1400,
    jsonSchema: JUICIO_SCHEMA as unknown as Record<string, unknown>, jsonStrict: true,
  });
  const j = JSON.parse(raw);
  const fallas = Array.isArray(j?.fallas) ? j.fallas : [];
  return { juicio: j, graves: fallas.filter((f: any) => f?.grave).length, leves: fallas.filter((f: any) => !f?.grave).length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const accion = String(body?.accion ?? "");

  // ── iniciar / listar: por canal ──
  if (accion === "iniciar" || accion === "listar") {
    const channelId = String(body?.channel_id ?? "");
    if (!channelId) return json({ error: "falta channel_id" }, 400);
    const a = await autoriza(req, channelId);
    if (!a.ok) return json({ error: "forbidden" }, 403);
    if (accion === "listar") {
      const { data: ex } = await db.from("examenes").select("id, etiqueta, modelo, total, created_at")
        .eq("channel_id", channelId).order("created_at", { ascending: false }).limit(20);
      const ids = ((ex ?? []) as any[]).map((e) => e.id);
      const { data: cs } = ids.length
        ? await db.from("examen_conversaciones").select("examen_id, estado, graves, leves").in("examen_id", ids)
        : { data: [] as any[] };
      const out = ((ex ?? []) as any[]).map((e) => {
        const mias = ((cs ?? []) as any[]).filter((c) => c.examen_id === e.id);
        const juzg = mias.filter((c) => c.estado === "juzgada");
        return { ...e, juzgadas: juzg.length, graves: juzg.reduce((s, c) => s + (c.graves ?? 0), 0),
          leves: juzg.reduce((s, c) => s + (c.leves ?? 0), 0), con_grave: juzg.filter((c) => (c.graves ?? 0) > 0).length,
          errores: mias.filter((c) => c.estado === "error").length };
      });
      return json({ ok: true, examenes: out });
    }
    const bat = BATERIAS[String(body?.bateria ?? "")] ?? BATERIA_ECOGUARD;
    const modelo = typeof body?.modelo === "string" && /^gpt-[\w.-]+$/.test(body.modelo) ? body.modelo : null;
    const { data: ex, error } = await db.from("examenes").insert({
      channel_id: channelId, etiqueta: String(body?.etiqueta ?? "").slice(0, 120) || null, modelo,
      total: bat.conversaciones.length, creado_por: a.uid ?? null,
    }).select("id").single();
    if (error) return json({ error: error.message }, 500);
    const exId = (ex as any).id;
    await db.from("examen_conversaciones").insert(bat.conversaciones.map((c) => ({ examen_id: exId, conv: c.id, titulo: c.titulo })));
    return json({ ok: true, examen_id: exId, bateria: bat.id, conversaciones: bat.conversaciones.map((c) => ({ conv: c.id, titulo: c.titulo })) });
  }

  // ── el resto: por examen ──
  const examenId = String(body?.examen_id ?? "");
  const { data: examen } = await db.from("examenes").select("*").eq("id", examenId).maybeSingle();
  if (!examen) return json({ error: "examen no encontrado" }, 404);
  const a = await autoriza(req, (examen as any).channel_id);
  if (!a.ok) return json({ error: "forbidden" }, 403);
  (examen as any).bateria = BATERIA_ECOGUARD.id;   // hoy hay una sola batería

  if (accion === "ver") {
    const { data: cs } = await db.from("examen_conversaciones").select("*").eq("examen_id", examenId).order("conv");
    return json({ ok: true, examen, conversaciones: cs ?? [] });
  }

  const convId = String(body?.conv ?? "");
  const conv = convDe(BATERIA_ECOGUARD.id, convId);
  if (!conv) return json({ error: "conversación no encontrada" }, 404);
  const { data: fila } = await db.from("examen_conversaciones").select("*").eq("examen_id", examenId).eq("conv", convId).maybeSingle();
  if (!fila) return json({ error: "conversación fuera de este examen" }, 404);

  if (accion === "correr") {
    const t0 = Date.now();
    const channelId = (examen as any).channel_id as string;
    forzarModeloVenta((examen as any).modelo ?? null);
    const tr: Array<{ c: string; b: string[] }> = Array.isArray((fila as any).transcript) ? (fila as any).transcript : [];
    try {
      // Un wa_id por examen y conversación: dos corridas a la vez no se pisan el contacto.
      const waId = `exam-${examenId.slice(0, 8)}-${convId}`;
      const contactId = await contactoDePrueba(channelId, waId);
      if (!tr.length) await reiniciar(channelId, contactId);
      let hechos = 0;
      for (let i = tr.length; i < conv.turnos.length; i++) {
        if (hechos > 0 && Date.now() - t0 > PRESUPUESTO_MS) break;   // al menos un turno por llamada
        hechos++;
        const b = await turno(channelId, contactId, conv.turnos[i]);
        tr.push({ c: conv.turnos[i], b });
        await db.from("examen_conversaciones").update({ transcript: tr, updated_at: new Date().toISOString() })
          .eq("examen_id", examenId).eq("conv", convId);
      }
      const listo = tr.length >= conv.turnos.length;
      if (listo) await db.from("examen_conversaciones").update({ estado: "corrida", updated_at: new Date().toISOString() })
        .eq("examen_id", examenId).eq("conv", convId);
      return json({ ok: true, pendiente: !listo, turnos: tr.length, total: conv.turnos.length });
    } catch (e) {
      await db.from("examen_conversaciones").update({ estado: "error", error: String(e).slice(0, 500), updated_at: new Date().toISOString() })
        .eq("examen_id", examenId).eq("conv", convId);
      return json({ error: "engine_error", detalle: String(e).slice(0, 300) }, 500);
    } finally {
      forzarModeloVenta(null);
    }
  }

  if (accion === "juzgar") {
    const tr = (fila as any).transcript;
    if (!Array.isArray(tr) || tr.length < conv.turnos.length) return json({ error: "la conversación todavía no terminó" }, 409);
    try {
      const r = await juzgar(examen, conv, tr);
      await db.from("examen_conversaciones").update({ estado: "juzgada", juicio: r.juicio, graves: r.graves, leves: r.leves, error: null, updated_at: new Date().toISOString() })
        .eq("examen_id", examenId).eq("conv", convId);
      return json({ ok: true, graves: r.graves, leves: r.leves });
    } catch (e) {
      return json({ error: "juez_error", detalle: String(e).slice(0, 300) }, 500);
    }
  }

  return json({ error: "accion desconocida" }, 400);
});
