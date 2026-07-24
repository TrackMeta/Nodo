-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0053 — Resúmenes diarios por Telegram (mañana + noche)
--
-- Dos avisos programables que el scheduler manda solo:
--   • mañana → cómo te fue AYER (KPIs del día anterior)
--   • noche  → cómo va HOY (KPIs del día en curso)
-- La hora de cada uno la elige el operador (Canales → Avisos).
--
-- `resumenes`       = configuración (la escribe el panel).
-- `resumen_estado`  = última fecha enviada por tipo (la escribe el scheduler);
--                     va en columna aparte para que guardar la config NO borre
--                     la marca anti-duplicado, ni al revés.
-- ═══════════════════════════════════════════════════════════════════

-- resumenes: { manana:{on:bool, hora:"08:00"}, noche:{on:bool, hora:"21:00"} }
alter table channels add column if not exists resumenes jsonb;

-- resumen_estado: { manana:"2026-07-24", noche:"2026-07-24" } (fecha local ya enviada)
alter table channels add column if not exists resumen_estado jsonb not null default '{}'::jsonb;
