// ═══════════════════════════════════════════════════════════════════
// Base de Apps · función `kit` (PÚBLICA, verify_jwt=false)
//   La llama el kit que va dentro de cada micro app (kit/nodo-apps.js).
//   Nunca confía en la app: todo se decide por el link personal (token) o por la
//   pulsera (sesión) que el kit guarda en el navegador.
//   Acciones:
//     ping      → «Probar conexión» del panel: la app avisa que tiene el kit puesto.
//     entrar    → con el link personal (?acceso=) crea una pulsera para este celular.
//     estado    → ¿esta pulsera tiene acceso? (activo / vencido / bloqueado / prueba…)
//     leer      → devuelve el progreso (casillero) del cliente.
//     guardar   → guarda el progreso.
// ═══════════════════════════════════════════════════════════════════
import { db as mkDb, json, cors, sha256, codigo, estadoDe } from "../_shared/comun.ts";

const db = mkDb();
const MAX_PROGRESO = 200_000;            // bytes de JSON por casillero (texto: alcanza de sobra)
const TOQUE_MS = 5 * 60_000;             // «último uso» se escribe como mucho cada 5 min por sesión

async function appPorClave(clave: string) {
  if (!clave || typeof clave !== "string") return null;
  const { data } = await db.from("apps").select("id, nombre, url, max_celulares, wa_bot").eq("clave", clave).maybeSingle();
  return data as any;
}

function infoEstado(app: any, a: any) {
  const estado = estadoDe(a);
  const wa = String(app?.wa_bot || "").replace(/\D/g, "");
  const quiere = estado === "prueba_terminada" ? `Hola, quiero comprar ${app?.nombre || "la app"}` : `Hola, quiero renovar ${app?.nombre || "la app"}`;
  return {
    ok: true,
    estado,
    tipo: a.tipo,
    vence_at: a.vence_at ?? null,
    nombre: a.nombre || "",
    app: app?.nombre || "",
    // A dónde manda el botón «Renovar» del kit: el chat del bot, con el mensaje ya escrito.
    renovar: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(quiere)}` : "",
  };
}

async function sesionDe(appId: string, pulsera: string) {
  if (!pulsera || typeof pulsera !== "string" || pulsera.length < 16) return null;
  const h = await sha256(pulsera);
  const { data } = await db.from("sesiones")
    .select("id, ultimo_uso_at, acceso:accesos!inner(id, app_id, tipo, vence_at, bloqueado, nombre, ultimo_uso_at)")
    .eq("pulsera_hash", h).maybeSingle();
  const s: any = data;
  if (!s || s.acceso?.app_id !== appId) return null;
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, motivo: "metodo" }, 405);
  let b: any = {};
  try { b = await req.json(); } catch { return json({ ok: false, motivo: "json" }, 400); }
  const app = await appPorClave(b.app);
  if (!app) return json({ ok: false, motivo: "app_desconocida" }, 404);

  try {
    switch (b.accion) {
      case "ping": {
        const nivel = b.nivel === "basico" ? "basico" : "reforzado";
        await db.from("apps").update({ kit_visto_at: new Date().toISOString(), kit_nivel: nivel }).eq("id", app.id);
        return json({ ok: true, app: app.nombre });
      }

      case "entrar": {
        const token = String(b.acceso || "");
        if (token.length < 16) return json({ ok: false, motivo: "link_invalido" });
        const { data: a } = await db.from("accesos").select("id, app_id, tipo, vence_at, bloqueado, nombre")
          .eq("token", token).eq("app_id", app.id).maybeSingle();
        if (!a) return json({ ok: false, motivo: "link_invalido" });
        // Ya tenía pulsera en este navegador y sigue viva → no se crea otra.
        if (b.pulsera) {
          const s = await sesionDe(app.id, String(b.pulsera));
          if (s && s.acceso.id === (a as any).id) return json({ ...infoEstado(app, a), pulsera: b.pulsera });
        }
        const pulsera = codigo(40);
        const ahora = new Date().toISOString();
        await db.from("sesiones").insert({
          acceso_id: (a as any).id, pulsera_hash: await sha256(pulsera),
          etiqueta: String(b.etiqueta || "").slice(0, 60), creado_at: ahora, ultimo_uso_at: ahora,
        });
        await db.from("eventos_acceso").insert({ acceso_id: (a as any).id, tipo: "celular_nuevo", detalle: String(b.etiqueta || "").slice(0, 60) });
        // Límite de celulares: se desconecta el que lleva más tiempo sin usarse.
        const { data: ses } = await db.from("sesiones").select("id, etiqueta, ultimo_uso_at")
          .eq("acceso_id", (a as any).id).order("ultimo_uso_at", { ascending: false });
        const max = Math.max(1, Number(app.max_celulares) || 2);
        const sobran = (ses ?? []).slice(max);
        for (const s of sobran as any[]) {
          await db.from("sesiones").delete().eq("id", s.id);
          await db.from("eventos_acceso").insert({ acceso_id: (a as any).id, tipo: "desconectado_por_limite", detalle: s.etiqueta || "" });
        }
        await db.from("accesos").update({ ultimo_uso_at: ahora }).eq("id", (a as any).id);
        return json({ ...infoEstado(app, a), pulsera });
      }

      case "estado": {
        const s = await sesionDe(app.id, String(b.pulsera || ""));
        if (!s) return json({ ok: false, motivo: "sin_sesion" });
        const ahora = Date.now();
        if (!s.ultimo_uso_at || ahora - new Date(s.ultimo_uso_at).getTime() > TOQUE_MS) {
          const iso = new Date(ahora).toISOString();
          await db.from("sesiones").update({ ultimo_uso_at: iso }).eq("id", s.id);
          await db.from("accesos").update({ ultimo_uso_at: iso }).eq("id", s.acceso.id);
        }
        return json(infoEstado(app, s.acceso));
      }

      case "leer":
      case "guardar": {
        const s = await sesionDe(app.id, String(b.pulsera || ""));
        if (!s) return json({ ok: false, motivo: "sin_sesion" });
        const est = estadoDe(s.acceso);
        if (est !== "activo" && est !== "prueba") return json({ ok: false, motivo: "sin_acceso", estado: est });
        if (b.accion === "leer") {
          const { data } = await db.from("progreso").select("datos, actualizado_at").eq("acceso_id", s.acceso.id).maybeSingle();
          return json({ ok: true, datos: (data as any)?.datos ?? {}, actualizado_at: (data as any)?.actualizado_at ?? null });
        }
        const datos = b.datos ?? {};
        if (typeof datos !== "object" || Array.isArray(datos)) return json({ ok: false, motivo: "datos_invalidos" }, 400);
        if (JSON.stringify(datos).length > MAX_PROGRESO) return json({ ok: false, motivo: "muy_grande" }, 413);
        const iso = new Date().toISOString();
        await db.from("progreso").upsert({ acceso_id: s.acceso.id, datos, actualizado_at: iso });
        return json({ ok: true, actualizado_at: iso });
      }

      default:
        return json({ ok: false, motivo: "accion_desconocida" }, 400);
    }
  } catch (e) {
    console.error("[kit]", (e as any)?.message ?? e);
    return json({ ok: false, motivo: "error" }, 500);
  }
});
