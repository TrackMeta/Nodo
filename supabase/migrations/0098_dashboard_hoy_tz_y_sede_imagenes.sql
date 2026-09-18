-- 0098 · Dos hallazgos de la auditoría SQL del 2026-09-18.
--
-- 1) dashboard_stats: «mensajes de hoy» cortaba el día en UTC (date_trunc('day', now())).
--    En Lima (UTC-5) el contador se reiniciaba a las 7 p. m. Mismo arreglo que ya llevan
--    ai_usage_add (0088) y gasto_meta_por_origen (0096): el día según channels.timezone.
-- 2) sede_imagenes (fichas de las agencias Shalom, catálogo común): la política de escritura
--    era «cualquier usuario autenticado» — un operador de la cuenta A podía pisar o borrar la
--    ficha que el bot de la cuenta B le manda a sus clientes. Escribe solo un administrador de
--    la plataforma (platform_admins, migración 0052); leer sigue libre para los logueados.

create or replace function dashboard_stats(p_channel_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_hoy timestamptz;
begin
  if not owns_channel(p_channel_id) then raise exception 'no autorizado'; end if;
  select coalesce(nullif(timezone, ''), 'America/Lima') into v_tz from channels where id = p_channel_id;
  v_hoy := (date_trunc('day', now() at time zone v_tz)) at time zone v_tz;
  return jsonb_build_object(
    'contactos',       (select count(*) from contacts where channel_id = p_channel_id),
    'por_stage',       (select coalesce(jsonb_object_agg(stage, n),'{}'::jsonb)
                          from (select stage, count(*) n from contacts
                                where channel_id = p_channel_id group by stage) s),
    'mensajes_hoy_in', (select count(*) from messages
                          where channel_id = p_channel_id and direction='in' and ts >= v_hoy),
    'mensajes_hoy_out',(select count(*) from messages
                          where channel_id = p_channel_id and direction='out' and ts >= v_hoy),
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
drop policy if exists sede_imagenes_write on sede_imagenes;
--##--
create policy sede_imagenes_write on sede_imagenes
  for all to authenticated
  using (exists (select 1 from platform_admins pa where pa.user_id = auth.uid()))
  with check (exists (select 1 from platform_admins pa where pa.user_id = auth.uid()));
