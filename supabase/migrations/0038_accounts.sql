-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0038 — Multi-tenant, Fase 1: modelo de cuentas + membresías
--
-- ADITIVA Y REVERSIBLE. No cambia NINGÚN comportamiento todavía: la
-- reescritura de las reglas de seguridad (RLS) que usa esta frontera va
-- en 0039. Aquí solo creamos la estructura y asignamos todo lo actual a
-- una cuenta, para que nada se rompa para el negocio existente.
--
-- Decisiones (2026-07-21):
--   D1 = MEMBRESÍAS: un usuario puede pertenecer a varias cuentas; el rol
--        y el estado activo son POR cuenta (tabla account_members).
--   D3 = gancho de plan por cuenta (columna `plan`, sin lógica aún).
-- ═══════════════════════════════════════════════════════════════════

-- ── accounts: un negocio-cliente ────────────────────────────────────
create table if not exists accounts (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  plan       text not null default 'trial',    -- D3: gancho, sin efecto aún (trial|pro|…)
  estado     text not null default 'activa',    -- activa | suspendida
  created_at timestamptz not null default now()
);

-- ── account_members: usuario ↔ cuenta (D1, muchos-a-muchos) ─────────
-- El rol y `activo` viven acá (por cuenta), no en app_users. app_users
-- queda como el PERFIL de la persona (nombre, avatar).
create table if not exists account_members (
  account_id uuid not null references accounts(id)  on delete cascade,
  user_id    uuid not null references app_users(id) on delete cascade,
  role       user_role not null default 'operador',
  activo     boolean   not null default true,
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);
-- Índice para el helper my_accounts() (RLS lo llama en cada consulta).
create index if not exists idx_account_members_user
  on account_members(user_id) where activo;

-- ── channels: dueño de la cuenta ────────────────────────────────────
-- NULLABLE por ahora: el botón "crear bot" del panel aún no setea la
-- cuenta. Se vuelve NOT NULL en la Fase 3, cuando la creación de canal
-- herede la cuenta del creador.
alter table channels add column if not exists account_id uuid references accounts(id);
create index if not exists idx_channels_account on channels(account_id);

-- ── Backfill: toda la data actual es de UNA cuenta ──────────────────
-- Idempotente: solo corre si aún no hay cuentas. Crea "Digital Prime",
-- mete a todos los usuarios existentes como miembros (con su rol/estado
-- actual) y le asigna todos los canales.
do $$
declare acc uuid;
begin
  if not exists (select 1 from accounts) then
    insert into accounts (nombre, plan) values ('Digital Prime', 'pro')
      returning id into acc;

    insert into account_members (account_id, user_id, role, activo)
      select acc, id, role, activo from app_users
      on conflict (account_id, user_id) do nothing;

    update channels set account_id = acc where account_id is null;
  end if;
end $$;

-- ── verify_token único (hoy no lo es) ───────────────────────────────
-- El ruteo real es por phone_number_id (ya único), pero un verify_token
-- compartido entre cuentas sería confuso. Parcial: permite varios NULL.
create unique index if not exists uq_channels_verify_token
  on channels (verify_token) where verify_token is not null;
