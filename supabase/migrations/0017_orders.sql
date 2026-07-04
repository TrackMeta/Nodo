-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0017 — Órdenes (ventas con desglose por producto/versión/bumps)
-- Da soporte a las métricas de producto del Dashboard:
--   • unidades e ingresos por producto y por variante (versión)
--   • order bumps vendidos, cantidad e ingresos
--   • ingresos totales confirmados (producto + bumps)
-- El motor de flujos (nodo de confirmación de compra / OCR) escribe aquí
-- con service_role; el panel solo lee (RLS is_member).
-- ═══════════════════════════════════════════════════════════════════
create table if not exists orders (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references channels(id) on delete cascade,
  contact_id   uuid references contacts(id) on delete set null,
  product_id   uuid references products(id) on delete set null,
  version_id   uuid references product_versions(id) on delete set null,
  amount       numeric not null default 0,          -- monto del producto base
  currency     text not null default 'PEN',
  order_bumps  jsonb not null default '[]'::jsonb,   -- [{ "nombre":"...", "precio":49 }]
  estado       text not null default 'confirmada',   -- confirmada | pendiente | anulada
  order_id     text,                                 -- id de comprobante (dedup con capi_events)
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz
);

create index if not exists idx_orders_channel_created on orders(channel_id, created_at desc);
create index if not exists idx_orders_product on orders(product_id);
create unique index if not exists uq_orders_order_id on orders(channel_id, order_id)
  where order_id is not null;

alter table orders enable row level security;

drop policy if exists orders_select on orders;
create policy orders_select on orders for select using (is_member());
-- Escritura solo service_role (motor); admins pueden ajustar manualmente.
drop policy if exists orders_admin_all on orders;
create policy orders_admin_all on orders for all using (is_admin()) with check (is_admin());
