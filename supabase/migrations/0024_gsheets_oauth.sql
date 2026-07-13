-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0024 — Google Sheets vía OAuth ("Acceder con Google")
-- Guarda el refresh_token de Google por canal CIFRADO en Vault (el panel
-- nunca lo ve). Tabla de estado (nonce) para asegurar el callback OAuth.
-- La conexión por Apps Script sigue existiendo (channels.gsheets.webhook_url);
-- OAuth añade channels.gsheets.mode='oauth' + spreadsheet_id/tab.
-- ═══════════════════════════════════════════════════════════════════

-- Estado temporal del login OAuth (CSRF): el nonce viaja en `state` a Google
-- y vuelve en el callback; así ligamos la respuesta al canal correcto.
create table if not exists gsheets_oauth_state (
  nonce      text primary key,
  channel_id uuid not null references channels(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table gsheets_oauth_state enable row level security;
-- Sin políticas: solo el service_role (Edge Functions) la toca.

-- Refresh token de Google por canal (en Vault; inútil sin service_role).
create table if not exists channel_gsheets (
  channel_id uuid primary key references channels(id) on delete cascade,
  key_id     uuid not null,               -- ref al secreto en Vault
  google_email text,                       -- correo con el que conectó (informativo)
  updated_at timestamptz not null default now()
);
alter table channel_gsheets enable row level security;
drop policy if exists channel_gsheets_select on channel_gsheets;
create policy channel_gsheets_select on channel_gsheets for select using (is_member());

-- Guardar/actualizar el refresh token (reutiliza el secreto de Vault si existe).
create or replace function set_gsheets_token(
  p_channel_id uuid, p_refresh_token text, p_email text default null
) returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  select key_id into v_id from channel_gsheets where channel_id = p_channel_id;
  if v_id is null then
    v_id := vault.create_secret(p_refresh_token, 'ch_' || p_channel_id || '_gsheets', 'Nodo GSheets refresh token');
    insert into channel_gsheets (channel_id, key_id, google_email) values (p_channel_id, v_id, p_email);
  else
    if p_refresh_token is not null and length(trim(p_refresh_token)) > 0 then
      perform vault.update_secret(v_id, p_refresh_token);
    end if;
    update channel_gsheets set google_email = coalesce(p_email, google_email), updated_at = now()
     where channel_id = p_channel_id;
  end if;
end $$;
revoke all on function set_gsheets_token(uuid, text, text) from anon, authenticated, public;
grant execute on function set_gsheets_token(uuid, text, text) to service_role;

-- Leer el refresh token descifrado (solo service_role).
create or replace function get_gsheets_token(p_channel_id uuid)
returns text language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid; v_tok text;
begin
  select key_id into v_id from channel_gsheets where channel_id = p_channel_id;
  if v_id is null then return null; end if;
  select decrypted_secret into v_tok from vault.decrypted_secrets where id = v_id;
  return v_tok;
end $$;
revoke all on function get_gsheets_token(uuid) from anon, authenticated, public;
grant execute on function get_gsheets_token(uuid) to service_role;

-- Baja: elimina el token del canal.
create or replace function delete_gsheets_token(p_channel_id uuid)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  select key_id into v_id from channel_gsheets where channel_id = p_channel_id;
  if v_id is not null then
    delete from vault.secrets where id = v_id;
    delete from channel_gsheets where channel_id = p_channel_id;
  end if;
end $$;
revoke all on function delete_gsheets_token(uuid) from anon, authenticated, public;
grant execute on function delete_gsheets_token(uuid) to service_role;
