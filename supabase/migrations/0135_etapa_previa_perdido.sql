-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0135 — «Perdido» recuerda hasta qué etapa llegó (etapa_previa).
--
-- 10-oct. Desde la 0134 el lead que se enfría pasa a «perdido». Pero el Embudo y la Efectividad de cierre
-- trataban todo «perdido» como «venta que se cayó» (antes solo llegaba ahí un pedido cancelado/rechazado), y
-- además lo sacaban de los escalones: en Prime Digital, 7 días = «se van 99 (194 %)» en el último paso y una
-- efectividad de 27 % en vez de 58 %. Con etapa_previa el panel cuenta a cada perdido en el escalón que alcanzó
-- (un interesado que se enfrió sigue siendo alguien que se interesó y no se cerró: igual que antes de la 0134).
-- ═══════════════════════════════════════════════════════════════════

alter table public.contacts add column if not exists etapa_previa text;

-- La regla horaria ahora guarda la etapa de la que sale (en el SET, c.stage es el valor de ANTES).
create or replace function public.marcar_perdidos() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  with p as (
    update contacts c set stage = 'perdido', etapa_previa = c.stage
     where c.stage in ('nuevo', 'curioso', 'interesado', 'caliente')
       and coalesce(c.source, '') <> 'sim'
       and coalesce(c.wa_id, '') <> 'webchat-test'
       and coalesce(c.bot_activo, true)
       and coalesce(c.ultimo_mensaje_cliente_at, c.created_at) < now() - interval '3 days'
       and not exists (select 1 from sequence_subscriptions s where s.contact_id = c.id and s.estado = 'activa')
       and not exists (select 1 from orders o where o.contact_id = c.id
                         and o.estado not in ('cancelado', 'anulada', 'rechazado', 'no_recogido', 'devuelto'))
    returning c.id, c.channel_id
  ), ev as (
    insert into contact_events (channel_id, contact_id, tipo, titulo, detalle)
    select p.channel_id, p.id, 'nota', 'Etapa (auto): perdido',
           'Terminó el remarketing y pasaron 3 días sin respuesta ni compra'
      from p
    returning 1
  )
  select count(*) into v_n from p;
  return v_n;
end $$;

revoke all on function public.marcar_perdidos() from anon, authenticated, public;

-- Relleno de los que ya son «perdido» sin etapa_previa: la etapa MÁS alta que el motor les anotó en sus eventos
-- («Etapa (auto): curioso|interesado|caliente|confirmado»); si no hay evento, por mensajes suyos (la misma regla
-- del motor: 1 = curioso, 2–3 = interesado, 4+ = caliente).
with ev as (
  select e.contact_id,
         max(case e.titulo when 'Etapa (auto): confirmado' then 4 when 'Etapa (auto): caliente' then 3
                           when 'Etapa (auto): interesado' then 2 when 'Etapa (auto): curioso' then 1 end) as r
    from contact_events e
   where e.titulo in ('Etapa (auto): curioso', 'Etapa (auto): interesado', 'Etapa (auto): caliente', 'Etapa (auto): confirmado')
   group by e.contact_id
), x as (
  select c.id,
         coalesce(ev.r, (select case when count(*) >= 4 then 3 when count(*) >= 2 then 2 when count(*) >= 1 then 1 else 0 end
                           from messages m where m.contact_id = c.id and m.direction = 'in')) as r
    from contacts c left join ev on ev.contact_id = c.id
   where c.stage = 'perdido' and c.etapa_previa is null
)
update contacts c
   set etapa_previa = case x.r when 4 then 'confirmado' when 3 then 'caliente' when 2 then 'interesado' when 1 then 'curioso' else 'nuevo' end
  from x
 where c.id = x.id;
