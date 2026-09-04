-- ══════════════════════════════════════════════════════
-- Nodo · 0087 — Cuánto gasta tu IA
--
-- Hasta hoy el consumo de IA solo se veía en el panel de OpenAI: un número
-- global de la API key, sin separar por negocio ni por para qué se usó. Sirve
-- para pagar la factura y para nada más — ni para saber si un canal se disparó,
-- ni para cobrarle a cada cliente lo suyo cuando Nodo tenga varios.
--
-- El dato ya existe y se estaba tirando: cada respuesta del proveedor trae el
-- conteo exacto de tokens de esa llamada. Acá se guarda.
--
-- 📊 ACUMULADO, no una fila por llamada. A 4.000 chats diarios serían ~60.000
-- llamadas al día: guardar cada una convierte la tabla en el problema. Se suma
-- por (canal, día, modelo, para qué), que son unas pocas filas por negocio y
-- por día, y alcanza para todo lo que se quiere mirar.
--
-- 💵 Se guardan los TOKENS (el hecho) y además el costo calculado con la tarifa
-- del momento (la interpretación). Si mañana cambian los precios, el histórico
-- no se deforma: lo que costó en agosto siguió costando eso.
--
-- 🔒 Nunca se guarda una palabra de las conversaciones. Solo números.
-- ══════════════════════════════════════════════════════

create table if not exists ai_usage (
  channel_id uuid        not null references channels(id) on delete cascade,
  dia        date        not null,
  provider   text        not null,
  model      text        not null,
  -- Para qué se usó: vender | extraer | clasificar | ocr | stt | asistente | otro
  origen     text        not null default 'otro',
  llamadas   integer     not null default 0,
  tokens_in  bigint      not null default 0,
  tokens_out bigint      not null default 0,
  costo_usd  numeric(12,6) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (channel_id, dia, provider, model, origen)
);

-- El panel siempre pregunta "lo de este canal, de tal fecha para acá".
create index if not exists idx_ai_usage_canal_dia on ai_usage(channel_id, dia desc);

alter table ai_usage enable row level security;

-- Cada quien ve el consumo de SUS canales. Nadie escribe desde el panel: las
-- filas las pone el motor con la service key (que se salta RLS), así que no hay
-- política de insert/update a propósito — el consumo no se edita a mano.
drop policy if exists ai_usage_sel on ai_usage;
create policy ai_usage_sel on ai_usage for select using (owns_channel(channel_id));

--##--

-- ── ai_usage_add(): suma una llamada al acumulado del día ────────────
-- Un solo statement atómico: dos invocaciones simultáneas del motor (que es lo
-- normal con varios chats a la vez) no se pisan ni pierden llamadas.
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
  insert into ai_usage as u (channel_id, dia, provider, model, origen, llamadas, tokens_in, tokens_out, costo_usd, updated_at)
  values (
    p_channel_id, (now() at time zone 'utc')::date,
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
$fn$;

-- Solo el motor (service key) registra consumo. El panel únicamente lee la tabla.
revoke all on function public.ai_usage_add(uuid, text, text, text, bigint, bigint, numeric) from public, anon, authenticated;
grant execute on function public.ai_usage_add(uuid, text, text, text, bigint, bigint, numeric) to service_role;
