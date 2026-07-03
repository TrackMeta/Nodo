-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0007 — Proveedores de IA por canal (Claude / ChatGPT)
-- Cada canal configura su propia API key de IA (aislado como BM/Pixel).
-- La key se guarda CIFRADA en Vault; el panel solo ve metadatos
-- (proveedor, modelo, si está configurada) — nunca la key en claro.
-- ═══════════════════════════════════════════════════════════════════

-- Proveedor de IA por defecto del canal (el que usan los nodos IA si no
-- especifican otro). null = IA deshabilitada en ese canal.
alter table channels add column if not exists ia_provider text
  check (ia_provider in ('anthropic', 'openai'));

-- ── Config de IA por canal y proveedor ─────────────────────────────
-- Una fila por (canal, proveedor). Existir = ese proveedor está configurado.
-- key_id apunta al secreto en Vault (inútil sin service_role para descifrar).
create table if not exists channel_ai (
  channel_id uuid not null references channels(id) on delete cascade,
  provider   text not null check (provider in ('anthropic', 'openai')),
  key_id     uuid not null,               -- ref al secreto en Vault
  model      text,                        -- modelo por defecto del proveedor
  updated_at timestamptz not null default now(),
  primary key (channel_id, provider)
);

alter table channel_ai enable row level security;

-- Los miembros pueden LEER los metadatos (para la pantalla Configuraciones).
-- La escritura de la key va por Edge Function (service_role bypassa RLS).
drop policy if exists channel_ai_select on channel_ai;
create policy channel_ai_select on channel_ai
  for select using (is_member());

-- ── Lectura: devuelve la key descifrada del proveedor activo ───────
-- Si p_provider es null, usa channels.ia_provider (el proveedor por defecto).
create or replace function get_channel_ai_active(
  p_channel_id uuid,
  p_provider   text default null
) returns table (provider text, api_key text, model text)
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_prov text;
begin
  v_prov := coalesce(p_provider, (select ia_provider from channels where id = p_channel_id));
  if v_prov is null then return; end if;
  return query
    select ca.provider,
           (select decrypted_secret from vault.decrypted_secrets where id = ca.key_id),
           ca.model
    from channel_ai ca
    where ca.channel_id = p_channel_id and ca.provider = v_prov;
end;
$$;

revoke all on function get_channel_ai_active(uuid, text) from anon, authenticated, public;
grant execute on function get_channel_ai_active(uuid, text) to service_role;

-- ── Escritura: crea/actualiza la key y el modelo de un proveedor ───
-- Reutiliza el secreto de Vault si ya existe (sin dejar huérfanos).
-- Si p_key es null/vacío y ya hay fila, solo actualiza el modelo.
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

-- ── Baja: elimina la configuración de un proveedor en un canal ─────
create or replace function delete_channel_ai(
  p_channel_id uuid,
  p_provider   text
) returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_id uuid;
begin
  select key_id into v_id from channel_ai
  where channel_id = p_channel_id and provider = p_provider;
  if v_id is not null then
    delete from vault.secrets where id = v_id;
    delete from channel_ai where channel_id = p_channel_id and provider = p_provider;
    -- Si era el proveedor por defecto, deshabilitar IA del canal.
    update channels set ia_provider = null
    where id = p_channel_id and ia_provider = p_provider;
  end if;
end;
$$;

revoke all on function delete_channel_ai(uuid, text) from anon, authenticated, public;
grant execute on function delete_channel_ai(uuid, text) to service_role;
