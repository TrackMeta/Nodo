-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0057 — Segmento de audiencia por secuencia.
--
-- Hasta ahora todos los que mostraban interés caían en la MISMA secuencia
-- de remarketing (products.config.remarketing_seq_id). Ahora una secuencia
-- puede apuntar a un SEGMENTO, y el contacto entra a la que corresponde a
-- qué tan lejos llegó antes de callarse.
--
-- Valores (por fase):
--   · general                 → todos los interesados (default, = lo de antes)
--   · provincia_sin_adelanto  → dejaron todos sus datos de provincia pero no
--                               pagaron el adelanto (Fase 1)
--   · solo_inicio / interactuo → Fase 2 (curiosos vs. interesados activos)
-- ═══════════════════════════════════════════════════════════════════
alter table public.sequences
  add column if not exists segmento text not null default 'general';

-- Índice para que el motor encuentre rápido la secuencia de un segmento por canal.
create index if not exists sequences_channel_segmento_idx
  on public.sequences (channel_id, segmento) where activo;
