-- Sección "Directo": centro de control de seguimiento por llamada/contacto directo.
-- Guarda el seguimiento manual de cada lead (intentos de contacto, próxima llamada,
-- asesora asignada, estado del seguimiento) en un JSONB sobre el contacto.
--
-- Forma del objeto directo:
--   {
--     "intentos":   [ { "at": ISO, "by": uuid, "by_name": str, "medio": "llamada|whatsapp", "resultado": str, "nota": str } ],
--     "next_call_at": "YYYY-MM-DD" | null,   -- reagendado (próxima llamada)
--     "assigned_to":  uuid | null,           -- asesora responsable
--     "assigned_name": str  | null,
--     "estado":       "pendiente|seguimiento|cerrado|descartado"
--   }
-- Vacío = {} → lead sin seguimiento aún (aparece como "Sin contactar").
alter table public.contacts
  add column if not exists directo jsonb not null default '{}'::jsonb;

-- Índice para "mis leads" (filtrar por asesora asignada) y reagendados de hoy.
create index if not exists idx_contacts_directo_assigned
  on public.contacts ((directo->>'assigned_to'));
create index if not exists idx_contacts_directo_next
  on public.contacts ((directo->>'next_call_at'));
