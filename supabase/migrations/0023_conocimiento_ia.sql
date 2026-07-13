-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0023 — Conocimiento del negocio + perfiles de IA (§6-OCTIES)
-- Nivel 1 del contexto de IA: texto libre por canal que se inyecta a
-- todos los nodos IA conversacionales. Los perfiles definen proveedor
-- y modelo por ROL (ventas / ocr / extraccion) en un solo lugar.
-- ═══════════════════════════════════════════════════════════════════

-- Conocimiento del negocio (quiénes somos, tono, políticas, FAQ general).
alter table channels add column if not exists negocio text;

-- Perfiles de IA por rol:
--   { "ventas":     { "proveedor": "anthropic", "modelo": "claude-sonnet-5" },
--     "ocr":        { "proveedor": "anthropic", "modelo": "claude-sonnet-5" },
--     "extraccion": { "proveedor": "anthropic", "modelo": "claude-haiku-4-5-20251001" } }
-- Los nodos IA usan el perfil de su operación salvo override en el nodo.
alter table channels add column if not exists ia_perfiles jsonb not null default '{}'::jsonb;
