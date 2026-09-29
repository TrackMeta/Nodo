-- ══════════════════════════════════════════════════════
-- Nodo · 0114 — La campanita se resuelve SOLA (2026-09-28)
--
-- Un aviso «por atender» deja de estarlo cuando lo que pedía ya se hizo, SE HAGA DONDE SE HAGA:
-- Pagos por validar, Pedidos, la ficha del chat, el botón de Telegram o el propio bot. Por eso va
-- en triggers de la base y no en cada pantalla: son 5+ caminos que tocan el pedido y bastaba con
-- olvidar uno para que quedara un «pendiente» que ya estaba hecho — el ruido que mata una campanita.
--
-- La regla de «pago por validar» es la MISMA que usan Pedidos (hayPagoPorValidar) y la ficha
-- (copilotoEtapa): si se cambia allá, cambiarla acá.
-- ══════════════════════════════════════════════════════

create or replace function public.notif_pago_pendiente(p_tipo text, p_estado text, s jsonb)
returns boolean language plpgsql immutable as $$
declare t text; rej timestamptz; rec timestamptz; sj jsonb;
begin
  sj := coalesce(s, '{}'::jsonb);
  if p_tipo = 'pago_digital_validar' then
    return p_estado = 'pendiente' and coalesce((sj->>'digital_pendiente')::boolean, false);
  elsif p_tipo = 'pago_extra_validar' then
    return coalesce((sj->>'extra_pendiente')::boolean, false);
  elsif p_tipo = 'prepago_lima_validar' then
    return coalesce((sj->>'pago_adelantado_por_validar')::boolean, false);
  elsif p_tipo in ('adelanto_validar', 'saldo_validar') then
    t := case when p_tipo = 'saldo_validar' then 'saldo' else 'adelanto' end;
    if p_estado <> (case when t = 'saldo' then 'en_agencia' else 'esperando_adelanto' end) then return false; end if;
    rej := nullif(sj->>(t || '_rechazado_at'), '')::timestamptz;
    rec := nullif(sj->>(t || '_recibido_at'), '')::timestamptz;
    if rej is not null and (rec is null or rej >= rec) then return false; end if;
    return (sj -> (t || '_comprobante')) is not null or rec is not null;
  end if;
  return true;
end $$;
--##--
create or replace function public.notif_resolver_por_pedido()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_por text;
begin
  if new.estado is not distinct from old.estado and new.shipping is not distinct from old.shipping then return new; end if;
  -- Pedido caído: todo lo pendiente de ese pedido se cierra.
  if new.estado in ('cancelado', 'anulada', 'rechazado', 'devuelto') then
    update notificaciones set resuelta_at = now(), resuelta_por = 'Pedido ' || new.estado, updated_at = now()
     where order_id = new.id and resuelta_at is null and por_atender;
    return new;
  end if;
  v_por := case when new.estado is distinct from old.estado then 'Validado' else 'Atendido' end;
  update notificaciones n
     set resuelta_at = now(),
         resuelta_por = case
           when n.tipo in ('adelanto_validar','saldo_validar')
                and nullif(new.shipping->>(case when n.tipo='saldo_validar' then 'saldo' else 'adelanto' end || '_rechazado_at'),'') is not null
                and new.estado = old.estado then 'Rechazado'
           else v_por end,
         updated_at = now()
   where n.order_id = new.id and n.resuelta_at is null and n.por_atender
     and n.tipo in ('adelanto_validar','saldo_validar','pago_digital_validar','pago_extra_validar','prepago_lima_validar')
     and not notif_pago_pendiente(n.tipo, new.estado, new.shipping);
  return new;
end $$;
--##--
drop trigger if exists trg_notif_resolver_pedido on public.orders;
--##--
create trigger trg_notif_resolver_pedido after update on public.orders
  for each row execute function public.notif_resolver_por_pedido();
--##--
-- «Te necesita a ti»: se resuelve cuando alguien reactiva el bot en ese chat (lo atendió y lo devolvió).
create or replace function public.notif_resolver_por_contacto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.bot_activo, true) and not coalesce(old.bot_activo, true) then
    update notificaciones set resuelta_at = now(), resuelta_por = 'Bot reactivado', updated_at = now()
     where contact_id = new.id and resuelta_at is null and por_atender and tipo in ('pide_humano');
  end if;
  return new;
end $$;
--##--
drop trigger if exists trg_notif_resolver_contacto on public.contacts;
--##--
create trigger trg_notif_resolver_contacto after update of bot_activo on public.contacts
  for each row execute function public.notif_resolver_por_contacto();
