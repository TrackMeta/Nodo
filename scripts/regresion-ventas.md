# Regresión de ventas (reutilizable)

Harness end-to-end que prueba el **motor de ventas** (`supabase/functions/_shared/engine.ts`) contra un catálogo conocido, corriendo conversaciones reales por la Edge Function `tmp-sim` y verificando el resultado en la BD.

Sirve para, en cada cambio del motor o del generador de flujos, confirmar en ~3 min que **no se rompió nada** de lo que ya funcionaba — en vez de cazar bugs a mano cada vez.

## Cómo correrlo

1. Abre el panel **logueado** en la sección **Productos** (la página expone `window.__nodoTest`, que deja generar los flujos con el generador real).
2. Abre la consola del navegador (**F12 → Console**).
3. Copia y pega **todo** el contenido de [`regresion-ventas.js`](regresion-ventas.js).
4. Ejecuta:

   ```js
   await NodoRegresion.run();
   ```

   Hace: **limpia** el canal → arma el **catálogo** → **genera los flujos** (generador real) → corre los **casos** → imprime una **tabla PASS/FAIL** → **limpia** al final.

### Opciones

```js
await NodoRegresion.run({ keepData: true }); // NO limpia al final (para ver los chats en la Bandeja)
await NodoRegresion.clean();                 // solo limpiar el canal
```

> ⚠️ Corre sobre el canal de **prueba/sandbox** que tengas activo. **Borra todos** los productos, contactos y flujos de ese canal. No lo corras sobre un canal con datos reales.
>
> ⚠️ **Google Sheets:** si el canal tiene una hoja conectada (Canales → Sheets), cada pedido de prueba se sincroniza a esa hoja y puede disparar el Apps Script que la procesa. El `clean()` borra los pedidos de la BD pero **no** de la hoja → quedan filas de prueba ahí. Corre el harness en un canal **sin** hoja conectada (o desconéctala mientras pruebas y limpia esas filas a mano).

## Qué cubre (10 casos)

| Caso | Verifica |
|------|----------|
| Lima simple | pedido confirmado, monto, contraentrega, **regalo** adjunto a S/0 |
| Lima + extra + **stock plural** | extra sumado, y que `"blancas"` descuenta `Color=blanco` (**regresión fix stock**) |
| Pack 2 pares | monto del pack + stock descuenta por **cantidad** (−2) |
| Provincia sede exacta | `esperando_adelanto`, provincia, **sin** bandera |
| Provincia sede vaga | bandera `sede_por_confirmar` levantada, continúa al adelanto |
| **Zona / oficina Shalom** | `"Shalom de Trujillo La Perla"` → provincia/Trujillo, **no** Lima (**regresión fix zona**) |
| Digital Básica | entrega el link + monto 99 |
| Digital Premium | entrega los **2 links** + monto 199 |
| **Dead-air** al declinar extra | el bot **acusa** ("queda tal cual") en vez de quedar mudo (**regresión fix dead-air**) |
| Prospecto no compra | queda `interesado`, sin pedido |

Las aserciones se apoyan en el **estado de la BD** (pedido, monto, stock, zona, bandera) y en **regex** sobre los mensajes, no en el texto exacto de la IA, para tolerar su no-determinismo.

## Mantenimiento

- El **catálogo de prueba** y las **aserciones** viven en `regresion-ventas.js` (constantes `CATALOGO`/`ZAP_STOCK0` y el array `CASES`). Si cambian precios/stock de prueba, ajústalos ahí.
- Los **flujos** se generan con el generador real de `panel/productos.html` vía `window.__nodoTest` (expuesto en el `init`), así que **no hay una copia del generador** que se desactualice. Si cambia la firma de `openProduct`/`generarFlujoVenta`, actualiza el hook `window.__nodoTest`.
- Para agregar un caso: empuja un objeto `{ name, run }` al array `CASES`; `run` devuelve `[{ ok, msg }]`.

## Notas técnicas

- `window.__nodoTest` solo expone funciones ya existentes del editor; es inofensivo en producción.
- La validación del adelanto físico es **manual** (`pedidos_config.adelanto.validacion`), así que esos pagos quedan en *Pagos por validar* (el caso de provincia no envía comprobante). Los pagos **digitales** sí se validan por OCR en el flujo.
- Requiere que `tmp-sim` esté desplegada (driver de simulación multi-contacto).
