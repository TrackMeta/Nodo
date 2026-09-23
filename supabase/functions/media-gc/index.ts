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
//     dry:true  → solo informa qué movería. Sin `dry` (así lo llama el cron) MUEVE la basura a
//                 `papelera/AAAAMMDD/` y borra de verdad lo que lleva más de 7 días ahí.
//     horas     → gracia mínima antes de considerar un archivo abandonado (24 por defecto)
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/db.ts";

const db = serviceClient();
const BUCKET = "media";
const PAGINA = 1000;   // tope duro de PostgREST por pagina
const PAPELERA = "papelera/";
const DIAS_PAPELERA = 7;

// Cada entrada: [tabla, columna]. La búsqueda es por TEXTO sobre la columna, así
// que da igual cómo esté anidada la URL dentro del JSON.
//
// 🔴 ESTA LISTA ES LA QUE DECIDE QUÉ SE SALVA. Lo que guarde una URL del bucket y NO esté
// acá, el recolector lo da por basura y lo borra esa misma noche. Ya pasó: las 552 FICHAS DE
// LAS OFICINAS Shalom (`sede_imagenes.url`, 10 minutos de generación a mano) desaparecieron
// enteras — la tabla conservó las 552 filas apuntando a archivos que ya no existían, así que
// no se notaba desde el panel: el bot le mandaba al cliente una imagen rota al confirmarle su
// sede. Se descubrió mirando el bucket, no el panel.
//
// ⛔ AL AGREGAR UNA FEATURE QUE SUBA ARCHIVOS, AGREGARLA ACÁ EN EL MISMO COMMIT.
const REFERENCIAS: Array<[string, string, string?]> = [
  ["messages", "content"],
  ["quick_replies", "media"],
  ["products", "config"],
  ["flow_nodes", "config"],
  ["sequences", "pasos"],
  ["orders", "shipping"],
  ["channels", "logo_url"],
  ["channels", "negocio"],
  // La biblioteca de archivos del NEGOCIO (Negocio → multimedia) vive en `negocio_form`, no
  // en `negocio`: son dos columnas distintas y solo estaba la segunda.
  ["channels", "negocio_form"],
  // Los adjuntos por momento de los AVISOS de pedido (Canales → Avisos).
  ["channels", "pedidos_config"],
  ["contacts", "memoria_ia"],
  // Las fichas de las 552 oficinas Shalom. Faltaba, y por eso se borraron.
  ["sede_imagenes", "url", "slug"],
  // `ultima_imagen` y cualquier otro campo capturado que guarde una URL. La PK es compuesta
  // (contact_id, field_id): paginar ordenando solo por contact_id no es estable y puede
  // saltarse filas → una URL en uso que no se ve → archivo borrado. Las dos columnas.
  ["contact_field_values", "value", "contact_id,field_id"],
  // Avatar del usuario del panel (perfil.html sube con media-upload). Faltaba: se borraba
  // a las 24 h y el chip del sidebar quedaba roto.
  ["app_users", "avatar_url"],
  // Ejemplos de comprobante del validador OCR (ia.html). Faltaba, igual que las fichas.
  ["channels", "ocr_config"],
  // Los ARCHIVOS DE ENTREGA de los productos digitales (el PDF/curso que el cliente PAGA):
  // productos.html los sube con media-upload y los guarda en product_versions.entrega[].url,
  // que el motor lee de esta tabla (no de products.config). Faltaba → un entregable subido
  // hoy y vendido pasado mañana se borraba a las 04:17 y la entrega salía 404 (131053).
  ["product_versions", "entrega"],
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
    // Solo administrador de PLATAFORMA: el barrido es sobre el bucket entero (todas las
    // cuentas) y `dry` es false por defecto. Con la puerta «cualquier miembro activo», un
    // operador de una cuenta podía borrar lo recién subido de todas las demás.
    const { data: member } = await db.from("app_users").select("id, platform_admin").eq("id", uid).eq("activo", true).maybeSingle();
    if (!member) return json({ error: "not_member" }, 403);
    if ((member as any).platform_admin !== true) return json({ error: "forbidden", detalle: "Solo el administrador de la plataforma puede correr el recolector" }, 403);
  }

  let body: { horas?: number; dry?: boolean; limite?: number } = {};
  try { body = await req.json(); } catch { /* sin body → valores por defecto */ }
  const dry = body.dry === true;   // dry: solo informa. Sin dry manda la basura a la papelera (ver abajo)
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
  const todos: Obj[] = [];
  while (todos.length < limite) {
    const { data, error } = await db.rpc("nodo_media_objetos", {
      p_bucket: BUCKET, p_antes: corte, p_limite: PAGINA, p_desde: todos.length,
    });
    if (error) return json({ error: "no_pude_listar", detalle: error.message }, 500);
    const pag = (data ?? []) as Obj[];
    todos.push(...pag);
    if (pag.length < PAGINA) break;
  }
  // 🗑️ PAPELERA: lo que se da por basura NO se borra de una: se mueve a `papelera/AAAAMMDD/…` y
  // se borra de verdad a los DIAS_PAPELERA días. Si la lista REFERENCIAS vuelve a olvidarse de
  // una columna (ya pasó: se fueron las 552 fichas de agencias), hay una semana para devolverlo
  // a su nombre original con un `move`, en vez de perderlo.
  const papelera = todos.filter((o) => o.nombre.startsWith(PAPELERA));
  const candidatos = todos.filter((o) => !o.nombre.startsWith(PAPELERA));
  let purgados = 0;
  if (!dry) {
    const limiteP = new Date(Date.now() - DIAS_PAPELERA * 864e5).toISOString().slice(0, 10).replace(/-/g, "");
    const viejos = papelera.filter((o) => { const m = /^papelera\/(\d{8})\//.exec(o.nombre); return !!m && m[1] < limiteP; }).map((o) => o.nombre);
    for (let i = 0; i < viejos.length; i += 100) {
      const lote = viejos.slice(i, i + 100);
      const { error } = await db.storage.from(BUCKET).remove(lote);
      if (!error) purgados += lote.length;
    }
  }
  if (!candidatos.length) return json({ ok: true, revisados: 0, a_papelera: 0, purgados, liberado_kb: 0 });

  // 2) ¿Alguien lo referencia? Una consulta por tabla y por objeto es carísimo, así
  //    que se recorre UNA vez el texto de las columnas que pueden traer URLs, por
  //    paginas, y se busca en memoria contra la lista de candidatos.
  const usados = new Set<string>();
  for (const [tabla, col, clave] of REFERENCIAS) {
    // La columna por la que se ordena para paginar. Casi siempre `id`, pero no todas las
    // tablas la tienen: `sede_imagenes` se identifica por `slug` y con "id" la consulta
    // reventaba entera. (Reventar es lo MENOS malo que podía pasar: la función devuelve
    // "no_pude_verificar" y no borra nada. Pero así tampoco limpiaba.)
    // Puede ser una clave compuesta ("contact_id,field_id"): se ordena por todas.
    const ordenes = (clave || "id").split(",").map((s) => s.trim()).filter(Boolean);
    // PostgREST corta en 1000 filas y .limit() NO lo sube: hay que paginar con
    // .range() hasta que la pagina venga corta. Sin esto solo se revisarian los
    // primeros 1000 mensajes y el recolector borraria comprobantes en uso.
    // Con clave simple se pagina por CURSOR (id > último visto), no por offset: un mensaje que
    // entra a mitad del barrido con un id "menor" corría todas las páginas una fila y esa fila
    // no se revisaba — si nombraba un archivo viejo, se lo daba por basura.
    let ultimo: unknown = null;
    for (let desde = 0; ; desde += PAGINA) {
      let q = db.from(tabla).select(`${ordenes.join(", ")}, ${col}`);
      for (const o of ordenes) q = q.order(o, { ascending: true });
      if (ordenes.length === 1 && ultimo != null) q = q.gt(ordenes[0], ultimo as string);
      const { data, error } = ordenes.length === 1
        ? await q.limit(PAGINA)
        : await q.range(desde, desde + PAGINA - 1);
      if (ordenes.length === 1 && data?.length) ultimo = (data[data.length - 1] as Record<string, unknown>)[ordenes[0]];
      // supabase-js NO lanza ante un error de consulta: devuelve { data: null, error }.
      // Y no poder comprobar una fuente es exactamente cuando NO se debe borrar.
      if (error) return json({ error: "no_pude_verificar", detalle: `${tabla}.${col}: ${error.message}` }, 500);
      for (const fila of (data ?? [])) {
        const txt = JSON.stringify((fila as Record<string, unknown>)[col] ?? "");
        if (txt.length < 8) continue;
        for (const o of candidatos) if (txt.includes(o.nombre)) usados.add(o.nombre);
      }
      if ((data?.length ?? 0) < PAGINA) break;
      // Tope de seguridad. Cortar con `break` dejaba sin revisar lo que viene después y esos
      // archivos se BORRABAN como basura estando en uso. No haber podido mirar todo es motivo
      // para no borrar nada, igual que el error de arriba.
      if (desde > 500_000) return json({ error: "no_pude_verificar", detalle: `${tabla}.${col}: pasó el tope de filas revisables` }, 500);
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

  // 3) A la papelera por la API de Storage (no por SQL): tocar storage.objects a mano deja el
  //    archivo físico colgado. El borrado de verdad lo hace el paso de purga, días después.
  const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let aPapelera = 0;
  for (const o of basura) {
    const { error } = await db.storage.from(BUCKET).move(o.nombre, `${PAPELERA}${hoy}/${o.nombre}`);
    if (!error) aPapelera++;
  }
  return json({
    ok: true, revisados: candidatos.length, en_uso: usados.size,
    a_papelera: aPapelera, purgados, liberado_kb: Math.round(bytes / 1024),
  });
});
