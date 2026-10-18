-- 0138 · RLS rápida para las etiquetas y los campos de los contactos (auditoría 18-oct, zona 4).
--
-- Antes: `contact_id IN (SELECT id FROM contacts WHERE owns_channel(channel_id))`. Postgres armaba esa lista
-- recorriendo TODOS los contactos de la plataforma y llamando a owns_channel() (SECURITY DEFINER, no se puede
-- inlinear) dos veces por cada uno — en cada lectura del panel. Con 624 contactos: ~44 ms por contacto abierto;
-- crecía con los contactos de TODOS los negocios (con 50 negocios, 1-3 s).
--
-- Ahora: `my_channel_ids()` devuelve los canales del usuario UNA vez por consulta, y la política mira solo el
-- contacto de la fila (por su clave primaria). Misma regla de acceso: miembro activo de la cuenta dueña del canal.

create or replace function public.my_channel_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from channels c
  join account_members m on m.account_id = c.account_id
  where m.user_id = auth.uid() and m.activo
$$;

revoke all on function public.my_channel_ids() from public, anon;
grant execute on function public.my_channel_ids() to authenticated, service_role;

-- contacts: leer y editar con la lista de canales (antes owns_channel() por cada fila del canal antes del LIMIT:
-- la lista de 50 chats de la Bandeja pasaba de 22 ms a 1,3 ms). INSERT (owns_channel) y DELETE (admin_channel)
-- quedan como estaban.
drop policy if exists contacts_sel on public.contacts;
create policy contacts_sel on public.contacts for select
  using (channel_id in (select public.my_channel_ids()));
drop policy if exists contacts_upd on public.contacts;
create policy contacts_upd on public.contacts for update
  using (channel_id in (select public.my_channel_ids()))
  with check (channel_id in (select public.my_channel_ids()));

drop policy if exists contact_tags_tenant on public.contact_tags;
create policy contact_tags_tenant on public.contact_tags for all
  using (exists (select 1 from public.contacts c
                 where c.id = contact_tags.contact_id
                   and c.channel_id in (select public.my_channel_ids())))
  with check (exists (select 1 from public.contacts c
                      where c.id = contact_tags.contact_id
                        and c.channel_id in (select public.my_channel_ids())));

drop policy if exists cfv_tenant on public.contact_field_values;
create policy cfv_tenant on public.contact_field_values for all
  using (exists (select 1 from public.contacts c
                 where c.id = contact_field_values.contact_id
                   and c.channel_id in (select public.my_channel_ids())))
  with check (exists (select 1 from public.contacts c
                      where c.id = contact_field_values.contact_id
                        and c.channel_id in (select public.my_channel_ids())));
