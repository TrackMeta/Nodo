-- ══════════════════════════════════════════════════════
-- Nodo · 0091 — Los tokens CACHEADOS se pagan más barato, y no se contaban
--
-- `registraUso` tomaba `prompt_tokens` —el TOTAL de entrada— y lo multiplicaba
-- por la tarifa de entrada. Pero OpenAI cachea el prefijo repetido del prompt y
-- lo factura mucho más barato (gpt-4.1-mini: US$ 0.10/M contra 0.40/M). O sea:
-- el panel le cobraba al dueño el precio lleno por tokens que el proveedor le
-- cobró al 25%. El número mostrado NO era el de la factura.
--
-- Medido el 2026-09-08: la venta manda ~10.500 tokens de entrada por mensaje y
-- el 96% del gasto es entrada. Cualquier error en cómo se cobra la entrada es
-- el error de todo el módulo.
--
-- 📊 Se guarda `tokens_cache` aparte de `tokens_in` (no se resta): `tokens_in`
-- sigue siendo el total que entró —el hecho— y `tokens_cache` dice cuánto de eso
-- vino del caché. Así se puede ver el % de acierto sin deformar el histórico, que
-- es justo el dato que hace falta para decidir si vale la pena reordenar el
-- prompt (hoy los bloques variables van al principio y cortan el caché temprano).
-- ══════════════════════════════════════════════════════

alter table ai_usage add column if not exists tokens_cache bigint not null default 0;

--##--

-- ── ai_usage_add(): ahora también acumula los tokens cacheados ───────
-- ⚠️ Firma NUEVA (8 argumentos) en vez de cambiar la de 7: durante el despliegue
-- conviven el motor viejo y el nuevo unos segundos, y si se le cambia la firma a
-- la existente el motor viejo empieza a fallar al registrar. Con las dos, cada
-- uno llama a la suya. La de 7 queda delegando en la de 8 con cache = 0, así que
-- la lógica vive en UN solo sitio.
create or replace function public.ai_usage_add(
  p_channel_id uuid,
  p_provider   text,
  p_model      text,
  p_origen     text,
  p_in         bigint,
  p_out        bigint,
  p_costo      numeric,
  p_cache      bigint
) returns void
language sql
security definer
set search_path = public
as $fn$
  insert into ai_usage as u (channel_id, dia, provider, model, origen, llamadas, tokens_in, tokens_out, tokens_cache, costo_usd, updated_at)
  values (
    p_channel_id, (now() at time zone 'utc')::date,
    coalesce(nullif(p_provider, ''), 'desconocido'),
    coalesce(nullif(p_model, ''), 'desconocido'),
    coalesce(nullif(p_origen, ''), 'otro'),
    1, greatest(coalesce(p_in, 0), 0), greatest(coalesce(p_out, 0), 0),
    greatest(coalesce(p_cache, 0), 0), greatest(coalesce(p_costo, 0), 0), now()
  )
  on conflict (channel_id, dia, provider, model, origen) do update set
    llamadas     = u.llamadas     + 1,
    tokens_in    = u.tokens_in    + excluded.tokens_in,
    tokens_out   = u.tokens_out   + excluded.tokens_out,
    tokens_cache = u.tokens_cache + excluded.tokens_cache,
    costo_usd    = u.costo_usd    + excluded.costo_usd,
    updated_at   = now();
$fn$;

create or replace function public.ai_usage_add(
  p_channel_id uuid,
  p_provider   text,
  p_model      text,
  p_origen     text,
  p_in         bigint,
  p_out        bigint,
  p_costo      numeric
) returns void
language sql
security definer
set search_path = public
as $fn$
  select public.ai_usage_add(p_channel_id, p_provider, p_model, p_origen, p_in, p_out, p_costo, 0::bigint);
$fn$;

revoke all on function public.ai_usage_add(uuid, text, text, text, bigint, bigint, numeric, bigint) from public, anon, authenticated;
grant execute on function public.ai_usage_add(uuid, text, text, text, bigint, bigint, numeric, bigint) to service_role;
