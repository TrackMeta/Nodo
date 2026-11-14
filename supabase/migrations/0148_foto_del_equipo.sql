-- 0148 · Foto del EQUIPO (14-nov-2026, Rodrigo: «agrega la opción de colocarle una foto a mi equipo porque no se
-- diferencian, y que esa foto sirva en la ventana de crear un bot»).
-- accounts.logo_url: imagen chica (128 px, data URL o URL pública). La cambia el admin del equipo (RLS accounts_admin);
-- la columna se abre a UPDATE como ya estaba `nombre` (el resto de accounts —plan, features— sigue cerrado).
alter table accounts add column if not exists logo_url text;
grant select (logo_url) on accounts to authenticated;
grant update (logo_url) on accounts to authenticated;
