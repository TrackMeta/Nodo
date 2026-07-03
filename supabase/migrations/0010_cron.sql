-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0010 — Cron del scheduler (Fase 4: automatización)
-- Programa una llamada cada minuto a la Edge Function `scheduler`, que
-- despierta los nodos Esperar y dispara las secuencias de remarketing.
-- pg_cron + pg_net vienen disponibles en Supabase.
-- ═══════════════════════════════════════════════════════════════════
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Programa (o reprograma) el tick del scheduler.
-- Uso (una sola vez, desde el SQL Editor):
--   select schedule_nodo_scheduler(
--     'https://ahoxdyffbwjlshmdezwi.supabase.co/functions/v1/scheduler',
--     'TU_SECRETO'   -- el mismo valor que pongas en SCHEDULER_SECRET
--   );
create or replace function schedule_nodo_scheduler(p_url text, p_secret text)
returns void
language plpgsql
security definer
set search_path = public, extensions, cron, net
as $$
begin
  if exists (select 1 from cron.job where jobname = 'nodo-scheduler') then
    perform cron.unschedule('nodo-scheduler');
  end if;
  perform cron.schedule('nodo-scheduler', '* * * * *', format($cron$
    select net.http_post(
      url     := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-scheduler-secret', %L),
      body    := '{}'::jsonb
    );
  $cron$, p_url, p_secret));
end;
$$;

-- Para detener el scheduler:
--   select cron.unschedule('nodo-scheduler');
