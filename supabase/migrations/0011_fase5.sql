-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0011 — Fase 5: plantillas HSM, campañas/broadcast y dashboard
-- Plantillas de WhatsApp (para enviar fuera de la ventana de 24h) y
-- campañas masivas a segmentos. Más un RPC de métricas para el dashboard.
-- ═══════════════════════════════════════════════════════════════════

-- ── Plantillas de WhatsApp (HSM) ───────────────────────────────────
-- Se registran/aprueban en Meta; aquí guardamos su nombre/idioma y el
-- mapeo de variables para poder enviarlas con datos del contacto.
create table if not exists wa_templates (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references channels(id) on delete cascade,
  name         text not null,                       -- nombre registrado en Meta
  language     text not null default 'es',
  categoria    text,                                -- MARKETING | UTILITY | AUTHENTICATION
  body_preview text,                                -- texto con {{1}} {{2}} (vista)
  params       jsonb not null default '[]'::jsonb,  -- ['{{nombre}}','{{producto}}'] fuente de cada variable
  header_text  text,
  activa       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (channel_id, name, language)
);

-- ── Campañas / broadcast ───────────────────────────────────────────
do $$ begin
  create type campaign_estado as enum ('borrador','programada','enviando','completada','cancelada');
exception when duplicate_object then null; end $$;

create table if not exists campaigns (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references channels(id) on delete cascade,
  nombre       text not null,
  template_id  uuid references wa_templates(id) on delete set null,
  -- Segmento: { stage:[...], tags:[...], modo:'cualquiera'|'todas' }
  segmento     jsonb not null default '{}'::jsonb,
  programada_at timestamptz,                         -- null = enviar al activar
  estado       campaign_estado not null default 'borrador',
  total        int not null default 0,
  enviados     int not null default 0,
  fallidos     int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_campaigns_scan on campaigns(estado)
  where estado in ('programada','enviando');

create table if not exists campaign_sends (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  contact_id  uuid not null references contacts(id) on delete cascade,
  estado      text not null default 'pendiente',    -- pendiente | enviado | fallido
  wamid       text,
  error       jsonb,
  sent_at     timestamptz,
  unique (campaign_id, contact_id)
);
create index if not exists idx_csends_pending on campaign_sends(campaign_id)
  where estado = 'pendiente';

-- ── RLS ────────────────────────────────────────────────────────────
alter table wa_templates    enable row level security;
alter table campaigns       enable row level security;
alter table campaign_sends  enable row level security;

drop policy if exists tpl_member on wa_templates;
create policy tpl_member on wa_templates for all using (is_member()) with check (is_member());
drop policy if exists camp_member on campaigns;
create policy camp_member on campaigns for all using (is_member()) with check (is_member());
-- Los envíos los escribe el motor (service_role); el panel solo lee.
drop policy if exists csends_read on campaign_sends;
create policy csends_read on campaign_sends for select using (is_member());

-- ── Dashboard: métricas agregadas por canal ────────────────────────
create or replace function dashboard_stats(p_channel_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'contactos',       (select count(*) from contacts where channel_id = p_channel_id),
    'por_stage',       (select coalesce(jsonb_object_agg(stage, n),'{}'::jsonb)
                          from (select stage, count(*) n from contacts
                                where channel_id = p_channel_id group by stage) s),
    'mensajes_hoy_in', (select count(*) from messages
                          where channel_id = p_channel_id and direction='in'
                            and ts >= date_trunc('day', now())),
    'mensajes_hoy_out',(select count(*) from messages
                          where channel_id = p_channel_id and direction='out'
                            and ts >= date_trunc('day', now())),
    'purchases',       (select count(*) from capi_events
                          where channel_id = p_channel_id and event_name='Purchase' and estado='enviado'),
    'ingresos',        (select coalesce(sum(value),0) from capi_events
                          where channel_id = p_channel_id and event_name='Purchase' and estado='enviado'),
    'leads',           (select count(*) from capi_events
                          where channel_id = p_channel_id and event_name='Lead' and estado='enviado'),
    'runs_activos',    (select count(*) from flow_runs
                          where channel_id = p_channel_id and estado in ('activo','esperando')),
    'subs_activas',    (select count(*) from sequence_subscriptions
                          where channel_id = p_channel_id and estado='activa'),
    'requiere_humano', (select count(*) from conversations
                          where channel_id = p_channel_id and requiere_humano)
  );
$$;

revoke all on function dashboard_stats(uuid) from anon, public;
grant execute on function dashboard_stats(uuid) to authenticated;
