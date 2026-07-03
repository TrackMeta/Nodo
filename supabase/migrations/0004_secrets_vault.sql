-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0004 — Secretos por canal vía Supabase Vault
-- Los tokens de Meta/CAPI/Telegram se guardan CIFRADOS en Vault.
-- Solo las Edge Functions (service_role) pueden descifrarlos.
-- ═══════════════════════════════════════════════════════════════════

-- Vault ya viene habilitado en Supabase (extensión supabase_vault).
create extension if not exists supabase_vault with schema vault;

-- ── Lectura: devuelve los secretos descifrados de un canal ─────────
-- SECURITY DEFINER (owner = postgres) para poder leer vault.decrypted_secrets.
create or replace function get_channel_secrets(p_channel_id uuid)
returns table (
  access_token       text,
  app_secret         text,
  capi_token         text,
  telegram_bot_token text
)
language sql
security definer
set search_path = public, vault
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where id = cs.access_token_id),
    (select decrypted_secret from vault.decrypted_secrets where id = cs.app_secret_id),
    (select decrypted_secret from vault.decrypted_secrets where id = cs.capi_token_id),
    (select decrypted_secret from vault.decrypted_secrets where id = cs.telegram_bot_token_id)
  from channel_secrets cs
  where cs.channel_id = p_channel_id;
$$;

-- Nadie desde el cliente puede invocarla; solo las Edge Functions (service_role).
revoke all on function get_channel_secrets(uuid) from anon, authenticated, public;
grant execute on function get_channel_secrets(uuid) to service_role;

-- ── Escritura: helper para dar de alta / actualizar los secretos ───
-- Crea (o reemplaza) los secretos en Vault y enlaza el canal.
-- Ejecutar con service_role (ej. desde el SQL Editor de Supabase).
create or replace function set_channel_secrets(
  p_channel_id         uuid,
  p_access_token       text,
  p_app_secret         text,
  p_capi_token         text default null,
  p_telegram_bot_token text default null
) returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_access uuid;
  v_app    uuid;
  v_capi   uuid;
  v_tg     uuid;
begin
  v_access := vault.create_secret(p_access_token, 'ch_' || p_channel_id || '_access_token', 'Nodo access token');
  v_app    := vault.create_secret(p_app_secret,   'ch_' || p_channel_id || '_app_secret',   'Nodo app secret');
  if p_capi_token is not null then
    v_capi := vault.create_secret(p_capi_token, 'ch_' || p_channel_id || '_capi_token', 'Nodo CAPI token');
  end if;
  if p_telegram_bot_token is not null then
    v_tg := vault.create_secret(p_telegram_bot_token, 'ch_' || p_channel_id || '_tg_bot', 'Nodo Telegram bot');
  end if;

  insert into channel_secrets (channel_id, access_token_id, app_secret_id, capi_token_id, telegram_bot_token_id)
  values (p_channel_id, v_access, v_app, v_capi, v_tg)
  on conflict (channel_id) do update set
    access_token_id = excluded.access_token_id,
    app_secret_id   = excluded.app_secret_id,
    capi_token_id   = coalesce(excluded.capi_token_id, channel_secrets.capi_token_id),
    telegram_bot_token_id = coalesce(excluded.telegram_bot_token_id, channel_secrets.telegram_bot_token_id);
end;
$$;

revoke all on function set_channel_secrets(uuid, text, text, text, text) from anon, authenticated, public;
grant execute on function set_channel_secrets(uuid, text, text, text, text) to service_role;
