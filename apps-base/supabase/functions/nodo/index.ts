// ═══════════════════════════════════════════════════════════════════
// Base de Apps · función `nodo` (INTERNA, servidor a servidor)
//   Solo la llama Nodo (función `microapps` y el motor), con el header
//   x-nodo-secret = NODO_APPS_SECRET. Fail-closed: sin secreto no atiende.
//   Nodo ya verificó que el usuario del panel es dueño del bot (channel_id):
//   acá cada acción se limita a las apps de ESE bot.
// ═══════════════════════════════════════════════════════════════════
import { db as mkDb, json, cors, codigo, estadoDe, linkPersonal, timingSafeEqual } from "../_shared/comun.ts";

const db = mkDb();
const DIA = 86_400_000;

function sumarMeses(base: Date, meses: number): Date {
  const d = new Date(base.getTime());
  const dia = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + meses);
  const ult = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ult));   // 31-ene + 1 mes = 28/29-feb, no 3-mar
  return d;
}

async function appDeProducto(productId: string) {
  const { data } = await db.from("apps").select("*").eq("nodo_product_id", productId).maybeSingle();
  return data as any;
}
async function accesoDelBot(channelId: string, accesoId: string) {
  const { data } = await db.from("accesos").select("*, app:apps!inner(id, nombre, url, nodo_channel_id, nodo_product_id, max_celulares)")
    .eq("id", accesoId).maybeSingle();
  const a: any = data;
  if (!a || a.app?.nodo_channel_id !== channelId) return null;
  return a;
}
function fila(a: any, app: any) {
  return {
    id: a.id, app_id: a.app_id, app: app?.nombre ?? a.app?.nombre ?? "", product_id: app?.nodo_product_id ?? a.app?.nodo_product_id ?? null,
    contact_id: a.nodo_contact_id, wa_id: a.wa_id, nombre: a.nombre, correo: a.correo, telefono: a.telefono, promos: a.promos,
    tipo: a.tipo, vence_at: a.vence_at, bloqueado: a.bloqueado, estado: estadoDe(a), ultimo_uso_at: a.ultimo_uso_at,
    creado_at: a.creado_at, order_id: a.nodo_order_id, prueba_usada: a.prueba_usada,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("NODO_APPS_SECRET");
  if (!secret) return json({ ok: false, error: "sin_secreto" }, 503);
  if (!timingSafeEqual(req.headers.get("x-nodo-secret") ?? "", secret)) return json({ ok: false, error: "forbidden" }, 403);
  let b: any = {};
  try { b = await req.json(); } catch { return json({ ok: false, error: "json" }, 400); }
  const ahora = Date.now();
  const iso = () => new Date().toISOString();

  try {
    switch (b.accion) {
      // ── Conexión de la app (pantalla del producto) ──────────────────
      case "registrar_app": {
        if (!b.channel_id || !b.product_id) return json({ ok: false, error: "faltan_ids" }, 400);
        const cambios = {
          nodo_channel_id: b.channel_id, nombre: String(b.nombre ?? "").slice(0, 120), url: String(b.url ?? "").trim().slice(0, 300),
          max_celulares: Math.min(20, Math.max(1, Number(b.max_celulares) || 2)), wa_bot: String(b.wa_bot ?? "").replace(/\D/g, ""),
        };
        let app = await appDeProducto(b.product_id);
        if (app) {
          if (app.nodo_channel_id !== b.channel_id) return json({ ok: false, error: "otro_bot" }, 403);
          await db.from("apps").update(cambios).eq("id", app.id);
        } else {
          const { data, error } = await db.from("apps").insert({ ...cambios, nodo_product_id: b.product_id, clave: "app_" + codigo(14) }).select("*").single();
          if (error) throw error;
          app = data;
        }
        const { data: fresca } = await db.from("apps").select("*").eq("id", app.id).single();
        return json({ ok: true, app: fresca });
      }
      case "estado_app": {
        const app = await appDeProducto(b.product_id);
        if (!app || (b.channel_id && app.nodo_channel_id !== b.channel_id)) return json({ ok: true, app: null });
        return json({ ok: true, app });
      }

      // ── Venta: dar / extender acceso ────────────────────────────────
      case "dar_acceso": {
        const app = await appDeProducto(b.product_id);
        if (!app) return json({ ok: false, error: "app_no_conectada" });
        const c = b.contacto ?? {};
        if (!c.id) return json({ ok: false, error: "falta_contacto" }, 400);
        const tipo = ["unico", "mensual", "prueba"].includes(b.tipo) ? b.tipo : "unico";
        const { data: prev } = await db.from("accesos").select("*").eq("app_id", app.id).eq("nodo_contact_id", c.id).maybeSingle();
        const p: any = prev;
        const datos: any = {
          wa_id: String(c.wa_id ?? p?.wa_id ?? ""), nombre: String(c.nombre ?? p?.nombre ?? "").slice(0, 120),
          actualizado_at: iso(), nodo_order_id: b.order_id ?? p?.nodo_order_id ?? null,
        };
        if (b.correo !== undefined && b.correo !== null && b.correo !== "") datos.correo = String(b.correo).trim().toLowerCase();
        if (b.telefono) datos.telefono = String(b.telefono).replace(/[^\d+]/g, "");
        if (typeof b.promos === "boolean") datos.promos = b.promos;
        let renovado = false;

        if (tipo === "prueba") {
          if (p) return json({ ok: false, error: p.prueba_usada && p.tipo === "prueba" ? "ya_tuvo_prueba" : "ya_tiene_acceso", acceso: fila(p, app) });
          const horas = Math.min(24 * 30, Math.max(1, Number(b.horas) || 24));
          Object.assign(datos, { tipo: "prueba", vence_at: new Date(ahora + horas * 3600_000).toISOString(), prueba_usada: true });
        } else if (tipo === "unico") {
          Object.assign(datos, { tipo: "unico", vence_at: null, bloqueado: false, aviso_previo_at: null, aviso_vencido_at: null });
          renovado = !!p;
        } else {
          const meses = Math.min(24, Math.max(1, Math.round(Number(b.meses) || 1)));
          // Ya es de por vida: comprar un mes no le quita nada (se registra el pago y listo).
          if (p && p.tipo === "unico" && !p.bloqueado) {
            await db.from("accesos").update(datos).eq("id", p.id);
            const { data: a2 } = await db.from("accesos").select("*").eq("id", p.id).single();
            return json({ ok: true, acceso: fila(a2, app), token: (a2 as any).token, link: linkPersonal(app.url, (a2 as any).token), renovado: false, ya_de_por_vida: true });
          }
          const vivo = p && p.tipo === "mensual" && p.vence_at && new Date(p.vence_at).getTime() > ahora;
          const base = vivo ? new Date(p.vence_at) : new Date(ahora);   // pagó antes: se suma desde su vencimiento
          Object.assign(datos, { tipo: "mensual", vence_at: sumarMeses(base, meses).toISOString(), bloqueado: false, aviso_previo_at: null, aviso_vencido_at: null });
          renovado = !!p && p.tipo === "mensual";
        }

        let a: any;
        if (p) {
          const { data, error } = await db.from("accesos").update(datos).eq("id", p.id).select("*").single();
          if (error) throw error; a = data;
        } else {
          const { data, error } = await db.from("accesos").insert({ ...datos, app_id: app.id, nodo_contact_id: c.id, token: codigo(28) }).select("*").single();
          if (error) throw error; a = data;
        }
        return json({ ok: true, acceso: fila(a, app), token: a.token, link: linkPersonal(app.url, a.token), renovado });
      }

      // ¿Este cliente ya tiene acceso a esta app? (el motor lo usa para «mi acceso», renovar, prueba)
      case "acceso_de": {
        const app = await appDeProducto(b.product_id);
        if (!app) return json({ ok: true, acceso: null, app: null });
        const { data } = await db.from("accesos").select("*").eq("app_id", app.id).eq("nodo_contact_id", b.contact_id).maybeSingle();
        const a: any = data;
        return json({ ok: true, app: { nombre: app.nombre, url: app.url }, acceso: a ? fila(a, app) : null, link: a ? linkPersonal(app.url, a.token) : "" });
      }
      // Todos los accesos de un contacto en este bot (post-venta: «mi acceso» sin saber de qué app).
      case "accesos_de_contacto": {
        const { data } = await db.from("accesos").select("*, app:apps!inner(id, nombre, url, nodo_channel_id, nodo_product_id)")
          .eq("nodo_contact_id", b.contact_id).eq("app.nodo_channel_id", b.channel_id);
        return json({ ok: true, accesos: (data ?? []).map((a: any) => ({ ...fila(a, a.app), link: linkPersonal(a.app.url, a.token) })) });
      }

      // ── Panel «Accesos» ─────────────────────────────────────────────
      case "listar": {
        const { data: apps } = await db.from("apps").select("id, nombre, nodo_product_id, url, max_celulares, kit_visto_at").eq("nodo_channel_id", b.channel_id);
        const ids = (apps ?? []).map((x: any) => x.id);
        if (!ids.length) return json({ ok: true, apps: [], accesos: [] });
        const filas: any[] = [];
        for (let desde = 0; ; desde += 1000) {      // PostgREST corta en 1000 filas
          const { data, error } = await db.from("accesos").select("*, sesiones(count)").in("app_id", ids)
            .order("creado_at", { ascending: false }).range(desde, desde + 999);
          if (error) throw error;
          filas.push(...(data ?? []));
          if ((data ?? []).length < 1000) break;
        }
        const porId: any = Object.fromEntries((apps ?? []).map((x: any) => [x.id, x]));
        return json({ ok: true, apps, accesos: filas.map((a: any) => ({ ...fila(a, porId[a.app_id]), celulares: a.sesiones?.[0]?.count ?? 0 })) });
      }
      case "detalle": {
        const a = await accesoDelBot(b.channel_id, b.id);
        if (!a) return json({ ok: false, error: "no_existe" }, 404);
        const [{ data: ses }, { data: ev }, { data: pr }] = await Promise.all([
          db.from("sesiones").select("id, etiqueta, creado_at, ultimo_uso_at").eq("acceso_id", a.id).order("ultimo_uso_at", { ascending: false }),
          db.from("eventos_acceso").select("tipo, detalle, creado_at").eq("acceso_id", a.id).order("creado_at", { ascending: false }).limit(30),
          db.from("progreso").select("actualizado_at").eq("acceso_id", a.id).maybeSingle(),
        ]);
        return json({ ok: true, acceso: fila(a, a.app), max_celulares: a.app.max_celulares, link: linkPersonal(a.app.url, a.token),
          sesiones: ses ?? [], eventos: ev ?? [], progreso_at: (pr as any)?.actualizado_at ?? null });
      }
      case "extender": {
        const dias = Math.round(Number(b.dias) || 0);
        if (!dias || Math.abs(dias) > 3650) return json({ ok: false, error: "dias" }, 400);
        let n = 0;
        for (const id of (b.ids ?? []).slice(0, 2000)) {
          const a = await accesoDelBot(b.channel_id, id);
          if (!a || !a.vence_at) continue;              // de por vida: no hay nada que extender
          const base = Math.max(ahora, new Date(a.vence_at).getTime());
          await db.from("accesos").update({ vence_at: new Date(base + dias * DIA).toISOString(), aviso_previo_at: null, aviso_vencido_at: null, actualizado_at: iso() }).eq("id", id);
          await db.from("eventos_acceso").insert({ acceso_id: id, tipo: "extendido", detalle: `${dias} días` });
          n++;
        }
        return json({ ok: true, extendidos: n });
      }
      case "bloquear": {
        const a = await accesoDelBot(b.channel_id, b.id);
        if (!a) return json({ ok: false, error: "no_existe" }, 404);
        await db.from("accesos").update({ bloqueado: !!b.bloqueado, actualizado_at: iso() }).eq("id", a.id);
        await db.from("eventos_acceso").insert({ acceso_id: a.id, tipo: b.bloqueado ? "bloqueado" : "desbloqueado" });
        return json({ ok: true });
      }
      case "cambiar_correo": {
        const a = await accesoDelBot(b.channel_id, b.id);
        if (!a) return json({ ok: false, error: "no_existe" }, 404);
        const correo = String(b.correo ?? "").trim().toLowerCase();
        if (correo && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(correo)) return json({ ok: false, error: "correo_invalido" }, 400);
        await db.from("accesos").update({ correo: correo || null, actualizado_at: iso() }).eq("id", a.id);
        await db.from("eventos_acceso").insert({ acceso_id: a.id, tipo: "correo_cambiado", detalle: correo });
        return json({ ok: true });
      }
      case "desconectar": {
        const { data: s } = await db.from("sesiones").select("id, etiqueta, acceso_id").eq("id", b.sesion_id).maybeSingle();
        if (!s) return json({ ok: true });
        const a = await accesoDelBot(b.channel_id, (s as any).acceso_id);
        if (!a) return json({ ok: false, error: "no_existe" }, 404);
        await db.from("sesiones").delete().eq("id", (s as any).id);
        await db.from("eventos_acceso").insert({ acceso_id: a.id, tipo: "desconectado", detalle: (s as any).etiqueta || "" });
        return json({ ok: true });
      }

      // ── Recordatorios (los pide el scheduler de Nodo) ──────────────
      case "pendientes_aviso": {
        const app = await appDeProducto(b.product_id);
        if (!app) return json({ ok: true, previo: [], vencido: [], prueba_fin: [] });
        const dias = Math.min(30, Math.max(0, Number(b.dias_previo) || 0));
        const hace3 = new Date(ahora - 3 * DIA).toISOString(), ya = new Date(ahora).toISOString();
        const sel = "id, nodo_contact_id, nombre, tipo, vence_at, bloqueado";
        const [prev, venc, prue] = await Promise.all([
          b.previo ? db.from("accesos").select(sel).eq("app_id", app.id).eq("tipo", "mensual").eq("bloqueado", false).is("aviso_previo_at", null)
            .gt("vence_at", ya).lte("vence_at", new Date(ahora + dias * DIA).toISOString()).limit(200) : Promise.resolve({ data: [] }),
          b.vencido ? db.from("accesos").select(sel).eq("app_id", app.id).eq("tipo", "mensual").eq("bloqueado", false).is("aviso_vencido_at", null)
            .lte("vence_at", ya).gt("vence_at", hace3).limit(200) : Promise.resolve({ data: [] }),
          b.prueba_fin ? db.from("accesos").select(sel).eq("app_id", app.id).eq("tipo", "prueba").is("aviso_vencido_at", null)
            .lte("vence_at", ya).gt("vence_at", hace3).limit(200) : Promise.resolve({ data: [] }),
        ]);
        return json({ ok: true, previo: (prev as any).data ?? [], vencido: (venc as any).data ?? [], prueba_fin: (prue as any).data ?? [] });
      }
      case "marcar_aviso": {
        const col = b.cual === "previo" ? "aviso_previo_at" : "aviso_vencido_at";
        await db.from("accesos").update({ [col]: iso() }).eq("id", b.id);
        await db.from("eventos_acceso").insert({ acceso_id: b.id, tipo: "aviso_" + (b.cual === "previo" ? "por_vencer" : b.cual === "prueba_fin" ? "prueba_terminada" : "vencido") });
        return json({ ok: true });
      }
      // Cuentas que parecen compartidas: más de 3 celulares nuevos en 7 días.
      case "alertas": {
        const { data: apps } = await db.from("apps").select("id").eq("nodo_channel_id", b.channel_id);
        const ids = (apps ?? []).map((x: any) => x.id);
        if (!ids.length) return json({ ok: true, compartidas: [] });
        const { data: ev } = await db.from("eventos_acceso").select("acceso_id, acceso:accesos!inner(app_id, nombre, nodo_contact_id)")
          .eq("tipo", "celular_nuevo").gte("creado_at", new Date(ahora - 7 * DIA).toISOString()).in("acceso.app_id", ids).limit(5000);
        const cuenta: Record<string, any> = {};
        for (const e of (ev ?? []) as any[]) (cuenta[e.acceso_id] ||= { acceso_id: e.acceso_id, nombre: e.acceso?.nombre, contact_id: e.acceso?.nodo_contact_id, n: 0 }).n++;
        return json({ ok: true, compartidas: Object.values(cuenta).filter((x: any) => x.n > 3) });
      }

      default:
        return json({ ok: false, error: "accion_desconocida" }, 400);
    }
  } catch (e) {
    console.error("[nodo]", b?.accion, (e as any)?.message ?? e);
    return json({ ok: false, error: String((e as any)?.message ?? e) }, 500);
  }
});
