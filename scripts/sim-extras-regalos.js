/* ═══════════════════════════════════════════════════════
 * Nodo · EXTRAS y REGALOS, con clientes de todo el Perú
 * ───────────────────────────────────────────────────────
 * Lo que cubre `sim-compradores.js` es a la gente; esto cubre las dos cosas que
 * más plata mueven por pedido y que más se rompen en silencio:
 *
 *   · el EXTRA (order bump): se ofrece, se acepta, se rechaza, se acepta tarde,
 *     se acepta y después se arrepiente. En Lima va ANTES de cerrar; en
 *     provincia va DESPUÉS del adelanto (para no frenar el pago).
 *   · el REGALO: tiene que mencionarse como gancho, salir UNA vez en el pedido
 *     y NO cobrarse. El bug clásico es que se duplica o se cobra.
 *
 * Y todo eso desde sitios distintos del país, porque el camino cambia: Lima
 * (contraentrega, el extra se suma al total que paga en la puerta) vs provincia
 * (agencia, el extra sube el SALDO que paga al recoger).
 *
 * CÓMO USARLO
 *   1. Panel logueado. 2. Consola (F12) → pega este archivo.
 *   3. await SimExtras.run();        ·  SimExtras.estado()  ·  await SimExtras.limpiar()
 *
 * wa_id 5198730xxxx — `limpiar()` borra por ese prefijo y no toca nada más.
 *
 * ⚠️ Necesita `tmp-sim` desplegada Y AL DÍA: empaqueta su propia copia del motor,
 *    así que hay que redesplegarla cada vez que cambia engine.ts.
 * 🔴 Verde ≠ chat sano. Los asserts son la red; los bugs salen LEYENDO.
 * ═══════════════════════════════════════════════════════ */
(function () {
  const BASE = "https://ahoxdyffbwjlshmdezwi.supabase.co";
  let ANON = null;
  const listo = import("/Nodo/panel/shell.js").then((sh) => { ANON = sh.SUPABASE_ANON_KEY; });
  const CH = (() => {
    try { return JSON.parse(localStorage.getItem("nodo.channelId")); } catch (_) {}
    return localStorage.getItem("nodo.channelId");
  })();
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

  async function yape(wa, nombre, monto) {
    const MES = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sep.", "oct.", "nov.", "dic."];
    const d = new Date();
    const fecha = `${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()} - 03:14 pm`;
    const c = document.createElement("canvas"); c.width = 420; c.height = 560;
    const x = c.getContext("2d");
    x.fillStyle = "#7A3FF2"; x.fillRect(0, 0, 420, 110);
    x.fillStyle = "#fff"; x.font = "bold 30px Arial"; x.fillText("Yape", 160, 65);
    x.fillStyle = "#f5f5f5"; x.fillRect(0, 110, 420, 450); x.fillStyle = "#111";
    const op = "0" + Math.floor(10000000 + Math.random() * 89999999);
    const L = ["Yapeaste!", "S/ " + monto + ".00", "Para: Rodrigo Flores", "Destino: 977533352",
      "De: " + nombre, "N operacion: " + op, fecha];
    let y = 170; for (const t of L) { x.font = "18px Arial"; x.fillText(t, 26, y); y += 40; }
    const up = await fn("media-upload", { channel_id: CH, filename: "y.png", content_type: "image/png", data: c.toDataURL("image/png") });
    if (!up.url) throw new Error("media-upload: " + JSON.stringify(up).slice(0, 120));
    await send(wa, nombre, "", { media: { kind: "image", url: up.url, mime: "image/png", caption: "" } });
    return op;
  }

  async function contacto(wa) {
    return (await sel("contacts", `select=id,stage&channel_id=eq.${CH}&wa_id=eq.${wa}`))[0];
  }
  async function pedido(wa) {
    const c = await contacto(wa);
    if (!c) return { c: null, o: null };
    const o = (await sel("orders", `select=id,estado,amount,shipping,order_bumps&contact_id=eq.${c.id}&order=created_at.desc&limit=1`))[0];
    return { c, o };
  }
  async function dichos(wa, n = 12) {
    const c = await contacto(wa);
    if (!c) return [];
    const m = await sel("messages", `select=content&contact_id=eq.${c.id}&direction=eq.out&order=ts.desc&limit=${n}`);
    return (m || []).map((x) => String(x.content?.text ?? x.content?.caption ?? ""));
  }

  const P = 16000, POCR = 24000;
  const ck = (ok, msg) => ({ ok: !!ok, msg });
  const dice = (outs, re) => outs.some((m) => re.test(m || ""));
  const bumps = (o) => (o?.order_bumps ?? []);
  const conExtra = (o) => bumps(o).filter((b) => Number(b?.precio) > 0);
  const conRegalo = (o) => bumps(o).filter((b) => Number(b?.precio ?? 0) === 0);
  const DATOS_LIMA = "Ana Quispe Ramos, 987654321";
  const DATOS_PROV = "Ana Quispe Ramos, 987654321, DNI 45678912";

  const ESCENARIOS = [

    { id: "E1", wa: "51987300101", nombre: "Rosa Chávez", zona: "Lima · Los Olivos",
      titulo: "Lima · ACEPTA el extra → el pedido lo suma y el total sube",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola quiero el dermachem"); await sleep(P);
        await send(wa, nombre, "2 frascos, soy de los olivos"); await sleep(P);
        await send(wa, nombre, DATOS_LIMA + ", Av Universitaria 2340"); await sleep(P);
        await send(wa, nombre, "sí, agrégame el protector solar"); await sleep(P);
        await send(wa, nombre, "sí confirmo"); await sleep(P);
        const { o } = await pedido(wa);
        const ex = conExtra(o);
        return [
          ck(!!o, "creó el pedido"),
          ck(ex.length === 1, `el extra quedó UNA vez en el pedido (${ex.length})`),
          ck(Number(ex[0]?.precio) === 39, `el extra vale S/39 (${ex[0]?.precio})`),
        ];
      } },

    { id: "E2", wa: "51987300102", nombre: "Julio Paredes", zona: "Lima · Comas",
      titulo: "Lima · RECHAZA el extra → no lo suma y no lo deja en el aire",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "quiero 1 frasco del dermachem, soy de comas"); await sleep(P);
        await send(wa, nombre, DATOS_LIMA + ", Av Tupac Amaru 1500"); await sleep(P);
        await send(wa, nombre, "no gracias, solo el serum"); await sleep(P);
        await send(wa, nombre, "sí confirmo"); await sleep(P);
        const { o } = await pedido(wa);
        const outs = await dichos(wa, 6);
        return [
          ck(conExtra(o).length === 0, "NO le sumó el protector"),
          ck(outs.length > 0 && !/^\s*$/.test(outs[0]), "le contestó al 'no gracias' (sin dead-air)"),
        ];
      } },

    { id: "E3", wa: "51987300103", nombre: "Elsa Ynga", zona: "Arequipa",
      titulo: "Provincia · el extra se ofrece DESPUÉS del adelanto, no antes de pagar",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "quiero 2 frascos del dermachem, soy de arequipa"); await sleep(P);
        await send(wa, nombre, "la de av parra. " + DATOS_PROV); await sleep(P);
        const antes = await dichos(wa, 8);
        await yape(wa, nombre, 20); await sleep(POCR);
        const despues = await dichos(wa, 6);
        return [
          ck(!dice(antes, /protector solar/i), "NO le ofreció el extra antes de pagar el adelanto"),
          ck(dice(despues, /protector solar/i), "SÍ se lo ofreció después de pagar"),
        ];
      } },

    { id: "E4", wa: "51987300104", nombre: "Marco Tello", zona: "Cusco",
      titulo: "Provincia · acepta el extra tras el adelanto → sube el SALDO, no cobra de nuevo",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "2 frascos del dermachem, soy de cusco"); await sleep(P);
        await send(wa, nombre, "cusco wanchaq. " + DATOS_PROV); await sleep(P);
        await yape(wa, nombre, 20); await sleep(POCR);
        await send(wa, nombre, "ya, sumame el protector solar"); await sleep(P);
        const { o } = await pedido(wa);
        const saldo = Number(o?.shipping?.saldo);
        const outs = await dichos(wa, 6);
        return [
          ck(conExtra(o).length === 1, `el extra quedó en el pedido (${conExtra(o).length})`),
          ck(Number.isFinite(saldo) && saldo === 138, `saldo=${o?.shipping?.saldo} (esperado 138 = 119+39-20)`),
          ck(!dice(outs, /adelanto de \*?S\/ ?20/i), "no le volvió a pedir el adelanto"),
        ];
      } },

    { id: "E5", wa: "51987300105", nombre: "Nilda Huaman", zona: "Puno · Juliaca",
      titulo: "Provincia · rechaza el extra tras pagar → el saldo NO cambia",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "2 frascos del dermachem, soy de juliaca"); await sleep(P);
        await send(wa, nombre, "la de las mercedes. " + DATOS_PROV); await sleep(P);
        await yape(wa, nombre, 20); await sleep(POCR);
        await send(wa, nombre, "no gracias, así está bien"); await sleep(P);
        const { o } = await pedido(wa);
        const saldo = Number(o?.shipping?.saldo);
        return [
          ck(conExtra(o).length === 0, "no le sumó el extra"),
          ck(Number.isFinite(saldo) && saldo === 99, `saldo=${o?.shipping?.saldo} (esperado 99, sin cambios)`),
        ];
      } },

    { id: "E6", wa: "51987300106", nombre: "Betty Farfán", zona: "Piura",
      titulo: "El REGALO se menciona como gancho y va UNA vez, sin cobrarse",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola, cuanto cuesta el dermachem?"); await sleep(P);
        await send(wa, nombre, "soy de piura, llevo 3 frascos"); await sleep(P);
        await send(wa, nombre, "la de piura centro. " + DATOS_PROV); await sleep(P);
        const { o } = await pedido(wa);
        const reg = conRegalo(o);
        const outs = await dichos(wa, 10);
        return [
          ck(dice(outs, /jab[oó]n|regalo/i), "le mencionó el regalo"),
          ck(reg.length <= 1, `el regalo NO se duplicó (${reg.length})`),
          ck(Number(o?.amount) === 149, `el total sigue siendo S/149, el regalo no se cobra (${o?.amount})`),
        ];
      } },

    { id: "E7", wa: "51987300107", nombre: "Luis Ccama", zona: "Tacna",
      titulo: "Pregunta por el regalo antes de comprar · no debe prometer de más",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "hola, el dermachem viene con algo de regalo?"); await sleep(P);
        await send(wa, nombre, "soy de tacna"); await sleep(P);
        const outs = await dichos(wa, 8);
        return [
          ck(outs.length > 0, "respondió"),
          ck(!dice(outs, /dos jabones|dos de regalo|dos regalos/i), "no ofreció más de un regalo"),
        ];
      } },

    { id: "E8", wa: "51987300108", nombre: "Karina Soto", zona: "Iquitos",
      titulo: "Acepta el extra y después se ARREPIENTE · debe quitarlo del pedido",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "2 frascos del dermachem, soy de iquitos"); await sleep(P);
        await send(wa, nombre, "la de iquitos jr pablo rossel. " + DATOS_PROV); await sleep(P);
        await yape(wa, nombre, 20); await sleep(POCR);
        await send(wa, nombre, "sí, agrégame el protector"); await sleep(P);
        await send(wa, nombre, "uy no, mejor quítamelo, solo el serum"); await sleep(P);
        const { o } = await pedido(wa);
        return [ck(conExtra(o).length === 0, `el extra se quitó del pedido (quedan ${conExtra(o).length})`)];
      } },

    { id: "E9", wa: "51987300109", nombre: "Percy Ríos", zona: "Huancayo",
      titulo: "Pregunta el precio del extra antes de decidir · debe decirle S/39",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "quiero 2 frascos del dermachem, soy de huancayo"); await sleep(P);
        await send(wa, nombre, "cuanto cuesta el protector solar?"); await sleep(P);
        const outs = await dichos(wa, 6);
        return [ck(dice(outs, /39/), "le dijo el precio del extra (S/39)")];
      } },

    { id: "E10", wa: "51987300110", nombre: "Gladys Mío", zona: "Chiclayo",
      titulo: "Lima/provincia · pide DOS protectores · no debe inventar precios",
      run: async (s) => {
        const { wa, nombre } = s;
        await send(wa, nombre, "2 frascos del dermachem, soy de chiclayo"); await sleep(P);
        await send(wa, nombre, "y mandame 2 protectores solares tambien"); await sleep(P);
        const outs = await dichos(wa, 8);
        return [
          ck(outs.length > 0, "respondió"),
          ck(!dice(outs, /S\/ ?(6[0-9]|7[0-8])\b/), "no inventó un precio raro para dos protectores"),
        ];
      } },
  ];

  async function run({ solo = null, lote = 4 } = {}) {
    await listo;
    const lista = solo ? ESCENARIOS.filter((e) => solo.includes(e.id)) : ESCENARIOS;
    const st = { estado: "corriendo", t0: Date.now(), hecho: 0, total: lista.length, results: [] };
    window.__SE = st;
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

  const estado = () => { const s = window.__SE; return s ? `${s.estado} ${s.hecho}/${s.total}` : "sin arrancar"; };

  async function limpiar() {
    await listo;
    const cs = await sel("contacts", `select=id&channel_id=eq.${CH}&wa_id=like.5198730*`);
    const ids = (cs || []).map((c) => c.id);
    if (!ids.length) return { borrados: 0 };
    const inList = `(${ids.join(",")})`;
    for (const t of ["orders", "messages", "flow_runs", "contact_events", "contact_field_values", "contact_tags"]) {
      await del(t, `contact_id=in.${inList}`);
    }
    await del("contacts", `id=in.${inList}`);
    return { borrados: ids.length };
  }

  window.SimExtras = { ESCENARIOS, run, estado, limpiar };
  console.log("%c[extras]", "color:#16a34a;font-weight:bold", `${ESCENARIOS.length} escenarios — await SimExtras.run()`);
})();
