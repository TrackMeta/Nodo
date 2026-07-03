-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0006 — clone_flow: clona un esqueleto en un flujo de producto
-- Copia el flujo + sus nodos + sus aristas, remapeando los ids de nodo.
-- Base del modelo "Esqueleto → Producto (copia)".
-- ═══════════════════════════════════════════════════════════════════
create or replace function clone_flow(
  p_source  uuid,   -- flujo/esqueleto origen
  p_product uuid,   -- producto destino (puede ser null)
  p_role    text,   -- rol del flujo en el producto (bienvenida, pago, …)
  p_nombre  text    -- nombre del nuevo flujo
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new     uuid;
  v_channel uuid;
  r         record;
  v_nid     uuid;
  id_map    jsonb := '{}'::jsonb;
begin
  if not is_member() then raise exception 'no autorizado'; end if;

  select channel_id into v_channel from flows where id = p_source;
  if v_channel is null then raise exception 'esqueleto origen no existe'; end if;

  insert into flows (channel_id, kind, nombre, source_skeleton_id, product_id, role, estado)
  values (v_channel, 'flow', coalesce(p_nombre, 'Flujo'), p_source, p_product, p_role, 'borrador')
  returning id into v_new;

  -- Copiar nodos (nuevos ids, guardando el mapeo viejo→nuevo).
  for r in select * from flow_nodes where flow_id = p_source loop
    v_nid := gen_random_uuid();
    id_map := id_map || jsonb_build_object(r.id::text, v_nid::text);
    insert into flow_nodes (id, flow_id, tipo, nombre, config, es_inicial, pos_x, pos_y)
    values (v_nid, v_new, r.tipo, r.nombre, r.config, r.es_inicial, r.pos_x, r.pos_y);
  end loop;

  -- Copiar aristas remapeando los nodos.
  insert into flow_edges (flow_id, source_node, source_handle, target_node)
  select v_new,
         (id_map ->> source_node::text)::uuid,
         source_handle,
         (id_map ->> target_node::text)::uuid
  from flow_edges
  where flow_id = p_source;

  return v_new;
end $$;

revoke all on function clone_flow(uuid, uuid, text, text) from anon, public;
grant execute on function clone_flow(uuid, uuid, text, text) to authenticated;
