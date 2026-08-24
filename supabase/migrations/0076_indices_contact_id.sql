-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0076 — índices por contact_id en orders y flow_runs.
--
-- El motor pregunta por el pedido y por el run del contacto en CADA mensaje que
-- entra: 48 consultas distintas filtran orders por contact_id y 9 hacen lo mismo
-- con flow_runs. `orders` no tenía NINGÚN índice por esa columna (solo por
-- channel_id/estado/product_id), así que cada una de esas lecturas recorre la
-- tabla entera. Con pocos cientos de filas no se nota; con el historial de un
-- negocio que vende a diario sí, y lo que se degrada es el tiempo que tarda el
-- bot en contestarle al cliente.
--
-- Son índices puros: no cambian datos ni comportamiento.
-- ═══════════════════════════════════════════════════════════════════

-- Los pedidos de un contacto, del más nuevo al más viejo — que es exactamente
-- como los pide el motor (`.eq("contact_id",…).order("created_at",{desc})`).
create index if not exists idx_orders_contact_created
  on orders(contact_id, created_at desc);

-- El run VIVO de un contacto (`.in("estado",["activo","esperando"])`) NO necesita índice
-- nuevo: ya lo cubre `idx_runs_lock`, el índice único parcial con ese mismo predicado que
-- serializa el lock por contacto. Se comprobó contra la base antes de escribir esto — el
-- índice de más habría gastado espacio y frenado cada escritura sin acelerar ninguna lectura.
--
-- Lo que sí queda descubierto son las lecturas por contacto SIN filtrar por estado (el
-- último run, el historial), que es un índice distinto porque el parcial no las sirve.
create index if not exists idx_runs_contact_created
  on flow_runs(contact_id, created_at desc);
