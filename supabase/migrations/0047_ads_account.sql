-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0047 — Conexión de la cuenta de anuncios (Meta Ads)
-- Para la sección "Rendimiento" (CPA real / ganancia neta): guarda el ID
-- de la cuenta publicitaria (act_...). El token con permiso ads_read va al
-- Vault como secreto del canal (kind = 'ads_token'), igual que capi_token —
-- no se guarda en claro. La sincronización (ads-sync) lo usa para bajar el
-- gasto y las métricas de entrega por anuncio desde la Marketing API.
-- ═══════════════════════════════════════════════════════════════════
alter table channels add column if not exists ad_account_id text;
