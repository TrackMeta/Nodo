-- 0056 · Anti-spam: enfriamiento entre envíos automáticos de marketing.
-- El scheduler y las campañas coordinan los toques a un contacto para que la
-- suma de secuencias + recordatorios de adelanto + campañas no lo bombardee el
-- mismo día (riesgo de baneo del número). Se marca el último toque de marketing
-- aquí; los envíos AUTOMÁTICOS (secuencia/nudge) se posponen si es reciente, las
-- campañas (deliberadas) no se frenan pero sí marcan. Los avisos transaccionales
-- de pedido NO tocan esta columna (el cliente los espera).
-- Nullable, sin default → los contactos existentes quedan "sin toque previo" y el
-- primer envío siempre pasa. No cambia datos.
alter table contacts add column if not exists ultimo_auto_msg_at timestamptz;
