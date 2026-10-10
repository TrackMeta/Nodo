-- Nodo · 0136 — estado del anuncio en Meta (effective_status: ACTIVE, PAUSED, CAMPAIGN_PAUSED, ADSET_PAUSED…).
-- 10-oct: el selector del Embudo pinta un punto verde (activo) o gris (pausado) junto a cada anuncio. Lo llena ads-sync.
alter table public.ads_meta add column if not exists estado text;
