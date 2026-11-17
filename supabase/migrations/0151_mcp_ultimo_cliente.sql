-- 0151 · MCP: qué IA se conectó y con qué versión del protocolo (16-nov-2026).
-- Rodrigo quiere que el logo de Nodo salga solo en ChatGPT. Hay reportes de que ChatGPT solo lee el logo (serverInfo.icons)
-- si el servidor habla la versión 2025-11-25 del protocolo; Nodo responde con la que pide el cliente. Antes de cambiar
-- nada, se MIDE qué versión pide ChatGPT: la función `mcp` guarda aquí lo que manda cada IA en `initialize`.
alter table mcp_tokens add column if not exists ultimo_cliente jsonb;   -- { protocolVersion, clientInfo, capabilities, at }
