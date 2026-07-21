-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0039 — Multi-tenant, Fase 2: RLS por cuenta
--
-- Reemplaza is_member()/is_admin() (cualquier usuario ve TODO) por reglas
-- que leen la frontera de cuenta: ves una fila solo si su canal pertenece
-- a una cuenta donde eres miembro activo. Los secretos (channel_secrets,
-- payment_operations, gsheets_oauth_state) siguen sin políticas = solo
-- service_role, no se tocan.
--
-- Los helpers son SECURITY DEFINER a propósito: se saltan RLS al consultar
-- account_members/channels, evitando recursión infinita en las políticas.
--
-- Aplicación en vivo: sentencia por sentencia (la Management API no acepta
-- multi-statement). Delimitador entre sentencias: la línea  --##--
-- Cada create policy va precedido de su drop → re-aplicable (idempotente).
-- ═══════════════════════════════════════════════════════════════════

-- ── Helpers ─────────────────────────────────────────────────────────
create or replace function my_accounts() returns setof uuid
language sql stable security definer set search_path = public as $$
  select account_id from account_members where user_id = auth.uid() and activo;
$$;
--##--
create or replace function owns_channel(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from channels c
    join account_members m on m.account_id = c.account_id
    where c.id = cid and m.user_id = auth.uid() and m.activo
  );
$$;
--##--
create or replace function admin_channel(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from channels c
    join account_members m on m.account_id = c.account_id
    where c.id = cid and m.user_id = auth.uid() and m.role = 'admin' and m.activo
  );
$$;
--##--
create or replace function is_account_admin(acc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from account_members
    where account_id = acc and user_id = auth.uid() and role = 'admin' and activo
  );
$$;
--##--
-- Los canales nuevos heredan la cuenta del creador (el panel inserta sin
-- account_id). Con varias cuentas toma la primera; el selector de cuenta de
-- la Fase 4 lo hará explícito.
create or replace function set_channel_account() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.account_id is null then
    select account_id into new.account_id from account_members
      where user_id = auth.uid() and activo order by created_at limit 1;
  end if;
  return new;
end $$;
--##--
drop trigger if exists trg_channel_account on channels;
--##--
create trigger trg_channel_account before insert on channels
  for each row execute function set_channel_account();
--##--

-- ── Tablas nuevas: activar RLS ──────────────────────────────────────
alter table accounts enable row level security;
--##--
alter table account_members enable row level security;
--##--
drop policy if exists accounts_sel on accounts;
--##--
create policy accounts_sel on accounts for select using (id in (select my_accounts()));
--##--
drop policy if exists accounts_admin on accounts;
--##--
create policy accounts_admin on accounts for all using (is_account_admin(id)) with check (is_account_admin(id));
--##--
drop policy if exists am_sel on account_members;
--##--
create policy am_sel on account_members for select using (account_id in (select my_accounts()));
--##--
drop policy if exists am_admin on account_members;
--##--
create policy am_admin on account_members for all using (is_account_admin(account_id)) with check (is_account_admin(account_id));
--##--

-- ── channels: dueño por cuenta ──────────────────────────────────────
drop policy if exists channels_select on channels;
--##--
drop policy if exists channels_admin_all on channels;
--##--
create policy channels_sel on channels for select using (account_id in (select my_accounts()));
--##--
create policy channels_admin on channels for all using (is_account_admin(account_id)) with check (is_account_admin(account_id));
--##--

-- ── app_users: tu perfil + compañeros de tus cuentas ────────────────
drop policy if exists app_users_self on app_users;
--##--
drop policy if exists app_users_admin_all on app_users;
--##--
create policy app_users_sel on app_users for select using (
  id = auth.uid() or id in (
    select user_id from account_members where account_id in (select my_accounts())
  )
);
--##--
create policy app_users_selfwrite on app_users for all using (id = auth.uid()) with check (id = auth.uid());
--##--

-- ── channel_id directo · miembros leen y escriben ───────────────────
drop policy if exists tags_member on tags;
--##--
create policy tags_tenant on tags for all using (owns_channel(channel_id)) with check (owns_channel(channel_id));
--##--
drop policy if exists custom_fields_member on custom_fields;
--##--
create policy custom_fields_tenant on custom_fields for all using (owns_channel(channel_id)) with check (owns_channel(channel_id));
--##--
drop policy if exists contacts_member on contacts;
--##--
create policy contacts_tenant on contacts for all using (owns_channel(channel_id)) with check (owns_channel(channel_id));
--##--
drop policy if exists conversations_member on conversations;
--##--
create policy conversations_tenant on conversations for all using (owns_channel(channel_id)) with check (owns_channel(channel_id));
--##--
drop policy if exists products_member on products;
--##--
create policy products_tenant on products for all using (owns_channel(channel_id)) with check (owns_channel(channel_id));
--##--
drop policy if exists media_member on media_library;
--##--
create policy media_tenant on media_library for all using (owns_channel(channel_id)) with check (owns_channel(channel_id));
--##--
drop policy if exists flows_member on flows;
--##--
create policy flows_tenant on flows for all using (owns_channel(channel_id)) with check (owns_channel(channel_id));
--##--
drop policy if exists triggers_member on flow_triggers;
--##--
create policy triggers_tenant on flow_triggers for all using (owns_channel(channel_id)) with check (owns_channel(channel_id));
--##--
drop policy if exists sequences_member on sequences;
--##--
create policy sequences_tenant on sequences for all using (owns_channel(channel_id)) with check (owns_channel(channel_id));
--##--
drop policy if exists ai_triggers_member on ai_triggers;
--##--
create policy ai_triggers_tenant on ai_triggers for all using (owns_channel(channel_id)) with check (owns_channel(channel_id));
--##--
drop policy if exists quick_replies_all on quick_replies;
--##--
create policy quick_replies_tenant on quick_replies for all using (owns_channel(channel_id)) with check (owns_channel(channel_id));
--##--
drop policy if exists contact_events_all on contact_events;
--##--
create policy contact_events_tenant on contact_events for all using (owns_channel(channel_id)) with check (owns_channel(channel_id));
--##--
drop policy if exists tpl_member on wa_templates;
--##--
create policy tpl_tenant on wa_templates for all using (owns_channel(channel_id)) with check (owns_channel(channel_id));
--##--
drop policy if exists camp_member on campaigns;
--##--
create policy camp_tenant on campaigns for all using (owns_channel(channel_id)) with check (owns_channel(channel_id));
--##--

-- ── channel_id directo · solo LECTURA en panel (escribe el motor) ───
drop policy if exists runs_read on flow_runs;
--##--
create policy runs_sel on flow_runs for select using (owns_channel(channel_id));
--##--
drop policy if exists subs_read on sequence_subscriptions;
--##--
create policy subs_sel on sequence_subscriptions for select using (owns_channel(channel_id));
--##--
drop policy if exists capi_events_select on capi_events;
--##--
create policy capi_sel on capi_events for select using (owns_channel(channel_id));
--##--
drop policy if exists channel_ai_select on channel_ai;
--##--
create policy channel_ai_sel on channel_ai for select using (owns_channel(channel_id));
--##--
drop policy if exists channel_gsheets_select on channel_gsheets;
--##--
create policy channel_gsheets_sel on channel_gsheets for select using (owns_channel(channel_id));
--##--

-- ── channel_id directo · lectura miembros, escritura solo admin ─────
drop policy if exists messages_select on messages;
--##--
drop policy if exists messages_admin_write on messages;
--##--
create policy messages_sel on messages for select using (owns_channel(channel_id));
--##--
create policy messages_admin on messages for all using (admin_channel(channel_id)) with check (admin_channel(channel_id));
--##--
drop policy if exists orders_select on orders;
--##--
drop policy if exists orders_admin_all on orders;
--##--
create policy orders_sel on orders for select using (owns_channel(channel_id));
--##--
create policy orders_admin on orders for all using (admin_channel(channel_id)) with check (admin_channel(channel_id));
--##--

-- ── A un salto (heredan la cuenta por su tabla padre) ───────────────
drop policy if exists pv_member on product_versions;
--##--
create policy pv_tenant on product_versions for all
  using (product_id in (select id from products where owns_channel(channel_id)))
  with check (product_id in (select id from products where owns_channel(channel_id)));
--##--
drop policy if exists nodes_member on flow_nodes;
--##--
create policy nodes_tenant on flow_nodes for all
  using (flow_id in (select id from flows where owns_channel(channel_id)))
  with check (flow_id in (select id from flows where owns_channel(channel_id)));
--##--
drop policy if exists edges_member on flow_edges;
--##--
create policy edges_tenant on flow_edges for all
  using (flow_id in (select id from flows where owns_channel(channel_id)))
  with check (flow_id in (select id from flows where owns_channel(channel_id)));
--##--
drop policy if exists contact_tags_member on contact_tags;
--##--
create policy contact_tags_tenant on contact_tags for all
  using (contact_id in (select id from contacts where owns_channel(channel_id)))
  with check (contact_id in (select id from contacts where owns_channel(channel_id)));
--##--
drop policy if exists contact_field_values_member on contact_field_values;
--##--
create policy cfv_tenant on contact_field_values for all
  using (contact_id in (select id from contacts where owns_channel(channel_id)))
  with check (contact_id in (select id from contacts where owns_channel(channel_id)));
--##--
drop policy if exists csends_read on campaign_sends;
--##--
create policy csends_sel on campaign_sends for select
  using (campaign_id in (select id from campaigns where owns_channel(channel_id)));
