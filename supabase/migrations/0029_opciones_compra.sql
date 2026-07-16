-- Nodo · 0029 — Opciones de compra (Fase 1 del rediseño de ventas)
--
-- Unifica en UN solo concepto lo que antes eran tres: "versiones" (Básico/
-- Premium), "packs" y "ofertas por cantidad". Para el sistema las tres tienen
-- la misma forma: algo comprable, con nombre, precio y algo que se entrega.
--
-- Se EVOLUCIONA product_versions en vez de crear una tabla nueva: ya la
-- referencian orders.version_id y el Dashboard, así que migrar a otra tabla
-- rompería el histórico sin ganar nada. En la interfaz se llama "Opciones de
-- compra"; la tabla conserva su nombre interno (mismo criterio que order_bumps
-- → "ventas extras").
--
-- Atributos (talla, color) NO viven acá: son detalles que no cambian el precio
-- y van en products.config.atributos (jsonb, sin migración).

-- precio       : precio canónico de la opción (price_list queda como legado).
-- entrega      : [{tipo:'link'|'archivo', url, nombre?, filename?}] — uno o varios.
-- descripcion  : texto para que la IA sepa venderla y reconocerla.
-- activo       : permite pausar una opción sin borrarla.
-- cantidad     : unidades que entrega (1 par / 2 pares / pack de 3). Físico.
alter table product_versions add column if not exists precio      numeric;
alter table product_versions add column if not exists entrega     jsonb   not null default '[]'::jsonb;
alter table product_versions add column if not exists descripcion text;
alter table product_versions add column if not exists activo      boolean not null default true;
alter table product_versions add column if not exists cantidad    int     not null default 1;

-- ── Migración de datos existentes ─────────────────────────────────────
do $$
begin
  -- precio ← primer valor de la escalera price_list (si había).
  update product_versions
     set precio = price_list[1]
   where precio is null
     and price_list is not null
     and array_length(price_list, 1) >= 1;

  -- entrega ← el drive_link único que existía.
  update product_versions
     set entrega = jsonb_build_array(
           jsonb_build_object('tipo', 'link', 'url', drive_link, 'nombre', 'Acceso')
         )
   where coalesce(drive_link, '') <> ''
     and (entrega is null or entrega = '[]'::jsonb);

  -- Todo producto tiene al menos UNA opción: los que no tenían versiones
  -- reciben una opción "Única" con el precio y el link que vivían sueltos en
  -- products.config. Así el modelo es uniforme y no hay casos especiales.
  insert into product_versions (product_id, nombre, precio, entrega, orden, activo, cantidad)
  select p.id,
         'Única',
         case when coalesce(p.config->>'precio', '') ~ '^[0-9]+(\.[0-9]+)?$'
              then (p.config->>'precio')::numeric end,
         case when coalesce(p.config->>'link_entrega', '') <> ''
              then jsonb_build_array(
                     jsonb_build_object('tipo', 'link',
                                        'url', p.config->>'link_entrega',
                                        'nombre', 'Acceso'))
              else '[]'::jsonb end,
         0, true, 1
    from products p
   where not exists (select 1 from product_versions v where v.product_id = p.id);
end $$;

-- Las opciones se listan por orden y se filtran por activas.
create index if not exists idx_pv_product_orden on product_versions(product_id, orden);
