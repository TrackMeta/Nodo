-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0123 — Interruptor del MOTOR V2 por canal (PLAN_MOTOR_IA.md, fase 1).
--
-- Con `motor_v2 = true` la venta física de ese canal usa «la IA conversa, el motor guía»: el motor decide el
-- siguiente paso, la IA contesta y hace la pregunta de ese paso, y un revisor pide reescribir en vez de recortar.
-- Apagado por defecto: se enciende canal por canal y se apaga al instante si algo sale mal.
-- ═══════════════════════════════════════════════════════════════════
alter table channels add column if not exists motor_v2 boolean not null default false;
