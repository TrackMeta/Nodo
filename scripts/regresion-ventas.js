/* ═══════════════════════════════════════════════════════════════════════════
 * Nodo · Harness de REGRESIÓN de ventas  (reutilizable)
 * ───────────────────────────────────────────────────────────────────────────
 * Prueba de punta a punta el MOTOR de ventas (engine.ts) contra un catálogo
 * conocido, corriendo conversaciones reales por la Edge Function `tmp-sim` y
 * verificando el resultado en la BD (pedido, monto, stock, zona, entrega, msgs).
 *
 * Cubre las regresiones halladas en las simulaciones (ver memoria
 * simulacion-e2e-2026-08-09): stock por valor plural ("blancas"→"blanco"),
 * nombre de oficina Shalom que secuestra la zona a Lima ("Trujillo La Perla"),
 * pack por cantidad, provincia sede exacta/vaga + bandera, entrega digital
 * básica/premium, y el acuse al declinar el extra (fin del dead-air).
 *
 * CÓMO USARLO
 *   1. Abre el panel logueado en la sección **Productos** (necesita
 *      `window.__nodoTest`, que expone el generador de flujos real).
 *   2. Abre la consola del navegador (F12 → Console) y PEGA todo este archivo.
 *   3. Corre:   await NodoRegresion.run();
 *        · Limpia el canal → arma el catálogo → genera los flujos con el
 *          generador REAL → corre los casos → imprime una tabla PASS/FAIL →
 *          limpia al final.
 *   4. Opciones:
 *        await NodoRegresion.run({ keepData:true });  // NO limpia (para ver los
 *                                                      // chats en la Bandeja)
 *        await NodoRegresion.clean();                  // solo limpiar
 *
 * OJO: usa un canal de PRUEBA (sandbox). Borra TODOS los productos/contactos/
 * flujos de ese canal — no lo corras sobre un canal con datos reales.
 *
 * ⚠️ GOOGLE SHEETS: si el canal tiene una hoja conectada (Canales → Sheets), CADA
 * pedido de prueba se sincroniza a esa hoja (syncPedidoSheet) y puede disparar el
 * Apps Script que la procesa. El `clean()` borra los pedidos de la BD, pero NO de
 * la hoja (el borrado directo no pasa por la sync) → quedan filas de prueba en la
 * hoja real. Para evitar ruido/fallos de Apps Script: corre el harness en un canal
 * SIN hoja conectada, o desconéctala mientras pruebas y limpia esas filas a mano.
 *
 * MANTENIMIENTO: el catálogo y las aserciones viven acá. Los FLUJOS se generan
 * con el generador real de `productos.html` (vía `window.__nodoTest`), así que
 * NO hay una copia del generador que se desactualice. Si cambian precios/stock
 * del catálogo de prueba, ajusta las constantes de CATALOGO y las aserciones.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const BASE = "https://ahoxdyffbwjlshmdezwi.supabase.co";
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFob3hkeWZmYndqbHNobWRlendpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNDU4MTksImV4cCI6MjA5ODYyMTgxOX0.4iY3gl1ZhxILv1kPF8-NYd4a0_MeAZmkyLqxx2BMW-Q";

  function channelId() {
    try { const s = window.__nodoTest?.getSt?.(); if (s?.channelId) return s.channelId; } catch (_) {}
    try { return JSON.parse(localStorage.getItem("nodo.channelId")); } catch (_) {}
    return localStorage.getItem("nodo.channelId");
  }
  const CH = channelId();
  const token = () => { try { return JSON.parse(localStorage.getItem("sb-ahoxdyffbwjlshmdezwi-auth-token")).access_token; } catch (_) { return null; } };
  const H = (repr) => ({ apikey: ANON, Authorization: "Bearer " + token(), "Content-Type": "application/json", Prefer: repr ? "return=representation" : "return=minimal" });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => console.log("%c[regresión]", "color:#7A3FF2;font-weight:bold", ...a);

  // ── REST helpers ──────────────────────────────────────────────────────────
  const sel = (t, q) => fetch(`${BASE}/rest/v1/${t}?${q}`, { headers: H(true) }).then((r) => r.json());
  const ins = (t, rows) => fetch(`${BASE}/rest/v1/${t}`, { method: "POST", headers: H(true), body: JSON.stringify(rows) }).then((r) => r.json());
  const patch = (t, q, body) => fetch(`${BASE}/rest/v1/${t}?${q}`, { method: "PATCH", headers: H(false), body: JSON.stringify(body) });
  const del = (t, q) => fetch(`${BASE}/rest/v1/${t}?${q}`, { method: "DELETE", headers: H(false) });

  // ── Driver de conversación (Edge Function tmp-sim) ────────────────────────
  async function send(wa, nombre, text, extra = {}) {
    const r = await fetch(`${BASE}/functions/v1/tmp-sim`, {
      method: "POST", headers: { apikey: ANON, Authorization: "Bearer " + token(), "Content-Type": "application/json" },
      body: JSON.stringify({ channel_id: CH, wa_id: wa, nombre, text, ...extra }),
    });
    return r.json();
  }
  const reset = (wa, nombre) => send(wa, nombre, "", { reset: true });

  // Comprobante Yape sintético → media-upload → mandar como imagen.
  async function yape(wa, nombre, { op, monto, quien } = {}) {
    op = op || ("0" + Math.floor(10000000 + Math.random() * 89999999));
    const c = document.createElement("canvas"); c.width = 420; c.height = 520; const x = c.getContext("2d");
    x.fillStyle = "#7A3FF2"; x.fillRect(0, 0, 420, 110); x.fillStyle = "#fff"; x.font = "bold 30px Arial"; x.fillText("Yape", 160, 65);
    x.fillStyle = "#f5f5f5"; x.fillRect(0, 110, 420, 410); x.fillStyle = "#111";
    const L = ["¡Yapeaste!", "S/ " + (monto || 0) + ".00", "Para: Rodrigo Flores", "De: " + (quien || nombre), "N° operación: " + op, "08 ago. 2026 - 03:14 pm"];
    let y = 170; for (const t of L) { x.font = "18px Arial"; x.fillText(t, 26, y); y += 40; }
    const data = c.toDataURL("image/png");
    const up = await fetch(`${BASE}/functions/v1/media-upload`, { method: "POST", headers: { apikey: ANON, Authorization: "Bearer " + token(), "Content-Type": "application/json" }, body: JSON.stringify({ channel_id: CH, filename: "yape.png", content_type: "image/png", data }) }).then((r) => r.json());
    if (!up.url) throw new Error("media-upload falló: " + JSON.stringify(up));
    await send(wa, nombre, "", { media: { kind: "image", url: up.url, mime: "image/png", caption: "" } });
    return { op, monto };
  }

  // ── Lecturas de estado ────────────────────────────────────────────────────
  async function contact(wa) { return (await sel("contacts", `select=id,stage,no_remarketing&channel_id=eq.${CH}&wa_id=eq.${wa}`))[0]; }
  async function order(wa) { const c = await contact(wa); if (!c) return null; const o = await sel("orders", `select=estado,amount,shipping,order_bumps,version_id&contact_id=eq.${c.id}&order=created_at.desc`); return { c, o: o[0], all: o }; }
  async function vars(wa) { const c = await contact(wa); if (!c) return {}; const fr = await sel("flow_runs", `select=vars&contact_id=eq.${c.id}&order=created_at.desc&limit=1`); return fr[0]?.vars || {}; }
  async function outMsgs(wa, n = 6) { const c = await contact(wa); if (!c) return []; const m = await sel("messages", `select=content,direction,ts&contact_id=eq.${c.id}&direction=eq.out&order=ts.desc&limit=${n}`); return m.map((x) => x.content?.text || x.content?.caption || "").reverse(); }
  async function stockOf(pid) { const p = (await sel("products", `select=config&id=eq.${pid}`))[0]; return p?.config?.stock || {}; }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIMPIEZA
  // ═══════════════════════════════════════════════════════════════════════════
  async function clean() {
    const conts = await sel("contacts", `select=id&channel_id=eq.${CH}`);
    if (conts.length) { const inl = `(${conts.map((c) => c.id).join(",")})`; for (const t of ["messages", "contact_events", "orders", "flow_runs", "conversations"]) await del(t, `contact_id=in.${inl}`); await del("contacts", `channel_id=eq.${CH}`); }
    const prods = await sel("products", `select=id&channel_id=eq.${CH}`);
    const flows = await sel("flows", `select=id&channel_id=eq.${CH}`);
    await del("flow_triggers", `channel_id=eq.${CH}`);
    if (flows.length) await del("flow_nodes", `flow_id=in.(${flows.map((f) => f.id).join(",")})`);
    await del("flows", `channel_id=eq.${CH}`);
    if (prods.length) await del("product_versions", `product_id=in.(${prods.map((p) => p.id).join(",")})`);
    await del("products", `channel_id=eq.${CH}`);
    await del("payment_operations", `channel_id=eq.${CH}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CATÁLOGO (mismo de la simulación 2026-08-09)
  //   Zapatillas Runner Pro (físico, Talla 38/39/40 × negro/blanco + stock,
  //     extra Medias c/talla S/M, regalo Gorra) · packs 1 par / 2 pares.
  //   Curso Master de Trading (digital, Básica 99 / Premium 199, extra Plantillas 49).
  // ═══════════════════════════════════════════════════════════════════════════
  const ZAP_STOCK0 = { "Talla=38|Color=negro": 10, "Talla=38|Color=blanco": 8, "Talla=39|Color=negro": 6, "Talla=39|Color=blanco": 4, "Talla=40|Color=negro": 3, "Talla=40|Color=blanco": 2 };
  const MED_STOCK0 = { "Talla=s": 5, "Talla=m": 5 };

  async function build() {
    const prods = await ins("products", [
      { channel_id: CH, nombre: "REG Zapatillas Runner Pro", clase: "principal", tipo: "fisico", config: {
        contexto_producto: "## Sobre el producto\nZapatillas running ultralivianas, malla transpirable, suela EVA. Tallas 38-40, negro o blanco.\n## Garantía\n30 días por defecto de fábrica.\n## Cómo vender\nConsultivo, en beneficios, cierre asumido.",
        costo: 45, empaque: 3, stock_umbral: 3,
        atributos: [ { nombre: "Talla", clave: "talla", obligatorio: true, valores: "38, 39, 40", ayuda: "", media: [] }, { nombre: "Color", clave: "color", obligatorio: true, valores: "negro, blanco", ayuda: "", media: [] } ],
        stock: { ...ZAP_STOCK0 } } },
      { channel_id: CH, nombre: "REG Medias Deportivas Pro", clase: "extra", tipo: "fisico", config: { costo: 4, empaque: 0, stock_umbral: 3, contexto_producto: "## Sobre el producto\nMedias de compresión, tallas S y M.", atributos: [ { nombre: "Talla", clave: "talla", obligatorio: true, valores: "S, M", ayuda: "", media: [] } ], stock: { ...MED_STOCK0 } } },
      { channel_id: CH, nombre: "REG Gorra Runner", clase: "regalo", tipo: "fisico", config: { costo: 8, regalo_desc: "Gorra deportiva, talla única.", atributos: [], stock: {} } },
      { channel_id: CH, nombre: "REG Curso Master de Trading", clase: "principal", tipo: "digital", config: { contexto_producto: "## Sobre el producto\nCurso de trading de 0 a avanzado, acceso de por vida. Premium incluye mentoría.\n## Reglas del precio\nFijo, dos planes: Básica y Premium." } },
      { channel_id: CH, nombre: "REG Pack Plantillas Excel", clase: "extra", tipo: "digital", config: { contexto_producto: "## Sobre el producto\nPack de plantillas de Excel de gestión de riesgo." } },
    ]);
    const P = {}; prods.forEach((p) => { P[({ "REG Zapatillas Runner Pro": "zap", "REG Medias Deportivas Pro": "med", "REG Gorra Runner": "gorra", "REG Curso Master de Trading": "curso", "REG Pack Plantillas Excel": "plant" })[p.nombre]] = p.id; });

    const mk = (o) => ({ product_id: o.pid, nombre: o.nombre, orden: o.orden, activo: true, cantidad: o.cantidad ?? 1, precio: o.precio ?? null, costo: o.costo ?? null, descripcion: o.descripcion ?? null, entrega: o.entrega ?? [], entrega_mensaje: o.entrega_mensaje ?? null, price_list: [], drive_link: null });
    const vs = await ins("product_versions", [
      mk({ pid: P.zap, nombre: "1 par", orden: 0, cantidad: 1, precio: 129, costo: 45, descripcion: "Un par" }),
      mk({ pid: P.zap, nombre: "Pack 2 pares", orden: 1, cantidad: 2, precio: 230, costo: 90, descripcion: "Dos pares" }),
      mk({ pid: P.med, nombre: "Única", orden: 0, cantidad: 1, precio: 19, costo: 4 }),
      mk({ pid: P.gorra, nombre: "Única", orden: 0, cantidad: 1, precio: null, costo: 8 }),
      mk({ pid: P.curso, nombre: "Básica", orden: 0, cantidad: 1, precio: 99, costo: 0, descripcion: "Módulos 1-5", entrega: [{ tipo: "link", url: "https://nodo.demo/basica", nombre: "Acceso Básico", mensaje: "" }], entrega_mensaje: "¡Listo! 🎉 Tu acceso Básico:" }),
      mk({ pid: P.curso, nombre: "Premium", orden: 1, cantidad: 1, precio: 199, costo: 0, descripcion: "Todo + mentoría", entrega: [{ tipo: "link", url: "https://nodo.demo/premium", nombre: "Acceso Premium", mensaje: "" }, { tipo: "link", url: "https://nodo.demo/mentoria", nombre: "Mentoría", mensaje: "Grupo de mentoría:" }], entrega_mensaje: "¡Bienvenido a Premium! 🎉 Todo tu acceso:" }),
      mk({ pid: P.plant, nombre: "Única", orden: 0, cantidad: 1, precio: 49, costo: 0, entrega: [{ tipo: "link", url: "https://nodo.demo/plantillas", nombre: "Plantillas", mensaje: "" }], entrega_mensaje: "¡Listo! Tus plantillas:" }),
    ]);
    const V = {}; vs.forEach((v) => { const pk = Object.keys(P).find((k) => P[k] === v.product_id); V[pk + ":" + v.nombre] = v.id; });

    // Enlazar extra + regalo en los principales.
    const zc = (await sel("products", `select=config&id=eq.${P.zap}`))[0].config;
    zc.extras = [{ version_id: V["med:Única"], mensaje: "¿Le sumas las Medias por S/ 19? 🧦" }]; zc.extras_momento = "antes"; zc.extras_prov_momento = "post"; zc.extras_seguir = false;
    zc.regalos = [{ version_id: V["gorra:Única"], product_id: P.gorra, nombre: "🧢 Gorra Runner de regalo", tipo: "fisico" }]; zc.regalo_mencionar = true;
    await patch("products", `id=eq.${P.zap}`, { config: zc });
    const cc = (await sel("products", `select=config&id=eq.${P.curso}`))[0].config;
    cc.extras = [{ version_id: V["plant:Única"], mensaje: "¿Le sumas el Pack de Plantillas por S/ 49? 📊" }]; cc.extras_momento = "despues"; cc.extras_seguir = false;
    await patch("products", `id=eq.${P.curso}`, { config: cc });

    // Mensajes iniciales + rotador + keyword trigger para cada principal.
    const uuid = () => crypto.randomUUID();
    async function iniciales(pid, nombre, greet, kws) {
      const f = (await ins("flows", { channel_id: CH, product_id: pid, kind: "flow", role: "mensajes_iniciales", nombre: "Mensajes iniciales · " + nombre, estado: "activo" }))[0];
      await ins("flow_nodes", { flow_id: f.id, tipo: "rotador", nombre: "Mensajes iniciales", es_inicial: true, config: { activo: true, variantes: [{ id: uuid(), nombre: "A", activo: true, peso: 1, bubbles: [{ text: greet }] }], despues: { modo: "nada" } }, pos_x: 80, pos_y: 80 });
      await ins("flow_triggers", { channel_id: CH, flow_id: f.id, tipo: "keyword", config: { keywords: kws }, activo: true });
    }
    await iniciales(P.zap, "Zapatillas Runner Pro", "¡Hola! 👋 Gracias por escribir por las *Zapatillas Runner Pro* 🏃 ¿Te cuento precios, tallas y colores?", ["zapatillas", "zapatilla", "runner"]);
    await iniciales(P.curso, "Curso Master de Trading", "¡Hola! 👋 Gracias por tu interés en el *Curso Master de Trading* 📈 ¿Te cuento los planes?", ["curso", "trading"]);

    return { P, V };
  }

  // Genera los flujos de venta con el generador REAL (window.__nodoTest).
  async function genFlows(ids) {
    if (!window.__nodoTest) throw new Error("Falta window.__nodoTest — abre el panel en la sección Productos y recarga.");
    for (const pid of [ids.P.zap, ids.P.curso]) {
      // OJO carrera: openProduct repuebla st.receta de forma ASÍNCRONA y genVenta
      // dispara re-renders del producto anterior. Si esperamos "cualquier receta con
      // fIni", podemos agarrar la del producto ANTERIOR (aún pendiente) y generar el
      // flujo equivocado (los dos rotadores terminan apuntando al mismo flujo). Por
      // eso anclamos la espera al fIni de ESTE producto (lo consultamos en la BD).
      const wantIni = (await sel("flows", `select=id&channel_id=eq.${CH}&product_id=eq.${pid}&role=eq.mensajes_iniciales`))[0]?.id;
      window.__nodoTest.getSt().receta = null; // invalidar la vieja
      await window.__nodoTest.openProduct(pid);
      for (let i = 0; i < 80; i++) { const s = window.__nodoTest.getSt(); if (s?.prod?.id === pid && s?.receta?.fIni?.id === wantIni) break; await sleep(150); }
      await sleep(300); // asentar
      await window.__nodoTest.genVenta();
      await sleep(600);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CASOS  ·  cada uno devuelve [{ ok, msg }]
  // ═══════════════════════════════════════════════════════════════════════════
  const N = () => "Ana Torres"; // nombre y apellido de prueba (el wa_id distingue cada chat;
  // debe tener 2 palabras o el flujo físico se queda pidiendo el apellido y no cierra)
  const ck = (ok, msg) => ({ ok: !!ok, msg });

  const CASES = [
    { name: "Lima simple → confirmado + regalo", run: async () => {
      const wa = "519990000001"; await send(wa, N(wa), "hola quiero las zapatillas runner"); await sleep(1300);
      await send(wa, N(wa), "un par talla 38 negras"); await sleep(2000);
      await send(wa, N(wa), N(wa) + ", Lima, Miraflores, Av Larco 100"); await sleep(2200);
      await send(wa, N(wa), "sí confirmo"); await sleep(2300);
      const { o } = await order(wa); const bump = (o?.order_bumps || []).find((b) => b.regalo);
      return [ck(o?.estado === "confirmado", `estado=${o?.estado} (esperado confirmado)`), ck(Number(o?.amount) === 129, `amount=${o?.amount} (esperado 129)`), ck(o?.shipping?.zona === "lima", `zona=${o?.shipping?.zona}`), ck(bump && Number(bump.precio) === 0, `regalo bump precio=${bump?.precio} (esperado 0)`)];
    } },

    { name: "Lima + extra + STOCK plural ('blancas'→'blanco')", run: async (ids) => {
      const wa = "519990000002"; const st0 = await stockOf(ids.P.zap); const med0 = await stockOf(ids.P.med);
      await send(wa, N(wa), "hola quiero las zapatillas runner"); await sleep(1300);
      await send(wa, N(wa), "un par talla 40 blancas"); await sleep(2000);
      await send(wa, N(wa), N(wa) + ", Lima, San Isidro, Av Aramburu 120"); await sleep(2200);
      await send(wa, N(wa), "sí confirmo"); await sleep(2300);
      await send(wa, N(wa), "sí agrégame las medias"); await sleep(2200);
      await send(wa, N(wa), "talla M"); await sleep(2500);
      const { o } = await order(wa); const st1 = await stockOf(ids.P.zap);
      // El stock PROPIO del extra se reconcilia un turno después de dar la talla
      // (reconciliarStockExtras), así que puede tardar: reintentar hasta que baje.
      let med1 = await stockOf(ids.P.med);
      for (let i = 0; i < 6 && med1["Talla=m"] === med0["Talla=m"]; i++) { await sleep(1500); med1 = await stockOf(ids.P.med); }
      const medBump = (o?.order_bumps || []).find((b) => /medias/i.test(b.nombre));
      return [
        ck(st1["Talla=40|Color=blanco"] === st0["Talla=40|Color=blanco"] - 1, `stock 40 blanco ${st0["Talla=40|Color=blanco"]}→${st1["Talla=40|Color=blanco"]} (esperado -1) [FIX #2]`),
        ck(medBump && Number(medBump.precio) === 19, `medias bump precio=${medBump?.precio} (esperado 19)`),
        ck(med1["Talla=m"] === med0["Talla=m"] - 1, `stock medias M ${med0["Talla=m"]}→${med1["Talla=m"]} (esperado -1)`),
      ];
    } },

    { name: "Pack 2 pares → amount 230 + stock -2 por cantidad", run: async (ids) => {
      const wa = "519990000003"; const st0 = await stockOf(ids.P.zap);
      await send(wa, N(wa), "hola quiero las zapatillas runner"); await sleep(1300);
      await send(wa, N(wa), "el pack de 2 pares, ambas talla 39 negras"); await sleep(2000);
      await send(wa, N(wa), N(wa) + ", Lima, Surco, Av Primavera 200"); await sleep(2200);
      await send(wa, N(wa), "sí confirmo"); await sleep(2300);
      const { o } = await order(wa); const st1 = await stockOf(ids.P.zap);
      return [ck(Number(o?.amount) === 230, `amount=${o?.amount} (esperado 230)`), ck(o?.shipping?.opcion === "Pack 2 pares", `opcion=${o?.shipping?.opcion}`), ck(st1["Talla=39|Color=negro"] === st0["Talla=39|Color=negro"] - 2, `stock 39 negro ${st0["Talla=39|Color=negro"]}→${st1["Talla=39|Color=negro"]} (esperado -2)`)];
    } },

    { name: "Provincia sede exacta → adelanto, sin bandera", run: async () => {
      const wa = "519990000004"; await send(wa, N(wa), "hola quiero las zapatillas runner, soy de Cusco"); await sleep(1600);
      await send(wa, N(wa), "un par talla 38 negras, DNI 44556677, " + N(wa) + " Rojas, lo recojo en el Shalom Cusco Parque Industrial"); await sleep(2400);
      const { o } = await order(wa);
      return [ck(o?.estado === "esperando_adelanto", `estado=${o?.estado} (esperado esperando_adelanto)`), ck(o?.shipping?.zona === "provincia", `zona=${o?.shipping?.zona}`), ck(!o?.shipping?.sede_por_confirmar, `bandera=${o?.shipping?.sede_por_confirmar || "ninguna"} (esperado ninguna)`)];
    } },

    { name: "Provincia sede vaga → bandera sede_por_confirmar", run: async () => {
      const wa = "519990000005"; await send(wa, N(wa), "hola las zapatillas runner mandan a Piura?"); await sleep(1600);
      await send(wa, N(wa), "sí un par talla 39 negras, DNI 41234567, " + N(wa) + " Luna, la agencia de Shalom de Piura, no sé cuál oficina exacta"); await sleep(2400);
      const { o } = await order(wa);
      return [ck(o?.estado === "esperando_adelanto", `estado=${o?.estado}`), ck(o?.shipping?.zona === "provincia", `zona=${o?.shipping?.zona}`), ck(!!o?.shipping?.sede_por_confirmar, `bandera=${o?.shipping?.sede_por_confirmar || "NINGUNA"} (esperada presente)`)];
    } },

    { name: "ZONA: oficina Shalom no secuestra a Lima ('Trujillo La Perla')", run: async () => {
      const wa = "519990000006"; await send(wa, N(wa), "hola quiero las zapatillas runner, soy de trujillo"); await sleep(1600);
      await send(wa, N(wa), "un par talla 38 negras, DNI 47112233, " + N(wa) + " Vera, lo recojo en el Shalom de Trujillo La Perla"); await sleep(2400);
      const v = await vars(wa);
      return [ck(v.zona_entrega === "provincia", `zona=${v.zona_entrega} (esperado provincia) [FIX #3]`), ck(/trujillo/i.test(v.ciudad || ""), `ciudad=${v.ciudad} (esperado Trujillo, NO La Perla)`)];
    } },

    { name: "Digital Básica → entrega link + amount 99", run: async () => {
      const wa = "519990000007"; await send(wa, N(wa), "hola quiero el curso de trading"); await sleep(1400);
      await send(wa, N(wa), "quiero la básica"); await sleep(2000);
      await send(wa, N(wa), "sí pásame el yape"); await sleep(1600);
      await yape(wa, N(wa), { monto: 99, quien: N(wa), op: "0" + Date.now().toString().slice(-9) }); await sleep(3000);
      const { o } = await order(wa); const outs = await outMsgs(wa, 6);
      return [ck(Number(o?.amount) === 99, `amount=${o?.amount} (esperado 99)`), ck(outs.some((m) => /nodo\.demo\/basica/.test(m)), `entregó link básica: ${outs.some((m) => /nodo\.demo\/basica/.test(m))}`)];
    } },

    { name: "Digital Premium → 2 links + amount 199", run: async () => {
      const wa = "519990000008"; await send(wa, N(wa), "hola quiero el curso de trading"); await sleep(1400);
      await send(wa, N(wa), "quiero la premium"); await sleep(2000);
      await send(wa, N(wa), "sí pásame el yape"); await sleep(1600);
      await yape(wa, N(wa), { monto: 199, quien: N(wa), op: "0" + Date.now().toString().slice(-9) }); await sleep(3000);
      const { o } = await order(wa); const outs = await outMsgs(wa, 8);
      return [ck(Number(o?.amount) === 199, `amount=${o?.amount} (esperado 199)`), ck(outs.some((m) => /nodo\.demo\/premium/.test(m)), "entregó link premium"), ck(outs.some((m) => /nodo\.demo\/mentoria/.test(m)), "entregó link mentoría")];
    } },

    { name: "Dead-air: declinar extra → acuse (no silencio)", run: async () => {
      const wa = "519990000009"; await send(wa, N(wa), "hola quiero las zapatillas runner"); await sleep(1300);
      await send(wa, N(wa), "un par talla 38 negras"); await sleep(2000);
      await send(wa, N(wa), N(wa) + ", Lima, Lince, Av Arenales 100"); await sleep(2200);
      await send(wa, N(wa), "sí confirmo"); await sleep(2300);
      const antes = (await outMsgs(wa, 1))[0] || "";
      await send(wa, N(wa), "no gracias, así está bien"); await sleep(2200);
      const outs = await outMsgs(wa, 2); const ultimo = outs[outs.length - 1] || "";
      return [ck(ultimo !== antes && /queda tal cual|cualquier cosa|perfecto/i.test(ultimo), `respondió al 'no gracias': "${ultimo.slice(0, 50)}"`)];
    } },

    { name: "Prospecto no compra → queda interesado, sin pedido", run: async () => {
      const wa = "519990000010"; await send(wa, N(wa), "hola las zapatillas runner son originales? qué garantía tienen"); await sleep(2000);
      await send(wa, N(wa), "ah ya, lo voy a pensar"); await sleep(2000);
      const { c, o } = await order(wa);
      return [ck(c?.stage === "interesado", `stage=${c?.stage} (esperado interesado)`), ck(!o, `pedido=${o ? "EXISTE" : "ninguno"} (esperado ninguno)`)];
    } },

    { name: "Anti-S/0: bundle tras keyword no crea pedido en S/0", run: async () => {
      const wa = "519990000011";
      // Cliente que manda TODO junto pegado a la palabra clave: la opción no se
      // resuelve en ese turno, así que el pedido NO debe nacer en S/0 — el bot pide
      // elegir la opción. Al elegirla, el pedido sale con el precio correcto.
      await send(wa, N(wa), "hola quiero las zapatillas runner, un par talla 40 blancas, soy de lima miraflores av larco 100, " + N(wa) + ", confirmo"); await sleep(2400);
      await send(wa, N(wa), "sí confirmo"); await sleep(2400);
      const hayS0 = ((await order(wa))?.all || []).some((x) => Number(x.amount) === 0);
      await send(wa, N(wa), "el par simple de 129"); await sleep(2300);
      await send(wa, N(wa), "sí confirmo"); await sleep(2400);
      const { o } = await order(wa);
      return [
        ck(!hayS0, `no se creó pedido en S/0 con el mensaje bundle (había S/0: ${hayS0}) [FIX S/0]`),
        ck(Number(o?.amount) === 129, `tras elegir la opción, amount=${o?.amount} (esperado 129)`),
      ];
    } },

    { name: "Adelanto: pagar el total acredita el saldo (queda en 0)", run: async () => {
      // Cliente de provincia que paga el precio COMPLETO como adelanto (típico del
      // recurrente que ya confía): el saldo debe quedar en 0 y marcarse pagado_total
      // (en la agencia no le cobran nada al recoger). Se valida el adelanto en AUTO
      // temporalmente para verificar el crédito sin simular la aprobación manual.
      const chRow = (await sel("channels", `select=pedidos_config&id=eq.${CH}`))[0];
      const pcBak = JSON.parse(JSON.stringify(chRow.pedidos_config));
      const pc = JSON.parse(JSON.stringify(chRow.pedidos_config)); pc.adelanto = pc.adelanto || {}; pc.adelanto.validacion = "auto";
      await patch("channels", `id=eq.${CH}`, { pedidos_config: pc });
      try {
        const wa = "519990000013";
        await send(wa, N(wa), "hola quiero las zapatillas runner, soy de Cusco"); await sleep(1600);
        await send(wa, N(wa), "un par talla 38 negras, DNI 44556677, " + N(wa) + " Cruz, lo recojo en el Shalom Cusco Parque Industrial"); await sleep(2400);
        await send(wa, N(wa), "el par simple de 129"); await sleep(2200); // fija la opción (2 presentaciones)
        await yape(wa, N(wa), { monto: 129, quien: N(wa), op: "0" + Date.now().toString().slice(-9) }); await sleep(3200);
        const { o } = await order(wa);
        return [
          ck(Number(o?.shipping?.saldo) === 0, `saldo tras pagar el total=${o?.shipping?.saldo} (esperado 0) [FIX adelanto]`),
          ck(o?.shipping?.pagado_total === true, `pagado_total=${o?.shipping?.pagado_total} (esperado true)`),
        ];
      } finally {
        await patch("channels", `id=eq.${CH}`, { pedidos_config: pcBak });
      }
    } },

    { name: "Adelanto mínimo: paga sobre el piso (12, mín 10) → despacha", run: async () => {
      // Con un mínimo aceptable de S/10, pagar S/12 (bajo el adelanto de 20 pero sobre
      // el piso) debe DESPACHAR igual, con el saldo ajustado a lo que falta (117). Se
      // fija el mínimo global + validación auto temporalmente y se restaura al final.
      const chRow = (await sel("channels", `select=entregas,pedidos_config&id=eq.${CH}`))[0];
      const entBak = JSON.parse(JSON.stringify(chRow.entregas)), pcBak = JSON.parse(JSON.stringify(chRow.pedidos_config));
      const ent = JSON.parse(JSON.stringify(chRow.entregas)); ent.adelanto_minimo_default = 10;
      const pc = JSON.parse(JSON.stringify(chRow.pedidos_config)); pc.adelanto = pc.adelanto || {}; pc.adelanto.validacion = "auto";
      await patch("channels", `id=eq.${CH}`, { entregas: ent, pedidos_config: pc });
      try {
        const wa = "519990000014";
        await send(wa, N(wa), "hola quiero las zapatillas runner, soy de Cusco"); await sleep(1600);
        await send(wa, N(wa), "un par talla 38 negras, DNI 44112233, " + N(wa) + " Paz, lo recojo en el Shalom Cusco Parque Industrial"); await sleep(2400);
        await send(wa, N(wa), "el par simple de 129"); await sleep(2200);
        await yape(wa, N(wa), { monto: 12, quien: N(wa), op: "0" + Date.now().toString().slice(-9) }); await sleep(3200);
        const { o } = await order(wa);
        return [
          ck(o?.estado === "adelanto_validado", `estado=${o?.estado} (esperado adelanto_validado con pago sobre el piso) [FIX mínimo]`),
          ck(Number(o?.shipping?.saldo) === 117, `saldo=${o?.shipping?.saldo} (esperado 117 = 129−12)`),
        ];
      } finally {
        await patch("channels", `id=eq.${CH}`, { entregas: entBak, pedidos_config: pcBak });
      }
    } },
  ];

  function report(results) {
    let pass = 0, fail = 0;
    console.log("%c\n═══ REGRESIÓN DE VENTAS ═══", "font-weight:bold;font-size:14px");
    for (const r of results) {
      const okAll = r.checks.every((c) => c.ok); okAll ? pass++ : fail++;
      console.log(`%c${okAll ? "✅ PASS" : "❌ FAIL"}%c  ${r.name}`, `color:${okAll ? "#0a0" : "#c00"};font-weight:bold`, "color:inherit");
      for (const c of r.checks) if (!c.ok) console.log(`      ↳ %c${c.msg}`, "color:#c00");
      for (const c of r.checks) if (c.ok && /FIX/.test(c.msg)) console.log(`      ↳ %c${c.msg}`, "color:#0a0");
    }
    console.log(`%c\n${pass}/${results.length} casos OK` + (fail ? ` · ${fail} FALLARON` : " · todo verde 🎉"), `font-weight:bold;color:${fail ? "#c00" : "#0a0"}`);
    return { pass, fail };
  }

  async function run(opts = {}) {
    if (!CH) throw new Error("No encontré el channelId. Abre el panel logueado.");
    if (!token()) throw new Error("Sin sesión. Recarga el panel logueado.");
    log("Limpiando canal…"); await clean();
    log("Construyendo catálogo…"); const ids = await build();
    log("Generando flujos con el generador real…"); await genFlows(ids);
    log("Corriendo casos (puede tardar ~2-3 min)…");
    const results = [];
    for (const c of CASES) {
      log("· " + c.name);
      try { results.push({ name: c.name, checks: await c.run(ids) }); }
      catch (e) { results.push({ name: c.name, checks: [ck(false, "EXCEPCIÓN: " + (e?.message || e))] }); }
    }
    const summary = report(results);
    if (!opts.keepData) { log("Limpiando…"); await clean(); }
    else log("keepData: los chats quedaron en la Bandeja para inspección.");
    return { results, ...summary };
  }

  window.NodoRegresion = { run, clean, build, genFlows };
  log("Listo. Corre:  await NodoRegresion.run()   ·   (o run({keepData:true}) para dejar los chats en la Bandeja)");
})();
