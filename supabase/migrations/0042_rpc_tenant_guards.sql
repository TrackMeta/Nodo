-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0042 — Multi-tenant: cerrar RPC SECURITY DEFINER que el panel
-- llama DIRECTO (no pasan por Edge Function, así que Phase 3 no las cubría).
--
-- · dashboard_stats: cualquiera podía leer las métricas de OTRO canal pasando
--   su id (SECURITY DEFINER = se salta RLS). Ahora exige ser dueño.
-- · clone_flow: solo checaba is_member() (cualquier usuario). Ahora exige ser
--   dueño del canal del esqueleto origen + que el producto sea de ese canal.
-- · schedule_nodo_scheduler: no debe ser ejecutable por authenticated.
-- ═══════════════════════════════════════════════════════════════════

create or replace function dashboard_stats(p_channel_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not owns_channel(p_channel_id) then raise exception 'no autorizado'; end if;
  return jsonb_build_object(
    'contactos',       (select count(*) from contacts where channel_id = p_channel_id),
    'por_stage',       (select coalesce(jsonb_object_agg(stage, n),'{}'::jsonb)
                          from (select stage, count(*) n from contacts
                                where channel_id = p_channel_id group by stage) s),
    'mensajes_hoy_in', (select count(*) from messages
                          where channel_id = p_channel_id and direction='in'
                            and ts >= date_trunc('day', now())),
    'mensajes_hoy_out',(select count(*) from messages
                          where channel_id = p_channel_id and direction='out'
                            and ts >= date_trunc('day', now())),
    'purchases',       (select count(*) from capi_events
                          where channel_id = p_channel_id and event_name='Purchase' and estado='enviado'),
    'ingresos',        (select coalesce(sum(value),0) from capi_events
                          where channel_id = p_channel_id and event_name='Purchase' and estado='enviado'),
    'leads',           (select count(*) from capi_events
                          where channel_id = p_channel_id and event_name='Lead' and estado='enviado'),
    'runs_activos',    (select count(*) from flow_runs
                          where channel_id = p_channel_id and estado in ('activo','esperando')),
    'subs_activas',    (select count(*) from sequence_subscriptions
                          where channel_id = p_channel_id and estado='activa'),
    'requiere_humano', (select count(*) from conversations
                          where channel_id = p_channel_id and requiere_humano)
  );
end $$;
--##--
create or replace function clone_flow(
  p_source uuid, p_product uuid, p_role text, p_nombre text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_new uuid; v_channel uuid; r record; v_nid uuid; id_map jsonb := '{}'::jsonb;
begin
  select channel_id into v_channel from flows where id = p_source;
  if v_channel is null then raise exception 'esqueleto origen no existe'; end if;
  if not owns_channel(v_channel) then raise exception 'no autorizado'; end if;
  if p_product is not null and not exists (
      select 1 from products where id = p_product and channel_id = v_channel)
    then raise exception 'producto no pertenece al canal'; end if;

  insert into flows (channel_id, kind, nombre, source_skeleton_id, product_id, role, estado)
  values (v_channel, 'flow', coalesce(p_nombre, 'Flujo'), p_source, p_product, p_role, 'borrador')
  returning id into v_new;

  for r in select * from flow_nodes where flow_id = p_source loop
    v_nid := gen_random_uuid();
    id_map := id_map || jsonb_build_object(r.id::text, v_nid::text);
    insert into flow_nodes (id, flow_id, tipo, nombre, config, es_inicial, pos_x, pos_y)
    values (v_nid, v_new, r.tipo, r.nombre, r.config, r.es_inicial, r.pos_x, r.pos_y);
  end loop;

  insert into flow_edges (flow_id, source_node, source_handle, target_node)
  select v_new, (id_map ->> source_node::text)::uuid, source_handle, (id_map ->> target_node::text)::uuid
  from flow_edges where flow_id = p_source;

  return v_new;
end $$;
--##--
revoke all on function schedule_nodo_scheduler(text, text) from anon, authenticated, public;
