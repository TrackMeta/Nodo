-- ══════════════════════════════════════════════════════
-- Nodo · 0113 — Centro de notificaciones del panel (2026-09-28)
--
-- Hasta hoy los avisos vivían SOLO en Telegram: si no lo mirabas, te enterabas tarde de un pago
-- esperando o de un cliente que pidió una persona, y en un bot sin Telegram (Maestría Digital)
-- no le llegaban a nadie. Ahora TODO aviso que sale (o que no sale) por Telegram se guarda acá,
-- y el panel lo muestra en la campanita. Ver memoria «centro-notificaciones».
--
--  notificaciones          → un aviso por fila, del canal (bot). La ESCRIBE solo el motor
--                            (service role); el panel la lee por RLS y la cambia por RPC.
--  notificacion_lecturas   → «leído» es POR PERSONA (un operador lo leyó, a ti te sigue saliendo).
--  notificacion_usuario    → por persona: hasta cuándo marcó todo como leído + sus preferencias
--                            (sonido, navegador, tipos ocultos). «Resuelto» sí es global.
-- ══════════════════════════════════════════════════════

create table if not exists public.notificaciones (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references public.channels(id) on delete cascade,
  contact_id    uuid references public.contacts(id) on delete set null,
  order_id      uuid references public.orders(id) on delete set null,
  tipo          text not null,                          -- clave del aviso (avisos.ts) o una propia del sistema
  grupo         text not null default 'sistema' check (grupo in ('pagos','ventas','atencion','sistema')),
  prioridad     text not null default 'info' check (prioridad in ('urgente','importante','info')),
  titulo        text not null,
  detalle       text,
  datos         jsonb not null default '{}'::jsonb,
  por_atender   boolean not null default false,         -- espera una acción de una persona
  resuelta_at   timestamptz,
  resuelta_por  text,                                   -- 'bot' | 'telegram' | nombre de quien lo hizo
  repeticiones  integer not null default 1,             -- avisos iguales seguidos se juntan (×3)
  dedupe_key    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
--##--
create index if not exists notificaciones_canal_fecha on public.notificaciones (channel_id, created_at desc);
--##--
create index if not exists notificaciones_pendientes on public.notificaciones (channel_id, created_at desc)
  where por_atender and resuelta_at is null;
--##--
create index if not exists notificaciones_dedupe on public.notificaciones (dedupe_key, created_at desc) where dedupe_key is not null;
--##--
create index if not exists notificaciones_contacto on public.notificaciones (contact_id) where contact_id is not null;
--##--
create index if not exists notificaciones_pedido on public.notificaciones (order_id) where order_id is not null;
--##--
alter table public.notificaciones enable row level security;
--##--
drop policy if exists notificaciones_sel on public.notificaciones;
--##--
create policy notificaciones_sel on public.notificaciones for select using (owns_channel(channel_id));
--##--
grant select on public.notificaciones to authenticated;
--##--
create table if not exists public.notificacion_lecturas (
  user_id          uuid not null references auth.users(id) on delete cascade,
  notificacion_id  uuid not null references public.notificaciones(id) on delete cascade,
  leida_at         timestamptz not null default now(),
  primary key (user_id, notificacion_id)
);
--##--
alter table public.notificacion_lecturas enable row level security;
--##--
drop policy if exists notificacion_lecturas_propias on public.notificacion_lecturas;
--##--
create policy notificacion_lecturas_propias on public.notificacion_lecturas for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
--##--
grant select, insert, delete on public.notificacion_lecturas to authenticated;
--##--
create table if not exists public.notificacion_usuario (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  leidas_hasta   timestamptz not null default '2000-01-01',
  prefs          jsonb not null default '{}'::jsonb,   -- {sonido:bool, navegador:bool, ocultos:[tipo...]}
  updated_at     timestamptz not null default now()
);
--##--
alter table public.notificacion_usuario enable row level security;
--##--
drop policy if exists notificacion_usuario_propio on public.notificacion_usuario;
--##--
create policy notificacion_usuario_propio on public.notificacion_usuario for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
--##--
grant select, insert, update on public.notificacion_usuario to authenticated;
--##--
-- Marcar como resuelta desde el panel («Marcar como atendido»). Solo miembros del canal.
create or replace function public.notif_resolver(p_id uuid, p_por text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_canal uuid;
begin
  select channel_id into v_canal from notificaciones where id = p_id;
  if v_canal is null or not owns_channel(v_canal) then return false; end if;
  update notificaciones
     set resuelta_at = coalesce(resuelta_at, now()),
         resuelta_por = coalesce(resuelta_por, nullif(trim(coalesce(p_por, '')), ''),
                                 (select nombre from app_users where id = auth.uid()), 'panel'),
         updated_at = now()
   where id = p_id;
  insert into notificacion_lecturas (user_id, notificacion_id) values (auth.uid(), p_id)
    on conflict do nothing;
  return true;
end $$;
--##--
revoke all on function public.notif_resolver(uuid, text) from public, anon;
--##--
grant execute on function public.notif_resolver(uuid, text) to authenticated;
--##--
-- «Marcar todo como leído»: mueve el corte de la persona y limpia sus lecturas sueltas anteriores.
create or replace function public.notif_marcar_todas()
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_ahora timestamptz := now();
begin
  if auth.uid() is null then return null; end if;
  insert into notificacion_usuario (user_id, leidas_hasta, updated_at) values (auth.uid(), v_ahora, v_ahora)
    on conflict (user_id) do update set leidas_hasta = excluded.leidas_hasta, updated_at = excluded.updated_at;
  delete from notificacion_lecturas l using notificaciones n
   where l.user_id = auth.uid() and l.notificacion_id = n.id and n.created_at <= v_ahora;
  return v_ahora;
end $$;
--##--
revoke all on function public.notif_marcar_todas() from public, anon;
--##--
grant execute on function public.notif_marcar_todas() to authenticated;
--##--
alter publication supabase_realtime add table public.notificaciones;
--##--
-- 60 días y se van (el detalle de cada caso sigue en la Actividad del contacto y en Pedidos).
select cron.unschedule('nodo-notificaciones-gc')
 where exists (select 1 from cron.job where jobname = 'nodo-notificaciones-gc');
--##--
select cron.schedule('nodo-notificaciones-gc', '23 9 * * *',
  $cmd$ delete from public.notificaciones where created_at < now() - interval '60 days' $cmd$);
