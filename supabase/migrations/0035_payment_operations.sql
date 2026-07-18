-- Nodo · 0035 — Registro anti-reúso de operaciones de pago (determinista)
--
-- Hasta ahora el "no aceptes dos veces el mismo comprobante" era una INSTRUCCIÓN
-- a la IA (blanda: se le puede escapar, sobre todo entre pagos distintos —
-- principal, adelanto, saldo, extras). Esto lo vuelve un chequeo POR CÓDIGO.
--
-- Cada nº de operación/constancia que se da por válido se registra acá una vez
-- por canal. Si llega otro comprobante con el mismo número, el motor lo rechaza
-- solo, sin consultar a la IA. El índice único es la garantía dura: aunque dos
-- webhooks casi simultáneos intenten registrar la misma operación, uno falla.
create table if not exists payment_operations (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  operacion text not null,            -- normalizado (trim, sin espacios internos, mayúsculas)
  order_id uuid,                      -- pedido al que se ató (informativo; puede ser null)
  contexto text,                      -- 'digital' | 'extra' | 'adelanto' | 'saldo'
  created_at timestamptz not null default now()
);

create unique index if not exists payment_operations_uniq
  on payment_operations (channel_id, operacion);

create index if not exists payment_operations_channel
  on payment_operations (channel_id);
