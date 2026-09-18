-- ═══════════════════════════════════════════════════════════════════
-- 0100 · sequence_subscriptions: el contacto y la secuencia deben ser del MISMO canal
--
-- Las políticas de 0046 solo validaban owns_channel(channel_id). Un miembro de una
-- cuenta podía insertar (vía supabase-js, como hace Contactos → «Suscribir») una fila
-- con SU channel_id pero con contact_id o sequence_id de OTRO canal: el scheduler
-- usa s.channel_id como emisor y s.contact_id como destinatario sin cruzarlos, así que
-- el bot de A le mandaba remarketing a un cliente de B. Se exige que ambos vivan en el
-- mismo canal que la fila.
-- ═══════════════════════════════════════════════════════════════════
drop policy if exists subs_ins on sequence_subscriptions;
--##--
create policy subs_ins on sequence_subscriptions
  for insert with check (
    owns_channel(channel_id)
    and exists (select 1 from contacts c where c.id = sequence_subscriptions.contact_id and c.channel_id = sequence_subscriptions.channel_id)
    and exists (select 1 from sequences s where s.id = sequence_subscriptions.sequence_id and s.channel_id = sequence_subscriptions.channel_id)
  );
--##--
drop policy if exists subs_upd on sequence_subscriptions;
--##--
create policy subs_upd on sequence_subscriptions
  for update using (owns_channel(channel_id))
  with check (
    owns_channel(channel_id)
    and exists (select 1 from contacts c where c.id = sequence_subscriptions.contact_id and c.channel_id = sequence_subscriptions.channel_id)
    and exists (select 1 from sequences s where s.id = sequence_subscriptions.sequence_id and s.channel_id = sequence_subscriptions.channel_id)
  );
