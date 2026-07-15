-- Agentes de pedidos físicos (Confirmación + Logística): config global del
-- canal editada en IA → Pedidos. Mensajes e instrucciones de la IA por tipo de
-- envío (contraentrega / agencia) y modo de verificación de saldo (manual/auto).
alter table channels add column if not exists pedidos_config jsonb;
