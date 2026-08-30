/* ═══════════════════════════════════════════════════════════════════════════
 * Nodo · SIMULACIÓN — Dermachem (sérum clareador, físico)
 * ───────────────────────────────────────────────────────────────────────────
 * Hermana de `simulacion-completa.js`, pero con UN solo producto y todo el peso
 * puesto donde Dermachem de verdad se juega la venta: **la cantidad**. Sus tres
 * ofertas (1×79 · 2×119 · 3×149) hacen que casi cada chat pase por "¿cuántos
 * quieres?", que es justo donde más bugs han salido en este proyecto.
 *
 * No busca cobertura de features (para eso está la otra): busca CHATS QUE LEER.
 * Cada escenario deja una conversación completa en la Bandeja, con su gente y
 * sus manías — el que regatea, el que dice "cancelar" queriendo decir pagar, el
 * que pregunta algo que la ficha no cubre, el que manda el Yape por menos.
 *
 * CÓMO USARLO
 *   1. Panel logueado en la sección **Productos** (necesita window.__nodoTest).
 *   2. Consola (F12) → pega este archivo.
 *   3. await SimDerma.run();      // deja los chats en la Bandeja
 *      await SimDerma.clean();    // borra el canal
 *
 * OJO: BORRA todos los productos/contactos/flujos del canal activo. Canal
 * sandbox. Si el canal tiene Google Sheets conectado, cada pedido sincroniza
 * filas de prueba a la hoja.
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
  const log = (...a) => { try { (window.__SD.log ||= []).push(a.join(" ")); } catch (_) {} console.log("%c[derma]", "color:#c026d3;font-weight:bold", ...a); };

  const sel = (t, q) => fetch(`${BASE}/rest/v1/${t}?${q}`, { headers: H(true) }).then((r) => r.json());
  const ins = (t, rows) => fetch(`${BASE}/rest/v1/${t}`, { method: "POST", headers: H(true), body: JSON.stringify(rows) }).then((r) => r.json());
  const patch = (t, q, body) => fetch(`${BASE}/rest/v1/${t}?${q}`, { method: "PATCH", headers: H(false), body: JSON.stringify(body) });
  const del = (t, q) => fetch(`${BASE}/rest/v1/${t}?${q}`, { method: "DELETE", headers: H(false) });
  const fn = (name, body) => fetch(`${BASE}/functions/v1/${name}`, { method: "POST", headers: { apikey: ANON, Authorization: "Bearer " + token(), "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

  const send = (wa, nombre, text, extra = {}) => fn("tmp-sim", { channel_id: CH, wa_id: wa, nombre, text, ...extra });
  const mover = (order_id, estado, shipping) => fn("order-update", { order_id, estado, ...(shipping ? { shipping } : {}) });

  // Comprobante Yape sintético: fecha de HOY y el número del canal, o el
  // Validador lo rechaza por antiguo o por destino y el chat no avanza.
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
  // CATÁLOGO
  //   Dermachem (principal) + Protector Solar (extra) + Jabón (regalo).
  //   Sin atributos a propósito: un sérum no tiene talla ni color, así que la
  //   ÚNICA decisión del cliente es cuántos frascos — que es lo que se quiere
  //   ver funcionando en los chats.
  // ═══════════════════════════════════════════════════════════════════════════
  async function build() {
    const prods = await ins("products", [
      { channel_id: CH, nombre: "Dermachem", clase: "principal", tipo: "fisico", config: {
        costo: 22, empaque: 2,
        contexto_producto:
          "## Sobre el producto\n" +
          "Dermachem es un sérum clareador facial de 30 ml. Atenúa manchas oscuras, paño y marcas que dejan los granitos. " +
          "Fórmula con vitamina C estabilizada, niacinamida y ácido tranexámico. Textura ligera, se absorbe rápido y no deja grasoso.\n" +
          "## Cómo se usa\n" +
          "3 a 4 gotas en el rostro limpio, de noche. En el día, siempre con protector solar encima (sin protector el clareador rinde mucho menos).\n" +
          "## Resultados\n" +
          "Las manchas empiezan a aclararse entre la semana 3 y 4. Un frasco rinde un mes de uso diario, por eso el pack de 3 es el que la mayoría lleva: es el tratamiento completo.\n" +
          "## Reglas del precio\n" +
          "1 frasco S/79 · 2 frascos S/119 · 3 frascos S/149. Los packs ya son el descuento; no se regatea por debajo de eso.\n" +
          "## Cómo vender\n" +
          "Consultivo. Pregunta qué tipo de mancha tiene y desde cuándo, y recomienda según eso. El pack de 3 se ofrece por el tratamiento completo, no por el ahorro.",
      } },
      { channel_id: CH, nombre: "Protector Solar FPS50", clase: "extra", tipo: "fisico", config: {
        costo: 12, empaque: 0,
        contexto_producto: "## Sobre el producto\nProtector solar facial FPS50, toque seco, no deja blanco. Es el complemento del sérum: sin él el clareador rinde mucho menos.",
      } },
      { channel_id: CH, nombre: "Jabón Facial de Avena", clase: "regalo", tipo: "fisico", config: {
        costo: 5, regalo_desc: "Jabón facial de avena, limpia sin resecar. Va de regalo con tu pedido.",
      } },
    ]);
    const KEY = { "Dermachem": "derma", "Protector Solar FPS50": "solar", "Jabón Facial de Avena": "jabon" };
    const P = {}; prods.forEach((p) => { P[KEY[p.nombre]] = p.id; });

    const mk = (o) => ({ product_id: o.pid, nombre: o.nombre, orden: o.orden, activo: true, cantidad: o.cantidad ?? 1, precio: o.precio ?? null, costo: o.costo ?? null, descripcion: o.descripcion ?? null, entrega: [], entrega_mensaje: null, price_list: [], drive_link: null });
    const vs = await ins("product_versions", [
      // OJO: `costo` es POR UNIDAD — el motor lo multiplica por `cantidad`. Poner
      // acá el costo del pack completo hunde el margen de los packs sin avisar.
      mk({ pid: P.derma, nombre: "1 frasco", orden: 0, cantidad: 1, precio: 79, costo: 22, descripcion: "Un mes de tratamiento" }),
      mk({ pid: P.derma, nombre: "2 frascos", orden: 1, cantidad: 2, precio: 119, costo: 22, descripcion: "Dos meses (ahorras S/ 39)" }),
      mk({ pid: P.derma, nombre: "3 frascos", orden: 2, cantidad: 3, precio: 149, costo: 22, descripcion: "Tratamiento completo (ahorras S/ 88)" }),
      mk({ pid: P.solar, nombre: "Unico", orden: 0, cantidad: 1, precio: 39, costo: 12 }),
      mk({ pid: P.jabon, nombre: "Unico", orden: 0, cantidad: 1, precio: null, costo: 5 }),
    ]);
    const V = {}; vs.forEach((v) => { const pk = Object.keys(P).find((k) => P[k] === v.product_id); V[pk + ":" + v.nombre] = v.id; });

    const dc = (await sel("products", `select=config&id=eq.${P.derma}`))[0].config;
    dc.extras = [{ version_id: V["solar:Unico"], mensaje: "¿Le sumas el Protector Solar FPS50 por S/ 39? Sin protector el clareador rinde mucho menos." }];
    dc.extras_momento = "antes"; dc.extras_prov_momento = "post"; dc.extras_seguir = false;
    dc.regalos = [{ version_id: V["jabon:Unico"], product_id: P.jabon, nombre: "Jabón Facial de Avena de regalo", tipo: "fisico" }];
    dc.regalo_mencionar = true;
    await patch("products", `id=eq.${P.derma}`, { config: dc });

    const uuid = () => crypto.randomUUID();
    const f = (await ins("flows", { channel_id: CH, product_id: P.derma, kind: "flow", role: "mensajes_iniciales", nombre: "Mensajes iniciales - Dermachem", estado: "activo" }))[0];
    await ins("flow_nodes", { flow_id: f.id, tipo: "rotador", nombre: "Mensajes iniciales", es_inicial: true, config: { activo: true, variantes: [{ id: uuid(), nombre: "A", activo: true, peso: 1, bubbles: [{ text: "¡Hola! Gracias por escribir por el *Dermachem* 🌿 ¿Te cuento cómo funciona y los precios?" }] }], despues: { modo: "nada" } }, pos_x: 80, pos_y: 80 });
    await ins("flow_triggers", { channel_id: CH, flow_id: f.id, tipo: "keyword", config: { keywords: ["dermachem", "serum", "sérum", "manchas", "clareador"] }, activo: true });

    return { P, V };
  }

  // Genera el flujo de venta con el generador REAL del panel, y verifica que
  // quedó COMPLETO: un nodo sin salida (que no sea Fin) es un flujo a medias, y
  // el cliente se queda colgado a mitad de la venta sin que nadie se entere.
  async function genFlows(ids) {
    if (!window.__nodoTest) throw new Error("Falta window.__nodoTest — abre el panel en Productos y recarga.");
    const pid = ids.P.derma;
    const wantIni = (await sel("flows", `select=id&channel_id=eq.${CH}&product_id=eq.${pid}&role=eq.mensajes_iniciales`))[0]?.id;
    window.__nodoTest.getSt().receta = null;
    window.__nodoTest.getSt().extraCat = null;
    await window.__nodoTest.openProduct(pid);
    for (let i = 0; i < 80; i++) { const s = window.__nodoTest.getSt(); if (s?.prod?.id === pid && s?.receta?.fIni?.id === wantIni) break; await sleep(150); }
    await sleep(300);
    await window.__nodoTest.genVenta();
    await sleep(900);
    for (let intento = 1; intento <= 3; intento++) {
      const fv = (await sel("flows", `select=id&channel_id=eq.${CH}&product_id=eq.${pid}&role=eq.venta`))[0]?.id;
      if (!fv) { await sleep(1200); continue; }
      const nn = await sel("flow_nodes", `select=id,nombre&flow_id=eq.${fv}`);
      const ee = await sel("flow_edges", `select=source_node&flow_id=eq.${fv}`);
      const conSalida = new Set((ee || []).map((x) => x.source_node));
      const huerfanos = (nn || []).filter((x) => !/^Fin/.test(x.nombre || "") && !conSalida.has(x.id));
      if (!huerfanos.length) { log(`flujo de venta OK (${nn.length} nodos)`); break; }
      log(`⚠️ flujo incompleto (${huerfanos.map((h) => h.nombre).join(", ")}) — regenerando (intento ${intento})`);
      await window.__nodoTest.genVenta();
      await sleep(2500);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ESCENARIOS — cada uno deja un CHAT en la Bandeja.
  //   `checks` = aserciones duras. Pero la lección de este proyecto es que
  //   verde ≠ chat sano: lo que importa de verdad es LEERLOS después.
  // ═══════════════════════════════════════════════════════════════════════════
  const ck = (ok, msg) => ({ ok: !!ok, msg });
  const cant = (o) => Number(o?.shipping?.cantidad ?? o?.shipping?.version_cantidad ?? 0);
  const dice = (outs, re) => outs.some((m) => re.test(m || ""));

  const ESCENARIOS = [

    // ─── LIMA · contraentrega ───────────────────────────────────────────────
    { id: "D1", wa: "51987100101", nombre: "Milagros Quispe",
      titulo: "Lima · pregunta precio, elige el pack de 3 → ciclo completo hasta cobrado",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola vi el anuncio del serum para las manchas"); await sleep(1500);
        await send(wa, nombre, "cuanto cuesta?"); await sleep(3000);
        await send(wa, nombre, "tengo paño en las mejillas hace como dos años"); await sleep(3200);
        await send(wa, nombre, "ya, llevo los 3 entonces"); await sleep(3000);
        await send(wa, nombre, "no gracias solo el serum"); await sleep(2800);
        await send(wa, nombre, "Milagros Quispe, Lima, Los Olivos, Av Universitaria 2340"); await sleep(3000);
        await send(wa, nombre, "si confirmo"); await sleep(3000);
        const { o } = await order(wa);
        const checks = [
          ck(o?.estado === "confirmado", `estado=${o?.estado} (esperado confirmado)`),
          ck(Number(o?.amount) === 149, `amount=${o?.amount} (esperado 149 — el pack de 3)`),
          ck(o?.shipping?.zona === "lima", `zona=${o?.shipping?.zona}`),
        ];
        if (o?.id) {
          await mover(o.id, "en_reparto"); await sleep(2200);
          await mover(o.id, "entregado_cobrado"); await sleep(2500);
          const { o: o2, c } = await order(wa);
          checks.push(ck(o2?.estado === "entregado_cobrado", `estado final=${o2?.estado}`));
          checks.push(ck(c?.stage === "comprado", `etapa=${c?.stage}`));
        }
        return checks;
      } },

    { id: "D2", wa: "51987100102", nombre: "Jorge Arana",
      titulo: "Lima · pide UNO y el bot no debe cerrar sin preguntar si quiere más",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero el dermachem"); await sleep(1500);
        await send(wa, nombre, "quiero uno"); await sleep(3200);
        const outs = await outMsgs(wa, 6);
        await send(wa, nombre, "Jorge Arana, Lima, Surco, Av Primavera 500"); await sleep(3000);
        await send(wa, nombre, "confirmo"); await sleep(3000);
        const { o } = await order(wa);
        return [
          ck(Number(o?.amount) === 79, `amount=${o?.amount} (esperado 79 — el que pidió)`),
          ck(!dice(outs, /S\/\s*149|3 frascos.*confirm/i) || dice(outs, /\?/), `no le cerró un pack que no pidió`),
          ck(o?.estado === "confirmado", `estado=${o?.estado}`),
        ];
      } },

    { id: "D3", wa: "51987100103", nombre: "Rosa Ttito",
      titulo: "Lima · cambia de opinión a mitad: pide 1 y después quiere 3",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola cuanto esta el serum de manchas"); await sleep(3000);
        await send(wa, nombre, "dame uno nomas"); await sleep(3000);
        await send(wa, nombre, "espera, mejor los 3, si es tratamiento completo lo hago bien"); await sleep(3200);
        await send(wa, nombre, "Rosa Ttito, Lima, San Miguel, Calle Cusco 145"); await sleep(3000);
        await send(wa, nombre, "si"); await sleep(3000);
        const { o } = await order(wa);
        return [
          ck(Number(o?.amount) === 149, `amount=${o?.amount} (esperado 149 — la ÚLTIMA cantidad, no la primera)`),
          ck(o?.estado === "confirmado", `estado=${o?.estado}`),
        ];
      } },

    { id: "D4", wa: "51987100104", nombre: "Elena Farfán",
      titulo: "Lima · regatea por debajo del pack (no debe ceder ni ofender)",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola, los 3 frascos me los dejas en 120?"); await sleep(3800);
        const outs = await outMsgs(wa, 5); const todo = outs.join(" ");
        await send(wa, nombre, "ya pues, ultimo 130 y me los llevo"); await sleep(3500);
        const outs2 = await outMsgs(wa, 4); const todo2 = outs2.join(" ");
        return [
          ck(!/\b1[23]\d\b(?!.*149)/.test(todo2.replace(/149/g, "")), `no aceptó un precio por debajo de 149`),
          ck(/149/.test(todo + todo2), `sostuvo el precio del pack`),
          ck(!/no puedo ayudar|no negocio|imposible/i.test(todo2), `no lo cortó en seco`),
        ];
      } },

    { id: "D5", wa: "51987100105", nombre: "Katia Mendoza",
      titulo: "Lima · acepta el EXTRA (protector solar) → el pedido debe sumarlo",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero el dermachem, los 2 frascos"); await sleep(3200);
        await send(wa, nombre, "Katia Mendoza, Lima, Jesus Maria, Av Salaverry 800"); await sleep(3000);
        await send(wa, nombre, "si confirmo"); await sleep(3000);
        await send(wa, nombre, "ya, agregame el protector tambien"); await sleep(3200);
        const { o } = await order(wa);
        const bumps = o?.order_bumps || [];
        const solar = bumps.find((b) => !b.regalo && Number(b.precio) === 39);
        return [
          ck(Number(o?.amount) === 119, `la venta principal sigue en 119 (amount=${o?.amount})`),
          ck(!!solar, `el protector quedó como extra a S/39 (bumps=${JSON.stringify(bumps.map((b) => [b.nombre, b.precio]))})`),
        ];
      } },

    { id: "D6", wa: "51987100106", nombre: "Pedro Sifuentes",
      titulo: "Lima · dice “sí” a secas después de ofrecerle DOS opciones (no debe adivinar)",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola, el serum de manchas"); await sleep(3000);
        await send(wa, nombre, "y cual me conviene, el de 2 o el de 3?"); await sleep(3500);
        await send(wa, nombre, "si"); await sleep(3500);
        const outs = await outMsgs(wa, 4); const ult = outs[outs.length - 1] || "";
        const { o } = await order(wa);
        return [
          ck(!o || o.estado !== "confirmado", `NO cerró un pedido con un "sí" ambiguo (pedido=${o?.estado || "ninguno"})`),
          ck(/\?/.test(ult), `volvió a preguntar cuál quiere`),
        ];
      } },

    // ─── PROVINCIA · adelanto + saldo ───────────────────────────────────────
    { id: "D7", wa: "51987100107", nombre: "Yeni Huamán",
      titulo: "Provincia · adelanto por Yape, despacho, y saldo al recoger",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero el dermachem, soy de Chiclayo"); await sleep(3500);
        await send(wa, nombre, "los 3 frascos"); await sleep(3200);
        await send(wa, nombre, "Yeni Huaman, DNI 45872103, Chiclayo"); await sleep(3500);
        await send(wa, nombre, "si, mando el adelanto"); await sleep(3000);
        await yape(wa, nombre, { monto: 20, quien: "Yeni Huaman" }); await sleep(5000);
        const { o } = await order(wa);
        const checks = [
          ck(o?.shipping?.zona === "provincia", `zona=${o?.shipping?.zona}`),
          ck(Number(o?.amount) === 149, `amount=${o?.amount} (esperado 149)`),
          ck(/adelanto|por_despachar/.test(o?.estado || ""), `estado=${o?.estado} (adelanto reconocido)`),
        ];
        if (o?.id) {
          await mover(o.id, "despachado", { guia: "SH-778812" }); await sleep(2500);
          await mover(o.id, "en_agencia"); await sleep(2500);
          await send(wa, nombre, "ya lo recogi, mando el saldo"); await sleep(2500);
          await yape(wa, nombre, { monto: 129, quien: "Yeni Huaman" }); await sleep(5000);
          const { o: o2 } = await order(wa);
          checks.push(ck(/saldo_pagado|recogido|entregado/.test(o2?.estado || ""), `estado final=${o2?.estado}`));
        }
        return checks;
      } },

    { id: "D8", wa: "51987100108", nombre: "Marco Ayala",
      titulo: "Provincia · da el DNI y desaparece sin pagar el adelanto (debe quedar en remarketing)",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola, el serum. soy de Trujillo"); await sleep(3500);
        await send(wa, nombre, "2 frascos"); await sleep(3200);
        await send(wa, nombre, "Marco Ayala, DNI 41203355, Trujillo"); await sleep(4000);
        const { o, c } = await order(wa);
        const outs = await outMsgs(wa, 5);
        return [
          ck(/esperando|adelanto/.test(o?.estado || "") || !o, `quedó esperando el adelanto (estado=${o?.estado || "sin pedido"})`),
          ck(dice(outs, /adelanto|S\/\s*20/i), `le explicó el adelanto`),
          ck(c?.stage !== "comprado", `no lo dio por comprado (etapa=${c?.stage})`),
        ];
      } },

    { id: "D9", wa: "51987100109", nombre: "Lucero Ramos",
      titulo: "Provincia · manda el Yape por MENOS de lo que debe (no debe darlo por bueno)",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero 2 frascos, soy de Arequipa"); await sleep(3500);
        await send(wa, nombre, "Lucero Ramos, DNI 70112345, Arequipa"); await sleep(3500);
        await yape(wa, nombre, { monto: 10, quien: "Lucero Ramos" }); await sleep(5000);
        const outs = await outMsgs(wa, 6); const todo = outs.join(" ");
        const { o } = await order(wa);
        return [
          ck(!/por_despachar|despachado/.test(o?.estado || ""), `NO despachó con el adelanto incompleto (estado=${o?.estado})`),
          ck(/falta|complet|S\/\s*(10|20)/i.test(todo), `le dijo que faltaba`),
        ];
      } },

    { id: "D10", wa: "51987100110", nombre: "Cesar Ynga",
      titulo: "Provincia · pregunta a qué agencia le llega (debe ayudarlo con su sede)",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola, hacen envios a Juliaca?"); await sleep(3800);
        await send(wa, nombre, "y a que agencia llega? me queda lejos el centro"); await sleep(4000);
        const outs = await outMsgs(wa, 6); const todo = outs.join(" ");
        return [
          ck(/shalom/i.test(todo), `mencionó Shalom`),
          ck(/juliaca/i.test(todo), `habló de SU ciudad`),
          ck(!/no (hacemos|tenemos|llegamos)/i.test(todo), `no le negó el envío`),
        ];
      } },

    { id: "D11", wa: "51987100111", nombre: "Nataly Cordova",
      titulo: "Dice “soy de Lima” y después nombra un distrito de provincia",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero el serum, soy de Lima"); await sleep(3500);
        await send(wa, nombre, "2 frascos"); await sleep(3200);
        await send(wa, nombre, "Nataly Cordova, vivo en Huancayo, jiron Real 480"); await sleep(4000);
        const { o } = await order(wa);
        const outs = await outMsgs(wa, 5); const todo = outs.join(" ");
        return [
          ck(o?.shipping?.zona !== "lima" || /agencia|shalom|adelanto/i.test(todo), `corrigió la zona al oír Huancayo (zona=${o?.shipping?.zona})`),
        ];
      } },

    // ─── PREGUNTAS Y ROCES ──────────────────────────────────────────────────
    { id: "D12", wa: "51987100112", nombre: "Andrea Solis",
      titulo: "Pregunta algo que la ficha NO cubre (embarazo) — ni inventar ni negar en seco",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola, se puede usar en el embarazo?"); await sleep(4000);
        const outs = await outMsgs(wa, 5); const todo = outs.join(" ");
        return [
          ck(!/^no\b|no se puede|no es apto/i.test(todo.trim()), `no lo negó de plano`),
          ck(!/(seguro|sí se puede|apto) (en|para) (el )?embarazo/i.test(todo), `tampoco lo afirmó inventando`),
          ck(/\?|consult|médic|dermat/i.test(todo), `derivó o repreguntó en vez de cerrar la puerta`),
        ];
      } },

    { id: "D13", wa: "51987100113", nombre: "Bruno Tapia",
      titulo: "“Ya cancelé” = PAGÓ (Perú). No debe dar de baja el pedido",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola, 2 frascos, soy de Piura"); await sleep(3500);
        await send(wa, nombre, "Bruno Tapia, DNI 44556677, Piura"); await sleep(3500);
        await yape(wa, nombre, { monto: 20, quien: "Bruno Tapia" }); await sleep(4500);
        await send(wa, nombre, "listo, ya cancelé el adelanto"); await sleep(3800);
        const { o } = await order(wa);
        const outs = await outMsgs(wa, 5); const todo = outs.join(" ");
        return [
          ck(o?.estado !== "cancelado", `el pedido NO quedó cancelado (estado=${o?.estado})`),
          ck(!/dado de baja|anulad|cancelado tu pedido/i.test(todo), `no le dijo que se lo dio de baja`),
        ];
      } },

    { id: "D14", wa: "51987100114", nombre: "Silvia Ponce",
      titulo: "Post-venta · reclama que le llegó con el frasco abierto",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero 1 frasco"); await sleep(3000);
        await send(wa, nombre, "Silvia Ponce, Lima, Comas, Av Tupac Amaru 3200"); await sleep(3000);
        await send(wa, nombre, "confirmo"); await sleep(3000);
        const a = await order(wa);
        if (a.o?.id) { await mover(a.o.id, "en_reparto"); await sleep(1500); await mover(a.o.id, "entregado_cobrado"); await sleep(2500); }
        await send(wa, nombre, "oye me llego el frasco abierto y derramado, esto no puede ser"); await sleep(4200);
        const outs = await outMsgs(wa, 5); const todo = outs.join(" ");
        return [
          ck(!/te sumo|le sumas|aprovecha|pack de 3/i.test(todo), `NO le intentó vender encima de un reclamo`),
          ck(/disculp|lament|solucion|revis/i.test(todo), `se hizo cargo del reclamo`),
        ];
      } },

    { id: "D15", wa: "51987100115", nombre: "Gabriela Ruiz",
      titulo: "Recompra · ya compró y vuelve por más (no debe empezar de cero)",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero 1 frasco del dermachem"); await sleep(3000);
        await send(wa, nombre, "Gabriela Ruiz, Lima, Pueblo Libre, Av Bolivar 720"); await sleep(3000);
        await send(wa, nombre, "confirmo"); await sleep(3000);
        const a = await order(wa);
        if (a.o?.id) { await mover(a.o.id, "en_reparto"); await sleep(1200); await mover(a.o.id, "entregado_cobrado"); await sleep(2500); }
        await send(wa, nombre, "hola! me funcionó bien, quiero pedir 2 más"); await sleep(4000);
        await send(wa, nombre, "misma direccion de antes"); await sleep(3500);
        await send(wa, nombre, "si confirmo"); await sleep(3200);
        const { all } = await order(wa);
        return [
          ck(all.length === 2, `abrió un SEGUNDO pedido (tiene ${all.length})`),
          ck(Number(all[0]?.amount) === 119, `el nuevo es el de 2 frascos (amount=${all[0]?.amount})`),
          ck(/bolivar|pueblo libre/i.test(JSON.stringify(all[0]?.shipping || {})), `reusó la dirección sin volver a pedirla`),
        ];
      } },

    { id: "D16", wa: "51987100116", nombre: "Diego Lazo",
      titulo: "Pide hablar con una persona · debe pasar a humano sin dejarlo en el aire",
      run: async (ids, s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola, tengo una consulta rara"); await sleep(3000);
        await send(wa, nombre, "quiero hablar con una persona por favor, no con un bot"); await sleep(4000);
        const { c } = await order(wa);
        const outs = await outMsgs(wa, 4); const todo = outs.join(" ");
        return [
          ck(c?.bot_activo === false, `el bot se apartó (bot_activo=${c?.bot_activo})`),
          ck(todo.trim().length > 0, `le dijo algo antes de callarse (no lo dejó en el aire)`),
        ];
      } },
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // RUNNER
  // ═══════════════════════════════════════════════════════════════════════════
  function report(results) {
    let pass = 0, fail = 0;
    console.log("%c\n═══ SIMULACIÓN DERMACHEM ═══", "font-weight:bold;font-size:14px");
    for (const r of results) {
      const okAll = r.checks.every((c) => c.ok); okAll ? pass++ : fail++;
      console.log(`%c${okAll ? "✅" : "❌"} ${r.id}%c  ${r.titulo}`, `color:${okAll ? "#0a0" : "#c00"};font-weight:bold`, "color:inherit");
      for (const c of r.checks) console.log(`      ${c.ok ? "·" : "↳"} %c${c.msg}`, `color:${c.ok ? "#666" : "#c00"}`);
    }
    console.log(`%c\n${pass}/${results.length} escenarios limpios` + (fail ? ` · ${fail} con hallazgos` : " · todo verde"), `font-weight:bold;color:${fail ? "#c00" : "#0a0"}`);
    return { pass, fail };
  }

  async function run() {
    if (!CH) throw new Error("No encontré el channelId. Abre el panel logueado.");
    if (!token()) throw new Error("Sin sesión. Recarga el panel logueado.");
    window.__SD = { estado: "corriendo", t0: Date.now(), log: [], results: [], hecho: 0, total: ESCENARIOS.length };
    log("Limpiando canal…"); await clean();
    log("Construyendo el catálogo de Dermachem…"); const ids = await build();
    window.__SD.ids = ids;
    log("Generando el flujo de venta con el generador real…"); await genFlows(ids);
    log(`Corriendo ${ESCENARIOS.length} chats…`);
    for (const e of ESCENARIOS) {
      log(`· ${e.id} — ${e.titulo}`);
      let checks;
      try { checks = await e.run(ids, { wa: e.wa, nombre: e.nombre }); }
      catch (err) { checks = [{ ok: false, msg: "EXCEPCIÓN: " + (err?.message || err) }]; }
      window.__SD.results.push({ id: e.id, titulo: e.titulo, wa: e.wa, nombre: e.nombre, checks });
      window.__SD.hecho++;
    }
    const summary = report(window.__SD.results);
    window.__SD.estado = "listo"; window.__SD.resumen = summary;
    log("Los chats quedaron en la Bandeja para leerlos uno por uno.");
    return { results: window.__SD.results, ...summary };
  }

  window.SimDerma = { run, clean, build, genFlows, ESCENARIOS };
  window.__SD = window.__SD || { estado: "sin correr", log: [] };
  console.log("%c[derma]", "color:#c026d3;font-weight:bold", `Listo. Corre:  await SimDerma.run()   ·   ${ESCENARIOS.length} chats`);
})();
