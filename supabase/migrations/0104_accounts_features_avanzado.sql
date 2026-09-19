-- 0104 · «Avanzado» (Flujos y Campos) oculto para las cuentas nuevas
--
-- Decisión de Rodrigo (2026-09-19): el editor de flujos y la pantalla de campos son
-- herramientas de poder que un cliente nuevo no necesita —y que tocadas a ciegas rompen la
-- venta—. A partir de ahora el sidebar NO las muestra salvo que la cuenta lo tenga
-- habilitado. Las cuentas que YA existían conservan lo que tenían.
--
-- `features` es un jsonb libre para esta clase de perillas por cuenta (hoy solo `avanzado`),
-- para no ir agregando una columna booleana por cada cosa que se quiera abrir o cerrar.
-- Quién lo edita: nadie desde el panel. Igual que plan/estado (migración 0103), esto lo
-- cambia la plataforma —service role o SQL—, no el dueño de la cuenta: si el propio admin
-- pudiera encenderlo, la perilla no serviría de nada.
alter table accounts add column if not exists features jsonb not null default '{}'::jsonb;

comment on column accounts.features is
  'Perillas por cuenta que decide la PLATAFORMA (no el dueño). avanzado=true muestra Flujos y Campos en el sidebar. Por defecto {} = oculto.';

-- Las cuentas que ya existen el día de la migración se quedan como estaban (viendo Avanzado):
-- lo que cambia es el DEFAULT para las que vengan después.
update accounts
   set features = features || '{"avanzado": true}'::jsonb
 where created_at < now()
   and not (features ? 'avanzado');
