-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0021 — Timeline de actividad del contacto + bloqueo
--   contact_events: bitácora cronológica de todo lo que ocurre sobre un
--   contacto (etiquetas, campos, flujos, secuencias, compras, intervención
--   humana, pausa/reactivación del bot, nodos ejecutados, errores…).
--   La escribe el motor (service_role) y también el panel (acciones
--   manuales del operador), y la Bandeja la muestra como Timeline.
-- ═══════════════════════════════════════════════════════════════════
create table if not exists contact_events (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references channels(id) on delete cascade,
  contact_id  uuid not null references contacts(id) on delete cascade,
  tipo        text not null,   -- etiqueta_add|etiqueta_del|campo|flujo_inicio|flujo_fin|
                               -- secuencia_inicio|secuencia_cancel|compra|humano|bot_pausa|
                               -- bot_reactiva|nodo|error|nota
  titulo      text not null,
  detalle     text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_contact_events_contact on contact_events(contact_id, created_at desc);

alter table contact_events enable row level security;
drop policy if exists contact_events_all on contact_events;
create policy contact_events_all on contact_events for all using (is_member()) with check (is_member());

-- Bloqueo de contacto (el motor deja de responder; la Bandeja lo oculta).
alter table contacts add column if not exists bloqueado boolean not null default false;
