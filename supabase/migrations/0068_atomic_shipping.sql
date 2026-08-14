-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0068 — Escritura ATÓMICA y parcial de orders.shipping
--
-- PROBLEMA (Adversarial#4): el motor edita `shipping` (JSONB) con un
-- read-modify-write en JS: lee la fila, arma `{ ...ship, campo:valor }` y la
-- reescribe ENTERA. Si DOS requests distintos tocan el mismo pedido a la vez
-- —el clásico: apruebas el adelanto a mano (order-update / Telegram) MIENTRAS
-- entra un mensaje del cliente que cambia la sede (maybeCambioSede)— el segundo
-- en escribir parte de una copia RANCIA y PISA lo que el otro acababa de
-- guardar. Resultado: la sede nueva (o el comprobante, o el stock_mov) se pierde
-- en silencio. El row-lock de Postgres no ayuda porque cada lado lee ANTES de
-- que el otro escriba.
--
-- SOLUCIÓN: mover la fusión al servidor, donde un solo UPDATE (con su row-lock)
-- es atómico. `||` sobre jsonb es un merge superficial: dos llamadas que tocan
-- CLAVES distintas ya no se pisan; si tocan la MISMA, gana la última, que es lo
-- correcto (no un valor calculado sobre datos viejos).
--
-- Ambas funciones son SECURITY DEFINER y las llama SOLO el backend con la llave
-- service_role (las Edge Functions). Se revoca a anon/authenticated: el panel no
-- las necesita (edita pedidos vía order-update, no directo).
-- ═══════════════════════════════════════════════════════════════════

-- order_patch_shipping: fusiona `p_patch` dentro de shipping y (opcional) borra
-- las claves de `p_remove`, en un único UPDATE atómico. Devuelve el shipping
-- resultante (null si el pedido no existe). Reemplaza el `{ ...ship, ... }`.
create or replace function order_patch_shipping(
  p_order_id uuid,
  p_patch    jsonb default '{}'::jsonb,
  p_remove   text[] default '{}'::text[]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ship jsonb;
begin
  update orders
     set shipping   = (coalesce(shipping, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb)) - p_remove,
         updated_at = now()
   where id = p_order_id
  returning shipping into v_ship;
  return v_ship;
end $$;
--##--

-- order_claim_stock: reserva de stock IDEMPOTENTE en un solo UPDATE condicional.
-- Sustituye el read-then-write de reservarStockPedido (leer shipping → chequear
-- stock_descontado → escribir), que permitía que el OCR auto-validando el
-- adelanto y una aprobación manual descontaran DOS veces el mismo pedido.
--
-- Gana el claim solo si: aún NO está descontado Y hay un stock_mov_plan (array
-- no vacío). Al ganar: promueve el plan a stock_mov, marca stock_descontado y
-- borra el plan — todo atómico. Devuelve el plan (para que el motor aplique el
-- descuento en products); devuelve null si ya estaba reservado o no había plan
-- (→ el motor no descuenta). Si el descuento posterior falla, el motor revierte
-- con order_patch_shipping (restaura el plan y baja la bandera).
create or replace function order_claim_stock(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_plan jsonb;
begin
  update orders
     set shipping   = (shipping
                        || jsonb_build_object('stock_mov', shipping->'stock_mov_plan', 'stock_descontado', true))
                        - 'stock_mov_plan',
         updated_at = now()
   where id = p_order_id
     and coalesce((shipping->>'stock_descontado')::boolean, false) = false
     and shipping ? 'stock_mov_plan'
     and jsonb_typeof(shipping->'stock_mov_plan') = 'array'
     and jsonb_array_length(shipping->'stock_mov_plan') > 0
  returning shipping->'stock_mov' into v_plan;
  return v_plan;   -- null si no ganó el claim (ya reservado / sin plan)
end $$;
--##--

revoke all on function order_patch_shipping(uuid, jsonb, text[]) from anon, authenticated, public;
revoke all on function order_claim_stock(uuid) from anon, authenticated, public;
