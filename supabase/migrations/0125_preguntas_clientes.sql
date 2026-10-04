-- 🙋 PREGUNTAS DE CLIENTES (3-oct-2026, decisión de Rodrigo).
-- Nadie puede adivinar al crear un producto todo lo que van a preguntar. Ahora el bot, ante una pregunta que la ficha
-- no contesta, SUPONE lo razonable para vender (nunca en temas de plata, garantía/devoluciones, salud o seguridad,
-- plazos, cifras exactas ni políticas del negocio) y la pregunta llega acá, con lo que respondió. El dueño decide en
-- la ficha del producto: ✅ agregar a la ficha · ✏️ corregir y agregar · ❌ rechazar (el bot deja de decirlo y se le
-- muestra a qué clientes se les dijo, para corregirles él si quiere).
-- Mientras espera, la respuesta es PROVISIONAL: el motor la reusa para que dos clientes no reciban dos versiones.
-- `tipo = 'sin_dato'`: el bot NO supuso (tema prohibido, o la pregunta vino de antes): falta que el dueño ponga el dato.
create table if not exists public.preguntas_clientes (
  id              uuid primary key default gen_random_uuid(),
  channel_id      uuid not null references public.channels(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  pregunta        text not null,                       -- cómo la haría un cliente: «¿Aguanta la lluvia?»
  clave           text not null,                       -- la pregunta normalizada: junta las repetidas
  respuesta       text,                                -- lo que dijo el bot (vacío en «sin_dato»)
  tipo            text not null default 'suposicion' check (tipo in ('suposicion', 'sin_dato')),
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  respuesta_final text,                                -- la que quedó en la ficha (o la corrección del dueño)
  veces           int  not null default 1,
  clientes        jsonb not null default '[]'::jsonb,  -- [{contact_id, nombre, cita, respuesta, ts}] (los últimos 30)
  ultimo_at       timestamptz not null default now(),
  decidida_at     timestamptz,
  decidida_por    text,
  created_at      timestamptz not null default now(),
  unique (product_id, clave)
);
create index if not exists preguntas_clientes_pend on public.preguntas_clientes (product_id, estado, ultimo_at desc);
create index if not exists preguntas_clientes_canal on public.preguntas_clientes (channel_id, estado);

alter table public.preguntas_clientes enable row level security;
drop policy if exists preguntas_clientes_sel on public.preguntas_clientes;
create policy preguntas_clientes_sel on public.preguntas_clientes for select using (owns_channel(channel_id));
drop policy if exists preguntas_clientes_upd on public.preguntas_clientes;
create policy preguntas_clientes_upd on public.preguntas_clientes for update using (owns_channel(channel_id)) with check (owns_channel(channel_id));
drop policy if exists preguntas_clientes_del on public.preguntas_clientes;
create policy preguntas_clientes_del on public.preguntas_clientes for delete using (owns_channel(channel_id));
grant select, update, delete on public.preguntas_clientes to authenticated;

-- Las preguntas que el bot ya había marcado como «no está en la ficha» (evento ficha_hueco) pasan como «sin dato»,
-- para que el aviso amarillo viejo no se pierda. Fuera las simulaciones (source 'sim') y los exámenes ('exam-…'):
-- son ruido mío. Probar flujos (webchat-test) sí cuenta: así lo decidió Rodrigo.
insert into public.preguntas_clientes (channel_id, product_id, pregunta, clave, tipo, veces, clientes, ultimo_at, created_at)
select e.channel_id, (e.meta->>'product_id')::uuid,
       '¿' || upper(left(regexp_replace(t.tema, '^si ', ''), 1)) || substr(regexp_replace(t.tema, '^si ', ''), 2) || '?',
       lower(t.tema), 'sin_dato', count(*),
       coalesce(jsonb_agg(jsonb_build_object('contact_id', e.contact_id, 'cita', left(coalesce(e.detalle, ''), 180), 'ts', e.created_at)
         order by e.created_at desc), '[]'::jsonb),
       max(e.created_at), min(e.created_at)
from public.contact_events e
join public.contacts c on c.id = e.contact_id
join public.products p on p.id = (e.meta->>'product_id')::uuid
cross join lateral (
  select trim(x) as tema
  from unnest(string_to_array(regexp_replace(regexp_replace(e.titulo, '^(❓ )?Preguntó por\s*', ''), '\s*y no está en la ficha$', ''), ',')) x
) t
where e.tipo = 'ficha_hueco' and e.meta ? 'product_id'
  and coalesce(c.source, '') <> 'sim' and coalesce(c.wa_id, '') not like 'exam-%'
  and t.tema <> ''
group by e.channel_id, (e.meta->>'product_id')::uuid, t.tema
on conflict (product_id, clave) do nothing;
