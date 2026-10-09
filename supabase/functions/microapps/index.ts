// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: microapps  (AUTENTICADA — la llama el panel)
//   Puente del panel con la base de Apps (proyecto Supabase aparte): conectar
//   una micro app, la sección «Accesos» (listar, extender, bloquear, cambiar
//   correo, desconectar un celular, reenviar el acceso) y dar un acceso a mano.
//   El panel nunca habla con la base de Apps: pasa por acá, que verifica que el
//   usuario es dueño del bot y recién ahí reenvía con el secreto compartido.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userOwnsChannel, getChannelSecrets } from "../_shared/db.ts";
import { appsApi, appsConfigurada, extraerCorreo, mensajeEntrega, fechaLarga } from "../_shared/microapps.ts";
import { deliverMessage, ventana24hAbierta } from "../_shared/engine.ts";
import { fetchConTimeout } from "../_shared/http.ts";

const db = serviceClient();

// El número del bot (para el botón «Renovar» del kit): Nodo no lo guarda, se lo pregunta a Meta.
async function numeroDelBot(channelId: string): Promise<string> {
  try {
    const { data: ch } = await db.from("channels").select("phone_number_id").eq("id", channelId).maybeSingle();
    const pnid = String((ch as any)?.phone_number_id ?? "");
    const tok = (await getChannelSecrets(db, channelId))?.access_token;
    if (!pnid || !tok) return "";
    const r = await fetchConTimeout(`https://graph.facebook.com/v25.0/${pnid}?fields=display_phone_number`, { headers: { Authorization: `Bearer ${tok}` } }, 6000);
    const j = await r.json().catch(() => ({}));
    return String(j?.display_phone_number ?? "").replace(/\D/g, "");
  } catch { return ""; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const { data: u } = await userClient(req.headers.get("Authorization") ?? "").auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const channelId = String(b?.channel_id ?? "");
  if (!channelId || !(await userOwnsChannel(db, uid, channelId))) return json({ error: "forbidden_channel" }, 403);
  if (!appsConfigurada()) return json({ ok: false, error: "apps_sin_configurar" });
  const pasa = async (accion: string, extra: Record<string, unknown> = {}) => json(await appsApi(accion, { ...b, channel_id: channelId, ...extra }, 15000));

  // Un producto de ESTE bot (las acciones por producto lo exigen).
  const productoDelBot = async (pid: string) => {
    const { data } = await db.from("products").select("id, nombre, tipo, channel_id").eq("id", pid).maybeSingle();
    return data && (data as any).channel_id === channelId ? data as any : null;
  };

  try {
    switch (b.action) {
      case "estado_app": {
        if (!(await productoDelBot(String(b.product_id)))) return json({ error: "producto_ajeno" }, 403);
        return pasa("estado_app");
      }
      case "conectar": {
        const p = await productoDelBot(String(b.product_id));
        if (!p) return json({ error: "producto_ajeno" }, 403);
        const url = String(b.url ?? "").trim();
        if (url && !/^https:\/\/[^\s]+$/i.test(url) && !/^http:\/\/localhost/i.test(url)) return json({ ok: false, error: "url_invalida" });
        const wa = await numeroDelBot(channelId);
        return json(await appsApi("registrar_app", { channel_id: channelId, product_id: p.id, nombre: p.nombre, url, max_celulares: b.max_celulares, wa_bot: wa }));
      }
      case "listar": {
        const r = await appsApi("listar", { channel_id: channelId }, 20000);
        // + los que PAGARON y todavía no tienen acceso (falta el correo, o falló): viven en Nodo.
        const { data: pend } = await db.from("microapp_entregas")
          .select("id, contact_id, product_id, tipo, meses, estado, error, created_at, recordatorios, contacts(nombre, wa_id), products(nombre)")
          .eq("channel_id", channelId).neq("estado", "entregado").order("created_at", { ascending: false }).limit(500);
        return json({ ...r, pendientes: pend ?? [] });
      }
      case "detalle": case "extender": case "bloquear": case "cambiar_correo": case "desconectar": case "alertas":
        return pasa(b.action);

      // Reenviar su link por WhatsApp (solo con la ventana de 24 h abierta: fuera de ella, plantilla).
      case "reenviar": {
        const d = await appsApi("detalle", { channel_id: channelId, id: b.id });
        if (!d?.ok) return json(d);
        const ct = String(d.acceso?.contact_id ?? "");
        if (!(await ventana24hAbierta(db, ct))) return json({ ok: false, error: "ventana_cerrada" });
        const ok = await deliverMessage(db, channelId, ct, `Aquí tienes tu acceso a *${d.acceso.app}* 🙌\n${d.link}\n\nÁbrelo desde tu celular y listo.`);
        return json({ ok });
      }

      // Dar un acceso a mano (el cliente pagó y no llegó a dar el correo, o la entrega falló).
      case "dar_acceso": {
        const pid = String(b.product_id ?? "");
        const p = await productoDelBot(pid);
        if (!p) return json({ error: "producto_ajeno" }, 403);
        const { data: ct } = await db.from("contacts").select("id, wa_id, nombre, channel_id").eq("id", String(b.contact_id ?? "")).maybeSingle();
        if (!ct || (ct as any).channel_id !== channelId) return json({ error: "contacto_ajeno" }, 403);
        const c = b.correo ? extraerCorreo(String(b.correo)) : null;
        if (b.correo && !c) return json({ ok: false, error: "correo_invalido" });
        const tipo = ["unico", "mensual", "prueba"].includes(b.tipo) ? b.tipo : "unico";
        const r = await appsApi("dar_acceso", { product_id: pid, tipo, meses: b.meses, horas: b.horas, correo: c?.correo ?? null,
          telefono: b.telefono ?? null, contacto: { id: (ct as any).id, wa_id: (ct as any).wa_id, nombre: (ct as any).nombre }, order_id: b.order_id ?? null });
        if (!r?.ok) return json(r);
        if (c?.correo) await db.from("contacts").update({ correo: c.correo }).eq("id", (ct as any).id);
        if (b.entrega_id) {
          await db.from("microapp_entregas").update({ estado: "entregado", correo: c?.correo ?? null, acceso_id: r.acceso?.id ?? null, link: r.link,
            entregado_at: new Date().toISOString(), proximo_aviso_at: null, error: null, updated_at: new Date().toISOString() })
            .eq("id", String(b.entrega_id)).eq("channel_id", channelId);
        }
        let enviado = false;
        if (b.avisar !== false && await ventana24hAbierta(db, (ct as any).id)) {
          enviado = await deliverMessage(db, channelId, (ct as any).id, mensajeEntrega({ app: p.nombre, link: r.link, correo: r.acceso?.correo,
            telefono: r.acceso?.correo ? null : r.acceso?.telefono, tipo, vence_at: r.acceso?.vence_at, renovado: r.renovado, horas: Number(b.horas) || 24 }));
        }
        await db.from("contact_events").insert({ channel_id: channelId, contact_id: (ct as any).id, tipo: "nota",
          titulo: "📱 Acceso dado desde el panel", detalle: `${p.nombre} · ${tipo}${r.acceso?.vence_at ? ` · vence ${fechaLarga(r.acceso.vence_at)}` : ""}${enviado ? " · link enviado" : ""}` }).then(() => {}, () => {});
        return json({ ...r, enviado });
      }
      default:
        return json({ error: "accion_desconocida" }, 400);
    }
  } catch (e) {
    console.error("[microapps]", b?.action, (e as any)?.message ?? e);
    return json({ ok: false, error: String((e as any)?.message ?? e) }, 500);
  }
});
