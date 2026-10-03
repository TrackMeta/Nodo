-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0122 — El EXAMEN FIJO del bot de ventas (PLAN_MOTOR_IA.md, fase 0).
--
-- Una batería fija de conversaciones (supabase/functions/examen/bateria.ts) se corre contra el
-- motor real y un juez IA marca cada respuesta del bot (no contestó, frase cortada, inventó…).
-- Cada corrida queda guardada para comparar un cambio del motor contra el anterior: ningún
-- cambio se queda si la nota empeora.
--
-- Solo service_role (RLS sin políticas): el panel lo lee a través de la función `examen`,
-- que verifica que quien pregunta es admin del canal.
-- Delimitador entre sentencias: la línea  --##--  (la Management API no acepta varias).
-- ═══════════════════════════════════════════════════════════════════

create table if not exists examenes (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  etiqueta text,
  modelo text,
  total int not null default 0,
  creado_por uuid,
  created_at timestamptz not null default now()
);
--##--
create table if not exists examen_conversaciones (
  examen_id uuid not null references examenes(id) on delete cascade,
  conv text not null,
  titulo text,
  estado text not null default 'pendiente',   -- pendiente | corrida | juzgada | error
  transcript jsonb,
  juicio jsonb,
  graves int,
  leves int,
  error text,
  updated_at timestamptz not null default now(),
  primary key (examen_id, conv)
);
--##--
create index if not exists idx_examenes_canal on examenes(channel_id, created_at desc);
--##--
alter table examenes enable row level security;
--##--
alter table examen_conversaciones enable row level security;
