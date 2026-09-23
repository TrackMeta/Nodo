-- order_claim_shipping_flag: resuelve UNA sola vez algo que espera una decisión humana.
--
-- Primer uso: el pago adelantado de un pedido de Lima (`pago_adelantado_por_validar`). Se
-- aprueba desde el panel y desde Telegram, y el aviso de Telegram va a varios chats: sin
-- esto, dos toques (o panel + Telegram a la vez) acreditaban el MISMO Yape dos veces y el
-- motorizado cobraba de menos. El estado del pedido no cambia al aprobar (sigue
-- «confirmado»), así que no hay CAS por estado que lo frene — lo frena la marca.
--
-- Gana solo quien encuentra la marca en 'true': la mezcla `p_patch` (que debe apagarla) y
-- devuelve el shipping NUEVO. Si otro ya la resolvió, no toca nada y devuelve null.
create or replace function order_claim_shipping_flag(
  p_order_id uuid,
  p_flag     text,
  p_patch    jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ship jsonb;
begin
  update orders
     set shipping   = coalesce(shipping, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb),
         updated_at = now()
   where id = p_order_id
     and shipping ->> p_flag = 'true'
  returning shipping into v_ship;
  return v_ship;
end $$;

revoke all on function order_claim_shipping_flag(uuid, text, jsonb) from anon, authenticated, public;
