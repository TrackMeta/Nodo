-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0121 — La invitación es para UN correo.
--
-- El registro crea la cuenta con email_confirm:true, sin comprobar que el correo sea de quien
-- lo escribe: con un código válido, cualquiera podía registrarse con el correo de otra
-- persona (aparecía en el equipo con su nombre, y el dueño real se encontraba con «ese
-- correo ya tiene una cuenta»). Decisión de Rodrigo (30-sep, opción B): quien invita escribe
-- el correo de la persona, y la invitación solo sirve con ESE correo — sin mandar correos ni
-- configurar un proveedor.
--
-- El chequeo vive en apply_invitation, que es por donde pasan los DOS caminos: el registro
-- (signup) y el canje estando ya logueado (invites → redeem). Las invitaciones viejas, sin
-- correo, siguen sirviendo como antes hasta que venzan (14 días) — no se rompe ninguna que
-- ya esté mandada.
--
-- Delimitador entre sentencias: la línea  --##--  (la Management API no acepta varias).
-- ═══════════════════════════════════════════════════════════════════

alter table invitations add column if not exists email text;
--##--
create or replace function apply_invitation(
  p_token text, p_user_id uuid, p_business_name text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare inv invitations%rowtype; acc uuid; correo text;
begin
  select * into inv from invitations where token = p_token for update;
  if inv.id is null      then raise exception 'invite_invalido'; end if;
  if inv.expires_at < now() then raise exception 'invite_vencido'; end if;
  if inv.usos_max is not null and inv.usos >= inv.usos_max then raise exception 'invite_usado'; end if;
  -- La invitación es para UN correo: el del usuario que la usa tiene que ser ése.
  if inv.email is not null then
    select lower(trim(email)) into correo from auth.users where id = p_user_id;
    if correo is null or correo <> lower(trim(inv.email)) then raise exception 'invite_otro_correo'; end if;
  end if;

  if inv.kind = 'new_account' then
    insert into accounts (nombre)
      values (coalesce(nullif(trim(p_business_name), ''), inv.nombre_sugerido, 'Mi negocio'))
      returning id into acc;
    insert into account_members (account_id, user_id, role, activo)
      values (acc, p_user_id, 'admin', true) on conflict (account_id, user_id) do nothing;
  elsif inv.kind = 'join_account' then
    acc := inv.account_id;
    if acc is null then raise exception 'invite_sin_cuenta'; end if;
    insert into account_members (account_id, user_id, role, activo)
      values (acc, p_user_id, inv.role, true)
      on conflict (account_id, user_id) do update set activo = true, role = excluded.role;
  else
    raise exception 'invite_kind_desconocido';
  end if;

  update invitations set
    usos = usos + 1,
    used_at = case when (usos_max is not null and usos + 1 >= usos_max) then now() else used_at end,
    used_by = coalesce(used_by, p_user_id)
  where id = inv.id;
  return acc;
end $$;
