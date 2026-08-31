-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0085 — de quién fue la operación de pago que ya se reclamó
--
-- `payment_operations` es el candado anti-reúso: un número de operación de
-- Yape/Plin/BCP solo puede acreditar UN pedido en el canal. Guardaba el pedido,
-- pero no el contacto, y esa fila SOBREVIVE al borrado del pedido.
--
-- Efecto medido en "Probar flujos": reiniciar la prueba borra mensajes, pedidos
-- y flujos, pero NO libera las operaciones. La captura de Yape con la que se
-- probó una vez la validación automática queda quemada PARA SIEMPRE: al
-- reenviarla, el motor la marca «operación ya usada» y el adelanto se cae a
-- validación manual. Se ve igual que un bug del OCR — y Rodrigo lo reportó como
-- tal — cuando en realidad es la guarda haciendo bien su trabajo.
--
-- Con el contacto guardado, el reset del webchat puede soltar SOLO las
-- operaciones del contacto de prueba de ese canal, sin tocar las de los
-- clientes reales (que es justo lo que el candado protege).
--
-- ON DELETE SET NULL a propósito: si un contacto se borra, la operación SIGUE
-- reclamada. Perder el dueño no puede convertirse en permiso para reusar el
-- pago; el candado vive en el índice único (channel_id, operacion).
-- ═══════════════════════════════════════════════════════════════════

alter table public.payment_operations
  add column if not exists contact_id uuid
    references public.contacts(id) on delete set null;

create index if not exists payment_operations_contact_idx
  on public.payment_operations (contact_id)
  where contact_id is not null;

comment on column public.payment_operations.contact_id is
  'Contacto que envió el comprobante. Solo para poder liberar las operaciones del contacto de prueba al reiniciar Probar flujos; el candado anti-reúso es el índice único (channel_id, operacion).';
