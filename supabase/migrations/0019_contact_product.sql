-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0019 — Producto de entrada del contacto
--   El flujo, al entrar al nodo de un producto, marca contacts.product_id.
--   La Bandeja muestra el emoji de ese producto sobre el avatar para
--   identificar de un vistazo de qué producto viene cada conversación.
-- ═══════════════════════════════════════════════════════════════════
alter table contacts add column if not exists product_id uuid references products(id) on delete set null;
create index if not exists idx_contacts_product on contacts(product_id);
