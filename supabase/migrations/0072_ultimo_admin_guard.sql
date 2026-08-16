-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0072 — Invariante "último admin": una cuenta nunca puede quedar sin ningún
-- administrador. Un DELETE (quitar del equipo) o un UPDATE de rol que dejaría 0 admins
-- en la cuenta se RECHAZA a nivel de BD.
--
-- Por qué en la BD y no solo en el panel: las mutaciones de account_members van por RLS
-- (`am_admin FOR ALL`), así que un admin puede, con una llamada directa a la API, borrar
-- su propia fila o bajarse a operador; y dos admins en sesiones solapadas pueden borrarse
-- mutuamente y dejar la cuenta en CERO admins (ingobernable: nadie invita/renombra/gestiona;
-- solo un platform_admin la rescata). Este trigger cierra todos esos caminos.
-- ═══════════════════════════════════════════════════════════════════
create or replace function nodo_guard_ultimo_admin() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_account uuid;
begin
  v_account := OLD.account_id;
  -- Solo importa cuando la fila afectada ERA admin y deja de serlo (quitada o degradada).
  if (TG_OP = 'DELETE' and OLD.role = 'admin')
     or (TG_OP = 'UPDATE' and OLD.role = 'admin' and coalesce(NEW.role,'') <> 'admin') then
    if (select count(*) from account_members
        where account_id = v_account and role = 'admin' and user_id <> OLD.user_id) = 0 then
      raise exception 'ultimo_admin: la cuenta quedaría sin ningún administrador';
    end if;
  end if;
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end $$;

drop trigger if exists trg_guard_ultimo_admin on account_members;
create trigger trg_guard_ultimo_admin
  before delete or update on account_members
  for each row execute function nodo_guard_ultimo_admin();
