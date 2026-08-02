-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0063 — Ángulos de creativo
--   Un "ángulo" agrupa los anuncios (ad_ids) que comparten el mismo gancho
--   (Dolor, Energía, Oferta…). Sirve para: mensajes iniciales según el ángulo
--   del que llega el cliente, que la IA retome ese gancho, reportes por ángulo
--   en Rendimiento y remarketing con el mismo gancho.
--   · angulos: la entidad (por producto), con la lista de ad_ids y un gancho
--     de texto que la IA usa en la conversación.
--   · contacts.angulo: el slug del ángulo CONGELADO en el contacto (resuelto
--     una vez desde su ad_id). Nombre/gancho se leen en vivo de `angulos`.
-- Un ad_id vive en UN solo ángulo → resolución directa por `ad_ids @> array[id]`.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists angulos (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references channels(id) on delete cascade,
  product_id  uuid references products(id) on delete cascade,
  nombre      text not null,
  slug        text not null,
  ad_ids      text[] not null default '{}',
  gancho_ia   text,                                   -- frase que la IA usa (opcional)
  orden       int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (channel_id, product_id, slug)
);
create index if not exists idx_angulos_channel on angulos(channel_id);
create index if not exists idx_angulos_product on angulos(product_id);
-- Buscar el ángulo que contiene un ad_id (resolución del contacto y reportes).
create index if not exists idx_angulos_ad_ids on angulos using gin(ad_ids);

alter table angulos enable row level security;
drop policy if exists angulos_tenant on angulos;
create policy angulos_tenant on angulos
  for all using (owns_channel(channel_id)) with check (owns_channel(channel_id));

-- Ángulo congelado del contacto (slug). Se setea la 1ª vez que llega con un
-- ad_id que pertenece a un ángulo. NULL = no vino por anuncio con ángulo.
alter table contacts add column if not exists angulo text;
