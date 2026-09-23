-- ══════════════════════════════════════════════════════
-- Nodo · 0111 — De QUIÉN es cada chat de Telegram vinculado
--
-- telegram_chat_ids es una lista de ids sueltos: no se sabía de qué persona era cada uno. Al
-- quitar a alguien del equipo su Telegram seguía recibiendo los avisos y APROBANDO pagos, y en
-- Canales solo se veían números sin nombre. telegram_vinculos = { "<chat_id>": { uid, nombre, at } }.
-- ══════════════════════════════════════════════════════

alter table public.channels add column if not exists telegram_vinculos jsonb not null default '{}'::jsonb;
--##--
grant select (telegram_vinculos) on public.channels to authenticated, anon;
