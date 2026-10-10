-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0134 — el Embudo dice la verdad: «Perdido» automático + reclasificación de los de ChatLevel.
--
-- 10-oct (Rodrigo: «hazlo»). Dos problemas medidos en Prime Digital:
--  1) «Se perdieron» salía siempre 0 %: en digital nadie pasaba a «perdido» (solo un pedido cancelado lo hacía),
--     así que quien recibía los 4 toques de remarketing y nunca respondía se quedaba «curioso» para siempre.
--  2) 85 contactos (83 de Prime Digital) congelados en «nuevo»: escribieron mientras atendía ChatLevel (5–7 oct) y el
--     motor de Nodo nunca los procesó, así que nunca recibieron etapa. Inflaban el total y bajaban la conversión.
--
-- Regla de «perdido» (corre cada hora): etapa nuevo/curioso/interesado/caliente, bot activo en ese chat, sin
-- remarketing en curso (ninguna suscripción «activa»), sin pedido vivo, y 3 días o más sin escribir.
-- Si vuelve a escribir, el motor lo sube de nuevo (moverEtapa: «perdido» no tiene rango, así que cualquier etapa le gana).
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.marcar_perdidos() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  with p as (
    update contacts c set stage = 'perdido'
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

-- Reclasificación ÚNICA de los «nuevo» que el motor nunca procesó (tienen mensajes suyos): las mismas reglas del motor
-- (1 mensaje = curioso, 2–3 = interesado, 4+ = caliente). Lo de abajo los pasa a «perdido» si ya cumplen la regla.
with r as (
  select c.id, c.channel_id,
         (select count(*) from messages m where m.contact_id = c.id and m.direction = 'in') as nin
    from contacts c
   where c.stage = 'nuevo'
     and coalesce(c.source, '') <> 'sim'
     and coalesce(c.wa_id, '') <> 'webchat-test'
     and c.created_at < '2026-10-08'
), u as (
  update contacts c
     set stage = case when r.nin >= 4 then 'caliente' when r.nin >= 2 then 'interesado' else 'curioso' end
    from r
   where c.id = r.id and r.nin >= 1
  returning c.id, c.channel_id, c.stage
)
insert into contact_events (channel_id, contact_id, tipo, titulo, detalle)
select u.channel_id, u.id, 'nota', 'Etapa (auto): ' || u.stage,
       'Reclasificado (10-oct): escribió cuando atendía ChatLevel y Nodo nunca le había puesto etapa'
  from u;

select cron.unschedule('nodo-marcar-perdidos')
 where exists (select 1 from cron.job where jobname = 'nodo-marcar-perdidos');

select cron.schedule('nodo-marcar-perdidos', '17 * * * *', $cmd$ select public.marcar_perdidos(); $cmd$);

-- La primera pasada, ahora.
select public.marcar_perdidos();
