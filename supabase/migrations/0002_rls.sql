-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0002 — RLS (Row Level Security)
-- Regla de oro: el frontend usa la anon key; los secretos jamás salen.
-- ═══════════════════════════════════════════════════════════════════

-- Helper: ¿el usuario autenticado es admin?
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_users
    where id = auth.uid() and role = 'admin' and activo = true
  );
$$;

-- Helper: ¿es un usuario interno activo (admin u operador)?
create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_users where id = auth.uid() and activo = true
  );
$$;

-- ── Activar RLS en todo ─────────────────────────────────────────────
alter table channels             enable row level security;
alter table channel_secrets      enable row level security;
alter table app_users            enable row level security;
alter table tags                 enable row level security;
alter table custom_fields        enable row level security;
alter table contacts             enable row level security;
alter table contact_tags         enable row level security;
alter table contact_field_values enable row level security;
alter table conversations        enable row level security;
alter table messages             enable row level security;

-- ── channel_secrets: SIN políticas ─────────────────────────────────
-- RLS activo + 0 políticas ⇒ inaccesible para anon/authenticated.
-- Solo el service_role (Edge Functions) lo lee, y bypassa RLS.

-- ── channels ────────────────────────────────────────────────────────
-- Miembros pueden LEER canales (para el selector). Config sensible
-- (tokens) vive en channel_secrets, no aquí. Escritura: solo admin.
create policy channels_select on channels for select
  using (is_member());
create policy channels_admin_all on channels for all
  using (is_admin()) with check (is_admin());

-- ── app_users ───────────────────────────────────────────────────────
-- Cada uno ve su propia fila; admin ve/gestiona todas.
create policy app_users_self on app_users for select
  using (id = auth.uid() or is_admin());
create policy app_users_admin_all on app_users for all
  using (is_admin()) with check (is_admin());

-- ── Contenido operable por cualquier miembro (lectura/escritura) ───
-- (En Fase 1 todos los miembros ven todos los canales; el aislamiento
--  por-usuario se refina en fases posteriores.)
create policy tags_member on tags for all
  using (is_member()) with check (is_member());
create policy custom_fields_member on custom_fields for all
  using (is_member()) with check (is_member());
create policy contacts_member on contacts for all
  using (is_member()) with check (is_member());
create policy contact_tags_member on contact_tags for all
  using (is_member()) with check (is_member());
create policy contact_field_values_member on contact_field_values for all
  using (is_member()) with check (is_member());
create policy conversations_member on conversations for all
  using (is_member()) with check (is_member());

-- ── messages ────────────────────────────────────────────────────────
-- Miembros LEEN todo. La escritura de salientes va por la Edge Function
-- whatsapp-send (service role), no por INSERT directo del cliente.
create policy messages_select on messages for select
  using (is_member());
create policy messages_admin_write on messages for all
  using (is_admin()) with check (is_admin());
