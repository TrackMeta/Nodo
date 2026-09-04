-- ══════════════════════════════════════════════════════
-- Nodo · 0089 — Cuánto vale un dólar en tu moneda
--
-- El proveedor de IA cobra en DÓLARES y la ganancia del Dashboard está en la
-- moneda del negocio. Sin una tasa, ese costo no se puede restar de la ganancia
-- sin inventar el número; con ella, entra como un gasto más (y la Bitácora usa
-- exactamente la misma, para que las dos ganancias coincidan).
--
-- Columna propia y no una clave dentro de `negocio`: ese campo es TEXTO (las
-- instrucciones que el dueño le escribe al bot), no un objeto de ajustes.
-- Guardarle una clave adentro no solo no funciona: al intentar mezclarla se
-- convirtió el texto en un objeto carácter por carácter y hubo que rehacerlo.
--
-- Vacía = sin configurar. El panel entonces muestra el gasto de IA aparte y en
-- dólares, y dice qué falta para incluirlo en la ganancia; si el negocio cobra
-- en USD no hace falta llenar nada.
-- ══════════════════════════════════════════════════════

alter table channels add column if not exists usd_rate numeric(12,4);

-- OJO: la 0073 revoco el SELECT de TABLA sobre channels y lo re-otorga columna por
-- columna, asi que una columna nueva nace invisible para el panel. El grant va en la
-- 0090 (se detecto despues: el panel daba "permission denied for table channels").

comment on column channels.usd_rate is
  'Cuánto vale 1 USD en la moneda del canal. Solo para convertir costos que llegan en dólares (hoy: el consumo de IA). NULL = sin configurar.';
