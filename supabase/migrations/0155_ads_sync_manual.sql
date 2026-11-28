-- 0155 · Actualizar los anuncios a pedido (28-nov-2026, Rodrigo: «¿hay manera de actualizarlo yo sin esperar la hora?»
-- → «que solo se pueda 2 veces por hora»). Cada vez que alguien toca «Actualizar anuncios» en el Banco de anuncios queda
-- una fila; ads-sync cuenta las de la última hora del bot y no deja pasar de 2. Solo la usa la función (service_role):
-- RLS encendida y sin políticas = el panel no la lee ni la escribe.
create table if not exists public.ads_sync_manual (
  id bigserial primary key,
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid,
  at timestamptz not null default now()
);
create index if not exists ads_sync_manual_canal_at on public.ads_sync_manual (channel_id, at desc);
alter table public.ads_sync_manual enable row level security;
