-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0015 — Estado de revisión de plantillas + carpetas de campañas
-- ═══════════════════════════════════════════════════════════════════

-- Estado de la plantilla en Meta (revisión). Al registrarla la damos por
-- aprobada; cuando sincronicemos con Meta se actualizará automáticamente.
alter table wa_templates add column if not exists estado_meta text not null default 'aprobada';
  -- aprobada | pendiente | rechazada

-- Carpeta para organizar campañas (texto libre; null = sin carpeta).
alter table campaigns add column if not exists folder text;
