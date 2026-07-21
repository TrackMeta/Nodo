-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0041 — Multi-tenant, Fase 5: storage por cuenta
--
-- Los archivos se agrupan por cuenta en rutas  acct/{account_id}/…  (lo setean
-- las Edge Functions al subir: engine.ingestImage y media-upload).
--
-- Esta política scope-a el acceso AUTENTICADO (API del panel) a la propia
-- cuenta. OJO — el READ PÚBLICO por URL (WhatsApp descargando la media saliente
-- + {{ultima_imagen}}) NO pasa por RLS porque el bucket `media` es público, así
-- que sigue funcionando igual. Privatizar los comprobantes (bucket privado +
-- URL firmada) es D4, se hace después.
--
-- Las subidas van por service_role (Edge Functions), que se salta RLS; por eso
-- solo hace falta la política de SELECT (listar/leer) para el panel. Escritura
-- autenticada directa queda denegada (sin política) a propósito.
-- ═══════════════════════════════════════════════════════════════════

drop policy if exists media_tenant_read on storage.objects;
--##--
create policy media_tenant_read on storage.objects for select to authenticated
using (
  bucket_id = 'media'
  and (storage.foldername(name))[1] = 'acct'
  and (storage.foldername(name))[2] in (
    select account_id::text from account_members where user_id = auth.uid() and activo
  )
);
