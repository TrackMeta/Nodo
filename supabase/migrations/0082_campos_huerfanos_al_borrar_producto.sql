-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0082 — los campos técnicos se van con su producto.
--
-- `setField` crea el campo solo cuando un flujo escribe en uno que no existe:
-- así un flujo nuevo guarda un dato sin declararlo antes en la sección Campos.
-- Bien. El problema son los campos técnicos que llevan el UUID pegado al nombre:
--
--   _once_venta_2cf125a2-3ba7-45dc-967f-7cd6ceb7a357   (una venta = un aviso)
--   _once_extraf_532cf60e-92af-4e74-b764-cacc59a9ca01  (un extra = una vez)
--   xt532cf60e92_talla                                 (la talla de ese extra)
--
-- El UUID va en el NOMBRE, que es lo que los hace únicos por producto… y también
-- irrepetibles: cada producto estrena su juego. Y al borrar el producto se
-- quedaban, porque custom_fields no tiene ninguna referencia a él — no hay nada
-- que la cascada pueda seguir.
--
-- Medido tras un día de pruebas: 33 campos de verdad y 292 huérfanos de productos
-- que ya no existen. No rompe nada (el motor lee los campos por nombre, y nadie
-- pide esos), pero la tabla crece sin tope y la sección Campos se llena de ruido.
--
-- Va como TRIGGER y no en el panel a propósito: los productos también se borran
-- desde los harness y por SQL directo, y así se limpia siempre, no solo cuando el
-- borrado pasa por la interfaz.
-- ═══════════════════════════════════════════════════════════════════

create or replace function nodo_borra_campos_del_borrado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Los campos de talla del extra usan el UUID sin guiones, recortado a 10
  -- (ver `pref` en engine.ts): "xt" + 532cf60e92 + "_talla".
  hex10 text := left(replace(old.id::text, '-', ''), 10);
begin
  delete from custom_fields
   where key like '%' || old.id::text || '%'
      or key like 'xt' || hex10 || '%';
  return old;
end;
$$;

-- Dos disparadores porque los UUID que viajan en los nombres son de AMBAS tablas:
-- los avisos de venta usan el id del producto y los extras el de la versión.
-- El de versiones cubre además el borrado en cascada al eliminar el producto.
drop trigger if exists trg_producto_borra_campos on products;
create trigger trg_producto_borra_campos
  after delete on products
  for each row execute function nodo_borra_campos_del_borrado();

drop trigger if exists trg_version_borra_campos on product_versions;
create trigger trg_version_borra_campos
  after delete on product_versions
  for each row execute function nodo_borra_campos_del_borrado();
