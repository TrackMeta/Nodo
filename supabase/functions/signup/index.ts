// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: signup  (PÚBLICA — verify_jwt=false)
//   Registro POR INVITACIÓN (D2): crea el usuario auth (aunque el signup
//   público de Supabase esté apagado — la admin API lo permite) y aplica la
//   invitación (crea la cuenta + admin, o suma el miembro). Sin invitación
//   válida no crea nada: no hay registro abierto.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/db.ts";

const db = serviceClient();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { token?: string; email?: string; password?: string; nombre?: string; business_name?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const token = (body.token || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const nombre = (body.nombre || "").trim();
  if (!token) return json({ error: "falta_token", detalle: "Falta la invitación." }, 400);
  if (!email || !email.includes("@")) return json({ error: "email_invalido", detalle: "Escribe un correo válido." }, 400);
  if (password.length < 8) return json({ error: "password_corta", detalle: "La contraseña debe tener al menos 8 caracteres." }, 400);

  // Pre-validar la invitación ANTES de crear el usuario (para no dejar huérfanos).
  const { data: inv } = await db.from("invitations")
    .select("id, kind, used_at, expires_at").eq("token", token).maybeSingle();
  if (!inv) return json({ error: "invite_invalido", detalle: "La invitación no existe." }, 400);
  if ((inv as any).used_at) return json({ error: "invite_usado", detalle: "Esta invitación ya fue usada." }, 400);
  if (new Date((inv as any).expires_at) < new Date()) return json({ error: "invite_vencido", detalle: "La invitación venció." }, 400);

  // Crear el usuario (admin API → no pasa por enable_signup, que sigue apagado).
  const { data: created, error: cErr } = await db.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { nombre },
  });
  if (cErr || !created?.user) {
    const msg = cErr?.message || "";
    if (/already|exists|registered/i.test(msg)) {
      return json({ error: "email_existe", detalle: "Ese correo ya tiene una cuenta. Inicia sesión y canjea el código desde el panel." }, 400);
    }
    return json({ error: "crear_usuario", detalle: msg || "No se pudo crear el usuario." }, 400);
  }
  const userId = created.user.id;

  // Perfil (app_users) — no hay trigger que lo cree.
  await db.from("app_users").upsert(
    { id: userId, nombre: nombre || email.split("@")[0], activo: true },
    { onConflict: "id" },
  );

  // Aplicar la invitación (crea cuenta+admin o suma miembro, atómico).
  const { data: acc, error: aErr } = await db.rpc("apply_invitation", {
    p_token: token, p_user_id: userId, p_business_name: body.business_name || null,
  });
  if (aErr) {
    // Rollback: borrar el usuario recién creado para no dejar un huérfano sin cuenta.
    await db.auth.admin.deleteUser(userId).catch(() => {});
    const m = aErr.message || "";
    const detalle = /invite_usado/.test(m) ? "Esta invitación ya fue usada."
      : /invite_vencido/.test(m) ? "La invitación venció."
      : /invite_invalido/.test(m) ? "La invitación no existe." : m;
    return json({ error: "aplicar_invite", detalle }, 400);
  }

  return json({ ok: true, account_id: acc });
});
