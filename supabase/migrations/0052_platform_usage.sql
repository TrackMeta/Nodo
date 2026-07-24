-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0052 — Uso de plataforma (vista del DUEÑO)
--
-- Da al dueño de la plataforma una lectura del espacio que ocupa Nodo en
-- Supabase (tamaño de la base + almacenamiento), AGREGADO de todas las
-- cuentas. Es información global, así que NINGÚN cliente-inquilino puede
-- verla: `owner_usage()` levanta excepción si el caller no está en
-- `platform_admins`.
--
-- Nota: el consumo de red (egress) y las ejecuciones de Edge Functions no
-- son consultables por SQL (viven en la facturación de Supabase); esta
-- función expone SOLO lo que sí se puede medir desde la base.
-- ═══════════════════════════════════════════════════════════════════

-- ── platform_admins: dueños de la plataforma ────────────────────────
create table if not exists platform_admins (
  user_id    uuid primary key references app_users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security;
drop policy if exists padm_self on platform_admins;
-- Cada quien solo ve su propia fila (evita enumerar quién es dueño).
create policy padm_self on platform_admins for select using (user_id = auth.uid());

-- Semilla: Rodrigo (único dueño hoy). Idempotente.
insert into platform_admins(user_id)
  values ('2acbba95-df49-49e7-a6d0-a6ce2342d5cc')
  on conflict (user_id) do nothing;

-- ── owner_usage(): uso agregado, solo para dueños ───────────────────
create or replace function public.owner_usage()
returns json
language plpgsql
security definer
set search_path = public, storage
as $fn$
declare
  is_owner boolean;
  db_bytes bigint;
  st_bytes bigint;
  st_files bigint;
begin
  select exists(select 1 from platform_admins where user_id = auth.uid()) into is_owner;
  if not coalesce(is_owner, false) then
    raise exception 'no_autorizado';
  end if;
  db_bytes := pg_database_size(current_database());
  select coalesce(sum((metadata->>'size')::bigint), 0), count(*)
    into st_bytes, st_files
    from storage.objects;
  return json_build_object(
    'db_bytes',      db_bytes,
    'storage_bytes', st_bytes,
    'storage_files', st_files,
    'measured_at',   now()
  );
end;
$fn$;

revoke all on function public.owner_usage() from public, anon;
grant execute on function public.owner_usage() to authenticated;
