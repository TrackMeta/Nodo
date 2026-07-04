-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0014 — Ajustes (zona horaria, Google Sheets) + Perfil
-- ═══════════════════════════════════════════════════════════════════

-- ── Zona horaria por bot (define el inicio/fin del día para métricas,
--    campañas programadas, conversiones, etc.). El retraso de respuesta
--    del bot ya existe: channels.buffer_default_seg.
alter table channels add column if not exists timezone text not null default 'America/Lima';

-- ── Config de Google Sheets por bot (se deja preparada la integración).
--    Guarda estado/credenciales de conexión (service account email, id de
--    hoja por defecto, etc.). El detalle lo maneja el frontend/edge function.
alter table channels add column if not exists gsheets jsonb not null default '{}'::jsonb;

-- ── Perfil del propietario: foto de perfil.
alter table app_users add column if not exists avatar_url text;
