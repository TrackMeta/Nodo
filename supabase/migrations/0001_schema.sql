-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0001 — Esquema base (Fase 1: núcleo de mensajería)
-- Multi-tenant por canal. Todo scopeado por channel_id.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;      -- gen_random_uuid()

-- ── Tipos enumerados ────────────────────────────────────────────────
create type channel_type as enum ('whatsapp', 'webchat');
create type msg_direction as enum ('in', 'out');
create type msg_type as enum (
  'text', 'image', 'audio', 'video', 'document',
  'sticker', 'location', 'button', 'interactive', 'template', 'system'
);
create type msg_status as enum ('pending', 'sent', 'delivered', 'read', 'failed');
create type window_type as enum ('service_24h', 'fep_72h');
create type user_role as enum ('admin', 'operador');
create type field_mode as enum ('dinamico', 'fijo');
create type field_type as enum ('text', 'number', 'date', 'boolean');

-- ── channels: 1 fila = 1 número/cuenta = su propio mundo ────────────
create table channels (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  channel_type    channel_type not null default 'whatsapp',
  phone_number_id text unique,          -- clave de ruteo del webhook (WhatsApp)
  waba_id         text,
  pixel_id        text,
  page_id         text,                 -- necesario para CAPI business_messaging (CTWA)
  verify_token    text,                 -- verificación del webhook (GET hub.challenge)
  vertical        text,
  telegram_chat_ids text[],             -- admins que reciben notificaciones
  buffer_default_seg int not null default 4,   -- debounce anti-respuesta-triple
  activo          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index idx_channels_phone on channels(phone_number_id);

-- ── channel_secrets: referencias a Vault (solo service_role) ────────
-- Los valores reales viven cifrados en vault.secrets. Aquí solo los IDs.
create table channel_secrets (
  channel_id           uuid primary key references channels(id) on delete cascade,
  access_token_id      uuid not null,      -- vault.secrets.id (token de Meta)
  app_secret_id        uuid not null,      -- vault.secrets.id (App Secret)
  capi_token_id        uuid,               -- vault.secrets.id (token CAPI)
  telegram_bot_token_id uuid,              -- vault.secrets.id (bot Telegram)
  created_at           timestamptz not null default now()
);

-- ── app_users: mapea auth.users → rol ───────────────────────────────
create table app_users (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text,
  role       user_role not null default 'operador',
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── tags (etiquetas) — motor de estado del embudo ──────────────────
create table tags (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  nombre     text not null,
  color      text not null default 'blue',
  created_at timestamptz not null default now(),
  unique (channel_id, nombre)
);

-- ── custom_fields: definición (dinámico vs fijo) ────────────────────
create table custom_fields (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  nombre     text not null,
  key        text not null,               -- variable {{key}}
  tipo       field_type not null default 'text',
  modo       field_mode not null default 'dinamico',
  created_at timestamptz not null default now(),
  unique (channel_id, key)
);

-- ── contacts ────────────────────────────────────────────────────────
create table contacts (
  id                    uuid primary key default gen_random_uuid(),
  channel_id            uuid not null references channels(id) on delete cascade,
  wa_id                 text not null,          -- teléfono E.164 sin +
  nombre                text,
  stage                 text not null default 'nuevo',
  -- Atribución CTWA capturada del webhook (referral):
  ad_id                 text,
  ctwa_clid             text,
  source                text,
  -- Estado de runtime:
  last_input            text,
  last_input_type       text,
  bot_activo            boolean not null default true,
  consecutive_failed_reply int not null default 0,
  primera_interaccion   timestamptz not null default now(),
  ultimo_mensaje_at     timestamptz not null default now(),
  ultimo_mensaje_cliente_at timestamptz,        -- ancla de ventana 24h y remarketing
  created_at            timestamptz not null default now(),
  unique (channel_id, wa_id)
);
create index idx_contacts_channel_last on contacts(channel_id, ultimo_mensaje_at desc);
create index idx_contacts_wa on contacts(channel_id, wa_id);

-- ── contact_tags (N:M) ─────────────────────────────────────────────
create table contact_tags (
  contact_id uuid not null references contacts(id) on delete cascade,
  tag_id     uuid not null references tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);

-- ── contact_field_values (EAV) ─────────────────────────────────────
create table contact_field_values (
  contact_id uuid not null references contacts(id) on delete cascade,
  field_id   uuid not null references custom_fields(id) on delete cascade,
  value      text,
  updated_at timestamptz not null default now(),
  primary key (contact_id, field_id)
);

-- ── conversations: ventana activa por contacto ─────────────────────
create table conversations (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references channels(id) on delete cascade,
  contact_id  uuid not null references contacts(id) on delete cascade,
  window_type window_type not null default 'service_24h',
  expira_at   timestamptz,                -- últ. msg del cliente + 24h (o 72h FEP)
  requiere_humano boolean not null default false,
  archivada   boolean not null default false,
  no_leidos   int not null default 0,
  updated_at  timestamptz not null default now(),
  unique (contact_id)
);
create index idx_conversations_channel on conversations(channel_id, updated_at desc);

-- ── messages ────────────────────────────────────────────────────────
create table messages (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  direction  msg_direction not null,
  type       msg_type not null default 'text',
  content    jsonb not null default '{}'::jsonb,   -- { text, media_url, caption, ... }
  wamid      text,                                  -- id de mensaje de Meta
  status     msg_status not null default 'pending',
  error      jsonb,                                 -- { code, subcode, message }
  ts         timestamptz not null default now()
);
-- Idempotencia: Meta puede reenviar el mismo webhook.
create unique index idx_messages_wamid on messages(wamid) where wamid is not null;
create index idx_messages_contact_ts on messages(contact_id, ts desc);

-- ── Trigger: al insertar un mensaje, refrescar la conversación ─────
-- updated_at siempre; no_leidos +1 solo en mensajes entrantes.
create or replace function touch_conversation() returns trigger
language plpgsql as $$
begin
  update conversations
     set updated_at = now(),
         no_leidos  = case when new.direction = 'in'
                           then no_leidos + 1 else no_leidos end
   where contact_id = new.contact_id;
  return new;
end;
$$;
create trigger trg_touch_conversation
  after insert on messages
  for each row execute function touch_conversation();
