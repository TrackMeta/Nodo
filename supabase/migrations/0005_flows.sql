-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0005 — Fase 2: motor de flujos, productos y secuencias
-- Modelo: Esqueleto (plantilla base) → Producto clona flujos + contenido.
-- El contenido (textos/prompts) vive en flow_nodes.config (variables {{ }}).
-- ═══════════════════════════════════════════════════════════════════

-- ── Tipos ───────────────────────────────────────────────────────────
create type flow_kind   as enum ('skeleton', 'flow');     -- plantilla vs copia
create type flow_estado as enum ('borrador', 'activo');
create type run_estado  as enum ('activo', 'esperando', 'completado', 'fallido', 'cancelado');
create type seq_estado  as enum ('activa', 'pausada', 'completada', 'cancelada');

-- ── products: la "capa de contenido" (datos por producto) ───────────
create table products (
  id              uuid primary key default gen_random_uuid(),
  channel_id      uuid not null references channels(id) on delete cascade,
  nombre          text not null,
  con_bifurcacion boolean not null default false,
  -- Campos FIJOS por producto (precio, contexto_producto, datos_pago, links…)
  config          jsonb not null default '{}'::jsonb,
  imagen_media_id uuid,                                   -- ref a media_library
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_products_channel on products(channel_id);

-- ── product_versions: Básica / Premium / Única ─────────────────────
create table product_versions (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  nombre      text not null,                              -- 'Básica' | 'Premium' | 'Única'
  price_list  numeric[] not null default '{}',            -- escalera de precios válidos
  drive_link  text,                                       -- link de entrega
  config      jsonb not null default '{}'::jsonb,
  orden       int not null default 0,
  created_at  timestamptz not null default now()
);
create index idx_pv_product on product_versions(product_id);

-- ── media_library: imágenes/archivos reutilizables ─────────────────
create table media_library (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references channels(id) on delete cascade,
  nombre      text not null,
  tipo        text not null default 'image',              -- image|video|audio|document
  url         text not null,                              -- Supabase Storage o URL externa
  created_at  timestamptz not null default now()
);
create index idx_media_channel on media_library(channel_id);

-- ── flows: esqueletos (plantillas) y flujos (copias por producto) ──
create table flows (
  id                uuid primary key default gen_random_uuid(),
  channel_id        uuid not null references channels(id) on delete cascade,
  kind              flow_kind not null default 'flow',
  nombre            text not null,
  descripcion       text,
  -- Para copias: de qué esqueleto salió y a qué producto/rol pertenece.
  source_skeleton_id uuid references flows(id) on delete set null,
  product_id        uuid references products(id) on delete cascade,
  role              text,                                 -- bienvenida|pago|orderbump|remarketing|redireccionador|custom
  estado            flow_estado not null default 'borrador',
  es_entrada        boolean not null default false,       -- enrutador (solo uno activo por canal)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index idx_flows_channel on flows(channel_id, kind);
create index idx_flows_product on flows(product_id);
-- Solo un flujo de entrada ACTIVO por canal.
create unique index idx_flows_entrada_unica
  on flows(channel_id) where es_entrada and estado = 'activo';

-- ── flow_nodes: los nodos del grafo (estructura + contenido) ───────
create table flow_nodes (
  id         uuid primary key default gen_random_uuid(),
  flow_id    uuid not null references flows(id) on delete cascade,
  tipo       text not null,                               -- mensaje|pregunta|condicion|accion|ia|esperar|iniciar_flujo|evento_fb|google_sheets|fin
  nombre     text,                                        -- "nombre de hueco" para la vista Contenido
  config     jsonb not null default '{}'::jsonb,          -- cuerpo: textos, botones, prompt, condiciones…
  es_inicial boolean not null default false,              -- primer nodo del flujo
  pos_x      real not null default 0,
  pos_y      real not null default 0,
  created_at timestamptz not null default now()
);
create index idx_nodes_flow on flow_nodes(flow_id);

-- ── flow_edges: conexiones entre nodos ─────────────────────────────
create table flow_edges (
  id            uuid primary key default gen_random_uuid(),
  flow_id       uuid not null references flows(id) on delete cascade,
  source_node   uuid not null references flow_nodes(id) on delete cascade,
  source_handle text not null default 'continuar',        -- continuar|exito|fallo|boton:N|ruta:X|si_no_cumple
  target_node   uuid not null references flow_nodes(id) on delete cascade,
  created_at    timestamptz not null default now()
);
create index idx_edges_flow on flow_edges(flow_id);
create index idx_edges_source on flow_edges(source_node);

-- ── flow_triggers: cómo arranca un flujo ───────────────────────────
create table flow_triggers (
  id         uuid primary key default gen_random_uuid(),
  flow_id    uuid not null references flows(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  tipo       text not null,                               -- entrada|keyword|boton|referral|ia|api
  config     jsonb not null default '{}'::jsonb,          -- { keywords:[], match:'contiene' } etc.
  interrumpe boolean not null default false,              -- ¿interrumpe un run activo? (default no)
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_triggers_channel on flow_triggers(channel_id, tipo) where activo;

-- ── flow_runs: estado de ejecución por contacto ────────────────────
create table flow_runs (
  id              uuid primary key default gen_random_uuid(),
  channel_id      uuid not null references channels(id) on delete cascade,
  contact_id      uuid not null references contacts(id) on delete cascade,
  flow_id         uuid not null references flows(id) on delete cascade,
  current_node_id uuid references flow_nodes(id) on delete set null,
  vars            jsonb not null default '{}'::jsonb,      -- variables/buffer del run
  estado          run_estado not null default 'activo',
  wake_at         timestamptz,                             -- para Esperar/debounce (lo despierta el scheduler)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- LOCK POR CONTACTO: un solo run activo/esperando por contacto a la vez.
create unique index idx_runs_lock
  on flow_runs(contact_id) where estado in ('activo', 'esperando');
create index idx_runs_wake on flow_runs(wake_at) where estado = 'esperando';

-- ── sequences: remarketing consciente de la conversación ───────────
create table sequences (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  nombre     text not null,
  pasos      jsonb not null default '[]'::jsonb,           -- [{ umbral_silencio_seg, contenido/flow_id, oferta }]
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_sequences_channel on sequences(channel_id);

create table sequence_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references channels(id) on delete cascade,
  contact_id  uuid not null references contacts(id) on delete cascade,
  sequence_id uuid not null references sequences(id) on delete cascade,
  paso_actual int not null default 0,
  estado      seq_estado not null default 'activa',
  suscrito_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (contact_id, sequence_id)
);
create index idx_subs_scan on sequence_subscriptions(estado) where estado = 'activa';

-- ── RLS: miembros operan; secretos y config sensible aparte ────────
alter table products               enable row level security;
alter table product_versions       enable row level security;
alter table media_library          enable row level security;
alter table flows                  enable row level security;
alter table flow_nodes             enable row level security;
alter table flow_edges             enable row level security;
alter table flow_triggers          enable row level security;
alter table flow_runs              enable row level security;
alter table sequences              enable row level security;
alter table sequence_subscriptions enable row level security;

-- Lectura/escritura para cualquier miembro (Fase 3 refina por rol/canal).
create policy products_member    on products for all using (is_member()) with check (is_member());
create policy pv_member          on product_versions for all using (is_member()) with check (is_member());
create policy media_member       on media_library for all using (is_member()) with check (is_member());
create policy flows_member       on flows for all using (is_member()) with check (is_member());
create policy nodes_member       on flow_nodes for all using (is_member()) with check (is_member());
create policy edges_member       on flow_edges for all using (is_member()) with check (is_member());
create policy triggers_member    on flow_triggers for all using (is_member()) with check (is_member());
create policy sequences_member   on sequences for all using (is_member()) with check (is_member());
-- flow_runs y suscripciones: solo LECTURA desde el panel (las escribe el motor
-- vía service role). Así el cliente no corrompe el estado de ejecución.
create policy runs_read          on flow_runs for select using (is_member());
create policy subs_read          on sequence_subscriptions for select using (is_member());
