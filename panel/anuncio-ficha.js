// ═════════════════════════════════════════════════════════════════════════
// Nodo · anuncio-ficha.js — «la ficha del anuncio», como el «Origen del lead» de la ficha del cliente.
// (6-nov, Rodrigo: «en cada anuncio colocar qué anuncio es, igual que en la ficha del cliente, toda la info bien
// ordenada y con un botón para ir a ver el anuncio; y en Rendimiento donde corresponda»)
// Se usa en Productos → Ángulos (cada anuncio del país / ángulo) y en Rendimiento (detalle de un anuncio).
//
// De dónde sale cada dato:
//   · nombre, conjunto, campaña, estado y cuenta → ads_meta (lo baja ads-sync de Meta).
//   · título, texto, imagen y el link para ver el anuncio → el referral que Meta manda cuando alguien lo toca
//     (contacts.ad_ref, desde el 5-oct). Se toma el del cliente MÁS RECIENTE que llegó por ese anuncio.
//   · «Clientes que llegaron» → cuántos contactos tienen ese ad_id.
// La imagen es un link de Meta que CADUCA: si no carga, vuelve al ícono (no se guarda en storage a propósito).
// ═════════════════════════════════════════════════════════════════════════
import { icon, toast } from "./shell.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const urlOk = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : "");

const CSS = `
.adf{border:1px solid var(--border);border-radius:12px;background:var(--surface-2);padding:11px 12px}
.adf + .adf{margin-top:8px}
.adf-top{display:flex;align-items:flex-start;gap:11px}
.adf-th{width:52px;height:52px;border-radius:10px;flex:none;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--surface);border:1px solid var(--border);color:var(--faint)}
.adf-th{position:relative}.adf-th svg{width:20px;height:20px}.adf-th img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
a.adf-th{cursor:zoom-in}
.adf-tx{flex:1;min-width:0}
.adf-n{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:13.5px;font-weight:700;color:var(--text);line-height:1.3;word-break:break-word}
.adf-st{font-size:10.5px;font-weight:700;padding:1px 8px;border-radius:20px;white-space:nowrap}
.adf-st.on{background:rgba(22,163,74,.13);color:#16a34a}.adf-st.off{background:var(--surface);color:var(--faint);border:1px solid var(--border)}
.adf-s{font-size:11.5px;color:var(--muted);margin-top:3px;line-height:1.45;word-break:break-word}
.adf-s b{font-weight:600;color:var(--text)}
.adf-acc{display:flex;align-items:center;gap:6px;flex:none}
.adf-copy{border-top:1px solid var(--border);margin-top:10px;padding-top:9px}
.adf-k{font-size:10.5px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;color:var(--faint);margin-top:7px}
.adf-k:first-child{margin-top:0}
.adf-v{font-size:12.5px;color:var(--text);margin-top:2px;white-space:pre-wrap;word-break:break-word;line-height:1.45}
.adf-v.t{font-weight:600}
.adf-v.clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.adf-more{background:none;border:0;padding:3px 0 0;color:var(--brand);font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit}
.adf-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}
.adf-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border-radius:9px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:12px;font-weight:600;text-decoration:none;cursor:pointer;font-family:inherit}
.adf-btn:hover{border-color:var(--brand)}.adf-btn svg{width:14px;height:14px}
.adf-btn.pri{background:var(--brand);border-color:var(--brand);color:#fff}
.adf-id{margin-left:auto;display:inline-flex;align-items:center;gap:4px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--faint);background:none;border:0;cursor:pointer;padding:3px 4px;border-radius:6px}
.adf-id:hover{color:var(--text);background:var(--surface)}.adf-id svg{width:12px;height:12px}
.adf-note{font-size:11px;color:var(--faint);margin-top:8px;line-height:1.4}
`;
function ponerCss() { if (document.getElementById("adf-css")) return; const st = document.createElement("style"); st.id = "adf-css"; st.textContent = CSS; document.head.appendChild(st); }

// Para cada anuncio: el referral más reciente (título, texto, imagen, link) y cuántos clientes llegaron.
export async function datosAnuncios(supa, channelId, ids) {
  const lista = [...new Set((ids || []).map(String).filter(Boolean))];
  const out = {};
  await Promise.all(lista.map(async (id) => {
    try {
      const [refR, cntR] = await Promise.all([
        supa.from("contacts").select("ad_ref").eq("channel_id", channelId).eq("ad_id", id).not("ad_ref", "is", null)
          .order("created_at", { ascending: false }).limit(1),
        supa.from("contacts").select("id", { count: "exact", head: true }).eq("channel_id", channelId).eq("ad_id", id),
      ]);
      const r = refR.data && refR.data[0] && refR.data[0].ad_ref;
      // El referral vale solo si es de ESTE anuncio (si no, mostraría el texto de otro).
      out[id] = { ref: r && typeof r === "object" && (!r.source_id || String(r.source_id) === id) ? r : null, leads: cntR.count ?? null };
    } catch (_) { out[id] = { ref: null, leads: null }; }
  }));
  return out;
}

const ESTADO = (e) => !e ? "" : String(e).toUpperCase() === "ACTIVE" ? `<span class="adf-st on">Activo</span>` : `<span class="adf-st off">${/PAUSED/i.test(e) ? "Pausado" : esc(String(e).toLowerCase())}</span>`;

// La ficha. `meta` = fila de ads_meta (puede faltar); `datos` = lo de datosAnuncios; `acciones` = HTML de botones
// propios de quien la usa (asignar, quitar…), que van arriba a la derecha.
// `sinNombre`: donde el nombre y la campaña ya están arriba (Rendimiento → detalle), no se repiten.
export function fichaAnuncioHtml({ id, meta, datos, acciones = "", sinNombre = false }) {
  ponerCss();
  const m = meta || {}, ref = (datos && datos.ref) || null;
  const img = urlOk(ref && ref.image_url) || urlOk(ref && ref.thumbnail_url);
  const ver = urlOk(ref && ref.source_url);
  const act = String(m.account_id || "").replace(/^act_/, "");
  const enMeta = act ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${encodeURIComponent(act)}&selected_ad_ids=${encodeURIComponent(id)}` : "";
  const ico = icon(ref && ref.media_type === "video" ? "video" : "image");
  const th = img
    // Si la imagen de Meta caducó, se quita y queda el ícono que está debajo.
    ? `<a class="adf-th" href="${esc(img)}" target="_blank" rel="noopener noreferrer" title="Ver la imagen del anuncio">${ico}<img src="${esc(img)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()"></a>`
    : `<span class="adf-th">${icon("megaphone")}</span>`;
  const body = String((ref && ref.body) || "");
  const largo = body.length > 160 || body.split("\n").length > 3;
  const nombre = m.ad_name || (ref && ref.headline) || ("Anuncio " + id);
  const leads = datos && datos.leads != null ? datos.leads : null;
  return `<div class="adf" data-adf="${esc(id)}">
    <div class="adf-top">${th}
      <div class="adf-tx">
        ${sinNombre ? `<div class="adf-n">Así es el anuncio</div>` : `<div class="adf-n">${esc(nombre)} ${ESTADO(m.estado)}</div>`}
        ${!sinNombre && m.campaign_name ? `<div class="adf-s">Campaña: <b>${esc(m.campaign_name)}</b>${m.adset_name ? ` · Conjunto: <b>${esc(m.adset_name)}</b>` : ""}</div>` : ""}
        ${leads != null ? `<div class="adf-s">${leads === 1 ? "1 cliente llegó" : `${Number(leads).toLocaleString("es-PE")} clientes llegaron`} por este anuncio</div>` : ""}
      </div>
      ${acciones ? `<div class="adf-acc">${acciones}</div>` : ""}
    </div>
    ${(ref && (ref.headline || body)) ? `<div class="adf-copy">
      ${ref.headline ? `<div class="adf-k">Título</div><div class="adf-v t">${esc(ref.headline)}</div>` : ""}
      ${body ? `<div class="adf-k">Texto</div><div class="adf-v${largo ? " clamp" : ""}" data-adfbody>${esc(body)}</div>${largo ? `<button type="button" class="adf-more" data-adfmore>Ver todo</button>` : ""}` : ""}
    </div>` : ""}
    <div class="adf-foot">
      ${ver ? `<a class="adf-btn pri" href="${esc(ver)}" target="_blank" rel="noopener noreferrer">${icon("link")} Ver anuncio</a>` : ""}
      ${enMeta ? `<a class="adf-btn" href="${esc(enMeta)}" target="_blank" rel="noopener noreferrer">${icon("megaphone")} Abrir en Meta</a>` : ""}
      <button type="button" class="adf-id" data-adfcopy="${esc(id)}" title="Copiar el ID del anuncio">${esc(id)} ${icon("copy")}</button>
    </div>
    ${!ref ? `<div class="adf-note">${leads ? "Todavía no hay un clic guardado con el título y el texto de este anuncio (Nodo los guarda desde el 5 de octubre)." : "Cuando alguien toque este anuncio, aquí aparecen su título, su texto y su imagen."}</div>` : ""}
  </div>`;
}

// «Ver todo» del texto y copiar el ID. Llamar después de pintar (delegado: sirve para varias fichas).
export function wireFichasAnuncio(root) {
  if (!root || root._adfWired) return;
  root._adfWired = true;
  root.addEventListener("click", async (e) => {
    const more = e.target.closest("[data-adfmore]");
    if (more) { const b = more.parentNode.querySelector("[data-adfbody]"); if (b) { const ab = b.classList.toggle("clamp"); more.textContent = ab ? "Ver todo" : "Ver menos"; } return; }
    const cp = e.target.closest("[data-adfcopy]");
    if (cp) { try { await navigator.clipboard.writeText(cp.dataset.adfcopy); toast("ID del anuncio copiado"); } catch (_) { toast("No se pudo copiar", true); } }
  });
}
