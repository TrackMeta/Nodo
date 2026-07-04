-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0013 — Disparadores de IA + Campos del Bot (valor/descripción)
-- ═══════════════════════════════════════════════════════════════════

-- ── Disparadores de IA ──────────────────────────────────────────────
-- Gatillos que la IA puede activar por sí misma (p. ej. "pago_aprobado",
-- "quiere_comprar", "solicita_asesor"). Se seleccionan desde un bloque de
-- IA y, opcionalmente, ejecutan un flujo al activarse.
create table if not exists ai_triggers (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references channels(id) on delete cascade,
  nombre      text not null,                 -- identificador sin espacios (slug)
  descripcion text,                          -- "¿cuándo debe activarlo la IA?"
  flow_id     uuid references flows(id) on delete set null,  -- flujo a ejecutar (opcional)
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (channel_id, nombre)
);
alter table ai_triggers enable row level security;
drop policy if exists ai_triggers_member on ai_triggers;
create policy ai_triggers_member on ai_triggers for all
  using (is_member()) with check (is_member());

-- ── Campos personalizados: valor fijo + descripción ────────────────
-- `valor` se usa en los campos de modo 'fijo' (Campos del Bot). `descripcion`
-- es una nota opcional para ambos modos.
alter table custom_fields add column if not exists valor       text;
alter table custom_fields add column if not exists descripcion text;
