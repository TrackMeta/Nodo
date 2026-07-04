-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0020 — Respuestas Rápidas
--   Mensajes predefinidos que el operador envía al cliente con un clic.
--   Organizadas por carpetas y con un atajo opcional (ej. /precio).
-- ═══════════════════════════════════════════════════════════════════
create table if not exists quick_replies (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references channels(id) on delete cascade,
  folder      text,
  titulo      text not null,
  atajo       text,                       -- p. ej. /precio
  cuerpo      text not null default '',
  orden       int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_quick_replies_channel on quick_replies(channel_id, orden);

alter table quick_replies enable row level security;
-- Los operadores (miembros) pueden gestionarlas y usarlas.
drop policy if exists quick_replies_all on quick_replies;
create policy quick_replies_all on quick_replies for all using (is_member()) with check (is_member());
