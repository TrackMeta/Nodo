-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0043 — cierres menores multi-tenant
-- · channels.account_id NOT NULL (todos lo tienen; el trigger llena los nuevos).
-- · Invitaciones reusables: usos_max (null = ilimitado hasta vencer) + contador.
--   Los links de cuenta se quedan de 1 uso; los códigos de equipo pasan a ser
--   reusables (un código para todo el equipo).
-- ═══════════════════════════════════════════════════════════════════

alter table channels alter column account_id set not null;
--##--
alter table invitations add column if not exists usos_max int;
--##--
alter table invitations add column if not exists usos int not null default 0;
--##--
create or replace function apply_invitation(
  p_token text, p_user_id uuid, p_business_name text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare inv invitations%rowtype; acc uuid;
begin
  select * into inv from invitations where token = p_token for update;
  if inv.id is null      then raise exception 'invite_invalido'; end if;
  if inv.expires_at < now() then raise exception 'invite_vencido'; end if;
  if inv.usos_max is not null and inv.usos >= inv.usos_max then raise exception 'invite_usado'; end if;

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
      on conflict (account_id, user_id) do update set activo = true;
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
