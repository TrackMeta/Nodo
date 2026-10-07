-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0130 — la bitácora de pg_cron se limpia sola (7 días).
--
-- 7-oct: cron.job_run_details ocupaba 63 MB de los 112 MB de la base (56 %): 139.000 filas desde julio,
-- ~1.500 por día (nodo-scheduler corre cada minuto) y nada las borraba. Nodo no la lee en ningún sitio
-- (ni el motor, ni el panel, ni los reportes): solo sirve para mirar si una tarea falló hace poco.
-- Se guardan los últimos 7 días. Es una sola tabla para todo el proyecto (todos los bots y cuentas).
-- 09:29 UTC = 04:29 en Lima, después de media-gc y notificaciones-gc.
-- ═══════════════════════════════════════════════════════════════════

select cron.unschedule('nodo-cron-bitacora-gc')
 where exists (select 1 from cron.job where jobname = 'nodo-cron-bitacora-gc');

select cron.schedule('nodo-cron-bitacora-gc', '29 9 * * *', $cmd$
  delete from cron.job_run_details where end_time < now() - interval '7 days';
$cmd$);

-- La primera limpieza, ahora.
delete from cron.job_run_details where end_time < now() - interval '7 days';
