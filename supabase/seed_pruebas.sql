-- Siembra 2 productos LISTOS PARA PROBAR con el modelo nuevo (opciones de
-- compra, IA que vende, zonas, extractor). Idempotente: se puede re-correr.
-- Canal: Prime Digital (f5e85bad-11c1-41ac-99a4-77d59834de28)
do $$
declare
  ch   uuid := 'f5e85bad-11c1-41ac-99a4-77d59834de28';
  pD   uuid; pF uuid;
  fD   uuid; fF uuid; fIniD uuid; fIniF uuid;
  fAdel uuid; fDesp uuid; fAgen uuid;
  n1 uuid; n2 uuid; n3 uuid; n4 uuid; n5 uuid; n6 uuid; n7 uuid; n8 uuid; n9 uuid; n10 uuid;
begin
  -- ── Limpieza: los flujos del demo viejo compiten ──────────────────
  -- Sus triggers pedido_estado se disparan por CANAL (no por producto), así que
  -- se activarían con los pedidos de los productos nuevos.
  update flow_triggers set activo=false
   where flow_id in (select id from flows where channel_id=ch and nombre like '%(demo)%');
  update flows set estado='borrador'
   where channel_id=ch and nombre like '%(demo)%';
  -- Y las pruebas anteriores de esta siembra.
  delete from flows where channel_id=ch and nombre like '[PRUEBA]%';
  delete from products where channel_id=ch and nombre like '[PRUEBA]%';

  -- ══════════════════════════════════════════════════════════════════
  -- 1) PRODUCTO DIGITAL — Curso de Steel Framing
  -- ══════════════════════════════════════════════════════════════════
  insert into products (channel_id, nombre, tipo, emoji, config) values (ch,
    '[PRUEBA] Curso de Steel Framing', 'digital', '📘',
    jsonb_build_object(
      'moneda','PEN',
      'contexto_producto',
        E'## Sobre el producto (Curso de Steel Framing)\n'
        'Curso online grabado de construcción en Steel Framing, de cero a tu primera obra. '
        'Acceso de por vida por Google Drive, se ve desde el celular o la compu.\n\n'
        '## Opciones\n'
        '- Básico (S/ 99): el curso grabado completo, 40 clases.\n'
        '- Premium (S/ 149): el curso + los planos editables + el pack de plantillas de presupuesto. '
        'Es el que más se lleva porque los planos solos valen más que la diferencia.\n\n'
        '## Cómo debes comportarte\n'
        'Eres Andrea, asesora del curso. Tono cercano y directo, tuteas. Máximo 2 emojis por mensaje. '
        'Respuestas cortas (2-4 líneas). No inventes precios, descuentos ni contenidos que no estén acá.',
      'faq',
        E'P: ¿Es en vivo o grabado?\nR: Grabado, lo ves a tu ritmo y el acceso no vence.\n'
        'P: ¿Dan certificado?\nR: Sí, al terminar te llega un certificado digital.\n'
        'P: ¿Sirve si no tengo experiencia?\nR: Sí, arranca desde cero.\n'
        'P: ¿Puedo pagar en partes?\nR: No, el pago es único.',
      'emojis','📘 🏗 📐 ✅'
    ))
  returning id into pD;

  insert into product_versions (product_id, nombre, precio, cantidad, activo, orden, descripcion, entrega) values
    (pD,'Básico', 99,1,true,0,'El curso grabado completo, 40 clases',
      jsonb_build_array(jsonb_build_object('tipo','link','nombre','Curso completo','url','https://drive.google.com/drive/folders/PRUEBA-curso-basico'))),
    (pD,'Premium',149,1,true,1,'El curso + los planos editables + plantillas de presupuesto',
      jsonb_build_array(
        jsonb_build_object('tipo','link','nombre','Curso completo','url','https://drive.google.com/drive/folders/PRUEBA-curso-premium'),
        jsonb_build_object('tipo','link','nombre','Planos editables','url','https://drive.google.com/drive/folders/PRUEBA-planos'),
        jsonb_build_object('tipo','link','nombre','Plantillas de presupuesto','url','https://drive.google.com/drive/folders/PRUEBA-plantillas')));

  -- Mensajes iniciales (rotador de 1 nodo) + palabra clave
  insert into flows (channel_id, product_id, nombre, role, kind, estado, descripcion)
  values (ch,pD,'[PRUEBA] Mensajes iniciales · Steel Framing','mensajes_iniciales','flow','activo',
          'Curso online de construcción en Steel Framing. Cursos, capacitación, construcción en seco.')
  returning id into fIniD;
  insert into flows (channel_id, product_id, nombre, role, kind, estado, descripcion)
  values (ch,pD,'[PRUEBA] Venta · Steel Framing','venta','flow','activo','Venta del curso con IA.')
  returning id into fD;

  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fIniD,'rotador','Mensajes iniciales',
     jsonb_build_object('activo',false,'variantes',jsonb_build_array(
        jsonb_build_object('nombre','Directo','peso',1,'activo',true,'bubbles',jsonb_build_array(
          jsonb_build_object('text', E'¡Hola! 👋 Gracias por escribir sobre el *Curso de Steel Framing*.\n\nEs 100% grabado, lo ves a tu ritmo y el acceso no vence. Tenemos dos opciones:\n\n📘 *Básico* — S/ 99\n📐 *Premium* — S/ 149 (incluye los planos editables)\n\n¿Te cuento la diferencia?')))),
       'despues', jsonb_build_object('modo','flujo','flow_id',fD::text)),
     true,80,80);
  insert into flow_triggers (channel_id, flow_id, tipo, config, activo, interrumpe)
  values (ch,fIniD,'keyword',jsonb_build_object('keywords',jsonb_build_array('steel','curso steel','steel framing'),'match','contiene'),true,false);

  -- Flujo de venta digital (igual al que arma la Receta)
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fD,'ia','La IA vende', jsonb_build_object(
      'operacion','generar_texto','enviar',true,'usar_conocimiento',true,'detectar_opcion',true,
      'prompt','Continúa la conversación de forma natural. Responde sus dudas, explica el valor del producto, maneja objeciones y guíalo a la compra. Cuando decida comprar, dile el precio de la opción que eligió y pásale los datos de pago ({{datos_pago}}). No inventes precios ni promesas.'),
      false,80,220) returning id into n1;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fD,'pregunta','Escuchar al cliente', jsonb_build_object('text',''), true,380,220) returning id into n2;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fD,'condicion','¿Mandó comprobante?', jsonb_build_object('rutas',jsonb_build_array(
      jsonb_build_object('nombre','Es imagen','handle','ruta:es_imagen','match','todas','condiciones',
        jsonb_build_array(jsonb_build_object('op','campo_igual','campo','last_input_type','valor','image'))))),
      false,660,220) returning id into n3;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fD,'ia','Validar el pago', jsonb_build_object(
      'operacion','analizar_imagen','perfil','ocr','usar_validador',true,'enviar',false,
      'guardar_en','pago_resultado',
      'prompt','Analiza la imagen adjunta con las reglas del validador. Si el pago es VÁLIDO y por el monto correcto, responde exactamente PAGO_OK. Si no, responde PAGO_NO y en una frase el motivo.'),
      false,960,120) returning id into n4;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fD,'condicion','¿Pago válido?', jsonb_build_object('rutas',jsonb_build_array(
      jsonb_build_object('nombre','Pago OK','handle','ruta:pago_ok','match','todas','condiciones',
        jsonb_build_array(jsonb_build_object('op','campo_contiene','campo','pago_resultado','valor','PAGO_OK'))))),
      false,1240,120) returning id into n5;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fD,'accion','Registrar la venta', jsonb_build_object('acciones',jsonb_build_array(
      jsonb_build_object('tipo','add_tag','valor','Compra'),
      jsonb_build_object('tipo','notify_admin','foto','{{ultima_imagen}}','mensaje',
        E'💰 VENTA · {{producto_nombre}}\nOpción: {{opcion}}\nCliente: {{nombre}}\nMonto: S/ {{precio}}\nFecha: {{fecha_hora}}'))),
      false,1520,120) returning id into n6;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fD,'accion','Entregar el producto', jsonb_build_object('acciones',jsonb_build_array(
      jsonb_build_object('tipo','entregar','mensaje','¡Pago confirmado! 🎉 Acá tienes tu acceso:'))),
      false,1800,120) returning id into n7;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fD,'fin','Fin','{}'::jsonb,false,2080,120) returning id into n8;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fD,'mensaje','Pedir el comprobante de nuevo', jsonb_build_object('bubbles',jsonb_build_array(
      jsonb_build_object('text', E'Mmm, no pude validar ese comprobante 🤔\n\n{{pago_resultado}}\n\n¿Me lo reenvías? Si tienes alguna duda, dime nomás.'))),
      false,960,340) returning id into n9;

  insert into flow_edges (flow_id,source_node,source_handle,target_node) values
    (fD,n1,'exito',n2), (fD,n2,'continuar',n3),
    (fD,n3,'ruta:es_imagen',n4), (fD,n3,'si_no_cumple',n1),
    (fD,n4,'exito',n5), (fD,n5,'ruta:pago_ok',n6), (fD,n5,'si_no_cumple',n9),
    (fD,n9,'continuar',n2), (fD,n6,'continuar',n7), (fD,n7,'continuar',n8);

  -- ══════════════════════════════════════════════════════════════════
  -- 2) PRODUCTO FÍSICO — Zapatillas Runner Pro
  -- ══════════════════════════════════════════════════════════════════
  insert into products (channel_id, nombre, tipo, emoji, config) values (ch,
    '[PRUEBA] Zapatillas Runner Pro', 'fisico', '👟',
    jsonb_build_object(
      'moneda','PEN',
      'envio', jsonb_build_object('adelanto_modo','fijo','adelanto_valor',20,'gratis',true),
      'contexto_producto',
        E'## Sobre el producto (Zapatillas Runner Pro)\n'
        'Zapatillas de running unisex, tallas 38 a 44. Livianas, con buena amortiguación, suela antideslizante. '
        'Colores: negro, blanco y azul.\n\n'
        '## Opciones\n'
        '- 1 par (S/ 120)\n'
        '- 2 pares (S/ 210) — ahorra S/ 30, es la que más se lleva.\n\n'
        '## Envío\n'
        'Envío GRATIS a todo el Perú. En Lima es contraentrega (pagas al recibir). '
        'A provincia va por Shalom con un adelanto de S/ 20 y el resto lo pagas al recoger.\n\n'
        '## Cómo debes comportarte\n'
        'Eres Andrea, asesora de la tienda. Tono cercano y directo, tuteas. Máximo 2 emojis por mensaje. '
        'Respuestas cortas (2-4 líneas). Pregunta la talla y el color cuando el cliente muestre interés. '
        'No inventes precios ni prometas fechas que el sistema no te haya confirmado.',
      'faq',
        E'P: ¿Son originales?\nR: Sí, son importadas y tienen garantía de 30 días por falla de fábrica.\n'
        'P: ¿Puedo cambiar la talla?\nR: Sí, dentro de los 7 días y sin uso.\n'
        'P: ¿Cuánto demora a provincia?\nR: Entre 2 y 4 días hábiles según la agencia.',
      'emojis','👟 📦 ✅',
      'atributos', jsonb_build_array(
        jsonb_build_object('nombre','Talla','obligatorio',true),
        jsonb_build_object('nombre','Color','obligatorio',false))
    ))
  returning id into pF;

  insert into product_versions (product_id, nombre, precio, cantidad, activo, orden, descripcion, entrega) values
    (pF,'1 par',  120,1,true,0,'Un par de Zapatillas Runner Pro','[]'::jsonb),
    (pF,'2 pares',210,2,true,1,'Dos pares — ahorras S/ 30','[]'::jsonb);

  insert into flows (channel_id, product_id, nombre, role, kind, estado, descripcion)
  values (ch,pF,'[PRUEBA] Mensajes iniciales · Zapatillas','mensajes_iniciales','flow','activo',
          'Zapatillas de running unisex. Zapatillas, running, deportivas, calzado.')
  returning id into fIniF;
  insert into flows (channel_id, product_id, nombre, role, kind, estado, descripcion)
  values (ch,pF,'[PRUEBA] Venta · Zapatillas','venta','flow','activo','Venta física con IA (zona + datos).')
  returning id into fF;

  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fIniF,'rotador','Mensajes iniciales',
     jsonb_build_object('activo',false,'variantes',jsonb_build_array(
        jsonb_build_object('nombre','Directo','peso',1,'activo',true,'bubbles',jsonb_build_array(
          jsonb_build_object('text', E'¡Hola! 👋 Gracias por tu interés en las *Zapatillas Runner Pro*.\n\n👟 1 par — S/ 120\n👟 2 pares — S/ 210 (ahorras S/ 30)\n\n📦 Envío GRATIS a todo el Perú. ¿Para qué ciudad sería?')))),
       'despues', jsonb_build_object('modo','flujo','flow_id',fF::text)),
     true,80,80);
  insert into flow_triggers (channel_id, flow_id, tipo, config, activo, interrumpe)
  values (ch,fIniF,'keyword',jsonb_build_object('keywords',jsonb_build_array('zapatillas','runner','zapatillas pro'),'match','contiene'),true,false);

  -- Flujo de venta física (igual al que arma la Receta)
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fF,'ia','La IA vende y toma datos', jsonb_build_object(
      'operacion','generar_texto','enviar',true,'usar_conocimiento',true,
      'detectar_opcion',true,'detectar_zona',true,
      'campos', jsonb_build_array(
        jsonb_build_object('clave','nombre_completo','label','Nombre y apellido del que recibe','requerido',true),
        jsonb_build_object('clave','direccion','label','Dirección exacta','detalle','calle y número, o dónde entregar aunque sea impreciso','requerido',true,'solo_si_zona','lima'),
        jsonb_build_object('clave','referencia','label','Referencia','detalle','algo cerca para ubicarlo','requerido',false,'solo_si_zona','lima'),
        jsonb_build_object('clave','dni','label','DNI','detalle','8 dígitos, se lo pide la agencia','requerido',true,'validar','dni','solo_si_zona','provincia'),
        jsonb_build_object('clave','sede','label','Sede de la agencia','detalle','la oficina EXACTA donde lo va a recoger (ej. «Av. España»), NO la ciudad','requerido',true,'solo_si_zona','provincia')),
      'prompt','Continúa la conversación de forma natural: responde dudas, explica el valor y guía a la compra. Pregúntale a dónde se lo enviamos para saber cómo despacharlo. Pide los datos que falten de a uno, sin sonar a formulario. No prometas fechas ni coberturas que el sistema no te haya confirmado.'),
      false,80,240) returning id into n1;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fF,'pregunta','Escuchar al cliente', jsonb_build_object('text',''), true,380,240) returning id into n2;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fF,'fin','Fin','{}'::jsonb,false,2080,240) returning id into n3;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fF,'condicion','¿Es de Lima?', jsonb_build_object('rutas',jsonb_build_array(
      jsonb_build_object('nombre','Lima','handle','ruta:lima','match','todas','condiciones',
        jsonb_build_array(jsonb_build_object('op','campo_igual','campo','zona_entrega','valor','lima'))))),
      false,660,440) returning id into n4;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fF,'condicion','¿Datos listos? (Lima)', jsonb_build_object('rutas',jsonb_build_array(
      jsonb_build_object('nombre','Crear','handle','ruta:crear','match','todas','condiciones',jsonb_build_array(
        jsonb_build_object('op','campo_igual','campo','datos_completos','valor','si'),
        jsonb_build_object('op','campo_igual','campo','pedido_creado','valor',''))))),
      false,960,440) returning id into n5;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fF,'accion','Crear pedido Lima', jsonb_build_object('acciones',jsonb_build_array(
      jsonb_build_object('tipo','crear_pedido','estado','confirmado','monto','{{precio}}','datos',
        jsonb_build_object('zona','lima','zona_nombre','{{zona_nombre}}','direccion','{{direccion}}',
          'referencia','{{referencia}}','cliente','{{nombre_completo}}','opcion','{{opcion}}','saldo','{{precio}}','entrega_hoy','{{entrega_hoy}}')),
      jsonb_build_object('tipo','set_field','key','pedido_creado','valor','si'),
      jsonb_build_object('tipo','add_tag','valor','Compra'),
      jsonb_build_object('tipo','notify_admin','mensaje',
        E'🛵 PEDIDO LIMA (contraentrega)\nCliente: {{nombre}}\nZona: {{zona_nombre}} · ¿hoy?: {{entrega_hoy}}\nDirección: {{direccion}}\nRef: {{referencia}}\nOpción: {{opcion}} — cobrar S/ {{precio}}'))),
      false,1240,440) returning id into n6;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fF,'mensaje','Confirmación Lima', jsonb_build_object('bubbles',jsonb_build_array(
      jsonb_build_object('text', E'¡Listo, {{nombre}}! ✅ Tu pedido quedó confirmado.\n\n🛵 Pagas al recibirlo. Te avisamos cuando salga el motorizado.'))),
      false,1520,440) returning id into n7;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fF,'condicion','¿Datos listos? (Provincia)', jsonb_build_object('rutas',jsonb_build_array(
      jsonb_build_object('nombre','Crear','handle','ruta:crear','match','todas','condiciones',jsonb_build_array(
        jsonb_build_object('op','campo_igual','campo','datos_completos','valor','si'),
        jsonb_build_object('op','campo_igual','campo','zona_entrega','valor','provincia'),
        jsonb_build_object('op','campo_igual','campo','pedido_creado','valor',''))))),
      false,960,640) returning id into n8;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fF,'accion','Crear pedido Provincia', jsonb_build_object('acciones',jsonb_build_array(
      jsonb_build_object('tipo','crear_pedido','estado','esperando_adelanto','monto','{{precio}}','datos',
        jsonb_build_object('zona','provincia','sede','{{sede}}','dni','{{dni}}','cliente','{{nombre_completo}}',
          'opcion','{{opcion}}','adelanto','{{adelanto}}','saldo','{{precio}}')),
      jsonb_build_object('tipo','set_field','key','pedido_creado','valor','si'),
      jsonb_build_object('tipo','notify_admin','mensaje',
        E'📦 PEDIDO PROVINCIA por confirmar\nCliente: {{nombre}}\nDNI: {{dni}}\nSede: {{sede}}\nOpción: {{opcion}} — total S/ {{precio}}\nEsperando adelanto de S/ {{adelanto}}'))),
      false,1240,640) returning id into n9;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fF,'mensaje','Pedir el adelanto', jsonb_build_object('bubbles',jsonb_build_array(
      jsonb_build_object('text', E'¡Perfecto! 🙌 Para despachar tu pedido a la agencia, confírmalo con un adelanto de *S/ {{adelanto}}*.\n\n{{datos_pago}}\n\nCuando lo hagas, mándame la captura y lo verifico al toque.'))),
      false,1520,640) returning id into n10;

  insert into flow_edges (flow_id,source_node,source_handle,target_node) values
    (fF,n2,'continuar',n1), (fF,n1,'exito',n4),
    (fF,n4,'ruta:lima',n5), (fF,n4,'si_no_cumple',n8),
    (fF,n5,'ruta:crear',n6), (fF,n5,'si_no_cumple',n2),
    (fF,n6,'continuar',n7), (fF,n7,'continuar',n3),
    (fF,n8,'ruta:crear',n9), (fF,n8,'si_no_cumple',n2),
    (fF,n9,'continuar',n10), (fF,n10,'continuar',n2);

  -- ── Flujos de aviso por estado del pedido (los dispara el Copiloto) ──
  insert into flows (channel_id, product_id, nombre, role, kind, estado, descripcion)
  values (ch,pF,'[PRUEBA] Aviso · Adelanto validado','aviso','flow','activo','Le confirma al cliente que el adelanto entró.')
  returning id into fAdel;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fAdel,'mensaje','Adelanto confirmado', jsonb_build_object('bubbles',jsonb_build_array(
      jsonb_build_object('text', E'¡Adelanto confirmado! 🙌\n\nYa estamos preparando tu pedido. Te enviamos la guía apenas lo despachemos por la agencia.'))),
      true,80,80);
  insert into flow_triggers (channel_id, flow_id, tipo, config, activo, interrumpe)
  values (ch,fAdel,'pedido_estado',jsonb_build_object('estados',jsonb_build_array('adelanto_validado')),true,true);

  insert into flows (channel_id, product_id, nombre, role, kind, estado, descripcion)
  values (ch,pF,'[PRUEBA] Aviso · Despachado','aviso','flow','activo','Le manda la guía al despachar.')
  returning id into fDesp;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fDesp,'mensaje','Guía de envío', jsonb_build_object('bubbles',jsonb_build_array(
      jsonb_build_object('text', E'¡Tu pedido ya salió! 🚚\n\n📄 Guía: *{{pedido_guia}}*\nSede: {{pedido_sede}}\n\nTe avisamos apenas llegue a destino.'))),
      true,80,80);
  insert into flow_triggers (channel_id, flow_id, tipo, config, activo, interrumpe)
  values (ch,fDesp,'pedido_estado',jsonb_build_object('estados',jsonb_build_array('despachado')),true,true);

  insert into flows (channel_id, product_id, nombre, role, kind, estado, descripcion)
  values (ch,pF,'[PRUEBA] Aviso · Llegó a la agencia','aviso','flow','activo','Avisa que llegó y cobra el saldo.')
  returning id into fAgen;
  insert into flow_nodes (flow_id,tipo,nombre,config,es_inicial,pos_x,pos_y) values
    (fAgen,'mensaje','Llegó · cobrar saldo', jsonb_build_object('bubbles',jsonb_build_array(
      jsonb_build_object('text', E'¡Tu pedido ya llegó a {{pedido_sede}}! 🎉\n\nPara darte la clave de recojo solo falta el saldo de *S/ {{pedido_saldo}}*.\n\n{{datos_pago}}\n\nMándame la captura y te paso la clave al toque.'))),
      true,80,80);
  insert into flow_triggers (channel_id, flow_id, tipo, config, activo, interrumpe)
  values (ch,fAgen,'pedido_estado',jsonb_build_object('estados',jsonb_build_array('en_agencia')),true,true);
end $$;
