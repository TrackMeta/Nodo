-- Respuestas rápidas con color identificador (como etiquetas) y multimedia
-- adjunta (imágenes/videos/archivos que el operador envía junto al texto).
alter table quick_replies add column if not exists color text;
alter table quick_replies add column if not exists media jsonb;
