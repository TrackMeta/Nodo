-- ═══════════════════════════════════════════════════════════════════
-- Nodo · seed_demo_fisico — Producto físico de DEMO + flujos clonados
-- Modelo "Plantilla (esqueleto) → Producto (copia con datos)" funcionando
-- end-to-end en el canal de pruebas. Un solo bloque anónimo, idempotente.
-- Requiere los esqueletos de seed_fisicos.sql.
-- ═══════════════════════════════════════════════════════════════════
do $$
declare
  ch uuid; prod uuid; sk uuid; nf uuid;
  sk_rec record; n record; v_nid uuid; id_map jsonb;
begin
  select id into ch from channels where channel_type = 'webchat' and activo limit 1;
  if ch is null then raise notice 'seed_demo_fisico: sin canal de pruebas'; return; end if;

  -- ── Producto físico de demo (con sus DATOS) ──────────────────────
  select id into prod from products where channel_id = ch and nombre = '👟 Zapatillas Runner (demo)';
  if prod is null then
    insert into products (channel_id, nombre, tipo, con_bifurcacion, emoji, config)
    values (ch, '👟 Zapatillas Runner (demo)', 'fisico', false, '👟', jsonb_build_object(
      'precio', 120,
      'datos_pago', 'Yape / Plin: 999 888 777 (Percy Flores)',
      'contexto_producto', 'Zapatillas de running unisex, tallas 38 a 44, ligeras y con buena amortiguación. Envío a todo el Perú: en Lima contraentrega (pagas al recibir), en provincia por Shalom u Olva con un adelanto y el saldo al recoger.',
      'faq', 'P: ¿Tienen garantía? R: 30 días por defectos de fábrica. P: ¿Qué tallas hay? R: 38 a 44. P: ¿El envío es gratis? R: Sí, gratis a todo el Perú.',
      'envio', jsonb_build_object('adelanto_modo','fijo','adelanto_valor',20,'gratis',true,'costo_lima',0,'costo_provincia',0,'lima_contraentrega',true,'agencias',array['shalom','olva'],'cobro_saldo','bot')
    ))
    returning id into prod;
  end if;

  -- ── Clonar los 4 esqueletos en el producto + su disparador ───────
  for sk_rec in
    select * from (values
      ('📦 Venta física — Lima / Provincia','venta','Venta física · Zapatillas Runner (demo)','keyword',
        jsonb_build_object('keywords', array['zapatillas','activa zapatillas','quiero zapatillas'], 'match','contiene'), false),
      ('🔔 Cobro de saldo + clave de recojo','cobro','Cobro de saldo · Zapatillas Runner (demo)','pedido_estado',
        jsonb_build_object('estados', array['en_agencia']), true),
      ('🚚 Aviso de despacho','despacho','Aviso de despacho · Zapatillas Runner (demo)','pedido_estado',
        jsonb_build_object('estados', array['despachado']), true),
      ('⏰ Recordatorio de adelanto','recordatorio','Recordatorio de adelanto · Zapatillas Runner (demo)','pedido_recordatorio',
        jsonb_build_object('estado','esperando_adelanto','horas',12), false)
    ) as t(sk_name, role, nombre, trig_tipo, trig_cfg, interrumpe)
  loop
    if exists (select 1 from flows where product_id = prod and role = sk_rec.role) then continue; end if;
    select id into sk from flows where channel_id = ch and kind = 'skeleton' and nombre = sk_rec.sk_name limit 1;
    if sk is null then continue; end if;

    insert into flows (channel_id, kind, nombre, source_skeleton_id, product_id, role, estado)
    values (ch, 'flow', sk_rec.nombre, sk, prod, sk_rec.role, 'activo')
    returning id into nf;

    id_map := '{}'::jsonb;
    for n in select * from flow_nodes where flow_id = sk loop
      v_nid := gen_random_uuid();
      id_map := id_map || jsonb_build_object(n.id::text, v_nid::text);
      insert into flow_nodes (id, flow_id, tipo, nombre, config, es_inicial, pos_x, pos_y)
      values (v_nid, nf, n.tipo, n.nombre, n.config, n.es_inicial, n.pos_x, n.pos_y);
    end loop;
    insert into flow_edges (flow_id, source_node, source_handle, target_node)
    select nf, (id_map ->> source_node::text)::uuid, source_handle, (id_map ->> target_node::text)::uuid
    from flow_edges where flow_id = sk;

    insert into flow_triggers (flow_id, channel_id, tipo, config, interrumpe, activo)
    values (nf, ch, sk_rec.trig_tipo, sk_rec.trig_cfg, sk_rec.interrumpe, true);
  end loop;

  raise notice 'seed_demo_fisico: producto % listo con sus flujos', prod;
end $$;
