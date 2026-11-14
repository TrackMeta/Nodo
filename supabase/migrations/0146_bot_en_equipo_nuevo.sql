-- 0146 · Crear un bot en un EQUIPO NUEVO (14-nov-2026, Rodrigo: «un equipo por bot»)
-- Antes «Crear nuevo bot» no preguntaba el equipo: el trigger set_channel_account lo metía en el equipo MÁS ANTIGUO del
-- usuario. Ahora el panel pregunta «¿En qué equipo va?»:
--   · un equipo donde eres admin → el panel inserta el canal con ese account_id (la RLS channels_admin ya lo permite);
--   · «Un equipo nuevo para este bot» → esta función crea el equipo (mismo plan y opciones que tu primer equipo de admin,
--     sin la restricción de tipos) y el bot dentro, en un solo paso.
-- Solo el admin de plataforma puede crear equipos así: a un cliente «Solo físicos» le serviría para saltarse el límite.

create or replace function crear_bot_en_equipo_nuevo(p_nombre text)
returns uuid language plpgsql security definer set search_path = public as $$
declare yo uuid := auth.uid(); nom text := nullif(trim(p_nombre), ''); base accounts%rowtype; acc uuid; ch uuid;
begin
  if yo is null or not exists (select 1 from app_users where id = yo and platform_admin) then
    raise exception 'solo_admin_plataforma';
  end if;
  if nom is null then raise exception 'falta_nombre'; end if;
  select a.* into base from accounts a join account_members m on m.account_id = a.id
   where m.user_id = yo and m.activo and m.role = 'admin' order by m.created_at limit 1;
  insert into accounts (nombre, plan, estado, features)
    values (nom, coalesce(base.plan, 'pro'), coalesce(base.estado, 'activa'), coalesce(base.features, '{}'::jsonb) - 'tipos')
    returning id into acc;
  insert into account_members (account_id, user_id, role, activo) values (acc, yo, 'admin', true);
  insert into channels (nombre, account_id, negocio_form, negocio)
    values (nom, acc, jsonb_build_object('nombre', nom), '# ' || nom)
    returning id into ch;
  return ch;
end $$;

revoke all on function crear_bot_en_equipo_nuevo(text) from public, anon;
grant execute on function crear_bot_en_equipo_nuevo(text) to authenticated;
