-- ═══════════════════════════════════════════════════════════════════
-- Nodo · SEED DEMO (opcional) — canal de pruebas + flujo de bienvenida.
-- Sirve para probar el motor desde el Webchat SIN un WhatsApp real.
-- Se puede borrar luego. Ejecutar en el SQL Editor.
-- ═══════════════════════════════════════════════════════════════════
do $$
declare
  v_channel uuid;
  v_flow    uuid;
  n_a uuid;  -- bienvenida (con botones)
  n_b uuid;  -- cierre básica
  n_c uuid;  -- cierre premium
begin
  -- Canal de pruebas (tipo webchat, sin secretos ni número real).
  insert into channels (nombre, channel_type, activo)
  values ('🧪 Pruebas Nodo', 'webchat', true)
  returning id into v_channel;

  -- Flujo de entrada demo.
  insert into flows (channel_id, kind, nombre, role, estado, es_entrada)
  values (v_channel, 'flow', 'Demo · Bienvenida', 'bienvenida', 'activo', true)
  returning id into v_flow;

  -- Nodo inicial: mensaje con botones (bifurcación determinista).
  insert into flow_nodes (flow_id, tipo, nombre, es_inicial, config)
  values (v_flow, 'mensaje', 'Bienvenida', true,
    '{"bubbles":[{"text":"¡Hola {{nombre}}! 👋 Este es el Protocolo Calistenia Militar. ¿Qué versión te interesa?","buttons":[{"id":"basica","title":"Básica S/10"},{"id":"premium","title":"Premium S/15"}]}]}')
  returning id into n_a;

  -- Rama Básica.
  insert into flow_nodes (flow_id, tipo, nombre, config)
  values (v_flow, 'mensaje', 'Cierre Básica',
    '{"bubbles":[{"text":"¡Excelente elección! 💪 La Básica cuesta S/10. Yapea al 987 654 321 (Percy F.) y envíame la captura 📸"}]}')
  returning id into n_b;

  -- Rama Premium.
  insert into flow_nodes (flow_id, tipo, nombre, config)
  values (v_flow, 'mensaje', 'Cierre Premium',
    '{"bubbles":[{"text":"¡Gran elección! 🔥 La Premium cuesta S/15. Yapea al 987 654 321 (Percy F.) y envíame la captura 📸"}]}')
  returning id into n_c;

  -- Aristas: cada botón enruta a su cierre (ruteo determinista).
  insert into flow_edges (flow_id, source_node, source_handle, target_node) values
    (v_flow, n_a, 'boton:basica',  n_b),
    (v_flow, n_a, 'boton:premium', n_c);

  -- Trigger: este flujo es el de ENTRADA (cualquier mensaje lo arranca).
  insert into flow_triggers (flow_id, channel_id, tipo, activo)
  values (v_flow, v_channel, 'entrada', true);

  raise notice 'Seed demo listo. channel_id=%  flow_id=%', v_channel, v_flow;
end $$;
