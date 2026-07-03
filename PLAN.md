# PLAN — "Nodo" · Alcance v1 + Modelo de datos + Fases

> Consolida la definición (ver [DEFINICION.md](DEFINICION.md), v0.33) en un plan construible. **Aún NO se escribe código** hasta aprobar este plan.
> Fecha: 2026-07-02.

---

## 1. Alcance v1 — IN / OUT

### ✅ IN (v1)
- **Multi-tenant por número** (WhatsApp Cloud API directa, sin BSP), aislamiento total por `channel_id` + RLS. Secrets en Vault.
- **Webhook:** verificación (hub.challenge), firma X-Hub-Signature-256 por canal, recepción, statuses (delivered/read/failed), captura de `referral` CTWA (ad_id, ctwa_clid), clasificación de `last_input_type`, mantener `ultimo_mensaje_cliente`.
- **Envío:** texto + multimedia (imagen/PDF/audio/archivo), control de ventana 24h.
- **Bandeja Realtime:** pestañas completas, bot on/off por contacto (pausa auto al intervenir humano), handoff (tab "Requiere humano" + aviso Telegram), botón "Registrar venta".
- **Motor de flujos (`flow-runner`):** ejecución por grafo, estado por contacto (`flow_runs`), buffer/debounce de mensajes.
- **Esqueletos (plantillas base) → Productos (copias):** separación Contenido/Estructura, vista Contenido autogenerada, campos fijos por producto, biblioteca de medios, editor "Todos los textos".
- **Nodos v1** (ver §3) y **triggers** (entrada, palabra clave, botón, referral, disparador IA).
- **IA configurable por nodo** (default Claude): analizar imagen (OCR anti-fraude consciente de versión), generar texto (con memoria + funciones + ramas Éxito/Fallo), extraer datos; **STT** de audios entrantes.
- **Ruteo determinista de versiones** (botón + campo + Condición) y **disambiguación de comprobante por estado**.
- **Secuencias conscientes de la conversación** (remarketing P1–P4) + **scheduler cron**.
- **CAPI:** **Lead = automático de sistema** (primer mensaje de contacto nuevo, config por canal); **InitiateCheckout y Purchase = nodos**; ctwa_clid, order_id (dedup), EMQ (hash SHA-256), fallback business_messaging→website (**requiere `page_id` por canal**), **valor por contacto**.
- **Notificaciones Telegram** (nodo), **Google Sheets** (nodo opcional) + **métricas nativas mínimas** (leads/ventas).
- **Sección "Palabras Clave"** (gestión de gatillos keyword → flujo) + **creación inline de etiquetas/campos** desde los nodos.
- **Plantillas export/import**, flujos **Borrador/Publicar**, roles **admin/operador**.
- **Webchat** como banco de pruebas interno.

### ⛔ OUT (fases posteriores)
Audio de voz saliente (ElevenLabs) · Dashboard completo/ROAS/conexión Meta Ads · Campañas/broadcast + plantillas WhatsApp proactivas · Booking/Calendarios · Tareas · IG/FB/TikTok · Opt-out automático · Asignación round-robin · Campos fijos globales por número · E-commerce (carritos/órdenes) · API pública / webhooks salientes.

---

## 2. Diferenciadores clave (vs ScaleChat/ChatLevel)
1. **Ruteo determinista** para decisiones críticas (versión, pago): la IA entiende, el sistema decide (§6-QUINQUE).
2. **Disambiguación de comprobante por estado**, no por monto (§6-QUINQUE).
3. **Remarketing consciente de la conversación** (no molesta a quien está activo) (§6-TER).
4. **Separación Contenido/Estructura** + esqueletos clonables → autoría rápida, sin editar nodo por nodo (§6-SEXIES).
5. **CAPI directo** (sin proxy de terceros), con valor real por venta.

---

## 3. Catálogo de nodos v1

| Nodo | Función | Salidas |
|---|---|---|
| **Mensaje** | Texto + multimedia + botones | Continuar (o una rama por botón) |
| **Pregunta** | Espera respuesta, guarda en variable | Continuar |
| **Condición** | Ramifica por tag/campo/canal/hora (Y/O) | Rama(s) + "si no cumple" |
| **Acción** | add/remove_tag, set/append/clear_field, subscribe/unsubscribe_seq, transfer_human, notify_admin (Telegram), reset_contacto, generar aleatorio | Continuar |
| **IA** | analizar imagen (OCR) · generar texto · extraer datos; proveedor/modelo, memoria, funciones (tools) | Éxito / Fallo |
| **Esperar** | Pausa (segundos) | Continuar |
| **Iniciar flujo** | Salta a otro flujo | — |
| **Evento Facebook (CAPI)** | Lead / InitiateCheckout / Purchase con variables | Continuar |
| **Enviar a Google Sheets** (opcional) | Log de venta/lead | Éxito / Fallo |
| **Fin** | Termina el flujo | — |

**Triggers de flujo:** entrada (fallback), palabra clave (match configurable), botón, referral CTWA (por ad_id), disparador IA (function-calling). Ver §6-BIS.

---

## 4. Modelo de datos (tablas principales)

**Canales / seguridad:** `channels` (channel_type wa/webchat, phone_number_id, waba_id, pixel_id, **page_id**, verify_token, telegram_chat_ids, buffer_default_seg, activo) · `channel_secrets` (Vault: access_token, app_secret, capi_token, telegram_bot_token) · `app_users` (role admin/operador).

**Contactos / conversación:** `contacts` (wa_id, nombre, stage, **ad_id, ctwa_clid, source**, last_input, last_input_type, ultimo_mensaje_at, bot_activo, **consecutive_failed_reply**) · `conversations` (window_type, expira_at) · `messages` (direction, type, content jsonb, wamid **unique (idempotencia ante retries de Meta)**, status, ts) · `tags` + `contact_tags`.

**Campos:** `custom_fields` (nombre, key, tipo, **modo: dinamico|fijo**, scope) · `contact_field_values` (contact_id, field_id, value).

**Contenido / flujos:** `products` (+ campos fijos por producto) · `product_versions` (price_list[], drive_link, prompt) · `skeletons` (plantilla base) · `flows` (copia por producto/rol, estado borrador/activo) · `flow_nodes` (tipo, config jsonb, pos) · `flow_edges` (origen, rama, destino) · `flow_triggers` (la sección "Palabras Clave" es una vista de gestión sobre estos, tipo=keyword; **flag `interrumpe` por keyword, default false**) · `flow_runs` (nodo_actual, variables jsonb, estado, **wake_at** — para Esperar/debounce — y **lock por contacto**: un solo run activo por contacto) · `media_library` · `templates` (export/import bundles).

**Secuencias:** `sequences` (pasos: umbral_silencio, contenido) · `sequence_subscriptions` (contact_id, paso_actual, estado).

**Ventas / conversiones:** `sales` (inmutable: producto, versión, valor, order_id, ts) · `capi_events` (event_name, value, currency, event_id, ctwa_clid, estado, meta_response).

---

## 5. Edge Functions
`whatsapp-webhook` · `whatsapp-send` · `flow-runner` (motor) · `capi-dispatch` · `sequence-scheduler` (cron/pg_cron — **también despierta los `flow_runs` con `wake_at` vencido**) · `ai-proxy` (LLM/visión/STT, multiproveedor) · `telegram-notify` · `template-export` / `template-import` · `media-upload`.

**Reglas transversales del motor (auditoría):**
1. **Gate único de ventana:** todo envío (operador / flow-runner / scheduler) pasa por un solo módulo de salida que valida `conversations.expira_at` (cubre 24h y FEP 72h).
2. **Lock por contacto:** nunca dos ejecuciones concurrentes del flow-runner sobre el mismo contacto (advisory lock; mensajes extra van al buffer).
3. **Idempotencia:** dedup por `wamid` en recepción (Meta reenvía webhooks) y por `event_id`/`order_id` en CAPI.
4. **Keyword vs run activo:** una keyword NO interrumpe un flujo en curso salvo que tenga el flag `interrumpe` (default: solo aplica sin run activo).
5. **Reset contacto (post-venta):** limpia tags + campos dinámicos + suscripciones a secuencias; **conserva** identidad (wa_id, nombre), historial de mensajes, ventas (`sales`) y atribución del último ad.

---

## 6. Plan por fases

**Fase 1 — Núcleo de mensajería.** DB + RLS + Vault · webhook (verificación, firma, recepción, statuses, referral, tipo de mensaje) · `whatsapp-send` · bandeja Realtime mínima (lista, chat, envío, bot on/off, registrar venta manual). *Aceptación: mensaje del cel → bandeja <5s; respuesta → delivered/read; firma inválida → 401; sin tokens en el navegador.*

**Fase 2 — Motor de flujos + autoría.** **Spike inicial: validar Drawflow por CDN** (canvas fluido con ~40 nodos; plan B LiteGraph) · `flow-runner` (grafo, estado, **lock por contacto, wake_at**, buffer/debounce) · nodos base (Mensaje, Pregunta, Condición, Acción, Esperar, Iniciar flujo, Fin) · triggers (entrada, keyword, botón, referral) · **sección Palabras Clave** · Esqueletos + Productos (Datos/Flujos/Medios) + vista Contenido + campos fijos + biblioteca de medios · **Webchat de pruebas** (canal interno autenticado + botón "Probar este flujo"). *Aceptación: un lead recorre un flujo real (bienvenida→bifurcación por botón→entrega) editable desde la vista Contenido y probado desde el webchat.*

**Fase 3 — IA + pagos + conversiones.** `ai-proxy` (Claude visión/texto + STT) · nodo IA (con funciones + Éxito/Fallo) · OCR anti-fraude consciente de versión · disambiguación por estado · `capi-dispatch` (Lead+IC+Purchase, dedup, EMQ, fallback) · `telegram-notify` · nodo Google Sheets. *Aceptación: comprobante Yape válido → entrega versión correcta + Purchase en Test Events + aviso Telegram; comprobante inválido → pide corrección → humano.*

**Fase 4 — Remarketing + operación.** Secuencias conscientes + `sequence-scheduler` · métricas nativas mínimas · plantillas export/import · Borrador/Publicar · roles/operador · handoff completo. *Aceptación: remarketing P1–P4 respeta silencio/humano/compra; alta de número por plantilla en minutos.*

**Fase 5+ — Ampliaciones.** Audio de voz (ElevenLabs) · dashboard/ROAS + Meta Ads · campañas/broadcast · otros canales · booking/tareas.

---

## 7. Riesgos / a validar en construcción
- **Canvas single-file:** Drawflow por CDN — spike al inicio de Fase 2 (~40 nodos fluidos). Plan B: LiteGraph.js; Plan C: canvas propio simplificado.
- **Esperas en Edge Functions:** las functions son efímeras — "Esperar Ns" y el debounce NO pueden bloquear. Patrón: `flow_runs.wake_at` + scheduler que despierta runs vencidos (esperas cortas ≤5s pueden usar `waitUntil`).
- **Concurrencia:** 2 mensajes seguidos = 2 webhooks casi simultáneos → obligatorio el lock por contacto (regla transversal #2) o habrá duplicados/estado corrupto.
- **Costos de IA** (visión + STT) por volumen — medir en Fase 3 con tráfico real.
- **Ventana:** umbrales de remarketing validan contra `expira_at` real (no constante 24h); P1–P4 diseñados < 24h.
- **Límites Supabase Free:** 500K invocaciones Edge/mes, 500MB DB, 200 conexiones Realtime, 1GB Storage. El scheduler cada minuto ya consume ~43K/mes. Free alcanza para pruebas y 1–2 números; **plan upgrade a Pro (~$25/mes) al escalar a varios números con ads activos.**
- **Tokens de Meta:** aunque el System User token "no caduca", puede invalidarse (cambio de contraseña/permisos/seguridad). La pantalla "Salud del canal" (§7-UI DEFINICION) lo detecta temprano.
