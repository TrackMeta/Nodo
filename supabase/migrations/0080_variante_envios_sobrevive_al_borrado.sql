-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0080 — la medición de copys sobrevive al borrado de contactos
--
--   `variante_envios.contact_id` tenía ON DELETE CASCADE: borrar un contacto se
--   llevaba sus envíos, y con ellos la historia de qué copy le tocó.
--
--   El problema no es perder filas, es CÓMO se pierden. Cuando alguien limpia
--   contactos viejos borra sobre todo a los que NO contestaron (los que sí
--   respondieron son clientes y no se borran). O sea que desaparecen casi solo
--   no-respuestas: las tasas de todos los copys SUBEN de golpe, y sube más
--   la del copy que peor rendía, que es el que más silencios acumuló.
--   Métricas que cambian hacia atrás, hacia arriba, sin que nada lo diga.
--
--   Con SET NULL la fila queda: sin dueño, anónima (no guarda ningún dato
--   personal — solo qué variante salió y si hubo respuesta o compra), pero el
--   histórico deja de moverse solo. Las marcas de respuesta/compra siguen
--   funcionando igual: filtran por contact_id, y un NULL simplemente no calza.
-- ═══════════════════════════════════════════════════════════════════

alter table variante_envios alter column contact_id drop not null;

alter table variante_envios drop constraint if exists variante_envios_contact_id_fkey;
alter table variante_envios
  add constraint variante_envios_contact_id_fkey
  foreign key (contact_id) references contacts(id) on delete set null;
