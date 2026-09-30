-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0118 — Quién conectó Google Sheets + cursor del recolector de Storage.
--
-- 1) gsheets_oauth_state.user_id: el nonce del `state` solo decía a QUÉ CANAL iba la
--    conexión, no QUIÉN la pidió. Ahora se guarda el usuario que la inició; el callback
--    comprueba que siga siendo administrador de ese canal y deja anotado en
--    channels.gsheets quién conectó y con qué correo de Google. Nullable: los nonces que
--    estén en vuelo al aplicar esto (duran 10 minutos) siguen sirviendo.
--
-- 2) nodo_estado_sistema: una fila por trabajo de fondo que necesita recordar por dónde
--    iba entre corridas. La usa media-gc para no mirar siempre los mismos 3000 archivos
--    más viejos (los que están en uso nunca salen de esa lista y lo nuevo no se revisaba
--    jamás). Sin políticas = solo service_role, igual que gsheets_oauth_state.
--
-- Delimitador entre sentencias: la línea  --##--  (la Management API no acepta varias).
-- ═══════════════════════════════════════════════════════════════════

alter table gsheets_oauth_state
  add column if not exists user_id uuid;
--##--
create table if not exists nodo_estado_sistema (
  clave      text primary key,
  valor      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
--##--
alter table nodo_estado_sistema enable row level security;
