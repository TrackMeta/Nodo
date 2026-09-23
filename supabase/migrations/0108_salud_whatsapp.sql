-- ══════════════════════════════════════════════════════
-- Nodo · 0108 — Aviso de salud del número de WhatsApp
--
-- Meta avisa por webhook cuando banea, restringe o marca la calidad del número (account_update,
-- phone_number_quality_update, account_alerts…). channel-config ya suscribía esos campos, pero
-- el webhook los descartaba: te podían banear y Nodo no decía nada.
--
-- wa_alerta   → el aviso vigente {nivel, texto, origen, at}; el panel lo muestra en rojo arriba.
-- wa_salud_at → cuándo el scheduler le preguntó a Meta por última vez (sondeo cada 3 h).
--
-- Grant de columna: la 0073 revocó el SELECT de tabla sobre channels; toda columna nueva nace
-- invisible para el panel hasta su grant (lección de la 0090 y la 0093).
-- ══════════════════════════════════════════════════════

alter table public.channels add column if not exists wa_alerta jsonb;
--##--
alter table public.channels add column if not exists wa_salud_at timestamptz;
--##--
grant select (wa_alerta, wa_salud_at) on public.channels to authenticated, anon;
