-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0016 — Carpetas para secuencias (organización)
-- ═══════════════════════════════════════════════════════════════════
alter table sequences add column if not exists folder text;
