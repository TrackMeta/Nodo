-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0076 — índices por contact_id en orders y flow_runs.
--
-- El motor pregunta por el pedido y por el run del contacto en CADA mensaje que
-- entra: 48 consultas distintas filtran orders por contact_id y 9 hacen lo mismo
-- con flow_runs. Ninguna de las dos tablas tenía un índice por esa columna
-- (orders solo por channel_id/estado/product_id, flow_runs solo por wake_at), así
-- que cada una de esas lecturas recorre la tabla entera. Con pocos cientos de
-- filas no se nota; con el historial de un negocio que vende a diario sí, y lo
-- que se degrada es el tiempo de respuesta al cliente en WhatsApp.
--
-- Son índices puros: no cambian datos ni comportamiento.
-- ═══════════════════════════════════════════════════════════════════

-- Los pedidos de un contacto, del más nuevo al más viejo — que es exactamente
-- como los pide el motor (`.eq("contact_id",…).order("created_at",{desc})`).
create index if not exists idx_orders_contact_created
  on orders(contact_id, created_at desc);

-- El run vivo de un contacto: `.eq("contact_id",…).in("estado",["activo","esperando"])`.
-- Parcial a propósito — los runs terminados son la mayoría y no se buscan así.
create index if not exists idx_runs_contact_vivo
  on flow_runs(contact_id)
  where estado in ('activo', 'esperando');

-- El resto de lecturas de flow_runs por contacto (el último run, el historial)
-- no filtran por estado, así que necesitan su propio índice.
create index if not exists idx_runs_contact_created
  on flow_runs(contact_id, created_at desc);
