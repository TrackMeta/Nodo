-- 0101 · dashboard_stats: «En remarketing» (subs_activas), «Requieren humano» y runs_activos
-- seguían contando a los contactos de prueba (webchat-test y source = 'sim'); la 0099 solo
-- limpió «contactos» y «por_stage». Una tanda del simulador dejaba secuencias activas y
-- conversaciones con requiere_humano que aparecían como reales en el Dashboard.

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
    'runs_activos',    (select count(*) from flow_runs r join contacts c on c.id = r.contact_id
                          where r.channel_id = p_channel_id and r.estado in ('activo','esperando')
                            and c.wa_id <> 'webchat-test' and coalesce(c.source, '') <> 'sim'),
    'subs_activas',    (select count(*) from sequence_subscriptions s join contacts c on c.id = s.contact_id
                          where s.channel_id = p_channel_id and s.estado='activa'
                            and c.wa_id <> 'webchat-test' and coalesce(c.source, '') <> 'sim'),
    'requiere_humano', (select count(*) from conversations v join contacts c on c.id = v.contact_id
                          where v.channel_id = p_channel_id and v.requiere_humano
                            and c.wa_id <> 'webchat-test' and coalesce(c.source, '') <> 'sim')
  );
end $$;
