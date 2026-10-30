-- 💱 Tipo de cambio automático (29-oct). Cuánto vale UN dólar en cada moneda, un registro por día.
-- Lo baja el scheduler una vez al día de open.er-api.com (gratis, sin clave) y con eso actualiza
-- channels.usd_rate de cada bot: ya nadie lo escribe a mano. El historial queda para los reportes
-- (convertir cada venta con el tipo de cambio del día en que se vendió).
create table if not exists public.tipos_cambio (
  fecha      date    not null,
  moneda     text    not null,
  por_usd    numeric not null,          -- 1 USD = por_usd de esta moneda
  fuente     text,
  created_at timestamptz not null default now(),
  primary key (fecha, moneda)
);
alter table public.tipos_cambio enable row level security;
-- Es un dato público (no es de ningún negocio): cualquiera con sesión lo puede leer; solo el
-- service role (el scheduler) escribe.
drop policy if exists tipos_cambio_leer on public.tipos_cambio;
create policy tipos_cambio_leer on public.tipos_cambio for select to authenticated using (true);
