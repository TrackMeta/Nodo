-- 0139 · Clics en el ENLACE por anuncio y día (25-oct).
-- Rendimiento calculaba el CTR y el CPC con `clicks` de Meta = clics de TODO tipo (likes, comentarios, perfil,
-- «ver más», agrandar el video): CTR 3.45 % contra el ~1 % del Administrador de anuncios, que por defecto muestra el
-- CTR de clics en el enlace (inline_link_clicks). Se guarda aparte; las filas viejas quedan en null (= sin dato) y la
-- ventana móvil de 30 días de ads-sync las vuelve a llenar.
alter table public.ads_insights add column if not exists clics_link bigint;
