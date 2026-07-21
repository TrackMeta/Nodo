-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0044 — D4: bucket PRIVADO para comprobantes de pago
--
-- Los comprobantes (screenshots de Yape/Plin/transferencia = data financiera
-- del cliente) dejan de vivir en el bucket público `media` y pasan a
-- `comprobantes` (privado). El motor sube ahí y devuelve una URL FIRMADA de
-- larga duración (1 año) que sirve en panel/Telegram/Sheets sin exponer el
-- bucket. Sin políticas: solo service_role sube; el acceso es por URL firmada.
--
-- Los comprobantes VIEJOS quedan en `media` (público) — no se migran
-- retroactivamente; aplica de aquí en adelante.
-- ═══════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('comprobantes', 'comprobantes', false)
on conflict (id) do update set public = false;
