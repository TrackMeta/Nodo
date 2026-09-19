-- 0102 · Sello ATÓMICO de la exportación al courier (Pedidos → Exportar Excel).
--
-- Antes el panel generaba el Excel y DESPUÉS sellaba shipping.exportado_at pedido por
-- pedido (un order-update por fila). Dos operadores que exportaban a la vez, o el mismo
-- con dos pestañas, leían los dos «sin exportar», los dos generaban el Excel y los dos
-- sellaban: el mismo paquete subía dos veces al courier → dos guías y dos fletes.
--
-- Ahora el sello va PRIMERO y en UNA sola sentencia con condición: solo se sella lo que
-- sigue sin sello (o, para los que el operador vio ya exportados y confirmó reexportar,
-- solo si el sello es el MISMO que vio). Devuelve los ids que sí se sellaron: el Excel
-- se genera solo con esos, y los que se le adelantaron se avisan. Si el Excel falla
-- después de sellar, el panel quita SU sello (y restaura el anterior si lo había).

create or replace function orders_sellar_exportacion(
  p_channel_id uuid, p_ids uuid[], p_courier text, p_marca text,
  p_reexportar jsonb default '{}'::jsonb
) returns uuid[] language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  if not owns_channel(p_channel_id) then raise exception 'no autorizado'; end if;
  with sellados as (
    update orders o
       set shipping = (coalesce(o.shipping, '{}'::jsonb) - 'exportado_prev')
                      || jsonb_build_object('exportado_at', p_marca, 'exportado_a', p_courier)
                      || case when coalesce(o.shipping->>'exportado_at', '') <> ''
                              then jsonb_build_object('exportado_prev',
                                     jsonb_build_object('at', o.shipping->>'exportado_at', 'a', o.shipping->>'exportado_a'))
                              else '{}'::jsonb end
     where o.channel_id = p_channel_id
       and o.id = any(p_ids)
       and ( coalesce(o.shipping->>'exportado_at', '') = ''
             or coalesce(p_reexportar, '{}'::jsonb) ->> (o.id::text) = o.shipping->>'exportado_at' )
     returning o.id)
  select coalesce(array_agg(id), '{}'::uuid[]) into v_ids from sellados;
  return v_ids;
end $$;
--##--
-- Deshace SOLO el sello con esa marca (el que puso esta pestaña). Si otro lo volvió a sellar
-- después, no se toca. Restaura el sello anterior si el operador estaba reexportando.
create or replace function orders_quitar_sello_exportacion(
  p_channel_id uuid, p_ids uuid[], p_marca text
) returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not owns_channel(p_channel_id) then raise exception 'no autorizado'; end if;
  update orders o
     set shipping = (o.shipping - 'exportado_at' - 'exportado_a' - 'exportado_prev')
                    || case when o.shipping ? 'exportado_prev'
                            then jsonb_build_object('exportado_at', o.shipping->'exportado_prev'->>'at',
                                                    'exportado_a',  o.shipping->'exportado_prev'->>'a')
                            else '{}'::jsonb end
   where o.channel_id = p_channel_id
     and o.id = any(p_ids)
     and o.shipping->>'exportado_at' = p_marca;
  get diagnostics n = row_count;
  return n;
end $$;
--##--
grant execute on function public.orders_sellar_exportacion(uuid, uuid[], text, text, jsonb) to authenticated;
--##--
grant execute on function public.orders_quitar_sello_exportacion(uuid, uuid[], text) to authenticated;
