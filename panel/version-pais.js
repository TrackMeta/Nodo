// ═════════════════════════════════════════════════════════════════════════
// 🌎 Versiones del producto por país (28-oct) — Productos → (producto) → «🌎 Países».
// Vender el mismo producto en otro país = una COPIA hermana con su país, su moneda, sus precios y sus medios de
// pago. La copia lleva config.pais («MX») y config.hermano_de (el id del original); el motor manda a cada cliente
// a la versión de su país (versionDelPais en engine.ts: anuncio → país guardado → código del número → le pregunta).
// El cobro no cambia: cada hermano es un producto normal con su moneda, camino ya probado con México y Colombia.
// La copia nace EN PAUSA (flujos en borrador): sin sus medios de pago cobraría con el Yape del bot.
// ═════════════════════════════════════════════════════════════════════════
import { supa, toast, icon } from "./shell.js";
import { asegurarEstilos } from "./ventana-ajustes.js";

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

// Reemplaza en un valor (objeto, texto) cada id viejo por el nuevo: las versiones, los flujos, los nodos y las
// secuencias se copian con ids nuevos, y la config, los nodos y los pasos del remarketing los nombran por id.
function remap(val, mapa) {
  if (val == null || !mapa.size) return val;
  let s = JSON.stringify(val);
  for (const [viejo, nuevo] of mapa) s = s.split(viejo).join(nuevo);
  return JSON.parse(s);
}
const sin = (o, ...k) => { const c = { ...o }; for (const x of k) delete c[x]; return c; };

async function crearVersion({ channelId, baseId, pais, moneda, precios }) {
  const info = paisInfo(pais);
  const creado = { producto: null, secuencias: [] };
  try {
    const { data: base, error: eB } = await supa.from("products").select("*").eq("id", baseId).single();
    if (eB || !base) throw new Error("No se encontró el producto original");
    const cfg0 = base.config || {};
    const [{ data: vers }, { data: flows }, { data: angs }] = await Promise.all([
      supa.from("product_versions").select("*").eq("product_id", baseId).order("orden"),
      supa.from("flows").select("*").eq("product_id", baseId),
      supa.from("angulos").select("*").eq("product_id", baseId).order("orden"),
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
    // 1) El producto. Sin los anuncios (cada anuncio es de UN país: se asignan en la copia) ni los medios de pago
    //    propios del original (los de otro país se ponen en la copia).
    const cfg = sin(cfg0, "ad_bank", "pago_propio");
    cfg.pais = pais; cfg.moneda = moneda; cfg.hermano_de = baseId;
    const { data: pNew, error: eP } = await supa.from("products")
      .insert({ ...sin(base, "id", "created_at", "updated_at"), nombre, config: cfg }).select("id").single();
    if (eP) throw eP;
    creado.producto = pNew.id;
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
    // 4) Los flujos (saludo y venta), EN PAUSA: la copia no vende hasta que tenga sus medios de pago.
    for (const f of flows || []) {
      const { data: fN, error } = await supa.from("flows").insert({
        ...sin(f, "id", "created_at", "updated_at"), product_id: pNew.id, es_entrada: false, estado: "borrador",
        nombre: `${f.nombre} · ${etiqueta}`,
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
      const { error } = await supa.from("sequences").update({ pasos: remap(s.pasos, mapa) }).eq("id", mapa.get(s.id));
      if (error) throw error;
    }
    const { error: eC } = await supa.from("products").update({ config: remap(cfg, mapa) }).eq("id", pNew.id);
    if (eC) throw eC;
    return pNew.id;
  } catch (e) {
    // A medias no sirve: se borra lo creado (el producto arrastra versiones, flujos y ángulos).
    try { if (creado.producto) await supa.from("products").delete().eq("id", creado.producto); } catch (_) {}
    try { if (creado.secuencias.length) await supa.from("sequences").delete().in("id", creado.secuencias); } catch (_) {}
    throw e;
  }
}

export async function abrirVersionesPais({ channelId, prod, onAbrir }) {
  if (!channelId || !prod) return;
  asegurarEstilos();
  const baseId = String(prod.config?.hermano_de || prod.id);
  const [{ data: prods }, { data: ch }, { data: vers }] = await Promise.all([
    supa.from("products").select("id, nombre, config, tipo").eq("channel_id", channelId),
    supa.from("channels").select("timezone, moneda").eq("id", channelId).maybeSingle(),
    supa.from("product_versions").select("id, nombre, precio, activo").eq("product_id", baseId).order("orden"),
  ]);
  const paisBot = PAIS_DE_ZONA[ch?.timezone || "America/Lima"] || "PE";
  const base = (prods || []).find((p) => p.id === baseId);
  if (!base) { toast("No se encontró el producto original", true); return; }
  const fam = (prods || []).filter((p) => p.id === baseId || String(p.config?.hermano_de || "") === baseId);
  const paisDe = (p) => String(p.config?.pais || (p.id === baseId ? paisBot : "")).toUpperCase();
  const usados = new Set(fam.map(paisDe));
  const libres = PAISES.filter((p) => !usados.has(p[0]));
  const versA = (vers || []).filter((v) => v.activo !== false);
  const monBase = (base.config?.moneda || ch?.moneda || "PEN").toUpperCase();

  const ov = document.createElement("div"); ov.className = "ajp-ov";
  const fila = (p) => {
    const c = paisDe(p), i = paisInfo(c);
    const mon = (p.config?.moneda || ch?.moneda || "PEN").toUpperCase();
    const propios = (p.config?.pago_propio?.metodos || []).length;
    const falta = p.id !== baseId && !propios;
    return `<div class="ajp-tog" style="cursor:default">
      <div><b>${i ? i[2] + " " + esc(i[1]) : "🌎 Sin país"}${p.id === prod.id ? ' <small style="display:inline;color:var(--brand)">· estás aquí</small>' : ""}</b>
        <small>${esc(p.nombre)} · cobra en ${esc(mon)}${p.id === baseId ? " · original (país del bot)" : ""}${falta ? ' · <span style="color:var(--amber,#d97706)">⚠️ falta ponerle sus medios de pago</span>' : ""}</small></div>
      ${p.id === prod.id ? "" : `<button class="ajp-btn" data-abrir="${esc(p.id)}">Abrir</button>`}
    </div>`;
  };
  ov.innerHTML = `<div class="ajp" role="dialog" aria-label="Versiones por país">
    <div class="ajp-hd"><h3>🌎 Versiones por país</h3><button class="ajp-x" id="vpX" title="Cerrar">${icon("x")}</button></div>
    <p class="ajp-sub">Vende <b>${esc(base.nombre)}</b> en otro país con su moneda, sus precios y sus medios de pago. El bot manda a cada cliente a la versión de su país: por el anuncio, por el código de su número o, si escribe sin número, preguntándole.</p>
    <div class="ajp-card"><h4>Versiones de este producto</h4>${fam.map(fila).join("")}</div>
    ${prod.tipo === "fisico" ? `<div class="ajp-nota">📦 Los productos físicos se venden solo en el país del bot (agencias, distritos, adelantos). Las versiones por país son para productos digitales y micro apps.</div>` : libres.length ? `
    <div class="ajp-card"><h4>Crear versión para otro país</h4>
      <p class="ajp-desc">Se copia todo: ficha, saludo, palabra clave, versiones, ángulos y remarketing. Los anuncios y los medios de pago <b>no</b> se copian: son de cada país.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
        <label style="flex:1;min-width:180px"><span class="ajp-lbl" style="margin-top:0">País</span>
          <select class="ajp-in" id="vpPais" style="width:100%">${libres.map((p) => `<option value="${p[0]}">${p[2]} ${esc(p[1])}</option>`).join("")}</select></label>
        <label style="flex:1;min-width:180px"><span class="ajp-lbl" style="margin-top:0">Moneda</span>
          <select class="ajp-in" id="vpMon" style="width:100%">${Object.keys(SIMBOLO).map((m) => `<option value="${m}">${m}</option>`).join("")}</select></label>
      </div>
      <span class="ajp-lbl">Precios en la moneda de ese país</span>
      ${versA.map((v) => `<div class="ajp-num" style="margin-top:6px"><span style="min-width:150px;color:var(--muted);font-weight:700">${esc(v.nombre || "Precio")}</span>
        <div class="box"><span class="vpSym">$</span><input type="number" min="0" step="0.01" data-v="${esc(v.id)}" placeholder="0"/></div>
        <small>En el original: ${esc(SIMBOLO[monBase] || "")} ${esc(v.precio ?? "—")}</small></div>`).join("")}
      <div class="ajp-nota">⏸️ La versión nueva nace <b>en pausa</b>. Antes de reanudarla ponle sus <b>medios de pago</b> (ficha → Avanzado → «Medios de pago propios»), revisa los textos que tengan precios escritos a mano y asigna los anuncios de ese país en su banco de anuncios.</div>
      <div class="ajp-acts"><button class="ajp-btn pri" id="vpCrear">Crear versión</button></div>
    </div>` : `<div class="ajp-nota">Ya hay una versión para cada país de la lista.</div>`}
  </div>`;
  document.body.appendChild(ov);
  const cerrar = () => ov.remove();
  ov.querySelector("#vpX").onclick = cerrar;
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) cerrar(); });
  ov.querySelectorAll("[data-abrir]").forEach((b) => { b.onclick = () => { cerrar(); onAbrir && onAbrir(b.dataset.abrir); }; });
  const selP = ov.querySelector("#vpPais"), selM = ov.querySelector("#vpMon");
  const pintaSym = () => ov.querySelectorAll(".vpSym").forEach((s) => { s.textContent = SIMBOLO[selM.value] || "$"; });
  if (selP && selM) {
    const porPais = () => { selM.value = paisInfo(selP.value)?.[3] || "USD"; pintaSym(); };
    selP.onchange = porPais; selM.onchange = pintaSym; porPais();
  }
  const btn = ov.querySelector("#vpCrear");
  if (btn) btn.onclick = async () => {
    const precios = {};
    let falta = false;
    ov.querySelectorAll("input[data-v]").forEach((i) => { precios[i.dataset.v] = i.value.trim(); if (!i.value.trim()) falta = true; });
    if (falta) { toast("Ponle precio a cada versión en la moneda de ese país", true); return; }
    btn.disabled = true; btn.textContent = "Creando…";
    try {
      const id = await crearVersion({ channelId, baseId, pais: selP.value, moneda: selM.value, precios });
      toast(`Versión ${paisInfo(selP.value)?.[1] || ""} creada — en pausa hasta que le pongas sus medios de pago`);
      cerrar();
      onAbrir && onAbrir(id);
    } catch (e) {
      toast("No se pudo crear la versión: " + (e?.message || e), true);
      btn.disabled = false; btn.textContent = "Crear versión";
    }
  };
}
