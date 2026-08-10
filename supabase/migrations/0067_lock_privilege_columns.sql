-- 0067 · Cierra la auto-escalada de privilegios en app_users.
--
-- La política `app_users_selfwrite` (0039) permite a un usuario UPDATE de su propia fila
-- (id = auth.uid()) SIN restringir columnas. Como las columnas sensibles platform_admin
-- (0040) y las legacy role/activo viven en app_users, cualquier usuario autenticado podía
-- desde el panel hacer:
--     supabase.from('app_users').update({ platform_admin: true }).eq('id', <su uid>)
-- y auto-volverse admin de plataforma (mintear invitaciones de cuenta ilimitadas).
--
-- El fix: quitarle a `authenticated` el privilegio de UPDATE sobre esas columnas. La RLS
-- self-write sigue permitiendo editar el resto (nombre, etc.); solo las columnas de
-- privilegio quedan fuera de su alcance. Cambiarlas queda reservado a service_role /
-- funciones con SECURITY DEFINER (que ya verifican quién llama).

REVOKE UPDATE (platform_admin, role, activo) ON public.app_users FROM authenticated;

-- Nota: REVOKE de columnas solo tiene efecto porque la política RLS es permissive; el
-- GRANT de columna es la segunda barrera. Si en el futuro se agrega otra columna de
-- privilegio, agrégala también a este REVOKE.
