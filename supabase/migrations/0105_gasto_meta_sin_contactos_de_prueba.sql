-- 0105 · «Lo que te cobra Meta» contaba los mensajes de los contactos de PRUEBA.
--
-- gasto_meta_por_origen (0092, retocada en la 0096) cruza messages × contacts y cuenta como
-- cobrable todo lo que salió con `ventana` puesta. El motor sella `ventana` en CADA mensaje
-- que emite, también cuando el destinatario es un contacto de prueba: «Probar flujos»
-- (wa_id = 'webchat-test') o el simulador (source = 'sim'). Una tanda de simulación son
-- cientos de mensajes salientes → la pantalla de Rendimiento decía que Meta iba a cobrar por
-- conversaciones que nunca existieron, y con la tarifa cargada eso es plata inventada
-- restándose de la ganancia.
--
-- Es el mismo criterio que ya aplican dashboard_stats (0099/0101), el Embudo y el Dashboard.
-- Se arregla acá, del lado del servidor, para que valga también para lo YA registrado.
create or replace function public.gasto_meta_por_origen(
  p_channel_id uuid,
  p_desde      date,
  p_hasta      date
) returns table (
  origen           text,
  conversaciones   bigint,
  msgs_gratis      bigint,
  msgs_cobrables   bigint,
  costo_usd        numeric
)
language sql
stable
security invoker
set search_path = public
as $fn$
  with ch as (
    select id, tarifa_msg_usd, coalesce(nullif(trim(timezone), ''), 'America/Lima') as tz
    from channels where id = p_channel_id
  )
  select
    case when c.ad_id is not null or c.ctwa_clid is not null then 'anuncio' else 'organico' end as origen,
    count(distinct m.contact_id)                                              as conversaciones,
    count(*) filter (where m.ventana = 'fep')                                 as msgs_gratis,
    count(*) filter (where m.ventana in ('servicio', 'plantilla'))            as msgs_cobrables,
    case when ch.tarifa_msg_usd is null then null
         else round(count(*) filter (where m.ventana in ('servicio','plantilla'))
                    * ch.tarifa_msg_usd, 4) end                               as costo_usd
  from messages m
  join contacts c  on c.id  = m.contact_id
  join ch          on ch.id = m.channel_id
  where m.channel_id = p_channel_id
    and m.direction  = 'out'
    and m.ventana is not null
    and m.status is distinct from 'failed'
    -- 👇 lo nuevo: fuera los contactos de prueba
    and c.wa_id <> 'webchat-test'
    and coalesce(c.source, '') <> 'sim'
    and m.ts >= (p_desde::timestamp at time zone ch.tz)
    and m.ts <  ((p_hasta + 1)::timestamp at time zone ch.tz)
  group by 1, ch.tarifa_msg_usd
  order by 1;
$fn$;
grant execute on function public.gasto_meta_por_origen(uuid, date, date) to authenticated;
