# Rediseño del Sistema de Ventas (digital + físico) — v1.0

> Documento vivo. Acordado con Rodrigo (jul 2026). Objetivo: un sistema **ordenado,
> lógico y fácil de configurar**. Autorizado a agregar, corregir y **eliminar**.

## 1. Los 4 principios

| # | Principio | Por qué |
|---|---|---|
| 1 | **IA interpreta · Código decide · IA redacta** | Plata, cobertura y tiempo → código. Lenguaje → IA. Los toggles del usuario son ley, no sugerencias para la IA. |
| 2 | **Un concepto reusado, no tres parecidos** | Opciones de compra, un clasificador, un Copiloto. |
| 3 | **El formulario arma el flujo; el editor visual sigue siendo el corazón** | Fácil de configurar sin perder la esencia de la app. |
| 4 | **Nada se bloquea hasta el pago · nunca retener lo pagado** | El cliente manda; el dinero sella. |

## 2. Las 5 piezas nuevas

- **Opciones de compra** — una lista por producto. Unifica versión/pack/oferta por cantidad. Define precio + qué se entrega.
- **Clasificador IA (texto libre)** — `{intencion, opcion|zona, confianza}`. Reusado en: opción de compra, zona Lima/Provincia, intención inicial (IA Router).
- **Motor de reglas (código, determinista)** — cobertura, mismo día, hora de corte, domingos/feriados, precio esperado, validación del pago, ventana 24h.
- **Copiloto (IA ↔ operador, por BOTONES)** — panel + Telegram. La IA consulta; el operador ordena con un toque.
- **Ficha-formulario (la receta)** — 9 etapas → genera el flujo → editable en el editor visual.

## 3. La receta (una sola para digital y físico)

```
1. Activación .......... palabras clave + IA Router              [existe]
2. Secuencia inicial ... texto/img/video/PDF/botones/esperas     [consolidar]
3. IA de ventas ........ conocimiento + FAQ + datos a recolectar [existe +]
4. Opciones de compra .. versión/pack/cantidad + atributos       [NUEVO]
5. Cobro y validación .. datos de pago + OCR con monto exacto    [mejorar]
6. Entrega ............. digital: links/archivos · físico: envío [rehacer]
7. Ventas extra ........ encadenadas, antes/después              [NUEVO]
8. Post-venta .......... Telegram + Sheets                       [cablear]
9. Remarketing ......... secuencia + ofertas identificadas       [existe +]
```
Físico agrega en la etapa 6: **Lima** (zonas, contraentrega, mismo día) · **Provincia** (adelanto, agencia, saldo, clave).

### Opciones de compra vs Atributos
- **Opción de compra** = cambia el **precio** o **qué se entrega** (1 par / 2 pares / Pack / Premium).
- **Atributo** = detalle del pedido que **no** cambia el precio (talla, color). Se captura aparte.

### Clasificador IA — reglas
- Salida: `{intencion: preguntando|comparando|eligiendo|cambiando, opcion|zona, confianza}`.
- **Preguntar ≠ elegir**: si solo pide info, no fija nada.
- **Nada se bloquea hasta el pago**: la opción es un valor vivo; cambiar de opinión = sobrescribir.
- **Confianza baja → la IA confirma con UNA pregunta**. Nunca adivina con dinero.
- **Botón = atajo opcional**, nunca una dependencia.
- **Árbitro final = monto + oferta activa + intención.**

### Precio esperado y ofertas
- `precio_esperado(cliente)` = opción elegida + **oferta activa para ESE contacto**.
- Una oferta de remarketing **nombra la opción**: `{opcion, precio, vence}` → los descuentos nunca generan ambigüedad de monto.
- El formulario **avisa si dos opciones pueden costar lo mismo** tras descuentos.

## 4. Agrega / Edita / Elimina

**Agrega:** Opciones de compra + atributos (Productos) · Clasificador IA reusable (motor) · Motor de reglas duras (motor) · **Copiloto** (sección nueva + Telegram) · **Entregas Lima** (64 zonas + alias + toggles + horarios, en Configuración) · Ventas extra encadenadas · Salud del producto · migraciones (opciones, zonas, ofertas, tareas del Copiloto).

**Edita:** Productos → receta-formulario; entrega link único → varios por opción · IA·Pedidos → embudos redefinidos · Validador OCR → monto exacto + reconocer **boletas de agente/banco** (no solo capturas) + ilegible→humano · Secuencias → ofertas identificadas, opt-out, excluir compradores, horario · Pedidos (Kanban) → estados alineados + Copiloto · Motor → `esAgencia` lee `shipping.zona`, `funnelOf` redefinido, OCR con monto, mensaje-vs-plantilla según ventana.

**Elimina:** **Aprobación de pagos** (absorbida por el Copiloto) · tarjeta **"Confirmaciones contraentrega"** (código muerto, ver §6) · **botón Lima/Provincia** del esqueleto · **`link_entrega`** campo único · **"Versiones"** como concepto aparte · **seguimiento de envío** (no hay API de las agencias) · *(a evaluar)* Disparadores de IA (posible solape con IA Router).

**Conserva intacto:** Editor visual de flujos (la esencia), Palabras clave / IA Router, Bandeja, Campos, Dashboard.

## 5. Fases

| Fase | Qué | Desbloquea |
|---|---|---|
| **1 · Núcleo comercial** | Opciones de compra · clasificador IA · precio esperado vivo · validación con monto exacto + anti-reúso + imagen&texto + boletas reales · entrega configurable | Digital vendiendo bien |
| **2 · La receta** | Ficha-formulario de 9 etapas que genera el flujo · salud del producto | Fácil de configurar |
| **3 · Extras + Remarketing** | Ventas extra encadenadas (antes/después, corte inteligente) · ofertas identificadas · opt-out · horario | Más ticket + recuperación |
| **4 · Físico: reglas duras** | 64 zonas + alias + toggles · cobertura/mismo día/corte/domingos/feriados · zona por IA+código | Lima confiable |
| **5 · Copiloto** | Paquete del pedido · botones por etapa · panel + Telegram · ventana→mensaje/plantilla | Provincia operable |
| **6 · Cierre** | Embudos redefinidos · Telegram+Sheets completos + idempotencia · escalado a humano · plantillas Utility | Todo redondo |

## 6. Reglas del negocio (datos reales de Rodrigo)

- **Envío siempre GRATIS** (toggle global por si cambia).
- **Lima**: 64 zonas de entrega (lista real del negocio, **no** el mapa político — incluye Huaycán, Salamanca, Santa Clara, Manchay, Huachipa, Carapongo, Chosica, Cajamarquilla, Jicamarca +anexos, Ricardo Palma, Santa Eulalia, Marquez). Incluye 3 de Huarochirí (Jicamarca, Ricardo Palma, Santa Eulalia). Playas del sur (Pucusana, Punta Hermosa, San Bartolo) **agregadas pero desactivadas** por defecto.
  - Cada zona: toggle **Cubro** + toggle **Mismo día** + **alias** (SJL, VES, SMP, Surco, Chosica…).
  - **Callao**: mismo día apagado (activable).
  - **Todo lo que no está en la lista → Provincia (agencia)**, automático.
  - Hora de corte (ej. 11:00), días de entrega, **domingos** y **feriados** activables, horario de entrega personalizable. **Todo calculado por código** (la IA no sabe qué hora es).
- **Provincia**: **Shalom por defecto** (mencionarla como la agencia del negocio); **Olva** solo si el cliente lo pide/requiere. Configurable.
  - **Adelanto** = parte del total para asegurar el pedido (fijo o %; **no** es el costo del envío). **Saldo** = resto al recoger.
  - Datos obligatorios: **DNI** (lo clave), nombre y apellido (no hace falta completo), ciudad + **sede** de la agencia, cantidad + opción, total.
  - **Nodo NO hace seguimiento del envío** (las agencias no exponen API).
- **Lima datos obligatorios**: dirección + distrito + referencia, cantidad + opción, monto a cobrar, horario preferido. Teléfono = el de WhatsApp.
- **Hueco a corregir**: la tarjeta "Confirmaciones contraentrega" de IA·Pedidos hoy **nunca se activa** (un pedido Lima se crea directo en `confirmado` → embudo logística; y los estados del embudo confirmaciones devuelven `esAgencia=true` → siempre rama agencia). Fix: `esAgencia` debe leer `shipping.zona` real.

## 7. Los 16 requisitos aprobados

**Críticos:** (1) si paga y calla ante el extra → **igual entregar** lo pagado, con mensaje personalizado · (2) reconocer desinterés definitivo → **apagar remarketing**; el que compró sale · (3) detectar comprobante en **cualquier** momento · (4) si no es comprobante → no tratarlo como pago fallido, la IA sigue atendiendo · (5) **anti-reúso** del comprobante también en digital · (6) **idempotencia**: una venta = una fila Sheets + un aviso · (7) **escalar a humano** solo si es necesario o lo pide explícito, notificando.

**Refinamientos:** (8) ilegible ≠ inválido; IA que **no rechace pagos válidos**; borroso 2 veces → humano; **reconocer boletas/constancias de transferencia reales de agente/banco**, no solo capturas de app · (9) **re-entrega** a pedido solo si pagó · (10) "ya te pagué" sin imagen → pedir comprobante · (11) pago de más OK; **pide vuelto → humano** · (12) cliente que vuelve por otro producto · (13) **corte inteligente** de la cadena de extras (detecta intención real).

**Configuración:** (14) **salud del producto** antes de publicar · (15) editar producto con **ventas en curso** · (16) **horario del remarketing** (quiet hours).

## 8. Dependencias externas (de Rodrigo, no de Claude)

1. **Plantillas Utility en Meta** (fase 6) — sin eso no se puede avisar "llegó a la agencia" días después.
2. **Conectar WhatsApp real** — falta el **App Secret de Meta**. Hasta entonces todo vive en el banco de pruebas.
