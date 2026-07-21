// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: ai-config  (AUTENTICADA — verify_jwt=true)
//   Gestiona las API keys de IA por canal desde Configuraciones.
//   La key viaja del navegador a Vault vía esta función; nunca se guarda
//   en una tabla legible por el cliente ni se devuelve.
//   Acciones: save | test | delete | default
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient, userOwnsChannel } from "../_shared/db.ts";
import { runAI, type Provider } from "../_shared/ai.ts";

const db = serviceClient();
const PROVIDERS = new Set(["anthropic", "openai"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // ── Solo miembros activos (admin gestiona claves) ─────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: userRes } = await userClient(authHeader).auth.getUser();
  const uid = userRes?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);
  const { data: member } = await db
    .from("app_users").select("id, role").eq("id", uid).eq("activo", true).maybeSingle();
  if (!member) return json({ error: "not_member" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const { action, channel_id, provider, api_key, model, make_default } = body ?? {};
  if (!channel_id) return json({ error: "falta_channel" }, 400);
  if (provider && !PROVIDERS.has(provider)) return json({ error: "proveedor_invalido" }, 400);

  // Verificar que el canal existe.
  const { data: channel } = await db.from("channels").select("id").eq("id", channel_id).maybeSingle();
  if (!channel) return json({ error: "canal_invalido" }, 400);
  // Multi-tenant: el que llama debe ser miembro de la cuenta dueña del canal.
  if (!(await userOwnsChannel(db, uid, channel_id))) return json({ error: "forbidden_channel" }, 403);

  try {
    switch (action) {
      case "save": {
        if (!provider) return json({ error: "falta_proveedor" }, 400);
        const { error } = await db.rpc("set_channel_ai", {
          p_channel_id: channel_id, p_provider: provider,
          p_key: api_key ?? null, p_model: model ?? null,
        });
        if (error) return json({ error: "guardar", detalle: error.message }, 400);
        if (make_default) {
          await db.from("channels").update({ ia_provider: provider }).eq("id", channel_id);
        }
        return json({ ok: true });
      }

      case "default": {
        // provider null → deshabilitar IA del canal.
        await db.from("channels").update({ ia_provider: provider ?? null }).eq("id", channel_id);
        return json({ ok: true });
      }

      case "delete": {
        if (!provider) return json({ error: "falta_proveedor" }, 400);
        const { error } = await db.rpc("delete_channel_ai", {
          p_channel_id: channel_id, p_provider: provider,
        });
        if (error) return json({ error: "eliminar", detalle: error.message }, 400);
        return json({ ok: true });
      }

      case "test": {
        // Prueba la key con una llamada mínima.
        const { data: rows } = await db.rpc("get_channel_ai_active", {
          p_channel_id: channel_id, p_provider: provider ?? null,
        });
        const ai = Array.isArray(rows) ? rows[0] : rows;
        if (!ai?.api_key) return json({ ok: false, error: "sin_config" }, 200);
        try {
          const out = await runAI({
            provider: ai.provider as Provider, apiKey: ai.api_key, model: ai.model || undefined,
            content: "Responde solo con: OK", maxTokens: 8,
          });
          return json({ ok: true, provider: ai.provider, respuesta: out });
        } catch (e) {
          return json({ ok: false, error: "fallo_ia", detalle: String((e as any)?.message ?? e) }, 200);
        }
      }

      default:
        return json({ error: "accion_invalida" }, 400);
    }
  } catch (e) {
    console.error("[ai-config] error:", e);
    return json({ error: "interno", detalle: String((e as any)?.message ?? e) }, 500);
  }
});
