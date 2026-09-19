-- 0103 · `accounts.plan` y `accounts.estado` no los cambia la propia cuenta.
--
-- La policy accounts_admin (0039) permite al admin de la cuenta UPDATE sobre TODA la fila:
-- desde la consola del navegador podía ponerse plan='pro' y estado='activa'. Hoy esas dos
-- columnas no gatean nada (solo un badge en Cuenta), pero el día que `plan` mande, ese es
-- el agujero de facturación. Mismo patrón que 0075 (app_users) y 0073 (channels): se
-- revoca el UPDATE de tabla y se concede por columna. El panel solo edita `nombre`
-- (cuenta.html). service_role no se ve afectado.

revoke update on public.accounts from authenticated;
--##--
grant update (nombre) on public.accounts to authenticated;
