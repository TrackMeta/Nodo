/* ═══════════════════════════════════════════════════════════════════════════
 * Nodo · SIMULACIÓN COMPLETA de la app  (reusable)
 * ───────────────────────────────────────────────────────────────────────────
 * Hermana de `regresion-ventas.js`. Aquella prueba el MOTOR con aserciones
 * secas y limpia al terminar; ESTA arma una tienda completa y deja en la
 * Bandeja un abanico de chats REALISTAS (nombres distintos, combos distintos,
 * pedidos avanzados por el Kanban) para revisarlos a ojo y cazar bugs de UI,
 * de avisos y de estados que las aserciones no ven.
 *
 * Catálogo: principal físico (con variantes+stock) · extra físico · regalo
 * físico · principal digital (2 planes) · extra digital · regalo digital.
 *
 * CÓMO USARLO
 *   1. Panel logueado en la sección **Productos** (necesita window.__nodoTest).
 *   2. Consola (F12) → pega este archivo.
 *   3. await NodoSim.run();          // deja TODO en la Bandeja
 *      await NodoSim.clean();        // borra el canal
 *
 * OJO: BORRA todos los productos/contactos/flujos del canal activo. Úsalo en
 * un canal sandbox. Si el canal tiene Google Sheets conectado, cada pedido se
 * sincroniza a la hoja (quedan filas de prueba que hay que borrar a mano).
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
  const log = (...a) => { try { (window.__SIM.log ||= []).push(a.join(" ")); } catch (_) {} console.log("%c[sim]", "color:#7A3FF2;font-weight:bold", ...a); };

  const sel = (t, q) => fetch(`${BASE}/rest/v1/${t}?${q}`, { headers: H(true) }).then((r) => r.json());
  const ins = (t, rows) => fetch(`${BASE}/rest/v1/${t}`, { method: "POST", headers: H(true), body: JSON.stringify(rows) }).then((r) => r.json());
  const patch = (t, q, body) => fetch(`${BASE}/rest/v1/${t}?${q}`, { method: "PATCH", headers: H(false), body: JSON.stringify(body) });
  const del = (t, q) => fetch(`${BASE}/rest/v1/${t}?${q}`, { method: "DELETE", headers: H(false) });
  const fn = (name, body) => fetch(`${BASE}/functions/v1/${name}`, { method: "POST", headers: { apikey: ANON, Authorization: "Bearer " + token(), "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

  // ── Driver de conversación ────────────────────────────────────────────────
  const send = (wa, nombre, text, extra = {}) => fn("tmp-sim", { channel_id: CH, wa_id: wa, nombre, text, ...extra });
  // Mueve un pedido por el Kanban (lo que hace el humano desde el panel).
  const mover = (order_id, estado, shipping) => fn("order-update", { order_id, estado, ...(shipping ? { shipping } : {}) });

  // Comprobante Yape sintético (fecha de HOY + el número del canal, si no el
  // Validador lo rechaza por antigüedad o por método).
  async function yape(wa, nombre, { op, monto, quien } = {}) {
    op = op || ("0" + Math.floor(10000000 + Math.random() * 89999999));
    const MES = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sep.", "oct.", "nov.", "dic."];
    const d = new Date();
    const fechaStr = `${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()} - 03:14 pm`;
    const c = document.createElement("canvas"); c.width = 420; c.height = 560; const x = c.getContext("2d");
    x.fillStyle = "#7A3FF2"; x.fillRect(0, 0, 420, 110); x.fillStyle = "#fff"; x.font = "bold 30px Arial"; x.fillText("Yape", 160, 65);
    x.fillStyle = "#f5f5f5"; x.fillRect(0, 110, 420, 450); x.fillStyle = "#111";
    const L = ["¡Yapeaste!", "S/ " + (monto || 0) + ".00", "Para: Rodrigo Flores", "Destino: 977533352", "De: " + (quien || nombre), "N° operación: " + op, fechaStr];
    let y = 170; for (const t of L) { x.font = "18px Arial"; x.fillText(t, 26, y); y += 40; }
    const up = await fn("media-upload", { channel_id: CH, filename: "yape.png", content_type: "image/png", data: c.toDataURL("image/png") });
    if (!up.url) throw new Error("media-upload falló: " + JSON.stringify(up));
    await send(wa, nombre, "", { media: { kind: "image", url: up.url, mime: "image/png", caption: "" } });
    return { op, monto };
  }

  // ── Lecturas ──────────────────────────────────────────────────────────────
  async function contact(wa) { return (await sel("contacts", `select=id,stage,nombre,bot_activo&channel_id=eq.${CH}&wa_id=eq.${wa}`))[0]; }
  async function order(wa) { const c = await contact(wa); if (!c) return { c: null, o: null, all: [] }; const o = await sel("orders", `select=id,estado,amount,shipping,order_bumps&contact_id=eq.${c.id}&order=created_at.desc`); return { c, o: o[0], all: o }; }
  async function outMsgs(wa, n = 8) { const c = await contact(wa); if (!c) return []; const m = await sel("messages", `select=content&contact_id=eq.${c.id}&direction=eq.out&order=ts.desc&limit=${n}`); return m.map((x) => x.content?.text || x.content?.caption || "").reverse(); }
  async function stockOf(pid) { const p = (await sel("products", `select=config&id=eq.${pid}`))[0]; return p?.config?.stock || {}; }

  async function clean() {
    const conts = await sel("contacts", `select=id&channel_id=eq.${CH}`);
    if (conts.length) { const inl = `(${conts.map((c) => c.id).join(",")})`; for (const t of ["messages", "contact_events", "orders", "flow_runs", "conversations", "sequence_subscriptions", "contact_tags", "contact_field_values"]) await del(t, `contact_id=in.${inl}`); await del("contacts", `channel_id=eq.${CH}`); }
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
  // CATÁLOGO — las 6 clases de producto que soporta la app
  //   principal físico (variantes+stock) · extra físico · regalo físico
  //   principal digital (2 planes)       · extra digital · regalo digital
  // ═══════════════════════════════════════════════════════════════════════════
  const ZAP_STOCK0 = { "Talla=38|Color=negro": 12, "Talla=38|Color=blanco": 8, "Talla=39|Color=negro": 10, "Talla=39|Color=blanco": 6, "Talla=40|Color=negro": 5, "Talla=40|Color=blanco": 1 };
  const MED_STOCK0 = { "Talla=s": 8, "Talla=m": 8 };

  async function build() {
    const prods = await ins("products", [
      { channel_id: CH, nombre: "Zapatillas Runner Pro", clase: "principal", tipo: "fisico", config: {
        contexto_producto: "## Sobre el producto\nZapatillas de running ultralivianas (240 g), malla transpirable y suela EVA con retorno de energia. Tallas 38 a 40, en negro o blanco.\n## Garantia\n30 dias por defecto de fabrica. Cambio de talla gratis una vez.\n## Como vender\nConsultivo y en beneficios (comodidad, liviandad, durabilidad). Cierre asumido.",
        costo: 45, empaque: 3, stock_umbral: 3,
        atributos: [
          { nombre: "Talla", clave: "talla", obligatorio: true, valores: "38, 39, 40", ayuda: "", media: [] },
          { nombre: "Color", clave: "color", obligatorio: true, valores: "negro, blanco", ayuda: "", media: [] },
        ],
        stock: { ...ZAP_STOCK0 } } },
      { channel_id: CH, nombre: "Medias Deportivas Pro", clase: "extra", tipo: "fisico", config: {
        costo: 4, empaque: 0, stock_umbral: 3,
        contexto_producto: "## Sobre el producto\nMedias de compresion antiampollas, tallas S y M.",
        atributos: [{ nombre: "Talla", clave: "talla", obligatorio: true, valores: "S, M", ayuda: "", media: [] }],
        stock: { ...MED_STOCK0 } } },
      { channel_id: CH, nombre: "Gorra Runner", clase: "regalo", tipo: "fisico", config: {
        costo: 8, regalo_desc: "Gorra deportiva dry-fit, talla unica.", atributos: [], stock: {} } },
      { channel_id: CH, nombre: "Curso Master de Trading", clase: "principal", tipo: "digital", config: {
        contexto_producto: "## Sobre el producto\nCurso de trading de cero a avanzado, acceso de por vida. El plan Premium suma mentoria grupal semanal.\n## Reglas del precio\nPrecio fijo, dos planes: Basica y Premium. No se regatea." } },
      { channel_id: CH, nombre: "Pack Plantillas Excel", clase: "extra", tipo: "digital", config: {
        contexto_producto: "## Sobre el producto\nPack de plantillas de Excel para gestion de riesgo y bitacora de operaciones." } },
      { channel_id: CH, nombre: "Ebook 10 Errores del Trader", clase: "regalo", tipo: "digital", config: {
        regalo_desc: "Ebook en PDF con los 10 errores que funden cuentas.",
        contexto_producto: "## Sobre el producto\nEbook de regalo: los 10 errores mas caros del trader novato." } },
    ]);
    const KEY = { "Zapatillas Runner Pro": "zap", "Medias Deportivas Pro": "med", "Gorra Runner": "gorra", "Curso Master de Trading": "curso", "Pack Plantillas Excel": "plant", "Ebook 10 Errores del Trader": "ebook" };
    const P = {}; prods.forEach((p) => { P[KEY[p.nombre]] = p.id; });

    const mk = (o) => ({ product_id: o.pid, nombre: o.nombre, orden: o.orden, activo: true, cantidad: o.cantidad ?? 1, precio: o.precio ?? null, costo: o.costo ?? null, descripcion: o.descripcion ?? null, entrega: o.entrega ?? [], entrega_mensaje: o.entrega_mensaje ?? null, price_list: [], drive_link: null });
    const vs = await ins("product_versions", [
      mk({ pid: P.zap, nombre: "1 par", orden: 0, cantidad: 1, precio: 129, costo: 45, descripcion: "Un par" }),
      // OJO: el costo de una presentación es POR UNIDAD (el motor lo multiplica por
      // `cantidad`). Acá iba 90 pensando que era el costo total del pack, y el pedido
      // registraba 180 de COGS — el margen del pack salía por el piso.
      mk({ pid: P.zap, nombre: "Pack 2 pares", orden: 1, cantidad: 2, precio: 230, costo: 45, descripcion: "Dos pares (ahorras S/ 28)" }),
      mk({ pid: P.med, nombre: "Unica", orden: 0, cantidad: 1, precio: 19, costo: 4 }),
      mk({ pid: P.gorra, nombre: "Unica", orden: 0, cantidad: 1, precio: null, costo: 8 }),
      mk({ pid: P.curso, nombre: "Basica", orden: 0, cantidad: 1, precio: 99, costo: 0, descripcion: "Modulos 1 al 5", entrega: [{ tipo: "link", url: "https://nodo.demo/basica", nombre: "Acceso Basico", mensaje: "" }], entrega_mensaje: "Listo! Aqui tienes tu acceso Basico:" }),
      mk({ pid: P.curso, nombre: "Premium", orden: 1, cantidad: 1, precio: 199, costo: 0, descripcion: "Todo + mentoria semanal", entrega: [{ tipo: "link", url: "https://nodo.demo/premium", nombre: "Acceso Premium", mensaje: "" }, { tipo: "link", url: "https://nodo.demo/mentoria", nombre: "Mentoria", mensaje: "Y este es el grupo de mentoria:" }], entrega_mensaje: "Bienvenido a Premium! Todo tu acceso:" }),
      mk({ pid: P.plant, nombre: "Unica", orden: 0, cantidad: 1, precio: 49, costo: 0, entrega: [{ tipo: "link", url: "https://nodo.demo/plantillas", nombre: "Plantillas", mensaje: "" }], entrega_mensaje: "Listo! Tus plantillas:" }),
      mk({ pid: P.ebook, nombre: "Unica", orden: 0, cantidad: 1, precio: null, costo: 0, entrega: [{ tipo: "link", url: "https://nodo.demo/ebook-10-errores", nombre: "Ebook de regalo", mensaje: "" }], entrega_mensaje: "Y tu ebook de regalo:" }),
    ]);
    const V = {}; vs.forEach((v) => { const pk = Object.keys(P).find((k) => P[k] === v.product_id); V[pk + ":" + v.nombre] = v.id; });

    // Enganchar extra + regalo en el PRINCIPAL FISICO.
    //   extras_momento "antes"     -> en Lima ofrece el extra antes de cerrar
    //   extras_prov_momento "post" -> en provincia lo ofrece DESPUES del adelanto
    const zc = (await sel("products", `select=config&id=eq.${P.zap}`))[0].config;
    zc.extras = [{ version_id: V["med:Unica"], mensaje: "Le sumas las Medias Deportivas Pro por S/ 19? Van perfectas con las zapatillas." }];
    zc.extras_momento = "antes"; zc.extras_prov_momento = "post"; zc.extras_seguir = false;
    zc.regalos = [{ version_id: V["gorra:Unica"], product_id: P.gorra, nombre: "Gorra Runner de regalo", tipo: "fisico" }];
    zc.regalo_mencionar = true;
    await patch("products", `id=eq.${P.zap}`, { config: zc });

    // Enganchar extra + regalo DIGITALES en el PRINCIPAL DIGITAL.
    const cc = (await sel("products", `select=config&id=eq.${P.curso}`))[0].config;
    cc.extras = [{ version_id: V["plant:Unica"], mensaje: "Le sumas el Pack de Plantillas Excel por S/ 49? Es lo que uso para llevar mi bitacora." }];
    cc.extras_momento = "despues"; cc.extras_seguir = false;
    cc.regalos = [{ version_id: V["ebook:Unica"], product_id: P.ebook, nombre: "Ebook 10 Errores del Trader", tipo: "digital" }];
    cc.regalo_mencionar = true;
    await patch("products", `id=eq.${P.curso}`, { config: cc });

    // Mensajes iniciales + keyword trigger por principal.
    const uuid = () => crypto.randomUUID();
    async function iniciales(pid, nombre, greet, kws) {
      const f = (await ins("flows", { channel_id: CH, product_id: pid, kind: "flow", role: "mensajes_iniciales", nombre: "Mensajes iniciales - " + nombre, estado: "activo" }))[0];
      await ins("flow_nodes", { flow_id: f.id, tipo: "rotador", nombre: "Mensajes iniciales", es_inicial: true, config: { activo: true, variantes: [{ id: uuid(), nombre: "A", activo: true, peso: 1, bubbles: [{ text: greet }] }], despues: { modo: "nada" } }, pos_x: 80, pos_y: 80 });
      await ins("flow_triggers", { channel_id: CH, flow_id: f.id, tipo: "keyword", config: { keywords: kws }, activo: true });
    }
    await iniciales(P.zap, "Zapatillas Runner Pro", "Hola! Gracias por escribir por las *Zapatillas Runner Pro*. Te cuento precios, tallas y colores?", ["zapatillas", "zapatilla", "runner"]);
    await iniciales(P.curso, "Curso Master de Trading", "Hola! Gracias por tu interes en el *Curso Master de Trading*. Te cuento los planes?", ["curso", "trading"]);

    return { P, V };
  }

  // Genera los flujos de venta con el generador REAL del panel.
  async function genFlows(ids) {
    if (!window.__nodoTest) throw new Error("Falta window.__nodoTest - abre el panel en Productos y recarga.");
    for (const pid of [ids.P.zap, ids.P.curso]) {
      const wantIni = (await sel("flows", `select=id&channel_id=eq.${CH}&product_id=eq.${pid}&role=eq.mensajes_iniciales`))[0]?.id;
      window.__nodoTest.getSt().receta = null;
      window.__nodoTest.getSt().extraCat = null;
      await window.__nodoTest.openProduct(pid);
      for (let i = 0; i < 80; i++) { const s = window.__nodoTest.getSt(); if (s?.prod?.id === pid && s?.receta?.fIni?.id === wantIni) break; await sleep(150); }
      await sleep(300);
      await window.__nodoTest.genVenta();
      await sleep(600);
      // 🔴 Verificar que el flujo quedó COMPLETO antes de pasar al siguiente producto.
      // Sin esto la generación se cortaba a medias y NADIE se enteraba: al Curso le
      // faltaron las 4 últimas aristas —entre ellas «Registrar la venta → Entregar el
      // producto»—, así que el cliente pagaba, la venta se registraba y el acceso NUNCA
      // salía. Los tres escenarios digitales fallaron por eso y parecía un bug del motor;
      // el motor estaba bien. Un nodo sin salida (que no sea Fin) = flujo a medias.
      for (let intento = 1; intento <= 3; intento++) {
        const fv = (await sel("flows", `select=id&channel_id=eq.${CH}&product_id=eq.${pid}&role=eq.venta`))[0]?.id;
        if (!fv) { await sleep(1200); continue; }
        const nn = await sel("flow_nodes", `select=id,nombre&flow_id=eq.${fv}`);
        const ee = await sel("flow_edges", `select=source_node&flow_id=eq.${fv}`);
        const conSalida = new Set((ee || []).map((x) => x.source_node));
        const huerfanos = (nn || []).filter((x) => !/^Fin/.test(x.nombre || "") && !conSalida.has(x.id));
        if (!huerfanos.length) break;
        log(`⚠️ flujo incompleto (${huerfanos.map((h) => h.nombre).join(", ")}) — regenerando (intento ${intento})`);
        await window.__nodoTest.genVenta();
        await sleep(2500);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ESCENARIOS — cada uno es un CHAT que queda en la Bandeja.
  //   `checks` son aserciones duras (PASS/FAIL); `nota` es observación a ojo.
  // ═══════════════════════════════════════════════════════════════════════════
  const ck = (ok, msg) => ({ ok: !!ok, msg });
  const tieneLink = (outs, re) => outs.some((m) => re.test(m || ""));

  const ESCENARIOS = [

    // ─── FÍSICO · LIMA ──────────────────────────────────────────────────────
    { id: "L1", wa: "51987000101", nombre: "Lucia Ramirez",
      titulo: "Lima · principal solo + regalo → ciclo completo hasta ENTREGADO",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola vi el anuncio de las zapatillas runner"); await sleep(1500);
        await send(wa, nombre, "cuanto cuestan? tienen talla 38?"); await sleep(2500);
        await send(wa, nombre, "ya, quiero un par talla 38 negras"); await sleep(2500);
        await send(wa, nombre, "Lucia Ramirez, Lima, Miraflores, Av Larco 100, dpto 502"); await sleep(2500);
        await send(wa, nombre, "si confirmo"); await sleep(2800);
        await send(wa, nombre, "no gracias, asi esta bien"); await sleep(2500); // declina el extra
        const { o } = await order(wa);
        const bump = (o?.order_bumps || []).find((b) => b.regalo);
        const checks = [
          ck(o?.estado === "confirmado", `estado=${o?.estado} (esperado confirmado)`),
          ck(Number(o?.amount) === 129, `amount=${o?.amount} (esperado 129)`),
          ck(o?.shipping?.zona === "lima", `zona=${o?.shipping?.zona} (esperado lima)`),
          ck(bump && Number(bump.precio) === 0, `regalo adjunto a S/0 (precio=${bump?.precio})`),
        ];
        // El humano mueve la tarjeta: salió el motorizado y luego cobró.
        if (o?.id) {
          await mover(o.id, "en_reparto"); await sleep(2500);
          await mover(o.id, "entregado_cobrado"); await sleep(2500);
          const { o: o2, c } = await order(wa);
          checks.push(ck(o2?.estado === "entregado_cobrado", `estado final=${o2?.estado} (esperado entregado_cobrado)`));
          checks.push(ck(c?.stage === "comprado", `etapa del contacto=${c?.stage} (esperado comprado)`));
        }
        return checks;
      } },

    { id: "L2", wa: "51987000102", nombre: "Carlos Medina",
      titulo: "Lima · principal + EXTRA físico aceptado → en reparto",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        const med0 = await stockOf(ids.P.med);
        await send(wa, nombre, "hola quiero las zapatillas runner"); await sleep(1500);
        await send(wa, nombre, "un par talla 39 negras"); await sleep(2500);
        await send(wa, nombre, "Carlos Medina, Lima, San Isidro, Av Aramburu 120"); await sleep(2500);
        await send(wa, nombre, "si confirmo"); await sleep(2800);
        await send(wa, nombre, "si dale, agregame las medias tambien"); await sleep(2500);
        await send(wa, nombre, "talla M"); await sleep(3000);
        const { o } = await order(wa);
        const medBump = (o?.order_bumps || []).find((b) => /medias/i.test(b.nombre || ""));
        let med1 = await stockOf(ids.P.med);
        for (let i = 0; i < 6 && med1["Talla=m"] === med0["Talla=m"]; i++) { await sleep(1500); med1 = await stockOf(ids.P.med); }
        const checks = [
          ck(medBump && Number(medBump.precio) === 19, `extra medias en el pedido a S/19 (precio=${medBump?.precio})`),
          // En Lima el saldo no se usa: la puerta cobra amount + bumps (engine.ts,
          // "la puerta cobra amount+bumps"). Así que amount se queda en 129 a
          // propósito y el extra viaja en order_bumps — el total es la SUMA.
          ck(Number(o?.amount) + (o?.order_bumps || []).reduce((a, b) => a + Number(b.precio || 0), 0) === 148,
             `total a cobrar en la puerta = amount ${o?.amount} + bumps ${(o?.order_bumps || []).reduce((a, b) => a + Number(b.precio || 0), 0)} (esperado 148)`),
          ck(med1["Talla=m"] === med0["Talla=m"] - 1, `stock medias M ${med0["Talla=m"]}→${med1["Talla=m"]} (esperado -1)`),
        ];
        if (o?.id) { await mover(o.id, "en_reparto"); await sleep(2000); }
        return checks;
      } },

    { id: "L3", wa: "51987000103", nombre: "Andrea Solis",
      titulo: "Lima · PACK 2 pares (cantidad 2, stock -2)",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        const st0 = await stockOf(ids.P.zap);
        await send(wa, nombre, "hola quiero las zapatillas runner"); await sleep(1500);
        await send(wa, nombre, "hay descuento si llevo dos pares?"); await sleep(2500);
        await send(wa, nombre, "ya, el pack de 2 pares, ambas talla 39 negras"); await sleep(2500);
        await send(wa, nombre, "Andrea Solis, Lima, Surco, Av Primavera 200"); await sleep(2500);
        await send(wa, nombre, "si confirmo"); await sleep(2800);
        const { o } = await order(wa); const st1 = await stockOf(ids.P.zap);
        return [
          ck(Number(o?.amount) === 230, `amount=${o?.amount} (esperado 230)`),
          ck(o?.shipping?.opcion === "Pack 2 pares", `opcion=${o?.shipping?.opcion}`),
          ck(st1["Talla=39|Color=negro"] === st0["Talla=39|Color=negro"] - 2, `stock 39 negro ${st0["Talla=39|Color=negro"]}→${st1["Talla=39|Color=negro"]} (esperado -2)`),
        ];
      } },

    { id: "L4", wa: "51987000104", nombre: "Diego Paredes",
      titulo: "Lima · declina el extra → el bot ACUSA (no dead-air)",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero las zapatillas runner"); await sleep(1500);
        await send(wa, nombre, "un par talla 38 negras"); await sleep(2500);
        await send(wa, nombre, "Diego Paredes, Lima, Lince, Av Arenales 100"); await sleep(2500);
        await send(wa, nombre, "si confirmo"); await sleep(2800);
        const antes = (await outMsgs(wa, 1))[0] || "";
        await send(wa, nombre, "no gracias, solo las zapatillas"); await sleep(2800);
        const outs = await outMsgs(wa, 2); const ultimo = outs[outs.length - 1] || "";
        return [ck(ultimo && ultimo !== antes, `el bot respondió al "no gracias": "${(ultimo || "SILENCIO").slice(0, 60)}"`)];
      } },

    // ─── FÍSICO · PROVINCIA ─────────────────────────────────────────────────
    { id: "P1", wa: "51987000105", nombre: "Josue Quispe",
      titulo: "Provincia · CICLO COMPLETO: adelanto → guía → agencia → saldo → clave → recogido",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola, las zapatillas runner llegan a Trujillo?"); await sleep(2000);
        await send(wa, nombre, "un par talla 38 negras"); await sleep(2500);
        await send(wa, nombre, "Josue Quispe Mamani, DNI 44556677, lo recojo en el Shalom de Trujillo Parque Industrial"); await sleep(3000);
        const a = await order(wa);
        const checks = [
          ck(a.o?.estado === "esperando_adelanto", `estado=${a.o?.estado} (esperado esperando_adelanto)`),
          ck(a.o?.shipping?.zona === "provincia", `zona=${a.o?.shipping?.zona} (esperado provincia)`),
        ];
        // 1) El cliente yapea el adelanto → queda POR VALIDAR (canal en manual).
        await yape(wa, nombre, { monto: 20, quien: nombre, op: "0" + Date.now().toString().slice(-9) }); await sleep(3500);
        const b = await order(wa);
        checks.push(ck(!!b.o?.shipping?.adelanto_comprobante || !!b.o?.shipping?.adelanto, `se adjuntó el comprobante del adelanto`));
        // 2) Rodrigo lo aprueba a mano.
        if (b.o?.id) {
          await mover(b.o.id, "adelanto_validado"); await sleep(2500);
          // 3) Despacho: guía + clave de recojo.
          await mover(b.o.id, "despachado", { guia: "SHLM-2026-0501", clave_recojo: "R-4821", sede: "Shalom Trujillo Parque Industrial" }); await sleep(2500);
          // 4) Llegó a la agencia.
          await mover(b.o.id, "en_agencia"); await sleep(2500);
          const c1 = await order(wa);
          checks.push(ck(c1.o?.estado === "en_agencia", `estado tras despacho=${c1.o?.estado} (esperado en_agencia)`));
          const saldoEsperado = Number(c1.o?.shipping?.saldo ?? 109);
          // 5) El cliente yapea el SALDO → debe adjuntarse y salir "Aprobar y dar clave".
          await yape(wa, nombre, { monto: saldoEsperado, quien: nombre, op: "0" + Date.now().toString().slice(-9) }); await sleep(3500);
          const c2 = await order(wa);
          checks.push(ck(!!c2.o?.shipping?.saldo_comprobante, `se adjuntó el comprobante del SALDO (no el del adelanto)`));
          // 6) Rodrigo aprueba el saldo → sale la clave.
          await mover(c2.o.id, "saldo_pagado"); await sleep(3000);
          const outs = await outMsgs(wa, 6);
          checks.push(ck(tieneLink(outs, /R-4821/), `le llegó la CLAVE de recojo al cliente`));
          // 7) Recogió.
          await mover(c2.o.id, "recogido"); await sleep(2500);
          const c3 = await order(wa);
          checks.push(ck(c3.o?.estado === "recogido", `estado final=${c3.o?.estado} (esperado recogido)`));
        }
        return checks;
      } },

    { id: "P2", wa: "51987000106", nombre: "Diana Chavez",
      titulo: "Provincia · COMBO principal + regalo + EXTRA post-adelanto → despachado",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero las zapatillas runner, soy de Arequipa"); await sleep(2000);
        await send(wa, nombre, "un par talla 39 negras"); await sleep(2500);
        await send(wa, nombre, "Diana Chavez Rojas, DNI 47881122, agencia Shalom de Arequipa Av Ejercito"); await sleep(3000);
        await yape(wa, nombre, { monto: 20, quien: nombre, op: "0" + Date.now().toString().slice(-9) }); await sleep(3500);
        const a = await order(wa);
        const checks = [ck(a.o?.shipping?.zona === "provincia", `zona=${a.o?.shipping?.zona}`)];
        if (a.o?.id) { await mover(a.o.id, "adelanto_validado"); await sleep(3000); }
        // Tras validar el adelanto, en provincia se ofrece el extra (extras_prov_momento=post).
        await send(wa, nombre, "si, agregame las medias talla S tambien"); await sleep(3000);
        const b = await order(wa);
        const medBump = (b.o?.order_bumps || []).find((x) => /medias/i.test(x.nombre || ""));
        const regalo = (b.o?.order_bumps || []).find((x) => x.regalo);
        checks.push(ck(!!regalo, `lleva el regalo adjunto`));
        checks.push(ck(!!medBump, `aceptó el EXTRA después del adelanto (bump=${medBump?.nombre || "NINGUNO"})`));
        if (b.o?.id) { await mover(b.o.id, "despachado", { guia: "SHLM-2026-0502", clave_recojo: "R-7733", sede: "Shalom Arequipa Av Ejercito" }); await sleep(2500); }
        return checks;
      } },

    { id: "P3", wa: "51987000107", nombre: "Marco Vilchez",
      titulo: "Provincia · sede VAGA → bandera sede_por_confirmar, queda esperando adelanto",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola, mandan las zapatillas runner a Piura?"); await sleep(2000);
        await send(wa, nombre, "si, un par talla 40 negras, DNI 41234567, Marco Vilchez Luna, en la agencia Shalom de Piura pero no se cual oficina"); await sleep(3000);
        const { o } = await order(wa);
        return [
          ck(o?.estado === "esperando_adelanto", `estado=${o?.estado} (esperado esperando_adelanto)`),
          ck(o?.shipping?.zona === "provincia", `zona=${o?.shipping?.zona}`),
          ck(!!o?.shipping?.sede_por_confirmar, `bandera sede_por_confirmar=${o?.shipping?.sede_por_confirmar || "NO LEVANTADA"}`),
        ];
      } },

    { id: "P4", wa: "51987000108", nombre: "Rosa Ttito",
      titulo: "Provincia · paga el TOTAL como adelanto → saldo 0, nada que cobrar en agencia",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero las zapatillas runner, soy de Cusco"); await sleep(2000);
        await send(wa, nombre, "un par talla 38 negras, DNI 46778899, Rosa Ttito Huaman, Shalom Cusco Parque Industrial"); await sleep(3000);
        await yape(wa, nombre, { monto: 129, quien: nombre, op: "0" + Date.now().toString().slice(-9) }); await sleep(3500);
        const { o } = await order(wa);
        const checks = [ck(o?.shipping?.zona === "provincia", `zona=${o?.shipping?.zona}`)];
        if (o?.id) {
          await mover(o.id, "adelanto_validado"); await sleep(3000);
          const b = await order(wa);
          checks.push(ck(Number(b.o?.shipping?.saldo) === 0, `saldo tras pagar el total=${b.o?.shipping?.saldo} (esperado 0)`));
          checks.push(ck(b.o?.shipping?.pagado_total === true, `pagado_total=${b.o?.shipping?.pagado_total} (esperado true)`));
        }
        return checks;
      } },

    // ─── DIGITAL ────────────────────────────────────────────────────────────
    { id: "D1", wa: "51987000109", nombre: "Kevin Rios",
      titulo: "Digital · plan Básica S/99 → entrega link + REGALO digital (ebook)",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola vi el curso de trading, que incluye?"); await sleep(2000);
        await send(wa, nombre, "cuanto cuesta la basica?"); await sleep(2500);
        await send(wa, nombre, "ya, quiero la basica, pasame el yape"); await sleep(2500);
        const op = "0" + Date.now().toString().slice(-9);
        window.__SIM.opKevin = op; // se reusa en el caso antifraude
        await yape(wa, nombre, { monto: 99, quien: nombre, op }); await sleep(4000);
        const { o } = await order(wa); const outs = await outMsgs(wa, 10);
        return [
          ck(Number(o?.amount) === 99, `amount=${o?.amount} (esperado 99)`),
          ck(tieneLink(outs, /nodo\.demo\/basica/), `entregó el link de la Básica`),
          ck(tieneLink(outs, /ebook-10-errores/), `entregó el REGALO digital (ebook)`),
        ];
      } },

    { id: "D2", wa: "51987000110", nombre: "Melissa Cardenas",
      titulo: "Digital · plan Premium S/199 → 2 links + regalo",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero el curso de trading"); await sleep(2000);
        await send(wa, nombre, "cual es la diferencia entre basica y premium?"); await sleep(2500);
        await send(wa, nombre, "quiero la premium"); await sleep(2500);
        await send(wa, nombre, "ya te yapeo"); await sleep(2500);
        // ANUNCIAR el pago no es pagar. Antes de que llegue la captura, el bot NO puede
        // decir "ya lo recibí" ni prometer el acceso: el cliente puede no pagar nunca, y
        // encima el sistema lo contradice un turno después ("estoy verificando tu pago").
        const antesDelComprobante = (await outMsgs(wa, 2)).join(" ");
        await yape(wa, nombre, { monto: 199, quien: nombre, op: "0" + Date.now().toString().slice(-9) }); await sleep(4000);
        const { o } = await order(wa); const outs = await outMsgs(wa, 12);
        return [
          ck(!/ya lo recib|ya confirm|recibí tu pago|pago confirmado|gracias por el pago/i.test(antesDelComprobante),
             `no dio por recibido un pago que aún no veía: "${antesDelComprobante.slice(-90)}"`),
          ck(Number(o?.amount) === 199, `amount=${o?.amount} (esperado 199)`),
          ck(tieneLink(outs, /nodo\.demo\/premium/), `entregó el link Premium`),
          ck(tieneLink(outs, /nodo\.demo\/mentoria/), `entregó el link de Mentoría`),
        ];
      } },

    { id: "D3", wa: "51987000111", nombre: "Ivan Torres",
      titulo: "Digital · Premium + EXTRA DIGITAL aceptado (paga aparte S/49 → link del extra)",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero el curso de trading premium"); await sleep(2500);
        await send(wa, nombre, "si, pasame el yape"); await sleep(2000);
        await yape(wa, nombre, { monto: 199, quien: nombre, op: "0" + Date.now().toString().slice(-9) }); await sleep(4000);
        const outs1 = await outMsgs(wa, 10); const a = await order(wa);
        const checks = [
          ck(tieneLink(outs1, /nodo\.demo\/premium/), `entregó el Premium que PAGÓ`),
          // El pedido debe valer lo que pagó. Si nace en S/0 con `vuelto`=lo pagado,
          // es que la opción no se selló: venta fantasma y cliente sin producto.
          ck(Number(a.o?.amount) === 199, `el pedido vale lo pagado (amount=${a.o?.amount}, vuelto=${a.o?.shipping?.vuelto ?? "—"})`),
        ];
        // Tras entregar, ofrece el extra digital (extras_momento = "despues").
        await send(wa, nombre, "si, dale, sumame el pack de plantillas"); await sleep(3500);
        const outs2 = await outMsgs(wa, 6);
        checks.push(ck(outs2.some((m) => /49/.test(m || "")), `le pidió el pago del extra (S/49): "${(outs2[outs2.length - 1] || "").slice(0, 60)}"`));
        await yape(wa, nombre, { monto: 49, quien: nombre, op: "0" + Date.now().toString().slice(-9) }); await sleep(4000);
        const outs3 = await outMsgs(wa, 8); const { o } = await order(wa);
        const plantBump = (o?.order_bumps || []).find((x) => /plantilla/i.test(x.nombre || ""));
        checks.push(ck(!!plantBump, `el extra digital quedó en el pedido (bump=${plantBump?.nombre || "NINGUNO"})`));
        checks.push(ck(tieneLink(outs3, /nodo\.demo\/plantillas/), `entregó el link del EXTRA digital`));
        return checks;
      } },

    { id: "D4", wa: "51987000112", nombre: "Pedro Ayala",
      titulo: "Digital · paga de MENOS (S/50 de 99) → NO debe entregar, debe pedir la diferencia",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero el curso de trading basica"); await sleep(2500);
        await send(wa, nombre, "ya te yapeo"); await sleep(2000);
        await yape(wa, nombre, { monto: 50, quien: nombre, op: "0" + Date.now().toString().slice(-9) }); await sleep(4000);
        const outs = await outMsgs(wa, 8); const { o } = await order(wa);
        return [
          ck(!tieneLink(outs, /nodo\.demo\/basica/), `NO entregó el acceso con un pago incompleto`),
          // OJO: no basta con "mencionó un número". Un pago incompleto NO debe dejar el
          // pedido como venta cerrada — y menos en S/0 (señal de que la opción no se
          // resolvió y el motor tomó lo pagado como `vuelto`).
          ck(o?.estado !== "confirmada", `el pedido NO quedó cerrado como venta (estado=${o?.estado})`),
          // Desde que `detectarOpcion` mira el HISTORIAL y no solo el último mensaje, el
          // "basica" del primer mensaje SÍ se sella → hay precio esperado (99) → el pago
          // corto entra como ABONO PARCIAL y no nace pedido hasta cubrirlo. Antes no se
          // sabía qué había comprado y se parqueaba un pedido 'pendiente' para revisión.
          // Por eso ya no se exige que exista pedido: se exige que, si existe, no sea S/0.
          ck(!o || Number(o.amount) > 0, `si hay pedido, NO nació en S/0 (amount=${o?.amount}, vuelto=${o?.shipping?.vuelto ?? "—"})`),
          // Y lo que de verdad importa para el cliente: que le digan cuánto le falta, en vez
          // de dejarlo esperando una entrega que no va a llegar.
          ck(/falta/i.test(outs.join(" ")), `le dijo cuánto falta: "${(outs[outs.length - 1] || "SILENCIO").slice(0, 70)}"`),
          ck(!!(outs[outs.length - 1]), `acusó recibo, no quedó mudo: "${(outs[outs.length - 1] || "SILENCIO").slice(0, 70)}"`),
        ];
      } },

    // ─── BORDE / ANTIFRAUDE ─────────────────────────────────────────────────
    { id: "X1", wa: "51987000113", nombre: "Sandra Loayza",
      titulo: "Antifraude · REUSA el N° de operación de otro cliente → debe rechazar",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero el curso de trading basica"); await sleep(2500);
        await send(wa, nombre, "ya te paso el yape"); await sleep(2000);
        const opRobado = window.__SIM.opKevin || "012345678";
        await yape(wa, nombre, { monto: 99, quien: nombre, op: opRobado }); await sleep(4000);
        const outs = await outMsgs(wa, 8);
        return [
          ck(!tieneLink(outs, /nodo\.demo\/basica/), `NO entregó el acceso con una operación ya usada (op ${opRobado})`),
          ck(outs.some((m) => /ya se us|ya (fue|esta|está) (usad|registrad)|otro pago|no pude validar|no coincide|revis|verific/i.test(m || "")), `avisó del reúso: "${(outs[outs.length - 1] || "SILENCIO").slice(0, 70)}"`),
        ];
      } },

    { id: "X2", wa: "51987000114", nombre: "Bruno Effio",
      titulo: "Stock · compra la ÚLTIMA talla 40 blanca (stock 1 → 0)",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero las zapatillas runner"); await sleep(1500);
        await send(wa, nombre, "un par talla 40 blancas"); await sleep(2500);
        await send(wa, nombre, "Bruno Effio, Lima, Barranco, Av Grau 300"); await sleep(2500);
        await send(wa, nombre, "si confirmo"); await sleep(3000);
        const st = await stockOf(ids.P.zap);
        return [ck(st["Talla=40|Color=blanco"] === 0, `stock 40 blanco quedó en ${st["Talla=40|Color=blanco"]} (esperado 0)`)];
      } },

    { id: "X3", wa: "51987000115", nombre: "Nadia Quiroz",
      titulo: "Stock · pide la talla AGOTADA (40 blanca) → no debe sobrevender",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero las zapatillas runner"); await sleep(1500);
        await send(wa, nombre, "quiero un par talla 40 blancas"); await sleep(3000);
        await send(wa, nombre, "Nadia Quiroz, Lima, Jesus Maria, Av Brasil 500"); await sleep(2500);
        await send(wa, nombre, "si confirmo"); await sleep(3000);
        const st = await stockOf(ids.P.zap); const { o } = await order(wa); const outs = await outMsgs(wa, 8);
        const atr = o?.shipping?.atributos || {};
        return [
          // El stock nunca debe irse a negativo por vender lo agotado.
          ck(st["Talla=40|Color=blanco"] >= 0, `stock 40 blanco = ${st["Talla=40|Color=blanco"]} (NUNCA debe ser negativo)`),
          // El bot tiene que DECIRLO, no venderlo callado.
          ck(outs.some((m) => /agotad|sin stock|no me queda|se acab/i.test(m || "")), `avisó que estaba agotada`),
          // Y si el cliente acepta la alternativa, el pedido debe salir con ESA
          // (si no, promete negro y despacha blanco).
          ck(!o || String(atr.Color || "").toLowerCase().startsWith("negr"), `el pedido salió con la variante acordada (Color=${atr.Color ?? "—"}, Talla=${atr.Talla ?? "—"})`),
        ];
      } },

    { id: "X4", wa: "51987000116", nombre: "Milagros Paz",
      titulo: "Prospecto · pregunta y no compra → queda interesado, sin pedido",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola las zapatillas runner son originales? que garantia tienen?"); await sleep(2500);
        await send(wa, nombre, "y sirven para correr en cerro?"); await sleep(2500);
        await send(wa, nombre, "ah ya, lo voy a pensar, gracias"); await sleep(2500);
        const { c, o } = await order(wa);
        return [
          ck(c?.stage === "interesado" || c?.stage === "caliente", `etapa=${c?.stage} (esperado interesado/caliente)`),
          ck(!o, `sin pedido creado (${o ? "SE CREÓ UNO" : "ninguno"})`),
        ];
      } },

    { id: "X5", wa: "51987000117", nombre: "Elena Vargas",
      titulo: "Escalada · pide hablar con una persona → debe pasar a humano",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola tengo un problema con un pedido anterior"); await sleep(2500);
        await send(wa, nombre, "quiero hablar con una persona de verdad, no con un bot"); await sleep(3000);
        const c = await contact(wa); const outs = await outMsgs(wa, 4);
        return [
          ck(true, `[observar] bot_activo=${c?.bot_activo} etapa=${c?.stage} — último: "${(outs[outs.length - 1] || "SILENCIO").slice(0, 70)}"`),
          ck(!!(outs[outs.length - 1]), `no quedó mudo ante la escalada`),
        ];
      } },

    { id: "X6", wa: "51987000118", nombre: "Raul Cabrera",
      titulo: "Post-venta · compra en Lima y luego pregunta por su pedido (no debe re-vender)",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero las zapatillas runner"); await sleep(1500);
        await send(wa, nombre, "un par talla 38 blancas"); await sleep(2500);
        await send(wa, nombre, "Raul Cabrera, Lima, Pueblo Libre, Av La Marina 800"); await sleep(2500);
        await send(wa, nombre, "si confirmo"); await sleep(2800);
        await send(wa, nombre, "no gracias"); await sleep(2500);
        const { o } = await order(wa);
        const checks = [ck(o?.estado === "confirmado", `estado=${o?.estado} (esperado confirmado)`)];
        if (o?.id) { await mover(o.id, "en_reparto"); await sleep(2500); }
        // Post-venta: pregunta por el pedido ya hecho.
        await send(wa, nombre, "oye y cuando me llega mi pedido?"); await sleep(3000);
        const outs = await outMsgs(wa, 4);
        const { all } = await order(wa);
        checks.push(ck(all.length === 1, `siguió con UN solo pedido (tiene ${all.length}) — no abrió otra venta`));
        checks.push(ck(!!(outs[outs.length - 1]), `respondió la consulta post-venta: "${(outs[outs.length - 1] || "SILENCIO").slice(0, 70)}"`));
        return checks;
      } },

    // ═════ NUEVOS (2026-08-27) · caminos que ningún escenario cubría ═════════
    { id: "N1", wa: "51987000119", nombre: "Paola Nunez",
      titulo: "Recepción con IA · escribe sin palabra clave → la IA lo rutea al producto",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola buenas tardes"); await sleep(3000);
        const r1 = (await outMsgs(wa, 2)).join(" ");
        await send(wa, nombre, "queria ver unas zapatillas para correr"); await sleep(3500);
        const outs = await outMsgs(wa, 6); const todo = outs.join(" ");
        const { c } = await order(wa);
        return [
          ck(!!r1.trim(), `contestó al saludo sin palabra clave: "${(r1 || "SILENCIO").slice(0, 70)}"`),
          ck(/runner|zapatilla/i.test(todo), `llegó al producto correcto (menciona las zapatillas)`),
          ck(!/(no s[eé] (de )?qu[eé]|no entiendo|no tengo esa informaci)/i.test(todo), `no se rindió con un "no sé"`),
          ck(!!c, `quedó el contacto en la Bandeja`),
        ];
      } },

    { id: "N2", wa: "51987000120", nombre: "Hugo Bravo",
      titulo: "Zona ambigua · dice que es de Lima pero la dirección es Huancayo → debe ser PROVINCIA",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero las zapatillas runner"); await sleep(1500);
        await send(wa, nombre, "soy de Lima, un par talla 39 negras"); await sleep(2500);
        await send(wa, nombre, "Hugo Bravo Rojas, DNI 41223344, en realidad estoy en Huancayo, lo recojo en el Shalom de Huancayo Real"); await sleep(3200);
        const { o } = await order(wa); const outs = (await outMsgs(wa, 5)).join(" ");
        return [
          ck(o?.shipping?.zona === "provincia", `zona=${o?.shipping?.zona} (esperado provincia — la ciudad manda)`),
          ck(o?.estado === "esperando_adelanto", `estado=${o?.estado} (esperado esperando_adelanto)`),
          ck(!/contraentrega|pagas al recibir/i.test(outs), `no le prometió contraentrega de Lima`),
        ];
      } },

    { id: "N3", wa: "51987000121", nombre: "Cecilia Ortiz",
      titulo: "Pregunta fuera de ficha · ni la niega ni la inventa, y sigue vendiendo",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero las zapatillas runner"); await sleep(1500);
        await send(wa, nombre, "vienen con certificado de originalidad y factura con RUC?"); await sleep(3500);
        const outs = await outMsgs(wa, 4); const r = outs[outs.length - 1] || "";
        await send(wa, nombre, "ya, un par talla 38 negras"); await sleep(2500);
        await send(wa, nombre, "Cecilia Ortiz, Lima, Jesus Maria, Av Salaverry 500"); await sleep(2500);
        await send(wa, nombre, "si confirmo"); await sleep(2800);
        const { o } = await order(wa);
        return [
          ck(!/^(no|lamentablemente no|no incluye|no contamos|no manejamos)/i.test(r.trim()), `no arrancó negando: "${r.slice(0, 80)}"`),
          ck(!/(s[ií],? (incluye|viene con) (certificado|factura))/i.test(r), `no prometió certificado/factura que no están en la ficha`),
          ck(!!r.trim(), `contestó algo (no dead-air)`),
          ck(o?.estado === "confirmado", `la venta igual se cerró (estado=${o?.estado})`),
        ];
      } },

    { id: "N4", wa: "51987000122", nombre: "Tomas Iglesias",
      titulo: "Cambia de producto a mitad de venta · zapatillas → curso (no debe negar el catálogo)",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero las zapatillas runner"); await sleep(1500);
        await send(wa, nombre, "cuanto estan?"); await sleep(2500);
        await send(wa, nombre, "mejor dime del curso de trading, ese me interesa mas"); await sleep(3500);
        const outs = await outMsgs(wa, 5); const todo = outs.join(" ");
        return [
          ck(/trading|curso/i.test(todo), `sí habla del curso (menciona trading/curso)`),
          ck(!/(no (vendemos|tenemos|manejamos) (ese|el) curso|no trabajo con)/i.test(todo), `no negó un producto que SÍ está en el catálogo`),
          ck(!/(zapatilla|runner)/i.test(outs[outs.length - 1] || ""), `su última respuesta ya no habla de zapatillas`),
        ];
      } },

    { id: "N5", wa: "51987000123", nombre: "Fiorella Nieto",
      titulo: "Corrige la talla después de darla · debe despachar la ÚLTIMA, no la primera",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero las zapatillas runner"); await sleep(1500);
        await send(wa, nombre, "un par talla 38 negras"); await sleep(2500);
        await send(wa, nombre, "espera, mejor la 39, la 38 me queda justa"); await sleep(3000);
        await send(wa, nombre, "Fiorella Nieto, Lima, Barranco, Av Grau 300"); await sleep(2500);
        await send(wa, nombre, "si confirmo"); await sleep(2800);
        const { o } = await order(wa);
        const v = JSON.stringify(o?.shipping?.variante || o?.shipping || {});
        return [
          ck(/39/.test(v), `la variante del pedido dice 39 (${v.slice(0, 90)})`),
          ck(!/\b38\b/.test(String(o?.shipping?.variante || "")), `ya no quedó la 38`),
          ck(o?.estado === "confirmado", `estado=${o?.estado}`),
        ];
      } },

    { id: "N6", wa: "51987000124", nombre: "Gonzalo Rey",
      titulo: "Digital · paga de MÁS (S/150 de 99) → freno anti-error: NO entrega, va a revisar",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero el curso de trading"); await sleep(1500);
        await send(wa, nombre, "el plan basico"); await sleep(2500);
        await yape(wa, nombre, { monto: 150, quien: nombre, op: "0" + Date.now().toString().slice(-9) }); await sleep(4000);
        const outs = await outMsgs(wa, 6); const todo = outs.join(" ");
        const { o } = await order(wa);
        return [
          ck(!tieneLink(outs, /https?:\/\//), `NO entregó a ciegas un pago que no cuadra`),
          ck(Number(o?.amount) === 99, `la venta vale 99, no 150 (amount=${o?.amount}) — el excedente no infla la venta`),
          ck(/revis|verific|confirm/i.test(todo), `le dijo que lo está revisando`),
          ck(!!o?.shipping?.digital_revisar, `quedó en Pagos por validar con la nota del OCR`),
        ];
      } },

    { id: "N7", wa: "51987000125", nombre: "Ariana Delgado",
      titulo: "Cancela el pedido · si dice cancelado, tiene que estarlo de verdad",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        const st0 = await stockOf(ids.P.zap);
        await send(wa, nombre, "hola quiero las zapatillas runner"); await sleep(1500);
        await send(wa, nombre, "un par talla 39 blancas"); await sleep(2500);
        await send(wa, nombre, "Ariana Delgado, Lima, Magdalena, Av Brasil 900"); await sleep(2500);
        await send(wa, nombre, "si confirmo"); await sleep(2800);
        const a = await order(wa);
        await send(wa, nombre, "disculpa, me arrepenti, cancelame el pedido por favor"); await sleep(3500);
        const b = await order(wa); const st1 = await stockOf(ids.P.zap);
        const outs = await outMsgs(wa, 4); const r = outs[outs.length - 1] || "";
        const k = "Talla=39|Color=blanco";
        const dijoCancelado = /cancel|anulad/i.test(r);
        return [
          ck(!!a.o, `llegó a haber pedido (${a.o?.estado})`),
          ck(!!r.trim(), `contestó a la cancelación: "${r.slice(0, 80)}"`),
          ck(!dijoCancelado || /anulad|cancel/i.test(b.o?.estado || ""), `si dijo cancelado, el pedido quedó anulado (estado=${b.o?.estado})`),
          ck(!dijoCancelado || st1[k] === st0[k], `si canceló, el stock volvió (${st0[k]}→${st1[k]})`),
        ];
      } },

    { id: "N8", wa: "51987000126", nombre: "Renzo Ferrari",
      titulo: "Dos mensajes a la vez · no debe abrir DOS pedidos",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero las zapatillas runner"); await sleep(1500);
        await send(wa, nombre, "un par talla 38 negras"); await sleep(2500);
        await Promise.all([
          send(wa, nombre, "Renzo Ferrari, Lima, Surquillo, Av Angamos 450"),
          send(wa, nombre, "si confirmo porfa"),
        ]);
        await sleep(4500);
        const { all } = await order(wa);
        const vivos = all.filter((o) => !/anulad|cancel/i.test(o.estado || ""));
        return [
          ck(vivos.length === 1, `quedó 1 pedido vivo (hay ${vivos.length}: ${all.map((o) => o.estado).join(", ")})`),
          ck(Number(vivos[0]?.amount) === 129, `amount=${vivos[0]?.amount} (esperado 129)`),
        ];
      } },

    { id: "N9", wa: "51987000127", nombre: "Silvia Aguirre",
      titulo: "Reclamo · llegó mal el pedido → atiende el reclamo, NO le vende otra vez",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero las zapatillas runner"); await sleep(1500);
        await send(wa, nombre, "un par talla 40 negras"); await sleep(2500);
        await send(wa, nombre, "Silvia Aguirre, Lima, Chorrillos, Av Huaylas 250"); await sleep(2500);
        await send(wa, nombre, "si confirmo"); await sleep(2800);
        const { o } = await order(wa);
        if (o?.id) { await mover(o.id, "en_reparto"); await sleep(1500); await mover(o.id, "entregado_cobrado"); await sleep(2500); }
        await send(wa, nombre, "me llegaron las zapatillas pero vinieron manchadas, estoy molesta"); await sleep(3800);
        const outs = await outMsgs(wa, 4); const r = outs[outs.length - 1] || "";
        const { all } = await order(wa);
        return [
          ck(!!r.trim(), `contestó al reclamo: "${r.slice(0, 90)}"`),
          ck(!/(te sumo|le sumas|quieres agregar|aprovecha|promoci[oó]n|descuento en tu pr[oó]xima)/i.test(r), `no intentó venderle encima del reclamo`),
          ck(all.length === 1, `no abrió un pedido nuevo (tiene ${all.length})`),
        ];
      } },

    { id: "N10", wa: "51987000128", nombre: "Martin Zegarra",
      titulo: "Recompra · ya compró y vuelve a pedir otro par → SÍ abre un pedido nuevo",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero las zapatillas runner"); await sleep(1500);
        await send(wa, nombre, "un par talla 39 negras"); await sleep(2500);
        await send(wa, nombre, "Martin Zegarra, Lima, La Molina, Av Javier Prado 1500"); await sleep(2500);
        await send(wa, nombre, "si confirmo"); await sleep(2800);
        const a = await order(wa);
        if (a.o?.id) { await mover(a.o.id, "en_reparto"); await sleep(1200); await mover(a.o.id, "entregado_cobrado"); await sleep(2500); }
        await send(wa, nombre, "hola de nuevo, me encantaron, quiero pedir otro par talla 38 negras"); await sleep(3800);
        await send(wa, nombre, "la misma direccion de antes"); await sleep(3000);
        await send(wa, nombre, "si confirmo"); await sleep(3000);
        const { all } = await order(wa);
        return [
          ck(all.length === 2, `abrió un SEGUNDO pedido (tiene ${all.length})`),
          ck(/38/.test(JSON.stringify(all[0]?.shipping?.atributos || {})), `el nuevo es el par correcto (38 negras)`),
          ck(/molina|javier prado/i.test(JSON.stringify(all[0]?.shipping || {})), `reusó la dirección sin volver a pedírsela`),
        ];
      } },
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // RUNNER
  // ═══════════════════════════════════════════════════════════════════════════
  function report(results) {
    let pass = 0, fail = 0;
    console.log("%c\n═══ SIMULACIÓN COMPLETA ═══", "font-weight:bold;font-size:14px");
    for (const r of results) {
      const okAll = r.checks.every((c) => c.ok); okAll ? pass++ : fail++;
      console.log(`%c${okAll ? "✅" : "❌"} ${r.id}%c  ${r.titulo}`, `color:${okAll ? "#0a0" : "#c00"};font-weight:bold`, "color:inherit");
      for (const c of r.checks) console.log(`      ${c.ok ? "·" : "↳"} %c${c.msg}`, `color:${c.ok ? "#666" : "#c00"}`);
    }
    console.log(`%c\n${pass}/${results.length} escenarios limpios` + (fail ? ` · ${fail} con hallazgos` : " · todo verde 🎉"), `font-weight:bold;color:${fail ? "#c00" : "#0a0"}`);
    return { pass, fail };
  }

  async function run(opts = {}) {
    if (!CH) throw new Error("No encontré el channelId. Abre el panel logueado.");
    if (!token()) throw new Error("Sin sesión. Recarga el panel logueado.");
    window.__SIM = { estado: "corriendo", t0: Date.now(), log: [], results: [], hecho: 0, total: ESCENARIOS.length };
    log("Limpiando canal…"); await clean();
    log("Construyendo catálogo (6 productos)…"); const ids = await build();
    window.__SIM.ids = ids;
    log("Generando flujos con el generador real…"); await genFlows(ids);
    log(`Corriendo ${ESCENARIOS.length} escenarios…`);
    for (const e of ESCENARIOS) {
      log(`· ${e.id} — ${e.titulo}`);
      let checks;
      try { checks = await e.run(ids, { wa: e.wa, nombre: e.nombre }); }
      catch (err) { checks = [{ ok: false, msg: "EXCEPCIÓN: " + (err?.message || err) }]; }
      window.__SIM.results.push({ id: e.id, titulo: e.titulo, wa: e.wa, nombre: e.nombre, checks });
      window.__SIM.hecho++;
    }
    const summary = report(window.__SIM.results);
    window.__SIM.estado = "listo"; window.__SIM.resumen = summary;
    log("Los chats quedaron en la Bandeja para revisarlos.");
    return { results: window.__SIM.results, ...summary };
  }

  window.NodoSim = { run, clean, build, genFlows, ESCENARIOS };
  window.__SIM = window.__SIM || { estado: "sin correr", log: [] };
  console.log("%c[sim]", "color:#7A3FF2;font-weight:bold", `Listo. Corre:  await NodoSim.run()   ·   ${ESCENARIOS.length} escenarios`);
})();
