-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0119 — A una cuenta solo se entra por invitación.
--
-- La política am_admin (0039) era FOR ALL: un admin podía hacer INSERT en account_members
-- con CUALQUIER user_id (incluso como admin), sin invitación ni consentimiento, y la cuenta
-- le aparecía a la víctima en su selector de bots. Con UPDATE podía además cambiar el
-- user_id de una fila existente y lograr lo mismo. Nadie inserta miembros desde el panel:
-- entran por apply_invitation (SECURITY DEFINER) y signup (service_role), que no pasan por RLS.
--
-- Queda: el admin CAMBIA el rol y QUITA miembros (lo que hace Cuenta), nada más. El trigger
-- impide mover una fila a otro usuario u otra cuenta. El guard del último admin (0072) y la
-- fecha real (0107) siguen igual.
--
-- Delimitador entre sentencias: la línea  --##--  (la Management API no acepta varias).
-- ═══════════════════════════════════════════════════════════════════

drop policy if exists am_admin on account_members;
--##--
drop policy if exists am_admin_upd on account_members;
--##--
create policy am_admin_upd on account_members for update
  using (is_account_admin(account_id)) with check (is_account_admin(account_id));
--##--
drop policy if exists am_admin_del on account_members;
--##--
create policy am_admin_del on account_members for delete
  using (is_account_admin(account_id));
--##--
create or replace function am_no_mover_fila() returns trigger
language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id or new.account_id is distinct from old.account_id then
    raise exception 'No se puede cambiar de quién es una membresía: invita a la persona.';
  end if;
  return new;
end $$;
--##--
drop trigger if exists trg_am_no_mover_fila on account_members;
--##--
create trigger trg_am_no_mover_fila before update on account_members
  for each row execute function am_no_mover_fila();
