-- ═══════════════════════════════════════
-- Nodo · 0086 — Fichas de las oficinas Shalom (imagen por sede)
--
-- Cuando el bot le confirma la sede al cliente le manda una FICHA con el nombre,
-- la dirección y la referencia. Decírselo en texto ya se hacía; la ficha es lo
-- que el cliente reenvía por WhatsApp a quien va a recoger, o le muestra al
-- mototaxista. No son fotos del local (no las tenemos): son los mismos datos de
-- la lista de agencias, dibujados.
--
-- La tabla es GLOBAL, no por canal: las oficinas de Shalom son las mismas para
-- todos los negocios. Por eso no lleva channel_id ni RLS por cuenta — solo el
-- servicio escribe, y cualquier miembro logueado puede leer.
-- ═══════════════════════════════════════

create table if not exists sede_imagenes (
  slug          text primary key,            -- slugAgencia(): depto-prov-distrito-nombre
  url           text not null,               -- pública, en el bucket `media`
  nombre        text,                        -- para reconocerla desde el panel
  actualizado_at timestamptz not null default now()
);

alter table sede_imagenes enable row level security;

-- Lectura para cualquiera logueado (el motor entra con service_role y bypassa).
drop policy if exists sede_imagenes_select on sede_imagenes;
create policy sede_imagenes_select on sede_imagenes
  for select to authenticated using (true);

-- La escritura la hace el generador con la sesión del dueño de la cuenta; el
-- catálogo es común, así que basta con estar logueado. No hay dato de nadie acá.
drop policy if exists sede_imagenes_write on sede_imagenes;
create policy sede_imagenes_write on sede_imagenes
  for all to authenticated using (true) with check (true);
