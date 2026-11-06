-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0143 — Días para pasar a «Perdido»: por PRODUCTO, y si no, los del bot.
--
-- 5-nov (Rodrigo: «debe haber nivel producto y nivel bot»). La 0142 los dejó por bot
-- (channels.remarketing->>'dias_perdido', que ahora se cambia en Secuencias → «Ajustes de todo el bot»).
-- Ahora cada producto puede tener su propio número (products.config->>'dias_perdido', en
-- Productos → el producto → Secuencias). Para cada cliente vale:
--   1) el del producto del cliente (contacts.product_id), si lo tiene;
--   2) si no, el del bot;
--   3) si tampoco, 3 días (como antes).
-- Acotado a 1–90. Los clientes sin producto (orgánicos) usan el del bot.
-- ═══════════════════════════════════════════════════════════════════

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
