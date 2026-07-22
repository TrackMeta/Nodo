-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0049 — ads-sync configurable + aviso de token inválido
--   · schedule_nodo_ads_sync ahora acepta la frecuencia (cron) como
--     parámetro → el panel la cambia (1h/3h/6h/12h) vía la función
--     ads-schedule (que tiene el SCHEDULER_SECRET en su env).
--   · ads_sync_cron() / unschedule → leer y apagar el cron.
--   · channels.ads_sync_error / ads_sync_at → si el token deja de servir,
--     ads-sync lo anota y el panel avisa "reconecta tu token".
-- ═══════════════════════════════════════════════════════════════════
alter table channels add column if not exists ads_sync_error text;
alter table channels add column if not exists ads_sync_at    timestamptz;

-- La frecuencia (cron) pasa a ser parámetro. Cambia la firma → drop + create.
drop function if exists schedule_nodo_ads_sync(text, text);
create or replace function schedule_nodo_ads_sync(p_url text, p_secret text, p_cron text default '17 */3 * * *')
returns void language plpgsql security definer set search_path = public, extensions, cron, net as $fn$
begin
  if exists (select 1 from cron.job where jobname = 'nodo-ads-sync') then
    perform cron.unschedule('nodo-ads-sync');
  end if;
  perform cron.schedule('nodo-ads-sync', p_cron, format($cron$
    select net.http_post(
      url     := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-scheduler-secret', %L),
      body    := '{}'::jsonb
    );
  $cron$, p_url, p_secret));
end;
$fn$;
revoke all on function schedule_nodo_ads_sync(text, text, text) from anon, authenticated, public;
grant execute on function schedule_nodo_ads_sync(text, text, text) to service_role;

create or replace function unschedule_nodo_ads_sync()
returns void language plpgsql security definer set search_path = public, cron as $fn$
begin
  if exists (select 1 from cron.job where jobname = 'nodo-ads-sync') then
    perform cron.unschedule('nodo-ads-sync');
  end if;
end;
$fn$;
revoke all on function unschedule_nodo_ads_sync() from anon, authenticated, public;
grant execute on function unschedule_nodo_ads_sync() to service_role;

-- Lee el cron actual (para que el panel muestre la frecuencia elegida).
create or replace function ads_sync_cron()
returns text language sql security definer set search_path = public, cron as $fn$
  select schedule from cron.job where jobname = 'nodo-ads-sync' limit 1;
$fn$;
revoke all on function ads_sync_cron() from anon, authenticated, public;
grant execute on function ads_sync_cron() to service_role;
