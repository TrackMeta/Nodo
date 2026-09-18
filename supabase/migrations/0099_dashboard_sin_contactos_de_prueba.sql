-- 0099 · dashboard_stats contaba el contacto de prueba («webchat-test») y los simulados
-- (source = 'sim', tmp-sim) como leads reales en «contactos» y en el embudo por etapa.
-- El resto del panel ya los excluye; acá faltaba.

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
    'contactos',       (select count(*) from contacts
                          where channel_id = p_channel_id
                            and wa_id <> 'webchat-test' and coalesce(source, '') <> 'sim'),
    'por_stage',       (select coalesce(jsonb_object_agg(stage, n),'{}'::jsonb)
                          from (select stage, count(*) n from contacts
                                where channel_id = p_channel_id
                                  and wa_id <> 'webchat-test' and coalesce(source, '') <> 'sim'
                                group by stage) s),
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
