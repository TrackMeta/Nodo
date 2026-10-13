-- ═══════════════════════════════════════════════════════════════════
-- 0137 · App de celular: avisos con la app cerrada (Firebase Cloud Messaging)
--   · push_dispositivos: un celular registrado por fila (token de FCM), de UNA persona.
--   · Cada notificación que nace (INSERT) o se repite (UPDATE de created_at, ver
--     registrarNotificacion) llama a la función edge `push` por pg_net, que decide a
--     quién le suena según «Qué avisos me llegan» (notificacion_usuario.prefs.app).
--   · La URL y el secreto viven en Vault (push_url / push_secret): el repo es público.
--     Sin ellos (o sin celulares registrados) el disparador no hace nada.
-- ═══════════════════════════════════════════════════════════════════
create table if not exists public.push_dispositivos (
  token       text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  plataforma  text not null default 'android',
  modelo      text,
  app_version text,
  creado_at   timestamptz not null default now(),
  visto_at    timestamptz not null default now()
);
create index if not exists push_dispositivos_user_idx on public.push_dispositivos(user_id);
alter table public.push_dispositivos enable row level security;
drop policy if exists push_dispositivos_propios on public.push_dispositivos;
create policy push_dispositivos_propios on public.push_dispositivos
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
--##--
create or replace function public.notif_push_disparar() returns trigger
language plpgsql security definer set search_path = public, vault as $$
declare v_url text; v_secret text;
begin
  -- Un repetido sin «created_at» nuevo (dentro de los 2 min) no vuelve a sonar.
  if tg_op = 'UPDATE' and new.created_at is not distinct from old.created_at then return new; end if;
  if not exists (select 1 from public.push_dispositivos limit 1) then return new; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_secret' limit 1;
  if v_url is null or v_secret is null then return new; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := jsonb_build_object('notificacion_id', new.id),
    timeout_milliseconds := 15000);
  return new;
exception when others then
  return new;   -- el aviso al celular nunca puede frenar a la notificación
end $$;
revoke all on function public.notif_push_disparar() from public, anon, authenticated;
--##--
drop trigger if exists trg_notif_push on public.notificaciones;
create trigger trg_notif_push after insert or update of created_at on public.notificaciones
  for each row execute function public.notif_push_disparar();
