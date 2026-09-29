-- ══════════════════════════════════════════════════════
-- Nodo · 0115 — «Resuelto por» dice lo que de verdad pasó (2026-09-28)
--
-- 0114 ponía «Validado» solo si el pedido CAMBIABA de estado. El prepago de Lima y los extras
-- se aprueban sin cambiar el estado (el pedido sigue confirmado), así que salían «Atendido»
-- (medido en la batería 2 de la campanita). Ahora se mira la marca que deja cada aprobación y
-- cada rechazo; si hubo las dos, gana la más reciente.
-- ══════════════════════════════════════════════════════

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
           -- Adelanto / saldo rechazado (el estado no cambia).
           when n.tipo in ('adelanto_validar','saldo_validar')
                and nullif(new.shipping->>(case when n.tipo='saldo_validar' then 'saldo' else 'adelanto' end || '_rechazado_at'),'') is not null
                and new.estado = old.estado then 'Rechazado'
           -- Prepago de Lima: aprobado o rechazado según la marca más reciente.
           when n.tipo = 'prepago_lima_validar' then notif_marca(new.shipping, 'pago_adelantado_aprobado_at', 'pago_adelantado_rechazado_at', v_por)
           -- Extra: ídem.
           when n.tipo = 'pago_extra_validar' then notif_marca(new.shipping, 'extra_aprobado_at', 'extra_rechazado_at', v_por)
           -- Pago digital rechazado (el pedido sigue pendiente).
           when n.tipo = 'pago_digital_validar' and new.estado = old.estado
                and nullif(new.shipping->>'digital_rechazado_at','') is not null then 'Rechazado'
           else v_por end,
         updated_at = now()
   where n.order_id = new.id and n.resuelta_at is null and n.por_atender
     and n.tipo in ('adelanto_validar','saldo_validar','pago_digital_validar','pago_extra_validar','prepago_lima_validar')
     and not notif_pago_pendiente(n.tipo, new.estado, new.shipping);
  return new;
end $$;
--##--
-- «Validado» o «Rechazado» según cuál de las dos marcas es la más nueva; sin ninguna, el valor por defecto.
create or replace function public.notif_marca(sj jsonb, k_ok text, k_no text, v_def text)
returns text language plpgsql immutable as $$
declare ok timestamptz; no_ timestamptz;
begin
  ok := nullif(coalesce(sj, '{}'::jsonb)->>k_ok, '')::timestamptz;
  no_ := nullif(coalesce(sj, '{}'::jsonb)->>k_no, '')::timestamptz;
  if ok is not null and (no_ is null or ok >= no_) then return 'Validado'; end if;
  if no_ is not null then return 'Rechazado'; end if;
  return v_def;
end $$;
