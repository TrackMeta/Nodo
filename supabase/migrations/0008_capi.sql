-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0008 — Eventos de conversión (Meta CAPI)
-- Registra los eventos enviados a Meta (Lead / InitiateCheckout / Purchase)
-- con doble deduplicación:
--   · por event_id  → idempotencia general (no reenviar el mismo evento)
--   · por order_id  → una sola compra por comprobante
-- ═══════════════════════════════════════════════════════════════════
create table if not exists capi_events (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references channels(id) on delete cascade,
  contact_id    uuid references contacts(id) on delete set null,
  event_name    text not null,                    -- Lead | InitiateCheckout | Purchase
  value         numeric,
  currency      text not null default 'PEN',
  order_id      text,                             -- id del comprobante (dedup de compra)
  event_id      text not null,                    -- clave de deduplicación en Meta
  action_source text,                             -- business_messaging | website
  estado        text not null default 'pendiente',-- pendiente | enviado | fallido
  meta_response jsonb,
  created_at    timestamptz not null default now()
);

-- Idempotencia: un mismo event_id no se procesa dos veces por canal.
create unique index if not exists uq_capi_event on capi_events(channel_id, event_id);
-- Una sola compra por comprobante (order_id) por canal.
create unique index if not exists uq_capi_order on capi_events(channel_id, order_id)
  where order_id is not null and event_name = 'Purchase';
create index if not exists idx_capi_channel_created on capi_events(channel_id, created_at desc);

alter table capi_events enable row level security;

-- Los miembros pueden LEER los eventos (reportes/auditoría). La escritura
-- la hace el motor (service_role, que bypassa RLS).
drop policy if exists capi_events_select on capi_events;
create policy capi_events_select on capi_events
  for select using (is_member());
