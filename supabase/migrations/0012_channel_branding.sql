-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0012 — Branding por canal (logo dinámico del panel)
-- Cada bot/número puede tener su propio logo; si es null se usa el de Nodo.
-- ═══════════════════════════════════════════════════════════════════
alter table channels add column if not exists logo_url text;
