-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0083 — asomarse a los archivos de Storage para poder recogerlos.
--
-- El bucket `media` solo crecía: borrar un chat, un contacto o un producto quita
-- la REFERENCIA, pero el archivo se queda en el disco para siempre. Medido:
-- 1005 objetos, 42 MB, y solo UNO seguía en uso.
--
-- Se pagina (p_desde) porque PostgREST corta toda respuesta en 1000 filas y el
-- bucket ya pasa de eso: sin offset, el recolector veria siempre las mismas 1000.
--
-- Para barrerlos hay que poder listarlos, y `storage.objects` no está expuesto
-- por PostgREST (a propósito: es el catálogo de todos los archivos). En vez de
-- abrir el esquema entero, se abre esta rendija: nombre, fecha y tamaño de UN
-- bucket, sin URL firmada ni forma de leer el contenido. Solo lo que el
-- recolector necesita para decidir.
--
-- SECURITY DEFINER + REVOKE a todo el mundo: la única que puede llamarla es la
-- Edge Function `media-gc`, que corre con service_role. Ni el panel ni un
-- anónimo pueden inventariar los archivos de nadie.
-- ═══════════════════════════════════════════════════════════════════

drop function if exists nodo_media_objetos(text, timestamptz, int);

create or replace function nodo_media_objetos(
  p_bucket text,
  p_antes  timestamptz,
  p_limite int default 500,
  p_desde  int default 0
)
returns table (nombre text, creado timestamptz, bytes bigint)
language sql
security definer
set search_path = storage, public
as $$
  select o.name,
         o.created_at,
         coalesce((o.metadata->>'size')::bigint, 0)
    from storage.objects o
   where o.bucket_id = p_bucket
     and o.created_at < p_antes
   order by o.created_at asc
   limit greatest(1, least(coalesce(p_limite, 500), 1000))
  offset greatest(0, coalesce(p_desde, 0));
$$;

revoke all on function nodo_media_objetos(text, timestamptz, int, int) from public;
revoke all on function nodo_media_objetos(text, timestamptz, int, int) from anon;
revoke all on function nodo_media_objetos(text, timestamptz, int, int) from authenticated;
grant execute on function nodo_media_objetos(text, timestamptz, int, int) to service_role;
