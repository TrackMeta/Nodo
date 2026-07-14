-- 0026 · Estructura de IA: formulario del negocio + validador de comprobantes.
--   channels.negocio_form  = formulario estructurado del negocio (JSON editable).
--                            El texto compilado sigue viviendo en channels.negocio
--                            (que es lo que lee el motor para el contexto de la IA).
--   channels.ocr_config    = configuración del Validador de comprobantes: métodos
--                            de pago aceptados, reglas de validación e instrucciones
--                            que se inyectan al nodo IA "analizar imagen" (OCR).
alter table channels add column if not exists negocio_form jsonb;
alter table channels add column if not exists ocr_config  jsonb;
