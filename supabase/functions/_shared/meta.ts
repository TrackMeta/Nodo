// Llamadas a la WhatsApp Cloud API (Graph API).
const GRAPH_VERSION = "v25.0";

export interface MetaError {
  code?: number;
  subcode?: number;
  message?: string;
  type?: string;
  fbtrace_id?: string;
}

export class MetaApiError extends Error {
  meta: MetaError;
  constructor(meta: MetaError) {
    super(`Meta API error ${meta.code}/${meta.subcode}: ${meta.message}`);
    this.meta = meta;
  }
}

// Envía un mensaje de texto. Devuelve el wamid del mensaje creado.
export async function sendText(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  text: string,
): Promise<string> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toWaId,
      type: "text",
      text: { preview_url: false, body: text },
    }),
  });

  return await postMessage(phoneNumberId, accessToken, {
    messaging_product: "whatsapp", recipient_type: "individual", to: toWaId,
    type: "text", text: { preview_url: false, body: text },
  });
}

// Envía botones interactivos (máx. 3, título ≤ 20 chars). Devuelve el wamid.
export async function sendButtons(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  bodyText: string,
  buttons: { id: string; title: string }[],
): Promise<string> {
  const action = {
    buttons: buttons.slice(0, 3).map((b) => ({
      type: "reply",
      reply: { id: b.id, title: (b.title || b.id).slice(0, 20) },
    })),
  };
  return await postMessage(phoneNumberId, accessToken, {
    messaging_product: "whatsapp", recipient_type: "individual", to: toWaId,
    type: "interactive",
    interactive: { type: "button", body: { text: bodyText || "…" }, action },
  });
}

// POST genérico a /messages. Devuelve el wamid o lanza MetaApiError.
async function postMessage(phoneNumberId: string, accessToken: string, payload: unknown): Promise<string> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    // Meta trae error.code y error.error_subcode — loguearlos siempre.
    const e = data.error ?? {};
    throw new MetaApiError({
      code: e.code, subcode: e.error_subcode, message: e.message,
      type: e.type, fbtrace_id: e.fbtrace_id,
    });
  }
  return data.messages?.[0]?.id ?? "";
}
