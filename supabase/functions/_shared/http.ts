// ═══════════════════════════════════════════════════════════════════
// Nodo · fetch con timeout
//   Toda llamada a un servicio de afuera (Meta, Google, Telegram, el
//   Apps Script del usuario) tiene que poder RENDIRSE. El motivo no es
//   la elegancia: un fetch COLGADO no lanza nunca, así que no lo agarra
//   ningún try/catch, no dispara ningún reintento y no manda ningún
//   aviso. Se come el wall-clock de la Edge Function entera, el flow_run
//   se queda con el lock tomado, y el cliente recibe dead-air hasta que
//   el reaper de runs zombi lo suelte. Con timeout, en cambio, la
//   llamada LANZA — y ahí sí funciona todo lo que ya está escrito para
//   manejar un fallo (reintentos, rama "fallo" del flujo, avisos).
// ═══════════════════════════════════════════════════════════════════

// Por defecto 15 s: de sobra para cualquier API sana, y corto frente a los
// ~150 s de wall-clock que tiene la función. Sube el valor solo cuando la
// llamada baja un archivo (ahí el tiempo depende del tamaño, no del servicio).
export const TIMEOUT_DEFECTO_MS = 15_000;

export async function fetchConTimeout(
  url: string | URL,
  init: RequestInit = {},
  ms: number = TIMEOUT_DEFECTO_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
