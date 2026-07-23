-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0050 — Gastos extra (manuales) para la ganancia neta REAL
--   Gastos operativos que el dueño registra a mano y que no salen de los
--   pedidos (mercadería/envío) ni de Meta (publicidad): empaques, sueldos,
--   local, diseño, etc. El Dashboard los resta en la banda de rentabilidad
--   y en el gráfico diario. RLS por cuenta; CRUD desde el panel.
-- ═══════════════════════════════════════════════════════════════════
create table if not exists manual_expenses (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references channels(id) on delete cascade,
  fecha       date not null default current_date,
  monto       numeric not null default 0,
  descripcion text not null,
  categoria   text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_manual_expenses_ch on manual_expenses(channel_id, fecha);
alter table manual_expenses enable row level security;
drop policy if exists manual_expenses_tenant on manual_expenses;
create policy manual_expenses_tenant on manual_expenses
  for all using (owns_channel(channel_id)) with check (owns_channel(channel_id));
