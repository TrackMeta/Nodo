-- 0150 · MCP: poder VER el enlace otra vez (16-nov-2026, Rodrigo: «¿no se puede ver el link que se había creado?» →
-- se le explicó que solo se guardaba la huella y eligió «sí, cámbialo»).
-- Ahora la llave también se guarda CIFRADA en Vault (como las claves de IA de channel_ai), y solo su dueño puede
-- leerla con mcp_token_ver. La función `mcp` sigue validando por la huella (token_hash): esto es solo para mostrarla.
-- Las llaves creadas antes de esta migración no tienen copia: esas no se pueden ver (hay que crear otra).

alter table mcp_tokens add column if not exists secret_id uuid;   -- vault.secrets.id (NO se le da select a nadie)

create or replace function mcp_token_crear(p_nombre text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare yo uuid := auth.uid(); tok text; v_id uuid; v_sec uuid;
begin
  if yo is null then raise exception 'sin_sesion'; end if;
  if (select count(*) from mcp_tokens where user_id = yo and revoked_at is null) >= 5 then
    raise exception 'demasiadas_llaves';
  end if;
  tok := 'nodo_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into mcp_tokens (user_id, nombre, token_hash, prefijo)
    values (yo, coalesce(nullif(trim(p_nombre), ''), 'Mi IA'), encode(extensions.digest(tok, 'sha256'), 'hex'), left(tok, 11))
    returning id into v_id;
  v_sec := vault.create_secret(tok, 'mcp_token_' || v_id, 'Nodo MCP: enlace personal');
  update mcp_tokens set secret_id = v_sec where id = v_id;
  return tok;
end $$;

-- Devuelve la llave de un enlace TUYO y activo (null si es de antes de 0150 y no tiene copia).
create or replace function mcp_token_ver(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_sec uuid; tok text;
begin
  if auth.uid() is null then raise exception 'sin_sesion'; end if;
  select secret_id into v_sec from mcp_tokens where id = p_id and user_id = auth.uid() and revoked_at is null;
  if v_sec is null then return null; end if;
  select decrypted_secret into tok from vault.decrypted_secrets where id = v_sec;
  return tok;
end $$;

-- Al desactivar, la copia cifrada se borra: un enlace desactivado no se puede volver a ver.
create or replace function mcp_token_revocar(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_sec uuid;
begin
  update mcp_tokens set revoked_at = now() where id = p_id and user_id = auth.uid() and revoked_at is null
    returning secret_id into v_sec;
  if not found then return false; end if;
  if v_sec is not null then
    delete from vault.secrets where id = v_sec;
    update mcp_tokens set secret_id = null where id = p_id;
  end if;
  return true;
end $$;

-- ¿Se puede ver? (para pintar el botón «Ver» sin exponer secret_id)
create or replace function mcp_tokens_visibles()
returns setof uuid language sql security definer set search_path = public as $$
  select id from mcp_tokens where user_id = auth.uid() and revoked_at is null and secret_id is not null;
$$;

revoke all on function mcp_token_ver(uuid) from public, anon;
revoke all on function mcp_tokens_visibles() from public, anon;
grant execute on function mcp_token_ver(uuid) to authenticated;
grant execute on function mcp_tokens_visibles() to authenticated;
