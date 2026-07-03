# Nodo — CRM + automatización de WhatsApp Cloud API

Sistema propio (uso interno) para operar WhatsApp multi-número: recibir/enviar
mensajes, automatizar con flujos, disparar conversiones a Meta (CAPI). Reemplaza
a ScaleChat. Ver **[DEFINICION.md](DEFINICION.md)** (qué y por qué) y
**[PLAN.md](PLAN.md)** (alcance + fases).

> **Estado:** Fase 1 — Núcleo de mensajería (webhook + envío + bandeja Realtime).

## Arquitectura

| Pieza | Dónde vive |
|---|---|
| `panel/index.html` | GitHub Pages (frontend, solo anon key) |
| `supabase/functions/` | Edge Functions (Deno) en Supabase |
| `supabase/migrations/` | Base de datos Postgres |
| Tokens de Meta / App Secret / CAPI | **Supabase Vault** (nunca en el repo) |

**Regla de oro:** en el repo/panel solo van la URL de Supabase + la anon key
(públicas, protegidas por RLS). Ningún token de Meta ni el service_role tocan el
frontend.

---

## Puesta en marcha (Fase 1)

### 1. Proyecto Supabase + CLI
1. Crear un proyecto en [supabase.com](https://supabase.com) (plan Free).
2. Instalar la CLI: `npm i -g supabase` (o `scoop install supabase`).
3. `supabase login` y `supabase link --project-ref TU-REF`.

### 2. Base de datos
```bash
supabase db push        # aplica supabase/migrations/*
```

### 3. Edge Functions
```bash
supabase functions deploy whatsapp-webhook
supabase functions deploy whatsapp-send
```
El `verify_jwt` ya está configurado en `supabase/config.toml`
(webhook público, send autenticado).

### 4. Usuario admin
En el panel de Supabase → **Authentication → Add user** (email + contraseña).
Luego, en **SQL Editor**, enlazarlo como admin:
```sql
insert into app_users (id, nombre, role)
values ('UUID-DEL-USUARIO', 'Rodrigo', 'admin');
```

### 5. Dar de alta el primer canal (Digital Prime)
En **SQL Editor**:
```sql
-- 5a. Crear el canal
insert into channels (nombre, channel_type, phone_number_id, waba_id, pixel_id, page_id, verify_token)
values ('Digital Prime', 'whatsapp', '1130435206827178', '2232346290870195',
        '998798536397963', 'TU_PAGE_ID', 'un-verify-token-secreto')
returning id;   -- copia el id

-- 5b. Cargar los secretos en Vault (usa el id del paso anterior)
select set_channel_secrets(
  'ID-DEL-CANAL',
  'EL_ACCESS_TOKEN_DE_META',   -- System User token
  'EL_APP_SECRET_DE_META',     -- necesario para validar la firma
  null,                        -- capi_token (fase posterior)
  null                         -- telegram_bot_token (fase posterior)
);
```
> El **App Secret** está en Meta → App → Configuración → Básica.
> El `verify_token` lo eliges tú; se usa en el paso 7.

### 6. Configurar el panel
Editar `panel/index.html` (bloque `CONFIG` en el `<script>`):
```js
const SUPABASE_URL = "https://TU-REF.supabase.co";
const SUPABASE_ANON_KEY = "TU_ANON_KEY";   // Settings → API → anon public
```

### 7. Conectar el webhook en Meta
En [developers.facebook.com](https://developers.facebook.com) → tu App →
WhatsApp → Configuración → **Webhook**:
- **Callback URL:** `https://TU-REF.functions.supabase.co/whatsapp-webhook`
- **Verify token:** el mismo del paso 5a.
- Suscribir el campo **messages**.

### 8. Publicar el panel (GitHub Pages)
1. Crear un repo **público** en GitHub, subir todo.
2. Settings → Pages → Source: `main` / **`/root`** (no `/panel`, para que
   funcione la ruta `../assets/` del logo). El panel quedará en
   `https://usuario.github.io/repo/panel/`.
3. Abrir la URL de Pages e ingresar con el usuario del paso 4.

---

## Criterios de aceptación (Fase 1)
1. ✅ Meta verifica el webhook (GET con `hub.challenge`).
2. ✅ Un mensaje del celular aparece en la bandeja en <5s (Realtime).
3. ✅ Respondes desde el panel y llega al celular; el estado pasa a delivered/read.
4. ✅ Firma `X-Hub-Signature-256` validada; requests sin firma válida → **401**.
5. ✅ Ningún token es visible desde el navegador (solo la anon key).

## Verificación rápida
```bash
# Verificación del webhook (debe devolver 123)
curl "https://TU-REF.functions.supabase.co/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=TU_VERIFY_TOKEN&hub.challenge=123"

# POST sin firma → 401
curl -X POST "https://TU-REF.functions.supabase.co/whatsapp-webhook" \
  -H "Content-Type: application/json" -d '{"entry":[]}'
```

## Estructura
```
Nodo/
├── DEFINICION.md              # brief maestro
├── PLAN.md                    # alcance + fases
├── panel/index.html           # bandeja (single-file)
├── assets/                    # logo + favicons
└── supabase/
    ├── config.toml
    ├── migrations/            # 0001..0004
    └── functions/
        ├── _shared/           # cors, db, crypto, meta
        ├── whatsapp-webhook/
        └── whatsapp-send/
```

## Alta de un canal nuevo (resumen)
Repetir los pasos 5 y 7 con el set del nuevo número (WABA ID, Phone Number ID,
token, App Secret, Pixel ID, verify token). Cada número es **independiente**.
