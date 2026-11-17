-- 0153 · MCP: fin de la medición de 0152 (17-nov-2026). ChatGPT NO manda el ID de su aplicación (asdk_app_…) ni en
-- encabezados ni en _meta (solo idioma, zona horaria, ciudad y códigos de sesión anónimos). Se borra lo medido
-- (tenía IPs) y la columna: no se vuelve a guardar.
alter table mcp_tokens drop column if exists ultima_llamada;
