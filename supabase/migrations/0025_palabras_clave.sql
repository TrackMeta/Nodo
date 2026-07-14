-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0025 — Palabras Clave + IA Router (ruteo de inicio de chat)
-- Las palabras/frases clave YA viven en flow_triggers (tipo 'keyword',
-- config.keywords[] + config.match). Esta migración solo agrega la
-- configuración del RUTEADOR POR IA: el 3er nivel del ruteo de inicio,
-- que se dispara cuando ninguna keyword/referral matchea y elige el
-- producto por INTENCIÓN (usa la Descripción/FAQ de cada producto).
--
-- Cascada de ruteo (ver engine.ts):
--   1) referral (ad_id)  →  2) keyword (determinista)  →  3) IA Router
--   →  4) flujo de respaldo (fallback_flow_id) o nada.
-- ═══════════════════════════════════════════════════════════════════

-- Config del ruteador por IA, por canal:
--   { "activo": true,
--     "umbral": 0.6,                    -- confianza mínima [0..1] para rutear
--     "fallback_flow_id": "<uuid>",     -- flujo "menú" si la IA no está segura
--     "perfil": "ventas" }              -- perfil de IA a usar (opcional)
alter table channels add column if not exists ia_router jsonb not null default '{}'::jsonb;

-- Descripción de intención por producto (cuándo debe activarlo la IA).
-- Es OPCIONAL: si falta, el router usa config.contexto_producto/faq del
-- producto. Vive en products.config.intencion (texto libre) — no requiere
-- columna nueva. Este comentario documenta la convención.
