-- ══════════════════════════════════════════════════════
-- Nodo · 0110 — Cuándo LLEGÓ cada mensaje a Nodo (no cuándo lo fechó Meta)
--
-- `messages.ts` es la hora de Meta. Para decidir quién toma el turno en una ráfaga de textos
-- el webhook ordena por ts, y eso falla con un mensaje que Meta REINTENTA tarde (un 500 por un
-- hipo de la base): el texto A llega después de que B ya se contestó, ve a B como «el último»,
-- cede el turno… y A no se contesta nunca. Con la hora de llegada se sabe que B ya corrió sin A.
-- ══════════════════════════════════════════════════════

alter table public.messages add column if not exists created_at timestamptz not null default now();
