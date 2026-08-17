-- ═══════════════════════════════════════════════════════════════════
-- Nodo · 0073 — El secreto del webhook de Telegram y el código de pairing NO deben ser
-- legibles por los MIEMBROS de la cuenta.
--
-- El problema: la RLS de `channels` es por-FILA, así que un OPERADOR (no admin) podía leer
-- `telegram_webhook_secret` y con eso forjar el webhook PÚBLICO de Telegram (única auth =
-- ese secreto en un header) con un callback `adel_ok/saldo_ok/digital_ok/extra_ok:<order>`
-- → APROBAR PAGOS saltándose el gate de admin. Escalada operador → aprobar-dinero.
--
-- ⚠️ IMPORTANTE (por qué la 1ª versión de esta migración NO funcionó): en Postgres un
-- `REVOKE SELECT (columna)` es un NO-OP si el rol ya tiene `SELECT` a nivel de TABLA (que
-- Supabase otorga por defecto a authenticated/anon) — el grant de tabla cubre TODAS las
-- columnas. La forma correcta es REVOCAR el SELECT de tabla y RE-OTORGARLO columna por
-- columna, SIN las 2 sensibles. El service_role (edge functions) no se ve afectado.
--
-- El panel ya NO lee estas columnas (usa channel-config: status.copiloto y la acción
-- telegram_pair_status). Verificado: ninguna consulta del panel hace select("*") sobre
-- channels ni pide estas 2 columnas.
--
-- MANTENIMIENTO: al AGREGAR una columna nueva a `channels`, hay que otorgarle SELECT acá
-- (o el panel no podrá leerla). Las 2 sensibles quedan deliberadamente fuera.
-- ═══════════════════════════════════════════════════════════════════
revoke select on public.channels from authenticated, anon;

grant select (
  id, nombre, channel_type, phone_number_id, waba_id, pixel_id, page_id, verify_token,
  vertical, telegram_chat_ids, buffer_default_seg, activo, created_at, ia_provider,
  logo_url, timezone, gsheets, negocio, ia_perfiles, ia_router, negocio_form, ocr_config,
  pedidos_config, remarketing, entregas, telegram_avisos, account_id, ad_account_id,
  ads_sync_error, ads_sync_at, moneda, resumenes, resumen_estado
) on public.channels to authenticated, anon;
