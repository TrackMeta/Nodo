-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0062 — WhatsApp usernames / BSUID (Business-Scoped User ID)
--
-- Desde ~abril 2026, un usuario de WhatsApp con "nombre de usuario" puede
-- escribirle a un negocio SIN compartir su número. En ese caso el webhook trae
-- en contacts[0]:
--   · user_id  (BSUID) — SIEMPRE presente de acá en adelante; id del usuario
--     acotado a TU negocio (distinto para otro negocio, no portable).
--   · username — el @handle de WhatsApp (si lo activó).
--   · wa_id    — el número, SOLO si hubo interacción en los últimos 30 días o
--     el usuario está en tu agenda; si usa username y no lo comparte, falta.
--
-- Diseño: `wa_id` sigue siendo la LLAVE del contacto (el número cuando hay,
-- el BSUID cuando no) → los contactos existentes no se re-keyan. Estas columnas
-- guardan el BSUID, el username (para mostrar) y el NÚMERO REAL cuando se conoce
-- (para el courier y CAPI). `telefono IS NULL` = cliente sin número → el flujo
-- físico se lo pide (y queda en shipping.tel).
-- ═══════════════════════════════════════════════════════════════════
alter table contacts add column if not exists user_id  text;   -- BSUID (id del usuario acotado al negocio)
alter table contacts add column if not exists username text;   -- @handle de WhatsApp
alter table contacts add column if not exists telefono text;   -- número real (E.164 sin +) cuando se conoce; null = sin número

-- Backfill: TODOS los contactos actuales se crearon con wa_id = número (antes de
-- BSUID), así que su teléfono real es su propia llave. De acá en adelante el
-- webhook mantiene `telefono` solo cuando el número llega.
update contacts set telefono = wa_id where telefono is null;

-- Búsqueda/reconciliación por BSUID (un mismo usuario puede aparecer luego con
-- número): índice por (canal, BSUID).
create index if not exists contacts_channel_user_id on contacts (channel_id, user_id) where user_id is not null;
