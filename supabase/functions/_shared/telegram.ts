// ═══════════════════════════════════════════════════════════════════
// Nodo · telegram.ts — Notificaciones a los admins vía bot de Telegram.
// El bot token vive cifrado en Vault por canal; los chat ids en channels.
// ═══════════════════════════════════════════════════════════════════

// Botón inline: `data` viaja en el callback cuando lo tocan (máx 64 bytes, así
// que va "accion:uuid" y nada más).
export type TgButton = { text: string; data: string };

// Envía un mensaje a cada chat id configurado. Si `photoUrl` viene, manda la
// imagen con el texto como pie (sendPhoto) — útil para el comprobante. No lanza.
export async function sendTelegram(
  botToken: string,
  chatIds: string[],
  text: string,
  photoUrl?: string,
  buttons?: TgButton[][],
): Promise<void> {
  const usePhoto = !!photoUrl && /^https?:\/\//.test(photoUrl);
  const url = `https://api.telegram.org/bot${botToken}/${usePhoto ? "sendPhoto" : "sendMessage"}`;
  const markup = buttons?.length
    ? { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) }
    : undefined;
  for (const chatId of chatIds) {
    try {
      const body: Record<string, unknown> = usePhoto
        ? { chat_id: chatId, photo: photoUrl, caption: text.slice(0, 1024), parse_mode: "HTML" }
        : { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
      if (markup) body.reply_markup = markup;
      let res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      // Si Telegram no pudo bajar la foto, reintentar como texto (no perder el
      // aviso). OJO: hay que rehacer el reply_markup — sin él llegaría el aviso
      // pero SIN los botones, o sea sin forma de aprobar nada.
      if (!res.ok && usePhoto) {
        res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId, text: text + "\n" + photoUrl, parse_mode: "HTML",
            disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}),
          }),
        });
      }
      if (!res.ok) console.error("[telegram] fallo:", await res.text());
    } catch (e) {
      console.error("[telegram] error:", (e as any)?.message ?? e);
    }
  }
}

// Responde el toque del botón: Telegram deja el botón "cargando" hasta que le
// contestás. `alerta` lo muestra como popup en vez de un aviso arriba.
export async function answerCallback(botToken: string, callbackId: string, text?: string, alerta = false): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackId, text: text?.slice(0, 200), show_alert: alerta }),
    });
  } catch (e) { console.error("[telegram] answerCallback:", (e as any)?.message ?? e); }
}

// Reemplaza los botones del mensaje ya enviado (o los quita). Se usa después de
// actuar, para que el aviso quede con el resultado y no se pueda tocar dos veces.
export async function editButtons(
  botToken: string, chatId: string | number, messageId: number, buttons?: TgButton[][],
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/editMessageReplyMarkup`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId, message_id: messageId,
        reply_markup: buttons?.length
          ? { inline_keyboard: buttons.map((r) => r.map((b) => ({ text: b.text, callback_data: b.data }))) }
          : { inline_keyboard: [] },
      }),
    });
  } catch (e) { console.error("[telegram] editButtons:", (e as any)?.message ?? e); }
}

// Registra el webhook del bot. `secret` viaja de vuelta en cada update dentro
// del header X-Telegram-Bot-Api-Secret-Token: es lo que prueba que el pedido
// viene de Telegram y no de cualquiera que adivine la URL.
export async function setWebhook(botToken: string, url: string, secret: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url, secret_token: secret, allowed_updates: ["callback_query", "message"],
        drop_pending_updates: true,
      }),
    });
    const data = await res.json();
    return data?.ok ? { ok: true } : { ok: false, error: data?.description ?? "no se pudo registrar" };
  } catch (e) { return { ok: false, error: String((e as any)?.message ?? e) }; }
}
