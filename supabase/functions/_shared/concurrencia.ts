// ═══════════════════════════════════════════════════════════════════
// Nodo · concurrencia.ts — correr trabajo de a tandas.
//
// El scheduler es de TODA la plataforma: en un solo tick de un minuto atiende los
// flujos dormidos, las secuencias y las campañas de TODOS los bots de TODOS los
// usuarios. Varias de esas tareas esperan a alguien de afuera (la IA, la API de
// WhatsApp), así que en fila india el minuto se acaba antes que la lista y los
// últimos esperan al tick siguiente — que es latencia que siente el cliente.
//
// La tanda es a propósito y no "todo a la vez": acota cuántas llamadas simultáneas
// se le hacen al proveedor de IA (y a su límite de tasa) y cuánta carga recibe la
// base de una sola vez.
// ═══════════════════════════════════════════════════════════════════

/** Corre `fn` sobre los items de a `n` a la vez. `fn` debe atrapar sus propios errores:
 *  lo que lance corta la tanda entera (Promise.all). */
export async function enParalelo<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  const tanda = Math.max(1, n | 0);
  for (let i = 0; i < items.length; i += tanda) {
    await Promise.all(items.slice(i, i + tanda).map(fn));
  }
}
