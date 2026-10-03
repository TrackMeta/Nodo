# Plan: la IA conversa, el motor guía — v1.0

> Acordado con Rodrigo (3-oct-2026). Documento vivo: se actualiza al cerrar cada fase.
> Objetivo: que el bot **conteste siempre lo que le preguntan**, **no corte frases**, **no invente** y **siga
> siendo conversacional** — sin seguir sumando parches.

## 1. Por qué (lo medido el 2-oct)

| Dato | Valor |
|---|---|
| Errores graves en 25 conversaciones de prueba | **9** (gpt-4.1-mini) · **8** (gpt-4.1, 5× más caro) → el modelo no es la palanca |
| Retoques del motor en un chat real de 7 respuestas | **15** |
| Pasos de post-proceso sobre el texto de la IA | **~150**, de los cuales **~78 BORRAN** texto |
| Tamaño del manual (prompt) por respuesta | **~9.250 tokens**, 69 bloques |

- Las **frases cortadas y las preguntas sin respuesta** las hace el **motor** (pasaron igual con los dos modelos).
- Los **inventos** los hace la **IA** (garantía de 30 días copiada de un ejemplo, «funciona de noche», «no afecta a
  los gatos»).
- La causa de fondo: la IA hace **dos trabajos a la vez** (contestar + llevar la venta paso a paso). Lo segundo lo hace
  mal, y el motor se llenó de tijeras para corregirlo. Se estima que ~6 de cada 10 tijeras existen por eso.

## 2. El principio nuevo

| Quién | Hace | No hace |
|---|---|---|
| **IA** | Contesta lo que preguntó el cliente, con tono de vendedor, y hace la pregunta del paso que le indica el motor **con sus palabras** | Decidir el siguiente paso, inventar datos, nombrar sedes/adelanto/pagos cuando no toca |
| **Motor** | Sabe la etapa de la venta, decide el siguiente paso, pega los bloques exactos (precios, sedes, datos, pago), cuida el dinero | **Recortar el texto de la IA.** Si algo está mal, pide reescribir |

Se mantiene el principio de `REDISENO_VENTAS.md`: *IA interpreta · Código decide · IA redacta*. Lo que cambia es que
el código ya no **corrige redactando** (tijeras): **decide antes y revisa después**.

## 3. Cómo queda un turno

```
Cliente escribe
  → 1. Extractor (IA chica) anota datos: zona, ciudad, sede, cantidad, nombre, DNI…   [igual que hoy]
  → 2. Motor calcula el SIGUIENTE PASO: zona | sede | cantidad | datos | pago | cierre | ninguno
        (y si conviene empujar: NO tras «lo pienso», una queja, una duda de salud…)
  → 3. IA escribe: respuesta a lo que preguntó + la pregunta de ese paso, con sus palabras
  → 4. Revisor: ¿contestó? ¿una sola pregunta y la del paso? ¿mencionó algo que no tocaba (Shalom sin zona,
        adelanto, sede)? ¿afirma algo que la ficha no dice?
        · bien → sigue
        · mal  → la IA reescribe UNA vez con la indicación exacta («no contestaste si resiste la lluvia»)
        · mal otra vez → respaldo seguro (su respuesta + la pregunta fija del paso). Nunca una frase cortada
  → 5. Motor pega los bloques exactos (precios, sedes, datos que faltan, datos de pago)   [igual que hoy]
  → Envío
```

## 4. Fases

Cada fase **solo se queda si el examen no empeora**. Cada cambio va detrás de un **interruptor por canal**: se prueba
primero en Eco Guard y se apaga al instante si algo sale mal.

### Fase 0 — El examen fijo (base de todo)
- **Conversaciones:** las 25 del 2-oct (20 preguntas de producto + el chat real de Rodrigo + pago sin zona, casa en
  provincia, pagar en agencia, «¿pero sí funciona?») + ~10 más: cierre completo Lima, cierre completo provincia hasta el
  adelanto, objeciones («está caro», «lo pienso», «¿es estafa?»), cambio de cantidad, cliente que da todo junto.
- **Juez automático (IA)** con la ficha delante. Marca cada respuesta del bot:
  `no contestó` · `frase cortada / sin sentido` · `inventó o contradijo la ficha` · `supuso la zona / fuera de orden` ·
  `repitió pregunta` · `sonó robótico`.
- **Dónde:** se corre desde el servidor (no desde una pestaña del navegador) y muestra el informe en el panel, para
  que Rodrigo también lo pueda correr.
- **Línea base:** 9 graves / 25.

### Fase 1 — Repartir el trabajo (venta física)
1. **`siguientePaso(ctx)` en un solo lugar.** Hoy esa lógica está repartida en banderas (`_tocaCantidad`,
   `_sedeAhora`, `_zonaRecienTurno`…). Se junta en una función que devuelve el paso y si conviene empujar.
2. **Instrucción corta a la IA:** «contesta lo que preguntó y termina preguntando X, con tus palabras; no menciones Y».
3. **Revisor + reescritura** justo después de la llamada a la IA (engine.ts, tras `runAI` de venta, antes de que el
   post-proceso escriba estado). Detectores, no tijeras.
4. Los bloques del motor (precios, sedes, datos, pago) se pegan igual que hoy.
- **Meta:** ≤ 5 graves y **0 frases cortadas** en el examen + Rodrigo lo prueba en Probar flujos.

### Fase 2 — Retirar tijeras
- Por grupos, de las ~78 que borran: se apaga el grupo → examen → si no empeora, **se borra el código**.
- Primero las 5 más dañinas: recorte a la primera línea en el turno de sedes, «Pregunta repetida o doble»,
  «La respuesta va primero», «Repetía una pregunta», el bloque de pagos de `emitIaText`.
- **Meta:** retirar al menos 6 de cada 10 borradores; el motor más chico y más fácil de mantener.

### Fase 3 — Contra los inventos
- **Ficha justa:** a la IA se le pasa la parte de la ficha relacionada con la pregunta + «si no está, dilo».
- **Manual más corto:** de ~9.250 a ~3.000–4.000 tokens; fuera las reglas que se contradicen y los ejemplos con datos
  copiables (la «garantía de 30 días» salió de ahí).
- **Revisión con IA solo en temas delicados:** garantía, salud y seguridad, pagos, envíos.
- **Meta:** ≤ 1 invento en el examen.

### Fase 4 — Fichas completas (Rodrigo)
- El bot ya anota «Te preguntaron esto y no está en la ficha». Se le pasa la lista por producto y él completa.
- Eco Guard hoy no dice: cuántos metros cubre, si funciona de noche, si resiste el agua/lluvia, cuánto dura, gatos y
  perros, niños, murciélagos, serpientes, palomas, ratas.
- Ningún código reemplaza este paso: si el dato no existe, la IA o lo inventa o dice «no lo sé».

### Fase 5 — Lo demás con el mismo método
- Venta digital, Recepción y Soporte (comparten `emitIaText`, que también recorta).

## 5. Lo que NO se toca
Zonas y distritos, sedes Shalom, pagos y OCR de comprobantes, pedidos, avisos, remarketing, stock.

## 6. Reglas de trabajo
- Nada se despliega si el examen empeora.
- Un cambio a la vez, con interruptor por canal y vuelta atrás inmediata.
- **Mientras dure el plan, no se agregan parches nuevos** salvo urgencias de dinero (cobros, pedidos, pagos).

## 7. Tiempos y costos (estimados)
| Fase | Esfuerzo estimado |
|---|---|
| 0 | 1 sesión |
| 1 | 2–3 sesiones |
| 2 | 2–3 sesiones |
| 3 | 2 sesiones |
| 4 | Rodrigo, cuando pueda (la lista la preparo yo) |

- **Costo de la IA:** la reescritura solo ocurre cuando el revisor encuentra un problema; si pasa en ~3 de cada 10
  respuestas, la venta cuesta ~30% más (hoy ~S/ 0,0075 por mensaje). El juez del examen solo corre en pruebas.
- **Tiempo de respuesta:** +2 a 4 s solo en los mensajes que se reescriben.

## 8. Qué decide Rodrigo
- Aprobar el paso a cada fase (con el resultado del examen y sus pruebas en Probar flujos).
- Completar las fichas (Fase 4).

## 9. Registro
| Fecha | Fase | Examen (graves / 25) | Nota |
|---|---|---|---|
| 2026-10-02 | Línea base (a mano) | 9 / 25 | gpt-4.1-mini, sin cambios de arquitectura; calificado por Claude leyendo |
| 2026-10-03 | **Línea base oficial (examen)** | **12 / 35 conversaciones con falla grave** (13–15 graves) | Examen `89ef4c74`. Juez gpt-5-mini por turno con clave; dos calificaciones de las mismas transcripciones: 13 y 15 graves → ruido del juez ±2. Origen: ~3 cortes/respuestas borradas por el motor, ~3 de flujo (supone la zona, esquiva «¿cómo pago?»), ~7 inventos de la IA |

**Cómo leer la nota:** se compara «conversaciones con falla grave» (de 35). Una diferencia de 1–2 puede ser ruido del
juez; para dar por buena una mejora, que baje al menos 3 o que se repita en dos corridas.
