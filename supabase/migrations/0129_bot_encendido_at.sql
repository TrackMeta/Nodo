-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0129 — Cuándo se PRENDIÓ el bot (Canales → «Bot encendido»).
--
-- 7-oct: Dida escribió a Prime Digital con el bot APAGADO (bien: no se le contestó). Rodrigo prendió el bot
-- minutos después y el vigilante «⏰ El bot no respondió» (scheduler, processSinRespuesta) vio un mensaje
-- de hace 12 min sin respuesta con el bot ya encendido: creyó que el bot se había cortado a mitad de turno,
-- la pasó a una persona y le mandó «En un momento te atiende un asesor». Ese silencio era a propósito.
--
-- bot_encendido_at = el momento en que bot_apagado pasó de true a false. El vigilante no toca los mensajes
-- que llegaron ANTES de eso (llegaron con el bot apagado: los contesta el dueño o el próximo mensaje).
-- ═══════════════════════════════════════════════════════════════════
alter table public.channels add column if not exists bot_encendido_at timestamptz;

create or replace function public.sellar_bot_encendido() returns trigger
language plpgsql as $$
begin
  if coalesce(old.bot_apagado, false) = true and coalesce(new.bot_apagado, false) = false then
    new.bot_encendido_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sellar_bot_encendido on public.channels;
create trigger trg_sellar_bot_encendido before update of bot_apagado on public.channels
  for each row execute function public.sellar_bot_encendido();

-- 0073: el SELECT de channels va columna por columna.
grant select (bot_encendido_at) on public.channels to authenticated, anon;

-- Prime Digital se prendió el 7-oct entre las 07:36 (el mensaje de Dida entró sin respuesta) y las 07:48 (UTC).
update public.channels set bot_encendido_at = '2026-10-07 07:45:00+00'
 where id = 'f5e85bad-11c1-41ac-99a4-77d59834de28' and bot_apagado = false and bot_encendido_at is null;
