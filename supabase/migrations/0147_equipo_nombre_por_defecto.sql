-- 0147 · Equipo nuevo sin nombre → «Mi equipo» (antes «Mi negocio»). 14-nov-2026: el contenedor se llama EQUIPO en la
-- interfaz y «negocio» queda solo para la sección de cada bot. Mismo apply_invitation de la 0145, solo cambia ese texto.

create or replace function public.apply_invitation(p_token text, p_user_id uuid, p_business_name text default null)
 returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare inv invitations%rowtype; acc uuid; correo text;
begin
  select * into inv from invitations where token = p_token for update;
  if inv.id is null      then raise exception 'invite_invalido'; end if;
  if inv.expires_at < now() then raise exception 'invite_vencido'; end if;
  if inv.usos_max is not null and inv.usos >= inv.usos_max then raise exception 'invite_usado'; end if;
  if inv.email is not null then
    select lower(trim(email)) into correo from auth.users where id = p_user_id;
    if correo is null or correo <> lower(trim(inv.email)) then raise exception 'invite_otro_correo'; end if;
  end if;

  if inv.kind = 'new_account' then
    insert into accounts (nombre, features)
      values (coalesce(nullif(trim(p_business_name), ''), inv.nombre_sugerido, 'Mi equipo'),
              case when inv.tipos is not null and cardinality(inv.tipos) between 1 and 2
                   then jsonb_build_object('tipos', to_jsonb(inv.tipos)) else '{}'::jsonb end)
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
end $function$;
