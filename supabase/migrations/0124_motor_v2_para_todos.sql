-- 🧭 Motor v2 encendido en TODOS los canales (3-oct-2026, PLAN_MOTOR_IA.md fase 2).
-- El motor ya no lee el interruptor por canal: la IA conversa, el motor guía y el revisor pide reescribir en todos los
-- canales —y en los que se creen desde ahora—. Las tijeras que reemplazaba se borraron del código, así que apagarlo
-- ya no tiene a qué volver: la columna se retira para que nadie crea que todavía hace algo.
alter table channels drop column if exists motor_v2;
