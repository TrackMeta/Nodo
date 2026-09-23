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
  // 12 caracteres (60 bits), no 8 (40): signup es pública y contesta distinto según el código
  // exista o no, así que el largo es la única defensa contra enumerarlos.
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => A[x % A.length]).join("");
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
        token: tok, kind: "new_account", usos_max: 1,   // link de cuenta = 1 solo uso
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
        // usos_max: 1 → un código = una persona. Sin esto quedaba NULL = usos ILIMITADOS
        // durante 14 días → cualquiera que viera el link (screenshot, chat) podía sumar su
        // cuenta al tenant (como admin si el código era admin) las veces que quisiera. Si el
        // admin necesita sumar a varios, genera un código por persona.
        token: code, kind: "join_account", account_id: accountId, role, created_by: uid, usos_max: 1,
      });
      if (error) return json({ error: "crear", detalle: error.message }, 400);
      return json({ ok: true, code, link: `${PANEL}/registro.html?join=${code}` });
    }

    // ── Listar las invitaciones que creé (vigentes primero) ───────────
    // …y las de EQUIPO de las cuentas donde soy admin, aunque las haya creado otro admin: antes
    // solo las veía (y revocaba) quien las creó, y si a ese admin lo quitaban, sus códigos
    // seguían vigentes sin que nadie más pudiera anularlos.
    if (action === "list") {
      const { data: mias } = await db.from("account_members").select("account_id")
        .eq("user_id", uid).eq("role", "admin").eq("activo", true);
      const cuentas = ((mias ?? []) as any[]).map((m) => m.account_id);
      let q = db.from("invitations")
        .select("id, token, kind, account_id, role, nombre_sugerido, expires_at, used_at, created_at, created_by");
      q = cuentas.length ? q.or(`created_by.eq.${uid},account_id.in.(${cuentas.join(",")})`) : q.eq("created_by", uid);
      const { data } = await q.order("created_at", { ascending: false }).limit(100);
      return json({ ok: true, invites: data ?? [] });
    }

    // ── Revocar (solo el que la creó) ─────────────────────────────────
    if (action === "revoke") {
      if (!body.id) return json({ error: "falta_id" }, 400);
      const { data: inv } = await db.from("invitations").select("id, created_by, account_id").eq("id", body.id).maybeSingle();
      if (!inv) return json({ ok: true });
      let puede = (inv as any).created_by === uid;
      if (!puede && (inv as any).account_id) {
        const { data: adm } = await db.from("account_members").select("role").eq("account_id", (inv as any).account_id)
          .eq("user_id", uid).eq("activo", true).maybeSingle();
        puede = (adm as any)?.role === "admin";
      }
      if (!puede) return json({ error: "forbidden", detalle: "Solo un admin de esa cuenta puede anular este código." }, 403);
      const { error } = await db.from("invitations").delete().eq("id", body.id);
      if (error) return json({ error: "revocar", detalle: error.message }, 400);
      return json({ ok: true });
    }

    // ── Limpiar a un miembro QUITADO del equipo ─────────────────────
    // Borrarlo de account_members no alcanzaba: sus códigos de invitación seguían vigentes (podía
    // volver a entrar con otro correo) y su Telegram seguía recibiendo avisos y APROBANDO pagos.
    if (action === "limpiar_miembro") {
      const accountId = body.account_id, quitado = body.user_id;
      if (!accountId || !quitado) return json({ error: "faltan_datos" }, 400);
      const { data: adm } = await db.from("account_members").select("role").eq("account_id", accountId)
        .eq("user_id", uid).eq("activo", true).maybeSingle();
      if ((adm as any)?.role !== "admin") return json({ error: "forbidden" }, 403);
      await db.from("invitations").delete().eq("account_id", accountId).eq("created_by", quitado).is("used_at", null);
      const { data: chs } = await db.from("channels").select("id, telegram_chat_ids, telegram_vinculos").eq("account_id", accountId);
      let cortados = 0;
      for (const c of (chs ?? []) as any[]) {
        const vinc = { ...(c.telegram_vinculos ?? {}) } as Record<string, any>;
        const suyos = Object.keys(vinc).filter((k) => vinc[k]?.uid === quitado);
        if (!suyos.length) continue;
        for (const k of suyos) delete vinc[k];
        const ids = ((c.telegram_chat_ids ?? []) as any[]).map(String).filter((x) => !suyos.includes(x));
        await db.from("channels").update({ telegram_chat_ids: ids, telegram_vinculos: vinc }).eq("id", c.id);
        cortados += suyos.length;
      }
      return json({ ok: true, telegram_cortados: cortados });
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
