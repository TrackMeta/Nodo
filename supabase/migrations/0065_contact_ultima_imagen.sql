-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0065 — Flag "el cliente envió una imagen" en el contacto.
--
-- Para el filtro de Bandeja/Contactos "envió una imagen" (típico: mandó
-- un comprobante/foto). En vez de escanear miles de mensajes en cada carga
-- del panel, se DENORMALIZA en el contacto con un trigger de BD (mismo
-- patrón que trg_touch_conversation que sube no_leidos): cada imagen
-- ENTRANTE sella `ultima_imagen_at`. El filtro es entonces trivial y escala.
-- ═══════════════════════════════════════════════════════════════════
alter table public.contacts
  add column if not exists ultima_imagen_at timestamptz;

-- Al insertar un mensaje entrante de tipo imagen, sella la marca en el contacto.
create or replace function bump_ultima_imagen() returns trigger
language plpgsql as $$
begin
  if new.direction = 'in' and new.type = 'image' then
    update contacts set ultima_imagen_at = new.ts where id = new.contact_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_ultima_imagen on messages;
create trigger trg_ultima_imagen
  after insert on messages
  for each row execute function bump_ultima_imagen();

-- Backfill: contactos que YA habían enviado imágenes antes de esta migración.
update contacts c
   set ultima_imagen_at = m.maxts
  from (select contact_id, max(ts) as maxts
          from messages
         where direction = 'in' and type = 'image'
         group by contact_id) m
 where m.contact_id = c.id;
