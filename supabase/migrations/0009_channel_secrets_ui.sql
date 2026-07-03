-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0009 — Gestión granular de secretos de canal desde el panel
-- Permite configurar cada secreto (token WhatsApp, app secret, token CAPI,
-- bot de Telegram) de forma independiente desde ⚙️ Configuraciones.
-- Los valores van cifrados a Vault; el panel solo ve "configurado ✓".
-- ═══════════════════════════════════════════════════════════════════

-- Un canal puede tener solo Telegram/CAPI configurado sin los tokens de
-- WhatsApp todavía (p.ej. antes de conectar el número real). Relajamos
-- los NOT NULL para poder guardar secretos parciales.
alter table channel_secrets alter column access_token_id drop not null;
alter table channel_secrets alter column app_secret_id   drop not null;

-- Crea/actualiza UN secreto del canal (reutiliza el de Vault si existe).
create or replace function set_channel_secret(
  p_channel_id uuid,
  p_kind       text,   -- access_token | app_secret | capi_token | telegram_bot_token
  p_value      text
) returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_id uuid;
begin
  if p_kind not in ('access_token','app_secret','capi_token','telegram_bot_token') then
    raise exception 'tipo de secreto inválido: %', p_kind;
  end if;
  if p_value is null or length(trim(p_value)) = 0 then
    raise exception 'valor vacío';
  end if;

  insert into channel_secrets (channel_id) values (p_channel_id)
    on conflict (channel_id) do nothing;

  execute format('select %I from channel_secrets where channel_id = $1', p_kind || '_id')
    into v_id using p_channel_id;

  if v_id is null then
    v_id := vault.create_secret(p_value, 'ch_' || p_channel_id || '_' || p_kind, 'Nodo ' || p_kind);
  else
    perform vault.update_secret(v_id, p_value);
  end if;

  execute format('update channel_secrets set %I = $1 where channel_id = $2', p_kind || '_id')
    using v_id, p_channel_id;
end;
$$;

revoke all on function set_channel_secret(uuid, text, text) from anon, authenticated, public;
grant execute on function set_channel_secret(uuid, text, text) to service_role;

-- Devuelve qué secretos están configurados (booleanos), sin exponer valores.
create or replace function channel_secrets_status(p_channel_id uuid)
returns table (access_token boolean, app_secret boolean, capi_token boolean, telegram_bot_token boolean)
language sql
security definer
set search_path = public
as $$
  select
    cs.access_token_id is not null,
    cs.app_secret_id   is not null,
    cs.capi_token_id   is not null,
    cs.telegram_bot_token_id is not null
  from channel_secrets cs
  where cs.channel_id = p_channel_id;
$$;

revoke all on function channel_secrets_status(uuid) from anon, authenticated, public;
grant execute on function channel_secrets_status(uuid) to service_role;
