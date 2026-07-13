# DEFINICIÓN — "Nodo"
### CRM + plataforma de automatización de WhatsApp Cloud API (propia)

> **Documento vivo.** Se actualiza cada vez que Rodrigo aporta información (specs, aclaraciones, capturas). Es el brief maestro del que saldrá el plan técnico final. **Aún NO se construye código** — estamos en fase de definición hasta llegar al 100% de claridad.
>
> **Última actualización:** 2026-07-13 · **Versión:** 0.37
>
> **Terminología (2026-07-12):** lo que en este documento aparece como **"order bump" / "Order Bump"** se llama en la plataforma **"Compra extra"** (nombre visible en la UI: Dashboard, Compras/Pedidos, etc.). Las menciones históricas del changelog y los nombres de etiquetas/flujos **observados de ScaleChat** se conservan tal cual para no perder ese contexto; el término de producto de ahora en adelante es **Compra extra**. A nivel de datos el campo interno sigue siendo `order_bumps`.

---

## 0. Estado de la definición (semáforo)

| Área | Claridad | Notas |
|---|---|---|
| Objetivo de negocio | 🟢 Claro | Reemplazar ScaleChat 2.0 con sistema propio, uso interno |
| Stack técnico | 🟢 Cerrado | Supabase + panel HTML single-file + Meta Cloud API directa |
| Arquitectura multi-canal | 🟢 Claro | 1 canal = 1 número = 1 BM = 1 Pixel; webhook único ruteado por phone_number_id. Cada número INDEPENDIENTE |
| Bandeja / Inbox | 🟢 Claro | Pestañas completas, bot on/off por contacto, handoff doble red, registrar venta |
| **Flow Builder (node-based)** | 🟢 Claro | Motor central. Catálogo de nodos v1 cerrado en PLAN §3. Modelo Esqueleto→Producto (clon) + vista Contenido |
| Secuencias (drip) | 🟢 Claro | **Conscientes de la conversación** (§6-TER): ancla al silencio, doble compuerta, pausar/reanudar, dentro de la ventana |
| Campañas (masivas) | 🟢 Decidido | **Fase posterior** (no v1) |
| CAPI / Eventos | 🟢 Claro | Lead (auto) + InitiateCheckout + Purchase (nodos); ctwa_clid, order_id dedup, fallback business_messaging→website, EMQ SHA-256, **page_id por canal**. Directo a Graph API |
| Etiquetas + Campos personalizados | 🟢 Claro | Motor de estado. Dos tipos: dinámicos (runtime) y fijos (por producto). Creación inline desde nodos |
| IA (validación de pagos, asistente) | 🟢 Claro | Configurable por nodo (default Claude); OCR anti-fraude consciente de versión; STT en v1; TTS ElevenLabs posterior |
| Multi-canal | 🟢 Claro | WhatsApp + Webchat (banco de pruebas); Telegram solo notifica a admins. IG/FB/TikTok fuera |
| Módulos avanzados (rotador, warmup, landings, tienda) | 🟢 Decidido | **Descartados** (warmup no aplica a Cloud API; tienda/landings/rotador fuera) |
| Autoría (Esqueletos/Productos/Contenido) | 🟢 Claro | §6-SEXIES modelo final: esqueleto=molde, producto=copias+cuerpo, campos fijos por producto |
| Robustez del motor | 🟢 Auditado | Lock por contacto, wake_at para esperas, gate único de ventana, keyword no interrumpe run activo (ver PLAN §7) |
| **Productos FÍSICOS** | 🟢 Decidido | §6-SEPTIES: diseño cerrado 2026-07-13 (bot cierra adelanto+datos, humano opera logística desde Kanban; adelanto fijo/%, envío gratis y Lima-COD configurables; plantillas Utility OK; variantes sí). Construcción pendiente |
| Conocimiento del negocio + perfiles IA | 🟢 Construido | §6-OCTIES implementado 2026-07-13: Ajustes→General (negocio), ficha de producto (contexto+FAQ), Config→IA (perfiles por tarea), motor concatena los 3 niveles |

---

## 1. Contexto y objetivo

Rodrigo es emprendedor digital en **Lima, Perú**. Vende infoproductos (ebooks/cursos) vía **Meta Ads → Click-to-WhatsApp → cierre por WhatsApp** con pagos **Yape/Plin** y entrega por **Google Drive**.

Hoy usa **ScaleChat 2.0** conectado a WhatsApp Cloud API (integración directa vía Meta Developers, **sin BSP**). Quiere **reemplazar ScaleChat con su propio sistema**, solo para uso interno (él + 1-2 operadores máximo).

**Objetivo:** un CRM/plataforma de WhatsApp multi-número que:
1. Reciba y envíe mensajes vía WhatsApp Cloud API (webhook propio).
2. Soporte hasta **10 números**, cada uno en su propio Business Manager (aislamiento total de riesgo).
3. Dispare eventos de conversión (**CAPI**) al Pixel correspondiente de cada número, con valor real de venta.
4. Tenga bandeja web para operar conversaciones manualmente Y **automatización de flujos** (decisión tomada: sí se construye Flow Builder visual).

---

## 2. Stack obligatorio (cerrado — no proponer alternativas)

- **Backend:** Supabase — Postgres + Auth + Edge Functions (Deno/TypeScript). Empieza en plan Free; diseño compatible con Pro.
- **Frontend:** panel **HTML single-file** (HTML+CSS+JS vanilla, sin frameworks ni build step) en GitHub Pages. Patrón probado del usuario (Tracker Pro, COD PRO). *(Nota de riesgo pendiente: un Flow Builder visual complejo dentro de un único HTML sin build es un reto de ingeniería — a discutir en el plan técnico.)*
- **APIs de Meta:** WhatsApp Cloud API (Graph API v25.0+) directa, sin BSP. Conversions API (CAPI).
- **Seguridad:** RLS en todas las tablas; operaciones sensibles vía SECURITY DEFINER / Edge Functions. Nunca exponer service_role ni tokens de Meta en el frontend.
- **Timezone:** America/Lima (UTC-5) en todo. `Intl.DateTimeFormat`, nunca offsets manuales.

### Decisiones de diseño ya tomadas
- **Realtime:** bandeja vía **Supabase Realtime** (WebSocket), no polling.
- **Infra:** se construye **desde cero** (proyecto Supabase, repo, CLI, secrets).
- **App Secret por canal:** cada número trae su propio App Secret; la firma del webhook se valida con el secret del canal ruteado por `phone_number_id`. Secrets en **Supabase Vault**.
- **Flow Builder visual: SÍ** se construye (confirmado 2026-07-02).
- **Multi-tenant INDEPENDIENTE (confirmado 2026-07-02):** cada uno de los ~10 números es **su propio mundo** — sus propios flujos, etiquetas, campos, secuencias, agente IA, productos. **Aislamiento total** (su propio BM/Pixel). TODO scopeado por `channel_id` con RLS. Al dar de alta un número nuevo, se construyen/clonan sus flujos desde cero. No hay datos compartidos entre números.
- **Canales v1 (confirmado 2026-07-02):** **WhatsApp** (canal real de clientes) + **Webchat** (ver abajo). **Telegram NO es canal de conversación** → es solo **integración de notificaciones**: un bot que avisa las ventas a los administradores. Se implementa como **nodo/acción "Notificar a Administradores (Telegram)"** colocable en cualquier flujo, con mensaje personalizado + variables + imagen (ver §6-QUATER).
- **Webchat = ENTORNO DE PRUEBAS interno (aclarado 2026-07-02):** su uso real NO es captar clientes, sino **probar los flujos sin escribir desde un WhatsApp real**. Es el "banco de pruebas" del equipo: un chat web simple donde ejercitas un flujo end-to-end (equivale a la "Vista previa" de ScaleChat, pero como canal completo). Implicación: no requiere widget público/landing/GDPR; basta un chat interno autenticado en el panel que inyecta mensajes al mismo motor de flujos que WhatsApp. Menor alcance del previsto.
- **Audio de voz (ElevenLabs): FASE POSTERIOR** (confirmado 2026-07-02). v1 va con texto + OCR de comprobantes. El audio de voz clonada se agrega después.
- **Migración: EMPEZAR LIMPIO** (confirmado 2026-07-02). Sin importar datos de ScaleChat; los contactos entran naturalmente con nuevas conversaciones.
- **Métricas/ventas: NATIVAS + nodo opcional a Sheets** (2026-07-02). Todo se guarda en la BD propia y se ve en el panel; además un nodo opcional "Enviar a Google Sheets" para quien quiera copia en hoja.
- **Dashboard v1: MÍNIMO** (2026-07-02). Conteo básico de leads/ventas; el dashboard completo (desglose P1-P4, comparativas) es fase posterior. **ROAS/conexión Meta Ads: fuera de v1.**
- **Campañas / difusión masiva: FASE POSTERIOR** (2026-07-02). v1 = conversación + flujos + remarketing por secuencia. El broadcast masivo (con plantillas) va después.
- **Rol OPERADOR: bandeja + registrar venta** (2026-07-02). Solo atender chats, tomar conversaciones del bot y registrar ventas. Sin acceso a flujos, canales ni configuración (como COD PRO).
- **Proveedor de IA: CONFIGURABLE POR NODO** (2026-07-02). Cada nodo IA elige proveedor y modelo (Claude u OpenAI). **Default: Claude** para visión/OCR de comprobantes y conversación. Flexibilidad tipo ScaleChat.
- **Audios entrantes: TRANSCRIBIR en v1** (2026-07-02). La IA convierte notas de voz del cliente a texto (STT, ej. Whisper/OpenAI) y las procesa. (Frecuente en Perú.) Distinto del audio de SALIDA con ElevenLabs, que es fase posterior.
- **Handoff a humano: tab "Sin asignar" en bandeja + aviso Telegram** (2026-07-02). El chat que requiere humano aparece en una pestaña de la bandeja Y dispara aviso al bot de Telegram de admins. Doble red.
- **Bot se PAUSA automáticamente al intervenir un humano** (2026-07-02). Apenas el operador/admin envía un mensaje a un contacto (o pulsa "atender yo"), el bot **se calla para ESE contacto** y no interrumpe. Se **reactiva manualmente** con un toggle ("bot activo"). Estado bot on/off es **por contacto**.
- **Datos de pago (Yape/Plin/QR): AMBOS según el caso** (2026-07-02). Se pueden entregar por **nodo Mensaje fijo** (determinista) o por el **asistente IA**, configurable por flujo. El número/QR es dato por número/versión.
- **Registro de venta: AUTOMÁTICO + botón manual de respaldo** (2026-07-02). El flujo con OCR registra la venta solo; además un botón **"Registrar venta"** en la bandeja para pagos que entren por fuera del flujo. Red de seguridad.
- **Bandeja v1: pestañas COMPLETAS estilo ScaleChat** (2026-07-02): Todas · Mías · Requiere humano (sin asignar) · Seguimiento · No leído · Archivadas · Bloqueados.
- **Buffer anti-respuesta-triple: HÍBRIDO** (2026-07-02). Default global por número (ej. esperar 4s antes de que la IA responda, juntando mensajes) + posibilidad de ajustarlo con nodos dentro de flujos específicos.
- **Remarketing se pausa con humano y reanuda al reasignar al bot** (confirmado 2026-07-02): humano interviene → secuencia `pausada`; humano reasigna al bot → **reanuda continuando su tiempo** (no reinicia). Ver §6-TER.
- **El asistente IA puede TRANSFERIR A HUMANO por sí mismo** (2026-07-02): herramienta del nodo IA. Disparadores: no sabe qué responder, el cliente **da lisuras/insultos** o se molesta. Al transferir → tab "Requiere humano" + aviso Telegram (misma doble red del handoff).
- **Multimedia SALIENTE: sí** (2026-07-02). Los flujos envían **imágenes, PDFs, audios y otros archivos** (catálogos, bonos, comprobantes de entrega, etc.).
- **Gestión de archivos: AMBOS** (2026-07-02). **Biblioteca de medios en la app** (subir/reutilizar, Supabase Storage) + **URL externa** (Drive/enlaces) cuando se prefiera.
- **Recuperación de abandono: el remarketing P1-P4 normal lo cubre** (2026-07-02). Quien abandona a mitad y se enfría entra al remarketing por silencio como cualquier lead frío. Un solo mecanismo.
- **Horario: 24/7** (2026-07-02). El bot atiende a toda hora; sin lógica de horarios.
- **Plantillas EXPORTAR/IMPORTAR** (2026-07-02). Para montar números nuevos rápido: exportar toda la config de un número (flujos, etiquetas, campos, secuencias, etc.) e importarla en otro (como el módulo Plantillas de ScaleChat). Clave para operar ~10 números sin rehacer todo.
- **Flujos: BORRADOR + PUBLICAR** (2026-07-02). Se editan en borrador; solo al pulsar "Publicar" se aplican a clientes reales. Estados Borrador/Activo. Sin romper producción.
- **Opt-out automático: NO por ahora** (2026-07-02). El remarketing se detiene al comprar o manualmente (operador da de baja/bloquea desde la bandeja). Sin keyword de baja por ahora.
- **Asignación de chats: MANUAL** (2026-07-02). Los chats "Requiere humano" quedan en lista y cualquiera los toma. Suficiente para 1-2 operadores. (Round-robin/reglas = futuro.)
- **Comprobante inválido: pedir corrección → tras N intentos, humano** (2026-07-02). Si el OCR no valida (nombre/monto/no es comprobante), la IA pide reenviar; tras 2-3 intentos fallidos → pasa a humano + aviso Telegram. `consecutive_failed_reply` como contador.
- **Fallo técnico del nodo IA: reintentar → si persiste, aviso + espera** (2026-07-02). La rama Fallo reintenta 1-2 veces; si sigue, envía "dame un momento" al cliente y avisa al admin por Telegram. Nunca deja al cliente en silencio.
- **Nombre de la app: "Nodo"** (2026-07-02). Deja de ser "ChatPro provisional". Encaja con el motor node-based.
- **CAPI con valor por contacto** (2026-07-02, confirmado): el `value` (y `content_name`, etc.) del evento se toma de **variables del contacto** en tiempo de ejecución (`{{valor}}`, `{{producto-interes}}`). Cliente A value=10, cliente B value=3 → Meta recibe el valor real de cada venta. Base para ROAS correcto.
- **Eventos CAPI: Lead + InitiateCheckout + Purchase** (2026-07-02). Lead al primer mensaje de contacto nuevo; **InitiateCheckout cuando el lead muestra intención real** (elige versión / pide datos de pago) → mejor señal a Meta para optimizar hacia compradores; Purchase al confirmar pago.
- **Recompra: RESET del estado del contacto tras la venta** (2026-07-02). Poco común, pero al completar una venta (+ order bump) se **limpian etiquetas y campos del contacto** para que pueda re-entrar limpio por la palabra clave de otro producto. **La venta persiste** (BD + Sheet); solo se resetea el estado mutable. → Implica que ventas viven en tabla independiente e inmutable (`sales`/`capi_events`), separada del estado del contacto; y una acción "Reset/Limpiar contacto".
- **"Marcar conversación como continuación": DESCARTADO** (2026-07-02). Ni Rodrigo tiene claro su propósito en ScaleChat/ChatLevel (¿transferir a humano? ¿destacar venta?). No se replica: ya hay mecanismos explícitos (transferir a humano §nodo IA/acción, etiqueta `Compra` para destacar la venta).
- **GitHub: SÍ.** Un solo **repositorio PÚBLICO** con todo (panel, `supabase/functions`, `supabase/migrations`, docs). El panel se sirve gratis desde **GitHub Pages**; las functions/migraciones se despliegan a Supabase (no a Pages). Repo público es seguro porque en el panel solo va la **anon key** (pública por diseño, protegida por RLS); **ningún token de Meta / App Secret / service_role toca el repo** (viven en Vault). Regla de oro invariable.

---

## 3. Credenciales del primer canal (Digital Prime)

> Los valores sensibles se cargan como secrets/Vault, nunca hardcodeados en repo.

- App Meta: "Digital Prime" — App ID `982687101435364`
- WABA ID: `2232346290870195`
- Phone Number ID: `1130435206827178`
- Token: System User Access Token permanente (caduca: Nunca) con scopes `whatsapp_business_messaging`, `whatsapp_business_management`, `business_management`.
- Pixel: `998798536397963` + token CAPI propio.
- App Secret: (pendiente de aportar — necesario para validar firma del webhook).
- Cada número futuro trae su set completo: WABA ID, Phone Number ID, token, Pixel ID, token CAPI, App Secret, verify token de webhook.

---

## 4. Referencia: ScaleChat 2.0 (lo que se está reemplazando)

> Relevamiento del 02/07/2026 (Claude Chrome analizó la app en vivo). El documento fuente se corta en §8.4; **faltan secciones 9-23** (ver §7 de este doc). Esto NO es lo que construiremos tal cual — es el mapa de referencia para decidir alcance.

### 4.1 Mapa de módulos (menú lateral de ScaleChat)

| Módulo | Qué hace | ¿Lo queremos? |
|---|---|---|
| **Resumen (Dashboard)** | Métricas: contactos, conversaciones, mensajes, ventas, facturación, ROAS, inversión Meta Ads, comparativas por producto/periodo | 🟡 v1 MÍNIMO (leads/ventas); ROAS+MetaAds fase posterior |
| **Bandeja (Inbox)** | Chat WhatsApp: lista conversaciones, chat, panel de contacto, asignación, etiquetas, notas | 🟢 Sí (núcleo) |
| **Contactos** | Base de clientes: buscar/filtrar/importar/exportar CSV, estados (activo/inactivo/bloqueado) | 🟡 Probable |
| **Etiquetas** | Sistema de etiquetado con colores y contador | 🟢 Sí (motor de estado) |
| **Campos personalizados** | Variables por contacto (`{{campo}}`) + variables globales del bot | 🟢 Sí (motor de estado) |
| **Disparadores IA** | Gatillos que la IA activa sola (ej. "pago aprobado") y lanzan un flujo | 🟢 SÍ (Funciones de IA en nodo IA, fase 3) |
| **Flujos (Flow Builder)** | Editor visual nodo-por-nodo de conversaciones automáticas | 🟢 Sí (DECIDIDO) |
| **Secuencias** | Drip campaigns de flujos con delays | 🟢 SÍ, rediseñadas conscientes de la conversación (§6-TER) |
| **Campañas** | Difusiones masivas (broadcast) | 🟡 Fase posterior |
| **Canales** | Conexión WA/TG/IG/Messenger | 🟢 WhatsApp + Webchat (pruebas); Telegram SOLO notificaciones a admins (IG/Messenger fuera) |
| **Calentamiento** | Warm-up de números (QR) | 🔴 Probablemente no (no aplica a Cloud API) |
| **Rotador de leads** | Round-robin de leads entre números | 🔴 Por decidir |
| **Landing pages** | Páginas puente generadas por IA | 🔴 Probablemente no |
| **Plantillas** | Exportar/importar configuraciones | 🟢 SÍ (export/import completo: flujos, etiquetas, campos, secuencias) |
| **Tienda** | Marketplace de plantillas | 🔴 No (es de la plataforma SaaS) |
| **Mi plan** | Suscripción y créditos IA | 🔴 No aplica (uso interno) |
| **Ajustes** | Config del bot, integraciones, equipo, conversiones | 🟡 Versión propia |

### 4.2 Bandeja / Inbox (ScaleChat §3) — referencia de UX

- **3 columnas:** lista de conversaciones (izq) · chat (centro) · perfil del contacto (der).
- Lista: buscador; tabs **Todas / Mías / Seguimiento / Archivadas / Bloqueados**; selector de canal. Card con avatar, nombre, tiempo relativo, preview, badge de no leídos.
- Chat header: nombre + teléfono + canal; selector de **asignación** a agente; menú ⋮ con: agregar etiqueta, **pausar el bot (atender yo)**, marcar seguimiento, marcar no leído, archivar, exportar mensajes, bloquear, borrar info (destructivo), eliminar chat (destructivo).
- Composer: adjuntar (imagen/video/audio), **⚡ enviar un flujo activo**, texto, enviar.
- Panel de contacto (der): info básica (ID, teléfono, email, hora local, contacto desde, origen, país, idioma), **campos personalizados editables**, **etiquetas**, **flujo en ejecución**, **secuencias suscritas**, **ruta del bot** (historial de pasos), **notas internas**.

### 4.3 Etiquetas reales del negocio (revelan el embudo)

Bienvenida · Caliente · Cliente · Compra · Empezo Version Basica · Empezo Version Premium · Interesado · Interesado - P1 · Lead · Order Bump - Compro · Order Bump Antes de Entregar PP · Order Bump Despues de Entregar PP · Orderbump Ofrecido · Producto 1 · Producto 1 Con Bifurcacion · Producto 1 Sin Bifurcacion · Test

### 4.4 Campos personalizados reales del negocio

| Nombre | Variable | Tipo |
|---|---|---|
| Empresa | `{{empresa}}` | Texto |
| Respuesta 1 | `{{respuesta_1}}` | Texto |
| Imagen 1 | `{{imagen_1}}` | Texto |
| Respuesta imagen | `{{respuesta_imagen}}` | Texto |
| Respuesta 2 | `{{respuesta_2}}` | Texto |
| Fecha de compra | `{{fecha_de_compra}}` | Texto |
| Ad ID | `{{ad_id}}` | Texto |
| Producto interes | `{{producto-interes}}` | Texto |
| Precio Actual | `{{precio-actual}}` | Número |
| Valor | `{{valor}}` | Número |

Variables de sistema: `{{last_input}}`, `{{nombre}}`, `{{telefono}}` + todos los campos personalizados.

### 4.5 Catálogo de nodos del Flow Builder (ScaleChat §8.3)

> Referencia del universo de nodos a considerar para nuestro editor.

- **Mensaje** — texto + multimedia; admite `{{variables}}`.
- **Botones** — quick replies de WhatsApp; cada botón = una rama de salida.
- **Pregunta** — espera respuesta y la guarda en variable.
- **Acción** — sin enviar mensaje; apila varias. Tipos: add_tag, remove_tag, set_field, clear_field, add_note, follow_up/unfollow, archive/unarchive, block_contact, delete_user_info, transfer_human/transfer_bot, notify_admins, assign_round_robin/assign_member, ai, subscribe/unsubscribe_sequence, tool_datetime, tool_random, tool_charcount, tool_json.
- **Condición** — bifurca por lógica (Y/O) sobre etiquetas/campos; operadores Tiene/No tiene/Contiene/No contiene; salida "Si no cumple ninguna".
- **Esperar** — pausa fija (default 3s, máx 300s).
- **IA** — genera texto/acciones. Proveedor (default o específico), modelo (ej. `claude-opus-4-8`), memoria de conversación, máx. tokens (1024), temperatura ("auto"; solo aplica a Sonnet/Haiku, Opus usa razonamiento adaptativo). Herramientas: transferir a humano, seguimiento, notificar admins, añadir etiqueta. Disparadores IA personalizados.
- **Iniciar flujo** — transfiere ejecución a otro flujo.
- **API externa** — HTTP (GET/POST/PUT/PATCH/DELETE), cabeceras, body, guardar respuesta en variable.
- **Google Sheets** — leer/escribir hoja.
- **Evento Facebook (CAPI)** — envía conversión al Pixel: evento (ej. Purchase), moneda (PEN), valor (admite `{{variables}}`), nº artículos, tipo/nombre de contenido, content IDs/SKUs. Atribuye automático clicks CTWA; alimenta ventas/ROAS del Resumen.
- **Secuencia** — suscribir / dar de baja.
- **JavaScript** — código server-side, guarda resultado en variable.
- **Fin** — termina el flujo.

**Conceptos clave del Flow Builder:**
- Un flujo puede marcarse **★ Flujo de entrada**: recibe TODO lo entrante y enruta. Solo uno a la vez.
- Los demás flujos se invocan con el nodo "Iniciar flujo".
- Estados: **Borrador** / **Activo**.
- Flujos reales del negocio: Flujo Principal (entrada), Asistente IA (+ Redireccionador, + OrderBump), Producto 1, Remarketing 1, Order Bump 1, **Comprobante de pago** (validación IA de Yape/Plin).

---

## 4-BIS. Referencias adicionales: SendyPro y ChatLevel

> Rodrigo quiere incorporar funciones de estas otras herramientas del mismo rubro. Aquí voy consolidando qué aporta cada una que ScaleChat NO tiene (o hace distinto).

### SendyPro (sendypro.com) — relevamiento web 2026-07-02

Meta Business Partner. Planes: $19/mes (150 chats/día) · $39/mes (ilimitado). IA y flujos ilimitados sin cargo por mensaje.

**Diferenciadores frente a ScaleChat (candidatos a incorporar):**

| Función | Detalle | Relevancia para Rodrigo |
|---|---|---|
| 🎙 **IA con respuestas en AUDIO/voz realista** | Voces humanas con acento LATAM; la IA elige texto o audio según contexto | 🟢 Alta — da sensación de trato humano en venta de infoproductos |
| 👁 **IA multimodal (input)** | La IA **lee imágenes y escucha audios** que envía el cliente | 🟢 Alta — el cliente manda captura de Yape / nota de voz |
| 💳 **Pagos automáticos con OCR IA** | Reconocimiento de comprobantes por IA, multi-banco, **auto-confirmación** y reportes | 🟢 Muy alta — es exactamente su flujo "Comprobante de pago" Yape/Plin |
| 📋 **CRM Kanban** | Tableros drag & drop, pipelines, asignación automática de agentes, etiquetado automático | 🟡 Media — mejora sobre lista simple de contactos |
| 🔌 **Integraciones extra** | OpenAI, Shopify, Google Sheets, Google Calendar, Zapier, Webhooks | 🟡 Media — Calendar/Sheets podrían servir |
| 📱 App Android nativa | App móvil para operar | 🔴 Fuera de stack (panel es web single-file) |

> **✅ DECISIÓN (2026-07-02): se incorporan las 4 funciones clave de SendyPro** → (1) OCR IA de comprobantes Yape/Plin con auto-confirmación, (2) respuestas IA en audio/voz realista, (3) IA multimodal (lee imágenes y audios del cliente), (4) CRM tipo Kanban con pipelines. Integraciones extra y app Android quedan fuera por ahora.
>
> **Implicaciones técnicas a resolver en el plan:** el audio de voz realista requiere un proveedor de TTS (ej. ElevenLabs/OpenAI TTS) — a definir; el OCR/multimodal requiere un modelo con visión (Claude con visión u OpenAI) — a definir proveedor y costo; el Kanban vive dentro del panel single-file (drag & drop vanilla o librería por CDN sin build).

### ChatLevel — relevamiento por capturas (2026-07-02)

Otra plataforma tipo ScaleChat (competidor LATAM). Multi-canal: **WhatsApp · Telegram · Webchat · (+ más canales)**. Cuenta "Guía Experta". Confirma que Rodrigo también vende con motion de **llamadas agendadas** (booking) además de cierre por chat.

**Mapa de módulos (sidebar):** Analíticas · Bandeja de Entrada · **CRM (con Pipelines)** · **Tareas** · Flujos de Trabajo · **Calendarios** · Disparadores de AI · Contactos · **Agentes IA** · **Palabras Claves** · **Retransmisiones** · Integraciones Pedidas · Herramientas · **Creador de Prompts con AI** · Comunidad/Tutoriales · Documentación API · Soporte.

**Diferenciadores frente a ScaleChat/SendyPro (candidatos a incorporar):**

| Función | Detalle | Relevancia |
|---|---|---|
| 📅 **Calendarios + Booking** | Agenda **llamadas de venta**; flujos `agendar_llamada`, `agendar_llamada_reagenda`, `enviar_cancelacion_llamada_booking`, `enviar_encuesta_booking`, `enviar_registro_booking`; carpeta "Booking - Agendas Llenas" | 🔴 Por decidir — ¿Rodrigo vende por llamada agendada o solo por chat? |
| 🤖 **Nodos IA con memoria + "Funciones de IA" (function calling)** | ⚠️ Aclaración de Rodrigo: ChatLevel **también es node-based** (igual que ScaleChat). Los **nodos de asistente IA recuerdan la conversación** y pueden **invocar funciones** de una librería: `Comprobante_de_Pago`, `Comprobante_de_pago_2`, `Activador_Producto_1_...`, `Comprador_realiza_pedido_plantilla`, `darse_de_baja`, `lead_califica_agendacion`, etc. NO es un agente libre — las funciones se llaman DENTRO del flujo | 🟢 **Incorporar** — encaja con OCR de comprobantes y automatización IA |
| ✅ **Tareas** | Gestión de tareas del equipo (módulo dedicado) | 🟡 Media |
| 🌐 **Webchat (widget)** | Canal de chat web embebible además de WA/TG | 🔴 Por decidir |
| 🎙 **Input de voz** | Micrófono en el composer (grabar y enviar nota de voz desde el panel) | 🟡 Media — complementa las respuestas IA en audio |
| ✍ **Creador de Prompts con AI** | Asistente para redactar prompts de los agentes IA | 🟡 Media |
| 🔑 **Palabras Claves** | Módulo dedicado de gatillos por keyword | 🟡 Media |
| 📡 **Retransmisiones** | Difusiones/broadcast (equivale a Campañas de ScaleChat) | 🟡 Media |
| 📄 **Documentación API pública** | API abierta para integraciones externas | 🔴 Probablemente no (uso interno) |

**Panel de contacto (der):** ID de Contacto, Email, Teléfono, Hora Local, fecha de Contact, Idioma, **Ad ID**, Etiquetas, **Pipelines**, Notas, Medios y archivos (Archivos/Imágenes/Videos), **Secuencias Suscritas**, **Registro de errores**, **Flujos/Pasos Ejecutados** ("Ver acciones ejecutadas"). Bandeja con tabs **Humano / Bot** y toggle "El bot está activo".

> **✅ DECISIÓN (2026-07-02) sobre ChatLevel:**
> - **Arquitectura:** el motor central es el **Flow Builder visual (node-based)**, como ScaleChat Y ChatLevel. Los **nodos de asistente IA tienen memoria** y pueden **invocar "Funciones de IA"** (function calling) dentro del flujo. NO se hace un agente IA libre.
> - **Incorporar de ChatLevel:** (1) **Nodos IA con memoria + librería de Funciones de IA**, (2) canal **Webchat** además de WhatsApp. *(Actualización: Telegram NO será canal conversacional, solo notificaciones a admins — ver §2 y §6-QUATER.)*
> - **Por ahora fuera:** Booking/Calendarios de llamadas, Tareas, Creador de Prompts, Retransmisiones (reconsiderar más adelante).
> - ⚠️ **Aclaración (2026-07-02):** el *disparo de flujos por palabra clave* SÍ va (es un tipo de trigger, ver §6-bis). **Actualización 2026-07-02:** además se incluye la **sección "Palabras Clave"** (pantalla dedicada) para gestionarlas todas en un lugar (keyword → flujo de producto · on/off · modo de match). Entra a v1.

**Modelo de "Disparador de AI" / Función de IA (capturado del formulario "Add New"):** un disparador es una **función invocable por el nodo IA** con estos campos:
- `Nombre` (identificador, ej. `Activador_Producto_1_Calistenia_Militar_Sin_Bifurcacion`, máx 64)
- `¿Qué hace este disparador?` — descripción en **lenguaje natural** de cuándo la IA debe activarlo (máx 300) → es el "when-to-call" del function-calling.
- `¿Qué datos recopilar?` — parámetros que la IA debe extraer/recopilar (equivale a los `parameters` de una tool).
- `¿Qué flujo se desencadena?` — flujo que se ejecuta al activarse (ej. "Producto 1 Sin Bifurcacion").
- `¿Qué mensaje se emite?` (opcional) — respuesta al usuario (ej. "Ha reservado una cita con éxito.").

**Palabras Clave (capturado):** tabla `Mensaje de Usuario` → `Respuesta Bot` con Estado on/off. Ej: `activa 3` → `Flow: Producto 1 Sin Bifurcacion`. Gatillo determinista por keyword hacia un flujo (complementa a los disparadores IA, que son por intención).

**Otros datos de la doc (docs.chatlevel.ai — sitio SPA, solo se pudo leer la portada):**
- Canales que soporta ChatLevel: **WhatsApp, Instagram, Facebook, TikTok, Telegram** (+ Webchat). *(Nuestra app: WA+TG+Webchat decididos; IG/FB/TikTok anotados como posible ampliación futura.)*
- Tagline del agente: *"tu agente IA atiende, califica leads, cierra cobros, **lee comprobantes** y dispara flujos"* → confirma OCR de comprobantes nativo.
- **LLM: usa OpenAI** (el inicio rápido es: conectar OpenAI → vincular WhatsApp → activar agente, ~20 min). *(Nuestra app puede usar Claude para visión/OCR; a decidir en §8-D.)*
- Campos dinámicos con sintaxis `{{ }}`.
- Tiene **API REST + Swagger** (`app.chatlevel.ai/api/swagger/`). Soporte LATAM (GMT-5).

**Patrón real de confirmación de pago (capturado):** notificación al administrador →
`🟣 ORDER BUMP:` / `🟢 REGISTRADO:` · `NUEVO PAGO {monto}` · `DE: {nº operación}` · `PRODUCTO: {nombre}` · `{link imagen del comprobante}`.
Montos observados: NUEVO PAGO 5, 10 → coincide con la escalera P1-P4. Distingue venta principal vs **Order Bump**. Productos reales: "Protocolo Calistenia Militar", "Order Bump 150 Recetas Saludables".

### ChatLevel — DEEP-DIVE de la documentación completa (docs.chatlevel.ai, cap. Claude Chrome)

> Fuente completa: `Desktop/# CHATLEVEL DOCS — DOCUMENTACIÓN CO.txt` (795 líneas). Aquí lo accionable para nuestro diseño. **Varios puntos cierran decisiones abiertas.**

**🔑 Resuelve pendientes de proveedores de IA (§8-D):**
- **TTS / audio de voz realista → ElevenLabs** (voz clonada). Casos: bienvenida personalizada, testimoniales, cierre de venta con voz humana. → es el proveedor de referencia para nuestra función "respuestas IA en audio".
- **OCR de comprobantes → ChatLevel usa OpenAI GPT-4o.** Flujo: la IA lee monto y fecha, valida contra lo esperado, confirma o pide corrección, y dispara flujo "pago confirmado". Compatible con Yape, Plin, capturas, PDFs bancarios. *(Nuestra app puede usar Claude con visión — a confirmar en el plan; el patrón funcional es idéntico.)*
- **LLM conversacional → OpenAI** (GPT-4o-mini default ~USD5/10k msgs; GPT-4o para comprobantes/complejo). *(Nuestra app: definir si Claude u OpenAI para el nodo IA conversacional.)*

**🔑 Modelo de CAPI (muy relevante — así lo hace ChatLevel):**
- Ofrece 2 métodos: **nativo** (asocia eventos a pasos del flujo; dice que la atribución "recientemente puede fallar") y **proxy externo** (recomendado): `POST https://capi.chatlevel.ai/meta-capi`.
- Payload de referencia (Lead/Purchase) incluye: `pixel_id`, `access_token`, `page_id`, `event_name`, `user_id`, `phone`, `email`, `first_name`, `last_name`, `country/state/city`, `channel`, **`ctwa_clid`** (= `{{last_ctwa}}`), `value`, `currency`, `content_name`, y **`order_id`** (ID real de venta, para deduplicación).
- **Nuance técnico clave para nuestro `capi-dispatch`:** el proxy intenta primero como **`business_messaging` (CTWA)** y si falla **reintenta como `website`** (fallback). El `order_id` único se genera con un random y se guarda como campo. Validación en Events Manager → Test Events (`events_received: 1` + `fbtrace_id`).
- **Ventaja nuestra:** nosotros SOMOS el servidor → implementamos CAPI **directo a Graph API** (sin proxy de terceros), con hasheo SHA-256 propio, mismo set de campos + fallback business_messaging→website.

**🔑 Catálogo de variables/campos dinámicos (`{{ }}`) — referencia de modelo de datos (§6 del doc):**
- Contacto: `first_name`, `last_name`, `email`, `phone`, `user_country/state/city`, `locale`, `timezone_name`, `current_user_time`, `user_source`, `user_tags`, `subscribed_date`…
- **Ads/CTWA (oro para atribución):** `last_ad`, `last_ad_name`, **`last_ctwa`**, `last_campaign_id/name`, `last_adset_id/name`, `last_ad_source_url`, `last_ad_source_platform`.
- **Historial para prompts IA:** `chat_history` (50 msgs), `chat_history_large` (200), variantes con detalle de emisor.
- Interacción: `last_input`, `last_input_type` (text/image/video/audio/file), `last_btt_title`, `consecutive_failed_reply`.
- Pipelines: `last_opportunity_id`. Booking: `booking_date/link/id/calendar`. Cuenta: `account_name`, `api_key` (⚠️ nunca al cliente).

**Flujos (§5) — triggers y pasos (complementa el catálogo de nodos de ScaleChat §4.5):**
- **Triggers:** palabra clave, primer mensaje, botón, API externa.
- **Pasos:** enviar mensaje, esperar respuesta, condición (branching por canal/tag/custom field/hora), **llamar agente IA** (paso donde la IA toma el control).
- UX interesante: **"IA responde a múltiples mensajes"** → espera X seg para juntar mensajes cortos en uno y no responder 3 veces (anti-robótico). A considerar.
- **Plantillas WhatsApp** (fuera de ventana 24h): tipos Marketing / Utility / Authentication; se crean en Meta y se usan desde flujos.

**CRM / equipo (§7):**
- Contactos con tags + custom fields (**tipos: text, number, date, boolean, array**) + 3 scopes: custom fields (por contacto), **bot fields (globales de cuenta)**, campos dinámicos (sistema).
- **Pipelines = Kanban de oportunidades** (crear/mover etapa/transferir/comentar). Oportunidad: título, value, stage, contact_id.
- **Roles de equipo:** Owner / Admin / Agent (solo inbox + asignados) / Viewer (solo lectura). Asignación: round-robin, por tag, por canal, por horario.
- **Tareas:** Kanban (Pendiente→En progreso→Bloqueada→Hecha) con notificaciones por Telegram (digest diario 8-9am).

**API REST (§9) — 39 endpoints (revela el modelo de datos completo):** Accounts (16), Contacts (14), Pipelines (13), **Ecommerce (10)**, Calendars (2). Auth `X-ACCESS-TOKEN`. Incluye una **capa e-commerce** no contemplada antes: productos, carritos, órdenes, `pay/{order_id}`, enviar carousel de productos. **Webhooks** de eventos: `message.received/sent`, `contact.created`, `contact.tag.added`, `flow.started/completed`, `opportunity.created/stage.changed`, `order.paid`.

> **⚠️ Nota de alcance:** la documentación revela que ChatLevel es MUCHO más grande de lo previsto (e-commerce, calendars, 39 endpoints API, webhooks, tareas). **No replicaremos todo.** Sirve como mapa del universo posible; el alcance real v1 se decide en §8-A. Lo que sí adoptamos como referencia directa: modelo de variables/campos, diseño de CAPI, OCR de comprobantes, ElevenLabs para audio, pipelines Kanban, roles de equipo.

---

## 4-TER. Flujo REAL de Rodrigo analizado (2026-07-02)

> Captura del canvas de un flujo en producción de ChatLevel. Revela patrones operativos que NO estaban en la documentación. Fuente de verdad sobre cómo trabaja de verdad.

**Qué hace:** manejador de mensajes entrantes con **buffer + ruteo por tipo de mensaje**.
- Condición `¿último mensaje Es Imagen?` → guarda imagen en campo `ImagenDentroUpsell` → **IA analiza imagen** (OpenAI visión) → **IA responde** → etiqueta `Pago_Producto_Principal` → dispara flujo *"Comprobante de pago - Después de entregar P.P, ofrecer OB"* (entrega producto + upsell Order Bump).
- Rama no-imagen → acumula `{{last_input}}` en campo `Preguntas_usuario` (Anexar si ya tiene valor / Asignar si no) → **Espera 4s** → Condición por tipo (Audio / No-Imagen) → **IA genera texto** → envía respuesta.

**Patrones aprendidos (con implicación técnica para nuestra app):**

| # | Patrón | Implicación para el diseño |
|---|---|---|
| 1 | **Buffer + debounce de mensajes** (acumula en `Preguntas_usuario` + espera 4s antes de responder) | El motor debe **acumular mensajes entrantes durante una espera** y procesarlos juntos → evita respuestas robóticas triplicadas. Es infraestructura del `flow-runner`, no solo un nodo. **Requisito v1.** |
| 2 | **Ruteo por `last_input_type`** (Imagen/Audio/Texto) | El `whatsapp-webhook` debe **clasificar el tipo** de cada mensaje entrante y exponerlo como variable desde el día 1. |
| 3 | **Nodos IA con ramas Éxito/Fallo** | El nodo IA debe capturar error de la API del LLM y **ramificar en Fallo** (reintento/aviso), sin romper el flujo. |
| 4 | **Campos como memoria de trabajo** (buffers temporales `ImagenDentroUpsell`, `Preguntas_usuario`, con acción **Limpiar Campo**) | Los campos personalizados también son **estado efímero del flujo**. Necesaria la acción `clear_field` y `append_field`. |
| 5 | **Circuito de monetización real** | imagen de pago → IA lee → etiqueta `Pago_Producto_Principal` → flujo comprobante → entrega producto → **ofrece Order Bump**. |

**Set de nodos que Rodrigo usa de verdad (acota el alcance v1, §8-A):**
`Condición` (multi-rama con salidas Éxito/Fallo por condición) · `Acciones` (set / **anexar** / **limpiar** campo, añadir etiqueta) · `IA` (analizar imagen · generar texto, con ramas Éxito/Fallo) · `Esperar` (segundos) · `Enviar Flujo` (iniciar otro flujo) · `Enviar mensaje`.

### Circuito de validación de pago y post-venta (capturas detalladas 2026-07-02)

**Nodo IA "Analizar imagen" (OCR anti-fraude) — regla de negocio CRÍTICA:**
El prompt de OCR valida **3 condiciones** antes de aceptar un pago:
1. **¿Es un comprobante?** de: Yape, Plin, BCP, Interbank, Transferencia, Banco de la Nación, Caja Cusco, Scotiabank, BBVA.
2. **¿La cuenta destino es la de Rodrigo?** → nombre "Percy Rodrigo Flores Nuñez" + variantes difusas (`Per* Flo*`, `Percy Flo*`). **Anti-fraude: evita capturas falsas o pagos a otra cuenta.**
3. **¿El monto ∈ {S/10, S/7, S/5, S/3}?** (escalera P1-P4).
Config: modelo GPT-4o mini · guarda resultado en campo `Respuesta 2`. → **Nuestra app debe replicar esta triple validación** (comprobante + nombre de cuenta + monto) en el nodo IA de visión.

**Pipeline de IA en 2 etapas:** (1) nodo **visión** extrae datos del comprobante → (2) nodo **texto** con la **función `Comprobante_de_Pago`** adjunta (memoria ON, temp 0.4, 2000 tokens) decide y la invoca si el pago es válido.

**Secuencia post-venta (flujo "Comprobante de pago"), al confirmar pago no duplicado:**
1. Marca conversación como continuación · añade etiquetas `Compra` + `OrderBump Antes De Entregar PP`.
2. **Da de baja de las secuencias de Remarketing (P1…)** → deja de perseguir al cliente apenas compra. *(Regla: comprar cancela el remarketing.)*
3. IA convierte el monto a número entero (→ campo `Valor`) · fija `Fecha de compra = Ahora` · **genera un número aleatorio = `order_id`** (deduplicación CAPI).
4. Registra la venta en **Google Sheets** (Enviar datos / Actualizar Fila).
5. **Notifica al admin por Telegram**: `REGISTRADO: NUEVO PAGO {{Valor}} DE:{{user_id}} PRODUCTO:{{Producto Interes}}` (+ imagen). Order Bump usa `ORDER BUMP: NUEVO PAGO …`.
6. Entrega el producto ("subiendo contenido y bonos al Drive") · **dispara flujo Order Bump**.
7. Tras el Order Bump: notifica de nuevo y **transfiere a humano**.

**Nodos/acciones adicionales descubiertos (ampliar catálogo v1):**
- Operaciones del nodo IA: **`Analizar imagen`** (visión/OCR), **`Generar texto`**, **`Extraer datos de texto/imagen/archivos`**.
- Config completa del nodo IA: operación · fuente de imagen · prompt/instrucción · mensaje de usuario · modelo · guardar-en-campo · **Herramientas de IA (funciones)** · **Recordar conversación** (memoria) · temperatura · máx. tokens · ramas Éxito/Fallo.
- Acciones nuevas: **Darse de baja de Secuencia** · **Marcar conversación como continuación** · **Transferir conversación a humano** · **Generar Número/Texto Aleatorio** (tool → order_id).
- Nodos de integración: **Hojas de Google** (Enviar datos / Actualizar Fila, con Éxito/Fallo) · **Notificar a Administradores** (Telegram).
- ✅ **RESUELTO (Rodrigo):** el `Purchase` de CAPI es un **nodo "Evento Facebook" que se coloca donde uno quiera** — normalmente al final del flujo tras confirmar el pago, pero es totalmente **editable** y puede ir en otra fase. Los flujos tienen **múltiples puntos de salida**, y el Purchase puede dispararse desde cualquiera. → **Implicación:** en nuestra app, "Evento Facebook (CAPI)" es un **tipo de nodo colocable en cualquier parte del grafo** (no un paso fijo del sistema), igual que en ScaleChat.

### El "Flujo Principal" = ENRUTADOR DE ENTRADA (el cerebro de la operación)

> Captura del flujo de entrada (`★ Flujo de entrada`, botón "Publicar"). No conversa: **rutea** cada mensaje entrante al sub-flujo correcto según el **estado del contacto**.

**🔑 Insight arquitectónico central: el embudo es una MÁQUINA DE ESTADOS basada en ETIQUETAS.** La posición del cliente (bienvenida → producto → versión → order bump → compra) vive enteramente en sus **tags**, y el enrutador despacha según eso.

**Árbol de ruteo real (Flujo Principal):**
- Condición por tags `Compra` / `Bienvenida`:
  - Sí → rama de **Productos** (entrega / order bump).
  - No → `Iniciar Flujo: Asistente IA - Redireccionador` (clasifica al lead nuevo).
- Rama Productos (`Producto 1`):
  - `OrderBump Antes De Entregar PP` → flujo *Asistente IA - Antes de Entregar PP Ofrecer OB*.
  - `OrderBump Después De Entregar PP` → flujo *Asistente IA - Después de Entregar PP Ofrecer OB*.
  - `Producto 1 Con Bifurcación` → Condición versión: `Empezó Version Básica` → *ASISTENTE IA - BÁSICA* · `Empezó Version Premium` → *ASISTENTE IA - PREMIUM* · ninguna → *ASISTENTE IA DE - CON BIFURCACIÓN*.
  - `Producto 1 Sin Bifurcación` → *ASISTENTE IA DE - SIN BIFURCACIÓN*.

**Implicación para nuestra app:** el flujo de entrada debe soportar **condiciones multi-rama por etiqueta encadenadas** (árbol de decisión) y despachar a sub-flujos con `Iniciar Flujo`. El diseño de etiquetas (§4.3) no es cosmético: **es el motor de estado**. A modelar con cuidado.

**Order Bump (flujo aparte):** mensaje "¿QUIERES EL ORDER BUMP?" → **`Suscribir a Secuencia` `Remarketing - Upsell`** → `set_field Order Bump = "150 Recetas Saludables"`.

**Concepto "Bifurcación":** Producto 1 puede ser **Con Bifurcación** (se ramifica en versiones Básica/Premium con asistentes IA distintos) o **Sin Bifurcación** (asistente único). Refleja distintas ofertas/precios por versión.

**Secuencias observadas:** `Remarketing - P1` (y escalera P2-P4), `Remarketing - Upsell`. Se entra con **`Suscribir a Secuencia`** y se sale con **`Darse de baja de Secuencia`** (comprar → baja del remarketing).

---

## 6-BIS. Modelo de disparadores de flujo (concepto DECIDIDO)

> Cómo arranca un flujo. Cada flujo tiene **uno o más disparadores (triggers)**; el motor evalúa los mensajes entrantes contra ellos y ejecuta el primero que coincida.

| Trigger | Cuándo arranca | Prioridad de evaluación | v1 |
|---|---|---|---|
| **Flujo de entrada** | Recibe TODO lo que no matchee otro trigger; es el enrutador principal. Solo uno por canal | Último (fallback) | 🟢 Sí |
| **Palabra clave** | El mensaje del cliente coincide con una keyword configurada → arranca ese flujo. Ej: `activa 3` → *Producto 1 Sin Bifurcación* | Alta | 🟢 **Sí (lo pidió Rodrigo)** |
| **Botón** | El cliente pulsa un botón interactivo de un mensaje previo | Alta | 🟢 Sí |
| **Disparador IA (por intención)** | Un nodo IA decide llamarlo por function-calling (ej. `Comprobante_de_Pago`, `agendar_llamada`). Es por *intención*, no por texto literal | Dentro del flujo IA | 🟡 Fase IA |
| **Referral de anuncio (CTWA)** | El primer mensaje trae `referral.source_id` (Ad ID) → se puede enrutar a un flujo específico por campaña/anuncio | Alta (primer msg) | 🟡 Deseable |
| **API / evento** | Disparo programático desde backend (`send/{flow_id}`) | N/A | 🔴 Futuro |

**Detalles de la palabra clave (a definir fino en el editor):**
- Modo de coincidencia: **exacta** / **contiene** / **empieza con** (configurable por keyword).
- **Case-insensitive** y sin acentos por defecto (normalización), para robustez.
- **Múltiples variantes** por flujo (ej. `precio, cuánto, costo` → mismo flujo de pricing).
- Estado **on/off** por keyword (como en ChatLevel).
- Convivencia: si un mensaje matchea keyword Y hay flujo de entrada activo, **gana la keyword** (más específico). El flujo de entrada es el fallback.

**Modelo de datos (borrador):**
```
flow_triggers → id, flow_id, tipo (entrada|keyword|boton|ia|referral|api),
                config (jsonb: p.ej. { "keywords": ["precio","costo"], "match": "contiene" }),
                activo
```

---

## 6-QUATER. Nodo "Notificar a Administradores" (Telegram) — DECIDIDO

> Telegram sirve **solo** para avisar ventas/eventos a los administradores de cada número, no para conversar con clientes.

- Es un **nodo/acción colocable en cualquier flujo** (como un nodo Mensaje, pero el destino son los admins vía bot de Telegram).
- Se enlaza un **bot de Telegram** (token) y los **Chat ID** de los administradores del número.
- El nodo lleva un **mensaje personalizado con variables + imagen**. Ejemplo real de Rodrigo:
  ```
  🟢 REGISTRADO:
  NUEVO PAGO {{Valor a Pagar}}
  DE: {{user_id}}
  PRODUCTO: {{Producto Interes}}
  {{Imagen 1}}
  ```
  (y la variante `ORDER BUMP: NUEVO PAGO …` para order bumps).
- **Scope por número:** cada canal tiene su bot/chat IDs de admins (coherente con multi-tenant independiente).
- Implementación: Edge Function que llama a la Bot API de Telegram (`sendMessage` / `sendPhoto`) con el token del canal. Sencillo, sin recepción (no hay webhook entrante de Telegram).

---

## 6-SEXIES. Autoría eficiente de flujos: separación CONTENIDO / ESTRUCTURA (DECIDIDO — diferenciador)

> **Dolor de Rodrigo:** para cambiar un texto o imagen hay que entrar a la carpeta de cada producto y editar nodo por nodo. Tedioso y propenso a errores. Causa raíz en ScaleChat/ChatLevel: **el contenido está horneado dentro de los nodos.**

**Principio: separar contenido de estructura.** La estructura del flujo (lógica) es reutilizable; solo cambia el contenido (textos, imágenes, precios, links, nombre del producto). Los nodos **leen variables**, no llevan contenido literal.
- En vez de: *"Bienvenido, el Protocolo Calistenia Militar cuesta S/10, link: drive.com/xyz"*
- Se escribe: *"Bienvenido, {{producto_nombre}} cuesta {{precio}}, link: {{link_entrega}}"*
- Los valores viven en una **ficha de Producto**. Mismo flujo sirve para todos los productos.

**4 herramientas que construiremos para esto:**
1. **Pantalla "Productos" (capa de contenido):** cada producto/versión = ficha con `nombre, precios (escalera), link_entrega, imagen, datos_pago (Yape/QR), prompt_asistente`. Los flujos la referencian. **Crear producto = llenar formulario, no armar flujo.**
2. **Biblioteca de medios:** subir imagen una vez, referenciar por nombre; cambiarla en un lugar actualiza todos los flujos.
3. **Editor "Todos los textos":** una pantalla-tabla que lista **cada texto/imagen/link de todos los flujos del número**, editable inline. Elimina el "entrar carpeta por carpeta".
4. **Plantillas + clonar con parámetros:** clonar una plantilla de flujo y que pida solo los parámetros (producto, precios). Combina con §Plantillas export/import.

→ **Diferenciador clave vs ScaleChat/ChatLevel:** ellos obligan a editar nodo por nodo; Nodo separa contenido de estructura.

**REFINAMIENTO MAYOR (Rodrigo 2026-07-02) — Estructura vs Contenido: dos vistas del MISMO flujo.**
> Rodrigo corrige: una pestaña "Mensajes" con campos fijos está mal, porque **el contenido no es una lista fija — depende de cada flujo** (varias burbujas, imágenes, botones/bifurcación, prompts; unos flujos con más cuerpo que otros).

**Cada flujo tiene DOS vistas editables:**
- **🔧 Estructura (canvas):** el esqueleto — nodos, lógica, orden, ramas, condiciones, y **qué tipo de contenido lleva cada nodo** (texto/imagen/botones/IA).
- **✍️ Contenido (cuerpo):** un **formulario que se GENERA a partir del esqueleto**, listando exactamente los huecos que ESE flujo necesita (textos, imágenes, botones, prompts IA), en orden. Nada de más, nada de menos. Varía por flujo automáticamente.

**Principio:** el esqueleto es el molde; la vista Contenido es un **formulario autogenerado del molde**. Cubre las dos formas en que Rodrigo lo pidió: *"que me pida los datos que requiera"* = *"esqueleto en los nodos, cuerpo en este apartado"*.

**Reglas:**
- Nodos con cuerpo (Mensaje, IA) → aparecen en la vista Contenido con sus campos (texto/imagen/botones; o prompt+modelo). Nodos de pura lógica (Condición, Acciones) → **no aparecen** (no tienen cuerpo).
- Cada nodo de contenido tiene un **nombre de hueco** (ej. "Bienvenida", "Método de pago") para que la vista Contenido sea legible.
- Los **datos del producto** (`{{precio}}`, `{{link_entrega}}`) se **incrustan dentro** de los cuerpos como variables.
- El **prompt IA** de cada nodo también es "cuerpo" → editable en la vista Contenido.
- **Flujo de trabajo:** armar el esqueleto una vez (o clonar plantilla) → vivir en la vista Contenido para llenar/editar copy sin tocar el canvas. Objetivo: editor **más ordenado**, no más simplificado.
- **"Todos los textos"** = versión GLOBAL de la vista Contenido (todos los cuerpos de todos los flujos en una tabla).

**MODELO ESQUELETO → PRODUCTO (clon) (Rodrigo 2026-07-02):**
- **Esqueletos = plantillas base** reutilizables, viven en una biblioteca (el canvas edita esqueletos). Solo estructura/lógica + huecos declarados, sin contenido.
- **Un producto TOMA un esqueleto → se crea una COPIA** para ese producto. La base **queda intacta** para seguir sacando copias. Editar la base **no afecta** a las copias existentes (sirve para nuevas copias). Cada producto es independiente. (Coherente con [[plantillas export/import]].)
- **Un producto usa VARIOS esqueletos** (uno por rol: bienvenida, comprobante de pago, order bump, remarketing, redireccionador). El producto es un **conjunto de flujos** (copias de esqueletos), cada uno con su propio cuerpo.
- **Armado del producto:** eliges esqueleto por rol → se clona → llenas su **vista Contenido** (cuerpo, prompts, con variables de datos incrustadas).
- **Cambio de menú:** lo que era "Flujos" pasa a ser **"Esqueletos"** (biblioteca de plantillas base); los flujos de cada producto son copias listadas en la ficha del producto.

**Campos personalizados — DOS tipos con comportamiento distinto (Rodrigo 2026-07-02):**
- **Dinámicos** (cambian en la conversación): se llenan en **runtime** (`producto-interes`, `version_elegida`, `valor`, `respuesta_1`, `ad_id`, `ctwa_clid`, `last_input`). En el editor solo se **declaran** (nombre+tipo) y se **referencian** con `{{campo}}`; su valor NO se edita a mano.
- **Fijos** (contexto definido): valor definido en **tiempo de diseño**, editable como contenido/config (`precio`, `contexto_producto`, datos de pago, `link_entrega`). Se editan en la ficha del Producto. Caso típico: un `contexto_producto` con la descripción que usa el prompt IA → se edita una vez y todos los nodos IA del producto lo usan.
- En el editor de Producto: los **fijos se editan**; los **dinámicos se ofrecen como variables** para insertar en textos/prompts.
- **Alcance de los fijos: POR PRODUCTO** (2026-07-02). Cada producto tiene sus propios campos fijos (precio, `contexto_producto`, datos de pago, links). Distintos productos = distintos valores. Se editan en la ficha del producto (pestaña Datos). (Globales por número quedan para más adelante si hicieran falta.)

**El contenido de un producto/flujo son 3 CAPAS + prompt:**
| Capa | Qué es | Ejemplos |
|---|---|---|
| **1. Datos** | valores estructurados | precio, escalera, link Drive, datos de pago |
| **2. Mensajes (textos)** | la copy que se envía | **bienvenida/mensajes iniciales**, pitch, oferta OB, instrucciones de pago, gracias, pago confirmado/rechazado |
| **3. Medios** | imágenes/archivos | imagen del producto, QR de pago, bonos |
(+ **Prompt IA** del asistente por producto.)

> ⚠️ **RECONCILIACIÓN (auditoría 2026-07-02) — modelo VIGENTE (reemplaza la iteración "pestaña Mensajes"):**
> - La copy **NO vive en una pestaña fija "Mensajes"** de la ficha. Vive en la **vista Contenido de cada flujo del producto** (formulario autogenerado del esqueleto — ver refinamiento arriba). La pestaña "Mensajes" fue una iteración intermedia superada.
> - La **ficha de Producto** tiene pestañas: **Datos · Flujos · Medios**. En *Datos* van los campos fijos (precio, escalera, links, datos de pago, `contexto_producto` para prompts). En *Flujos* está la lista de copias de esqueletos por rol, cada una con acceso a Estructura/Contenido. En *Medios*, sus archivos.
> - **Wording por producto** se mantiene: cada producto tiene su propia copy (en los cuerpos de SUS flujos).
> - **Regla vigente:** los datos estructurados van como variables (`{{precio}}`, `{{link_entrega}}`) definidas en la ficha; los textos/burbujas van en el cuerpo de cada flujo (vista Contenido); el editor global "Todos los textos" agrega todos los cuerpos en una tabla.

---

## 6-QUINQUE. Ruteo determinista de versiones (SOLUCIONA el dolor real de Rodrigo)

> **Operación (aclarada por Rodrigo 2026-07-02):**
> - **Redireccionador** = flujo fallback. Se activa cuando el lead **no trae palabra clave y no coincide ninguna condición**. Contiene un asistente IA que conversa y orienta al cliente hacia el producto/flujo que desea.
> - **Bifurcación** = un producto se vende de 2 formas: **por versiones (Básica/Premium)** o **versión única**. De ahí el nombre.
> - **Entrega Drive** = flexible: la puede dar un asistente IA o un nodo Mensaje.

**🔴 PROBLEMA REAL que Rodrigo sufre hoy en ScaleChat/ChatLevel:** hacer que la IA **dispare el flujo correcto para entregar Básica vs Premium NO es confiable** — el disparador IA a veces falla (no llama la función, o llama la equivocada). Es la limitación conocida del function-calling puro para **decisiones discretas críticas** (dinero en juego).

**✅ PRINCIPIO DE DISEÑO (blinda esto):** separar lo que ScaleChat/ChatLevel mezclan:
1. **La IA ENTIENDE** (conversa, detecta la intención).
2. **El SISTEMA RUTEA de forma DETERMINISTA** (no la IA).

En vez de *"la IA llama el flujo de Premium"* (frágil), se hace:
- La IA (o un **botón interactivo**) **solo escribe un campo** `version_elegida ∈ {basica, premium}`.
- Un **nodo Condición** rutea sobre ese campo → determinista, nunca falla.

**Patrón recomendado (máxima fiabilidad):** botones interactivos de WhatsApp para la selección.
```
Asistente IA conversa/recomienda
  → Botones: [ Versión Básica S/X ] [ Versión Premium S/Y ]
  → cliente TOCA → trigger por botón (determinista) → set_field version_elegida
  → Condición rutea al flujo de entrega correcto
```
**Red de seguridad:** si se deja la selección en manos de la IA (conversacional), y esta no decide con claridad → **fallback a botones**. Nunca se cuelga ni entrega la versión equivocada.

**Regla general de la app:** *toda decisión crítica/discreta (versión, confirmación de pago, sí/no de compra) se rutea con nodos deterministas (botón + campo + Condición), no con function-calling de la IA como único juez.* La IA asiste; el sistema decide. → **Diferenciador clave vs ScaleChat/ChatLevel.**

**Fallback del botón (aclarado por Rodrigo):** es normal que el cliente **no toque el botón**. Por eso el flujo tiene un **asistente IA fallback** (`ASISTENTE IA DE - CON BIFURCACION`) que lo recibe, le explica las versiones y le vende una. Ese asistente **debe terminar comprometiendo la versión** (escribir `version_elegida`), no dejarla al aire.

### Disambiguación del comprobante por versión (problema crítico resuelto)

> **Problema (Rodrigo):** el monto del comprobante es **ambiguo** entre versiones. Ej.: **Premium** con remarketing = {S/15, S/12, S/10}; **Básica** = {S/10}. Un comprobante de **S/10** podría ser cualquiera → ¿cómo saber qué versión es y qué link enviar?

**Solución — NUNCA deducir la versión del monto. Invertir el orden:**
1. La versión se **decide ANTES de pagar** (botón o asistente IA) y se **guarda en el contacto** (`version_elegida` / etiqueta `Empezo Version X`).
2. Se le dan los datos de pago **de esa versión**.
3. Al llegar el comprobante, la IA **lee el monto**; el sistema **ya sabe** la versión por el estado del contacto.
4. **Validación consciente de la versión:** ¿el monto ∈ precios válidos de ESA versión? → sí → envía el link correspondiente.

Resultado con un comprobante de **S/10**:
- Contacto marcado **Premium** → es el S/10 del remarketing Premium → **link Premium**.
- Contacto marcado **Básica** → S/10 de Básica → **link Básica**.
Mismo monto, distinto resultado: **manda el estado del contacto, no el número.**

**Implicaciones:**
- El OCR/validación **ya no** usa un set fijo {10,7,5,3}, sino los **precios válidos de la versión del contacto** (Premium {15,12,10} · Básica {10}). Esto además **detecta pagos incorrectos** (Premium que paga S/7 → no cuadra → pedir corrección).
- **Regla de oro:** *no se acepta un comprobante sin versión definida.* Si llega un pago sin versión → preguntar con botones "¿Básica o Premium?" o pasar a humano. Nunca entregar a ciegas.
- Modelo: cada versión de producto tiene su **lista de precios válidos** (escalera de remarketing) y su **link de entrega**, configurables por número.

**Order bump — mismo principio (aclarado por Rodrigo 2026-07-02):** al comprar el producto principal se agrega la etiqueta **`Compra`**. Esa etiqueta:
- En el **enrutador (Flujo Principal)** manda al cliente al **flujo de asistente IA de Order Bump** (no vuelve a caer en el flujo de producto principal).
- En el **flujo de comprobante** hace que el 2º pago caiga por **otra rama** (rama "tiene `Compra`") → entrega el **order bump**, aunque haya pagado el mismo precio que el principal.
→ Confirma: **la etiqueta de estado enruta el segundo pago**, el monto solo valida. Order bump = otro item comprable con su precio/link, gobernado por el estado del contacto.

---

## 6-TER. Remarketing / Secuencias CONSCIENTES de la conversación (DECIDIDO — mejora sobre ScaleChat/ChatLevel)

> **Problema detectado por Rodrigo:** en ScaleChat/ChatLevel las secuencias se disparan **por reloj** (X tiempo desde la suscripción), **ignorando si el cliente está conversando**. Resultado absurdo: le llega "¿tienes dudas? te doy descuento" a alguien que está escribiendo activamente. La secuencia no "sabe" que hay conversación viva.

**Solución: cambiar el ancla del temporizador.** En vez de anclar a "cuándo se suscribió", se ancla al **último mensaje del cliente (su silencio)**. El remarketing solo dispara cuando el cliente **realmente se enfrió** — que es el propósito del "rompe-vistos".

**Mecánica (con doble compuerta antes de enviar):**
- Cada paso `Pn` tiene un **umbral de silencio** (< 24h para que caiga dentro de la ventana). Ej. editable: P1=1h · P2=4h · P3=10h · P4=20h (desde el último mensaje del cliente).
- Un **scheduler** (Edge Function con cron cada pocos minutos) revisa las suscripciones activas y **antes de enviar** valida:
  1. **¿Silencio ≥ umbral del paso?** (`now − último_mensaje_cliente ≥ umbral`).
  2. **¿NO hay flujo/conversación activa ahora?**
- Si el cliente escribió hace poco → **no se envía nada**; su mensaje **actualiza `último_mensaje_cliente`** y empuja los pasos hacia adelante. → **Quien conversa NUNCA recibe remarketing.**

**Comportamiento decidido (respuestas de Rodrigo 2026-07-02):**
- **Al responder el cliente → pausar y reanudar SIN perder posición.** Mientras conversa no hay nudges; el bot intenta cerrar al precio vigente. Si vuelve a enfriarse, la escalera continúa en el **siguiente** paso (más barato). **Nunca vuelve a subir el precio.**
- **Al comprar → cancelar** la secuencia (ya establecido: comprar da de baja del remarketing).
- **Al intervenir un HUMANO → la secuencia se PAUSA** (estado `pausada`); **se REANUDA continuando su tiempo cuando el humano reasigna la conversación al bot** (confirmado Rodrigo 2026-07-02). Es una pausa por estado (ligada al bot on/off del contacto), además de la compuerta de silencio.
- **Ventana 24h:** mantener **P1-P4 dentro de las 24h**. Como el ancla es el último mensaje del cliente y los umbrales son < 24h, **todos los pasos caen dentro de la ventana automáticamente** (los dos relojes reinician con el mismo evento). Sin plantillas, gratis.

**Cómo avanza la escalera (modelo simple):** un paso avanza **al dispararse** (no al responder). Si P2 (S/7) se envía y el cliente reacciona pero no compra, al enfriarse otra vez se dispara P3 (S/5). El reply solo **reinicia el reloj de silencio**; la posición se conserva. La escalera solo desciende.

**Modelo de datos:**
```
sequences               → id, nombre, pasos[] (umbral_silencio, mensaje/flujo, oferta/precio)
sequence_subscriptions  → contact_id, sequence_id, paso_actual,
                          estado (activa|pausada|completada|cancelada), suscrito_at
-- próximo disparo (calculado) = último_mensaje_cliente + umbral(paso_actual)
-- scheduler: si activa Y silencio ≥ umbral Y sin flujo activo → enviar paso → paso_actual++
--            si paso_actual > último → completada
```

**Implicación de infraestructura:** requiere un **scheduler con cron** (Supabase cron / pg_cron o Edge Function agendada) y que el webhook mantenga `último_mensaje_cliente` al día. Es la misma señal que ya necesitamos para la ventana 24h (§5) → se reutiliza.

---

## 6-SEPTIES. Venta de productos FÍSICOS — DECIDIDO (2026-07-13)

> Rodrigo quiere vender también **productos físicos** además de infoproductos. Proceso real descrito por él: keyword → mensajes iniciales → IA atiende hasta cerrar → bifurcación **Lima** (contraentrega: coordinar dirección, motorizado al día siguiente, cobro en puerta) vs **Provincia** (adelanto de monto configurable → validar comprobante → despacho por agencia — Shalom / Olva Courier — → enviar guía → al llegar el pedido, cobrar el saldo → enviar clave de recojo → cliente recoge).

**🔑 Principio de diseño: "la conversación vive en FLUJOS; el pedido vive en ESTADOS".**
- La parte **conversacional** (captación, dudas, decisión, datos, adelanto) es la MISMA maquinaria de digital: keyword → bienvenida → asistente IA → **ruteo determinista** (botones + campo + Condición, §6-QUINQUE, con `zona_entrega ∈ {lima, provincia}` en lugar de `version_elegida`) → **mismo motor OCR** de comprobantes (valida contra el `adelanto` o el `saldo` esperado según el estado del pedido — extensión natural de la validación consciente de versión).
- Lo genuinamente NUEVO: el físico tiene un **ciclo de vida de DÍAS con acciones humanas** (despachar, registrar guía, marcar llegada, entregar/cobrar). Eso NO se modela con nodos Esperar: se modela como **estados del PEDIDO** (`orders`), operados desde la sección **Pedidos** convertida en **Kanban** (el Kanban decidido de SendyPro encuentra aquí su lugar natural). El flujo crea/escribe el pedido; el operador lo avanza; **cada cambio de estado puede disparar un flujo de notificación** al cliente.

**Ciclo de estados propuesto (`orders.estado`):**
- Común: `carrito` (datos incompletos) → `confirmado`.
- **Lima (contraentrega):** `confirmado` → `en_reparto` (motorizado asignado) → `entregado_cobrado` ✅ (aquí el CAPI **Purchase**, valor total) · salidas: `reprogramado`, `rechazado`.
- **Provincia:** `esperando_adelanto` → `adelanto_validado` (OCR ok → aviso Telegram) → `por_despachar` → `despachado` (operador registra agencia + nº guía + foto → bot envía la guía) → `en_agencia` (llegó a destino) → flujo de **cobro de saldo** → `saldo_pagado` (OCR del saldo ok → **Purchase** valor total → bot envía **clave de recojo**) → `recogido` ✅ · salidas: `no_recogido`, `cancelado`.
- Digital sigue usando su ciclo corto actual (confirmada) — misma tabla `orders`.

**Datos a capturar en conversación** (campos dinámicos, por Pregunta encadenada o IA "extraer datos" + **resumen final con botón "✅ Confirmar pedido"** determinista): nombre completo · teléfono · **DNI** (recojo en agencia) · Lima: distrito, dirección, referencia, día preferido · Provincia: departamento/provincia, agencia preferida (Shalom/Olva) y sede.

**Piezas nuevas que requiere:**
1. `products.tipo ∈ {digital, fisico}` + config de envío por producto físico (monto de adelanto, costo de envío Lima/provincia, agencias habilitadas).
2. Ampliar `orders`: estados de arriba + `shipping` jsonb (dirección/distrito/referencia · DNI · agencia/sede · nº guía + foto · clave_recojo · adelanto/saldo/cobrado).
3. **Pedidos = tablero Kanban operativo**: columnas por estado, acciones rápidas (registrar guía, marcar llegada, marcar cobrado), filtros Lima/Provincia. Para digital es consulta; para físico es el centro de operación diario.
4. Acción de flujo **"crear/actualizar pedido"** + **trigger `pedido_estado`** (al pasar a estado X → disparar flujo de notificación). Es el trigger "API/evento" de §6-BIS que estaba en futuro, acotado a pedidos.
5. **⚠️ Plantillas Utility (HSM) — la implicación técnica más importante:** en provincia pasan DÍAS entre despacho y llegada → la **ventana 24h se cierra**. "Llegó tu pedido, paga el saldo" y "clave de recojo" (incluso "hoy llega tu pedido" en Lima) pueden necesitar **plantilla aprobada por Meta**. → Se adelanta la pieza mínima de plantillas (la tabla `wa_templates` ya existe) para notificaciones de pedido; el broadcast masivo sigue en fase posterior. El gate único de ventana decide: ventana abierta → mensaje libre; cerrada → plantilla equivalente.
6. **Recordatorios anclados al pedido** (reutiliza el scheduler existente): `esperando_adelanto` sin pago tras Nh → nudge; `en_agencia` sin saldo tras Nh → nudge urgente (la agencia devuelve el paquete tras unos días).

**Esqueletos nuevos para la biblioteca:** Venta física (bienvenida + cierre IA + bifurcación Lima/Prov + captura de datos + adelanto) · Notificación de despacho (guía) · Cobro de saldo + clave de recojo · Recordatorios de pedido.

**División de trabajo BOT ↔ HUMANO (decidida por Rodrigo 2026-07-13):**
- **Bot (conversacional):** vende, resuelve dudas, bifurca Lima/Provincia, captura los datos de envío y **cierra + valida el ADELANTO** (OCR). Ahí termina su parte de cierre.
- **Humano (logística, desde el Kanban de Pedidos):** despacha, registra guía + clave de recojo, marca llegada a agencia, marca cobrado/entregado/recogido. **Los cambios de estado son SIEMPRE manuales del operador** (sin tracking automático de agencias).
- **Mensajería post-despacho — refinamiento recomendado, configurable por producto:** al marcar un estado, el bot se encarga de ESCRIBIR los mensajes (enviar la guía, plantilla de cobro de saldo al marcar llegada, validar el comprobante del saldo con el mismo OCR, y soltar la clave de recojo solo tras validarlo). El humano mueve tarjetas; el bot teclea. Toggle **"cobro de saldo: Bot | Humano"** por producto para quien prefiera cerrar a mano. Marcar la compra como finalizada (`recogido`/`entregado_cobrado`) = siempre humano.

**✅ Decisiones cerradas (Rodrigo 2026-07-13):**
1. **Adelanto provincia:** monto **fijo** por producto (lo habitual), con opción **porcentual** — configurable (`modo: fijo | porcentaje`).
2. **Llegada a agencia:** la marca el **operador manualmente** en el Kanban. El bot solo cierra adelanto + datos de envío; la logística la opera el humano (ver división de trabajo arriba).
3. **Costo de envío:** hoy lo asume el negocio (**envío gratis**), pero configurable: toggle envío gratis sí/no (+ costo Lima/provincia si no).
4. **Lima:** 100% **contraentrega**, también configurable (poder exigir adelanto en Lima si algún producto lo necesita).
5. **Plantillas Utility de Meta:** ✅ aprobado crearlas — necesarias para el tránsito multi-día.
6. **Variantes en físicos:** SÍ (talla, versión, color…) → se reutilizan las `product_versions` tal cual (cada variante con su precio y su config).

**Config resultante del producto físico (ficha → Datos):** `tipo=fisico` · variantes (`product_versions`) · adelanto `{modo: fijo|porcentaje, valor}` · envío `{gratis: bool, costo_lima, costo_provincia}` · `lima_contraentrega: bool` · agencias habilitadas `[shalom, olva]` · `cobro_saldo: bot|humano`.

---

## 6-OCTIES. Conocimiento del negocio + perfiles de IA — CONSTRUIDO (2026-07-13)

**Contexto de la IA en 3 NIVELES (evita duplicar la info del negocio en cada prompt):**
1. **Negocio (por canal/bot):** sección "Conocimiento del negocio" — quiénes somos, tono de venta, políticas (envíos, cambios, garantía), FAQ generales, horarios de despacho. Se **inyecta automáticamente a TODOS los nodos IA** del canal.
2. **Producto (ficha → Datos):** descripción, beneficios, FAQ/objeciones del producto. Formaliza el campo fijo `contexto_producto` que ya existía (§6-SEXIES) como campos estructurados de la ficha.
3. **Nodo (rol):** el prompt del rol específico (vendedor / validador de pagos / post-venta) — ya es "cuerpo" editable en la vista Contenido.
El prompt final de un nodo IA = plantilla que concatena (1) + (2) + (3). Se edita cada nivel UNA vez.

**Perfiles de IA por ROL (refina la decisión "configurable por nodo"):** en Config → IA se definen **perfiles nombrados**: `Conversación/Ventas` · `Visión/OCR comprobantes` · `Extracción de datos` · `STT`. Cada perfil = proveedor + modelo (+ temperatura). Los nodos IA **referencian un perfil** (default según su operación) con override puntual por nodo si hace falta. Ventaja: cambiar el modelo del OCR en UN lugar y no en 20 nodos (misma filosofía Contenido/Estructura aplicada a la IA). `channel_ai` (0007) ya guarda las keys por proveedor; faltaría persistir los perfiles. Sugerencia inicial: OCR/validación → Claude Sonnet (visión) · ventas → Sonnet (o GPT-4o-mini si el costo aprieta) · extracción de datos → Haiku · STT → Whisper.

**¿"Modo ventas digitales" vs "modo ventas físicas"? → NO son modos de la app.** El tipo es **propiedad del PRODUCTO** (`products.tipo`): un mismo número puede vender ambos; comparten ~80% de la maquinaria (keyword, bienvenida, IA, OCR, remarketing, Telegram, Sheets, CAPI). La UI se **adapta por tipo**: al crear el producto eliges Digital/Físico y la ficha muestra link de entrega O config de envío, y sugiere los esqueletos del tipo. El Kanban de Pedidos cobra protagonismo solo con físicos.

---

## 7-UI. Diseño de interfaz (en progreso)

**Marca (2026-07-02):** logo entregado por Rodrigo en `logo.png` (1080×1080) — una "N" de nodos conectados sobre degradado azul (encaja con "Nodo"). Versiones redondeadas (14%) generadas en `assets/`: `logo-rounded.png`, `logo-512.png`, `apple-touch-icon.png` (180), `favicon-32x32.png`, `favicon-16x16.png`, `favicon.png`. Se enlazan en el `<head>` del panel cuando se construya. El azul del logo puede servir de color de acento de marca.

**Dirección de diseño (Rodrigo 2026-07-02):** la estructura/UX le resulta cómoda y adecuada; pedido: **estética MÁS MODERNA.** Guía: más aire/espaciado, esquinas más redondeadas (12–16px), jerarquía tipográfica clara, acentos de color sutiles y un toque de color de marca, estados hover/activos suaves, iconografía consistente, menos "dashboard denso" y más SaaS limpio y actual. Aplicar a todas las pantallas.

**Navegación (sidebar oscuro, selector de número arriba):** Bandeja · Contactos · **Esqueletos** (biblioteca de plantillas base) · **Productos** (arma flujos = copias de esqueletos + contenido) · **Palabras Clave** (keyword → flujo) · Secuencias · Etiquetas & Campos · Métricas · **Exportar / Importar** *(antes "Plantillas" — renombrado en auditoría para no chocar con "Esqueletos")* · Ajustes.

**Creación de etiquetas/campos (2026-07-02):** se gestionan en la sección **Etiquetas & Campos**, y **también se pueden crear inline desde los nodos** (Acción `add_tag`/`set_field`, o `Pregunta` que guarda en variable) con un "+ Crear nuevo", sin salir del flujo. Tema oscuro/claro automático, estilo dashboard limpio (referencia Tracker Pro / COD PRO).

**Pantallas ya prototipadas (mockups aprobados por Rodrigo 2026-07-02):**
1. **Bandeja:** rail de navegación + lista de conversaciones (pestañas Todas/Requiere humano/Seguimiento…) + chat (toggle "Bot activo" por contacto, indicadores delivered/leído, botones de versión) + panel de contacto (contador ventana 24h, etiquetas, campos, botón "Registrar venta"). ✅ "está bien".
2. **Editor de Flujos:** cabecera Borrador→Publicar + badge flujo de entrada; lienzo con nodos (Condición, IA, Acciones, Enviar flujo) y ramas Éxito/Fallo; panel de config del nodo; barra inferior (vista previa, zoom, + Añadir bloque). ✅ "está bien".
3. **Productos:** lista de productos + ficha con **pestañas Datos · Flujos · Medios** (modelo final tras auditoría). Datos: versiones (Básica/Premium), escalera de precios, link Drive, datos de pago, toggle bifurcación, campos fijos. Flujos: lista de copias de esqueletos por rol con acceso a Estructura/Contenido. Botón "Todos los textos" (editor global). *(Los mocks intermedios con pestaña "Mensajes" quedaron superados por la vista Contenido.)* ✅.

4. **Vista Contenido de un flujo (clave):** toggle Estructura | Contenido en la cabecera del flujo. La vista Contenido es un **formulario autogenerado del esqueleto** que lista solo los huecos de ESE flujo (texto, texto+imagen, texto+botones/bifurcación, prompt IA), cada uno con su tipo y nombre. Los nodos de lógica no aparecen. Materializa el refinamiento de §6-SEXIES. ✅.

**Pendientes de prototipar:** Métricas, Secuencias, Etiquetas & Campos, biblioteca de medios, editor "Todos los textos" (global), Ajustes/Canales, alta de número, login.

**Mejoras UX/UI aprobadas en auditoría (2026-07-02):**
1. **"Probar este flujo"** en el editor → abre el Webchat de pruebas con ese flujo forzado (testeo en 1 clic).
2. **Vista previa de burbuja WhatsApp** en la vista Contenido (el mensaje como lo verá el cliente, botones reales).
3. **Salud del canal** en Ajustes: webhook ✓, token ✓, último mensaje recibido, errores Meta recientes, **límite de mensajería del número** (250/1K/10K, vía API). Detecta tokens caídos antes de perder ventas.
4. **Publicar con diff**: al publicar un flujo se muestra qué cambia (nodos/textos añadidos-quitados) antes de confirmar.
5. **Autosave** de borradores + volver a la última versión publicada.
6. **Command palette (Ctrl+K)**: saltar a contacto/producto/flujo escribiendo.
7. **Onboarding checklist** por número nuevo: conectar → verificar webhook → crear producto → probar en webchat → publicar.
8. **Estados vacíos con CTA**, skeleton loaders, envío optimista en bandeja.
9. **Formato es-PE**: `S/ 10.00`, fechas/horas Lima en todo.
10. Sistema visual: **azul del logo como acento de marca**, dark-first, Inter, radios 12–16px, grid 8px.

---

## 5. Reglas de negocio (del brief original)

- **Ventana 24h:** se resetea con cada mensaje del cliente. Dentro: mensajes libres gratis. Fuera: solo plantillas (uso excepcional).
- **Ventana FEP 72h:** lead por Click-to-WhatsApp + respuesta dentro de 24h → abre ventana 72h gratis. Registrar tipo de ventana.
- **Secuencia de remarketing:** P1=S/10 → P2=S/7 → P3=S/5 → P4=S/3.
- **Nunca contaminar datos entre canales** (aprendizaje de COD PRO): todo filtrado por `channel_id` con RLS.
- **CAPI en producción sin `test_event_code`** (solo en pestaña "Probar eventos" del Events Manager).
- **CAPI Event Match Quality ≥ 6:** teléfono/nombre hasheados SHA-256 (E.164 sin +); incluir `ctwa_clid` si existe; `event_id` único para deduplicación; **`page_id` del canal** para eventos business_messaging (CTWA).
- **Disparadores CAPI (actualizado v0.27):** **Lead** = automático de sistema al primer mensaje de contacto nuevo (config por canal); **InitiateCheckout** = nodo, al mostrar intención real (elige versión / pide datos de pago); **Purchase** = nodo al confirmar pago (o manual desde el panel con "Registrar venta").
- **GATE ÚNICO DE VENTANA (auditoría 2026-07-02):** todo mensaje saliente —del operador, del flow-runner o del sequence-scheduler— pasa por **un único módulo de salida** que valida la ventana contra `conversations.expira_at` real (cubre 24h y FEP 72h). Nadie envía "por su cuenta". Evita rechazos de Meta y costos inesperados.

---

## 6. Arquitectura (base acordada)

- **Multi-tenant por canal:** tabla `channels` (1 fila = 1 número/cuenta). Webhook único (una Edge Function) que rutea por `phone_number_id`. Tokens/CAPI/App Secret cifrados en Vault, solo accesibles por Edge Functions (service role).
- **Multi-TIPO de canal:** `channels.channel_type` ∈ {`whatsapp`, `webchat`} (canales **conversacionales**). Cada tipo necesita su **adaptador** de recepción/envío:
  - **WhatsApp** — Cloud API, ventana 24h, firma X-Hub-Signature-256, CAPI. (Núcleo del brief.)
  - **Webchat** — widget web propio (embebible); transporte por Edge Function + Realtime; sin restricciones de plataforma (sin ventana 24h ni CAPI de CTWA).
  - Implicación: la lógica común (contactos, mensajes, flujos, etiquetas) es agnóstica al canal; solo la capa de transporte y las reglas de ventana/CAPI son específicas por tipo.
- **Telegram = NO es canal conversacional.** Es una **integración de notificaciones** a administradores (bot de Telegram). Ver nodo en §6-QUATER.
- **Esquema mínimo (del brief):** `channels`, `channel_secrets`, `contacts`, `messages`, `conversations`, `capi_events`, `app_users` (roles admin/operador). *(Se ampliará con: `tags`, `contact_tags`, `custom_fields`, `contact_field_values`, `flows`, `flow_nodes`/`flow_edges`, `flow_runs`, `sequences`, `campaigns` — a definir según alcance.)*
- **Edge Functions base:** `whatsapp-webhook` (verificación + recepción + firma + statuses), `whatsapp-send`, `capi-dispatch`. *(Se sumará un motor de ejecución de flujos — a definir.)*

---

## 7. Pendientes / Información que falta

> **Auditoría 2026-07-02:** casi todo lo listado aquí quedó resuelto durante la definición. Se conserva solo lo realmente pendiente:

1. **App Secret del canal Digital Prime** — necesario para validar la firma del webhook. Rodrigo lo aporta como secret al construir Fase 1. **(ÚNICO pendiente material.)**
2. *(Opcional)* Secciones 9-23 del análisis de ScaleChat — ya innecesarias: la doc de ChatLevel + los flujos reales cubrieron el detalle (secuencias, campañas, plantillas, modelo de datos).
3. *(Opcional)* Librería inicial de "Funciones de IA" — se definirá al armar los prompts en Fase 3 (validar pago, calificar lead, dar de baja ya identificadas).

Resueltos y consolidados: detalle del Flujo Principal ✅ (§4-TER) · alcance de nodos ✅ (PLAN §3) · multi-canal ✅ (WA+Webchat; TG solo notifica) · módulos ✅ (semáforo §0) · OCR comprobantes v1 ✅ (Claude visión) · migración ✅ (limpio) · funciones de referencia ✅.

---

## 8. Decisiones abiertas de alto impacto (para resolver juntos)

- **A. Alcance del Flow Builder v1** — 🟢 RESUELTO: catálogo cerrado en **PLAN §3**.
- **B. ¿Un solo HTML puede con un canvas de flujos?** — 🟡 riesgo abierto: Drawflow (MIT) por CDN, sin build. **Se valida con un spike al inicio de Fase 2** (criterio: canvas fluido con ~40 nodos). Plan B: LiteGraph.js; Plan C: canvas propio simplificado.
- **C. Orden de construcción** — 🟢 RESUELTO: fases 1–5 en **PLAN §6**.
- **D. Proveedores de IA** — 🟢 RESUELTO: configurable por nodo (default Claude); STT en v1; TTS ElevenLabs posterior. Falta solo estimar costos con volumen real.
- **E. Function-calling de nodos IA** — 🟡 librería inicial se define en Fase 3 (ya identificadas: validar pago, calificar lead, dar de baja, activar producto).

---

## 9. Changelog del documento

- **v0.41 (2026-07-13):** 📊 **Google Sheets funcional (vía Apps Script)** + variables nuevas. Decidido con Rodrigo: conexión por **Apps Script** (pega un script en su hoja → publica como app web → pega la URL `/exec`), NO cuenta de servicio GCP (más simple, sin claves). Nodo `google_sheets` implementado en el motor (antes se saltaba): POST `{ hoja, fila }` a `channels.gsheets.webhook_url`, `columnas:[{col,valor}]` con `{{variables}}`, ramas éxito/fallo. Edge Function `gsheets-test` (server-side, evita CORS de Google). UI de Ajustes→Google Sheets rehecha; nodo 📊 en la paleta del editor. **Variables nuevas expuestas** (se capturaban pero no se usaban): `{{ad_id}}`, `{{ctwa_clid}}`, `{{origen}}` (atribución CTWA) y `{{fecha}}`/`{{hora}}`/`{{fecha_hora}}` (America/Lima; sellar fecha de compra con `set_field fecha_compra={{fecha}}`). Corregida la **precedencia de variables**: Campo del Bot (global) → Producto → run.vars → contacto (lo específico gana). **Pendiente para el comprobante como URL en Sheets:** WhatsApp no da URL pública del media; falta subir la imagen a Storage para tener `{{url_comprobante}}`.
- **v0.40 (2026-07-13):** 🎙️ **STT construido** (audios entrantes → texto, alcance v1). `ai.ts.transcribeAudio` (OpenAI Whisper `whisper-1`, `language=es`); `meta.ts.fetchMediaBytes` (bytes crudos del media de WhatsApp). En `runEngine`, un mensaje de audio se transcribe ANTES de matchear triggers/condiciones/IA (usa la key de OpenAI del canal): `event.text` pasa a ser la transcripción, se actualiza `contacts.last_input`, se guarda en `messages.content.transcription` y se registra en el Timeline. Webhook (`wa-media:<id>`) y webchat (URL pública) pasan `mediaRef` para audio. La Bandeja muestra la transcripción bajo la nota de voz (`.transcript`). Si el canal no tiene key de OpenAI, el audio no se transcribe (degrada silencioso).
- **v0.39 (2026-07-13):** 🏗 **§6-OCTIES CONSTRUIDO** — migración 0023 (`channels.negocio`, `channels.ia_perfiles`); el nodo IA concatena negocio→producto→nodo (`usar_conocimiento` desactivable) y resuelve proveedor/modelo por **perfil de tarea** (ventas/ocr/extraccion; override por nodo gana); UI en Ajustes→General (Conocimiento del negocio), Config→IA (Perfiles por tarea) y ficha de Producto (Descripción + FAQ). **Campos fijos del producto como variables** (§6-SEXIES cerrado en el motor): `{{producto_nombre}}`, `{{precio}}`, `{{datos_pago}}`, `{{adelanto}}` (calcula % sobre precio), `{{envio_*}}`. **Recordatorios anclados a pedido**: trigger `pedido_recordatorio` {estado, horas} evaluado por el scheduler (una vez por pedido, marca en shipping), gestionable desde ⚡ Disparadores del editor. **Esqueletos físicos sembrados** en el canal de pruebas (`seed_fisicos.sql`): 📦 Venta física Lima/Provincia (19 nodos: bifurcación por botones, captura de datos, adelanto con OCR anti-fraude PAGO_OK), 🔔 Cobro de saldo + clave (Purchase con `{{pedido_monto}}`), 🚚 Aviso de despacho, ⏰ Recordatorio de adelanto.
- **v0.38 (2026-07-13):** ✅ **Productos físicos: las 6 decisiones abiertas CERRADAS por Rodrigo** — §6-SEPTIES pasa a DECIDIDO. Adelanto fijo (con opción %), llegada a agencia manual, envío gratis configurable, Lima 100% COD configurable, plantillas Utility aprobadas, variantes sí (`product_versions`). Definida la **división de trabajo bot↔humano**: bot vende + cierra adelanto + captura datos de envío; humano opera la logística desde el Kanban de Pedidos (estados siempre manuales); refinamiento recomendado = el bot escribe los mensajes post-despacho al marcar estados (guía, cobro de saldo con OCR, clave de recojo), con toggle `cobro_saldo: bot|humano` por producto. Añadida la config completa de la ficha de producto físico.
- **v0.37 (2026-07-13):** 📦 **Productos FÍSICOS** (§6-SEPTIES, PROPUESTA): principio "conversación en flujos, pedido en estados"; bifurcación Lima (contraentrega) / Provincia (adelanto + agencia Shalom/Olva) con el mismo ruteo determinista de §6-QUINQUE (`zona_entrega`); ciclo de estados de `orders` + Pedidos como Kanban operativo; acción "crear/actualizar pedido" + trigger `pedido_estado`; **implicación clave: plantillas Utility** (la ventana 24h se cierra durante el tránsito); recordatorios anclados al pedido; 6 decisiones abiertas para Rodrigo. **Conocimiento del negocio + perfiles de IA** (§6-OCTIES, PROPUESTA): contexto IA en 3 niveles (negocio/producto/nodo) y perfiles de modelo por rol (Ventas/OCR/Extracción/STT) referenciados por los nodos. Confirmado: **NO hay "modo digital/físico"** — el tipo es propiedad del producto.
- **v0.36 (2026-07-02):** 🔍 **AUDITORÍA COMPLETA.** Corregidas incongruencias: fila Canales de §4.1 (Telegram), §5 CAPI (+InitiateCheckout, +page_id, Lead automático de sistema), reconciliación §6-SEXIES (copy vive en vista Contenido; ficha = Datos·Flujos·Medios), renombrado módulo "Plantillas"→"Exportar/Importar" (colisión con Esqueletos), semáforo/pendientes/decisiones refrescados, versión de cabecera. Añadidas reglas de robustez: **lock por contacto** (concurrencia webhook), **wake_at** para Esperar/debounce (Edge Functions no esperan), **gate único de ventana** (3 emisores, 1 validador), **keyword NO interrumpe run activo** (default, flag por keyword), **alcance del Reset contacto** (limpia tags/campos/suscripciones; conserva identidad/historial/ventas/atribución), `consecutive_failed_reply` al modelo, `page_id` a channels, límites Free cuantificados. +10 mejoras UX/UI (§7-UI). PLAN.md actualizado en espejo.
- **v0.1 (2026-07-02):** Creación. Consolidado brief original + análisis de ScaleChat 2.0 (§1-8.3). Decisiones tomadas: Realtime, infra desde cero, App Secret por canal, **Flow Builder visual = SÍ**. Pendiente: secciones 9-23 del análisis, alcance de nodos, módulos a incluir.
- **v0.2 (2026-07-02):** Añadida §4-BIS con relevamiento de **SendyPro** (diferenciadores: IA con audio realista, IA multimodal que lee imágenes/audios, **OCR IA de comprobantes con auto-confirmación**, CRM Kanban, integraciones). **ChatLevel** sin info pública → pendiente que Rodrigo lo describa. Actualizado el landing de ScaleChat (solo marketing, sin aporte nuevo).
- **v0.3 (2026-07-02):** ✅ Rodrigo confirma incorporar las **4 funciones de SendyPro** (OCR comprobantes con auto-confirmación, IA audio/voz, IA multimodal, Kanban). Anotadas implicaciones técnicas (proveedor TTS, proveedor visión/OCR). Pendiente inmediato: descripción de **ChatLevel**.
- **v0.4 (2026-07-02):** Relevado **ChatLevel** por capturas. Nuevos conceptos candidatos: Calendarios/**Booking de llamadas**, **Agentes IA con "Funciones de IA" (function calling)**, Tareas, Webchat, input de voz, Creador de Prompts, Palabras Claves, Retransmisiones. Capturado el **patrón real de confirmación de pago** (NUEVO PAGO {monto}, Order Bump, link de comprobante) y productos reales. Pendiente: elegir qué funciones de ChatLevel entran.
- **v0.5 (2026-07-02):** ⚠️ Corrección de Rodrigo: **ChatLevel también es node-based** (nodos IA con memoria que llaman Funciones de IA dentro del flujo, no un agente libre). ✅ Decisiones: motor central = **Flow Builder visual node-based**; incorporar **nodos IA con function-calling** y canales **Webchat + Telegram**. Fuera por ahora: Booking, Tareas, Creador de Prompts, Palabras Claves, Retransmisiones. Añadido `channel_type` con adaptadores por tipo (WA/TG/Webchat) y sus implicaciones (TG/Webchat sin ventana 24h ni CAPI). Próxima decisión: **alcance de nodos del Flow Builder v1** (§8-A).
- **v0.6 (2026-07-02):** Capturado el **modelo de Disparador de AI** (nombre + descripción NL + datos a recopilar + flujo a disparar + mensaje opcional = definición de una tool de function-calling) y **Palabras Clave** (keyword → flujo). Datos de docs.chatlevel.ai (SPA, solo portada legible): canales WA/IG/FB/TikTok/TG, LLM **OpenAI**, "lee comprobantes", campos `{{ }}`, API REST+Swagger. ⚠️ La doc no se puede crawlear con WebFetch (JS-rendered) → si se quiere el detalle interno, capturar con Claude Chrome como se hizo con ScaleChat.
- **v0.35 (2026-07-02):** **Palabras Clave** entra a v1 como **sección** (gestión keyword→flujo), además del trigger. Etiquetas/campos se crean en la sección Etiquetas & Campos **y también inline desde los nodos** ("+ Crear nuevo"). Actualizado nav y PLAN.
- **v0.34 (2026-07-02):** Dirección de UI: **más moderna** (más aire, redondeado, acentos sutiles, SaaS limpio). Consolidado el **[PLAN.md](PLAN.md)**: Alcance v1 (IN/OUT), diferenciadores, catálogo de nodos, modelo de datos, Edge Functions y plan por fases (1–5). Listo para revisión antes de construir.
- **v0.33 (2026-07-02):** Campos personalizados = **dos tipos**: **dinámicos** (runtime, solo se referencian) y **fijos** (contexto/valor definido, editables). Los fijos son **por producto** (precio, contexto_producto, datos de pago, links) y se editan en la ficha.
- **v0.32 (2026-07-02):** Modelo **Esqueleto → Producto (clon)**: esqueletos = plantillas base reutilizables; al tomarlos, el producto crea su COPIA (base intacta). Un producto = conjunto de flujos (copias) por rol, cada uno con su cuerpo. Menú "Flujos" → **"Esqueletos"**. Re-mock de Producto (lista de flujos por rol).
- **v0.31 (2026-07-02):** REFINAMIENTO MAYOR de la autoría de contenido: **Estructura vs Contenido = dos vistas del mismo flujo**. La vista Contenido es un **formulario autogenerado del esqueleto** (huecos exactos por flujo: texto/imagen/botones/prompt); nodos de lógica ocultos. Supera la pestaña "Mensajes" de campos fijos. Mock de la vista Contenido creado. §6-SEXIES y §7-UI actualizados.
- **v0.30 (2026-07-02):** Rodrigo detecta que la ficha de Producto no incluía los **textos de los mensajes** ni todas las variables. Refinado: contenido = **3 capas (Datos · Mensajes · Medios)** + Prompt; **textos por producto** editados en pestaña "Mensajes" (variables `{{msg_*}}`) + editor global "Todos los textos". Re-mock de Productos con pestañas. §6-SEXIES y §7-UI actualizados.
- **v0.29 (2026-07-02):** Diseño de UI iniciado (§7-UI). Mockups aprobados de **Bandeja**, **Editor de Flujos** y **Productos** (capa de contenido). Definida la navegación del sidebar. Pendientes: Métricas, Secuencias, biblioteca de medios, editor "Todos los textos", Ajustes/Canales, login.
- **v0.28 (2026-07-02):** Confirmado **CAPI con valor por contacto** (variables en el evento). Añadida §6-SEXIES **separación Contenido/Estructura** para autoría rápida de flujos (pantalla Productos, biblioteca de medios, editor "Todos los textos", plantillas con parámetros) — resuelve el dolor de editar nodo por nodo. Diferenciador clave. Iniciando diseño de UI.
- **v0.27 (2026-07-02):** **Nombre = "Nodo"**. **Eventos CAPI = Lead + InitiateCheckout + Purchase** (IC al mostrar intención real). **Recompra = reset del estado del contacto** tras la venta (limpia tags/campos, conserva la venta en BD+Sheet; ventas en tabla independiente + acción "Reset contacto").
- **v0.26 (2026-07-02):** "Marcar conversación como continuación" **descartado** (propósito difuso; ya cubierto por transferir-a-humano y etiqueta Compra).
- **v0.25 (2026-07-02):** Manejo de errores: **comprobante inválido → pedir corrección, tras N intentos humano + aviso**; **fallo técnico IA → reintentar, si persiste aviso + "dame un momento"**.
- **v0.24 (2026-07-02):** **Plantillas export/import** (montar números nuevos rápido); **flujos Borrador+Publicar**; **opt-out automático NO por ahora** (baja al comprar o manual); **asignación de chats manual**.
- **v0.23 (2026-07-02):** **Order bump = etiqueta `Compra` enruta el 2º pago** por otra rama (confirma principio estado>monto). **Abandono → remarketing normal lo cubre.** **Archivos = biblioteca en app + URL externa.** **Horario 24/7.**
- **v0.22 (2026-07-02):** Remarketing: **pausa con humano, reanuda (continúa su tiempo) al reasignar al bot**. **Nodo IA puede transferir a humano** (no sabe responder / lisuras / cliente molesto). **Multimedia saliente confirmada** (imágenes, PDFs, audios, archivos).
- **v0.21 (2026-07-02):** **Bandeja v1 = pestañas completas** (Todas/Mías/Requiere humano/Seguimiento/No leído/Archivadas/Bloqueados); **buffer de mensajes híbrido** (default global por número + override por flujo); remarketing se pausa con humano atendiendo (por lógica). Pendiente: que Rodrigo explique "Marcar conversación como continuación".
- **v0.20 (2026-07-02):** Afinado comportamiento: **Webchat = entorno de pruebas interno** (probar flujos sin WhatsApp real, no captación de clientes → menor alcance); **bot se pausa automáticamente al intervenir un humano** (on/off por contacto, reactivación manual); **datos de pago por nodo fijo o IA** (configurable); **registro de venta automático + botón manual de respaldo**.
- **v0.19 (2026-07-02):** Resuelto el problema crítico de **disambiguación del comprobante por versión** (Premium {15,12,10} vs Básica {10} → monto ambiguo). Solución: la versión se decide y guarda ANTES de pagar; el monto solo valida contra los precios de ESA versión; el estado del contacto (no el monto) elige el link. OCR consciente de versión; regla de oro "no aceptar pago sin versión definida"; asistente IA fallback debe comprometer la versión. Cada versión = lista de precios válidos + link, configurables por número.
- **v0.18 (2026-07-02):** Aclarada la operación (Redireccionador = flujo fallback con asistente IA; Bifurcación = producto con versiones Básica/Premium vs única; Drive flexible). Registrado el **dolor real de Rodrigo** (la IA no rutea confiablemente a la versión correcta) y su **solución de diseño**: §6-QUINQUE **ruteo determinista** (IA entiende, sistema rutea con botón + campo + Condición; fallback a botones). Principio general: decisiones críticas nunca dependen solo del function-calling de la IA. Diferenciador clave.
- **v0.17 (2026-07-02):** Bloque IA cerrado: **proveedor configurable por nodo** (default Claude), **OCR con visión**, **STT de audios entrantes en v1** (Whisper/OpenAI), **TTS ElevenLabs posterior**. **Handoff = tab "Sin asignar" + aviso Telegram.** §8-D e IA del semáforo pasan a 🟢.
- **v0.16 (2026-07-02):** Más decisiones de alcance: **métricas nativas + nodo opcional Google Sheets**; **Dashboard v1 mínimo** (ROAS/Meta Ads fase posterior); **Campañas fase posterior**; **rol Operador = bandeja + registrar venta** (sin flujos ni config).
- **v0.15 (2026-07-02):** Decisiones de alcance: **multi-tenant INDEPENDIENTE** (cada número su propio mundo, aislamiento total por channel_id); **canales v1 = WhatsApp + Webchat** conversacionales; **Telegram = solo notificaciones a admins** (nodo "Notificar a Administradores", §6-QUATER, NO canal conversacional); **audio ElevenLabs = fase posterior**; **migración = empezar limpio**. Corregido `channel_type` a {whatsapp, webchat}.
- **v0.14 (2026-07-02):** Diseñado el **Remarketing P1-P4 como secuencia CONSCIENTE de la conversación** (§6-TER), resolviendo el defecto de ScaleChat/ChatLevel (nudges a clientes que están conversando). Ancla al último mensaje del cliente + doble compuerta (silencio ≥ umbral Y sin flujo activo). Decidido: pausar y reanudar sin perder posición (nunca sube el precio), comprar cancela, mantener P1-P4 dentro de 24h (los relojes de ventana y remarketing reinician con el mismo evento). Requiere scheduler con cron.
- **v0.13 (2026-07-02):** ✅ Resuelto CAPI: el nodo **"Evento Facebook" (Purchase) es colocable en cualquier parte del flujo** (normalmente al final tras confirmar pago, pero editable); los flujos tienen múltiples salidas. Es un tipo de nodo, no un paso fijo.
- **v0.12 (2026-07-02):** Capturado el **"Flujo Principal" (enrutador de entrada)**. Insight central: **el embudo es una máquina de estados basada en ETIQUETAS** — el flujo de entrada rutea por tags a sub-flujos (Redireccionador, Antes/Después de entregar PP, Básica/Premium, Con/Sin Bifurcación) vía `Iniciar Flujo`. Capturado el flujo Order Bump (`Suscribir a Secuencia` Remarketing-Upsell + set field) y el concepto "Bifurcación" (versiones Básica/Premium). Nodo nuevo: `Suscribir a Secuencia`. Pregunta de CAPI Purchase quedó pendiente (Rodrigo envió más flujos antes de responder).
- **v0.11 (2026-07-02):** Capturas detalladas de los **nodos IA y el flujo "Comprobante de pago"**. Registrada la **validación anti-fraude del OCR** (comprobante + nombre de cuenta "Percy Rodrigo Flores Nuñez" + monto ∈ escalera), el **pipeline IA en 2 etapas** (visión→texto+función), y la **secuencia post-venta completa** (etiquetas, baja de remarketing, order_id aleatorio, Google Sheets, notificación Telegram, entrega Drive, Order Bump, transferir a humano). Ampliado el catálogo de nodos/acciones (Darse de baja de secuencia, Transferir a humano, Hojas de Google, Notificar admin, Generar aleatorio; operaciones IA: Analizar imagen/Generar texto/Extraer datos). Pendiente: confirmar dónde se dispara el Purchase de CAPI.
- **v0.10 (2026-07-02):** Analizado un **flujo REAL en producción** de Rodrigo (captura del canvas). Añadida §4-TER con 5 patrones operativos clave: **buffer+debounce de mensajes** (4s + campo acumulador), **ruteo por `last_input_type`**, **nodos IA con ramas Éxito/Fallo**, **campos como buffer temporal** (append/clear), y el circuito real de monetización (pago→etiqueta→comprobante→entrega→Order Bump). Identificado el set de nodos que usa de verdad → acota alcance v1.
- **v0.9 (2026-07-02):** Rodrigo confirma que quiere **iniciar flujos con palabra clave**. Corregida incoherencia previa (keyword-trigger es núcleo, no un módulo opcional). Añadida §6-BIS **Modelo de disparadores de flujo** (entrada, palabra clave, botón, disparador IA, referral CTWA, API) con detalles de matching y borrador de tabla `flow_triggers`.
- **v0.8 (2026-07-02):** ✅ Decidido: **GitHub, un repo PÚBLICO**, panel en GitHub Pages, backend en Supabase. Anon key sí en el repo (pública); tokens de Meta/service_role nunca (Vault). Registrado enfoque técnico de Flow Builder (grafo + editor Drawflow + motor `flow-runner`) y captura de Ad ID/ctwa_clid vía `referral` del webhook (explicado en conversación; anexo técnico pendiente si Rodrigo lo pide).
- **v0.7 (2026-07-02):** 🎯 Deep-dive de la **doc completa de ChatLevel** (795 líneas, cap. Claude Chrome). Cierra pendientes: **TTS=ElevenLabs** (voz clonada), **OCR=GPT-4o** en ChatLevel (evaluamos Claude), **LLM=OpenAI**. Modelo de **CAPI confirmado** (payload con ctwa_clid + order_id dedup + fallback business_messaging→website) → CAPI pasa a 🟢. Capturado catálogo completo de **variables/campos** (incl. Ads/CTWA, chat_history, pipelines, booking), triggers/pasos de flujos, roles de equipo (Owner/Admin/Agent/Viewer), pipelines Kanban, **capa e-commerce** (productos/carritos/órdenes) y webhooks. Nota de alcance: ChatLevel es mucho más grande de lo previsto → no se replica todo, alcance v1 en §8-A.
