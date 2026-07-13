-- ═══════════════════════════════════════════════════════════════════
-- Nodo · seed_fisicos — Esqueletos de venta FÍSICA (DEFINICION §6-SEPTIES)
-- Crea 4 esqueletos (kind='skeleton') en el canal de PRUEBAS (webchat):
--   1. 📦 Venta física — Lima / Provincia  (bifurcación + datos + adelanto OCR)
--   2. 🔔 Cobro de saldo + clave de recojo (trigger pedido_estado: en_agencia)
--   3. 🚚 Aviso de despacho                (trigger pedido_estado: despachado)
--   4. ⏰ Recordatorio de adelanto         (trigger pedido_recordatorio)
-- Variables que usan (se llenan en la ficha del producto / pedido):
--   {{producto_nombre}} {{precio}} {{adelanto}} {{datos_pago}}
--   {{pedido_agencia}} {{pedido_sede}} {{pedido_guia}} {{pedido_saldo}}
--   {{pedido_clave_recojo}} {{pedido_monto}} {{pedido_adelanto}}
-- Idempotente: si el esqueleto ya existe (por nombre), no lo duplica.
-- ═══════════════════════════════════════════════════════════════════

do $$
declare
  ch uuid;
  f1 uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); a3 uuid := gen_random_uuid();
  a3b uuid := gen_random_uuid(); a4 uuid := gen_random_uuid(); a4b uuid := gen_random_uuid();
  a5 uuid := gen_random_uuid(); a6 uuid := gen_random_uuid(); a7 uuid := gen_random_uuid();
  a8 uuid := gen_random_uuid(); a9 uuid := gen_random_uuid(); a9b uuid := gen_random_uuid();
  a10 uuid := gen_random_uuid(); a10b uuid := gen_random_uuid(); a11 uuid := gen_random_uuid();
  a11b uuid := gen_random_uuid(); a12 uuid := gen_random_uuid(); a12b uuid := gen_random_uuid();
  afin uuid := gen_random_uuid();
  f2 uuid := gen_random_uuid();
  m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); m3 uuid := gen_random_uuid();
  m4 uuid := gen_random_uuid(); m5 uuid := gen_random_uuid(); m6 uuid := gen_random_uuid();
  m7 uuid := gen_random_uuid(); m8 uuid := gen_random_uuid(); mfin uuid := gen_random_uuid();
  f3 uuid := gen_random_uuid(); s1 uuid := gen_random_uuid(); sfin uuid := gen_random_uuid();
  f4 uuid := gen_random_uuid(); r1 uuid := gen_random_uuid(); rfin uuid := gen_random_uuid();
begin
  select id into ch from channels where channel_type = 'webchat' and activo limit 1;
  if ch is null then
    raise notice 'seed_fisicos: no hay canal webchat de pruebas — nada que hacer';
    return;
  end if;

  -- ── 1) 📦 Venta física — Lima / Provincia ─────────────────────────
  if not exists (select 1 from flows where channel_id = ch and nombre = '📦 Venta física — Lima / Provincia') then
    insert into flows (id, channel_id, kind, nombre, descripcion, estado)
    values (f1, ch, 'skeleton', '📦 Venta física — Lima / Provincia',
      'Bienvenida → ¿Lima o provincia? → Lima: datos + contraentrega · Provincia: agencia + DNI + adelanto con OCR. Crea el pedido para el Kanban.', 'borrador');

    insert into flow_nodes (id, flow_id, tipo, nombre, config, es_inicial, pos_x, pos_y) values
    (a1, f1, 'mensaje', 'Bienvenida + zona',
      '{"bubbles":[{"text":"¡Hola {{nombre}}! 👋 Gracias por tu interés en *{{producto_nombre}}* 🙌\n\n¿Dónde te lo entregamos?","buttons":[{"id":"zona_lima","title":"🏙 Lima"},{"id":"zona_prov","title":"🚌 Provincia"}]}]}'::jsonb, true, 60, 220),
    (a2, f1, 'accion', 'Marcar Lima',
      '{"acciones":[{"tipo":"set_field","key":"zona_entrega","valor":"lima"}]}'::jsonb, false, 360, 80),
    (a3, f1, 'pregunta', 'Pedir dirección',
      '{"text":"Perfecto 🏙 Hacemos entrega CONTRAENTREGA: pagas cuando lo recibes.\n\n📍 Pásame tu dirección exacta, distrito y una referencia.","guardar_en":"direccion"}'::jsonb, false, 640, 80),
    (a3b, f1, 'pregunta', 'Pedir nombre y teléfono',
      '{"text":"¿Tu nombre completo y un teléfono de contacto para el motorizado? 🪪","guardar_en":"datos_cliente"}'::jsonb, false, 920, 80),
    (a4, f1, 'accion', 'Crear pedido Lima + avisar',
      '{"acciones":[{"tipo":"crear_pedido","estado":"confirmado","monto":"{{precio}}","datos":{"zona":"lima","direccion":"{{direccion}}","datos_cliente":"{{datos_cliente}}","saldo":"{{precio}}"}},{"tipo":"notify_admin","mensaje":"🛵 NUEVO PEDIDO LIMA (contraentrega)\nCliente: {{nombre}} +{{telefono}}\nProducto: {{producto_nombre}} — S/ {{precio}}\nDatos: {{datos_cliente}}\nDirección: {{direccion}}"}]}'::jsonb, false, 1200, 80),
    (a4b, f1, 'mensaje', 'Confirmación Lima',
      '{"bubbles":[{"text":"¡Listo, {{nombre}}! ✅ Tu pedido quedó confirmado.\n\n🛵 Te lo llevamos a tu dirección y pagas al recibirlo (S/ {{precio}}).\nTe escribo cuando el motorizado salga 😉"}]}'::jsonb, false, 1480, 80),
    (a5, f1, 'accion', 'Marcar Provincia',
      '{"acciones":[{"tipo":"set_field","key":"zona_entrega","valor":"provincia"}]}'::jsonb, false, 360, 380),
    (a6, f1, 'pregunta', 'Pedir agencia destino',
      '{"text":"Genial 🚌 Enviamos a todo el Perú por Shalom u Olva (envío GRATIS 🎁).\n\n¿A qué ciudad y agencia te lo mandamos? (ej. \"Shalom Huancayo Centro\")","guardar_en":"agencia_destino"}'::jsonb, false, 640, 380),
    (a7, f1, 'pregunta', 'Pedir nombre y DNI',
      '{"text":"📋 ¿Tu nombre completo y DNI? (la agencia los pide para entregarte el paquete)","guardar_en":"datos_recojo"}'::jsonb, false, 920, 380),
    (a8, f1, 'accion', 'Crear pedido provincia',
      '{"acciones":[{"tipo":"crear_pedido","estado":"esperando_adelanto","monto":"{{precio}}","datos":{"zona":"provincia","sede":"{{agencia_destino}}","dni":"{{datos_recojo}}","adelanto":"{{adelanto}}"}}]}'::jsonb, false, 1200, 380),
    (a9, f1, 'pregunta', 'Pedir adelanto',
      '{"text":"Para despachar tu pedido HOY solo confírmalo con un adelanto de *S/ {{adelanto}}* 💳\n(el resto lo pagas cuando llegue a tu agencia)\n\nYape / Plin: {{datos_pago}}\n\nMándame la captura del pago aquí 🙏","guardar_en":"msg_pago_adelanto"}'::jsonb, false, 1480, 380),
    (a9b, f1, 'condicion', '¿Mandó imagen?',
      '{"rutas":[{"handle":"ruta:es_imagen","nombre":"Es imagen","match":"todas","condiciones":[{"op":"campo_igual","campo":"last_input_type","valor":"image"}]}]}'::jsonb, false, 1760, 380),
    (a10, f1, 'ia', 'OCR del adelanto',
      '{"operacion":"analizar_imagen","perfil":"ocr","guardar_en":"respuesta_ocr","enviar":false,"prompt":"Analiza la imagen adjunta. ¿Es un comprobante de pago peruano real (Yape, Plin, transferencia bancaria)? Valida ESTRICTAMENTE: (1) que sea un comprobante auténtico y no otra cosa, (2) que el monto sea S/ {{adelanto}}. Responde SOLO con la palabra PAGO_OK si cumple todo, o PAGO_MAL: seguido del motivo en pocas palabras."}'::jsonb, false, 2040, 340),
    (a10b, f1, 'condicion', '¿Pago válido?',
      '{"rutas":[{"handle":"ruta:pago_ok","nombre":"Pago OK","match":"todas","condiciones":[{"op":"campo_contiene","campo":"respuesta_ocr","valor":"PAGO_OK"}]}]}'::jsonb, false, 2320, 340),
    (a11, f1, 'accion', 'Adelanto validado + avisar',
      '{"acciones":[{"tipo":"actualizar_pedido","estado":"adelanto_validado"},{"tipo":"notify_admin","mensaje":"🟡 ADELANTO RECIBIDO\nNUEVO PAGO S/ {{adelanto}}\nDE: {{nombre}} +{{telefono}}\nPRODUCTO: {{producto_nombre}} — S/ {{precio}}\nDESTINO: {{agencia_destino}}\nRECOJO: {{datos_recojo}}"},{"tipo":"stage","valor":"comprado"}]}'::jsonb, false, 2600, 260),
    (a11b, f1, 'mensaje', 'Adelanto confirmado',
      '{"bubbles":[{"text":"¡Adelanto confirmado! 🎉 Hoy mismo despachamos tu pedido a {{agencia_destino}}.\n\nTe mando la foto de la guía en cuanto salga 📦 y te aviso cuando llegue para que pagues el saldo y lo recojas con tu DNI."}]}'::jsonb, false, 2880, 260),
    (a12, f1, 'mensaje', 'Comprobante no válido',
      '{"bubbles":[{"text":"Mmm, no pude validar ese comprobante 🤔\n\n¿Me reenvías la captura nítida del pago de *S/ {{adelanto}}*? Si ya pagaste y sigue sin pasar, escríbeme \"ayuda\" y te atiende una persona 🙌"}]}'::jsonb, false, 2600, 480),
    (a12b, f1, 'mensaje', 'Pedir la captura',
      '{"bubbles":[{"text":"Cuando puedas, mándame la 📸 captura del pago del adelanto (S/ {{adelanto}}) para despachar tu pedido hoy mismo 🙌"}]}'::jsonb, false, 2040, 540),
    (afin, f1, 'fin', 'Fin', '{}'::jsonb, false, 3160, 380);

    insert into flow_edges (flow_id, source_node, source_handle, target_node) values
    (f1, a1, 'boton:zona_lima', a2),
    (f1, a1, 'boton:zona_prov', a5),
    (f1, a2, 'continuar', a3),
    (f1, a3, 'continuar', a3b),
    (f1, a3b, 'continuar', a4),
    (f1, a4, 'continuar', a4b),
    (f1, a4b, 'continuar', afin),
    (f1, a5, 'continuar', a6),
    (f1, a6, 'continuar', a7),
    (f1, a7, 'continuar', a8),
    (f1, a8, 'continuar', a9),
    (f1, a9, 'continuar', a9b),
    (f1, a9b, 'ruta:es_imagen', a10),
    (f1, a9b, 'si_no_cumple', a12b),
    (f1, a10, 'exito', a10b),
    (f1, a10, 'fallo', a12),
    (f1, a10b, 'ruta:pago_ok', a11),
    (f1, a10b, 'si_no_cumple', a12),
    (f1, a11, 'continuar', a11b),
    (f1, a11b, 'continuar', afin),
    (f1, a12, 'continuar', afin),
    (f1, a12b, 'continuar', afin);
  end if;

  -- ── 2) 🔔 Cobro de saldo + clave de recojo ────────────────────────
  -- En el producto real: añadir trigger "pedido_estado" → en_agencia.
  if not exists (select 1 from flows where channel_id = ch and nombre = '🔔 Cobro de saldo + clave de recojo') then
    insert into flows (id, channel_id, kind, nombre, descripcion, estado)
    values (f2, ch, 'skeleton', '🔔 Cobro de saldo + clave de recojo',
      'Se dispara cuando marcas el pedido como "en_agencia" en el Kanban: cobra el saldo, valida el comprobante con OCR y suelta la clave de recojo + Purchase.', 'borrador');

    insert into flow_nodes (id, flow_id, tipo, nombre, config, es_inicial, pos_x, pos_y) values
    (m1, f2, 'pregunta', 'Aviso de llegada + cobro',
      '{"text":"📦 ¡Buenas noticias {{nombre}}! Tu pedido ya llegó a *{{pedido_agencia}} {{pedido_sede}}* 🎉\n\nPara darte la 🔑 clave de recojo, cancela el saldo de *S/ {{pedido_saldo}}*:\n💳 Yape / Plin: {{datos_pago}}\n\nMándame la captura aquí 🙏","guardar_en":"msg_pago_saldo"}'::jsonb, true, 60, 220),
    (m2, f2, 'condicion', '¿Mandó imagen?',
      '{"rutas":[{"handle":"ruta:es_imagen","nombre":"Es imagen","match":"todas","condiciones":[{"op":"campo_igual","campo":"last_input_type","valor":"image"}]}]}'::jsonb, false, 360, 220),
    (m3, f2, 'ia', 'OCR del saldo',
      '{"operacion":"analizar_imagen","perfil":"ocr","guardar_en":"respuesta_ocr","enviar":false,"prompt":"Analiza la imagen adjunta. ¿Es un comprobante de pago peruano real (Yape, Plin, transferencia bancaria)? Valida ESTRICTAMENTE: (1) que sea un comprobante auténtico, (2) que el monto sea S/ {{pedido_saldo}}. Responde SOLO con la palabra PAGO_OK si cumple todo, o PAGO_MAL: seguido del motivo en pocas palabras."}'::jsonb, false, 640, 180),
    (m4, f2, 'condicion', '¿Pago válido?',
      '{"rutas":[{"handle":"ruta:pago_ok","nombre":"Pago OK","match":"todas","condiciones":[{"op":"campo_contiene","campo":"respuesta_ocr","valor":"PAGO_OK"}]}]}'::jsonb, false, 920, 180),
    (m5, f2, 'accion', 'Saldo pagado + avisar',
      '{"acciones":[{"tipo":"actualizar_pedido","estado":"saldo_pagado"},{"tipo":"notify_admin","mensaje":"🟢 SALDO COBRADO\nNUEVO PAGO S/ {{pedido_saldo}}\nDE: {{nombre}} +{{telefono}}\nPRODUCTO: {{producto_nombre}}\nGUÍA: {{pedido_guia}} · {{pedido_agencia}} {{pedido_sede}}"}]}'::jsonb, false, 1200, 120),
    (m6, f2, 'mensaje', 'Entregar clave',
      '{"bubbles":[{"text":"✅ ¡Pago confirmado!\n\n🔑 Tu clave de recojo: *{{pedido_clave_recojo}}*\n📄 Guía: {{pedido_guia}}\n\nRecoge tu pedido en {{pedido_agencia}} {{pedido_sede}} presentando tu DNI. ¡Gracias por tu compra, {{nombre}}! 🙌"}]}'::jsonb, false, 1480, 120),
    (m7, f2, 'evento_fb', 'Purchase',
      '{"event_name":"Purchase","currency":"PEN","value":"{{pedido_monto}}","order_id":"{{pedido_guia}}"}'::jsonb, false, 1760, 120),
    (m8, f2, 'mensaje', 'Comprobante no válido',
      '{"bubbles":[{"text":"No pude validar ese comprobante 🤔\n\n¿Me reenvías la captura nítida del pago de *S/ {{pedido_saldo}}*? Si necesitas ayuda escribe \"ayuda\" 🙌"}]}'::jsonb, false, 1200, 360),
    (mfin, f2, 'fin', 'Fin', '{}'::jsonb, false, 2040, 220);

    insert into flow_edges (flow_id, source_node, source_handle, target_node) values
    (f2, m1, 'continuar', m2),
    (f2, m2, 'ruta:es_imagen', m3),
    (f2, m2, 'si_no_cumple', m8),
    (f2, m3, 'exito', m4),
    (f2, m3, 'fallo', m8),
    (f2, m4, 'ruta:pago_ok', m5),
    (f2, m4, 'si_no_cumple', m8),
    (f2, m5, 'continuar', m6),
    (f2, m6, 'continuar', m7),
    (f2, m7, 'exito', mfin),
    (f2, m7, 'fallo', mfin),
    (f2, m8, 'continuar', mfin);
  end if;

  -- ── 3) 🚚 Aviso de despacho ───────────────────────────────────────
  -- En el producto real: añadir trigger "pedido_estado" → despachado.
  if not exists (select 1 from flows where channel_id = ch and nombre = '🚚 Aviso de despacho') then
    insert into flows (id, channel_id, kind, nombre, descripcion, estado)
    values (f3, ch, 'skeleton', '🚚 Aviso de despacho',
      'Se dispara cuando registras el despacho en el Kanban (guía + clave): le manda la guía al cliente.', 'borrador');
    insert into flow_nodes (id, flow_id, tipo, nombre, config, es_inicial, pos_x, pos_y) values
    (s1, f3, 'mensaje', 'Aviso con guía',
      '{"bubbles":[{"text":"🚚 ¡Tu pedido va en camino, {{nombre}}!\n\n📄 Guía: *{{pedido_guia}}*\n🏢 Destino: {{pedido_agencia}} {{pedido_sede}}\n\nTe aviso apenas llegue para que pagues el saldo (S/ {{pedido_saldo}}) y lo recojas con tu DNI 😉"}]}'::jsonb, true, 60, 160),
    (sfin, f3, 'fin', 'Fin', '{}'::jsonb, false, 360, 160);
    insert into flow_edges (flow_id, source_node, source_handle, target_node) values
    (f3, s1, 'continuar', sfin);
  end if;

  -- ── 4) ⏰ Recordatorio de adelanto ────────────────────────────────
  -- En el producto real: trigger "pedido_recordatorio" → esperando_adelanto, 12 h.
  if not exists (select 1 from flows where channel_id = ch and nombre = '⏰ Recordatorio de adelanto') then
    insert into flows (id, channel_id, kind, nombre, descripcion, estado)
    values (f4, ch, 'skeleton', '⏰ Recordatorio de adelanto',
      'Se dispara solo (scheduler) si el pedido lleva N horas esperando el adelanto: recuerda el pago una única vez.', 'borrador');
    insert into flow_nodes (id, flow_id, tipo, nombre, config, es_inicial, pos_x, pos_y) values
    (r1, f4, 'mensaje', 'Recordatorio',
      '{"bubbles":[{"text":"¡Hola {{nombre}}! 👋 Tu pedido de *{{producto_nombre}}* sigue reservado 📦\n\nSolo falta el adelanto de *S/ {{pedido_adelanto}}* para despacharlo hoy 🚀\n💳 Yape / Plin: {{datos_pago}}\n\nSi tienes alguna duda, escríbeme 🙌"}]}'::jsonb, true, 60, 160),
    (rfin, f4, 'fin', 'Fin', '{}'::jsonb, false, 360, 160);
    insert into flow_edges (flow_id, source_node, source_handle, target_node) values
    (f4, r1, 'continuar', rfin);
  end if;

  raise notice 'seed_fisicos: esqueletos creados/verificados en el canal %', ch;
end $$;
