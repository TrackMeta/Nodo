-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0120 — Google Sheets: la conexión se CONFIRMA desde el panel de quien la inició.
--
-- El `state` protegía el callback, pero no ataba el permiso de Google a quien inició la
-- conexión: un admin podía mandarle el enlace de Google a un tercero y, si éste aceptaba,
-- el refresh token del tercero (permiso sobre TODAS sus hojas) quedaba en el canal del admin.
-- Ahora el callback no conecta: deja el permiso PENDIENTE en esta tabla (solo service_role,
-- sin políticas) y le da al navegador que volvió de Google un código de un solo uso. La
-- conexión se activa cuando ese navegador, con la sesión de Nodo del MISMO usuario que la
-- inició, lo confirma. El tercero engañado no tiene esa sesión; el admin no tiene el código.
-- Lo pendiente vive como mucho 10 minutos (el barrido de gsheets-connect/-callback lo borra).
--
-- Delimitador entre sentencias: la línea  --##--  (la Management API no acepta varias).
-- ═══════════════════════════════════════════════════════════════════

alter table gsheets_oauth_state
  add column if not exists pendiente_refresh text,
  add column if not exists pendiente_email text,
  add column if not exists confirm_hash text;
--##--
create index if not exists idx_gsheets_state_confirm on gsheets_oauth_state(confirm_hash) where confirm_hash is not null;
