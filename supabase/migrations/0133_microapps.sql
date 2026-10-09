-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0133 — Micro apps: tercer tipo de producto (8-oct-2026, diseño con Rodrigo)
--
-- Una micro app se vende como un digital (anuncio → WhatsApp → Yape → OCR), pero lo que se
-- entrega es un ACCESO: el bot pide el correo (obligatorio), la base de Apps (proyecto
-- Supabase APARTE, ver apps-base/) crea el acceso y el bot manda el link personal.
--   · products.tipo admite 'microapp'. Cómo se cobra vive en product_versions.config
--     ({modalidad:'unico'|'mensual', meses}) y lo demás en products.config.microapp.
--   · contacts.correo: el correo del cliente (se reusa en su próxima compra).
--   · microapp_entregas: pagos validados que esperan el correo (o ya entregados). El
--     scheduler recuerda el correo desde acá y el panel muestra «pagado, falta correo».
-- ═══════════════════════════════════════════════════════════════════
alter table public.products drop constraint if exists products_tipo_chk;
--##--
alter table public.products add constraint products_tipo_chk check (tipo in ('digital','fisico','microapp'));
--##--
alter table public.contacts add column if not exists correo text;
--##--
create table if not exists public.microapp_entregas (
  id              uuid primary key default gen_random_uuid(),
  channel_id      uuid not null references public.channels(id) on delete cascade,
  contact_id      uuid not null references public.contacts(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  order_id        uuid references public.orders(id) on delete set null,
  tipo            text not null default 'unico' check (tipo in ('unico','mensual','prueba')),
  meses           int,
  horas           int,                                   -- duración de la prueba gratis
  estado          text not null default 'falta_correo'
                  check (estado in ('falta_correo','falta_telefono','entregado','a_humano','error')),
  correo          text,
  telefono        text,
  promos          boolean not null default true,
  recordatorios   int not null default 0,                -- recordatorios del correo ya mandados
  proximo_aviso_at timestamptz,                          -- cuándo toca el siguiente (null = ninguno)
  acceso_id       uuid,                                  -- id del acceso en la base de Apps
  link            text,
  error           text,
  entregado_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
--##--
create index if not exists microapp_entregas_pend on public.microapp_entregas (proximo_aviso_at) where estado = 'falta_correo';
--##--
create index if not exists microapp_entregas_contacto on public.microapp_entregas (contact_id, created_at desc);
--##--
create index if not exists microapp_entregas_canal on public.microapp_entregas (channel_id, created_at desc);
--##--
alter table public.microapp_entregas enable row level security;
--##--
drop policy if exists microapp_entregas_sel on public.microapp_entregas;
--##--
create policy microapp_entregas_sel on public.microapp_entregas for select using (owns_channel(channel_id));
--##--
grant select on public.microapp_entregas to authenticated;
--##--
-- Ventana de RENOVACIÓN abierta por el recordatorio (scheduler): mientras dure, el motor valida el
-- Yape de la renovación aunque el post-venta esté apagado (y reactiva el bot para eso).
alter table public.contacts add column if not exists renovar_app_hasta timestamptz;
--##--
alter table public.contacts add column if not exists renovar_app_product uuid;
--##--
-- Cuándo el remarketing le OFRECIÓ la prueba gratis (paso de secuencia con «ofrece prueba»). Solo
-- con esto reciente la IA de venta puede activarla con [[prueba]].
alter table public.contacts add column if not exists prueba_ofrecida_at timestamptz;
