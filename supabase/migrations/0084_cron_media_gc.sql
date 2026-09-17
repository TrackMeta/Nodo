-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0084 — el recolector de archivos corre solo, de madrugada.
--
-- 09:17 UTC = 04:17 en Lima: a esa hora no hay nadie escribiendo un pie de foto
-- ni un cliente mandando comprobantes, así que la ventana de 24 h de gracia no
-- le quita el archivo a nadie de las manos.
--
-- Con 24 h de gracia, `media-gc` resuelve de una sola pasada las tres fugas:
--   · media de chats, contactos y productos ya borrados (nadie borraba el archivo),
--   · lo que el operador subió al elegirlo y decidió no enviar,
--   · lo que dejan las corridas de prueba.
-- No hace falta un trigger por tabla: el criterio no es "quién lo borró" sino
-- "ya nadie lo nombra", que es más difícil de dejar incompleto.
--
-- Diario y no cada hora a propósito: es una pasada por todas las tablas con
-- URLs, y el bucket no crece tan rápido como para necesitar más.
-- ═══════════════════════════════════════════════════════════════════

select cron.unschedule('nodo-media-gc')
 where exists (select 1 from cron.job where jobname = 'nodo-media-gc');

select cron.schedule('nodo-media-gc', '17 9 * * *', $cmd$
    select net.http_post(
      url     := 'https://ahoxdyffbwjlshmdezwi.supabase.co/functions/v1/media-gc',
      -- ⛔ NUNCA el secreto real acá: el repo es público. Ese valor se pega a mano en el SQL
      -- editor (o se rota con `supabase secrets set` + update de cron.job). El que estuvo
      -- versionado hasta el 2026-09-17 se rotó ese mismo día.
      headers := jsonb_build_object('Content-Type','application/json','x-scheduler-secret', '<PEGAR_SCHEDULER_SECRET_A_MANO>'),
      body    := '{"horas":24}'::jsonb,
      timeout_milliseconds := 55000
    );
  $cmd$);
