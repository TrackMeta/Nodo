-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0058 — Segmento de la suscripción de remarketing.
--
-- Con el remarketing POR PRODUCTO (products.config.remarketing_seqs = mapa
-- segmento→secuencia), la guarda de "graduar solo hacia adelante" necesita
-- saber en qué segmento está inscrito el contacto AHORA MISMO. Se guarda en la
-- propia suscripción (antes se deducía de sequences.segmento, que con el link
-- por producto ya no es la fuente de verdad).
-- ═══════════════════════════════════════════════════════════════════
alter table public.sequence_subscriptions
  add column if not exists segmento text;
