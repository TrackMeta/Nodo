-- ══════════════════════════════════════════════════════
-- Nodo · 0109 — Anotar el rastreo sin reiniciar el reloj del pedido
--
-- `orders.updated_at` es lo que mide cuánto lleva un pedido en su estado: la insignia de
-- «pedido parado» (Shalom lo puede devolver), los recordatorios por estado del scheduler y
-- el filtro de período de Exportar/Rótulos. La extensión de rastreo (courier-sync) revisa
-- cada guía cada 4 h y anota «se miró» con order_patch_shipping, que ponía updated_at = now()
-- → un pedido 10 días en agencia nunca llegaba a los 5: ni insignia ni «recoge tu paquete».
--
-- p_touch = false: fusiona igual, sin tocar updated_at. Default true: los demás llamadores
-- quedan exactamente como estaban. Se borra y recrea (no sobrecarga) para que las llamadas
-- con 2 o 3 argumentos no queden ambiguas.
-- ══════════════════════════════════════════════════════

drop function if exists order_patch_shipping(uuid, jsonb, text[]);
--##--
create or replace function order_patch_shipping(
  p_order_id uuid,
  p_patch    jsonb default '{}'::jsonb,
  p_remove   text[] default '{}'::text[],
  p_touch    boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ship jsonb;
begin
  update orders
     set shipping   = (coalesce(shipping, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb)) - p_remove,
         updated_at = case when p_touch then now() else updated_at end
   where id = p_order_id
  returning shipping into v_ship;
  return v_ship;
end $$;
--##--
revoke all on function order_patch_shipping(uuid, jsonb, text[], boolean) from anon, authenticated, public;
