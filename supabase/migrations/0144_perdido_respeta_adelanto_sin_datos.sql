-- ═════════════════════════════════════════════════════════════════
-- Nodo · 0144 — «Perdido» no marca a quien ya pagó el adelanto sin dar sus datos.
--
-- 6-nov (Rodrigo: «arréglalo»). Si un cliente de provincia manda el comprobante del adelanto ANTES
-- de dar sus datos, todavía no hay pedido: el motor guarda el pago en el contacto
-- (_prepago_adel_url / _monto / _oper / _ok) y lo engancha al pedido cuando los da. marcar_perdidos()
-- solo respetaba a quien tenía un PEDIDO vivo, así que ese cliente —con su plata adentro— pasaba a
-- «Perdido» a los N días como cualquier curioso. Ahora también se salta si tiene ese pago guardado.
-- El resto es igual a la 0143 (días por producto › bot › 3).
-- ═════════════════════════════════════════════════════════════════

create or replace function public.marcar_perdidos() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  with cfg as (
    select c.id as cid,
           least(90, greatest(1, coalesce(
             case when (pr.config->>'dias_perdido') ~ '^\d+$' and (pr.config->>'dias_perdido')::int > 0
                  then (pr.config->>'dias_perdido')::int end,
             case when (ch.remarketing->>'dias_perdido') ~ '^\d+$' and (ch.remarketing->>'dias_perdido')::int > 0
                  then (ch.remarketing->>'dias_perdido')::int end,
             3))) as dias
      from contacts c
      join channels ch on ch.id = c.channel_id
      left join products pr on pr.id = c.product_id
     where c.stage in ('nuevo', 'curioso', 'interesado', 'caliente')
  ), p as (
    update contacts c set stage = 'perdido', etapa_previa = c.stage
      from cfg
     where cfg.cid = c.id
       and c.stage in ('nuevo', 'curioso', 'interesado', 'caliente')
       and coalesce(c.source, '') <> 'sim'
       and coalesce(c.wa_id, '') <> 'webchat-test'
       and coalesce(c.bot_activo, true)
       and coalesce(c.ultimo_mensaje_cliente_at, c.created_at) < now() - make_interval(days => cfg.dias)
       and not exists (select 1 from sequence_subscriptions s where s.contact_id = c.id and s.estado = 'activa')
       and not exists (select 1 from orders o where o.contact_id = c.id
                         and o.estado not in ('cancelado', 'anulada', 'rechazado', 'no_recogido', 'devuelto'))
       -- (0144) Pagó el adelanto y todavía no dio sus datos: tiene plata adentro, no está perdido.
       and not exists (select 1 from contact_field_values v join custom_fields f on f.id = v.field_id
                        where v.contact_id = c.id and f.key = '_prepago_adel_url' and coalesce(v.value, '') <> '')
    returning c.id, c.channel_id, cfg.dias
  ), ev as (
    insert into contact_events (channel_id, contact_id, tipo, titulo, detalle)
    select p.channel_id, p.id, 'nota', 'Etapa (auto): perdido',
           'Terminó el remarketing y pasaron ' || p.dias || case when p.dias = 1 then ' día' else ' días' end || ' sin respuesta ni compra'
      from p
    returning 1
  )
  select count(*) into v_n from p;
  return v_n;
end $$;

revoke all on function public.marcar_perdidos() from anon, authenticated, public;
