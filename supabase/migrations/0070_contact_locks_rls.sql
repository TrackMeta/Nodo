-- Nodo · 0070 — RLS en contact_locks (la creó 0069 sin habilitarla)
--
-- Igual que payment_operations (0037): la tabla no la toca nadie por PostgREST
-- —solo el motor entra con la service role, que se salta RLS— así que se habilita
-- RLS SIN políticas. Con eso la anon key (que viaja en el JS del panel) no puede
-- leer, insertar ni borrar locks: soltar un lock ajeno o sembrar locks vigentes
-- dejaría a un contacto mudo. El backend sigue funcionando igual (service role).
alter table contact_locks enable row level security;
