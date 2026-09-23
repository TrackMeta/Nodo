// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: courier-sync  (PÚBLICA — verify_jwt=false)
//
//   La mitad de Nodo del rastreo de guías. La OTRA mitad es una extensión
//   de Chrome que lee la web pública de Shalom; están partidas a propósito:
//   la extensión es la pieza frágil (depende de una web ajena) y no toca la
//   base de datos — solo pregunta qué mirar y reporta qué vio.
//
//   Shalom no expone API y llamar a su endpoint desde un servidor devuelve
//   403 "Origin not allowed": solo contesta a un navegador que estuvo de
//   verdad en su página. De ahí la extensión.
//
//   Esta función no sabe de dónde salió el dato. Recibe "esta guía está en
//   tal etapa" y hace el trabajo. El día que la fuente cambie, se cambia
//   una pieza y lo demás sigue igual.
//
//   Acciones: pendientes | reportar | estado
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/db.ts";
import { fetchConTimeout } from "../_shared/http.ts";

const db = serviceClient();

// Solo se rastrea lo que todavía puede moverse. `en_agencia` sigue en la lista
// para enterarnos de "Entregado" (ver abajo por qué eso NO avanza solo).
const RASTREABLES = ["despachado", "en_agencia"];

// Las cuatro etapas de Shalom, normalizadas. El texto que muestran puede venir
// con tildes, mayúsculas o espacios de más.
function etapaNorm(s: string): string {
  const t = String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (/^en\s*origen/.test(t)) return "en_origen";
  if (/^en\s*transito/.test(t)) return "en_transito";
  if (/^en\s*destino/.test(t)) return "en_destino";
  if (/^entregado/.test(t)) return "entregado";
  return "";
}

// Mezcla en orders.shipping sin pisar lo que ya había (es un JSON con guía,
// sede, flete, clave…). Nunca se escribe `estado` por acá: eso lo hace
// order-update, que además dispara los flujos y el aviso al cliente.
async function sellarShipping(orderId: string, extra: Record<string, unknown>) {
  // Patch ATÓMICO (RPC de la 0068), no leer-mezclar-escribir: el rastreo corre en bucle y el
  // operador puede estar corrigiendo la sede o la clave en «Editar pedido» en ese mismo
  // segundo; el read-modify-write se lo pisaba (paquete a la agencia equivocada).
  // p_touch=false: anotar «se miró» NO reinicia el reloj del pedido (updated_at), que es lo que
  // miden «pedido parado» y los recordatorios por estado (0109).
  const { error } = await db.rpc("order_patch_shipping", { p_order_id: orderId, p_patch: extra, p_touch: false });
  if (error) {
    // Solo se cae al merge si la RPC NO EXISTE (base sin la 0068). Ante cualquier otro error
    // (timeout, permiso) el fallback reintroducía justo la carrera que la RPC evita: leer,
    // mezclar y escribir encima de lo que el operador acababa de corregir. Mejor no sellar
    // ahora: el rastreo corre en bucle y lo vuelve a intentar en la siguiente pasada.
    const noExiste = /42883|PGRST202|does not exist|Could not find the function/i.test(`${(error as any).code ?? ""} ${error.message}`);
    if (!noExiste) { console.warn(`[courier-sync] order_patch_shipping falló (${error.message}); se deja para la próxima pasada`); return; }
    console.warn(`[courier-sync] order_patch_shipping no existe (${error.message}); se cae al merge`);
    const { data: o } = await db.from("orders").select("shipping").eq("id", orderId).maybeSingle();
    const s = { ...((o as any)?.shipping ?? {}), ...extra };
    await db.from("orders").update({ shipping: s }).eq("id", orderId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // FAIL-CLOSED, igual que scheduler y media-gc: sin secreto configurado no se
  // atiende a nadie. "Si hay secreto, exigirlo" se rompe solo con borrar la
  // variable de entorno.
  const secret = Deno.env.get("RASTREO_SECRET") ?? "";
  if (!secret) return json({ error: "sin_secreto" }, 503);
  if (req.headers.get("x-rastreo-secret") !== secret) return json({ error: "no_auth" }, 401);

  // Herramienta de un solo negocio: la cuenta se fija server-side en vez de
  // que la mande el cliente. Si algún día esto es una función para todos los
  // usuarios, esto se cambia por un token por cuenta (como el pairing de
  // Telegram) y desaparece esta variable.
  const accountId = Deno.env.get("RASTREO_ACCOUNT") ?? "";
  if (!accountId) return json({ error: "sin_cuenta" }, 503);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const action = String(body?.action ?? "");

  // Solo canales ACTIVOS: un bot archivado está apagado y no debe seguir moviendo
  // pedidos ni avisando a clientes por su cuenta.
  const { data: chs } = await db.from("channels").select("id").eq("account_id", accountId).eq("activo", true);
  const canales = (chs ?? []).map((c: any) => c.id);
  if (!canales.length) return json({ ok: true, guias: [] });

  try {
    // ── Qué guías hay que mirar ──────────────────────────────────────────────
    // Se devuelven TODAS las de la cuenta, de todos sus canales: la extensión
    // no sabe qué es un canal ni tiene por qué saberlo.
    if (action === "pendientes") {
      const { data: ords } = await db.from("orders")
        .select("id, estado, shipping, updated_at")
        .in("channel_id", canales).in("estado", RASTREABLES)
        // Filtrado EN la consulta y en rueda por el último intento: antes eran los 500 más viejos
        // por updated_at y RECIÉN después se descartaban los que no son Shalom o no tienen guía;
        // esos nunca se sellaban, así que 500 de ellos dejaban la extensión ciega para siempre.
        // Y updated_at ya no sirve de rueda: el rastreo lo sella sin tocarlo (0109).
        .ilike("shipping->>agencia", "shalom")
        .not("shipping->>guia", "is", null).not("shipping->>codigo_envio", "is", null)
        .order("shipping->>rastreo_intento_at", { ascending: true, nullsFirst: true }).limit(500);

      const guias = (ords ?? []).flatMap((o: any) => {
        const s = o.shipping ?? {};
        if (String(s.agencia ?? "").toLowerCase() !== "shalom") return [];
        // El N° de orden de Shalom es solo dígitos; el código, letras y números.
        // Una guía con otro formato no se puede consultar: se deja fuera en vez
        // de gastar una consulta que va a fallar siempre.
        const guia = String(s.guia ?? "").replace(/\D/g, "");
        const codigo = String(s.codigo_envio ?? "").trim();
        if (!guia || !codigo) return [];
        return [{
          order_id: o.id, guia, codigo, estado: o.estado,
          visto: s.rastreo_etapa ?? null,          // la última etapa que leímos
          visto_at: s.rastreo_at ?? null,
        }];
      });
      return json({ ok: true, guias });
    }

    // ── Qué vio la extensión ─────────────────────────────────────────────────
    if (action === "reportar") {
      const items = Array.isArray(body?.items) ? body.items : [];
      const ahora = new Date().toISOString();
      const res: any[] = [];

      for (const it of items) {
        const orderId = String(it?.order_id ?? "");
        if (!orderId) continue;
        const { data: o } = await db.from("orders")
          .select("id, estado, channel_id, shipping").eq("id", orderId).maybeSingle();
        // Que el pedido sea de ESTA cuenta: el id viene del cliente.
        if (!o || !canales.includes((o as any).channel_id)) { res.push({ orderId, r: "ajeno" }); continue; }

        // No se pudo leer esta guía: se anota el intento fallido y se sigue. La
        // decisión de "esto se rompió" NO se toma por una guía suelta.
        if (it?.error) {
          await sellarShipping(orderId, { rastreo_intento_at: ahora, rastreo_error: String(it.error).slice(0, 200) });
          res.push({ orderId, r: "error" });
          continue;
        }

        const etapa = etapaNorm(it?.etapa ?? "");
        if (!etapa) {
          await sellarShipping(orderId, { rastreo_intento_at: ahora, rastreo_error: "etapa desconocida" });
          res.push({ orderId, r: "etapa_rara" });
          continue;
        }

        const base: Record<string, unknown> = {
          rastreo_etapa: etapa, rastreo_at: ahora, rastreo_intento_at: ahora, rastreo_error: null,
          rastreo_desde: it?.desde ?? null,   // "16/09/26 a las 19:58", tal cual lo muestra Shalom
        };

        // «En destino» = llegó a la agencia. ESTE es el único avance automático:
        // mueve el pedido y order-update dispara el aviso al cliente que ya existe.
        if (etapa === "en_destino" && (o as any).estado === "despachado") {
          await sellarShipping(orderId, base);
          // Con timeout: la extensión manda hasta 60 guías por llamada y un order-update colgado
          // (cold start, lock del contacto) dejaba esperando la función entera y se perdían los
          // resultados de TODAS las guías siguientes del lote.
          const r = await fetchConTimeout(`${Deno.env.get("SUPABASE_URL")}/functions/v1/order-update`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // Presentar la service key es la prueba de ser código nuestro: es el
              // camino "interno" que order-update ya acepta (lo usa el Copiloto).
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
            },
            body: JSON.stringify({ order_id: orderId, estado: "en_agencia" }),
          }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
          res.push({ orderId, r: r?.error ? "fallo_mover" : "movido_en_agencia", detalle: r?.error ?? null });
          continue;
        }

        // «Entregado» NO avanza solo, y es deliberado:
        //  · `recogido` exige `saldo_pagado` antes (lo pide el propio tablero), así
        //    que moverlo saltaría el paso donde cobras.
        //  · Y si Shalom dice entregado y el saldo NO está pagado, eso no es un
        //    avance: es que se llevaron el paquete sin pagarte. Se marca para que
        //    lo veas, no se registra en silencio.
        if (etapa === "entregado") {
          const cobrado = ["saldo_pagado", "recogido", "entregado_cobrado"].includes((o as any).estado);
          await sellarShipping(orderId, { ...base, rastreo_entregado: true, rastreo_alerta: cobrado ? null : "entregado_sin_saldo" });
          res.push({ orderId, r: cobrado ? "entregado" : "entregado_sin_saldo" });
          continue;
        }

        // En origen / en tránsito, o «en destino» sobre un pedido que ya estaba
        // en agencia: no hay nada que mover, solo dejar constancia de que se miró.
        await sellarShipping(orderId, base);
        res.push({ orderId, r: "sin_cambio" });
      }
      return json({ ok: true, resultados: res, at: ahora });
    }

    // ── ¿Sigue vivo el rastreo? ──────────────────────────────────────────────
    // El latido NO se guarda aparte: es el intento más reciente sobre cualquier
    // guía. Así no hay estado que mantener, y si la extensión se muere Nodo lo
    // nota por el silencio — que es justo lo que un aviso hecho por la extensión
    // nunca podría contar, porque el que tendría que avisar es el que murió.
    if (action === "estado") {
      const { data: ords } = await db.from("orders")
        .select("shipping").in("channel_id", canales).in("estado", RASTREABLES).limit(500);
      let ultimo: string | null = null; let conError = 0; let vigiladas = 0;
      for (const o of (ords ?? [])) {
        const s = (o as any).shipping ?? {};
        if (String(s.agencia ?? "").toLowerCase() !== "shalom") continue;
        if (!String(s.guia ?? "").trim() || !String(s.codigo_envio ?? "").trim()) continue;
        vigiladas++;
        if (s.rastreo_error) conError++;
        const t = s.rastreo_intento_at ?? null;
        if (t && (!ultimo || t > ultimo)) ultimo = t;
      }
      return json({ ok: true, vigiladas, con_error: conError, ultimo_intento: ultimo });
    }

    return json({ error: "accion_invalida" }, 400);
  } catch (e) {
    console.error("[courier-sync] error:", e);
    return json({ error: "interno", detalle: String((e as any)?.message ?? e) }, 500);
  }
});
