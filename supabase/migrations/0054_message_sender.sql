-- Quién envió cada mensaje SALIENTE: el bot (automático) o un humano (manual
-- desde el panel). sent_by_user = el app_user que lo mandó (si fue humano), para
-- poder pintar su perfil en el chat. Los mensajes viejos quedan en NULL y al
-- renderizar se tratan como "bot" (que es lo más común en el historial).
alter table messages add column if not exists sent_by text;         -- 'bot' | 'human'
alter table messages add column if not exists sent_by_user uuid;    -- app_users.id si fue humano
