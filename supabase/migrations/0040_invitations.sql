-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0040 — Multi-tenant, Fase 4: onboarding por invitación
--
-- D2/D5 = por link de invitación: quien puede crear CUENTAS nuevas es un
-- "admin de plataforma" (Rodrigo), que mintea links de invitación de cuenta.
-- D6 = sumar equipo por código: el admin de una cuenta genera un código y el
-- nuevo miembro lo canjea. Ambos flujos SIN email (no dependen de SMTP).
--
-- Las invitaciones se gestionan por Edge Functions (service role) → RLS activa
-- sin políticas. Aplicar sentencia por sentencia (delimitador --##--).
-- ═══════════════════════════════════════════════════════════════════

-- Admin de plataforma: puede crear cuentas-cliente nuevas (mintear invites de
-- cuenta). Es un nivel POR ENCIMA del admin de cuenta.
alter table app_users add column if not exists platform_admin boolean not null default false;
--##--
-- Rodrigo = admin de plataforma (dueño de Nodo).
update app_users set platform_admin = true where id = '2acbba95-df49-49e7-a6d0-a6ce2342d5cc';
--##--
-- Invitaciones (link de cuenta / código de equipo).
create table if not exists invitations (
  id          uuid primary key default gen_random_uuid(),
  token       text unique not null,                              -- va en el link o se tipea
  kind        text not null,                                     -- 'new_account' | 'join_account'
  account_id  uuid references accounts(id) on delete cascade,    -- null si new_account
  role        user_role not null default 'operador',             -- rol al aceptar (join_account)
  nombre_sugerido text,                                          -- nombre de cuenta sugerido (informativo)
  created_by  uuid references app_users(id) on delete set null,
  expires_at  timestamptz not null default (now() + interval '14 days'),
  used_at     timestamptz,
  used_by     uuid references app_users(id) on delete set null,
  created_at  timestamptz not null default now()
);
--##--
create index if not exists idx_invitations_token on invitations(token) where used_at is null;
--##--
-- Solo service_role (Edge Functions). RLS activa + 0 políticas = cerrada.
alter table invitations enable row level security;
--##--
-- Aplica una invitación a un usuario, ATÓMICAMENTE (valida + crea cuenta o
-- membresía + marca usada, todo en una transacción). La usan signup (usuario
-- nuevo) y invites/redeem (usuario ya logueado). Devuelve el account_id.
create or replace function apply_invitation(
  p_token text, p_user_id uuid, p_business_name text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare inv invitations%rowtype; acc uuid;
begin
  select * into inv from invitations where token = p_token for update;
  if inv.id is null      then raise exception 'invite_invalido'; end if;
  if inv.used_at is not null then raise exception 'invite_usado'; end if;
  if inv.expires_at < now()  then raise exception 'invite_vencido'; end if;

  if inv.kind = 'new_account' then
    insert into accounts (nombre)
      values (coalesce(nullif(trim(p_business_name), ''), inv.nombre_sugerido, 'Mi negocio'))
      returning id into acc;
    insert into account_members (account_id, user_id, role, activo)
      values (acc, p_user_id, 'admin', true)
      on conflict (account_id, user_id) do nothing;
  elsif inv.kind = 'join_account' then
    acc := inv.account_id;
    if acc is null then raise exception 'invite_sin_cuenta'; end if;
    insert into account_members (account_id, user_id, role, activo)
      values (acc, p_user_id, inv.role, true)
      on conflict (account_id, user_id) do update set activo = true;
  else
    raise exception 'invite_kind_desconocido';
  end if;

  update invitations set used_at = now(), used_by = p_user_id where id = inv.id;
  return acc;
end $$;
--##--
revoke all on function apply_invitation(text, uuid, text) from anon, authenticated, public;
