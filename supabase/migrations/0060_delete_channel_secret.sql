-- Nodo · Poder BORRAR un secreto del canal (para "Desconectar número").
-- Hasta ahora solo existía set_channel_secret (crear/sobrescribir); no había
-- forma de quitar el token del Vault. Esto quita la referencia en
-- channel_secrets y elimina el secreto del Vault. Idempotente (si no hay, no-op).
create or replace function delete_channel_secret(p_channel_id uuid, p_kind text)
returns void language plpgsql security definer set search_path = public, vault as $fn$
declare v_id uuid;
begin
  if p_kind not in ('access_token','app_secret','capi_token','telegram_bot_token','ads_token') then
    raise exception 'tipo de secreto inválido: %', p_kind;
  end if;
  execute format('select %I from channel_secrets where channel_id = $1', p_kind || '_id') into v_id using p_channel_id;
  if v_id is not null then
    execute format('update channel_secrets set %I = null where channel_id = $1', p_kind || '_id') using p_channel_id;
    delete from vault.secrets where id = v_id;
  end if;
end;
$fn$;
revoke all on function delete_channel_secret(uuid, text) from anon, authenticated, public;
grant execute on function delete_channel_secret(uuid, text) to service_role;
