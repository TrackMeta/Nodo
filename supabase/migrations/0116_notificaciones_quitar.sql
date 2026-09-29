-- ══════════════════════════════════════════════════════
-- Nodo · 0116 — Quitar notificaciones de MI campanita (2026-09-28)
--
-- Pedido de Rodrigo: «hagamos algo con las notificaciones que no desaparecen». Decidió: una × por
-- notificación + «Limpiar» (todo lo leído/resuelto de golpe) + limpieza sola a los 7 días (esa la
-- hace el panel). Quitar es POR PERSONA, como «leído»: no le borra nada al resto del equipo.
--
-- Se guarda en notificacion_lecturas (quitada_at). Si el mismo aviso se REPITE (×2), el motor borra
-- las lecturas de esa fila (_shared/notificaciones.ts) y vuelve a aparecer: es una novedad.
-- ══════════════════════════════════════════════════════

alter table public.notificacion_lecturas add column if not exists quitada_at timestamptz;
--##--
-- Quitar varias de una (la × y «Limpiar»). Solo notificaciones de canales tuyos.
create or replace function public.notif_quitar(p_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if auth.uid() is null then return 0; end if;
  insert into notificacion_lecturas (user_id, notificacion_id, leida_at, quitada_at)
  select auth.uid(), n.id, now(), now()
    from notificaciones n
   where n.id = any(p_ids) and owns_channel(n.channel_id)
  on conflict (user_id, notificacion_id) do update set quitada_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
--##--
revoke all on function public.notif_quitar(uuid[]) from public, anon;
--##--
grant execute on function public.notif_quitar(uuid[]) to authenticated;
--##--
-- «Marcar todo como leído» limpiaba TODAS las lecturas anteriores al corte: se llevaba también las
-- quitadas y reaparecían. Ahora solo borra las lecturas sueltas (las quitadas se quedan).
create or replace function public.notif_marcar_todas()
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_ahora timestamptz := now();
begin
  if auth.uid() is null then return null; end if;
  insert into notificacion_usuario (user_id, leidas_hasta, updated_at) values (auth.uid(), v_ahora, v_ahora)
    on conflict (user_id) do update set leidas_hasta = excluded.leidas_hasta, updated_at = excluded.updated_at;
  delete from notificacion_lecturas l using notificaciones n
   where l.user_id = auth.uid() and l.notificacion_id = n.id and n.created_at <= v_ahora and l.quitada_at is null;
  return v_ahora;
end $$;
