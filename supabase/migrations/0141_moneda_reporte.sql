-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0141 — Moneda de los reportes (Ajustes → Tu negocio)
--   Reemplaza al botón «Ver en dólares» de Inicio, que se guardaba solo en el
--   navegador. Vacío = la moneda del país del negocio (channels.moneda);
--   'USD' = Inicio y Rendimiento convierten todo a dólares.
--   No toca lo que paga el cliente: eso sigue saliendo de channels.moneda y
--   de la moneda de cada producto.
-- ═══════════════════════════════════════════════════════════════════
alter table channels add column if not exists moneda_reporte text;
