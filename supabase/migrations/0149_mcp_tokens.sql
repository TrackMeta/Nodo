-- 0149 · MCP de Nodo (16-nov-2026, Rodrigo: «es posible crear un MCP de Nodo?» → «dale, constrúyelo todo»).
-- Cada usuario genera en Conexiones → MCP un ENLACE PERSONAL (https://…/functions/v1/mcp/<llave>) para pegarlo en
-- Claude o ChatGPT como conector. La función `mcp` busca la llave, sabe quién es y solo le deja ver/tocar los bots de
-- SUS equipos (como el panel). La llave se guarda solo como hash (sha256): si se filtra la base, no sirve.

create table if not exists mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null default 'Mi IA',
  token_hash text not null unique,
  prefijo text not null,                 -- los primeros caracteres, para reconocerla en la lista
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists mcp_tokens_user on mcp_tokens(user_id);
alter table mcp_tokens enable row level security;
drop policy if exists mcp_tokens_sel on mcp_tokens;
create policy mcp_tokens_sel on mcp_tokens for select using (user_id = auth.uid());
revoke insert, update, delete on mcp_tokens from authenticated, anon;
grant select (id, nombre, prefijo, created_at, last_used_at, revoked_at, user_id) on mcp_tokens to authenticated;

-- Crea una llave y la devuelve UNA sola vez (después solo queda el hash).
create or replace function mcp_token_crear(p_nombre text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare yo uuid := auth.uid(); tok text;
begin
  if yo is null then raise exception 'sin_sesion'; end if;
  if (select count(*) from mcp_tokens where user_id = yo and revoked_at is null) >= 5 then
    raise exception 'demasiadas_llaves';
  end if;
  tok := 'nodo_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into mcp_tokens (user_id, nombre, token_hash, prefijo)
    values (yo, coalesce(nullif(trim(p_nombre), ''), 'Mi IA'), encode(extensions.digest(tok, 'sha256'), 'hex'), left(tok, 11));
  return tok;
end $$;

create or replace function mcp_token_revocar(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update mcp_tokens set revoked_at = now() where id = p_id and user_id = auth.uid() and revoked_at is null;
  return found;
end $$;

revoke all on function mcp_token_crear(text) from public, anon;
revoke all on function mcp_token_revocar(uuid) from public, anon;
grant execute on function mcp_token_crear(text) to authenticated;
grant execute on function mcp_token_revocar(uuid) to authenticated;
