-- ═══════════════════════════════════════════════════════════════════
-- 0117 · Lo que una fila APUNTA tiene que ser del mismo canal que la fila
--
-- Auditoría de seguridad 2026-09-30. La RLS de flow_triggers, orders, messages y contacts
-- solo comprueba owns_channel(channel_id): la fila es de tu bot. Pero no mira a qué apuntan
-- sus OTRAS columnas, y el motor (service-role) se fía de ellas. Con el UUID de un objeto de
-- otra cuenta, un miembro podía:
--   · crear un disparador con el flow_id de otro bot y correr ese flujo en su chat de prueba;
--   · crear un pedido «confirmada» con el version_id de otro bot y recibir sus links de entrega;
--   · insertar mensajes en el contact_id de otro bot (llegan al historial de SU IA).
-- Es la misma familia que 0100 cerró para sequence_subscriptions. Acá va con un trigger (una
-- sola regla por tabla, para INSERT y UPDATE) y SOLO para escrituras del panel (rol
-- authenticated): el motor escribe con service-role y ya arma las filas desde el propio canal.
-- ═══════════════════════════════════════════════════════════════════
create or replace function nodo_refs_mismo_canal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;
  if tg_table_name = 'flow_triggers' then
    if new.flow_id is not null and not exists (select 1 from flows f where f.id = new.flow_id and f.channel_id = new.channel_id) then
      raise exception 'El flujo no es de este bot';
    end if;
  elsif tg_table_name = 'orders' then
    if new.product_id is not null and not exists (select 1 from products p where p.id = new.product_id and p.channel_id = new.channel_id) then
      raise exception 'El producto no es de este bot';
    end if;
    if new.version_id is not null and not exists (
      select 1 from product_versions v join products p on p.id = v.product_id
      where v.id = new.version_id and p.channel_id = new.channel_id) then
      raise exception 'La presentación no es de este bot';
    end if;
    if new.contact_id is not null and not exists (select 1 from contacts c where c.id = new.contact_id and c.channel_id = new.channel_id) then
      raise exception 'El contacto no es de este bot';
    end if;
  elsif tg_table_name = 'messages' then
    if new.contact_id is not null and not exists (select 1 from contacts c where c.id = new.contact_id and c.channel_id = new.channel_id) then
      raise exception 'El contacto no es de este bot';
    end if;
  elsif tg_table_name = 'contacts' then
    if new.product_id is not null and not exists (select 1 from products p where p.id = new.product_id and p.channel_id = new.channel_id) then
      raise exception 'El producto no es de este bot';
    end if;
  end if;
  return new;
end $$;
--##--
drop trigger if exists trg_refs_mismo_canal on flow_triggers;
--##--
create trigger trg_refs_mismo_canal before insert or update on flow_triggers
  for each row execute function nodo_refs_mismo_canal();
--##--
drop trigger if exists trg_refs_mismo_canal on orders;
--##--
create trigger trg_refs_mismo_canal before insert or update of product_id, version_id, contact_id, channel_id on orders
  for each row execute function nodo_refs_mismo_canal();
--##--
drop trigger if exists trg_refs_mismo_canal on messages;
--##--
create trigger trg_refs_mismo_canal before insert or update of contact_id, channel_id on messages
  for each row execute function nodo_refs_mismo_canal();
--##--
drop trigger if exists trg_refs_mismo_canal on contacts;
--##--
create trigger trg_refs_mismo_canal before insert or update of product_id, channel_id on contacts
  for each row execute function nodo_refs_mismo_canal();
