-- ══════════════════════════════════════════════════════
-- Nodo · 0092 — Cuánto te cobra META, separado por origen del lead
--
-- 🔴 POR QUÉ AHORA. El 1 de octubre de 2026 Meta empieza a cobrar por MENSAJE dos
-- cosas que hoy son gratis:
--   · los mensajes de SERVICIO (las respuestas libres dentro de la ventana de 24h,
--     o sea TODO lo que escribe el bot vendiendo), y
--   · las plantillas de UTILIDAD dentro de esa misma ventana.
-- Y lo que sigue gratis es lo que entra por la ventana de 72h del anuncio (FEP).
-- Fuente: developers.facebook.com/documentation/business-messaging/whatsapp/pricing/
--         non-template-messages
--
-- Consecuencia para el negocio: el lead que viene de un ANUNCIO viaja gratis; el
-- ORGÁNICO se paga por cada burbuja. Hasta hoy el panel sabe lo que gasta la IA
-- (ai_usage, migración 0087) y lo que gasta en anuncios, pero NO lo que cuesta
-- hablar. Desde octubre eso es plata de verdad y hay que poder separarla.
--
-- 📌 SE SELLA AL ENVIAR, no se deduce después. `contacts.fep_hasta` lo reescribe
-- cada clic nuevo en un anuncio, así que mirar hoy si un mensaje de la semana
-- pasada iba dentro de la ventana da una respuesta inventada. En el momento del
-- envío el dato es exacto y cuesta cero: ya se está insertando la fila.
--
-- 💵 La TARIFA no se inventa. Meta publica la de cada país aparte y a la fecha de
-- esta migración no está la de Perú. Si `channels.tarifa_msg_usd` está vacía, el
-- panel muestra el CONTEO de mensajes cobrables y deja la plata en blanco — mismo
-- criterio que el plazo de entrega: sin dato configurado, no se estima.
-- ══════════════════════════════════════════════════════

-- ── 1. La ventana bajo la que salió cada mensaje ──────────────────────
-- fep        → dentro de las 72h del anuncio: Meta NO cobra
-- servicio   → respuesta libre dentro de las 24h: GRATIS hasta el 30/09/2026, se cobra desde el 01/10
-- plantilla  → plantilla (HSM): se cobra siempre (salvo que caiga dentro del FEP, que entonces es 'fep')
-- null       → entrante, o saliente anterior a esta migración
alter table messages add column if not exists ventana text;

comment on column messages.ventana is
  'Ventana de cobro de Meta en el momento del envío: fep | servicio | plantilla. NULL = entrante o previo a 0092.';

-- Solo salientes con ventana marcada: es lo único que se agrega para el reporte.
-- Índice parcial para que contar un mes no recorra la tabla entera de mensajes.
create index if not exists idx_messages_ventana
  on messages (channel_id, ts desc)
  where direction = 'out' and ventana is not null;

-- ── 2. La tarifa por mensaje, por canal ───────────────────────────────
-- Va en el canal y no en una constante: cada negocio puede estar en otro país, y
-- Meta cobra por mercado. En USD porque así la publica Meta; el panel ya sabe
-- pasar a soles con channels.usd_rate (migración 0089).
alter table channels add column if not exists tarifa_msg_usd numeric(10,6);

comment on column channels.tarifa_msg_usd is
  'Lo que Meta cobra por mensaje cobrable en el país de este canal (USD). NULL = sin configurar: se muestra el conteo y no se estima plata.';

--##--

-- ── 3. Reporte: gasto de Meta separado por ORIGEN del lead ────────────
-- Devuelve, para un rango, una fila por origen (anuncio | organico) con:
--   · conversaciones (contactos distintos que recibieron algo)
--   · mensajes gratis (los que cayeron en la ventana del anuncio)
--   · mensajes cobrables (servicio + plantilla fuera del FEP)
--   · el costo, SOLO si el canal tiene tarifa configurada
--
-- El origen sale de `contacts.ad_id / ctwa_clid / source`, que es lo que sella el
-- webhook con el referral CTWA. Un contacto que nunca vino por anuncio es orgánico
-- aunque hoy no tenga la ventana abierta.
create or replace function public.gasto_meta_por_origen(
  p_channel_id uuid,
  p_desde      date,
  p_hasta      date
) returns table (
  origen           text,
  conversaciones   bigint,
  msgs_gratis      bigint,
  msgs_cobrables   bigint,
  costo_usd        numeric
)
language sql
stable
security invoker
set search_path = public
as $fn$
  select
    case when c.ad_id is not null or c.ctwa_clid is not null or c.source is not null
         then 'anuncio' else 'organico' end                                   as origen,
    count(distinct m.contact_id)                                              as conversaciones,
    count(*) filter (where m.ventana = 'fep')                                 as msgs_gratis,
    count(*) filter (where m.ventana in ('servicio', 'plantilla'))            as msgs_cobrables,
    -- Sin tarifa configurada NO se estima: se devuelve NULL y el panel deja el
    -- importe en blanco en vez de enseñar un número inventado.
    case when ch.tarifa_msg_usd is null then null
         else round(count(*) filter (where m.ventana in ('servicio','plantilla'))
                    * ch.tarifa_msg_usd, 4) end                               as costo_usd
  from messages m
  join contacts c  on c.id  = m.contact_id
  join channels ch on ch.id = m.channel_id
  where m.channel_id = p_channel_id
    and m.direction  = 'out'
    and m.ventana is not null
    and m.ts >= p_desde::timestamptz
    and m.ts <  (p_hasta + 1)::timestamptz
  group by 1, ch.tarifa_msg_usd
  order by 1;
$fn$;

-- `security invoker` a propósito: la RLS de messages/contacts ya limita a los
-- canales del dueño, así que la función hereda ese permiso en vez de saltárselo.
grant execute on function public.gasto_meta_por_origen(uuid, date, date) to authenticated;
