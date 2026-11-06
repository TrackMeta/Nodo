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

  let body: { action?: string; token?: string; email?: string; password?: string; nombre?: string; business_name?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  // ── (6-nov) Qué dice la invitación, para que la página del link salude con datos reales:
  // «Rodrigo te invitó a Prime Digital como Operador», con el correo ya puesto. No crea nada.
  // Mismo mensaje para «no existe», «usada» y «vencida» (igual que abajo: no es un oráculo), y el
  // código tiene 60 bits, así que no se pueden adivinar invitaciones ajenas probando.
  if (body.action === "info") {
    const tk = (body.token || "").trim();
    const { data: iv } = tk ? await db.from("invitations")
      .select("kind, role, email, nombre_sugerido, used_at, expires_at, account_id, created_by")
      .eq("token", tk).maybeSingle() : { data: null };
    const x = iv as any;
    if (!x || x.used_at || new Date(x.expires_at) < new Date()) {
      return json({ error: "invite_invalida", detalle: "La invitación no es válida, ya fue usada o venció. Pide una nueva a quien te invitó." }, 400);
    }
    const [{ data: acc }, { data: quien }] = await Promise.all([
      x.account_id ? db.from("accounts").select("nombre").eq("id", x.account_id).maybeSingle() : Promise.resolve({ data: null }),
      x.created_by ? db.from("app_users").select("nombre").eq("id", x.created_by).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    return json({
      ok: true, tipo: x.kind, rol: x.role, email: x.email || null,
      negocio: (acc as any)?.nombre || x.nombre_sugerido || null,
      invita: (quien as any)?.nombre || null,
    });
  }

  const token = (body.token || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const nombre = (body.nombre || "").trim();
  if (!token) return json({ error: "falta_token", detalle: "Falta la invitación." }, 400);
  if (!email || !email.includes("@")) return json({ error: "email_invalido", detalle: "Escribe un correo válido." }, 400);
  if (password.length < 8) return json({ error: "password_corta", detalle: "La contraseña debe tener al menos 8 caracteres." }, 400);

  // Pre-validar la invitación ANTES de crear el usuario (para no dejar huérfanos).
  const { data: inv } = await db.from("invitations")
    .select("id, kind, used_at, expires_at, email").eq("token", token).maybeSingle();
  // Un solo mensaje para los tres casos: distinguir «no existe» de «usada» / «vencida» era un
  // oráculo anónimo para enumerar códigos. (El detalle exacto queda en el log del servidor.)
  const NO_SIRVE = json({ error: "invite_invalida", detalle: "La invitación no es válida, ya fue usada o venció. Pide una nueva." }, 400);
  if (!inv) { console.warn("[signup] invitación inexistente"); return NO_SIRVE; }
  if ((inv as any).used_at) { console.warn("[signup] invitación ya usada", (inv as any).id); return NO_SIRVE; }
  if (new Date((inv as any).expires_at) < new Date()) { console.warn("[signup] invitación vencida", (inv as any).id); return NO_SIRVE; }
  // 0121: la invitación es para UN correo. Se mira ANTES de crear el usuario (apply_invitation
  // lo vuelve a exigir, pero ahí ya habría que deshacer la cuenta). No dice cuál es el correo
  // correcto: solo que éste no es.
  const paraCorreo = String((inv as any).email ?? "").trim().toLowerCase();
  if (paraCorreo && paraCorreo !== email) {
    return json({ error: "otro_correo", detalle: "Esta invitación es para otro correo. Regístrate con el correo al que te invitaron, o pide una invitación nueva." }, 400);
  }

  // Crear el usuario (admin API → no pasa por enable_signup, que sigue apagado).
  const { data: created, error: cErr } = await db.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { nombre },
  });
  if (cErr || !created?.user) {
    const msg = cErr?.message || "";
    if (/already|exists|registered/i.test(msg)) {
      // La página del link pasa sola a «entrar con tu contraseña y aceptar» al ver este error.
      return json({ error: "email_existe", detalle: "Ese correo ya tiene usuario en Nodo: entra con tu contraseña para aceptar la invitación." }, 400);
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
      : /invite_invalido/.test(m) ? "La invitación no existe."
      : /invite_otro_correo/.test(m) ? "Esta invitación es para otro correo." : m;
    return json({ error: "aplicar_invite", detalle }, 400);
  }

  return json({ ok: true, account_id: acc });
});
