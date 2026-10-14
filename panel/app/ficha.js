// Ficha del cliente (loadContactPanel de la Bandeja, en una columna): pedido, Memoria IA, etapa del embudo,
// origen del lead, etiquetas y medios. Cambia etapa y etiquetas igual que el panel.
import { A, $, esc, ic, on, emit, supa, avatar, quienDe, whoTxt, abrirCapa, capaAbierta, cerrarCapa, confirmar, toast, verFoto, sol, fmtHora } from "./app.js";
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
      <button type="button" class="li" data-acc="seg"><span class="ico">${ic("clock")}</span><span class="rmid"><b>${F.conv.requiere_humano ? "Quitar de Seguimiento" : "Marcar Seguimiento"}</b><span>Para acordarte de volver a este chat</span></span></button>
      <button type="button" class="li" data-acc="arch"><span class="ico">${ic("archive")}</span><span class="rmid"><b>${F.conv.archivada ? "Sacar de archivados" : "Archivar chat"}</b><span>Se esconde de la lista (no se borra)</span></span></button>
      <button type="button" class="li${c.bloqueado ? "" : " peligro"}" data-blq><span class="ico">${ic(c.bloqueado ? "lock" : "ban")}</span><span class="rmid"><b>${c.bloqueado ? "Desbloquear contacto" : "Bloquear contacto"}</b><span>${c.bloqueado ? "Vuelve a la lista y el bot le contesta de nuevo" : "El bot deja de responderle y sale de la lista"}</span></span></button>
    </div>`;
}
async function evento(tipo, titulo, detalle) { try { await supa.from("contact_events").insert({ channel_id: A.ch, contact_id: F.c.id, tipo, titulo, detalle: detalle || null, meta: { por: A.nombre, desde: "app" } }); } catch (_) { /* */ } }
async function clic(e) {
  if (!F) return;
  const v = e.target.closest("[data-ver]"); if (v) { verFoto(v.dataset.ver); return; }
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
