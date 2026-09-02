/* ═══════════════════════════════════════════════════════
 * Nodo · DESPUÉS de la venta: saldo, cambios, cancelar, reclamos
 * ───────────────────────────────────────────────────────
 * `sim-compradores` cubre a la gente y `sim-extras-regalos` el order bump.
 * Falta el tramo que nadie mira y donde el pedido YA tiene plata adentro:
 *
 *   · pagar el SALDO y recibir la clave de recojo (el final del ciclo de provincia)
 *   · CAMBIAR la cantidad de un pedido ya creado (toca precio, saldo y stock)
 *   · "ya cancelé" = PAGUÉ, que en Perú es lo normal y da de baja pedidos vivos
 *   · CANCELAR de verdad
 *   · reclamos: llegó abierto, no llegó
 *   · recompra del que ya compró
 *   · pedir hablar con una persona
 *   · provincia que insiste en pagar todo al recibir
 *
 * CÓMO USARLO
 *   1. Panel logueado. 2. Consola (F12) → pega este archivo.
 *   3. await SimPost.run();   ·   SimPost.estado()   ·   await SimPost.limpiar()
 *
 * wa_id 5198740xxxx. ⚠️ `tmp-sim` desplegada y AL DÍA (lleva su copia del motor).
 * 🔴 Verde ≠ chat sano: los asserts son la red, los bugs salen leyendo.
 * ═══════════════════════════════════════════════════════ */
(function () {
  const BASE = "https://ahoxdyffbwjlshmdezwi.supabase.co";
  let ANON = null;
  const listo = import("/Nodo/panel/shell.js").then((sh) => { ANON = sh.SUPABASE_ANON_KEY; });
  const CH = (() => { try { return JSON.parse(localStorage.getItem("nodo.channelId")); } catch (_) {} return localStorage.getItem("nodo.channelId"); })();
  const token = () => { try { return JSON.parse(localStorage.getItem("sb-ahoxdyffbwjlshmdezwi-auth-token")).access_token; } catch (_) { return null; } };
  const H = () => ({ apikey: ANON, Authorization: "Bearer " + token(), "Content-Type": "application/json", Prefer: "return=representation" });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sel = (t, q) => fetch(`${BASE}/rest/v1/${t}?${q}`, { headers: H() }).then((r) => r.json());
  const del = (t, q) => fetch(`${BASE}/rest/v1/${t}?${q}`, { method: "DELETE", headers: { ...H(), Prefer: "return=minimal" } });
  const fn = (name, body) => fetch(`${BASE}/functions/v1/${name}`, {
    method: "POST", headers: { apikey: ANON, Authorization: "Bearer " + token(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const send = (wa, nombre, text, extra = {}) => fn("tmp-sim", { channel_id: CH, wa_id: wa, nombre, text, ...extra });
  const mover = (id, estado, extra = {}) => fn("order-update", { order_id: id, estado, aviso: { modo: "mensaje" }, ...extra });

  async function yape(wa, nombre, monto) {
    const MES = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sep.", "oct.", "nov.", "dic."];
    const d = new Date();
    const c = document.createElement("canvas"); c.width = 420; c.height = 560;
    const x = c.getContext("2d");
    x.fillStyle = "#7A3FF2"; x.fillRect(0, 0, 420, 110);
    x.fillStyle = "#fff"; x.font = "bold 30px Arial"; x.fillText("Yape", 160, 65);
    x.fillStyle = "#f5f5f5"; x.fillRect(0, 110, 420, 450); x.fillStyle = "#111";
    const L = ["Yapeaste!", "S/ " + monto + ".00", "Para: Rodrigo Flores", "Destino: 977533352", "De: " + nombre,
      "N operacion: 0" + Math.floor(10000000 + Math.random() * 89999999),
      `${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()} - 03:14 pm`];
    let y = 170; for (const t of L) { x.font = "18px Arial"; x.fillText(t, 26, y); y += 40; }
    const up = await fn("media-upload", { channel_id: CH, filename: "y.png", content_type: "image/png", data: c.toDataURL("image/png") });
    if (!up.url) throw new Error("media-upload: " + JSON.stringify(up).slice(0, 120));
    await send(wa, nombre, "", { media: { kind: "image", url: up.url, mime: "image/png", caption: "" } });
  }

  async function contacto(wa) { return (await sel("contacts", `select=id,stage,bot_activo&channel_id=eq.${CH}&wa_id=eq.${wa}`))[0]; }
  async function pedido(wa) {
    const c = await contacto(wa);
    if (!c) return { c: null, o: null };
    const o = (await sel("orders", `select=id,estado,amount,shipping,order_bumps&contact_id=eq.${c.id}&order=created_at.desc&limit=1`))[0];
    return { c, o };
  }
  async function dichos(wa, n = 8) {
    const c = await contacto(wa);
    if (!c) return [];
    const m = await sel("messages", `select=content&contact_id=eq.${c.id}&direction=eq.out&order=ts.desc&limit=${n}`);
    return (m || []).map((x) => String(x.content?.text ?? x.content?.caption ?? ""));
  }

  const P = 16000, POCR = 24000;
  const ck = (ok, msg) => ({ ok: !!ok, msg });
  const dice = (outs, re) => outs.some((m) => re.test(m || ""));
  const DATOS = "Ana Quispe Ramos, 987654321, DNI 45678912";

  // Deja un pedido de provincia con el adelanto ya validado, que es el punto de partida
  // de casi todo lo de acá. Devuelve el pedido.
  async function ventaProvincia(wa, nombre, ciudad, sede, cuantos = "2 frascos") {
    await send(wa, nombre, `quiero ${cuantos} del dermachem, soy de ${ciudad}`); await sleep(P);
    await send(wa, nombre, `${sede}. ${DATOS}`); await sleep(P);
    await yape(wa, nombre, 20); await sleep(POCR);
    return (await pedido(wa)).o;
  }

  const ESCENARIOS = [

    { id: "P1", wa: "51987400101", nombre: "Delia Ramos", zona: "Trujillo",
      titulo: "Paga el SALDO y tiene que recibir su CLAVE de recojo",
      run: async (s) => {
        const { wa, nombre } = s;
        const o = await ventaProvincia(wa, nombre, "trujillo", "la de ovalo papal");
        if (!o) return [ck(false, "no se creó el pedido")];
        // El operador despacha, registra la clave y avisa que llegó a la agencia.
        await mover(o.id, "despachado", { shipping: { guia: "1545", clave_recojo: "TRU-8842" } }); await sleep(6000);
        await mover(o.id, "en_agencia"); await sleep(6000);
        await yape(wa, nombre, 99); await sleep(POCR);
        const { o: o2 } = await pedido(wa);
        const outs = await dichos(wa, 4);
        return [
          ck(String(o2?.estado) === "saldo_pagado", `estado=${o2?.estado} (esperado saldo_pagado)`),
          ck(dice(outs, /TRU-8842/), "le mandó la CLAVE de recojo"),
        ];
      } },

    { id: "P2", wa: "51987400102", nombre: "Hugo Sánchez", zona: "Arequipa",
      titulo: "Sube de 2 a 3 frascos con el pedido ya creado · sube precio y saldo",
      run: async (s) => {
        const { wa, nombre } = s;
        const o = await ventaProvincia(wa, nombre, "arequipa", "la de av parra");
        if (!o) return [ck(false, "no se creó el pedido")];
        await send(wa, nombre, "oye, mejor mándame 3 frascos"); await sleep(P);
        await send(wa, nombre, "sí, confirmo"); await sleep(P);
        const { o: o2 } = await pedido(wa);
        const saldo = Number(o2?.shipping?.saldo);
        return [
          ck(Number(o2?.amount) === 149, `amount=${o2?.amount} (esperado 149)`),
          ck(Number.isFinite(saldo) && saldo === 129, `saldo=${o2?.shipping?.saldo} (esperado 129 = 149-20)`),
        ];
      } },

    { id: "P3", wa: "51987400103", nombre: "Carla Nieto", zona: "Cusco",
      titulo: "«ya cancelé» = PAGUÉ (Perú) · no debe dar de baja el pedido",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "quiero 2 frascos del dermachem, soy de cusco"); await sleep(P);
        await send(wa, nombre, "cusco wanchaq. " + DATOS); await sleep(P);
        await send(wa, nombre, "ya cancelé el adelanto, te paso la captura"); await sleep(P);
        const { o } = await pedido(wa);
        const outs = await dichos(wa, 4);
        return [
          ck(o && !/cancelad|perdid/i.test(String(o.estado)), `el pedido sigue vivo (${o?.estado})`),
          ck(!dice(outs, /(cancel[oé]|di de baja|anul)/i), "no le dijo que canceló el pedido"),
        ];
      } },

    { id: "P4", wa: "51987400104", nombre: "Raúl Espino", zona: "Piura",
      titulo: "Cancela de verdad · debe darlo de baja sin pelear",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "2 frascos del dermachem, soy de piura"); await sleep(P);
        await send(wa, nombre, "la de av grau. " + DATOS); await sleep(P);
        await send(wa, nombre, "sabes qué, ya no lo quiero, anula mi pedido por favor"); await sleep(P);
        const outs = await dichos(wa, 4);
        return [
          ck(outs.length > 0, "le contestó"),
          ck(!dice(outs, /adelanto de \*?S\/ ?20/i), "no le siguió pidiendo el adelanto"),
        ];
      } },

    { id: "P5", wa: "51987400105", nombre: "Silvia Torres", zona: "Lima · Surco",
      titulo: "Reclama que le llegó el frasco abierto · empatía, sin vender",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola, me llegó el dermachem pero el frasco vino abierto y derramado"); await sleep(P);
        const outs = await dichos(wa, 4);
        return [
          ck(outs.length > 0, "le contestó"),
          ck(!dice(outs, /1 frasco — |2 frascos — |¿cu[aá]ntas unidades/i), "NO le tiró la lista de precios a alguien que reclama"),
        ];
      } },

    { id: "P6", wa: "51987400106", nombre: "Elena Vargas", zona: "Huancayo",
      titulo: "«no me llega hace días» · no debe inventar dónde está",
      run: async (s) => {
        const { wa, nombre } = s;
        const o = await ventaProvincia(wa, nombre, "huancayo", "la de huancayo jr ica");
        if (!o) return [ck(false, "no se creó el pedido")];
        await send(wa, nombre, "oye ya pasaron 5 días y no me llega nada, qué pasó?"); await sleep(P);
        const outs = await dichos(wa, 4);
        return [
          ck(outs.length > 0, "le contestó"),
          ck(!dice(outs, /est[aá] en (camino a|el almac[eé]n de) [A-Z]/), "no inventó una ubicación del paquete"),
        ];
      } },

    { id: "P7", wa: "51987400107", nombre: "Mario Quinto", zona: "Tacna",
      titulo: "RECOMPRA · ya compró y vuelve por más, sin empezar de cero",
      run: async (s) => {
        const { wa, nombre } = s;
        const o = await ventaProvincia(wa, nombre, "tacna", "la de av vigil");
        if (!o) return [ck(false, "no se creó el pedido")];
        await mover(o.id, "despachado", { shipping: { guia: "9911", clave_recojo: "TAC-100" } }); await sleep(5000);
        await mover(o.id, "en_agencia"); await sleep(5000);
        await send(wa, nombre, "hola, ya se me acabó, quiero pedir otros 2 frascos"); await sleep(P);
        const outs = await dichos(wa, 4);
        return [
          ck(outs.length > 0, "le contestó"),
          ck(!dice(outs, /¿desde d[oó]nde nos escribe/i), "no lo trató como desconocido"),
        ];
      } },

    { id: "P8", wa: "51987400108", nombre: "Nora Bautista", zona: "Chiclayo",
      titulo: "Pide hablar con una persona · debe pasar sin dejarlo en el aire",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "quiero el dermachem, soy de chiclayo"); await sleep(P);
        await send(wa, nombre, "prefiero hablar con una persona de verdad, me pasas con alguien?"); await sleep(P);
        const { c } = await pedido(wa);
        const outs = await dichos(wa, 3);
        return [
          ck(outs.length > 0, "le contestó (no lo dejó mudo)"),
          ck(c?.bot_activo === false || dice(outs, /asesor|persona|equipo|escrib|un momento/i), "avisó que lo atiende alguien"),
        ];
      } },

    { id: "P9", wa: "51987400109", nombre: "Iván Mendoza", zona: "Iquitos",
      titulo: "Provincia · insiste en pagar TODO al recibir · no debe ceder",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "2 frascos del dermachem, soy de iquitos"); await sleep(P);
        await send(wa, nombre, "puedo pagar todo cuando lo reciba? no me gusta adelantar"); await sleep(P);
        const outs = await dichos(wa, 4);
        return [
          ck(!dice(outs, /s[ií].{0,30}(pagas? todo al recibir|contraentrega)/i), "no le prometió contraentrega en provincia"),
          ck(dice(outs, /adelanto|S\/ ?20/i), "le explicó el adelanto"),
        ];
      } },

    { id: "P10", wa: "51987400110", nombre: "Pilar Zúñiga", zona: "Juliaca",
      titulo: "Manda el saldo de MENOS · no debe soltar la clave",
      run: async (s) => {
        const { wa, nombre } = s;
        const o = await ventaProvincia(wa, nombre, "juliaca", "la de las mercedes");
        if (!o) return [ck(false, "no se creó el pedido")];
        await mover(o.id, "despachado", { shipping: { guia: "7722", clave_recojo: "JUL-555" } }); await sleep(5000);
        await mover(o.id, "en_agencia"); await sleep(5000);
        await yape(wa, nombre, 50); await sleep(POCR);     // debe 99, paga 50
        const { o: o2 } = await pedido(wa);
        const outs = await dichos(wa, 4);
        return [
          ck(String(o2?.estado) !== "saldo_pagado", `estado=${o2?.estado} (no debe darse por pagado)`),
          ck(!dice(outs, /JUL-555/), "NO le soltó la clave con el saldo incompleto"),
        ];
      } },
  ];

  async function run({ solo = null, lote = 3 } = {}) {
    await listo;
    const lista = solo ? ESCENARIOS.filter((e) => solo.includes(e.id)) : ESCENARIOS;
    const st = { estado: "corriendo", t0: Date.now(), hecho: 0, total: lista.length, results: [] };
    window.__SP = st;
    for (let i = 0; i < lista.length; i += lote) {
      await Promise.all(lista.slice(i, i + lote).map(async (e) => {
        try {
          const checks = await e.run({ wa: e.wa, nombre: e.nombre });
          st.results.push({ id: e.id, titulo: e.titulo, zona: e.zona, wa: e.wa, checks });
        } catch (err) {
          st.results.push({ id: e.id, titulo: e.titulo, zona: e.zona, wa: e.wa, checks: [{ ok: false, msg: "REVENTÓ: " + (err?.message || err) }] });
        }
        st.hecho++;
      }));
    }
    st.estado = "listo";
    st.pass = st.results.filter((r) => r.checks.every((c) => c.ok)).length;
    st.fail = st.results.length - st.pass;
    return st;
  }

  const estado = () => { const s = window.__SP; return s ? `${s.estado} ${s.hecho}/${s.total}` : "sin arrancar"; };

  async function limpiar() {
    await listo;
    const cs = await sel("contacts", `select=id&channel_id=eq.${CH}&wa_id=like.5198740*`);
    const ids = (cs || []).map((c) => c.id);
    if (!ids.length) return { borrados: 0 };
    const inList = `(${ids.join(",")})`;
    for (const t of ["orders", "messages", "flow_runs", "contact_events", "contact_field_values", "contact_tags"]) {
      await del(t, `contact_id=in.${inList}`);
    }
    await del("contacts", `id=in.${inList}`);
    return { borrados: ids.length };
  }

  window.SimPost = { ESCENARIOS, run, estado, limpiar };
  console.log("%c[postventa]", "color:#b45309;font-weight:bold", `${ESCENARIOS.length} escenarios — await SimPost.run()`);
})();
