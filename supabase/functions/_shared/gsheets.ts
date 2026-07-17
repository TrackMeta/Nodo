// ═══════════════════════════════════════════════════════════════════
// Nodo · gsheets.ts — API de Google Sheets vía OAuth del usuario.
// El refresh_token del canal (Vault) se cambia por un access_token y se
// llama a la Sheets API v4. Alinea por encabezados (fila 1) como el
// Apps Script: agrega columnas que falten y respeta el orden.
// ═══════════════════════════════════════════════════════════════════
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

// refresh_token → access_token (Client ID/Secret de la app en env).
export async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "",
      grant_type: "refresh_token",
    }),
  });
  const d = await res.json();
  if (!res.ok || !d.access_token) throw new Error("no se pudo refrescar el token de Google (¿reconectar?): " + (d.error_description ?? d.error ?? res.status));
  return d.access_token as string;
}

async function api(token: string, url: string, method = "GET", body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("Sheets API " + res.status + ": " + ((d as any)?.error?.message ?? ""));
  return d as any;
}

// Nombre de la primera pestaña (cuando el nodo no especifica una).
async function firstTab(token: string, id: string): Promise<string> {
  const d = await api(token, `${SHEETS}/${id}?fields=sheets.properties.title`);
  return d.sheets?.[0]?.properties?.title ?? "Hoja 1";
}
// Índice 0-based → letra de columna A1 (0→A, 26→AA).
function colA1(n: number): string {
  let s = ""; n++;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const q = (s: string) => encodeURIComponent(s);

// Crea la pestaña si no existe. Sin esto, escribir en una pestaña inexistente
// falla con "Unable to parse range" y —como el error se traga para no romper la
// venta— no se escribía nada y nadie se enteraba.
async function ensureTab(token: string, id: string, tab: string): Promise<void> {
  const d = await api(token, `${SHEETS}/${id}?fields=sheets.properties.title`);
  const existe = (d.sheets ?? []).some((s: any) => s?.properties?.title === tab);
  if (existe) return;
  await api(token, `${SHEETS}/${id}:batchUpdate`, "POST", {
    requests: [{ addSheet: { properties: { title: tab } } }],
  });
}

const norm = (s: string) => s.toString().trim().toLowerCase();

// Lee los encabezados (fila 1), añadiendo los que falten para las claves dadas.
// La comparación es SIN distinguir mayúsculas ni espacios: si el usuario ya
// escribió "AD ID" a mano, se usa ESA columna en vez de crear otra "Ad ID" al
// lado. Devuelve los encabezados reales de la hoja (los del usuario mandan).
async function ensureHeaders(token: string, id: string, tab: string, keys: string[]): Promise<string[]> {
  const hd = await api(token, `${SHEETS}/${id}/values/${q(tab + "!1:1")}`);
  let headers: string[] = hd.values?.[0] ?? [];
  let changed = false;
  if (headers.length === 0) { headers = keys.slice(); changed = keys.length > 0; }
  else {
    const yaEstan = new Set(headers.map(norm));
    for (const k of keys) if (!yaEstan.has(norm(k))) { headers.push(k); yaEstan.add(norm(k)); changed = true; }
  }
  if (changed) await api(token, `${SHEETS}/${id}/values/${q(tab + "!1:1")}?valueInputOption=RAW`, "PUT", { values: [headers] });
  return headers;
}

// Alinea la fila a los encabezados REALES, casando sin distinguir mayúsculas.
function alinear(headers: string[], fila: Record<string, string>): string[] {
  const porClave = new Map<string, string>();
  for (const [k, v] of Object.entries(fila)) porClave.set(norm(k), v);
  return headers.map((h) => porClave.get(norm(h)) ?? "");
}

// Índice de una columna, casando sin distinguir mayúsculas ("CEL" == "Cel").
const idxDe = (headers: string[], k: string) => headers.findIndex((h) => norm(h) === norm(k));

// Agrega una fila nueva alineada a los encabezados.
export async function sheetsAppend(token: string, id: string, tab: string | undefined, fila: Record<string, string>) {
  const t = tab || await firstTab(token, id);
  if (tab) await ensureTab(token, id, t);
  const headers = await ensureHeaders(token, id, t, Object.keys(fila));
  const row = alinear(headers, fila);
  await api(token, `${SHEETS}/${id}/values/${q(t)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, "POST", { values: [row] });
}

// Busca la fila que cumple `buscar` y actualiza las celdas de `fila`.
// Si no la encuentra, agrega una fila con buscar+fila (como el Apps Script).
export async function sheetsUpdate(token: string, id: string, tab: string | undefined, buscar: Record<string, string>, fila: Record<string, string>) {
  const t = tab || await firstTab(token, id);
  if (tab) await ensureTab(token, id, t);
  const headers = await ensureHeaders(token, id, t, [...Object.keys(buscar), ...Object.keys(fila)]);
  const all = await api(token, `${SHEETS}/${id}/values/${q(t)}`);
  const values: string[][] = all.values ?? [];
  let foundRow = -1;
  for (let r = 1; r < values.length; r++) {
    let ok = true;
    for (const k in buscar) {
      const ci = idxDe(headers, k);
      if (ci < 0 || String(values[r]?.[ci] ?? "") !== String(buscar[k])) { ok = false; break; }
    }
    if (ok) { foundRow = r + 1; break; } // fila 1-based en A1
  }
  if (foundRow < 0) { await sheetsAppend(token, id, t, { ...buscar, ...fila }); return; }
  const data = Object.keys(fila)
    .map((k) => ({ ci: idxDe(headers, k), v: fila[k] }))
    .filter((x) => x.ci >= 0)
    .map((x) => ({ range: `${t}!${colA1(x.ci)}${foundRow}`, values: [[x.v]] }));
  if (data.length) await api(token, `${SHEETS}/${id}/values:batchUpdate`, "POST", { valueInputOption: "USER_ENTERED", data });
}
