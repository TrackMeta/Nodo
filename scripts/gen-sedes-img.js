/* ═══════════════════════════════════════
 * Nodo · Generador de FICHAS de las oficinas Shalom  (una sola vez)
 * ───────────────────────────────────────
 * Dibuja una tarjeta por oficina —nombre, departamento/provincia/distrito,
 * dirección y referencia—, la sube al bucket `media` y guarda la URL en la tabla
 * `sede_imagenes`. El motor la manda cuando le confirma la sede al cliente.
 *
 * NO son fotos del local: son los datos que ya tenemos, dibujados. Sirve para lo
 * mismo que sirve la ficha de Shalom — el cliente la reenvía a quien va a recoger
 * o se la muestra al mototaxista sin tener que copiar una dirección a mano.
 *
 * CÓMO USARLO
 *   1. Abre el panel logueado (cualquier sección).
 *   2. Consola (F12) y pega este archivo.
 *   3. await GenSedes.run();          // todas las que falten
 *      await GenSedes.run({ soloUna:true });   // una sola, para mirarla antes
 *      await GenSedes.run({ rehacer:true });   // rehace las que ya existen
 *
 * Es idempotente: salta las que ya están en `sede_imagenes`, así que se puede
 * cortar a la mitad y volver a correr. Tarda ~10 min las 552 la primera vez.
 *
 * La lista de agencias se lee del ARCHIVO DEL MOTOR (shalom-agencias.ts), no de
 * una copia: el array es un literal JS, se recorta y se evalúa. Así no existe una
 * segunda lista que se desincronice el día que Shalom abra una oficina.
 * ═══════════════════════════════════════ */
(() => {
  const RAW = "https://raw.githubusercontent.com/TrackMeta/Nodo/main/supabase/functions/_shared/shalom-agencias.ts";

  const _n = (s) => String(s ?? "").toUpperCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]+/g, " ").trim();
  const slugAgencia = (a) => [a.d, a.p, a.t, a.l].map(_n).join("-")
    .replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

  // Título con mayúscula inicial: los datos vienen EN MAYÚSCULAS de la fuente y
  // una tarjeta entera gritando no se lee.
  const MENOR = new Set(["de", "del", "la", "las", "los", "y", "a", "el", "en", "por"]);
  const bonito = (s) => String(s ?? "").toLowerCase().split(/\s+/)
    .map((w, i) => (i && MENOR.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

  async function agencias() {
    const src = await (await fetch(RAW + "?v=" + Date.now())).text();
    const i = src.indexOf("export const AGENCIAS");
    if (i < 0) throw new Error("No encuentro AGENCIAS en shalom-agencias.ts");
    // OJO: el "[" del TIPO ("Agencia[]") viene antes que el del array y abre y cierra
    // en el acto — arrancar ahi devolvia una lista vacia. Se busca desde el "=".
    const ini = src.indexOf("[", src.indexOf("=", i));
    let prof = 0, fin = -1;
    for (let k = ini; k < src.length; k++) {
      if (src[k] === "[") prof++;
      else if (src[k] === "]") { prof--; if (!prof) { fin = k; break; } }
    }
    if (fin < 0) throw new Error("El array de AGENCIAS no cierra");
    return (0, eval)("(" + src.slice(ini, fin + 1) + ")");
  }

  // ── La tarjeta ────────────────────────────────────────────────────────
  // Tamaño pensado para WhatsApp: se ve completa en la burbuja sin abrirla.
  // La dirección de Shalom termina repitiendo la ciudad y además viene CORTADA en
  // la fuente ("... PISO 1 TRUJILLO - TRUJILL"). Ese rabo no informa y encima se lee
  // como un error, así que se le quita cuando lo último es el distrito o la provincia
  // (entera o a medias).
  function _dirLimpia(a) {
    const partes = String(a.dir ?? "").split(/\s+-\s+|,/).map((p) => p.trim()).filter(Boolean);
    const lugar = [_n(a.t), _n(a.p), _n(a.d)];
    while (partes.length > 1) {
      const u = _n(partes[partes.length - 1]);
      if (u.length >= 4 && lugar.some((L) => L.startsWith(u) || u.startsWith(L))) partes.pop();
      else break;
    }
    return partes.join(" - ");
  }

  function dibuja(a) {
    const W = 900, P = 56;
    // Primero se MIDE, después se dibuja: una oficina con dirección corta y sin
    // referencia dejaba media tarjeta en blanco, y en el chat eso se ve como un
    // error de carga. El alto lo decide el contenido.
    const medir = document.createElement("canvas").getContext("2d");
    medir.font = "27px Arial, sans-serif";
    const lDir = parte(medir, bonito(_dirLimpia(a)), W - P * 2, 2);
    medir.font = "24px Arial, sans-serif";
    const lRef = a.ref ? parte(medir, bonito(a.ref), W - P * 2, 2) : [];
    const H = 278 + lDir.length * 38 + (lRef.length ? 56 + lRef.length * 34 : 0) + 60;

    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");

    x.fillStyle = "#ffffff"; x.fillRect(0, 0, W, H);
    // Franja de color arriba: le da identidad y separa la ficha del fondo del chat.
    x.fillStyle = "#E4002B"; x.fillRect(0, 0, W, 14);

    // Pin
    x.fillStyle = "#E4002B";
    x.beginPath(); x.arc(P + 26, 118, 26, Math.PI, 0); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(P, 118); x.lineTo(P + 26, 168); x.lineTo(P + 52, 118); x.closePath(); x.fill();
    x.fillStyle = "#ffffff"; x.beginPath(); x.arc(P + 26, 114, 9, 0, 7); x.fill();

    // Nombre de la oficina
    x.fillStyle = "#111827"; x.font = "bold 42px Arial, sans-serif";
    const nombre = bonito(a.l).toUpperCase();
    let ln = nombre, tam = 42;
    while (x.measureText(ln).width > W - P * 2 - 90 && tam > 26) { tam -= 2; x.font = `bold ${tam}px Arial, sans-serif`; }
    x.fillText(ln, P + 90, 132);

    // Departamento / provincia / distrito
    x.fillStyle = "#6B7280"; x.font = "24px Arial, sans-serif";
    x.fillText([a.d, a.p, a.t].map(bonito).join("  /  "), P, 218);

    // Dirección (parte en dos líneas si no entra)
    x.fillStyle = "#111827"; x.font = "27px Arial, sans-serif";
    let y = 278;
    for (const linea of lDir) { x.fillText(linea, P, y); y += 38; }

    // Referencia
    if (lRef.length) {
      x.fillStyle = "#E4002B"; x.font = "bold 21px Arial, sans-serif";
      x.fillText("REFERENCIA", P, y + 22);
      x.fillStyle = "#374151"; x.font = "24px Arial, sans-serif";
      y += 56;
      for (const linea of lRef) { x.fillText(linea, P, y); y += 34; }
    }

    // Pie
    x.fillStyle = "#9CA3AF"; x.font = "20px Arial, sans-serif";
    x.fillText("Agencia Shalom · recoge con tu DNI y la clave que te enviamos", P, H - 34);
    return c.toDataURL("image/png");
  }

  // Parte un texto en como mucho `max` líneas; si sobra, corta con puntos suspensivos.
  function parte(x, txt, ancho, max) {
    const pal = String(txt ?? "").split(/\s+/).filter(Boolean);
    const out = []; let act = "";
    for (const p of pal) {
      const test = act ? act + " " + p : p;
      if (x.measureText(test).width > ancho && act) { out.push(act); act = p; if (out.length === max) break; }
      else act = test;
    }
    if (out.length < max && act) out.push(act);
    if (out.length === max && x.measureText(out[max - 1]).width > ancho) out[max - 1] = out[max - 1].slice(0, -3) + "…";
    return out;
  }

  async function sube(sh, dataUrl, slug) {
    const tok = (await sh.supa.auth.getSession()).data.session.access_token;
    const r = await fetch(sh.SUPABASE_URL + "/functions/v1/media-upload", {
      method: "POST",
      headers: { apikey: sh.SUPABASE_ANON_KEY, Authorization: "Bearer " + tok, "Content-Type": "application/json" },
      body: JSON.stringify({ data: dataUrl, filename: slug + ".png", content_type: "image/png" }),
    });
    const j = await r.json();
    if (!j?.url) throw new Error("media-upload: " + JSON.stringify(j).slice(0, 160));
    return j.url;
  }

  async function run({ soloUna = false, rehacer = false } = {}) {
    const sh = await import("/Nodo/panel/shell.js");
    const AG = await agencias();
    const { data: ya } = await sh.supa.from("sede_imagenes").select("slug");
    const hechas = new Set((ya || []).map((r) => r.slug));
    const faltan = AG.filter((a) => rehacer || !hechas.has(slugAgencia(a)));
    const lote = soloUna ? faltan.slice(0, 1) : faltan;
    console.log(`Fichas: ${AG.length} oficinas · ${hechas.size} ya hechas · ${lote.length} por hacer`);
    let ok = 0; const fallos = [];
    for (const a of lote) {
      const slug = slugAgencia(a);
      try {
        const url = await sube(sh, dibuja(a), slug);
        const { error } = await sh.supa.from("sede_imagenes")
          .upsert({ slug, url, nombre: `${a.l} · ${a.t} · ${a.d}` });
        if (error) throw new Error(error.message);
        ok++;
        if (ok % 25 === 0) console.log(`  ${ok}/${lote.length}…`);
      } catch (e) { fallos.push(slug + ": " + (e?.message || e)); }
    }
    console.log(`Listas ${ok}/${lote.length}`, fallos.length ? fallos.slice(0, 5) : "sin fallos");
    return { ok, fallos, total: AG.length };
  }

  window.GenSedes = { run, dibuja, agencias, slugAgencia };
})();
