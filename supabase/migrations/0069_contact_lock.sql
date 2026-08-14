-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0069 — Lock por contacto (serializa el procesamiento concurrente)
--
-- PROBLEMA: dos eventos del MISMO contacto pueden procesarse a la vez (dos
-- mensajes muy seguidos que Meta entrega casi juntos, o un mensaje entrante
-- mientras order-update/Telegram toca su pedido). El motor (`execute`) no toma
-- lock de fila y solo persiste el run al await/fin → dos corridas simultáneas
-- pueden duplicar efectos (doble bump, doble avance de nodo) o pisarse el run.
--
-- Los daños concretos de plata ya están tapados por guards idempotentes:
--   · doble descuento de stock  → order_claim_stock (0068) + stock_descontado
--   · doble aprobación de pago   → reclamarOperacion + índice único (0035)
--   · clobber de shipping        → order_patch_shipping (0068)
-- Este lock es la red de seguridad GENERAL: garantiza un solo handler por
-- contacto a la vez, cerrando también los casos que no tienen guard propio.
--
-- Diseño: lock con TTL auto-sanable (si un worker muere, el lock vence solo).
-- El UPSERT condicional es atómico (una sola sentencia) → sin carrera.
--
-- ── WIRING RECOMENDADO (motor, runEngine) — NO cablear a ciegas ──────
-- El cableado va en el HOT-PATH de cada mensaje; hacerlo mal puede tragarse un
-- mensaje o dejar un contacto mudo. Regla de oro: NUNCA descartar el evento.
--   const holder = <token único por invocación>;
--   let locked = false;
--   try { locked = await tryLock(channel, contact, 60, holder); } catch { locked = false; }
--   // Si NO se obtuvo (otro lo tiene, o pre-migración la RPC no existe):
--   //   opción segura = PROCEDER IGUAL (degrada al comportamiento de hoy),
--   //   nunca return/drop. Opcional: reintentar 2-3 veces con ~250ms de espera
--   //   para atrapar solapamientos cortos antes de proceder.
--   try { ...runEngine... }
--   finally { if (locked) await releaseLock(channel, contact, holder).catch(()=>{}); }
-- Verificar en vivo con dos mensajes disparados en paralelo antes de confiar en
-- la serialización (el harness es secuencial y solo prueba el camino feliz).
-- ═══════════════════════════════════════════════════════════════════

create table if not exists contact_locks (
  channel_id   uuid not null references channels(id) on delete cascade,
  contact_id   uuid not null references contacts(id) on delete cascade,
  locked_until timestamptz not null,
  holder       text,                       -- token del dueño actual (debug + release seguro)
  primary key (channel_id, contact_id)
);
--##--

-- contact_lock_try: toma el lock por p_ttl_seconds. Devuelve true si lo tomó
-- (nuevo, o el previo YA venció); false si otro lo tiene vigente. El
-- INSERT…ON CONFLICT DO UPDATE…WHERE(vencido) es una sola sentencia atómica.
create or replace function contact_lock_try(
  p_channel_id uuid, p_contact_id uuid,
  p_ttl_seconds int default 60, p_holder text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_got boolean;
begin
  insert into contact_locks (channel_id, contact_id, locked_until, holder)
  values (p_channel_id, p_contact_id, now() + make_interval(secs => p_ttl_seconds), p_holder)
  on conflict (channel_id, contact_id) do update
     set locked_until = excluded.locked_until, holder = excluded.holder
   where contact_locks.locked_until < now()      -- re-tomar SOLO si el previo venció
  returning true into v_got;
  return coalesce(v_got, false);
end $$;
--##--

-- contact_lock_release: suelta el lock, pero SOLO si aún somos el dueño
-- (holder coincide) o ya venció → nunca borra el lock que otro handler retomó
-- (importante cuando el camino de contención decidió proceder sin el lock).
create or replace function contact_lock_release(
  p_channel_id uuid, p_contact_id uuid, p_holder text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from contact_locks
   where channel_id = p_channel_id and contact_id = p_contact_id
     and (holder is not distinct from p_holder or locked_until < now());
end $$;
--##--

revoke all on function contact_lock_try(uuid, uuid, int, text) from anon, authenticated, public;
revoke all on function contact_lock_release(uuid, uuid, text) from anon, authenticated, public;
