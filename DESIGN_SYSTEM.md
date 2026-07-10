# Nodo — Design System v1.0

> Guía oficial de identidad visual del CRM Nodo. Todo lo que se construya en el panel debe respetar este documento. Cuando exista conflicto entre una pantalla existente y esta guía, gana la guía.
>
> **Fecha:** 2026-07-10 · **Estado:** Aprobado como dirección — pendiente de implementación en `shell.css`.

---

## 1. Filosofía visual

Nodo es una herramienta que se usa **muchas horas al día**. La métrica de éxito del diseño no es "qué impresionante se ve", sino **cuánto tarda el ojo en encontrar lo que busca y cuánto se cansa después de 6 horas de bandeja**.

Principios en orden de prioridad:

1. **Calma antes que impacto.** Nada parpadea, nada grita. El color es información, no decoración.
2. **Jerarquía por contraste y espacio, no por color.** Un título se distingue por tamaño/peso/espacio alrededor, jamás por ser de otro color.
3. **Una sola forma de hacer cada cosa.** Un estilo de tarjeta, un estilo de botón por rol, un estilo de input. Si dos módulos resuelven lo mismo distinto, uno está mal.
4. **El fondo trabaja, el contenido brilla.** Superficies neutras con profundidad sutil; el contenido (mensajes, métricas, nombres) es lo más contrastado de la pantalla.
5. **Densidad cómoda.** Ni aire desperdiciado ni claustrofobia: escala de 8px estricta, líneas de 44px mínimo en zonas clickeables.
6. **Premium = detalle, no adorno.** Radios consistentes, sombras físicamente creíbles, transiciones de 150–200ms, alineación al píxel. Eso es lo que hace que Linear/Stripe "se sientan caros".

### Moodboard / dirección artística

- **Linear:** neutros fríos, sidebar silencioso, tipografía como protagonista, hover casi imperceptible pero presente.
- **Stripe Dashboard:** datos con aire, verde reservado para dinero, tablas limpísimas.
- **Raycast / Arc:** un solo acento vibrante (violeta-azul) sobre base oscura, glow sutil en el elemento activo.
- **Vercel:** disciplina monocroma, bordes de 1px como principal separador (no sombras pesadas).
- **Notion:** amabilidad — radios generosos, iconografía ligera, microcopy humano.
- **Supabase / Clerk:** dark-mode nativo bien hecho (no "invertir colores"), verde señal, docs-grade clarity.

**Sensación objetivo en una frase:** *"Un instrumento profesional silencioso, con un pulso de color violeta que indica dónde está la vida."*

---

## 2. Modos de color

Nodo es **dark-first** (el modo de referencia, imagen aprobada) con un modo claro derivado por tokens. Nunca se estilan páginas con hex sueltos: **todo color vive en variables CSS** (`--*` en `shell.css`) y las páginas solo consumen tokens.

---

## 3. Paleta de colores

### 3.1 Regla madre

> **El 90 % de la pantalla es neutra. El color solo comunica estado o acción.**

- Azul-violeta → acción principal, elemento activo, links, foco.
- Verde → éxito, dinero, ingresos, "bot activo".
- Ámbar → advertencia, "requiere atención", pendiente.
- Rojo → error, destructivo, bloqueado.
- Cian → informativo secundario (opcional, usar poco: badges de canal, "en ejecución").
- Grises → absolutamente todo lo demás.

Prohibido: colorear tarjetas por módulo, degradados multicolor, más de un acento por componente.

### 3.2 Tokens — modo oscuro (base)

**Acento (Primario — Indigo)**

| Token | Hex | Uso |
|---|---|---|
| `--primary` | `#6366F1` | Botón primario, item activo, foco, links |
| `--primary-hover` | `#7C7EF4` | Hover del primario |
| `--primary-active` | `#5457E5` | Pressed |
| `--primary-soft` | `rgba(99,102,241,.14)` | Fondo de item activo del sidebar, badges primarios |
| `--primary-border` | `rgba(99,102,241,.35)` | Borde de elementos seleccionados |

**Estados**

| Token | Hex | Suave (fondo badge) |
|---|---|---|
| `--success` | `#10B981` | `rgba(16,185,129,.13)` |
| `--warning` | `#F59E0B` | `rgba(245,158,11,.13)` |
| `--danger` | `#EF4444` | `rgba(239,68,68,.13)` |
| `--info` | `#22D3EE` | `rgba(34,211,238,.12)` |

**Neutros (escala fría, tinte azulado sutil — nunca gris puro #808080)**

| Token | Hex | Uso |
|---|---|---|
| `--bg` | `#0B1120` | Fondo raíz de la app |
| `--surface-1` | `#0F172A` | Sidebar, paneles laterales |
| `--surface-2` | `#151E32` | Tarjetas, modales, popovers |
| `--surface-3` | `#1C2740` | Hover de filas, inputs, chips |
| `--border` | `rgba(148,163,184,.12)` | Bordes por defecto (1px) |
| `--border-strong` | `rgba(148,163,184,.22)` | Bordes de inputs, divisores marcados |
| `--text-1` | `#F1F5F9` | Títulos, cifras, contenido principal |
| `--text-2` | `#94A3B8` | Texto secundario, descripciones |
| `--text-3` | `#64748B` | Etiquetas, placeholders, metadatos |
| `--text-disabled` | `#475569` | Deshabilitado |

### 3.3 Tokens — modo claro (derivado)

| Token | Hex |
|---|---|
| `--bg` | `#F6F7FB` |
| `--surface-1` | `#FFFFFF` |
| `--surface-2` | `#FFFFFF` |
| `--surface-3` | `#EEF1F7` |
| `--border` | `rgba(15,23,42,.08)` |
| `--border-strong` | `rgba(15,23,42,.16)` |
| `--text-1` | `#0F172A` |
| `--text-2` | `#55627A` |
| `--text-3` | `#8A94A8` |

Acentos y estados se mantienen (bajar `--primary-soft` a `.10` de alfa en claro). En claro las tarjetas se separan del fondo por **sombra suave + borde hairline**, no por color de fondo.

### 3.4 Fondo con profundidad

Ni oscuro plano ni blanco plano:

- **Oscuro:** base `--bg` + un **radial extremadamente sutil** anclado arriba-izquierda: `radial-gradient(1200px 800px at 8% -10%, rgba(99,102,241,.10), transparent 60%)` y un segundo radial verdoso-cian muy tenue abajo-derecha (`rgba(34,211,238,.05)`). Resultado: la esquina del logo "respira" y el resto se apaga gradualmente. Fijo (`background-attachment: fixed`), sin animación.
- **Claro:** `--bg` gris-azulado + radial blanco al 60 % arriba. Nada de texturas con imagen.
- El fondo **nunca** supera 10 % de alfa de color. Si se nota conscientemente, está demasiado fuerte.

---

## 4. Tipografía

**Fuente única: Inter** (variable, con `font-feature-settings: "cv11", "ss01"` opcional y `tabular-nums` en cifras/tablas). Se confirma tu preferencia: para UI densa multi-horas no hay opción claramente superior. Fallback: `Inter, system-ui, -apple-system, "Segoe UI", sans-serif`. Monospace (IDs, teléfonos, código): `"JetBrains Mono", ui-monospace, monospace`.

### Escala tipográfica

| Rol | Tamaño / línea | Peso | Uso |
|---|---|---|---|
| Display | 32 / 40 | 700 | Solo dashboard-hero y cifras grandes de KPI |
| H1 — título de página | 26 / 32 | 700 | Un único H1 por página |
| H2 — sección | 20 / 28 | 650 | Bloques dentro de la página |
| H3 — tarjeta/grupo | 16 / 24 | 600 | Título de tarjeta, cabecera de panel |
| Body | 14 / 22 | 400 | Texto por defecto de toda la app |
| Body-strong | 14 / 22 | 550 | Nombres de contacto, valores destacados |
| Small | 13 / 18 | 400 | Descripciones, texto secundario |
| Caption / etiqueta | 12 / 16 | 500 | Metadatos, timestamps, labels de input |
| Overline | 11 / 14 | 600 · `letter-spacing:.06em` · MAYÚSCULAS | Categorías del sidebar, cabeceras de tabla |

Reglas:
- **Máximo 2 pesos por componente.** Jerarquía dentro de un componente = peso + color (`--text-1` vs `--text-2`), no tamaño.
- Cifras de dinero: Display o H2 con `tabular-nums`, siempre `--text-1`; la variación (+18 %) va en badge verde/rojo, nunca coloreando la cifra entera.
- Nada de itálicas ni subrayados salvo links en texto corrido.
- `letter-spacing` negativo leve (−0.01em) solo en Display/H1.

---

## 5. Sistema de espaciado

Escala única (px): **4 · 8 · 12 · 16 · 24 · 32 · 40 · 48 · 64**. Ningún margen/padding fuera de la escala.

Asignaciones fijas:

| Contexto | Valor |
|---|---|
| Padding interno de chips/badges | 4×8 |
| Gap icono↔texto | 8 |
| Padding de botones | 8×16 (md) |
| Padding de inputs | 10×12 (excepción única aprobada) |
| Padding de tarjeta | 20 (compacta: 16) |
| Gap entre tarjetas de un grid | 16 |
| Separación entre secciones de una página | 32 |
| Padding lateral del contenido de página | 32 (≥1440px: 40) |
| Margen bajo el H1 de página | 8 al subtítulo, 24 al contenido |
| Altura de fila de lista/tabla | 44 (densa: 36) |
| Ancho máximo del contenido | 1280px centrado (bandeja y editor: full-bleed) |

---

## 6. Elevación, sombras, bordes y radios

### Filosofía de elevación
En oscuro, la elevación se comunica **por color de superficie** (más alto = más claro: `--bg` → `surface-1` → `surface-2` → `surface-3`) + borde hairline. La sombra es secundaria. En claro, se invierte: sombra suave protagonista + borde hairline.

### Niveles

| Nivel | Superficie | Sombra (token) | Uso |
|---|---|---|---|
| 0 — Fondo | `--bg` | — | Página |
| 1 — Reposo | `--surface-1/2` | `--shadow-1: 0 1px 2px rgba(0,0,0,.25)` | Sidebar, tarjetas |
| 2 — Flotante | `--surface-2` | `--shadow-2: 0 8px 24px rgba(0,0,0,.35)` | Dropdowns, popovers, tooltips |
| 3 — Modal | `--surface-2` | `--shadow-3: 0 16px 48px rgba(0,0,0,.45)` + overlay `rgba(2,6,18,.6)` | Modales, drawers |

(En claro: `.25→.06`, `.35→.10`, `.45→.16`, color negro-azulado `15,23,42`.)

### Radios

| Token | Valor | Uso |
|---|---|---|
| `--r-sm` | 8 | Inputs, botones, chips, celdas |
| `--r-md` | 12 | Tarjetas, popovers |
| `--r-lg` | 16 | Modales, paneles grandes, sidebar |
| `--r-full` | 999 | Avatares, pills de estado, toggles |

Nunca inventar radios intermedios. Elementos anidados: radio interno = radio externo − padding (aprox: tarjeta 12 → input dentro 8).

### Bordes
- Grosor universal: **1px**. Nada de 2px salvo el anillo de foco.
- Separador por defecto entre zonas = borde `--border`, no cambio de fondo.
- El borde de un elemento seleccionado usa `--primary-border`, no borde grueso.

---

## 7. Sidebar

El sidebar es la firma visual de Nodo. Especificación:

### Estructura (de arriba a abajo)
1. **Marca** — logo del bot activo + nombre. Alto 64, padding 16. Click → dashboard.
2. **Selector de bot/canal** — control compacto estilo "workspace switcher" (Linear/Slack): avatar del bot + nombre + chevron; abre popover nivel 2.
3. **CTA Bandeja** — el acceso más usado, visualmente distinto (fondo `--primary-soft`, texto `--primary`, punto de actividad). Es el ÚNICO ítem con tratamiento especial.
4. **Grupos de navegación** (ver 7.2) — etiqueta Overline `--text-3` con 24 de espacio arriba y 8 abajo; los grupos son colapsables (chevron sutil, estado en localStorage).
5. **Pie** — perfil (avatar + nombre + rol), toggle de tema, colapsar sidebar.

### Ítem de navegación
- Alto 36, radio `--r-sm`, padding 8×12, gap 12, icono 18px stroke 2 + label Body 14/500 en `--text-2`.
- **Hover:** fondo `--surface-3`, texto sube a `--text-1`. Transición 150ms. Sin mover nada de sitio.
- **Activo:** fondo `--primary-soft`, texto e icono `--primary` (en claro: `--primary` oscurecido un paso), peso 550, **barra de 2×16 redondeada en el borde izquierdo** color `--primary`. La barra es el indicador inequívoco.
- **Badge contador** (no leídos): pill `--r-full`, fondo `--primary`, texto blanco 11/600, alineado a la derecha.
- Colapsado (72px): solo iconos centrados + tooltip flotante con el label (nivel 2, delay 300ms); la barra activa se mantiene.

### Medidas
Ancho expandido **248px**, colapsado **72px**, transición de ancho 200ms ease. Fondo `--surface-1`, borde derecho `--border`. El sidebar NO tiene sombra: se separa por borde.

### 7.2 Agrupación del menú

| Grupo (Overline) | Ítems |
|---|---|
| — (sin grupo, arriba) | Dashboard · **Bandeja (CTA)** |
| CONVERSACIONES | Contactos · Respuestas rápidas · Campañas |
| AUTOMATIZACIÓN | Flujos · Secuencias · Disparadores · Probar flujos |
| CATÁLOGO | Productos · Plantillas · Campos · Etiquetas |
| ANÁLISIS | Reportes (dashboard detallado) · Canales (salud) |
| CONFIGURACIÓN | Ajustes · Usuarios · Integraciones |

Racional: el operador vive en Bandeja (por eso sale del grupo); "Campañas" es conversación saliente, no automatización; "Plantillas/Campos/Etiquetas" son catálogo de piezas, no flujo; Canales queda en Análisis por su rol de "salud del canal" (si crece, migra a Configuración).

---

## 8. Iconografía

- **Librería única: Lucide** (ya en uso). Prohibido mezclar con emojis-como-icono en UI cromada (los emojis quedan reservados a la función "emoji de producto", que es contenido, no cromo).
- Tamaño: **18px** en navegación y botones, **16px** inline en texto/tablas, **20px** solo en empty states y cabeceras de tarjeta KPI.
- Grosor: `stroke-width: 2` siempre. Sin rellenos, sin duotono.
- Color: hereda el color del texto adyacente (`currentColor`). Un icono jamás es más contrastado que su label.
- Alineación: centrado óptico con la línea base del texto (contenedor flex `align-items:center`).

---

## 9. Sistema de tarjetas

**Una sola tarjeta para todo el CRM** (`.nodo-card` evoluciona a esto):

- Fondo `--surface-2`, borde 1px `--border`, radio `--r-md` (12), sombra `--shadow-1`, padding 20.
- **Anatomía:** (opcional) cabecera = icono 18 en cápsula 32×32 de fondo estado-suave + H3 + acción a la derecha (`ghost`); cuerpo; (opcional) pie separado por borde superior `--border` con metadatos Caption.
- **Variantes permitidas (únicas):**
  - **KPI:** cápsula de icono coloreada por estado (verde=dinero, indigo=leads…), cifra Display, delta en badge, comparativa en Small `--text-2`. El color SOLO vive en cápsula y badge.
  - **Interactiva** (tarjeta-navegación de flujos/productos): hover → borde `--border-strong` + fondo sube medio paso + `translateY(-1px)` + sombra-2 al 50 %. Cursor pointer. Seleccionada → borde `--primary-border`.
  - **Compacta:** padding 16, para grids densos.
- Prohibido: tarjetas con fondo de color por categoría, dobles bordes, sombras duras, radios distintos por módulo, tarjeta dentro de tarjeta (usar divisores).

---

## 10. Botones

Alturas: **sm 32 · md 36 (default) · lg 44**. Radio `--r-sm`, padding 8×16 (md), tipografía 14/550, gap icono 8, icono 16–18.

| Variante | Reposo | Hover | Active | Uso |
|---|---|---|---|---|
| **Primario** | fondo `--primary`, texto blanco | `--primary-hover` + sombra-1 | `--primary-active`, sin sombra | UNA acción principal por vista |
| **Secundario** | fondo `--surface-3`, borde `--border-strong`, texto `--text-1` | fondo sube, borde más visible | fondo baja | Acciones normales |
| **Terciario / Outline** | transparente, borde `--border-strong`, texto `--text-2` | texto `--text-1`, fondo `--surface-3` al 50 % | — | Acciones de menor rango en cabeceras |
| **Ghost** | transparente, texto `--text-2` | fondo `--surface-3`, texto `--text-1` | — | Iconos de toolbar, acciones en filas |
| **Danger** | transparente, texto `--danger`, borde `rgba(239,68,68,.3)` | fondo `--danger-soft` | — | Destructivo; **sólido rojo solo en el confirm del modal** |

Estados transversales:
- **Focus (teclado):** anillo `0 0 0 2px var(--bg), 0 0 0 4px var(--primary)` — visible en TODAS las variantes, solo con `:focus-visible`.
- **Disabled:** opacidad .45, sin eventos, cursor default. Nunca cambiar el layout.
- **Loading:** spinner 14px reemplaza al icono, label se mantiene, botón bloqueado.
- Regla de oro: **máx. 1 primario por pantalla**; si dos acciones compiten, una se degrada a secundario.

---

## 11. Inputs y formularios

Estilo único para input, select, textarea y buscador:

- Alto 36 (igual a botón md), fondo `--surface-3` (claro: blanco), borde 1px `--border-strong`, radio `--r-sm`, padding 10×12, texto Body `--text-1`, placeholder `--text-3`.
- **Hover:** borde sube un paso. **Focus:** borde `--primary` + anillo `0 0 0 3px var(--primary-soft)`. **Error:** borde `--danger` + mensaje Caption rojo debajo (nunca solo color: siempre texto). **Disabled:** opacidad .45.
- **Label:** Caption 12/500 `--text-2`, 6px encima, sin dos puntos. Ayuda opcional en Small `--text-3` debajo.
- **Select:** mismo cuerpo + chevron 16 `--text-3`; el desplegable es un popover nivel 2 (radio 12, opciones alto 36, hover `--surface-3`, seleccionada check `--primary`).
- **Buscador:** input con lupa 16 a la izquierda (padding-left 36) y atajo `Ctrl+K` como kbd-pill a la derecha; en cabeceras puede ser ghost (sin borde hasta focus).
- **Textarea:** min-height 88, resize vertical.
- **Tablas:** cabecera Overline `--text-3` con fondo transparente y borde inferior `--border-strong`; filas alto 44, separadas por borde `--border` (sin zebra); hover de fila `--surface-3`; celdas numéricas alineadas a la derecha con `tabular-nums`; acciones de fila = ghost icons visibles al hover.

---

## 12. Componentes de estado y feedback

- **Badge/pill de estado:** fondo estado-suave + texto del estado + (opcional) punto de 6px; radio full, 12/500, padding 2×8. Nunca fondo sólido salvo contadores.
- **Toast:** nivel 2, esquina inferior derecha, icono de estado + texto, auto-cierre 4s, entrada fade+8px.
- **Tooltip:** nivel 2, fondo `--surface-3`, Caption, delay 300ms.
- **Empty state:** icono 20 en cápsula, H3, Small `--text-2`, y un botón (secundario) con la acción que resuelve el vacío. Centrado, max-width 360.
- **Skeleton:** bloques `--surface-3` con shimmer sutil 1.2s; usar en cargas > 300ms, nunca spinners de página completa.

---

## 13. Animación y microinteracciones

Sistema mínimo y estricto:

| Token | Valor | Uso |
|---|---|---|
| `--t-fast` | 150ms ease-out | Hover, focus, color |
| `--t-med` | 200ms cubic-bezier(.2,.8,.2,1) | Popovers, sidebar, elevación |
| `--t-slow` | 300ms mismo bezier | Modales, drawers, cambio de página |

Reglas:
- Solo se anima `opacity`, `transform` y `color/background/border/box-shadow`. Jamás `width/height/top/left` (excepto el ancho del sidebar).
- Entradas: fade + `translateY(4px)` (popover) u 8px (modal). Salidas al 60 % de la duración.
- Hover-lift máximo: `translateY(-1px)`. Nada de escalas > 1.02.
- Nada se mueve en loop infinito salvo el punto de actividad de Bandeja y skeletons.
- Respetar `prefers-reduced-motion: reduce` → todo a 0ms.

---

## 14. Jerarquía visual — receta por página

Toda página del panel sigue la misma anatomía:

1. **H1 (26/700)** + subtítulo Small `--text-2` (una línea que explica la página) + acciones a la derecha (máx. primario + secundario).
2. **Barra de contexto** (opcional): filtros/carpetas/buscador — chips y ghost buttons, alto 36, gap 8.
3. **Contenido** a 32px del encabezado, en grid de tarjetas (gap 16) o tabla.
4. Estados vacíos/carga según §12.

El ojo debe poder escanear: título → acción principal → contenido, sin desvíos. Si un elemento no ayuda a ese recorrido, se baja de contraste o se elimina.

---

## 15. Reglas de consistencia (checklist de PR)

Antes de dar por buena cualquier pantalla nueva o retocada:

- [ ] Cero hex sueltos: todo color viene de tokens.
- [ ] Todos los espaciados están en la escala de 8 (4 permitido como medio paso).
- [ ] Un solo botón primario visible.
- [ ] Radios solo 8/12/16/full.
- [ ] Iconos solo Lucide 16–20px stroke 2, `currentColor`.
- [ ] Texto secundario en `--text-2/3`, nunca gris inventado ni opacidad sobre `--text-1`.
- [ ] Estados hover/focus/disabled definidos en todo elemento interactivo; focus visible con teclado.
- [ ] Ningún color usado como decoración (si quito el color, ¿pierdo información? Si no → fuera).
- [ ] Funciona en oscuro y claro solo cambiando tokens.
- [ ] Transiciones solo con `--t-*`.
- [ ] La página respeta la anatomía de §14.

### Buenas prácticas generales
- Diseñar primero el estado con datos reales feos (nombres largos, cifras de 6 dígitos, 0 resultados) — no el screenshot ideal.
- Truncar con ellipsis + tooltip; nunca romper la altura de fila.
- Contraste mínimo AA (4.5:1 en Body; los `--text-3` solo para metadatos, nunca contenido esencial).
- Alturas alineadas: botón md = input = 36; todo lo que convive en una fila comparte altura.
- Cuando dudes entre añadir un elemento visual o quitarlo: quitarlo.

---

## 16. Mapa de implementación (referencia futura, no acción inmediata)

Cuando se implemente, el orden natural: (1) tokens en `:root` de `shell.css` + overrides `html[data-theme=light]`, (2) fondo global, (3) sidebar, (4) primitivas `.nodo-btn`/inputs/tarjetas, (5) migrar páginas una a una empezando por Dashboard y Bandeja. Este documento es la fuente de verdad; `shell.css` es su única materialización.
