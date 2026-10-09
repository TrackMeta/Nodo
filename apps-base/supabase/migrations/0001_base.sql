-- ═══════════════════════════════════════════════════════════════════
-- Base de Apps (proyecto Supabase APARTE de Nodo: «Nodo Apps»)
--   Guarda quién tiene acceso a cada micro app, sus celulares («pulseras») y su
--   progreso. Nodo vende y cobra; al confirmar el pago le pide a esta base
--   «dale acceso a X en la app Y» (función `nodo`). Las apps la consultan con el
--   kit (función `kit`). Nadie más la toca: RLS encendido y SIN políticas → solo
--   las funciones (service role) leen y escriben.
--   Multi-negocio desde el día 1: cada app pertenece a un bot (nodo_channel_id) y a
--   un producto de Nodo (nodo_product_id); el panel de Nodo solo pide lo de sus bots.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- Una fila por micro app conectada (= un producto «Micro app» de Nodo).
create table if not exists apps (
  id               uuid primary key default gen_random_uuid(),
  nodo_channel_id  uuid not null,
  nodo_product_id  uuid not null unique,
  nombre           text not null default '',
  url              text not null default '',            -- dónde vive la app (Cloudflare Pages, etc.)
  clave            text not null unique,                -- «app_xxxx»: identificador PÚBLICO que lleva el kit
  max_celulares    int  not null default 2 check (max_celulares between 1 and 20),
  wa_bot           text not null default '',            -- número del bot (para el botón «Renovar» del kit)
  kit_visto_at     timestamptz,                         -- última vez que el kit de la app se reportó
  kit_nivel        text,                                -- 'basico' | 'reforzado' (lo informa el kit)
  creado_at        timestamptz not null default now()
);
create index if not exists apps_channel_idx on apps (nodo_channel_id);

-- Una fila por cliente y app: su llave de entrada.
create table if not exists accesos (
  id               uuid primary key default gen_random_uuid(),
  app_id           uuid not null references apps(id) on delete cascade,
  nodo_contact_id  uuid not null,
  wa_id            text not null default '',            -- número o BSUID del chat
  nombre           text not null default '',
  correo           text,                                -- obligatorio en la práctica; null = llave por teléfono
  telefono         text,                                -- llave de respaldo (sin correo)
  promos           boolean not null default true,       -- consentimiento para novedades (Ley 29733)
  tipo             text not null check (tipo in ('unico','mensual','prueba')),
  vence_at         timestamptz,                         -- null = de por vida (pago único)
  bloqueado        boolean not null default false,
  token            text not null unique,                -- el código del link personal (?acceso=)
  nodo_order_id    uuid,                                -- último pedido que lo creó o renovó
  prueba_usada     boolean not null default false,      -- ya tuvo su prueba gratis (una por persona)
  aviso_previo_at  timestamptz,                         -- recordatorio «por vencer» ya mandado (se limpia al renovar)
  aviso_vencido_at timestamptz,                         -- aviso «venció hoy» / «terminó tu prueba» ya mandado
  ultimo_uso_at    timestamptz,
  creado_at        timestamptz not null default now(),
  actualizado_at   timestamptz not null default now(),
  unique (app_id, nodo_contact_id)
);
create index if not exists accesos_app_idx on accesos (app_id);
create index if not exists accesos_vence_idx on accesos (vence_at) where vence_at is not null;

-- Pulseras: cada celular/navegador que entró con el link. Se guarda el HASH (la pulsera
-- en claro solo vive en el navegador del cliente).
create table if not exists sesiones (
  id           uuid primary key default gen_random_uuid(),
  acceso_id    uuid not null references accesos(id) on delete cascade,
  pulsera_hash text not null unique,
  etiqueta     text not null default '',               -- «Android · Chrome», para reconocerlo en la ficha
  creado_at    timestamptz not null default now(),
  ultimo_uso_at timestamptz not null default now()
);
create index if not exists sesiones_acceso_idx on sesiones (acceso_id);

-- El «casillero» de cada cliente en cada app: la app decide qué guarda adentro.
create table if not exists progreso (
  acceso_id      uuid primary key references accesos(id) on delete cascade,
  datos          jsonb not null default '{}'::jsonb,
  actualizado_at timestamptz not null default now()
);

-- Bitácora corta por acceso (celular nuevo, desconectado por límite, bloqueo…).
create table if not exists eventos_acceso (
  id         bigserial primary key,
  acceso_id  uuid not null references accesos(id) on delete cascade,
  tipo       text not null,
  detalle    text not null default '',
  creado_at  timestamptz not null default now()
);
create index if not exists eventos_acceso_idx on eventos_acceso (acceso_id, creado_at desc);

alter table apps            enable row level security;
alter table accesos         enable row level security;
alter table sesiones        enable row level security;
alter table progreso        enable row level security;
alter table eventos_acceso  enable row level security;
-- Sin políticas a propósito: anon y authenticated no ven nada. Solo service role.
