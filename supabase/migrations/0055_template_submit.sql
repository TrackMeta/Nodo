-- Enviar plantillas a aprobación de Meta desde Nodo.
-- ejemplos = valores de muestra por variable ({{1}},{{2}}…) que Meta EXIGE al
-- crear la plantilla (components.example.body_text). meta_id = id que Meta le
-- asigna al recibirla (para trazabilidad; el estado igual llega por name+language).
alter table wa_templates add column if not exists ejemplos jsonb;
alter table wa_templates add column if not exists meta_id text;
