-- ══════════════════════════════════════════════════════
-- Nodo · 0090 — Dejar LEER el tipo de cambio desde el panel
--
-- La 0089 agregó `channels.usd_rate` y nada más, y el panel se quedó sin poder
-- leerla: "permission denied for table channels". No es RLS — es que la 0073
-- revocó el SELECT de TABLA sobre channels y lo re-otorgó columna por columna
-- (para que un operador no pudiera leer el secreto del webhook de Telegram).
-- Una columna nueva nace, por lo tanto, invisible para el panel hasta que se le
-- da su grant. La 0073 lo deja escrito en su encabezado; esta migración es
-- justamente ese mantenimiento.
--
-- Solo SELECT: el UPDATE nunca se revocó a nivel de tabla, así que guardar el
-- valor ya funcionaba — lo que fallaba era volver a leerlo.
-- ══════════════════════════════════════════════════════

grant select (usd_rate) on public.channels to authenticated, anon;
