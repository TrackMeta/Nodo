-- Avisos de Telegram configurables por canal.
-- Forma: { "items": { "<clave>": { "on": bool, "texto": "..." } }, "hora": bool }
-- Vacío = todos encendidos con el texto por defecto del catálogo (avisos.ts).
alter table channels add column if not exists telegram_avisos jsonb;
