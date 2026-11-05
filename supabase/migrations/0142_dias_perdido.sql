-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0142 — Los días para pasar a «Perdido» se configuran por bot.
--
-- 5-nov (Rodrigo: «¿podría ser más tiempo, no solo 3 días, o que sea editable?»). Hasta acá eran 3 días fijos para
-- todos los bots (0134/0135): quien escribía un viernes y volvía el lunes ya figuraba como perdido. Ahora cada bot
-- lo elige en Productos → Remarketing («Pasar a Perdido después de N días sin respuesta»), guardado en
-- channels.remarketing->>'dias_perdido' (jsonb que ya existe: no hace falta columna nueva ni grant). Sin valor = 3,
-- como antes. Acotado a 1–90 días.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.marcar_perdidos() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  with cfg as (
    select ch.id,
           least(90, greatest(1, coalesce(case when (ch.remarketing->>'dias_perdido') ~ '^\d+$'
                                               then (ch.remarketing->>'dias_perdido')::int end, 3))) as dias
      from channels ch
  ), p as (
    update contacts c set stage = 'perdido', etapa_previa = c.stage
      from cfg
     where cfg.id = c.channel_id
       and c.stage in ('nuevo', 'curioso', 'interesado', 'caliente')
       and coalesce(c.source, '') <> 'sim'
       and coalesce(c.wa_id, '') <> 'webchat-test'
       and coalesce(c.bot_activo, true)
       and coalesce(c.ultimo_mensaje_cliente_at, c.created_at) < now() - make_interval(days => cfg.dias)
       and not exists (select 1 from sequence_subscriptions s where s.contact_id = c.id and s.estado = 'activa')
       and not exists (select 1 from orders o where o.contact_id = c.id
                         and o.estado not in ('cancelado', 'anulada', 'rechazado', 'no_recogido', 'devuelto'))
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
