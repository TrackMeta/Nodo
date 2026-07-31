-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0061 — Carpetas de verdad (metadata: color, emoji, orden)
--
-- Hasta ahora una "carpeta" era solo el texto en items.folder (products,
-- campaigns, sequences, wa_templates, quick_replies, custom_fields, flows).
-- Problemas: se creaban carpetas fantasma (si no le metías un item,
-- desaparecían al recargar), no tenían color/emoji/orden, y renombrar
-- dejaba huérfanos.
--
-- Este cambio agrega una tabla `folders` que guarda la METADATA de cada
-- carpeta (por canal y por sección/tipo). Los items SIGUEN apuntando por
-- NOMBRE (items.folder), así que:
--   • las carpetas ya no dependen de tener items → no desaparecen.
--   • color/emoji/orden viven en `folders`, keyed por (channel_id, tipo, nombre).
--   • renombrar = update del nombre acá + cascade al texto de los items
--     (lo hace el panel en una transacción de 2 updates; ya se hacía igual
--     al borrar una carpeta).
--
-- RLS multi-tenant: misma regla que el resto (owns_channel). Ver 0039.
-- Aplicar por el SQL Editor del dashboard (acepta multi-statement).
-- ═══════════════════════════════════════════════════════════════════

create table if not exists folders (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references channels(id) on delete cascade,
  tipo        text not null,               -- product|campaign|sequence|template|quick_reply|custom_field|flow
  nombre      text not null,
  color       text,                        -- hex (#RRGGBB) o null
  emoji       text,                        -- 1 emoji o null
  orden       int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (channel_id, tipo, nombre)
);

alter table folders enable row level security;

drop policy if exists folders_tenant on folders;
create policy folders_tenant on folders for all
  using (owns_channel(channel_id)) with check (owns_channel(channel_id));

create index if not exists idx_folders_ch_tipo on folders(channel_id, tipo, orden);

-- ── Sembrar las carpetas que ya existen (texto suelto) → metadata ────
-- orden = alfabético inicial (luego el panel deja reordenar). Idempotente.
insert into folders (channel_id, tipo, nombre, orden)
select channel_id, 'product', folder,
       (row_number() over (partition by channel_id order by folder)) - 1
from (select distinct channel_id, folder from products
      where folder is not null and btrim(folder) <> '') d
on conflict (channel_id, tipo, nombre) do nothing;

insert into folders (channel_id, tipo, nombre, orden)
select channel_id, 'campaign', folder,
       (row_number() over (partition by channel_id order by folder)) - 1
from (select distinct channel_id, folder from campaigns
      where folder is not null and btrim(folder) <> '') d
on conflict (channel_id, tipo, nombre) do nothing;

insert into folders (channel_id, tipo, nombre, orden)
select channel_id, 'sequence', folder,
       (row_number() over (partition by channel_id order by folder)) - 1
from (select distinct channel_id, folder from sequences
      where folder is not null and btrim(folder) <> '') d
on conflict (channel_id, tipo, nombre) do nothing;

insert into folders (channel_id, tipo, nombre, orden)
select channel_id, 'template', folder,
       (row_number() over (partition by channel_id order by folder)) - 1
from (select distinct channel_id, folder from wa_templates
      where folder is not null and btrim(folder) <> '') d
on conflict (channel_id, tipo, nombre) do nothing;

insert into folders (channel_id, tipo, nombre, orden)
select channel_id, 'quick_reply', folder,
       (row_number() over (partition by channel_id order by folder)) - 1
from (select distinct channel_id, folder from quick_replies
      where folder is not null and btrim(folder) <> '') d
on conflict (channel_id, tipo, nombre) do nothing;

insert into folders (channel_id, tipo, nombre, orden)
select channel_id, 'custom_field', folder,
       (row_number() over (partition by channel_id order by folder)) - 1
from (select distinct channel_id, folder from custom_fields
      where folder is not null and btrim(folder) <> '') d
on conflict (channel_id, tipo, nombre) do nothing;

insert into folders (channel_id, tipo, nombre, orden)
select channel_id, 'flow', folder,
       (row_number() over (partition by channel_id order by folder)) - 1
from (select distinct channel_id, folder from flows
      where folder is not null and btrim(folder) <> '') d
on conflict (channel_id, tipo, nombre) do nothing;
