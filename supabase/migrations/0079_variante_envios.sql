-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0079 — Qué variante de copy rinde mejor
--
--   El rotador de mensajes iniciales y los pasos de secuencia ya reparten
--   variantes AL AZAR por peso, o sea que el experimento ya está corriendo.
--   Lo que faltaba era el registro: del inicial solo quedaba una nota suelta
--   en la bitácora del contacto ("🎲 Variante inicial · A"), imposible de
--   sumar, y del remarketing no quedaba NADA.
--
--   Una fila por envío con variante. Todo el reporte sale de acá.
--
--   Dos cosas que hacen que el dato sirva de verdad:
--     · `variante_id` — la variante se identificaba por su NOMBRE (editable) y
--       su posición en la lista, así que renombrarla o reordenarla mezclaba
--       series. El id nace con ella y no cambia nunca.
--     · `variante_rev` — sube cuando cambia el TEXTO. Si reescribes una
--       variante, sus resultados viejos son de un copy que ya no existe:
--       contar por (id, rev) hace que la medición arranque de cero sola, en
--       vez de corromperse en silencio.
--
--   `angulo` viaja en la fila porque las variantes se filtran por ángulo del
--   anuncio: comparar una de "oferta" contra una general mediría el ANUNCIO,
--   no el copy. El reporte solo compara dentro del mismo ángulo.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists variante_envios (
  id            uuid primary key default gen_random_uuid(),
  channel_id    uuid not null references channels(id) on delete cascade,
  contact_id    uuid not null references contacts(id) on delete cascade,
  -- 'inicial' = rotador de mensajes iniciales · 'secuencia' = paso de remarketing
  ambito        text not null check (ambito in ('inicial','secuencia')),
  ref_id        uuid,                    -- flow_id o sequence_id, según el ámbito
  paso          int,                     -- índice del paso (solo secuencias)
  variante_id   text not null,
  variante_rev  int  not null default 1,
  variante_nom  text,                    -- nombre al momento del envío (para leer el histórico)
  angulo        text,                    -- slug del ángulo del contacto, si vino por anuncio
  enviado_at    timestamptz not null default now(),
  -- Se llenan después: el cliente contesta / compra. La compra se atribuye al
  -- ÚLTIMO envío con variante dentro de la ventana (7 días); si se contara a
  -- todos los toques, cada variante parecería el triple de buena de lo que es.
  respondio_at  timestamptz,
  compro_at     timestamptz,
  monto         numeric(12,2)
);

-- El reporte: todas las filas de un canal en una ventana de fechas.
create index if not exists idx_venv_channel on variante_envios(channel_id, enviado_at desc);
-- Marcar la respuesta/compra: el último envío sin responder de ESE contacto.
create index if not exists idx_venv_contact on variante_envios(contact_id, enviado_at desc);
-- Agregación por variante (el número que se pinta al lado de cada copy).
create index if not exists idx_venv_variante on variante_envios(channel_id, variante_id, variante_rev);

alter table variante_envios enable row level security;
drop policy if exists variante_envios_tenant on variante_envios;
create policy variante_envios_tenant on variante_envios
  for all using (owns_channel(channel_id)) with check (owns_channel(channel_id));
