// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: media-gc  (recolector del bucket `media`)
//
//   Borra los archivos que ya no referencia nadie. Sin esto el bucket solo crece:
//   borrar un chat, un contacto o un producto quita la referencia pero NUNCA el
//   archivo. Medido: 1005 objetos y 42 MB, de los cuales UNO seguía en uso.
//
//   Recoge tres cosas de una sola pasada:
//     · media de chats/productos/flujos ya borrados,
//     · archivos que el operador subió y decidió no enviar (desde que el adjunto
//       espera con su pie de foto, la subida arranca al ELEGIR el archivo),
//     · restos de las corridas de prueba.
//
//   REGLA DE ORO: ante la duda, NO se borra. Se busca el nombre del objeto en el
//   TEXTO de todas las tablas que pueden guardar una URL, y solo se borra lo que no
//   aparece en ninguna. Un falso positivo acá es perder el comprobante de un cliente.
//
//   El período de gracia (horas) protege lo recién subido: un archivo puede estar
//   arriba y todavía no referenciado mientras el operador escribe el pie de foto.
//
//   Uso:  POST { horas?: number, dry?: boolean, limite?: number }
//     dry:true  → solo informa qué borraría (por defecto NO borra nada)
//     horas     → gracia mínima antes de considerar un archivo abandonado (24 por defecto)
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/db.ts";

const db = serviceClient();
const BUCKET = "media";
const PAGINA = 1000;   // tope duro de PostgREST por pagina

// Cada entrada: [tabla, columna]. La búsqueda es por TEXTO sobre la columna, así
// que da igual cómo esté anidada la URL dentro del JSON.
const REFERENCIAS: Array<[string, string]> = [
  ["messages", "content"],
  ["quick_replies", "media"],
  ["products", "config"],
  ["flow_nodes", "config"],
  ["sequences", "pasos"],
  ["orders", "shipping"],
  ["channels", "logo_url"],
  ["channels", "negocio"],
  ["contacts", "memoria_ia"],
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Dos puertas, las mismas de siempre: el cron entra con el secreto compartido
  // (x-scheduler-secret, igual que scheduler y ads-sync) y una persona con su JWT del panel.
  const auth = req.headers.get("Authorization") ?? "";
  const secret = Deno.env.get("SCHEDULER_SECRET") ?? "";
  const esCron = !!secret && req.headers.get("x-scheduler-secret") === secret;
  if (!esCron) {
    const { data: u } = await userClient(auth).auth.getUser();
    const uid = u?.user?.id;
    if (!uid) return json({ error: "no_auth" }, 401);
    const { data: member } = await db.from("app_users").select("id").eq("id", uid).eq("activo", true).maybeSingle();
    if (!member) return json({ error: "not_member" }, 403);
  }

  let body: { horas?: number; dry?: boolean; limite?: number } = {};
  try { body = await req.json(); } catch { /* sin body → valores por defecto */ }
  const dry = body.dry === true;   // por defecto NO borra: hay que pedirlo
  // Piso de una hora para el borrado de verdad: un archivo recien subido puede estar
  // arriba y aun sin referencia mientras el operador escribe el pie de foto. En seco
  // se permite bajar de ahi, que es como se comprueba que lo referenciado se salva.
  const piso = dry ? 0 : 1;
  const horas = Number.isFinite(Number(body.horas)) ? Math.max(piso, Number(body.horas)) : 24;
  const limite = Math.min(Math.max(Number(body.limite) || 3000, 1), 20000);

  const corte = new Date(Date.now() - horas * 3600 * 1000).toISOString();

  // 1) Inventario: objetos con la gracia cumplida, los mas viejos primero.
  //    Via RPC porque el esquema `storage` no esta expuesto por PostgREST (migracion
  //    0083), y por paginas porque PostgREST corta en 1000 filas: sin el offset se
  //    veria siempre el mismo primer millar y lo nuevo no se revisaria jamas.
  type Obj = { nombre: string; creado: string; bytes: number };
  const candidatos: Obj[] = [];
  while (candidatos.length < limite) {
    const { data, error } = await db.rpc("nodo_media_objetos", {
      p_bucket: BUCKET, p_antes: corte, p_limite: PAGINA, p_desde: candidatos.length,
    });
    if (error) return json({ error: "no_pude_listar", detalle: error.message }, 500);
    const pag = (data ?? []) as Obj[];
    candidatos.push(...pag);
    if (pag.length < PAGINA) break;
  }
  if (!candidatos.length) return json({ ok: true, revisados: 0, borrados: 0, liberado_kb: 0 });

  // 2) ¿Alguien lo referencia? Una consulta por tabla y por objeto es carísimo, así
  //    que se recorre UNA vez el texto de las columnas que pueden traer URLs, por
  //    paginas, y se busca en memoria contra la lista de candidatos.
  const usados = new Set<string>();
  for (const [tabla, col] of REFERENCIAS) {
    // PostgREST corta en 1000 filas y .limit() NO lo sube: hay que paginar con
    // .range() hasta que la pagina venga corta. Sin esto solo se revisarian los
    // primeros 1000 mensajes y el recolector borraria comprobantes en uso.
    for (let desde = 0; ; desde += PAGINA) {
      const { data, error } = await db.from(tabla).select(`id, ${col}`)
        .order("id", { ascending: true }).range(desde, desde + PAGINA - 1);
      // supabase-js NO lanza ante un error de consulta: devuelve { data: null, error }.
      // Y no poder comprobar una fuente es exactamente cuando NO se debe borrar.
      if (error) return json({ error: "no_pude_verificar", detalle: `${tabla}.${col}: ${error.message}` }, 500);
      for (const fila of (data ?? [])) {
        const txt = JSON.stringify((fila as Record<string, unknown>)[col] ?? "");
        if (txt.length < 8) continue;
        for (const o of candidatos) if (txt.includes(o.nombre)) usados.add(o.nombre);
      }
      if ((data?.length ?? 0) < PAGINA) break;
      if (desde > 500_000) break;   // tope de seguridad, no deberia llegar
    }
  }


  const basura = candidatos.filter((o) => !usados.has(o.nombre));
  const bytes = basura.reduce((a, o) => a + (Number(o.bytes) || 0), 0);

  if (dry || !basura.length) {
    return json({
      ok: true, dry: true, revisados: candidatos.length, en_uso: usados.size,
      borrarian: basura.length, liberaria_kb: Math.round(bytes / 1024),
      ejemplos: basura.slice(0, 5).map((o) => o.nombre),
    });
  }

  // 3) Borrado por la API de Storage (no por SQL): borrar la fila de storage.objects
  //    a mano deja el archivo físico colgado en el disco, ocupando igual.
  let borrados = 0;
  for (let i = 0; i < basura.length; i += 100) {
    const lote = basura.slice(i, i + 100).map((o) => o.nombre);
    const { error } = await db.storage.from(BUCKET).remove(lote);
    if (!error) borrados += lote.length;
  }
  return json({
    ok: true, revisados: candidatos.length, en_uso: usados.size,
    borrados, liberado_kb: Math.round(bytes / 1024),
  });
});
