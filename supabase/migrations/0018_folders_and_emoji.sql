-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0018 — Carpetas consistentes + emoji de producto
--   • Carpetas (organización) en productos, plantillas, flujos y campos.
--   • Emoji representativo por producto (indicador visual en la Bandeja:
--     al lado de la foto del contacto según el producto de entrada).
-- Todas las columnas son opcionales y los selects del panel son
-- resilientes (reintentan sin la columna si aún no está aplicada).
-- ═══════════════════════════════════════════════════════════════════
alter table products      add column if not exists folder text;
alter table products      add column if not exists emoji  text;   -- ej. '💪', '📕'
alter table wa_templates  add column if not exists folder text;
alter table flows         add column if not exists folder text;
alter table custom_fields add column if not exists folder text;
