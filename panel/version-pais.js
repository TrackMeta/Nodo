// ═════════════════════════════════════════════════════════════════════════
// 🌎 Versiones del producto por país — Productos → (producto) → «🌎 Países».
// Vender el mismo producto en otro país = una VERSIÓN con su país, su moneda, sus precios y sus medios de pago.
// (29-oct, Rodrigo) Las versiones son IGUALES: ninguna es «la original». Comparten config.familia (las creadas antes
// con config.hermano_de se agrupan por ese id); cada una lleva config.pais (sin país = el país del bot). El cliente de
// un país sin versión va a la de «Para los demás países» (config.pais_resto, igual en toda la familia). El motor
// elige la versión (versionDelPais en engine.ts: anuncio → país guardado → código del número → le pregunta).
// La versión nueva nace EN PAUSA (flujos en borrador): sin sus medios de pago cobraría con los del bot.
// ═════════════════════════════════════════════════════════════════════════
import { supa, toast, icon, confirmDialog, patchProductConfig } from "./shell.js";
import { asegurarEstilos } from "./ventana-ajustes.js";
import { cargarCambios, factorCambio } from "./cambio.js?v=1";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// [código, nombre, bandera, moneda]
export const PAISES = [
  ["PE", "Perú", "🇵🇪", "PEN"], ["MX", "México", "🇲🇽", "MXN"], ["CO", "Colombia", "🇨🇴", "COP"],
  ["CL", "Chile", "🇨🇱", "CLP"], ["AR", "Argentina", "🇦🇷", "ARS"], ["EC", "Ecuador", "🇪🇨", "USD"],
  ["BO", "Bolivia", "🇧🇴", "BOB"], ["VE", "Venezuela", "🇻🇪", "USD"], ["PY", "Paraguay", "🇵🇾", "PYG"],
  ["UY", "Uruguay", "🇺🇾", "UYU"], ["CR", "Costa Rica", "🇨🇷", "CRC"], ["PA", "Panamá", "🇵🇦", "USD"],
  ["GT", "Guatemala", "🇬🇹", "GTQ"], ["SV", "El Salvador", "🇸🇻", "USD"], ["HN", "Honduras", "🇭🇳", "HNL"],
  ["NI", "Nicaragua", "🇳🇮", "NIO"], ["DO", "Rep. Dominicana", "🇩🇴", "DOP"], ["PR", "Puerto Rico", "🇵🇷", "USD"],
  ["ES", "España", "🇪🇸", "EUR"], ["US", "Estados Unidos", "🇺🇸", "USD"], ["BR", "Brasil", "🇧🇷", "BRL"],
];
const PAIS_DE_ZONA = {
  "America/Lima": "PE", "America/Bogota": "CO", "America/Mexico_City": "MX", "America/Cancun": "MX", "America/Mazatlan": "MX",
  "America/Hermosillo": "MX", "America/Tijuana": "MX", "America/Santiago": "CL", "America/Punta_Arenas": "CL",
  "America/Argentina/Buenos_Aires": "AR", "America/Guayaquil": "EC", "America/La_Paz": "BO", "America/Caracas": "VE",
  "America/Asuncion": "PY", "America/Montevideo": "UY", "America/Costa_Rica": "CR", "America/Panama": "PA",
  "America/Guatemala": "GT", "America/El_Salvador": "SV", "America/Tegucigalpa": "HN", "America/Managua": "NI",
  "America/Santo_Domingo": "DO", "America/Puerto_Rico": "PR", "Europe/Madrid": "ES", "Atlantic/Canary": "ES",
  "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US", "America/Los_Angeles": "US",
  "America/Sao_Paulo": "BR", "America/Manaus": "BR",
};
const SIMBOLO = { PEN: "S/", USD: "$", MXN: "$", COP: "$", ARS: "$", CLP: "$", BOB: "Bs", EUR: "€", BRL: "R$", UYU: "$U", PYG: "₲", VES: "Bs", GTQ: "Q", CRC: "₡", DOP: "RD$", HNL: "L", NIO: "C$", PAB: "B/." };
export function paisInfo(c) { return PAISES.find((p) => p[0] === String(c || "").toUpperCase()) || null; }
export function banderaPais(c) { return paisInfo(c)?.[2] || "🌎"; }
export function paisDeZona(tz) { return PAIS_DE_ZONA[String(tz || "")] || "PE"; }
// La familia de un producto (sus versiones por país). Un producto solo es su propia familia.
export function familiaDe(p) { const c = p?.config || {}; return String(c.familia || c.hermano_de || p?.id || ""); }
// La moneda con la que cobra: la elegida a mano → la de su país → la del bot.
export function monedaDeProducto(cfg, paisBot, monedaBot) {
  if (cfg?.moneda) return String(cfg.moneda).toUpperCase();
  if (cfg?.pais) return paisInfo(cfg.pais)?.[3] || monedaBot || "PEN";
  return monedaBot || paisInfo(paisBot)?.[3] || "PEN";
}

// Reemplaza en un valor (objeto, texto) cada id viejo por el nuevo: las versiones, los flujos, los nodos y las
// secuencias se copian con ids nuevos, y la config, los nodos y los pasos del remarketing los nombran por id.
function remap(val, mapa) {
  if (val == null || !mapa.size) return val;
  let s = JSON.stringify(val);
  for (const [viejo, nuevo] of mapa) s = s.split(viejo).join(nuevo);
  return JSON.parse(s);
}
const sin = (o, ...k) => { const c = { ...o }; for (const x of k) delete c[x]; return c; };

// Copia el producto `origenId` como versión para `pais`. La copia entra en la familia `familia`.
async function crearVersion({ origenId, familia, pais, moneda, precios, ofertas }) {
  const info = paisInfo(pais);
  const creado = { producto: null, secuencias: [] };
  try {
    const { data: base, error: eB } = await supa.from("products").select("*").eq("id", origenId).single();
    if (eB || !base) throw new Error("No se encontró el producto");
    const cfg0 = base.config || {};
    const [{ data: vers }, { data: flows }, { data: angs }] = await Promise.all([
      supa.from("product_versions").select("*").eq("product_id", origenId).order("orden"),
      supa.from("flows").select("*").eq("product_id", origenId),
      supa.from("angulos").select("*").eq("product_id", origenId).order("orden"),
    ]);
    const flowIds = (flows || []).map((f) => f.id);
    const [{ data: nodes }, { data: edges }, { data: trigs }] = flowIds.length ? await Promise.all([
      supa.from("flow_nodes").select("*").in("flow_id", flowIds),
      supa.from("flow_edges").select("*").in("flow_id", flowIds),
      supa.from("flow_triggers").select("*").in("flow_id", flowIds),
    ]) : [{ data: [] }, { data: [] }, { data: [] }];
    const seqIds = [...new Set([...Object.values(cfg0.remarketing_seqs || {}), cfg0.remarketing_seq_id].filter(Boolean).map(String))];
    const { data: seqs } = seqIds.length ? await supa.from("sequences").select("*").in("id", seqIds) : { data: [] };

    const mapa = new Map();
    // El MISMO nombre: lo nombra la IA ante el cliente («Reto Abdomen (México)» sonaría raro). En el panel el país
    // se ve con su bandera.
    const nombre = base.nombre;
    const etiqueta = `${info?.[2] || ""} ${info?.[1] || pais}`.trim();
    // 1) El producto. Sin los anuncios (cada anuncio es de UN país: se asignan en la versión) ni los medios de pago
    //    propios (los de otro país se ponen en la versión).
    // (el costo y el empaque están en la moneda del original: en la versión nueva se ponen en la suya)
    const cfg = sin(cfg0, "ad_bank", "pago_propio", "hermano_de", "costo", "empaque");
    cfg.pais = pais; cfg.moneda = moneda; cfg.familia = familia;
    const { data: pNew, error: eP } = await supa.from("products")
      .insert({ ...sin(base, "id", "created_at", "updated_at"), nombre, config: cfg }).select("id").single();
    if (eP) throw eP;
    creado.producto = pNew.id;
    // Lo que nombra al producto (la oferta del remarketing: {product_id, version_id, precio}) pasa a nombrar la copia.
    // Sin esto la oferta de la versión de México seguía apuntando al original y el motor no la aplicaba.
    mapa.set(origenId, pNew.id);
    // 2) Las versiones (Básica / Premium / packs), con el precio en la moneda nueva.
    for (const v of vers || []) {
      const precio = precios[v.id];
      const { data: vN, error } = await supa.from("product_versions")
        .insert({ ...sin(v, "id", "created_at", "updated_at"), product_id: pNew.id, precio: precio === "" || precio == null ? null : Number(precio), costo: null })
        .select("id").single();
      if (error) throw error;
      mapa.set(v.id, vN.id);
    }
    // 3) Las secuencias de remarketing del producto (con sus ofertas, que nombran la versión).
    for (const s of seqs || []) {
      const { data: sN, error } = await supa.from("sequences")
        .insert({ ...sin(s, "id", "created_at", "updated_at"), nombre: `${s.nombre} · ${etiqueta}`, pasos: [] }).select("id").single();
      if (error) throw error;
      creado.secuencias.push(sN.id);
      mapa.set(s.id, sN.id);
    }
    // 4) Los flujos (saludo y venta), EN PAUSA: la versión no vende hasta que tenga sus medios de pago.
    for (const f of flows || []) {
      const { data: fN, error } = await supa.from("flows").insert({
        ...sin(f, "id", "created_at", "updated_at"), product_id: pNew.id, es_entrada: false, estado: "borrador",
        // (solo se quita la etiqueta de país de una copia anterior —«· 🇲🇽 México»—, no el nombre del producto)
        nombre: `${String(f.nombre || "").replace(/ · [\u{1F1E6}-\u{1F1FF}]{2} [^·]+$/u, "")} · ${etiqueta}`,
      }).select("id").single();
      if (error) throw error;
      mapa.set(f.id, fN.id);
    }
    for (const n of nodes || []) {
      const { data: nN, error } = await supa.from("flow_nodes")
        .insert({ ...sin(n, "id", "created_at"), flow_id: mapa.get(n.flow_id), config: remap(n.config, mapa) }).select("id").single();
      if (error) throw error;
      mapa.set(n.id, nN.id);
    }
    const eds = (edges || []).map((e) => ({ ...sin(e, "id", "created_at"), flow_id: mapa.get(e.flow_id), source_node: mapa.get(e.source_node), target_node: mapa.get(e.target_node) }))
      .filter((e) => e.flow_id && e.source_node && e.target_node);
    if (eds.length) { const { error } = await supa.from("flow_edges").insert(eds); if (error) throw error; }
    // La misma palabra clave: el motor pasa a cada cliente a la versión de su país.
    const trs = (trigs || []).filter((t) => t.tipo !== "referral")
      .map((t) => ({ ...sin(t, "id", "created_at"), flow_id: mapa.get(t.flow_id), config: remap(t.config, mapa) })).filter((t) => t.flow_id);
    if (trs.length) { const { error } = await supa.from("flow_triggers").insert(trs); if (error) throw error; }
    // 5) Los ángulos (nombre, enfoque de la IA), sin anuncios.
    const ans = (angs || []).map((a) => ({ ...sin(a, "id", "created_at", "updated_at"), product_id: pNew.id, ad_ids: [] }));
    if (ans.length) { const { error } = await supa.from("angulos").insert(ans); if (error) throw error; }
    // 6) Los pasos del remarketing y la config, con los ids nuevos.
    for (const s of seqs || []) {
      const pasos = remap(s.pasos, mapa);
      // El precio de cada oferta en la moneda nueva (lo que puso en la ventana; si no, se borra: un 7 en pesos no es oferta).
      (Array.isArray(pasos) ? pasos : []).forEach((p, i) => {
        if (!p?.oferta) return;
        const nuevo = Number((ofertas?.[s.id] || {})[i]);
        if (nuevo > 0) p.oferta.precio = nuevo; else delete p.oferta;
      });
      const { error } = await supa.from("sequences").update({ pasos }).eq("id", mapa.get(s.id));
      if (error) throw error;
    }
    const cfgF = remap(cfg, mapa); cfgF.familia = familia;   // (la familia es el id de la primera versión: no se cambia)
    const { error: eC } = await supa.from("products").update({ config: cfgF }).eq("id", pNew.id);
    if (eC) throw eC;
    return pNew.id;
  } catch (e) {
    // A medias no sirve: se borra lo creado (el producto arrastra versiones, flujos y ángulos).
    try { if (creado.producto) await supa.from("products").delete().eq("id", creado.producto); } catch (_) {}
    try { if (creado.secuencias.length) await supa.from("sequences").delete().in("id", creado.secuencias); } catch (_) {}
    throw e;
  }
}

export async function abrirVersionesPais({ channelId, prod, onAbrir, onCambio }) {
  if (!channelId || !prod) return;
  asegurarEstilos();
  const [{ data: prods }, { data: ch }, { data: vers }] = await Promise.all([
    supa.from("products").select("id, nombre, config, tipo").eq("channel_id", channelId),
    supa.from("channels").select("timezone, moneda").eq("id", channelId).maybeSingle(),
    supa.from("product_versions").select("id, nombre, precio, activo").eq("product_id", prod.id).order("orden"),
  ]);
  const paisBot = paisDeZona(ch?.timezone || "America/Lima");
  // Las ofertas (con descuento) del remarketing de esta versión, para ponerles su precio en la moneda nueva.
  const _cfgP = (prods || []).find((p) => p.id === prod.id)?.config || prod.config || {};
  const _seqIds = [...new Set([...Object.values(_cfgP.remarketing_seqs || {}), _cfgP.remarketing_seq_id].filter(Boolean).map(String))];
  const { data: _seqs } = _seqIds.length ? await supa.from("sequences").select("id, nombre, pasos").in("id", _seqIds) : { data: [] };
  const ofertasHoy = [];
  for (const sq of _seqs || []) (Array.isArray(sq.pasos) ? sq.pasos : []).forEach((p, i) => {
    if (p?.oferta && Number(p.oferta.precio) > 0) ofertasHoy.push({ seq: sq.id, i, precio: Number(p.oferta.precio), version: (vers || []).find((v) => v.id === p.oferta.version_id)?.nombre || "" });
  });
  const cambios = ofertasHoy.length ? await cargarCambios() : {};
  const yo = (prods || []).find((p) => p.id === prod.id) || prod;
  const clave = familiaDe(yo);
  const fam = (prods || []).filter((p) => familiaDe(p) === clave);
  const paisDe = (p) => String(p.config?.pais || paisBot).toUpperCase();
  const usados = new Set(fam.map(paisDe));
  const libres = PAISES.filter((p) => !usados.has(p[0]));
  const versA = (vers || []).filter((v) => v.activo !== false);
  const monYo = monedaDeProducto(yo.config, paisBot, ch?.moneda);
  const miPais = paisDe(yo);
  // «Para los demás países»: el que diga la familia; si nadie eligió, la primera versión (la que dio el id).
  const restoGuardado = String(fam.find((p) => p.config?.pais_resto)?.config?.pais_resto || "").toUpperCase();
  const resto = fam.some((p) => paisDe(p) === restoGuardado) ? restoGuardado : paisDe(fam.find((p) => p.id === clave) || fam[0]);

  const ov = document.createElement("div"); ov.className = "ajp-ov";
  const fila = (p) => {
    const c = paisDe(p), i = paisInfo(c);
    const mon = monedaDeProducto(p.config, paisBot, ch?.moneda);
    const falta = fam.length > 1 && c !== paisBot && !(p.config?.pago_propio?.metodos || []).length;
    return `<div class="ajp-tog" style="cursor:default">
      <div><b>${i ? i[2] + " " + esc(i[1]) : "🌎 " + esc(c)}${p.id === prod.id ? ' <small style="display:inline;color:var(--brand)">· estás aquí</small>' : ""}</b>
        <small>Cobra en ${esc(SIMBOLO[mon] || "")} ${esc(mon)}${falta ? ' · <span style="color:var(--amber,#d97706)">⚠️ falta ponerle sus medios de pago</span>' : ""}</small></div>
      ${p.id === prod.id ? "" : `<button class="ajp-btn" data-abrir="${esc(p.id)}">Abrir</button>`}
    </div>`;
  };
  const opcionesPais = (sel, excluir) => PAISES.filter((p) => p[0] === sel || !excluir.has(p[0]))
    .map((p) => `<option value="${p[0]}" ${p[0] === sel ? "selected" : ""}>${p[2]} ${esc(p[1])}</option>`).join("");
  ov.innerHTML = `<div class="ajp" role="dialog" aria-label="Países">
    <div class="ajp-hd"><h3>🌎 Países</h3><button class="ajp-x" id="vpX" title="Cerrar">${icon("x")}</button></div>
    <p class="ajp-sub">Vende <b>${esc(yo.nombre)}</b> en varios países, cada uno con su moneda, sus precios y sus medios de pago. El bot manda a cada cliente a la versión de su país: por el anuncio, por el código de su número o preguntándole.</p>
    <div class="ajp-card"><h4>País de esta versión</h4>
      <p class="ajp-desc">Define su moneda y su hora con los clientes.</p>
      <select class="ajp-in" id="vpMiPais" style="width:100%;max-width:320px;margin-top:6px">${opcionesPais(miPais, new Set([...usados].filter((c) => c !== miPais)))}</select>
    </div>
    <div class="ajp-card"><h4>Versiones de este producto</h4>${fam.map(fila).join("")}
      ${fam.length > 1 ? `<span class="ajp-lbl">Para los demás países</span>
      <p class="ajp-desc" style="margin-top:0">El cliente de un país sin versión entra a esta.</p>
      <select class="ajp-in" id="vpResto" style="width:100%;max-width:320px">${fam.map((p) => { const i = paisInfo(paisDe(p)); return `<option value="${paisDe(p)}" ${paisDe(p) === resto ? "selected" : ""}>${i ? i[2] + " " + esc(i[1]) : esc(paisDe(p))}</option>`; }).join("")}</select>` : ""}
    </div>
    ${fam.length > 1 ? `<div class="ajp-card"><h4>Pasar cambios a las otras versiones</h4>
      <p class="ajp-desc">Copia lo de esta versión a las demás. No toca precios, moneda, medios de pago ni anuncios.</p>
      <label class="ajp-tog"><div><b>Ficha de la IA</b><small>Qué es, detalles, preguntas frecuentes, objeciones y cómo vende</small></div><input type="checkbox" id="vpPfFicha" checked></label>
      <label class="ajp-tog"><div><b>Saludo</b><small>Los mensajes iniciales (todas sus versiones y ángulos)</small></div><input type="checkbox" id="vpPfSal"></label>
      <span class="ajp-lbl">A estas versiones</span>
      ${fam.filter((p) => p.id !== prod.id).map((p) => { const i = paisInfo(paisDe(p)); return `<label class="ajp-tog" style="padding:8px 12px"><div><b>${i ? i[2] + " " + esc(i[1]) : esc(paisDe(p))}</b></div><input type="checkbox" data-pf="${esc(p.id)}" checked></label>`; }).join("")}
      <div class="ajp-hint">Si la ficha o el saludo tienen precios escritos a mano, revísalos después en cada versión: están en la moneda de esta.</div>
      <div class="ajp-acts"><button class="ajp-btn pri" id="vpPasar">Pasar a las versiones elegidas</button></div>
    </div>` : ""}
    ${prod.tipo === "fisico" ? `<div class="ajp-nota"><span>📦 Los productos físicos se venden solo en el país del bot (agencias, distritos, adelantos). Las versiones por país son para productos digitales y micro apps.</span></div>` : libres.length ? `
    <div class="ajp-card"><h4>＋ Agregar país</h4>
      <p class="ajp-desc">Se copia esta versión: ficha, saludo, palabra clave, presentaciones, ángulos y remarketing. Los anuncios y los medios de pago <b>no</b> se copian: son de cada país.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
        <label style="flex:1;min-width:180px"><span class="ajp-lbl" style="margin-top:0">País</span>
          <select class="ajp-in" id="vpPais" style="width:100%">${libres.map((p) => `<option value="${p[0]}">${p[2]} ${esc(p[1])}</option>`).join("")}</select></label>
      </div>
      <div class="ajp-hint" id="vpMonTxt"></div>
      <span class="ajp-lbl">Precios en la moneda de ese país</span>
      ${versA.map((v) => `<div class="ajp-num" style="margin-top:6px"><span style="min-width:150px;color:var(--muted);font-weight:700">${esc(v.nombre || "Precio")}</span>
        <div class="box"><span class="vpSym">$</span><input type="number" min="0" step="0.01" data-v="${esc(v.id)}" placeholder="0"/></div>
        <small>En esta versión: ${esc(SIMBOLO[monYo] || "")} ${esc(v.precio ?? "—")}</small></div>`).join("")}
      ${ofertasHoy.length ? `<span class="ajp-lbl">Ofertas del remarketing</span>
      <p class="ajp-desc" style="margin-top:0">Propuestas con el tipo de cambio de hoy. Cámbialas si quieres un número redondo; vacía = sin oferta.</p>
      ${ofertasHoy.map((o, k) => `<div class="ajp-num" style="margin-top:6px"><span style="min-width:150px;color:var(--muted);font-weight:700">Toque ${o.i + 1}${o.version ? " · " + esc(o.version) : ""}</span>
        <div class="box"><span class="vpSym">$</span><input type="number" min="0" step="0.01" data-of="${k}" placeholder="0"/></div>
        <small>En esta versión: ${esc(SIMBOLO[monYo] || "")} ${esc(o.precio)}</small></div>`).join("")}` : ""}
      <div class="ajp-nota"><span>⏸️ La versión nueva nace <b>en pausa</b>. Antes de reanudarla ponle sus <b>medios de pago</b> (ficha → Avanzado → «Medios de pago propios»), revisa los textos que tengan precios escritos a mano y asigna los anuncios de ese país en su banco de anuncios.</span></div>
      <div class="ajp-acts"><button class="ajp-btn pri" id="vpCrear">Crear versión</button></div>
    </div>` : `<div class="ajp-nota">Ya hay una versión para cada país de la lista.</div>`}
  </div>`;
  document.body.appendChild(ov);
  const cerrar = () => ov.remove();
  ov.querySelector("#vpX").onclick = cerrar;
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) cerrar(); });
  ov.querySelectorAll("[data-abrir]").forEach((b) => { b.onclick = () => { cerrar(); onAbrir && onAbrir(b.dataset.abrir); }; });

  // Toda la familia guarda la misma clave (así se agrupan aunque se borre la primera versión).
  const sellarFamilia = async () => {
    for (const p of fam) if (!p.config?.familia) await patchProductConfig(p.id, (c) => { c.familia = clave; delete c.hermano_de; });
  };

  // País de esta versión: cambia su moneda (salvo que la hayan elegido a mano) y su hora con los clientes.
  const selMi = ov.querySelector("#vpMiPais");
  selMi.onchange = async () => {
    const nuevo = selMi.value, iN = paisInfo(nuevo);
    const monManual = yo.config?.moneda && yo.config.moneda !== (paisInfo(miPais)?.[3] || "");
    if (!await confirmDialog({ title: "Cambiar el país de esta versión",
      message: `Esta versión pasa a ser de ${iN?.[1] || nuevo}${monManual ? "" : `: cobrará en ${iN?.[3] || ""}`} y usará la hora de ese país con sus clientes. Revisa sus precios${fam.length > 1 ? "" : " y sus medios de pago"}.`,
      confirmText: "Cambiar" })) { selMi.value = miPais; return; }
    const r = await patchProductConfig(yo.id, (c) => { c.pais = nuevo; if (!monManual) c.moneda = iN?.[3] || c.moneda; });
    if (!r.ok) { toast(r.error?.message || "No se pudo guardar", true); selMi.value = miPais; return; }
    toast(`Ahora es la versión de ${iN?.[1] || nuevo}`);
    cerrar(); onCambio && onCambio(yo.id);
  };
  // Pasar la ficha y/o el saludo de esta versión a las otras. La ficha = las claves de la ficha de la IA; de config.ia se
  // conserva el «método de pago especial» de cada versión (es de su país).
  const FICHA = ["contexto_producto", "ia", "ia_multimedia", "faq", "faq_items", "objeciones", "objeciones_items", "emojis", "intencion"];
  const btnPasar = ov.querySelector("#vpPasar");
  if (btnPasar) btnPasar.onclick = async () => {
    const ficha = ov.querySelector("#vpPfFicha").checked, saludo = ov.querySelector("#vpPfSal").checked;
    const destinos = [...ov.querySelectorAll("input[data-pf]")].filter((x) => x.checked).map((x) => x.dataset.pf);
    if (!ficha && !saludo) { toast("Elige qué pasar: la ficha, el saludo o los dos", true); return; }
    if (!destinos.length) { toast("Elige al menos una versión", true); return; }
    const nombres = destinos.map((id) => paisInfo(paisDe(fam.find((p) => p.id === id)))?.[1] || "").join(", ");
    if (!await confirmDialog({ title: "Pasar cambios",
      message: `Se reemplaza ${ficha && saludo ? "la ficha y el saludo" : ficha ? "la ficha de la IA" : "el saludo"} de ${nombres} con lo de esta versión.`, confirmText: "Pasar" })) return;
    btnPasar.disabled = true; btnPasar.textContent = "Pasando…";
    try {
      const { data: src } = await supa.from("products").select("config").eq("id", yo.id).single();
      const cfgS = src?.config || {};
      let rotS = null;
      if (saludo) {
        const { data: fS } = await supa.from("flows").select("id").eq("product_id", yo.id).eq("role", "mensajes_iniciales").limit(1).maybeSingle();
        if (fS) { const { data: nS } = await supa.from("flow_nodes").select("config").eq("flow_id", fS.id).eq("tipo", "rotador").limit(1).maybeSingle(); rotS = nS?.config || null; }
      }
      let sinSaludo = 0;
      for (const id of destinos) {
        if (ficha) {
          const r = await patchProductConfig(id, (c) => {
            const metodo = c.ia?.metodos_pago;
            for (const k of FICHA) { if (k in cfgS) c[k] = JSON.parse(JSON.stringify(cfgS[k])); else delete c[k]; }
            if (c.ia && typeof c.ia === "object") { if (metodo != null) c.ia.metodos_pago = metodo; else delete c.ia.metodos_pago; }
          });
          if (!r.ok) throw r.error || new Error("no se pudo guardar la ficha");
        }
        if (saludo && rotS) {
          const { data: fD } = await supa.from("flows").select("id").eq("product_id", id).eq("role", "mensajes_iniciales").limit(1).maybeSingle();
          const { data: nD } = fD ? await supa.from("flow_nodes").select("id").eq("flow_id", fD.id).eq("tipo", "rotador").limit(1).maybeSingle() : { data: null };
          if (nD) { const { error } = await supa.from("flow_nodes").update({ config: JSON.parse(JSON.stringify(rotS)) }).eq("id", nD.id); if (error) throw error; }
          else sinSaludo++;
        }
      }
      toast(`Listo: pasado a ${nombres}` + (sinSaludo ? ` (${sinSaludo} sin saludo propio, no se tocó)` : ""));
      btnPasar.textContent = "Pasado ✓";
    } catch (e) {
      toast("No se pudo pasar: " + (e?.message || e), true);
      btnPasar.disabled = false; btnPasar.textContent = "Pasar a las versiones elegidas";
    }
  };
  const selR = ov.querySelector("#vpResto");
  if (selR) selR.onchange = async () => {
    await sellarFamilia();
    for (const p of fam) await patchProductConfig(p.id, (c) => { c.pais_resto = selR.value; });
    toast(`Los demás países entran a la versión de ${paisInfo(selR.value)?.[1] || selR.value}`);
  };

  const selP = ov.querySelector("#vpPais");
  const pintaMon = () => {
    if (!selP) return;
    const m = paisInfo(selP.value)?.[3] || "USD";
    ov.querySelectorAll(".vpSym").forEach((s) => { s.textContent = SIMBOLO[m] || "$"; });
    ov.querySelector("#vpMonTxt").textContent = `Cobrará en ${SIMBOLO[m] || ""} ${m}.`;
    // Ofertas: el monto de esta versión llevado a la moneda nueva con el cambio de hoy, redondeado como se cobra.
    const fx = factorCambio(cambios, monYo, m, new Date().toISOString());
    const redondo = (x) => x < 100 ? Math.round(x) : x < 1000 ? Math.round(x / 5) * 5 : x < 10000 ? Math.round(x / 10) * 10 : Math.round(x / 100) * 100;
    ov.querySelectorAll("input[data-of]").forEach((inp) => { const o = ofertasHoy[+inp.dataset.of]; inp.value = fx ? String(redondo(o.precio * fx)) : ""; });
  };
  if (selP) { selP.onchange = pintaMon; pintaMon(); }
  const btn = ov.querySelector("#vpCrear");
  if (btn) btn.onclick = async () => {
    const precios = {};
    let falta = false;
    ov.querySelectorAll("input[data-v]").forEach((i) => { precios[i.dataset.v] = i.value.trim(); if (!i.value.trim()) falta = true; });
    if (falta) { toast("Ponle precio a cada presentación en la moneda de ese país", true); return; }
    btn.disabled = true; btn.textContent = "Creando…";
    try {
      await sellarFamilia();
      const ofertas = {};
      ov.querySelectorAll("input[data-of]").forEach((inp) => { const o = ofertasHoy[+inp.dataset.of]; (ofertas[o.seq] ||= {})[o.i] = inp.value.trim(); });
      const id = await crearVersion({ origenId: yo.id, familia: clave, pais: selP.value, moneda: paisInfo(selP.value)?.[3] || "USD", precios, ofertas });
      toast(`Versión ${paisInfo(selP.value)?.[1] || ""} creada — en pausa hasta que le pongas sus medios de pago`);
      cerrar();
      onAbrir && onAbrir(id);
    } catch (e) {
      toast("No se pudo crear la versión: " + (e?.message || e), true);
      btn.disabled = false; btn.textContent = "Crear versión";
    }
  };
}
