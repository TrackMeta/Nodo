-- ═══════════════════════════════════════════════════════════════════
-- 0131 · Guardar la clave de IA aunque el secreto viejo ya no exista
--
-- Medido el 8-oct en Guía Experta: channel_ai tenía una fila cuyo key_id apuntaba a un secreto
-- de Vault que ya no estaba. set_channel_ai veía la fila, llamaba a vault.update_secret sobre un
-- id inexistente —que no falla, simplemente no hace nada— y el panel decía «guardado» mientras
-- el bot seguía con «IA no configurada en este canal» y pasaba todo a humano.
-- Ahora, si el key_id no existe en Vault, se crea un secreto nuevo y se re-apunta la fila.
-- ═══════════════════════════════════════════════════════════════════
create or replace function set_channel_ai(
  p_channel_id uuid,
  p_provider   text,
  p_key        text default null,
  p_model      text default null
) returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_id uuid;
begin
  if p_provider not in ('anthropic', 'openai') then
    raise exception 'proveedor inválido: %', p_provider;
  end if;

  select key_id into v_id from channel_ai
  where channel_id = p_channel_id and provider = p_provider;

  -- 🩹 Fila con secreto huérfano: se trata como si no tuviera clave.
  if v_id is not null and not exists (select 1 from vault.secrets where id = v_id) then
    if p_key is null or length(trim(p_key)) = 0 then
      raise exception 'la clave guardada se perdió: vuelve a pegar la API key';
    end if;
    v_id := vault.create_secret(
      p_key, 'ch_' || p_channel_id || '_ai_' || p_provider || '_' || extract(epoch from now())::bigint,
      'Nodo AI key ' || p_provider);
    update channel_ai set key_id = v_id, model = coalesce(p_model, model), updated_at = now()
    where channel_id = p_channel_id and provider = p_provider;
    return;
  end if;

  if v_id is null then
    if p_key is null or length(trim(p_key)) = 0 then
      raise exception 'se requiere API key para configurar el proveedor';
    end if;
    v_id := vault.create_secret(
      p_key, 'ch_' || p_channel_id || '_ai_' || p_provider, 'Nodo AI key ' || p_provider);
    insert into channel_ai (channel_id, provider, key_id, model)
    values (p_channel_id, p_provider, v_id, p_model);
  else
    if p_key is not null and length(trim(p_key)) > 0 then
      perform vault.update_secret(v_id, p_key);
    end if;
    update channel_ai set
      model = coalesce(p_model, model),
      updated_at = now()
    where channel_id = p_channel_id and provider = p_provider;
  end if;
end;
$$;

revoke all on function set_channel_ai(uuid, text, text, text) from anon, authenticated, public;
grant execute on function set_channel_ai(uuid, text, text, text) to service_role;
