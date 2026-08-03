-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0064 — Modo de disparo por secuencia (reenganche vs goteo).
--
-- Hasta ahora TODAS las secuencias se disparaban por SILENCIO: el reloj
-- se ancla también al último mensaje del cliente, así que si el cliente
-- responde el temporizador se REINICIA y la secuencia se pausa mientras
-- haya conversación. Es el modo "reenganche" (recuperar al que se enfrió).
--
-- Ahora una secuencia puede ser "goteo" (programado): se ancla SOLO a la
-- suscripción y al paso anterior, IGNORA el silencio y NO se reinicia si
-- el cliente responde. Corre su calendario (Día 1, 3, 7…) desde el primer
-- contacto pase lo que pase. Para series de bienvenida / educación / valor.
--
-- Valores: 'reenganche' (default, = lo de antes) | 'goteo'.
-- El resto de salvaguardas (opt-out, ya-compró, horario, anti-spam, la
-- ventana de 24h de Meta) siguen aplicando en ambos modos.
-- ═══════════════════════════════════════════════════════════════════
alter table public.sequences
  add column if not exists modo text not null default 'reenganche';
