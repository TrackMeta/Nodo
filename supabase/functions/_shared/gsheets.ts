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
// Casar nombres de pestañas y encabezados sin distinguir mayúsculas ni espacios:
// si el usuario escribió "CEL" a mano, es la misma columna que "Cel".
const norm = (s: string) => s.toString().trim().toLowerCase();

// ── Las 3 hojas de Nodo ────────────────────────────────────────────
// Una por operación: mezclar una venta digital con un despacho a provincia hace
// una hoja ilegible. El orden de las columnas es el orden en que se crean.
export const HOJAS: Record<string, string[]> = {
  "Digital": ["ID", "Ad ID", "Cliente", "Cel", "Fecha y hora", "Valor", "Producto", "Orderbump", "Imagen"],
  "Lima": ["ID", "Ad ID", "Cliente", "Cel", "Fecha y hora", "Distrito", "Dirección", "Referencia",
    "Producto", "Opción", "Valor a cobrar", "Estado"],
  "Provincia": ["ID", "Ad ID", "Cliente", "Cel", "Fecha y hora", "DNI", "Agencia", "Producto", "Opción",
    "Valor total", "Adelanto", "Saldo", "Guía", "Estado", "Imagen"],
};

// Deja la hoja LISTA al conectarla: crea las 3 pestañas, escribe los
// encabezados, congela la fila 1 (para que se quede fija al bajar) y la
// formatea. La idea es conectar y ya está — sin pedirle al usuario que cree
// pestañas ni tipee encabezados.
// Es idempotente y NO pisa lo que el usuario ya tenga: si él escribió "CEL",
// esa columna se respeta (el casado ignora mayúsculas).
export async function sheetsBootstrap(token: string, id: string): Promise<{ creadas: string[]; hojas: string[] }> {
  const meta = await api(token, `${SHEETS}/${id}?fields=sheets.properties(sheetId,title)`);
  const actuales: { sheetId: number; title: string }[] = (meta.sheets ?? []).map((s: any) => s.properties);
  const creadas: string[] = [];

  // 1) Las pestañas que falten.
  const nuevas = Object.keys(HOJAS).filter((t) => !actuales.some((s) => norm(s.title) === norm(t)));
  if (nuevas.length) {
    await api(token, `${SHEETS}/${id}:batchUpdate`, "POST", {
      requests: nuevas.map((title) => ({ addSheet: { properties: { title } } })),
    });
    creadas.push(...nuevas);
  }

  // 2) Encabezados + formato, ya con los ids reales de cada pestaña.
  const meta2 = await api(token, `${SHEETS}/${id}?fields=sheets.properties(sheetId,title)`);
  const mapa = new Map<string, number>();
  for (const s of (meta2.sheets ?? [])) mapa.set(norm(s.properties.title), s.properties.sheetId);

  const requests: any[] = [];
  for (const [tab, cols] of Object.entries(HOJAS)) {
    const real = (meta2.sheets ?? []).find((s: any) => norm(s.properties.title) === norm(tab))?.properties?.title ?? tab;
    await ensureHeaders(token, id, real, cols);
    const sheetId = mapa.get(norm(tab));
    if (sheetId === undefined) continue;
    // Fila 1 congelada: al hacer scroll los encabezados se quedan arriba.
    requests.push({
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount",
      },
    });
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.26, green: 0.26, blue: 0.65 },
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
      },
    });
    requests.push({ autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: cols.length } } });
  }
  if (requests.length) await api(token, `${SHEETS}/${id}:batchUpdate`, "POST", { requests });
  return { creadas, hojas: Object.keys(HOJAS) };
}

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
