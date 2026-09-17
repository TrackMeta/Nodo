-- 0096 · Cuatro correcciones que salieron de la auditoría del 2026-09-17 (números y seguridad).
--
-- 1) ai_usage_add (8 args): la 0091 la recreó con (now() at time zone 'utc') y perdió la
--    zona del negocio que había puesto la 0088 → el gasto de IA de las 7 p. m. en adelante
--    caía en el día siguiente (Dashboard, Bitácora y resumen de Telegram).
-- 2) gasto_meta_por_origen: cortaba los días en UTC (5 h corridas en Lima), contaba los
--    mensajes `failed` como cobrables y clasificaba como «anuncio» a quien llegó por un post
--    orgánico (source no nulo sin ad_id/ctwa_clid).
-- 3) Realtime: con `replica identity full`, un DELETE difunde la fila ENTERA (texto del
--    mensaje, teléfono, memoria IA) y los eventos DELETE NO pasan por RLS → cualquier usuario
--    autenticado podía suscribirse sin filtro y recibir lo que otra cuenta borra. `default`
--    deja solo la PK en old_record; el panel solo usa INSERT/UPDATE.
-- 4) Borrar contactos pasa a ser de administrador (como orders/messages): un operador podía
--    llevarse en cascada el historial de un cliente pese a la RLS de esas tablas.
-- (verify_token NO se revoca: canales.html lo selecciona directo y la consulta entera
--  fallaría; queda como hallazgo menor hasta moverlo a channel-config.)

-- 1) ───────────────────────────────────────────────────────────────────────────────────────
create or replace function public.ai_usage_add(
  p_channel_id uuid,
  p_provider   text,
  p_model      text,
  p_origen     text,
  p_in         bigint,
  p_out        bigint,
  p_costo      numeric,
  p_cache      bigint
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tz  text;
  v_dia date;
begin
  select nullif(trim(timezone), '') into v_tz from channels where id = p_channel_id;
  begin
    v_dia := (now() at time zone coalesce(v_tz, 'America/Lima'))::date;
  exception when others then
    v_dia := (now() at time zone 'America/Lima')::date;
  end;
  insert into ai_usage as u (channel_id, dia, provider, model, origen, llamadas, tokens_in, tokens_out, tokens_cache, costo_usd, updated_at)
  values (
    p_channel_id, v_dia,
    coalesce(nullif(p_provider, ''), 'desconocido'),
    coalesce(nullif(p_model, ''), 'desconocido'),
    coalesce(nullif(p_origen, ''), 'otro'),
    1, greatest(coalesce(p_in, 0), 0), greatest(coalesce(p_out, 0), 0),
    greatest(coalesce(p_cache, 0), 0), greatest(coalesce(p_costo, 0), 0), now()
  )
  on conflict (channel_id, dia, provider, model, origen) do update set
    llamadas     = u.llamadas     + 1,
    tokens_in    = u.tokens_in    + excluded.tokens_in,
    tokens_out   = u.tokens_out   + excluded.tokens_out,
    tokens_cache = u.tokens_cache + excluded.tokens_cache,
    costo_usd    = u.costo_usd    + excluded.costo_usd,
    updated_at   = now();
end;
$fn$;
revoke all on function public.ai_usage_add(uuid, text, text, text, bigint, bigint, numeric, bigint) from public, anon, authenticated;
grant execute on function public.ai_usage_add(uuid, text, text, text, bigint, bigint, numeric, bigint) to service_role;

-- 2) ───────────────────────────────────────────────────────────────────────────────────────
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
    and m.ts >= (p_desde::timestamp at time zone ch.tz)
    and m.ts <  ((p_hasta + 1)::timestamp at time zone ch.tz)
  group by 1, ch.tarifa_msg_usd
  order by 1;
$fn$;
grant execute on function public.gasto_meta_por_origen(uuid, date, date) to authenticated;

-- 3) ───────────────────────────────────────────────────────────────────────────────────────
alter table public.messages      replica identity default;
alter table public.contacts      replica identity default;
alter table public.conversations replica identity default;

-- 4) ───────────────────────────────────────────────────────────────────────────────────────
drop policy if exists contacts_tenant on public.contacts;
create policy contacts_sel on public.contacts for select using (owns_channel(channel_id));
create policy contacts_ins on public.contacts for insert with check (owns_channel(channel_id));
create policy contacts_upd on public.contacts for update using (owns_channel(channel_id)) with check (owns_channel(channel_id));
create policy contacts_del on public.contacts for delete using (admin_channel(channel_id));
