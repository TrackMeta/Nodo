-- Nodo · 0112 — Por qué se detuvo una campaña. Antes se cerraba «Completada · Enviados 0 ·
-- Fallidos 0» (plantilla borrada, no aprobada, desactivada, variables que no calzan) y el motivo
-- solo quedaba en cada fila de campaign_sends, que el panel no lee.
alter table public.campaigns add column if not exists motivo text;
