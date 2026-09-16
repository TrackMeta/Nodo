-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0094 — «Envió imagen» también cuenta el comprobante mandado como DOCUMENTO.
--
-- El webhook trata un documento con mime de imagen o PDF como IMAGEN (el Yape en PDF
-- es lo más común en Perú) y el motor lo pasa por OCR, pero el trigger que sella
-- contacts.ultima_imagen_at solo miraba type='image': ese contacto no salía en el filtro
-- «Envió imagen» de Bandeja/Contactos aunque sí hubiera mandado su comprobante.
-- ═══════════════════════════════════════════════════════════════════
create or replace function bump_ultima_imagen() returns trigger
language plpgsql as $$
begin
  if new.direction = 'in' and (
       new.type = 'image'
    or (new.type = 'document' and coalesce(new.content->>'mime_type', '') ~* '^(image/|application/pdf)')
  ) then
    update contacts set ultima_imagen_at = new.ts where id = new.contact_id;
  end if;
  return new;
end;
$$;

-- Backfill de los documentos-imagen que ya llegaron.
update contacts c
   set ultima_imagen_at = greatest(coalesce(c.ultima_imagen_at, m.maxts), m.maxts)
  from (select contact_id, max(ts) as maxts
          from messages
         where direction = 'in' and type = 'document'
           and coalesce(content->>'mime_type', '') ~* '^(image/|application/pdf)'
         group by contact_id) m
 where m.contact_id = c.id;
