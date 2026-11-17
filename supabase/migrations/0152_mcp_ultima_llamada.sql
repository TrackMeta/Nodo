-- 0152 · MCP: qué datos manda la IA al usar una herramienta (16/17-nov-2026).
-- Idea de Rodrigo: enlace + .zip «escondido» que le pone logo y descripción. El .zip necesita el ID de la aplicación
-- que ChatGPT crea al conectar el enlace (asdk_app_…). Se MIDE si ChatGPT lo manda en los encabezados o en `_meta`
-- para que Nodo lo atrape solo y el cliente no tenga que copiarlo. Nunca se guarda la llave ni encabezados de sesión.
alter table mcp_tokens add column if not exists ultima_llamada jsonb;   -- { metodo, herramienta, headers, meta, at }
