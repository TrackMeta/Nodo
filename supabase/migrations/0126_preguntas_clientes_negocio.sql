-- 🙋 PREGUNTAS DE CLIENTES DEL NEGOCIO (3-oct-2026, Rodrigo: «ok dale»).
-- Garantía, devoluciones, factura, cuotas, tienda física, horarios: son condiciones del NEGOCIO y valen para todos los
-- productos. Antes caían en la tarjeta del producto (y aprobarlas las guardaba en la ficha de ESE producto). Ahora van
-- sin producto (product_id null) y se contestan en Negocio → Conocimiento, que las guarda en sus preguntas frecuentes.
-- En estos temas el bot nunca supone: llegan siempre «sin dato», para que el dueño escriba la política.
alter table public.preguntas_clientes alter column product_id drop not null;
create unique index if not exists preguntas_clientes_negocio_uq
  on public.preguntas_clientes (channel_id, clave) where product_id is null;
create index if not exists preguntas_clientes_negocio_pend
  on public.preguntas_clientes (channel_id, estado, ultimo_at desc) where product_id is null;

-- Las que el bot ya había marcado como «el negocio no lo contesta» (evento negocio_hueco), sin simulaciones ni exámenes.
insert into public.preguntas_clientes (channel_id, product_id, pregunta, clave, tipo, veces, clientes, ultimo_at, created_at)
select e.channel_id, null,
       '¿' || upper(left(regexp_replace(t.tema, '^si ', ''), 1)) || substr(regexp_replace(t.tema, '^si ', ''), 2) || '?',
       lower(regexp_replace(t.tema, '^si ', '')), 'sin_dato', count(*),
       coalesce(jsonb_agg(jsonb_build_object('contact_id', e.contact_id, 'cita', left(coalesce(e.detalle, ''), 180), 'ts', e.created_at)
         order by e.created_at desc), '[]'::jsonb),
       max(e.created_at), min(e.created_at)
from public.contact_events e
join public.contacts c on c.id = e.contact_id
cross join lateral (
  select trim(x) as tema
  from unnest(string_to_array(regexp_replace(regexp_replace(e.titulo, '^(❓ )?Preguntó por\s*', ''), '\s*y no está en la ficha$', ''), ',')) x
) t
where e.tipo = 'negocio_hueco'
  and coalesce(c.source, '') <> 'sim' and coalesce(c.wa_id, '') not like 'exam-%'
  and t.tema <> ''
group by e.channel_id, t.tema
on conflict do nothing;
