/* ═══════════════════════════════════════════════════════
 * Nodo · Batería de TIPOS DE COMPRADOR  (sobre el producto REAL)
 * ───────────────────────────────────────────────────────
 * `sim-dermachem.js` cubre el recorrido de la venta. Esta batería cubre a la
 * GENTE: el que paga de más, el que paga el total de una, el que manda el
 * comprobante antes de dar sus datos, el que vive en un pueblo con una sola
 * agencia, el que vive donde no hay ninguna, el que quiere pagar con tarjeta,
 * el que escribe seis mensajes seguidos, el que es de otro país.
 *
 * A DIFERENCIA de sim-dermachem: NO borra nada ni arma catálogo. Corre contra
 * el producto que ya está en el canal, que es lo que de verdad se va a vender.
 *
 * CÓMO USARLO
 *   1. Panel logueado (cualquier sección).
 *   2. Consola (F12) → pega este archivo.
 *   3. await SimCompradores.run();
 *      await SimCompradores.run({ solo:["C4","C7"] });
 *      SimCompradores.estado();             // avance mientras corre
 *      await SimCompradores.limpiar();      // borra SOLO estos contactos
 *
 * Los wa_id son 5198720xxxx: `limpiar()` borra por ese prefijo y no toca nada
 * más del canal.
 *
 * ⚠️ Necesita la Edge Function `tmp-sim` desplegada (se borra en las limpiezas):
 *    git checkout dced10d -- supabase/functions/tmp-sim/index.ts  y desplegarla.
 *
 * 🔴 Y HAY QUE VOLVER A DESPLEGARLA CADA VEZ QUE CAMBIA EL MOTOR. tmp-sim empaqueta
 *    su propia copia de _shared/engine.ts al desplegarse: si solo despliegas webchat y
 *    el webhook, esta bateria sigue probando el motor VIEJO y te miente en verde y en
 *    rojo. Paso una vez: 18 conversaciones contra una version de hace horas.
 *
 * 🔴 La lección de siempre: verde ≠ chat sano. Los asserts son la red de
 * seguridad; los bugs de verdad salen LEYENDO los chats en la Bandeja.
 * ═══════════════════════════════════════════════════════ */
(function () {
  const BASE = "https://ahoxdyffbwjlshmdezwi.supabase.co";
  // 🔑 La clave anónima se TOMA del panel, no se copia a mano. Copiada a mano una vez
  // salió mal y el efecto fue engañosísimo: los ENVÍOS funcionaban igual (las Edge
  // Functions validan el token del usuario, no la apikey) pero todas las LECTURAS
  // devolvían 401 — 13 de 18 escenarios en rojo con todo en `undefined`, como si el
  // producto estuviera roto. Se resuelve al cargar el script; `run()` la espera.
  let ANON = null;
  const listo = import("/Nodo/panel/shell.js")
    .then((sh) => { ANON = sh.SUPABASE_ANON_KEY; })
    .catch(() => { throw new Error("No pude leer la clave del panel — abre el panel logueado."); });
  const CH = (() => {
    try { const s = window.__nodoTest?.getSt?.(); if (s?.channelId) return s.channelId; } catch (_) {}
    try { return JSON.parse(localStorage.getItem("nodo.channelId")); } catch (_) {}
    return localStorage.getItem("nodo.channelId");
  })();
  const token = () => { try { return JSON.parse(localStorage.getItem("sb-ahoxdyffbwjlshmdezwi-auth-token")).access_token; } catch (_) { return null; } };
  const H = (repr) => ({ apikey: ANON, Authorization: "Bearer " + token(), "Content-Type": "application/json", Prefer: repr ? "return=representation" : "return=minimal" });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sel = (t, q) => fetch(`${BASE}/rest/v1/${t}?${q}`, { headers: H(true) }).then((r) => r.json());
  const del = (t, q) => fetch(`${BASE}/rest/v1/${t}?${q}`, { method: "DELETE", headers: H(false) });
  const fn = (name, body) => fetch(`${BASE}/functions/v1/${name}`, {
    method: "POST", headers: { apikey: ANON, Authorization: "Bearer " + token(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

  const send = (wa, nombre, text, extra = {}) => fn("tmp-sim", { channel_id: CH, wa_id: wa, nombre, text, ...extra });

  // Comprobante Yape sintético. `selfie:true` dibuja algo que NO es un pago,
  // para el comprador que manda una foto cualquiera al chat.
  async function foto(wa, nombre, { op, monto, quien, selfie } = {}) {
    op = op || ("0" + Math.floor(10000000 + Math.random() * 89999999));
    const c = document.createElement("canvas"); c.width = 420; c.height = 560;
    const x = c.getContext("2d");
    if (selfie) {
      x.fillStyle = "#9ca3af"; x.fillRect(0, 0, 420, 560);
      x.fillStyle = "#4b5563"; x.beginPath(); x.arc(210, 220, 90, 0, 7); x.fill();
      x.fillRect(90, 330, 240, 230);
      x.fillStyle = "#fff"; x.font = "20px Arial"; x.fillText("(foto del rostro)", 130, 520);
    } else {
      const MES = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sep.", "oct.", "nov.", "dic."];
      const d = new Date();
      const fechaStr = `${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()} - 03:14 pm`;
      x.fillStyle = "#7A3FF2"; x.fillRect(0, 0, 420, 110);
      x.fillStyle = "#fff"; x.font = "bold 30px Arial"; x.fillText("Yape", 160, 65);
      x.fillStyle = "#f5f5f5"; x.fillRect(0, 110, 420, 450); x.fillStyle = "#111";
      const L = ["Yapeaste!", "S/ " + (monto || 0) + ".00", "Para: Rodrigo Flores", "Destino: 977533352",
        "De: " + (quien || nombre), "N operacion: " + op, fechaStr];
      let y = 170; for (const t of L) { x.font = "18px Arial"; x.fillText(t, 26, y); y += 40; }
    }
    const up = await fn("media-upload", { channel_id: CH, filename: "f.png", content_type: "image/png", data: c.toDataURL("image/png") });
    if (!up.url) throw new Error("media-upload: " + JSON.stringify(up).slice(0, 120));
    await send(wa, nombre, "", { media: { kind: "image", url: up.url, mime: "image/png", caption: "" } });
    return { op, monto };
  }

  async function contacto(wa) {
    return (await sel("contacts", `select=id,stage,nombre,bot_activo,no_remarketing&channel_id=eq.${CH}&wa_id=eq.${wa}`))[0];
  }
  async function pedido(wa) {
    const c = await contacto(wa);
    if (!c) return { c: null, o: null };
    const o = (await sel("orders", `select=id,estado,amount,shipping,order_bumps&contact_id=eq.${c.id}&order=created_at.desc&limit=1`))[0];
    return { c, o };
  }
  async function dichos(wa, n = 10) {
    const c = await contacto(wa);
    if (!c) return [];
    const m = await sel("messages", `select=content,type&contact_id=eq.${c.id}&direction=eq.out&order=ts.desc&limit=${n}`);
    return (m || []).map((x) => String(x.content?.text ?? x.content?.caption ?? ""));
  }
  async function imagenes(wa) {
    const c = await contacto(wa);
    if (!c) return 0;
    const m = await sel("messages", `select=id&contact_id=eq.${c.id}&direction=eq.out&type=eq.image`);
    return (m || []).length;
  }

  // ⏱️ Cuánto se espera entre turnos. El bot real tarda 15-25 s en contestar (llama a
  // la IA, y el OCR de un comprobante más). La primera version de esta bateria esperaba
  // 4 s y los asserts miraban ANTES de que contestara: 13 de 18 en rojo con todo en
  // `undefined`, que parece un desastre del producto y era el cronometro.
  const P = 16000;        // turno normal
  const POCR = 24000;     // despues de mandar un comprobante (OCR + validacion)

  const ck = (ok, msg) => ({ ok: !!ok, msg });
  const dice = (outs, re) => outs.some((m) => re.test(m || ""));
  const DATOS = "Percy Rodrigo Flores Nuñez, 977533352, DNI 73024297";

  // ════════════════════════════════════════════════════
  // LOS COMPRADORES
  // ════════════════════════════════════════════════════
  const ESCENARIOS = [

    { id: "C1", wa: "51987200101", nombre: "Yolanda Auccapuma",
      titulo: "Pueblo con UNA sola agencia (Andahuaylas) · no debe preguntarle cuál",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero el dermachem"); await sleep(P);
        await send(wa, nombre, "soy de andahuaylas"); await sleep(P);
        await send(wa, nombre, "llevo 2 frascos, " + DATOS); await sleep(P);
        const outs = await dichos(wa, 12);
        const { o } = await pedido(wa);
        return [
          ck(!dice(outs, /cu[aá]l (te queda|prefieres)|qu[eé] otra zona/i), "no le preguntó cuál oficina (hay una sola)"),
          ck(await imagenes(wa) >= 1, "le llegó la ficha de la agencia"),
          ck(o && !o.shipping?.sede_por_confirmar, `sede sellada sin bandera (${o?.shipping?.sede})`),
        ];
      } },

    { id: "C2", wa: "51987200102", nombre: "Hermes Chuquipoma",
      titulo: "Vive donde NO hay agencia (Jequetepeque) · debe ofrecer las de su provincia",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "quiero el dermachem, soy de jequetepeque"); await sleep(P);
        await send(wa, nombre, "2 frascos"); await sleep(P);
        const outs = await dichos(wa, 12);
        return [
          ck(dice(outs, /pacasmayo|guadalupe|san pedro de lloc|ciudad de dios/i), "le ofreció oficinas reales de su provincia"),
          ck(!dice(outs, /sede de Shalom de Jequetepeque|oficina de .{0,3}Jequetepeque/i), "no le inventó una agencia en su distrito"),
        ];
      } },

    { id: "C3", wa: "51987200103", nombre: "Ruth Aliaga",
      titulo: "Ciudad con nombre repetido (Miraflores) · no debe adivinar",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola, quiero el serum. soy de miraflores"); await sleep(P);
        await send(wa, nombre, "2 frascos porfa"); await sleep(P);
        const outs = await dichos(wa, 12);
        return [ck(outs.length > 0, "respondió sin trabarse")];
      } },

    { id: "C4", wa: "51987200104", nombre: "Nilda Ccahuana",
      titulo: "Paga el TOTAL de una (S/119) · no debe seguir pidiéndole el saldo",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "quiero 2 frascos del dermachem, soy de huancayo"); await sleep(P);
        await send(wa, nombre, "la de huancayo centro. " + DATOS); await sleep(P);
        await foto(wa, nombre, { monto: 119, quien: "Nilda Ccahuana" }); await sleep(POCR);
        const { o } = await pedido(wa);
        const outs = await dichos(wa, 6);
        const saldo = Number(o?.shipping?.saldo);
        return [
          ck(o?.shipping?.pagado_total === true || saldo <= 0, `saldo tras pagar el total = ${o?.shipping?.saldo}`),
          ck(!dice(outs, /paga(r)? el saldo de \*?S\/ ?(1[0-9]{2}|99)/i), "no le volvió a cobrar el saldo entero"),
        ];
      } },

    { id: "C5", wa: "51987200105", nombre: "Fredy Mamani",
      titulo: "Paga de MÁS (S/40 en vez de S/20) · el excedente va al saldo",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "2 frascos del dermachem, soy de juliaca"); await sleep(P);
        await send(wa, nombre, "la agencia de juliaca. " + DATOS); await sleep(P);
        await foto(wa, nombre, { monto: 40, quien: "Fredy Mamani" }); await sleep(POCR);
        const { o } = await pedido(wa);
        const saldo = Number(o?.shipping?.saldo);
        return [
          ck(Number(o?.shipping?.adelanto_abonado) >= 40, `abonado=${o?.shipping?.adelanto_abonado} (pagó 40)`),
          ck(Number.isFinite(saldo) && saldo === 79, `saldo=${o?.shipping?.saldo} (esperado 79 = 119-40)`),
        ];
      } },

    { id: "C6", wa: "51987200106", nombre: "Tania Berrocal",
      titulo: "Manda el Yape ANTES de dar sus datos · no debe perderse el pago",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero 2 frascos del dermachem, soy de tacna"); await sleep(P);
        await foto(wa, nombre, { monto: 20, quien: "Tania Berrocal" }); await sleep(POCR);
        await send(wa, nombre, DATOS + ", la agencia de tacna"); await sleep(P);
        const { o } = await pedido(wa);
        const outs = await dichos(wa, 10);
        return [
          ck(!!o, "se creó el pedido"),
          ck(!!(o?.shipping?.adelanto_comprobante || o?.shipping?.adelanto_abonado), "el pago quedó enganchado al pedido"),
          ck(!dice(outs, /no recib[ií]|no me lleg[oó]/i), "no le dijo que no recibió nada"),
        ];
      } },

    { id: "C7", wa: "51987200107", nombre: "Elmer Quispe",
      titulo: "Manda DOS VECES el mismo comprobante · no debe contarlo doble",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "2 frascos del dermachem, soy de cusco"); await sleep(P);
        await send(wa, nombre, "cusco wanchaq. " + DATOS); await sleep(P);
        const op = "099887766";
        await foto(wa, nombre, { monto: 20, op, quien: "Elmer Quispe" }); await sleep(POCR);
        await foto(wa, nombre, { monto: 20, op, quien: "Elmer Quispe" }); await sleep(POCR);
        const { o } = await pedido(wa);
        return [
          ck(Number(o?.shipping?.adelanto_abonado || 0) <= 20, `abonado=${o?.shipping?.adelanto_abonado} (no debe ser 40)`),
        ];
      } },

    { id: "C8", wa: "51987200108", nombre: "Carmen Ynca",
      titulo: "Pregunta CUÁNDO llega · debe contestar con el plazo, sin fecha exacta",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "quiero el dermachem, soy de puno"); await sleep(P);
        await send(wa, nombre, "en cuantos dias me llega?"); await sleep(P);
        const outs = await dichos(wa, 6);
        return [
          ck(dice(outs, /d[ií]as|semana/i), "habló de tiempos"),
          ck(!dice(outs, /\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i), "NO le dio una fecha exacta"),
        ];
      } },

    { id: "C9", wa: "51987200109", nombre: "Rocío Palomino",
      titulo: "Cambia de agencia después de elegir una · debe quedar la última",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "2 frascos del dermachem, soy de trujillo"); await sleep(P);
        await send(wa, nombre, "la de ovalo papal"); await sleep(P);
        await send(wa, nombre, "ay no, mejor la de atahualpa. " + DATOS); await sleep(P);
        const { o } = await pedido(wa);
        return [ck(/atahualpa/i.test(String(o?.shipping?.sede || "")), `sede=${o?.shipping?.sede} (esperado Atahualpa)`)];
      } },

    { id: "C10", wa: "51987200110", nombre: "Manuel Vega",
      titulo: "Lima · lo escribe TODO en un solo mensaje",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero 3 frascos del dermachem, soy Manuel Vega, vivo en Av Brasil 1250 Jesus Maria, mi celular es 987654321"); await sleep(P);
        // En Lima el flujo EXIGE el si del cliente (campo `confirmo`), asi que el escenario
        // tiene que darlo: sin esto el pedido no nace y el rojo es del assert, no del bot.
        await send(wa, nombre, "si, confirmo"); await sleep(P);
        const { o } = await pedido(wa);
        return [
          ck(!!o, "creó el pedido de una"),
          ck(Number(o?.amount) === 149, `amount=${o?.amount} (esperado 149)`),
          ck(o?.shipping?.zona === "lima", `zona=${o?.shipping?.zona}`),
        ];
      } },

    { id: "C11", wa: "51987200111", nombre: "Vanessa Ríos",
      titulo: "Escribe 6 mensajes seguidos sin respirar · no debe atropellarse",
      run: async (s) => {
        const { wa, nombre } = s;
        send(wa, nombre, "hola"); await sleep(400);
        send(wa, nombre, "vi el anuncio"); await sleep(400);
        send(wa, nombre, "del serum"); await sleep(400);
        send(wa, nombre, "para las manchas"); await sleep(400);
        send(wa, nombre, "cuanto esta?"); await sleep(400);
        await send(wa, nombre, "soy de lince"); await sleep(P);
        const outs = await dichos(wa, 8);
        return [
          ck(outs.length > 0, "contestó"),
          ck(dice(outs, /79|119|149/), "le dio los precios"),
        ];
      } },

    { id: "C12", wa: "51987200112", nombre: "Julio Ccapa",
      titulo: "Manda una FOTO que no es comprobante · no debe darla por pago",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "2 frascos del dermachem, soy de arequipa"); await sleep(P);
        await send(wa, nombre, "arequipa av ejercito. " + DATOS); await sleep(P);
        await foto(wa, nombre, { selfie: true }); await sleep(POCR);
        const { o } = await pedido(wa);
        return [
          ck(!o?.shipping?.adelanto_abonado, `no acreditó pago (abonado=${o?.shipping?.adelanto_abonado ?? "—"})`),
          ck(o?.estado !== "adelanto_validado", `estado=${o?.estado} (no debe validarse)`),
        ];
      } },

    { id: "C13", wa: "51987200113", nombre: "Andrés Zavala",
      titulo: "Quiere pagar con TARJETA (el POS está apagado) · sin prometer",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "quiero el dermachem, soy de san borja"); await sleep(P);
        await send(wa, nombre, "puedo pagar con tarjeta al recibirlo?"); await sleep(P);
        const outs = await dichos(wa, 6);
        return [ck(!dice(outs, /s[ií].{0,20}(tarjeta|pos)|aceptamos tarjeta/i), "no prometió tarjeta")];
      } },

    { id: "C14", wa: "51987200114", nombre: "Patricia Loayza",
      titulo: "Pide BOLETA/FACTURA (no está en la ficha) · ni negar en seco ni inventar",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola, el dermachem viene con boleta o factura?"); await sleep(P);
        const outs = await dichos(wa, 6);
        return [
          ck(!dice(outs, /no (damos|emitimos|tenemos) (boleta|factura)/i), "no lo negó en seco"),
          ck(outs.length > 0, "respondió algo"),
        ];
      } },

    { id: "C15", wa: "51987200115", nombre: "Iván Portocarrero",
      titulo: "Dice “no gracias” · no debe marcarlo como que no quiere que le escriban",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "quiero 1 frasco del dermachem, soy de surco"); await sleep(P);
        await send(wa, nombre, "no gracias, solo eso"); await sleep(P);
        await send(wa, nombre, DATOS + ", Av Caminos del Inca 890"); await sleep(P);
        await send(wa, nombre, "si, confirmo"); await sleep(P);
        const { c, o } = await pedido(wa);
        return [
          ck(!c?.no_remarketing, "no lo marcó como opt-out"),
          ck(!!o, "igual cerró el pedido"),
        ];
      } },

    { id: "C16", wa: "51987200116", nombre: "Sandra Espinoza",
      titulo: "Provincia · insiste en delivery a su casa · no debe prometerlo",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "quiero el dermachem, soy de chiclayo"); await sleep(P);
        await send(wa, nombre, "no puedo ir a la agencia, me lo pueden traer a mi casa?"); await sleep(P);
        const outs = await dichos(wa, 6);
        return [ck(!dice(outs, /s[ií].{0,25}(a tu casa|a domicilio|te lo llevamos)/i), "no prometió delivery a domicilio")];
      } },

    { id: "C17", wa: "51987200117", nombre: "Alvaro Céspedes",
      titulo: "Escribe desde otro país (Bolivia) · debe ser honesto",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola, me interesa el serum. escribo desde santa cruz, bolivia"); await sleep(P);
        const outs = await dichos(wa, 6);
        return [ck(!dice(outs, /s[ií].{0,20}enviamos a bolivia|llega a bolivia/i), "no prometió envío a Bolivia")];
      } },

    { id: "C18", wa: "51987200118", nombre: "Norma Ticona",
      titulo: "Pide el más barato y después quiere que le regalen algo",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "cual es el mas barato del dermachem?"); await sleep(P);
        await send(wa, nombre, "soy de villa el salvador"); await sleep(P);
        await send(wa, nombre, "y si llevo el de 79 me das algo de regalo?"); await sleep(P);
        const outs = await dichos(wa, 8);
        return [
          ck(dice(outs, /79/), "le dijo el precio del más barato"),
          ck(!dice(outs, /te (regalo|obsequio|mando) (un|una|el|la)/i), "no inventó un regalo"),
        ];
      } },
  ];

  // ════════════════════════════════════════════════════
  async function run({ solo = null, lote = 3 } = {}) {
    await listo;                    // sin la clave del panel, las lecturas dan 401 y todo sale en rojo
    const lista = solo ? ESCENARIOS.filter((e) => solo.includes(e.id)) : ESCENARIOS;
    const st = { estado: "corriendo", t0: Date.now(), hecho: 0, total: lista.length, results: [] };
    window.__SC = st;
    const guarda = () => { try { localStorage.setItem("nodo.simCompradores", JSON.stringify(st)); } catch (_) {} };
    guarda();
    // De a pocos en paralelo: son contactos distintos, no se pisan entre ellos, y
    // así 18 conversaciones no toman media hora.
    for (let i = 0; i < lista.length; i += lote) {
      await Promise.all(lista.slice(i, i + lote).map(async (e) => {
        try {
          const checks = await e.run({ wa: e.wa, nombre: e.nombre });
          st.results.push({ id: e.id, titulo: e.titulo, wa: e.wa, checks });
        } catch (err) {
          st.results.push({ id: e.id, titulo: e.titulo, wa: e.wa, checks: [{ ok: false, msg: "REVENTÓ: " + (err?.message || err) }] });
        }
        st.hecho++; guarda();
      }));
    }
    st.estado = "listo";
    st.pass = st.results.filter((r) => r.checks.every((c) => c.ok)).length;
    st.fail = st.results.length - st.pass;
    guarda();
    return st;
  }

  const estado = () => { const s = window.__SC; return s ? `${s.estado} ${s.hecho}/${s.total}` : "sin arrancar"; };

  async function limpiar() {
    const cs = await sel("contacts", `select=id&channel_id=eq.${CH}&wa_id=like.5198720*`);
    const ids = (cs || []).map((c) => c.id);
    if (!ids.length) return { borrados: 0 };
    const inList = `(${ids.join(",")})`;
    for (const t of ["orders", "messages", "flow_runs", "contact_events", "contact_field_values", "contact_tags"]) {
      await del(t, `contact_id=in.${inList}`);
    }
    await del("contacts", `id=in.${inList}`);
    return { borrados: ids.length };
  }

  window.SimCompradores = { ESCENARIOS, run, estado, limpiar };
  console.log("%c[compradores]", "color:#0ea5e9;font-weight:bold", `${ESCENARIOS.length} compradores listos — await SimCompradores.run()`);
})();
