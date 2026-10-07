// ⏱️ El cliente de base de UN turno del motor (8-oct). Dos cosas:
//
// 1) Memoria de lecturas. Medido en un turno real de Prime Digital: ~95 consultas en fila a ~50 ms (≈4 s antes de que
//    la IA empiece) y muchas repetidas — los datos del bot 11 veces con columnas distintas, el producto 4, el cliente
//    14, el último pedido 3 veces la misma. Acá cada lectura repetida sale de memoria:
//    · Configuración (bot, producto, flujo…): no cambia en el turno. Se lee UNA vez la fila entera (`select=*`) y cada
//      consulta recibe solo sus columnas. Si el motor escribe en esa tabla, se olvida.
//    · Cliente, pedidos y mensajes del bot: SÍ cambian en el turno. Se guardan como mucho 4 s y se olvidan con
//      cualquier escritura del motor (los triggers de la base tocan al cliente al insertar mensajes o pedidos).
//    · Mensajes del CLIENTE y lo que pregunta por el operador (`sent_by`) o por `bot_activo`: siempre frescos. Así se
//      sabe que el cliente escribió o que una persona tomó el chat mientras el bot pensaba.
//    · Una función de la base (rpc) que no está en la lista de solo-lectura borra toda la memoria.
//
// 2) Lo que va DESPUÉS de responder (`despues`). La hoja de Google, el Purchase a Meta y los avisos al dueño (Telegram
//    con la foto) iban ANTES del acceso: ~7 s del cliente que acaba de pagar esperando cosas que son para el dueño.
//    Dentro de un turno se encolan y corren cuando el turno terminó (runEngine). Fuera de un turno, al toque, como antes.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const CONFIG = new Set(["channels", "products", "product_versions", "flows", "flow_nodes", "flow_edges", "flow_triggers",
  "custom_fields", "angulos", "tags", "sequences"]);
// Con fila entera por id (`?select=cols&id=eq.X`): las que se leen muchas veces con columnas distintas.
const POR_FILA = new Set(["channels", "products", "product_versions", "contacts"]);
const VIVAS = new Set(["contacts", "orders", "messages"]);
const VIVAS_MS = 4000;
// Escribir acá NO cambia al cliente ni a sus pedidos (bitácoras): no hace falta olvidar lo vivo.
const BITACORAS = new Set(["contact_events", "capi_events", "variante_envios", "notificaciones", "ai_usage"]);
const RPC_LECTURA = new Set(["get_channel_secrets", "get_channel_ai_active", "contact_lock_try", "contact_lock_release",
  "ai_usage_add", "get_gsheets_token"]);

type Guardado = { t: number; tabla: string; p: Promise<{ status: number; body: string; ctype: string } | null> };

export type ClienteDeTurno = SupabaseClient & { _despues?: Array<() => Promise<unknown>>; _memoria?: Map<string, Guardado> };

function cabecera(init: RequestInit | undefined, k: string): string {
  try { return new Headers(init?.headers).get(k) ?? ""; } catch (_) { return ""; }
}

function memoriaFetch(base: typeof fetch, mem: Map<string, Guardado>): typeof fetch {
  const olvidar = (tabla: string) => {
    const vivas = !BITACORAS.has(tabla);
    for (const [k, g] of mem) if (g.tabla === tabla || (vivas && VIVAS.has(g.tabla))) mem.delete(k);
  };
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const metodo = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const i = url.indexOf("/rest/v1/");
    if (i < 0) return base(input as any, init);
    const u = new URL(url);
    const ruta = u.pathname.slice(u.pathname.indexOf("/rest/v1/") + 9);
    if (ruta.startsWith("rpc/")) {
      if (!RPC_LECTURA.has(ruta.slice(4))) mem.clear();
      return base(input as any, init);
    }
    const tabla = ruta.split("/")[0];
    if (metodo !== "GET") {
      if (metodo !== "HEAD") olvidar(tabla);
      return base(input as any, init);
    }
    const viva = VIVAS.has(tabla);
    if (!CONFIG.has(tabla) && !viva) return base(input as any, init);
    const sel = u.searchParams.get("select") ?? "*";
    // Siempre frescas: lo que el cliente escribió, lo que hizo el operador, si el bot sigue activo, y los conteos.
    if (tabla === "messages" && (u.searchParams.get("direction") !== "eq.out" || u.searchParams.has("sent_by"))) return base(input as any, init);
    if (/bot_activo|bloqueado/.test(sel) || /count=/.test(cabecera(init, "Prefer"))) return base(input as any, init);
    const accept = cabecera(init, "Accept") || "application/json";
    if (accept !== "application/json" && accept !== "application/vnd.pgrst.object+json") return base(input as any, init);
    const vigente = (g: Guardado | undefined) => !!g && (!viva || Date.now() - g.t < VIVAS_MS);

    // ── Fila entera por id: una lectura sirve a todas las columnas ──
    const claves = [...u.searchParams.keys()];
    const id = u.searchParams.get("id") ?? "";
    if (POR_FILA.has(tabla) && claves.length === 2 && claves.includes("select") && /^eq\.[\w-]+$/.test(id)
        && (sel === "*" || /^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$/.test(sel))) {
      const k = `fila:${tabla}:${id}`;
      let g = mem.get(k);
      if (!vigente(g)) {
        const uF = new URL(u.toString()); uF.searchParams.set("select", "*");
        const h = new Headers(init?.headers); h.set("Accept", "application/json");
        g = { t: Date.now(), tabla, p: base(uF.toString(), { ...init, method: "GET", headers: h })
          .then(async (r) => r.ok ? { status: r.status, body: await r.text(), ctype: "application/json" } : null)
          .catch(() => null) };
        mem.set(k, g);
      }
      const r = await g.p;
      if (!r) { mem.delete(k); return base(input as any, init); }
      let filas: any[];
      try { filas = JSON.parse(r.body); } catch (_) { mem.delete(k); return base(input as any, init); }
      const cols = sel === "*" ? null : sel.split(",");
      const proy = filas.map((f) => cols ? Object.fromEntries(cols.map((c) => [c, f?.[c] ?? null])) : f);
      if (accept === "application/vnd.pgrst.object+json") {
        if (proy.length !== 1) return base(input as any, init);   // el 406 y su mensaje los arma la base
        return new Response(JSON.stringify(proy[0]), { status: 200, headers: { "content-type": "application/vnd.pgrst.object+json; charset=utf-8" } });
      }
      return new Response(JSON.stringify(proy), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
    }

    // ── La misma consulta exacta ──
    const k = `url:${accept}:${u.toString()}`;
    let g = mem.get(k);
    if (!vigente(g)) {
      g = { t: Date.now(), tabla, p: base(input as any, init)
        .then(async (r) => r.ok ? { status: r.status, body: await r.text(), ctype: r.headers.get("content-type") ?? "application/json" } : null)
        .catch(() => null) };
      mem.set(k, g);
    }
    const r = await g.p;
    if (!r) { mem.delete(k); return base(input as any, init); }
    return new Response(r.body, { status: r.status, headers: { "content-type": r.ctype } });
  };
}

// Un cliente nuevo por turno, con la misma llave de servicio. Si `db` no es el de servicio (otro rol), se usa tal cual.
export function clienteDeTurno(db: SupabaseClient): ClienteDeTurno {
  try {
    const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key || (db as any)?.supabaseKey !== key) return db as ClienteDeTurno;
    const mem = new Map<string, Guardado>();
    const c = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: memoriaFetch(fetch, mem) },
    }) as ClienteDeTurno;
    c._despues = [];
    c._memoria = mem;
    return c;
  } catch (_) { return db as ClienteDeTurno; }
}

// Dentro de un turno: se encola para después de responder. Fuera (panel, scheduler sin turno): corre ya.
export async function despues(db: SupabaseClient, nombre: string, fn: () => Promise<unknown>): Promise<void> {
  const q = (db as ClienteDeTurno)._despues;
  if (Array.isArray(q)) { q.push(async () => { try { await fn(); } catch (e) { console.error(`[despues] ${nombre}:`, (e as any)?.message ?? e); } }); return; }
  try { await fn(); } catch (e) { console.error(`[despues] ${nombre}:`, (e as any)?.message ?? e); }
}

// Al final del turno: lo encolado, en orden, con la memoria vacía (lee todo fresco).
export async function vaciarDespues(db: SupabaseClient): Promise<void> {
  const c = db as ClienteDeTurno;
  c._memoria?.clear();
  const q = c._despues;
  if (!Array.isArray(q)) return;
  delete c._despues;   // lo que se encole mientras corre esto, corre al toque
  for (const f of q) await f();
}
