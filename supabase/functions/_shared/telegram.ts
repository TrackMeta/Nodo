// ═══════════════════════════════════════════════════════════════════
// Nodo · telegram.ts — Notificaciones a los admins vía bot de Telegram.
// El bot token vive cifrado en Vault por canal; los chat ids en channels.
// ═══════════════════════════════════════════════════════════════════

// Envía un mensaje a cada chat id configurado. Si `photoUrl` viene, manda la
// imagen con el texto como pie (sendPhoto) — útil para el comprobante. No lanza.
export async function sendTelegram(
  botToken: string,
  chatIds: string[],
  text: string,
  photoUrl?: string,
): Promise<void> {
  const usePhoto = !!photoUrl && /^https?:\/\//.test(photoUrl);
  const url = `https://api.telegram.org/bot${botToken}/${usePhoto ? "sendPhoto" : "sendMessage"}`;
  for (const chatId of chatIds) {
    try {
      const body = usePhoto
        ? { chat_id: chatId, photo: photoUrl, caption: text.slice(0, 1024), parse_mode: "HTML" }
        : { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
      let res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      // Si Telegram no pudo bajar la foto, reintentar como texto (no perder el aviso).
      if (!res.ok && usePhoto) {
        res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: text + "\n" + photoUrl, parse_mode: "HTML", disable_web_page_preview: true }),
        });
      }
      if (!res.ok) console.error("[telegram] fallo:", await res.text());
    } catch (e) {
      console.error("[telegram] error:", (e as any)?.message ?? e);
    }
  }
}
