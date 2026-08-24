-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0077 — cursor de revisión para las secuencias de remarketing.
--
-- El scheduler lee 200 suscripciones activas por tick, ordenadas por `updated_at`
-- ascendente ("la menos tocada primero, para evitar inanición"). El problema es
-- que `processSub` devuelve sin escribir nada en la MAYORÍA de sus caminos: el
-- temporizador del paso aún no vence, la secuencia está pausada, hay un run
-- activo, es fuera de horario, el antispam frena… En todos esos casos
-- `updated_at` queda igual, así que esas mismas 200 vuelven a ser "las menos
-- tocadas" en el tick siguiente. Y se repite cada minuto.
--
-- Con más de 200 suscripciones activas, las que esperan un paso largo (las de
-- `updated_at` más viejo, justo las que el orden pone primero) tapan a todas las
-- demás: las que SÍ vencían hoy no se miran nunca y el remarketing se apaga en
-- silencio para la mayoría de los leads. Y no se puede rotar reescribiendo
-- `updated_at`, porque esa columna es el ANCLA del temporizador (marca cuándo se
-- envió el paso anterior): tocarla reiniciaría la cuenta de todos.
--
-- Por eso el cursor va aparte. `revisado_at` solo dice "el cron ya la miró", se
-- sella dispare o no, y deja el temporizador en paz.
-- ═══════════════════════════════════════════════════════════════════

alter table sequence_subscriptions
  add column if not exists revisado_at timestamptz;

-- El orden del cron: nunca revisadas primero, después las más rancias. Parcial
-- porque el cron solo mira las activas (las completadas/canceladas son mayoría
-- y no se recorren).
create index if not exists idx_subs_revision
  on sequence_subscriptions(revisado_at nulls first)
  where estado = 'activa';
