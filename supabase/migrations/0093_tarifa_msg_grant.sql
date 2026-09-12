-- ══════════════════════════════════════════════════════
-- Nodo · 0093 — Dejar LEER la tarifa por mensaje desde el panel
--
-- La 0092 agregó `channels.tarifa_msg_usd` y la función `gasto_meta_por_origen`
-- (security invoker) que la lee — y no dio el grant de columna. Como la 0073
-- revocó el SELECT de tabla sobre channels y lo re-otorga columna por columna,
-- el panel no podía leerla y la función fallaba con "permission denied" para
-- un usuario logueado. Misma lección que la 0090 con usd_rate: toda columna
-- nueva de channels nace invisible hasta su grant.
--
-- Solo SELECT: el UPDATE de tabla nunca se revocó, así que guardarla ya funcionaba.
-- ══════════════════════════════════════════════════════

grant select (tarifa_msg_usd) on public.channels to authenticated, anon;
