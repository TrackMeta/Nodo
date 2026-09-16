-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0095 — listar los archivos de Storage de UN bot para borrarlos con él.
--
-- Borrar un canal arrastra en cascada más de treinta tablas, pero los archivos de
-- Storage se quedaban: los adjuntos que envió (bucket `media`, carpeta
-- acct/<cuenta>/chat/<canal>/) y todo lo que le mandaron sus clientes (bucket
-- `comprobantes`, carpeta <cuenta>/<contacto>/). El de comprobantes ni siquiera lo
-- barre el recolector, así que quedaban fotos y Yapes de un negocio que ya no existe.
--
-- Misma rendija que nodo_media_objetos (0083): nombre y tamaño, de un bucket, solo
-- bajo los prefijos pedidos. SECURITY DEFINER y solo service_role.
-- ═══════════════════════════════════════════════════════════════════

drop function if exists nodo_objetos_por_prefijo(text, text[], int, int);

create or replace function nodo_objetos_por_prefijo(
  p_bucket   text,
  p_prefijos text[],
  p_limite   int default 1000,
  p_desde    int default 0
)
returns table (nombre text, bytes bigint)
language sql
security definer
set search_path = storage, public
as $$
  select o.name,
         coalesce((o.metadata->>'size')::bigint, 0)
    from storage.objects o
   where o.bucket_id = p_bucket
     and exists (select 1 from unnest(p_prefijos) p where o.name like p || '%')
   order by o.name asc
   limit greatest(1, least(coalesce(p_limite, 1000), 1000))
  offset greatest(0, coalesce(p_desde, 0));
$$;

revoke all on function nodo_objetos_por_prefijo(text, text[], int, int) from public;
revoke all on function nodo_objetos_por_prefijo(text, text[], int, int) from anon;
revoke all on function nodo_objetos_por_prefijo(text, text[], int, int) from authenticated;
grant execute on function nodo_objetos_por_prefijo(text, text[], int, int) to service_role;
