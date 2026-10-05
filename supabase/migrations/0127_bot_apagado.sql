-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0127 — Interruptor general del bot (Canales → «Bot encendido»).
--
-- Rodrigo (5-oct), al pasar un número de ChatLevel a Nodo con los dos bots conectados: «¿hay algún
-- botón general para apagar el bot?». No lo había: pausar el producto dejaba la bienvenida (y la
-- repetía a cada mensaje), quitar la clave de IA dejaba el remarketing, y archivar es demasiado.
--
-- bot_apagado = true → el bot no escribe NADA por su cuenta: ni bienvenida, ni IA, ni remarketing,
-- ni recordatorios de adelanto/pedido, ni el «te atiende un asesor» del vigilante. Los mensajes del
-- cliente siguen entrando a la Bandeja. Lo que hace el dueño a mano (escribir, aprobar un pago, mover
-- un pedido, una campaña) sí sale. Probar flujos y el simulador siguen funcionando.
-- ═══════════════════════════════════════════════════════════════════
alter table public.channels add column if not exists bot_apagado boolean not null default false;

-- 0073: el SELECT de channels va columna por columna; una columna nueva sin este grant no la ve el panel.
grant select (bot_apagado) on public.channels to authenticated, anon;
