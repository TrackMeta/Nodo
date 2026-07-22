-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0046 — El panel puede ENROLAR contactos a una secuencia
--
-- Hasta ahora sequence_subscriptions solo tenía policy de SELECT para el
-- panel (subs_sel = owns_channel); las suscripciones las creaba el motor
-- con service_role (auto-enroll de remarketing en markProduct). Para poder
-- "reactivar ventas" desde la sección Contactos (seleccionar varios y
-- agregarlos a una secuencia) el usuario necesita INSERT/UPDATE, siempre
-- acotado a los canales de su cuenta (owns_channel).
--
-- No se agrega DELETE: dar de baja una suscripción sigue siendo del motor
-- (el scheduler la completa/pausa por sus salvaguardas: compró, respondió,
-- pidió no-remarketing).
-- ═══════════════════════════════════════════════════════════════════
drop policy if exists subs_ins on sequence_subscriptions;
create policy subs_ins on sequence_subscriptions
  for insert with check (owns_channel(channel_id));

drop policy if exists subs_upd on sequence_subscriptions;
create policy subs_upd on sequence_subscriptions
  for update using (owns_channel(channel_id))
  with check (owns_channel(channel_id));
