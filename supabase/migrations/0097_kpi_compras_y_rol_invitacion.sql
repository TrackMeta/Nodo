-- 0097 · Dos correcciones que salieron de la auditoría del 2026-09-17.
--
-- 1) dashboard_stats.purchases contaba cada UPSELL digital (evento aparte
--    «Purchase:<pedido>:x:<sufijo>», que va a Meta para sumar el extra al ROAS) como una
--    compra más: 10 pedidos con 3 extras aceptados salían como «13 compras». Las compras
--    son los pedidos (el Purchase principal); los ingresos sí suman los dos.
-- 2) apply_invitation reactivaba a un miembro dado de baja con su rol VIEJO: si fue admin,
--    lo desactivaron y lo vuelven a invitar como operador, quedaba admin. El rol que manda es
--    el de la invitación con la que vuelve a entrar.

create or replace function dashboard_stats(p_channel_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not owns_channel(p_channel_id) then raise exception 'no autorizado'; end if;
  return jsonb_build_object(
    'contactos',       (select count(*) from contacts where channel_id = p_channel_id),
    'por_stage',       (select coalesce(jsonb_object_agg(stage, n),'{}'::jsonb)
                          from (select stage, count(*) n from contacts
                                where channel_id = p_channel_id group by stage) s),
    'mensajes_hoy_in', (select count(*) from messages
                          where channel_id = p_channel_id and direction='in'
                            and ts >= date_trunc('day', now())),
    'mensajes_hoy_out',(select count(*) from messages
                          where channel_id = p_channel_id and direction='out'
                            and ts >= date_trunc('day', now())),
    'purchases',       (select count(*) from capi_events
                          where channel_id = p_channel_id and event_name='Purchase' and estado='enviado'
                            and event_id not like '%:x:%'),
    'ingresos',        (select coalesce(sum(value),0) from capi_events
                          where channel_id = p_channel_id and event_name='Purchase' and estado='enviado'),
    'leads',           (select count(*) from capi_events
                          where channel_id = p_channel_id and event_name='Lead' and estado='enviado'),
    'runs_activos',    (select count(*) from flow_runs
                          where channel_id = p_channel_id and estado in ('activo','esperando')),
    'subs_activas',    (select count(*) from sequence_subscriptions
                          where channel_id = p_channel_id and estado='activa'),
    'requiere_humano', (select count(*) from conversations
                          where channel_id = p_channel_id and requiere_humano)
  );
end $$;
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
