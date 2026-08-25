// ═══════════════════════════════════════════════════════════════════
// Nodo · paginar.ts — traer TODAS las filas de una consulta
//
//   PostgREST devuelve como MUCHO 1000 filas por request y el `.limit()`
//   del cliente NO lo sube (medido contra la base: 1200 filas guardadas,
//   `limit=5000` → 1000 devueltas). Lo peor es que no avisa de que cortó,
//   así que el síntoma no es un error: son números cortos que parecen
//   buenos. Vive acá, en un solo sitio, porque este arreglo copiado en dos
//   archivos es exactamente como se vuelve a desincronizar.
//
//   `makeQuery(from,to)` debe devolver una query FRESCA con `.range(from,to)`
//   y un orden ESTABLE (un campo + `id` de desempate). Si el orden empata,
//   las páginas repiten unas filas y se saltan otras.
// ═══════════════════════════════════════════════════════════════════
export async function pageAll<T = any>(
  makeQuery: (from: number, to: number) => any,
  { pageSize = 1000, max = 50000 }: { pageSize?: number; max?: number } = {},
): Promise<{ data: T[]; error: any }> {
  const out: T[] = [];
  let from = 0;
  while (from < max) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error) return { data: out, error };
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return { data: out, error: null };
}
