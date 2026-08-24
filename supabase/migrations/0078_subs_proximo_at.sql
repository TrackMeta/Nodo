-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0078 — "despertador" por suscripción de remarketing.
--
-- Hasta ahora el cron PASABA LISTA: cada minuto agarraba un grupo de suscripciones
-- activas y preguntaba una por una "¿a esta ya le toca?". El trabajo crecía con el
-- TOTAL de suscritos, aunque el 99% no tuviera nada que hacer — y una suscripción
-- que no puede enviar (es de madrugada, el cliente está a mitad de charla con el
-- bot, el anti-spam la frena) se revisaba igual CADA MINUTO, toda la noche.
--
-- `proximo_at` es la hora en la que hay que VOLVER A MIRAR a esta suscripción. No
-- es solo "cuándo enviar": también es "cuándo reintentar". El cron pasa a pedir
-- únicamente las vencidas, así que el trabajo por tick deja de depender de cuántos
-- suscritos hay y pasa a depender de a cuántos les toca AHORA — que siempre son
-- pocos, tengas 100 o un millón.
--
-- Es el mismo patrón que el motor ya usa para las conversaciones dormidas
-- (`flow_runs.wake_at` + su índice parcial). Dos mecanismos distintos para lo mismo
-- sería peor que el problema que resuelven.
--
-- NULL = "nunca calculada" y se trata como VENCIDA a propósito: así las
-- suscripciones que ya existían entran en la primera pasada y se sellan solas, sin
-- necesidad de un backfill aparte ni de que nadie quede olvidado.
-- ═══════════════════════════════════════════════════════════════════

alter table sequence_subscriptions
  add column if not exists proximo_at timestamptz;

-- El orden del cron: primero las que llevan más tiempo vencidas (y las nunca
-- calculadas). Parcial porque solo se miran las activas — las completadas y
-- canceladas son la mayoría y no se recorren nunca.
create index if not exists idx_subs_proximo
  on sequence_subscriptions(proximo_at nulls first)
  where estado = 'activa';
