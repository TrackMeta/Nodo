-- 0145 · Cuentas por TIPO de producto (13-nov-2026, Rodrigo)
-- «Quiero crear cuentas que solo sirvan para cierto tipo de productos, y que desaparezca todo rastro de
-- que puedan vender otro tipo». Lo decide el dueño de la plataforma al crear la cuenta (link de cuenta),
-- y solo él puede cambiarlo después. Tipos: 'fisico', 'digital', 'microapp'.
--
-- · accounts.features.tipos = ["fisico", …]. Sin la clave (o vacía) = la cuenta vende de todo (lo de siempre).
-- · invitations.tipos: los tipos que tendrá la cuenta que crea ese link (kind = new_account).
-- · Trigger en products: no deja crear ni cambiar un producto a un tipo que su cuenta no vende
--   (la frontera real; el panel además esconde las opciones).
-- · set_account_tipos / set_invite_tipos: solo el admin de plataforma (app_users.platform_admin).

alter table invitations add column if not exists tipos text[];

-- Tipos permitidos de una cuenta (todos si no tiene restricción).
create or replace function tipos_de_cuenta(p_account uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(
    (select array_agg(x) from accounts a, jsonb_array_elements_text(
       case when jsonb_typeof(a.features->'tipos') = 'array' then a.features->'tipos' else '[]'::jsonb end) x
     where a.id = p_account),
    array['fisico','digital','microapp']);
$$;

create or replace function nodo_producto_tipo_permitido()
returns trigger language plpgsql security definer set search_path = public as $$
declare t text[];
begin
  select tipos_de_cuenta(c.account_id) into t from channels c where c.id = new.channel_id;
  if t is not null and not (coalesce(new.tipo, 'digital') = any(t)) then
    raise exception 'tipo_no_permitido: esta cuenta no vende productos de tipo %', coalesce(new.tipo, 'digital');
  end if;
  return new;
end $$;

drop trigger if exists trg_producto_tipo_permitido on products;
create trigger trg_producto_tipo_permitido
  before insert or update of tipo, channel_id on products
  for each row execute function nodo_producto_tipo_permitido();

-- Normaliza la lista: solo tipos válidos, sin repetir. Vacía o con los 3 = sin restricción.
create or replace function nodo_tipos_validos(p_tipos text[])
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct x order by x), array[]::text[])
  from unnest(coalesce(p_tipos, array[]::text[])) x where x in ('fisico','digital','microapp');
$$;

create or replace function set_account_tipos(p_account uuid, p_tipos text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare t text[] := nodo_tipos_validos(p_tipos);
begin
  if not exists (select 1 from app_users where id = auth.uid() and platform_admin) then
    raise exception 'solo_admin_plataforma';
  end if;
  if cardinality(t) = 0 or cardinality(t) = 3 then
    update accounts set features = features - 'tipos' where id = p_account;
  else
    update accounts set features = features || jsonb_build_object('tipos', to_jsonb(t)) where id = p_account;
  end if;
  return (select features from accounts where id = p_account);
end $$;

create or replace function set_invite_tipos(p_token text, p_tipos text[])
returns boolean language plpgsql security definer set search_path = public as $$
declare t text[] := nodo_tipos_validos(p_tipos);
begin
  if not exists (select 1 from app_users where id = auth.uid() and platform_admin) then
    raise exception 'solo_admin_plataforma';
  end if;
  update invitations set tipos = case when cardinality(t) in (0,3) then null else t end
   where token = p_token and kind = 'new_account' and used_at is null;
  return found;
end $$;

revoke all on function set_account_tipos(uuid, text[]) from public, anon;
revoke all on function set_invite_tipos(text, text[]) from public, anon;
grant execute on function set_account_tipos(uuid, text[]) to authenticated;
grant execute on function set_invite_tipos(text, text[]) to authenticated;
grant execute on function tipos_de_cuenta(uuid) to authenticated;

-- apply_invitation: la cuenta nueva nace con los tipos del link.
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
      values (coalesce(nullif(trim(p_business_name), ''), inv.nombre_sugerido, 'Mi negocio'),
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
