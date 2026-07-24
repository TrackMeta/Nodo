// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: telegram-webhook  (PÚBLICA — verify_jwt=false)
//   El Copiloto en el celular: recibe los toques de los botones inline del bot
//   de Telegram y ejecuta la acción (aprobar el adelanto, soltar la clave,
//   avisar que llegó…). Telegram no manda JWT, así que la protección es otra:
//
//   1) El header X-Telegram-Bot-Api-Secret-Token tiene que coincidir con el
//      secreto que registramos en setWebhook → prueba que viene de Telegram.
//   2) Quien toca el botón tiene que estar en channels.telegram_chat_ids →
//      prueba que es un admin del canal y no cualquiera que encontró el bot.
//      SIN esto, cualquiera que le escriba al bot podría aprobar pagos.
//
//   El canal viaja en la URL (?ch=<uuid>) porque cada bot tiene su propio token
//   y un mismo despliegue atiende a todos.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, getChannelSecrets } from "../_shared/db.ts";
import { answerCallback, editButtons, sendTelegram } from "../_shared/telegram.ts";
import { construirResumen, parseFecha, localParts, localDayStartUTC, ymd, type Cual } from "../_shared/resumen.ts";

const db = serviceClient();

// Qué hace cada botón. El flujo de aviso al cliente lo dispara order-update,
// igual que cuando lo tocas desde el panel.
// `estado`: a dónde pasa el pedido. `extra`: lo que se le suma al cuerpo de
// order-update. Los pagos DIGITALES y los de venta EXTRA además hay que
// REANUDAR (`resume`): su conversación quedó parqueada esperando el visto bueno,
// y sin eso el cliente pagaría y no recibiría nada.
// `extra` es una FUNCIÓN, no un objeto: adentro va la hora, y un objeto a nivel
// de módulo la congelaría en el arranque de la función (todas las aprobaciones
// quedarían con la misma marca de tiempo).
const ACCIONES: Record<string, { estado?: string; desde: string[]; ok: string; extra?: () => Record<string, unknown> }> = {
  adel_ok:    { estado: "adelanto_validado", desde: ["esperando_adelanto"], ok: "Adelanto aprobado ✅" },
  saldo_ok:   { estado: "saldo_pagado",      desde: ["en_agencia"],         ok: "Saldo aprobado ✅ · el bot manda la clave" },
  llego:      { estado: "en_agencia",        desde: ["despachado"],         ok: "Avisado ✅" },
  digital_ok: { estado: "confirmada",        desde: ["pendiente"],          ok: "Pago aprobado ✅ · el bot entrega el producto" },
  extra_ok:   { desde: ["confirmada", "confirmado", "adelanto_validado", "despachado", "en_agencia"],
                ok: "Extra aprobado ✅ · el bot lo entrega",
                // `extra_aprobado_at` lo escribe también el Copiloto del panel:
                // el rastro tiene que ser el mismo se apruebe desde donde se apruebe.
                extra: () => ({ resume: true,
                  shipping: { extra_pendiente: false, extra_aprobado_at: new Date().toISOString() } }) },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const channelId = new URL(req.url).searchParams.get("ch") ?? "";
  if (!channelId) return json({ error: "falta_canal" }, 400);

  const { data: ch } = await db.from("channels")
    .select("id, nombre, timezone, moneda, telegram_chat_ids, telegram_webhook_secret, telegram_pair").eq("id", channelId).maybeSingle();
  if (!ch) return json({ error: "canal_desconocido" }, 404);

  // 1) ¿Viene de Telegram?
  const secret = (ch as any).telegram_webhook_secret;
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return json({ error: "forbidden" }, 403);
  }

  const update = await req.json().catch(() => null);
  const cb = update?.callback_query;
  const msg = update?.message;

  const secrets = await getChannelSecrets(db, channelId);
  const token = secrets?.telegram_bot_token;
  if (!token) return json({ ok: true });

  // ── Vinculación por código ────────────────────────────────────────
  // Es la ÚNICA forma de sumarse como admin desde Telegram. No alcanza con
  // escribirle al bot: hay que mandar el código que muestra el panel, que dura
  // pocos minutos. Si no, cualquiera que encuentre el bot podría aprobar pagos.
  if (msg && !cb) {
    const texto = String(msg.text ?? "").trim();
    const pair = (ch as any).telegram_pair;
    const quienEs = String(msg.from?.id ?? msg.chat?.id ?? "");
    const vigente = pair?.codigo && pair?.vence && new Date(pair.vence).getTime() > Date.now();
    if (vigente && texto.replace(/\D/g, "") === String(pair.codigo) && quienEs) {
      const ids = ((ch as any).telegram_chat_ids ?? []).map(String);
      if (!ids.includes(quienEs)) ids.push(quienEs);
      await db.from("channels").update({ telegram_chat_ids: ids, telegram_pair: null }).eq("id", channelId);
      await sendTelegram(token, [quienEs],
        "✅ <b>Listo, quedaste vinculado.</b>\nDesde aquí vas a poder aprobar los pagos con un toque.");
    } else if (/^\/(hoy|ayer|fecha|resumen|start|help|ayuda)\b/i.test(texto)) {
      // Comandos. Los de resumen exponen KPIs del negocio → solo admins del
      // canal (los que están en telegram_chat_ids), igual que aprobar un pago.
      const esAdmin = ((ch as any).telegram_chat_ids ?? []).map(String).includes(quienEs);
      const chatId = String(msg.chat?.id ?? quienEs);
      // /start y ayuda no exponen datos: se contestan a cualquiera.
      const cmd = texto.replace(/^\//, "").split(/[\s@]/)[0].toLowerCase();
      if (cmd === "start" || cmd === "help" || cmd === "ayuda") {
        await sendTelegram(token, [chatId],
          "👋 <b>Bot de tu Nodo.</b>\n\n" +
          "Comandos:\n" +
          "• <b>/hoy</b> — resumen de cómo va hoy\n" +
          "• <b>/ayer</b> — resumen de ayer\n" +
          "• <b>/fecha 2026-07-20</b> — resumen de un día\n\n" +
          (esAdmin ? "" : "Para usarlos, vincúlate primero: <b>Canales → Telegram</b> en el panel, " +
            "toca <b>Detectar mi chat ID</b> y mándame el código."));
        return json({ ok: true });
      }
      if (!esAdmin) {
        await sendTelegram(token, [chatId],
          "🔒 Para ver los resúmenes tienes que estar vinculado. Entra a <b>Canales → Telegram</b> en el panel y sigue el paso de vinculación.");
        return json({ ok: true });
      }
      const tz = (ch as any).timezone || "America/Lima";
      const lp = localParts(new Date(), tz);
      let diaYmd: string | null = null;
      let cual: Cual = "hoy";
      if (cmd === "hoy" || cmd === "resumen") { diaYmd = ymd(lp.y, lp.mo, lp.d); cual = "hoy"; }
      else if (cmd === "ayer") {
        const inicioHoy = localDayStartUTC(lp.y, lp.mo, lp.d, tz);
        const ay = localParts(new Date(inicioHoy.getTime() - 12 * 3600 * 1000), tz);
        diaYmd = ymd(ay.y, ay.mo, ay.d); cual = "ayer";
      } else if (cmd === "fecha") {
        const arg = texto.split(/\s+/).slice(1).join(" ");
        diaYmd = parseFecha(arg, lp.y); cual = "fecha";
        if (!diaYmd) {
          await sendTelegram(token, [chatId],
            "📅 Dime la fecha así: <b>/fecha 2026-07-20</b> (o <b>/fecha 20/07</b>).");
          return json({ ok: true });
        }
      }
      if (diaYmd) {
        try {
          const resumen = await construirResumen(db, ch, diaYmd, cual);
          await sendTelegram(token, [chatId], resumen);
        } catch (e) {
          console.error("[telegram cmd]", (e as any)?.message ?? e);
          await sendTelegram(token, [chatId], "No pude armar el resumen. Inténtalo de nuevo en un momento.");
        }
      }
    }
    return json({ ok: true });
  }

  // Telegram reintenta si no le contestamos 200: siempre devolvemos ok.
  if (!cb) return json({ ok: true });

  // 2) ¿Quién tocó el botón es admin de ESTE canal?
  const permitidos = ((ch as any).telegram_chat_ids ?? []).map(String);
  const quien = String(cb.from?.id ?? "");
  const chatDelMensaje = String(cb.message?.chat?.id ?? "");
  if (!permitidos.includes(quien) && !permitidos.includes(chatDelMensaje)) {
    await answerCallback(token, cb.id, "No tienes permiso para esta acción.", true);
    return json({ ok: true });
  }

  const [accion, orderId] = String(cb.data ?? "").split(":");
  const def = ACCIONES[accion];
  if (!def || !orderId) { await answerCallback(token, cb.id, "Acción desconocida"); return json({ ok: true }); }

  const { data: order } = await db.from("orders")
    .select("id, estado, channel_id").eq("id", orderId).maybeSingle();
  if (!order || (order as any).channel_id !== channelId) {
    await answerCallback(token, cb.id, "No encontré ese pedido");
    return json({ ok: true });
  }

  // Idempotencia: el aviso va a varios chats y cada uno conserva sus botones.
  // Si otro ya resolvió (o lo hiciste tú desde el panel), no se re-ejecuta.
  if (!def.desde.includes((order as any).estado)) {
    await answerCallback(token, cb.id, "Ese pedido ya fue resuelto", true);
    if (cb.message) await editButtons(token, cb.message.chat.id, cb.message.message_id);
    return json({ ok: true });
  }

  // Se reusa order-update para que el camino sea EXACTAMENTE el mismo que el
  // del panel: cambia el estado y dispara el flujo que le escribe al cliente.
  // Si esto se duplicara acá, tarde o temprano las dos versiones se separan.
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/order-update`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({
      order_id: orderId, via: "telegram",
      ...(def.estado ? { estado: def.estado } : {}),
      ...(def.extra ? def.extra() : {}),
    }),
  }).then((r) => r.json()).catch((e) => ({ error: String(e?.message ?? e) }));

  if (res?.error) {
    await answerCallback(token, cb.id, "No se pudo: " + res.error, true);
    return json({ ok: true });
  }

  await answerCallback(token, cb.id, def.ok);
  // Quita los botones y deja el resultado escrito: no se puede tocar dos veces.
  if (cb.message) await editButtons(token, cb.message.chat.id, cb.message.message_id);
  return json({ ok: true });
});
