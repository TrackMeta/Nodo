-- ═══════════════════════════════════════════════════════════════════
-- 0045 · Free Entry Point (ventana gratis de 72h de los anuncios CTWA)
--   El cliente que llega por un anuncio Click-to-WhatsApp abre una
--   ventana de 72h donde TODO mensaje saliente es gratis (Meta). La
--   anclamos en el contacto: fep_hasta = primer mensaje del anuncio
--   + 72h. Un clic nuevo en un anuncio la re-abre.
--   La ventana efectiva de escritura (conversations.expira_at) pasa a
--   ser max(últ. msg cliente + 24h, fep_hasta).
-- ═══════════════════════════════════════════════════════════════════

alter table contacts add column if not exists fep_hasta timestamptz;

comment on column contacts.fep_hasta is
  'Fin de la ventana Free Entry Point (mensaje con referral CTWA + 72h). Null = nunca llegó por anuncio.';
