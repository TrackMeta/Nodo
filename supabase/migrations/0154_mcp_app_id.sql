-- 0154 · MCP: Nodo recuerda el «ID de la aplicación» de ChatGPT de cada enlace (17-nov-2026, Rodrigo: «haz los 4»).
-- El complemento .zip de ChatGPT se vincula a la conexión que el cliente creó con su enlace (ID asdk_app_…, que ChatGPT
-- NO manda al conectarse: medido el 17-nov). El cliente lo pega una vez; queda guardado para volver a descargar el .zip
-- desde la lista sin pegarlo de nuevo. No es secreto (sin la conexión de esa cuenta no sirve), pero solo lo ve su dueño.

alter table mcp_tokens add column if not exists app_id text;
grant select (app_id) on mcp_tokens to authenticated;

create or replace function mcp_token_app(p_id uuid, p_app text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sin_sesion'; end if;
  if p_app is not null and p_app !~ '^asdk_app_[A-Za-z0-9]+$' or p_app ~ '^asdk_app_v_' then
    raise exception 'id_invalido';
  end if;
  update mcp_tokens set app_id = p_app where id = p_id and user_id = auth.uid() and revoked_at is null;
  return found;
end $$;

revoke all on function mcp_token_app(uuid, text) from public, anon;
grant execute on function mcp_token_app(uuid, text) to authenticated;
