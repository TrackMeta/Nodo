// ═══════════════════════════════════════════════════════════════════
// Nodo · var-picker.js — "Insertar dato" para cualquier caja de texto.
//
// Los mensajes SIEMPRE aceptaron variables {{asi}} (el motor las reemplaza al
// enviar), pero no había forma de saber cuáles existen: había que acordarse del
// nombre exacto y escribirlo a mano. Un nombre mal escrito no da error — sale
// vacío en el mensaje del cliente, y te enteras cuando ya se envió.
//
// El catálogo de abajo está verificado contra buildContext() del motor. Los
// campos personalizados del canal se cargan aparte porque son de cada negocio.
// OJO: {{pedido_*}} es dinámico — el motor vuelca TODO el envío del pedido a
// variables, así que si el formulario de despacho guarda un campo nuevo,
// aparece solo (por eso la foto de la guía existe sin tocar el motor).
// ═══════════════════════════════════════════════════════════════════

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

export const VAR_GRUPOS = [
  { g: "El cliente", items: [
    ["cliente", "Cómo llamarlo", "El nombre que dio para el envío; si no dio ninguno, el de WhatsApp"],
    ["nombre", "Nombre de WhatsApp", "Tal cual lo tiene en su perfil"],
    ["telefono", "Su teléfono", ""],
    ["fecha", "Fecha de hoy", ""],
    ["hora", "Hora", ""],
  ] },
  { g: "La venta", items: [
    ["producto_nombre", "Producto", ""],
    ["precio", "Precio", "Ya con la opción de compra y el descuento aplicados"],
    ["total_cobrar", "Total a cobrar", "Precio + envío, según su zona"],
    ["adelanto", "Adelanto", ""],
    ["saldo", "Saldo", "Lo que falta después del adelanto"],
    ["datos_pago", "Datos de pago", "Los métodos que cargaste en el Validador"],
    ["link_entrega", "Link de entrega", "Solo productos digitales"],
    ["ultima_imagen", "Último comprobante", "Link a la imagen que mandó"],
  ] },
  { g: "El pedido", items: [
    ["pedido_guia", "Nº de guía", ""],
    ["pedido_guia_foto", "Foto de la guía", "La que subes al registrar el despacho"],
    ["pedido_agencia", "Agencia", ""],
    ["pedido_sede", "Sede / oficina", ""],
    ["pedido_clave_recojo", "Clave de recojo", ""],
    ["pedido_saldo", "Saldo del pedido", ""],
    ["pedido_adelanto", "Adelanto del pedido", ""],
    ["pedido_monto", "Total del pedido", ""],
    ["pedido_cliente", "Nombre para la agencia", ""],
    ["pedido_dni", "DNI", ""],
    ["pedido_direccion", "Dirección", ""],
    ["pedido_distrito", "Distrito", ""],
    ["pedido_ciudad", "Ciudad", ""],
    ["pedido_estado", "Estado del pedido", ""],
  ] },
];

const CSS = `
.vpk-btn{margin-top:6px;height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--border);
  background:transparent;color:var(--muted);font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;
  display:inline-flex;align-items:center;gap:5px}
.vpk-btn:hover{color:var(--text);border-color:var(--brand)}
.vpk-back{position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:18px}
.vpk{background:var(--surface);border:1px solid var(--border);border-radius:16px;width:100%;max-width:430px;
  max-height:76vh;display:flex;flex-direction:column;overflow:hidden}
.vpk h4{margin:0;padding:15px 17px 4px;font-size:15px}
.vpk .vpk-sub{padding:0 17px 11px;font-size:12px;color:var(--muted);line-height:1.5}
.vpk .vpk-q{margin:0 17px 10px;width:calc(100% - 34px);background:var(--surface-2);border:1px solid var(--border);
  border-radius:10px;color:var(--text);height:36px;padding:0 11px;font-size:13px;outline:none;font-family:inherit}
.vpk .vpk-q:focus{border-color:var(--brand)}
.vpk-list{overflow:auto;padding:0 10px 10px}
.vpk-g{font-size:10.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:var(--faint);padding:10px 7px 5px}
.vpk-it{display:block;width:100%;text-align:left;background:transparent;border:none;border-radius:9px;padding:8px 9px;
  cursor:pointer;font-family:inherit;color:var(--text)}
.vpk-it:hover{background:var(--surface-2)}
.vpk-it b{display:block;font-size:13px;font-weight:600}
.vpk-it code{font-size:11px;color:var(--brand);font-family:ui-monospace,Menlo,Consolas,monospace}
.vpk-it span{display:block;font-size:11px;color:var(--faint);margin-top:1px;line-height:1.4}
.vpk-foot{padding:10px 17px;border-top:1px solid var(--border);font-size:11.5px;color:var(--faint)}
.vpk-empty{padding:22px 17px;text-align:center;color:var(--faint);font-size:12.5px}
`;
let cssPuesto = false;
function ponerCss() {
  if (cssPuesto) return;
  cssPuesto = true;
  document.head.insertAdjacentHTML("beforeend", `<style data-vpk>${CSS}</style>`);
}

// Campos personalizados del canal (los del negocio). Se cachean por canal:
// el picker se abre muchas veces seguidas mientras se arma un mensaje.
const cacheCampos = new Map();
async function camposDelCanal(supa, channelId) {
  if (!supa || !channelId) return [];
  if (cacheCampos.has(channelId)) return cacheCampos.get(channelId);
  let out = [];
  try {
    const { data } = await supa.from("custom_fields").select("key,nombre,modo")
      .eq("channel_id", channelId).order("nombre");
    out = (data || []).filter((f) => f.key && !String(f.key).startsWith("_"))
      .map((f) => [f.key, f.nombre || f.key, f.modo === "fijo" ? "Campo del bot (mismo valor para todos)" : "Lo captura el bot en la conversación"]);
  } catch (_) { /* sin campos */ }
  cacheCampos.set(channelId, out);
  return out;
}

// Abre el selector. Devuelve la clave elegida (sin llaves) o null.
export async function elegirVariable({ supa, channelId } = {}) {
  ponerCss();
  const propios = await camposDelCanal(supa, channelId);
  const grupos = propios.length ? [...VAR_GRUPOS, { g: "Tus campos", items: propios }] : VAR_GRUPOS;
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "vpk-back";
    back.innerHTML = `<div class="vpk">
      <h4>Insertar un dato</h4>
      <div class="vpk-sub">Se reemplaza por el dato real de cada cliente al enviar el mensaje.</div>
      <input class="vpk-q" placeholder="Buscar…" />
      <div class="vpk-list"></div>
      <div class="vpk-foot">Si un dato no existe para ese cliente, sale vacío — no rompe el mensaje.</div>
    </div>`;
    const lista = back.querySelector(".vpk-list");
    const q = back.querySelector(".vpk-q");
    const pinta = () => {
      const f = q.value.trim().toLowerCase();
      const html = grupos.map((gr) => {
        const its = gr.items.filter(([k, t, d]) =>
          !f || k.toLowerCase().includes(f) || String(t).toLowerCase().includes(f) || String(d || "").toLowerCase().includes(f));
        if (!its.length) return "";
        return `<div class="vpk-g">${esc(gr.g)}</div>` + its.map(([k, t, d]) =>
          `<button class="vpk-it" data-k="${esc(k)}"><b>${esc(t)}</b><code>{{${esc(k)}}}</code>${d ? `<span>${esc(d)}</span>` : ""}</button>`).join("");
      }).join("");
      lista.innerHTML = html || `<div class="vpk-empty">Ningún dato coincide con “${esc(q.value)}”.</div>`;
      lista.querySelectorAll("[data-k]").forEach((b) => { b.onclick = () => cerrar(b.dataset.k); });
    };
    const cerrar = (v) => { back.remove(); document.removeEventListener("keydown", onEsc); resolve(v); };
    const onEsc = (e) => { if (e.key === "Escape") cerrar(null); };
    back.onclick = (e) => { if (e.target === back) cerrar(null); };
    q.oninput = pinta;
    document.addEventListener("keydown", onEsc);
    document.body.appendChild(back);
    pinta();
    q.focus();
  });
}

// Pega el botón "Insertar dato" debajo de un <textarea>/<input> y lo inserta
// EN EL CURSOR (no al final: si estás editando el medio de la frase, agregarlo
// al final obliga a cortar y pegar).
export function attachVarPicker(campo, { supa, channelId, onChange } = {}) {
  ponerCss();
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "vpk-btn";
  btn.innerHTML = `<span style="font-size:13px;line-height:1">{ }</span> Insertar dato`;
  btn.onclick = async () => {
    const k = await elegirVariable({ supa, channelId });
    if (!k) return;
    const txt = `{{${k}}}`;
    const ini = campo.selectionStart ?? campo.value.length;
    const fin = campo.selectionEnd ?? campo.value.length;
    campo.value = campo.value.slice(0, ini) + txt + campo.value.slice(fin);
    const cur = ini + txt.length;
    campo.focus();
    try { campo.setSelectionRange(cur, cur); } catch (_) { /* input sin selección */ }
    // Los editores guardan con oninput; dispararlo a mano evita que el dato
    // insertado se pierda al cerrar el panel sin volver a escribir.
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    onChange && onChange(campo.value);
  };
  if (campo.parentNode) campo.parentNode.insertBefore(btn, campo.nextSibling);
  return btn;
}
