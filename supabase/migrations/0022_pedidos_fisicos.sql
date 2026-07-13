-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0022 — Productos FÍSICOS (DEFINICION §6-SEPTIES)
-- El ciclo de vida del pedido físico vive en orders.estado (texto);
-- los datos de envío/cobro en orders.shipping (jsonb). La config de
-- envío del producto (adelanto, envío gratis, agencias, cobro_saldo)
-- vive en products.config (jsonb ya existente).
-- ═══════════════════════════════════════════════════════════════════

-- products.tipo: digital | fisico
alter table products add column if not exists tipo text not null default 'digital';
do $$ begin
  alter table products add constraint products_tipo_chk check (tipo in ('digital','fisico'));
exception when duplicate_object then null; end $$;

-- orders: datos de envío + reloj de actualización.
-- shipping = { zona: lima|provincia, direccion, distrito, referencia, dni,
--              agencia, sede, guia, guia_url, clave_recojo, adelanto, saldo }
alter table orders add column if not exists shipping jsonb not null default '{}'::jsonb;
alter table orders add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_orders_estado on orders(channel_id, estado);

-- Estados del pedido (orders.estado, texto libre — referencia):
--   digital:          confirmada | pendiente | anulada
--   físico Lima:      confirmado → en_reparto → entregado_cobrado ✅
--                     (salidas: reprogramado | rechazado)
--   físico provincia: esperando_adelanto → adelanto_validado → por_despachar
--                     → despachado → en_agencia → saldo_pagado → recogido ✅
--                     (salidas: no_recogido | cancelado)
