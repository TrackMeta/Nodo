-- Plantillas HSM con variable en el ENCABEZADO o en un BOTÓN (URL dinámica), o con
-- encabezado de media (imagen/documento/video): Nodo hoy solo llena variables del
-- CUERPO. Si se envía una así, Meta rechaza TODO el lote (132000, faltan parámetros
-- de header/botón) porque el envío solo manda bodyParams.
--
-- `soporta_envio` la marca la sincronización (channel-config templates_sync): true
-- cuando la plantilla solo usa variables en el cuerpo; false cuando tiene variables
-- fuera del cuerpo. Los selectores de Campañas/Secuencias/Pagos la esconden y el
-- backend de envío la bloquea con un motivo claro, en vez de quemar la audiencia.
--
-- Default true: las plantillas ya existentes se asumen enviables hasta la próxima
-- sincronización (que recalcula el valor real desde los componentes de Meta).
alter table public.wa_templates
  add column if not exists soporta_envio boolean not null default true;
