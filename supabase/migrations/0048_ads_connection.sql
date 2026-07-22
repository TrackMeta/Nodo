-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0048 — Conexión Meta Ads (para la sección Rendimiento)
--   · ad_accounts: VARIAS cuentas publicitarias por canal (un token de
--     usuario de sistema puede leer varias; acá listas las que sigues).
--   · ads_token: secreto en Vault (permiso ads_read), mismo patrón que
--     capi_token — se agrega a las 3 funciones de secretos.
--   · ads_meta / ads_insights: donde ads-sync escribe lo que baja de la
--     Marketing API (jerarquía+nombres y métricas de entrega por día).
-- Las tablas de datos las escribe ads-sync con service_role; el panel solo
-- lee. Las cuentas (ad_accounts) sí las administra el usuario desde Ajustes.
-- ═══════════════════════════════════════════════════════════════════

-- (1) Cuentas publicitarias del canal ────────────────────────────────
create table if not exists ad_accounts (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references channels(id) on delete cascade,
  account_id  text not null,                       -- act_...
  nombre      text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (channel_id, account_id)
);
create index if not exists idx_ad_accounts_channel on ad_accounts(channel_id);
alter table ad_accounts enable row level security;
drop policy if exists ad_accounts_tenant on ad_accounts;
create policy ad_accounts_tenant on ad_accounts
  for all using (owns_channel(channel_id)) with check (owns_channel(channel_id));

-- (2) Secreto del token ads_read en Vault ────────────────────────────
alter table channel_secrets add column if not exists ads_token_id uuid;

-- (3) Datos que baja ads-sync (solo lectura para el panel) ────────────
create table if not exists ads_meta (
  channel_id    uuid not null references channels(id) on delete cascade,
  account_id    text not null,
  ad_id         text not null,
  ad_name       text,
  adset_id      text, adset_name text,
  campaign_id   text, campaign_name text,
  updated_at    timestamptz not null default now(),
  primary key (channel_id, ad_id)
);
alter table ads_meta enable row level security;
drop policy if exists ads_meta_read on ads_meta;
create policy ads_meta_read on ads_meta for select using (owns_channel(channel_id));

create table if not exists ads_insights (
  channel_id   uuid not null references channels(id) on delete cascade,
  ad_id        text not null,
  fecha        date not null,
  gasto        numeric not null default 0,
  impresiones  bigint  not null default 0,
  alcance      bigint  not null default 0,
  clics        bigint  not null default 0,
  clics_wa     bigint  not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (channel_id, ad_id, fecha)
);
create index if not exists idx_ads_insights_scan on ads_insights(channel_id, fecha);
alter table ads_insights enable row level security;
drop policy if exists ads_insights_read on ads_insights;
create policy ads_insights_read on ads_insights for select using (owns_channel(channel_id));

-- (4) Las 3 funciones de secretos aprenden 'ads_token' ────────────────
create or replace function set_channel_secret(p_channel_id uuid, p_kind text, p_value text)
returns void language plpgsql security definer set search_path = public, vault as $fn$
declare v_id uuid;
begin
  if p_kind not in ('access_token','app_secret','capi_token','telegram_bot_token','ads_token') then
    raise exception 'tipo de secreto inválido: %', p_kind;
  end if;
  if p_value is null or length(trim(p_value)) = 0 then raise exception 'valor vacío'; end if;
  insert into channel_secrets (channel_id) values (p_channel_id) on conflict (channel_id) do nothing;
  execute format('select %I from channel_secrets where channel_id = $1', p_kind || '_id') into v_id using p_channel_id;
  if v_id is null then
    v_id := vault.create_secret(p_value, 'ch_' || p_channel_id || '_' || p_kind, 'Nodo ' || p_kind);
  else
    perform vault.update_secret(v_id, p_value);
  end if;
  execute format('update channel_secrets set %I = $1 where channel_id = $2', p_kind || '_id') using v_id, p_channel_id;
end;
$fn$;

create or replace function channel_secrets_status(p_channel_id uuid)
returns table (access_token boolean, app_secret boolean, capi_token boolean, telegram_bot_token boolean, ads_token boolean)
language sql security definer set search_path = public as $fn$
  select
    cs.access_token_id is not null,
    cs.app_secret_id is not null,
    cs.capi_token_id is not null,
    cs.telegram_bot_token_id is not null,
    cs.ads_token_id is not null
  from channel_secrets cs where cs.channel_id = p_channel_id;
$fn$;

create or replace function get_channel_secrets(p_channel_id uuid)
returns table (access_token text, app_secret text, capi_token text, telegram_bot_token text, ads_token text)
language sql security definer set search_path = public, vault as $fn$
  select
    (select decrypted_secret from vault.decrypted_secrets where id = cs.access_token_id),
    (select decrypted_secret from vault.decrypted_secrets where id = cs.app_secret_id),
    (select decrypted_secret from vault.decrypted_secrets where id = cs.capi_token_id),
    (select decrypted_secret from vault.decrypted_secrets where id = cs.telegram_bot_token_id),
    (select decrypted_secret from vault.decrypted_secrets where id = cs.ads_token_id)
  from channel_secrets cs where cs.channel_id = p_channel_id;
$fn$;
revoke all on function get_channel_secrets(uuid) from anon, authenticated, public;
grant execute on function get_channel_secrets(uuid) to service_role;
revoke all on function set_channel_secret(uuid, text, text) from anon, authenticated, public;
grant execute on function set_channel_secret(uuid, text, text) to service_role;
revoke all on function channel_secrets_status(uuid) from anon, authenticated, public;
grant execute on function channel_secrets_status(uuid) to service_role;

-- (5) Cron de ads-sync (cada 3 h). Se programa una vez cuando haya token:
--   select schedule_nodo_ads_sync(
--     'https://ahoxdyffbwjlshmdezwi.supabase.co/functions/v1/ads-sync',
--     'EL_MISMO_SCHEDULER_SECRET');
create or replace function schedule_nodo_ads_sync(p_url text, p_secret text)
returns void language plpgsql security definer set search_path = public, extensions, cron, net as $fn$
begin
  if exists (select 1 from cron.job where jobname = 'nodo-ads-sync') then
    perform cron.unschedule('nodo-ads-sync');
  end if;
  perform cron.schedule('nodo-ads-sync', '17 */3 * * *', format($cron$
    select net.http_post(
      url     := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-scheduler-secret', %L),
      body    := '{}'::jsonb
    );
  $cron$, p_url, p_secret));
end;
$fn$;
revoke all on function schedule_nodo_ads_sync(text, text) from anon, authenticated, public;
grant execute on function schedule_nodo_ads_sync(text, text) to service_role;
