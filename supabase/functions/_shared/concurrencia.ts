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

// ── Reparto justo entre bots ───────────────────────────────────────
// El cron es UNO SOLO para toda la plataforma: en cada tick atiende a los bots de todos los
// usuarios. Si se toma "los primeros N" de la cola, un negocio con mucho movimiento se lleva
// los N cupos y los demás esperan al tick siguiente — o al siguiente, si el grande sigue
// llenando la cola. Con un tenant es invisible; con muchos es un negocio parado porque el
// vecino vende mucho.
//
// Reparte por turnos: la 1ª pendiente de cada bot, después la 2ª de cada uno, y así. Con un
// solo bot activo se lleva todo el cupo (no se desperdicia capacidad, que es el defecto del
// típico "máximo X por canal"); con muchos, a ninguno lo deja sin su turno.
//
// `filas` debe venir ya ordenada por prioridad (lo más vencido primero): el reparto conserva
// ese orden dentro de cada bot.
export function repartoJusto<T>(filas: T[], canalDe: (r: T) => string, tope: number): T[] {
  if (filas.length <= tope) return filas;
  const colas = new Map<string, T[]>();
  for (const r of filas) {
    const k = canalDe(r) ?? "";
    const l = colas.get(k);
    if (l) l.push(r); else colas.set(k, [r]);
  }
  const listas = [...colas.values()];
  const out: T[] = [];
  for (let i = 0; out.length < tope; i++) {
    let hubo = false;
    for (const l of listas) {
      if (i >= l.length) continue;
      out.push(l[i]);
      hubo = true;
      if (out.length >= tope) break;
    }
    if (!hubo) break; // se agotaron todas las colas
  }
  return out;
}
