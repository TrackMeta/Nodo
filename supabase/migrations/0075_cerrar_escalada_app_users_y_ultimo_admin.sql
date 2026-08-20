-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0075 — Cierra DOS huecos de privilegios que quedaron a medias.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) 🔴 Auto-escalada a platform_admin (0067 quedó a medias) ──────
-- 0067 revocó UPDATE de (platform_admin, role, activo) en app_users, pero:
--   (a) NO revocó INSERT ni DELETE, y la política `app_users_selfwrite` es FOR ALL, así
--       que un miembro (incluso operador) podía, por API directa: DELETE su fila +
--       INSERT una nueva con platform_admin=true → rol tope de plataforma.
--   (b) LECCIÓN 0073: un REVOKE de COLUMNA es NO-OP si el rol mantiene el privilegio a
--       nivel de TABLA. Si `authenticated` tenía UPDATE de tabla, el REVOKE de columna de
--       0067 tampoco frenaba el UPDATE directo de platform_admin.
-- Fix robusto: quitar INSERT/DELETE/UPDATE de TABLA a authenticated/anon y devolver SOLO
-- UPDATE de las columnas de perfil que el panel edita de verdad (nombre, avatar_url).
-- app_users se CREA en el backend (signup con service_role); el usuario nunca inserta ni
-- borra su fila, solo edita su perfil. service_role y las funciones SECURITY DEFINER
-- (owner postgres) no se ven afectadas por este revoke.
revoke insert, delete, update on public.app_users from authenticated, anon;
grant update (nombre, avatar_url) on public.app_users to authenticated;

-- ── 2) 🟠 El guard de último-admin (0072) se evadía con activo=false ─
-- El trigger 0072 solo cubría DELETE y el cambio de rol; un admin podía `update
-- account_members set activo=false` (manteniendo role='admin') y dejar la cuenta con CERO
-- admins OPERANTES (userOwnsChannel/is_account_admin exigen activo=true). Se extiende la
-- condición a la desactivación, y el conteo de "otros admins" ahora exige activo=true.
create or replace function nodo_guard_ultimo_admin() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_account uuid;
begin
  v_account := OLD.account_id;
  -- Importa cuando la fila afectada ERA un admin OPERANTE (activo) y deja de serlo:
  -- quitada (DELETE), degradada de rol, o DESACTIVADA (activo=false).
  if (TG_OP = 'DELETE' and OLD.role = 'admin' and OLD.activo)
     or (TG_OP = 'UPDATE' and OLD.role = 'admin' and OLD.activo
         and (coalesce(NEW.role,'') <> 'admin' or NEW.activo = false)) then
    if (select count(*) from account_members
        where account_id = v_account and role = 'admin' and activo = true
          and user_id <> OLD.user_id) = 0 then
      raise exception 'ultimo_admin: la cuenta quedaría sin ningún administrador';
    end if;
  end if;
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end $$;
