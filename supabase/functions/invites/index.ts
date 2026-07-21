// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: invites  (AUTENTICADA — verify_jwt=true)
//   Gestiona invitaciones (Fase 4, onboarding):
//   · create_account_invite → link para crear una CUENTA nueva (solo admin
//     de plataforma). D5.
//   · create_team_invite    → código para sumar un MIEMBRO a una cuenta
//     (solo admin de esa cuenta). D6.
//   · list / revoke         → gestión de las invitaciones que creé.
//   · redeem                → un usuario YA logueado canjea un código (se une
//     a otra cuenta o crea una nueva). Sirve para el caso agencia (D1).
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/db.ts";

const db = serviceClient();
const PANEL = "https://trackmeta.github.io/Nodo/panel";

// Token largo para el link de cuenta (va en la URL).
function linkToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}
// Código corto y tipeable para el equipo (sin O/0/I/1 para no confundir).
function teamCode(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => A[x % A.length]).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const { data: u } = await userClient(auth).auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);
  const { data: me } = await db
    .from("app_users").select("id, platform_admin").eq("id", uid).eq("activo", true).maybeSingle();
  if (!me) return json({ error: "not_member" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const action = body?.action;

  try {
    // ── Crear link de CUENTA nueva (solo admin de plataforma) ─────────
    if (action === "create_account_invite") {
      if (!(me as any).platform_admin) return json({ error: "forbidden", detalle: "Solo el admin de plataforma crea cuentas." }, 403);
      const tok = linkToken();
      const { error } = await db.from("invitations").insert({
        token: tok, kind: "new_account",
        nombre_sugerido: (body.nombre_sugerido || "").toString().trim() || null,
        created_by: uid,
      });
      if (error) return json({ error: "crear", detalle: error.message }, 400);
      return json({ ok: true, token: tok, link: `${PANEL}/registro.html?invite=${tok}` });
    }

    // ── Crear código de EQUIPO (solo admin de esa cuenta) ─────────────
    if (action === "create_team_invite") {
      const accountId = body.account_id;
      if (!accountId) return json({ error: "falta_cuenta" }, 400);
      const { data: mem } = await db.from("account_members")
        .select("role").eq("account_id", accountId).eq("user_id", uid).eq("activo", true).maybeSingle();
      if (!mem || (mem as any).role !== "admin") return json({ error: "forbidden", detalle: "Debes ser admin de esta cuenta." }, 403);
      const code = teamCode();
      const role = body.role === "admin" ? "admin" : "operador";
      const { error } = await db.from("invitations").insert({
        token: code, kind: "join_account", account_id: accountId, role, created_by: uid,
      });
      if (error) return json({ error: "crear", detalle: error.message }, 400);
      return json({ ok: true, code, link: `${PANEL}/registro.html?join=${code}` });
    }

    // ── Listar las invitaciones que creé (vigentes primero) ───────────
    if (action === "list") {
      const { data } = await db.from("invitations")
        .select("id, token, kind, account_id, role, nombre_sugerido, expires_at, used_at, created_at")
        .eq("created_by", uid).order("created_at", { ascending: false }).limit(100);
      return json({ ok: true, invites: data ?? [] });
    }

    // ── Revocar (solo el que la creó) ─────────────────────────────────
    if (action === "revoke") {
      if (!body.id) return json({ error: "falta_id" }, 400);
      const { error } = await db.from("invitations").delete().eq("id", body.id).eq("created_by", uid);
      if (error) return json({ error: "revocar", detalle: error.message }, 400);
      return json({ ok: true });
    }

    // ── Canjear siendo un usuario YA logueado (caso agencia, D1) ──────
    if (action === "redeem") {
      const tok = (body.token || "").toString().trim();
      if (!tok) return json({ error: "falta_token" }, 400);
      const { data: acc, error } = await db.rpc("apply_invitation", {
        p_token: tok, p_user_id: uid, p_business_name: body.business_name || null,
      });
      if (error) return json({ error: "canjear", detalle: msgInvite(error.message) }, 400);
      return json({ ok: true, account_id: acc });
    }

    return json({ error: "accion_invalida" }, 400);
  } catch (e) {
    console.error("[invites] error:", e);
    return json({ error: "interno", detalle: String((e as any)?.message ?? e) }, 500);
  }
});

// Traduce los raise del RPC a algo legible.
function msgInvite(m: string): string {
  if (/invite_usado/.test(m)) return "Esta invitación ya fue usada.";
  if (/invite_vencido/.test(m)) return "La invitación venció.";
  if (/invite_invalido/.test(m)) return "El código no existe.";
  return m;
}
