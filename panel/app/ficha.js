// Ficha del cliente (loadContactPanel de la Bandeja, en una columna): pedido, Memoria IA, etapa del embudo,
// origen del lead, etiquetas y medios. Cambia etapa y etiquetas igual que el panel.
import { A, $, esc, ic, on, emit, supa, invoke, abrirHoja, avatar, quienDe, whoTxt, abrirCapa, capaAbierta, cerrarCapa, confirmar, toast, verFoto, sol, fmtHora } from "./app.js";
import { STAGES, ETAPA } from "./comun.js";
import { tagHex } from "./chats.js";
import { CHAT } from "./chat.js";
import * as O from "../orders.js";

const INTERNAS = new Set(["zona_entrega", "zona_distrito_incierto", "entrega_motivo", "menu_eleccion", "pago_monto", "pago_operacion", "pago_titular", "pago_resultado", "datos_pago", "pedido_creado", "datos_completos"]);
const interna = (k) => { k = String(k || ""); return k.startsWith("_") || /^xt[0-9a-f]{10}_/.test(k) || /^extraf?_\d+_resp$/i.test(k) || INTERNAS.has(k.toLowerCase()); };
const presentable = (v) => { const s = String(v ?? "").trim(); return !!s && s.length <= 60 && !/^https?:\/\//i.test(s) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(s) && !/^[{[]/.test(s) && !/^(true|false|pago_ok|pago_no|null|undefined|si|sí|no|ok|okay|ya|nel|dale|listo)$/i.test(s); };

let F = null;   // datos de la ficha abierta
export function init() {
  on("abrirFicha", (cid) => abrir(cid));
  on("contacto", (c) => { if (F && c.id === F.c.id && capaAbierta("ficha")) { Object.assign(F.c, c); pintar(); } });
  $("#fibody").addEventListener("click", clic);
}
async function abrir(cid) {
  $("#fibody").innerHTML = `<div class="cargando">Cargando ficha…</div>`;
  abrirCapa("ficha", () => { F = null; });
  const [ct, tags, asig, campos, vals, media, ord, conv] = await Promise.all([
    supa.from("contacts").select("id,nombre,wa_id,stage,bot_activo,bloqueado,source,ad_id,ad_ref,memoria_ia,primera_interaccion,ultimo_mensaje_cliente_at,created_at,product:products(nombre,emoji)").eq("id", cid).maybeSingle(),
    supa.from("tags").select("id,nombre,color").eq("channel_id", A.ch).order("nombre"),
    supa.from("contact_tags").select("tag_id").eq("contact_id", cid),
    supa.from("custom_fields").select("id,nombre,key").eq("channel_id", A.ch),
    supa.from("contact_field_values").select("field_id,value").eq("contact_id", cid),
    supa.from("messages").select("id,type,content,ts,direction").eq("contact_id", cid).not("content->>media_url", "is", null).order("ts", { ascending: false }).limit(30),
    supa.from("orders").select("id,amount,currency,order_bumps,estado,created_at,shipping,product:product_id(nombre,emoji,tipo)").eq("contact_id", cid).order("created_at", { ascending: false }).limit(1),
    supa.from("conversations").select("requiere_humano,archivada").eq("contact_id", cid).maybeSingle(),
  ]);
  if (!ct.data) { $("#fibody").innerHTML = `<div class="empty">No se encontró el cliente.</div>`; return; }
  const c = ct.data;
  let ad = null;
  if (c.ad_id) { const { data } = await supa.from("ads_meta").select("ad_name,adset_name,campaign_name").eq("channel_id", A.ch).eq("ad_id", String(c.ad_id)).maybeSingle(); ad = data; }
  const nombres = new Map((campos.data || []).map((f) => [f.id, f]));
  F = {
    c, ad, conv: conv.data || {}, orden: (ord.data || [])[0] || null, tags: tags.data || [], asig: new Set((asig.data || []).map((x) => x.tag_id)),
    vender: (vals.data || []).map((v) => ({ f: nombres.get(v.field_id), v: v.value })).filter((x) => x.f && !interna(x.f.key) && presentable(x.v)),
    media: media.data || [],
  };
  pintar();
}
function pedidoHtml(o) {
  if (!o) return `<p style="color:var(--muted)">Todavía no tiene pedido.</p>`;
  const z = O.zonaDe(o), s = o.shipping || {}, cur = o.currency || "PEN";
  const prod = o.product ? `${o.product.emoji ? esc(o.product.emoji) + " " : ""}${esc(o.product.nombre)}` : "Pedido";
  const falta = O.porCobrar(o), cob = O.cobrado(o);
  const plata = O.esCerrado(o) ? `<div class="money ok">${ic("check")} Pagado · ${sol(O.total(o), cur)}</div>` : falta > 0 && cob > 0 ? `<div class="money falta">Pagó ${sol(cob, cur)} · falta ${sol(falta, cur)}</div>` : `<div class="money">Total ${sol(O.total(o), cur)}</div>`;
  const dir = z === "lima" ? [s.direccion, s.distrito].filter(Boolean).join(", ") : z === "provincia" ? [s.sede, s.destino || s.ciudad].filter(Boolean).join(" · ") : "";
  return `<p><b>${prod}</b></p>${plata}<p style="color:var(--muted)">Estado: <b style="color:var(--text)">${esc(O.label(o.estado))}</b>${dir ? " · " + esc(dir) : ""}</p>`;
}
function pintar() {
  if (!F) return;
  const c = F.c, w = quienDe({ bot_activo: c.bot_activo, requiere_humano: F.conv.requiere_humano }), m = c.memoria_ia || {};
  const quien = Array.isArray(m.quien_es) ? m.quien_es : [], trato = Array.isArray(m.como_tratar) ? m.como_tratar : [];
  const ref = c.ad_ref && String(c.ad_ref.source_id || "") === String(c.ad_id || "") ? c.ad_ref : null;
  const esAd = !!(c.ad_id || /^(ad|ctwa)$/i.test(c.source || ""));
  $("#fibody").innerHTML = `
    <div class="fhead">${avatar(c.id, c.nombre, c.wa_id, w, c.product?.emoji)}<b>${esc(c.nombre || "Cliente")}</b><span>${/^\d+$/.test(c.wa_id || "") ? "+" + esc(c.wa_id) : "Sin número visible"}</span><span>${whoTxt(w)}${c.product ? ` · ${c.product.emoji ? esc(c.product.emoji) + " " : ""}${esc(c.product.nombre)}` : ""}</span></div>
    <div class="fsec"><h4>${A.tipo === "fisico" ? "Pedido" : "Compra"}</h4>${pedidoHtml(F.orden)}</div>
    ${quien.length || trato.length || F.vender.length ? `<div class="fsec mia"><h4>Memoria IA</h4>
      ${quien.length ? `<p><b>Quién es</b></p><ul>${quien.map((x) => `<li>${esc(typeof x === "string" ? x : x?.texto || x?.t || "")}</li>`).join("")}</ul>` : ""}
      ${trato.length ? `<p><b>Cómo tratarlo</b></p><ul>${trato.map((x) => `<li>${esc(typeof x === "string" ? x : x?.texto || x?.t || "")}</li>`).join("")}</ul>` : ""}
      ${F.vender.length ? `<p><b>Para vender</b></p><ul>${F.vender.map((x) => `<li>${esc(x.f.nombre || x.f.key)}: <b>${esc(x.v)}</b></li>`).join("")}</ul>` : ""}</div>` : ""}
    <div class="fsec"><h4>Etapa del embudo</h4><div class="steps">${STAGES.map((s) => `<button type="button" class="step${(c.stage || "nuevo") === s.k ? " on" : ""}" data-et="${s.k}"><span class="sd" style="background:${s.color}"></span><span><b>${s.label}</b><small>${s.desc}</small></span></button>`).join("")}</div></div>
    <div class="fsec"><h4>Origen del lead</h4>${esAd
      ? `${ref?.thumbnail_url || ref?.image_url ? `<img src="${esc(ref.thumbnail_url || ref.image_url)}" alt="" style="width:100%;max-height:160px;object-fit:cover;border-radius:10px" onerror="this.remove()">` : ""}
         <p>${ic("megaphone")} <b>${esc(F.ad?.ad_name || ref?.headline || "Anuncio de Meta")}</b></p>
         ${F.ad ? `<p style="color:var(--muted)">Campaña: ${esc(F.ad.campaign_name || "—")}${F.ad.adset_name ? " · " + esc(F.ad.adset_name) : ""}</p>` : ""}
         <p style="color:var(--muted)">Llegó ${c.primera_interaccion ? "el " + esc(fmtHora(c.primera_interaccion)) : ""}</p>`
      : `<p style="color:var(--muted)">Orgánico: escribió sin pasar por un anuncio.</p>`}</div>
    <div class="fsec"><h4>Etiquetas <span>${F.asig.size}</span></h4>${F.tags.length ? `<div class="tagrow">${F.tags.map((t) => `<button type="button" class="tagb${F.asig.has(t.id) ? " on" : ""}" data-tag="${t.id}"><span class="tagdot" style="background:${tagHex(t.color)}"></span>${esc(t.nombre)}</button>`).join("")}</div>` : `<p style="color:var(--muted)">Este bot no tiene etiquetas. Créalas desde el panel.</p>`}</div>
    <div class="fsec"><h4>Medios y archivos <span>${F.media.length}</span></h4>${F.media.length ? `<div class="mgrid">${F.media.slice(0, 12).map((x) => {
      const u = x.content?.media_url; return x.type === "image" || x.type === "sticker" ? `<button type="button" class="mtile" data-ver="${esc(u)}" style="background-image:url('${esc(u)}')"></button>` : `<a class="mtile" href="${esc(u)}" target="_blank" rel="noopener">${ic(x.type === "audio" ? "mic" : x.type === "video" ? "video" : "file")}${x.type === "audio" ? "Nota de voz" : esc(x.content?.filename || "Archivo")}</a>`;
    }).join("")}</div>` : `<p style="color:var(--muted)">Sin fotos, audios ni archivos.</p>`}</div>
    <div class="card"><div class="ttl">Acciones</div>
      ${!F.orden || O.esPerdido(F.orden) || O.esCerrado(F.orden) ? `<button type="button" class="li" data-venta><span class="ico">${ic("banknote")}</span><span class="rmid"><b>Registrar venta</b><span>Te pagó por fuera (llamada, tu número, efectivo): crea el pedido y entrega el acceso</span></span>${ic("chevronRight")}</button>` : ""}
      <button type="button" class="li" data-acc="seg"><span class="ico">${ic("clock")}</span><span class="rmid"><b>${F.conv.requiere_humano ? "Quitar de Seguimiento" : "Marcar Seguimiento"}</b><span>Para acordarte de volver a este chat</span></span></button>
      <button type="button" class="li" data-acc="arch"><span class="ico">${ic("archive")}</span><span class="rmid"><b>${F.conv.archivada ? "Sacar de archivados" : "Archivar chat"}</b><span>Se esconde de la lista (no se borra)</span></span></button>
      <button type="button" class="li${c.bloqueado ? "" : " peligro"}" data-blq><span class="ico">${ic(c.bloqueado ? "lock" : "ban")}</span><span class="rmid"><b>${c.bloqueado ? "Desbloquear contacto" : "Bloquear contacto"}</b><span>${c.bloqueado ? "Vuelve a la lista y el bot le contesta de nuevo" : "El bot deja de responderle y sale de la lista"}</span></span></button>
    </div>`;
}
// ═════════ Registrar venta a mano (21-oct) ═════════
// Lo mismo que «Registrar venta a mano» de la ficha en la Bandeja web (contact-extras.js · openVentaManual) y por la
// MISMA función edge venta-manual: crea el pedido contra este cliente, congela la atribución del anuncio, entrega el
// acceso digital, mueve el embudo y manda el Purchase a Meta si corresponde. En el celular: producto, versión, monto,
// talla/color y los datos de envío si es físico. Los productos EXTRA en la misma venta quedan para la web.
async function ventaManual() {
  const c = F.c;
  const [{ data: prods }, { data: ci }] = await Promise.all([
    supa.from("products").select("id,nombre,emoji,tipo,clase,config,product_versions(id,nombre,precio,orden)").eq("channel_id", A.ch).order("nombre"),
    supa.from("contacts").select("ctwa_clid,source").eq("id", c.id).maybeSingle(),
  ]);
  const cat = (prods || []).filter((p) => p.clase !== "regalo" && (p.product_versions || []).length)
    .map((p) => ({ ...p, product_versions: [...p.product_versions].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)) }));
  if (!cat.length) { toast("No hay productos con precio para registrar una venta", true); return; }
  const tieneAd = !!(ci && (ci.ctwa_clid || ci.source === "ctwa"));
  const ejes = (p) => (Array.isArray(p?.config?.atributos) ? p.config.atributos : [])
    .map((a) => ({ nombre: a.nombre, vals: Array.isArray(a.valores) ? a.valores : String(a.valores || "").split(",").map((s) => s.trim()).filter(Boolean) }))
    .filter((a) => a.nombre && a.vals.length);
  const tel = /^\d+$/.test(c.wa_id || "") ? c.wa_id : "";
  let zona = "lima", estado = "confirmada";
  const opsEstado = (p) => (p?.tipo || "digital") !== "fisico" ? [["confirmada", "Vendido y entregado"]]
    : zona === "provincia" ? [["esperando_adelanto", "Esperando adelanto"], ["por_despachar", "Adelanto pagado"], ["recogido", "Recogido y pagado"]]
    : [["confirmado", "Por entregar"], ["entregado_cobrado", "Entregado y cobrado"]];
  const pre = cat.find((p) => p.nombre === c.product?.nombre) || cat[0];

  abrirHoja(`<h3>Registrar venta</h3>
    <p class="lead">Para una venta que cerraste por fuera. ${tieneAd ? "Este cliente vino de un <b>anuncio</b>: la venta se le atribuye y se avisa a Meta." : "Este cliente no vino de un anuncio: cuenta en tus números, pero no se avisa a Meta."}</p>
    <label class="flabel">Producto<select class="inpt" id="vmP">${cat.map((p) => `<option value="${p.id}"${p.id === pre.id ? " selected" : ""}>${p.emoji ? esc(p.emoji) + " " : ""}${esc(p.nombre)}</option>`).join("")}</select></label>
    <label class="flabel" id="vmVW">Versión<select class="inpt" id="vmV"></select></label>
    <div id="vmAtr"></div>
    <label class="flabel">Monto cobrado (S/)<input class="inpt" id="vmM" type="number" inputmode="decimal" min="0" step="0.5"></label>
    <div id="vmFis"></div>
    <div class="flabel">Estado</div><div class="seg" id="vmE" style="margin-bottom:12px"></div>
    <label class="flabel" id="vmEntW" style="display:flex;align-items:center;gap:10px;margin:0 4px 14px;color:var(--text)"><input type="checkbox" id="vmEnt" checked style="width:20px;height:20px">Enviarle el acceso por WhatsApp ahora</label>
    <button type="button" class="btn blue" style="width:100%" id="vmOk">Registrar venta</button>`, (sh, cerrar) => {
    const g = (s) => $(s, sh), prod = () => cat.find((p) => p.id === g("#vmP").value);
    const pintaEstado = () => {
      const ops = opsEstado(prod());
      if (!ops.some((o) => o[0] === estado)) estado = ops[0][0];
      g("#vmE").innerHTML = ops.map(([k, l]) => `<button type="button" class="${k === estado ? "on" : ""}" data-e="${k}">${esc(l)}</button>`).join("");
    };
    const pintaFisico = () => {
      const fis = (prod()?.tipo || "digital") === "fisico";
      g("#vmEntW").style.display = fis ? "none" : "flex";
      if (!fis) { g("#vmFis").innerHTML = ""; return; }
      const vals = Object.fromEntries([...g("#vmFis").querySelectorAll("input")].map((i) => [i.id, i.value]));
      const campo = (id, lb, ph, val = "", tipo = "text") => `<label class="flabel">${lb}<input class="inpt" id="${id}" type="${tipo}" placeholder="${esc(ph)}" value="${esc(vals[id] ?? val)}"></label>`;
      g("#vmFis").innerHTML = `<div class="flabel">Envío</div><div class="seg" id="vmZ" style="margin-bottom:12px"><button type="button" class="${zona === "lima" ? "on" : ""}" data-z="lima">Lima</button><button type="button" class="${zona === "provincia" ? "on" : ""}" data-z="provincia">Provincia</button></div>
        ${campo("vmNom", "Nombre de quien recibe", "Nombre y apellido", c.nombre || "")}${campo("vmTel", "Celular", "9 dígitos", tel, "tel")}
        ${zona === "lima" ? campo("vmDir", "Dirección", "Calle, número") + campo("vmDist", "Distrito", "Ej. Surco") + campo("vmRef", "Referencia", "Opcional")
          : campo("vmDni", "DNI", "8 dígitos", "", "tel") + campo("vmCiu", "Ciudad", "Ej. Arequipa") + campo("vmDest", "Agencia de destino", "Sede Shalom")}`;
    };
    const pintaProd = () => {
      const p = prod();
      g("#vmV").innerHTML = p.product_versions.map((v) => `<option value="${v.id}" data-precio="${v.precio ?? 0}">${esc(v.nombre || "Única")}${v.precio != null ? " · " + esc(sol(v.precio)) : ""}</option>`).join("");
      g("#vmVW").style.display = p.product_versions.length > 1 ? "" : "none";
      g("#vmM").value = g("#vmV").selectedOptions[0]?.dataset.precio || "";
      g("#vmAtr").innerHTML = ejes(p).map((a) => `<label class="flabel">${esc(a.nombre)}<select class="inpt vmatr" data-eje="${esc(a.nombre)}"><option value="">Elige…</option>${a.vals.map((x) => `<option>${esc(x)}</option>`).join("")}</select></label>`).join("");
      pintaFisico(); pintaEstado();
    };
    g("#vmP").onchange = pintaProd;
    g("#vmV").onchange = () => { g("#vmM").value = g("#vmV").selectedOptions[0]?.dataset.precio || ""; };
    sh.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-e]"); if (b) { estado = b.dataset.e; pintaEstado(); return; }
      const z = ev.target.closest("[data-z]"); if (z) { zona = z.dataset.z; pintaFisico(); pintaEstado(); }
    });
    pintaProd();
    g("#vmOk").onclick = async () => {
      const p = prod(), monto = Number(g("#vmM").value) || 0;
      // Igual que la web: una venta en S/0 cuenta como cerrada, entrega gratis y manda un Purchase(0) a Meta
      if (monto <= 0) { toast("Ponle el monto de la venta (mayor a 0)", true); g("#vmM").focus(); return; }
      const atributos = {};
      sh.querySelectorAll(".vmatr").forEach((s) => { if (s.value) atributos[s.dataset.eje] = s.value; });
      if (ejes(p).length && Object.keys(atributos).length < ejes(p).length) { toast("Elige " + ejes(p).map((a) => a.nombre.toLowerCase()).join(" y "), true); return; }
      const t = (id) => (g("#" + id)?.value || "").trim();
      const fis = (p.tipo || "digital") === "fisico";
      const envio = !fis ? null : zona === "lima"
        ? { zona: "lima", cliente: t("vmNom"), tel: t("vmTel"), direccion: t("vmDir"), distrito: t("vmDist"), referencia: t("vmRef") }
        : { zona: "provincia", cliente: t("vmNom"), tel: t("vmTel"), dni: t("vmDni"), ciudad: t("vmCiu"), destino: t("vmDest") };
      const btn = g("#vmOk"); btn.disabled = true; btn.textContent = "Registrando…";
      const r = await invoke("venta-manual", {
        channel_id: A.ch, contact_id: c.id, product_id: p.id, version_id: g("#vmV").value,
        atributos: Object.keys(atributos).length ? atributos : null, amount: monto, estado,
        entregar: !fis && g("#vmEnt").checked, envio, extras: [],
      });
      if (!r.ok || !r.data?.ok) { toast("No se pudo: " + (r.data?.error || r.error?.message || "error"), true); btn.disabled = false; btn.textContent = "Registrar venta"; return; }
      cerrar(); toast("Venta registrada");
      emit("conv", { contact_id: c.id });
      setTimeout(() => abrir(c.id), 300);
    };
  });
}
async function evento(tipo, titulo, detalle) { try { await supa.from("contact_events").insert({ channel_id: A.ch, contact_id: F.c.id, tipo, titulo, detalle: detalle || null, meta: { por: A.nombre, desde: "app" } }); } catch (_) { /* */ } }
async function clic(e) {
  if (!F) return;
  const v = e.target.closest("[data-ver]"); if (v) { verFoto(v.dataset.ver); return; }
  if (e.target.closest("[data-venta]")) { ventaManual(); return; }
  const st = e.target.closest("[data-et]");
  if (st) {
    const k = st.dataset.et; if (k === (F.c.stage || "nuevo")) return;
    const { error } = await supa.from("contacts").update({ stage: k }).eq("id", F.c.id);
    if (error) { toast("No se pudo cambiar la etapa: " + error.message, true); return; }
    evento("nota", `Etapa: ${ETAPA[k].label}`, "Cambiada a mano desde la app");
    F.c.stage = k; pintar(); toast("Etapa cambiada");
    emit("contacto", { id: F.c.id, stage: k }); return;
  }
  const tg = e.target.closest("[data-tag]");
  if (tg) {
    const id = tg.dataset.tag, t = F.tags.find((x) => x.id === id), tenia = F.asig.has(id);
    const r = tenia ? await supa.from("contact_tags").delete().eq("contact_id", F.c.id).eq("tag_id", id) : await supa.from("contact_tags").upsert({ contact_id: F.c.id, tag_id: id }, { onConflict: "contact_id,tag_id" });
    if (r.error) { toast("No se pudo cambiar la etiqueta: " + r.error.message, true); return; }
    tenia ? F.asig.delete(id) : F.asig.add(id);
    evento(tenia ? "etiqueta_del" : "etiqueta_add", `${tenia ? "Quitó" : "Puso"} la etiqueta «${t?.nombre}»`);
    pintar(); emit("conv", { contact_id: F.c.id }); return;
  }
  // Bloquear / desbloquear: igual que el menú del chat en la Bandeja (bloqueado + bot apagado, y al revés)
  if (e.target.closest("[data-blq]")) {
    const blq = !F.c.bloqueado;
    if (blq && !(await confirmar("Bloquear contacto", "El bot dejará de responderle y saldrá de la lista de chats. Puedes desbloquearlo después desde su ficha (búscalo por nombre o número).", { si: "Bloquear", peligro: true }))) return;
    const { error } = await supa.from("contacts").update({ bloqueado: blq, bot_activo: !blq }).eq("id", F.c.id);
    if (error) { toast("No se pudo: " + error.message, true); return; }
    evento("nota", blq ? "Contacto bloqueado" : "Contacto desbloqueado");
    F.c.bloqueado = blq; F.c.bot_activo = !blq;
    emit("bloqueo", { id: F.c.id, bloqueado: blq }); emit("contacto", { id: F.c.id, bot_activo: !blq, bloqueado: blq });
    toast(blq ? "Contacto bloqueado" : "Contacto desbloqueado");
    if (blq) { const id = F.c.id; if (CHAT.cid === id && capaAbierta("chat")) cerrarCapa("chat"); else cerrarCapa("ficha"); } else pintar();
    return;
  }
  const ac = e.target.closest("[data-acc]");
  if (ac) {
    const k = ac.dataset.acc, campo = k === "seg" ? "requiere_humano" : "archivada", val = !F.conv[campo];
    const { error } = await supa.from("conversations").update({ [campo]: val }).eq("contact_id", F.c.id);
    if (error) { toast("No se pudo: " + error.message, true); return; }
    F.conv[campo] = val; pintar();
    if (CHAT.cid === F.c.id && CHAT.conv) CHAT.conv[campo] = val;
    toast(k === "seg" ? (val ? "Marcado en Seguimiento" : "Quitado de Seguimiento") : (val ? "Chat archivado" : "Chat fuera de archivados"));
    emit("conv", { contact_id: F.c.id });
  }
}
