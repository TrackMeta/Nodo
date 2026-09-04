-- ══════════════════════════════════════════════════════
-- Nodo · 0088 — El gasto de IA, en el día que corresponde
--
-- La 0087 guarda el consumo bajo `(now() at time zone 'utc')::date`. Con la
-- tarjeta mostrando solo HOY y ESTE MES casi no se notaba, pero al ponerle un
-- filtro de fechas el desfase se ve: en Lima (UTC-5) todo lo que pasa de las
-- 7 de la noche en adelante se guardaba en el día SIGUIENTE. Un martes que
-- vendió hasta las 11pm mostraba su gasto repartido entre martes y miércoles,
-- y no cuadraba con el Dashboard ni con la Bitácora, que sí cortan los días en
-- la hora del negocio.
--
-- Ahora el día sale de la zona horaria del canal (la que el dueño eligió en
-- Ajustes), igual que todo lo demás que se mira por día. Si el canal no tiene
-- zona, se cae a America/Lima, que es la que ya usa el motor por defecto.
--
-- Lo ya guardado no se toca: son días UTC de un puñado de fechas y reescribirlos
-- sería inventar a qué hora ocurrió cada llamada dentro del acumulado del día.
-- ══════════════════════════════════════════════════════

create or replace function public.ai_usage_add(
  p_channel_id uuid,
  p_provider   text,
  p_model      text,
  p_origen     text,
  p_in         bigint,
  p_out        bigint,
  p_costo      numeric
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tz  text;
  v_dia date;
begin
  select nullif(trim(timezone), '') into v_tz from channels where id = p_channel_id;
  -- Una zona inválida en la fila reventaría el registro del consumo, y el contador
  -- no puede tumbar nada: si no se puede leer, se usa la de siempre.
  begin
    v_dia := (now() at time zone coalesce(v_tz, 'America/Lima'))::date;
  exception when others then
    v_dia := (now() at time zone 'America/Lima')::date;
  end;

  insert into ai_usage as u (channel_id, dia, provider, model, origen, llamadas, tokens_in, tokens_out, costo_usd, updated_at)
  values (
    p_channel_id, v_dia,
    coalesce(nullif(p_provider, ''), 'desconocido'),
    coalesce(nullif(p_model, ''), 'desconocido'),
    coalesce(nullif(p_origen, ''), 'otro'),
    1, greatest(coalesce(p_in, 0), 0), greatest(coalesce(p_out, 0), 0), greatest(coalesce(p_costo, 0), 0), now()
  )
  on conflict (channel_id, dia, provider, model, origen) do update set
    llamadas   = u.llamadas   + 1,
    tokens_in  = u.tokens_in  + excluded.tokens_in,
    tokens_out = u.tokens_out + excluded.tokens_out,
    costo_usd  = u.costo_usd  + excluded.costo_usd,
    updated_at = now();
end;
$fn$;

revoke all on function public.ai_usage_add(uuid, text, text, text, bigint, bigint, numeric) from public, anon, authenticated;
grant execute on function public.ai_usage_add(uuid, text, text, text, bigint, bigint, numeric) to service_role;
