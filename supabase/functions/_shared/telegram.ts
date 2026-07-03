// ═══════════════════════════════════════════════════════════════════
// Nodo · telegram.ts — Notificaciones a los admins vía bot de Telegram.
// El bot token vive cifrado en Vault por canal; los chat ids en channels.
// ═══════════════════════════════════════════════════════════════════

// Envía un mensaje a cada chat id configurado. No lanza: registra errores.
export async function sendTelegram(
  botToken: string,
  chatIds: string[],
  text: string,
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  for (const chatId of chatIds) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
      });
      if (!res.ok) console.error("[telegram] fallo:", await res.text());
    } catch (e) {
      console.error("[telegram] error:", (e as any)?.message ?? e);
    }
  }
}
