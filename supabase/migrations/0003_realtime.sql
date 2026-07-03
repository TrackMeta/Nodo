-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0003 — Realtime
-- El panel se suscribe a estos cambios para la bandeja en <5s.
-- (Las políticas RLS también aplican a Realtime: solo miembros reciben.)
-- ═══════════════════════════════════════════════════════════════════

alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table conversations;
alter publication supabase_realtime add table contacts;

-- REPLICA IDENTITY FULL para recibir la fila completa en updates
-- (necesario para actualizar estados delivered/read en el panel).
alter table messages       replica identity full;
alter table conversations  replica identity full;
alter table contacts       replica identity full;
