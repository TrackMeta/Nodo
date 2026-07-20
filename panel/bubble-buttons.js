// ═══════════════════════════════════════════════════════════════════
//  Botones de una burbuja — editor compartido
//  Lo usan los TRES compositores que existen (mensajes iniciales del
//  producto, remarketing del producto y secuencias globales), que hasta
//  ahora repetían el mismo markup. Fuente única, mismo patrón que
//  flow-canvas.js y orders.js.
//
//  QUÉ HACE UN BOTÓN ACÁ: es un ATAJO, no un desvío. Al tocarlo, el
//  motor lo trata como si el cliente hubiera ESCRITO ese texto — lo lee
//  la IA, los interceptores y las condiciones. Por eso no hay nada más
//  que configurar que el texto, y por eso da igual si el cliente prefiere
//  escribir: nunca se rompe el hilo. (El ruteo determinista por arista
//  `boton:<id>` sigue existiendo en el editor de Flujos avanzado.)
// ═══════════════════════════════════════════════════════════════════

// Límites de WhatsApp, no nuestros: 3 botones por mensaje y 20 caracteres
// de título. Pasarse hace que Meta rechace el mensaje entero.
export const MAX_BOTONES = 3;
export const MAX_TITULO = 20;

const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Los ids se regeneran por posición: como el ruteo es por texto, el id solo
// tiene que ser único dentro del mensaje (que es lo único que pide Meta).
const reindex = (arr) => arr.forEach((b, i) => { b.id = "atajo_" + (i + 1); });

// Botones utilizables = los que tienen texto. Un botón vacío haría fallar el
// envío completo, así que se descartan al guardar.
export function limpiaBotones(bubbles) {
  for (const b of bubbles ?? []) {
    if (!Array.isArray(b.buttons)) continue;
    const ok = b.buttons
      .map((x) => ({ id: x.id, title: (x.title ?? "").trim().slice(0, MAX_TITULO) }))
      .filter((x) => x.title)
      .slice(0, MAX_BOTONES);
    if (ok.length) { reindex(ok); b.buttons = ok; } else { delete b.buttons; }
  }
  return bubbles;
}

// HTML del bloque. Solo tiene sentido en burbujas de TEXTO: en WhatsApp los
// botones cuelgan de un cuerpo de texto, no de una imagen suelta.
export function botonesHtml(bub) {
  const bs = Array.isArray(bub.buttons) ? bub.buttons : [];
  const filas = bs.map((b, i) => `
    <div style="display:flex;align-items:center;gap:6px">
      <input class="in bb-t" data-i="${i}" maxlength="${MAX_TITULO}" value="${esc(b.title || "")}"
        placeholder="Ej. Quiero comprar" style="height:32px;font-size:12.5px;max-width:230px"/>
      <button class="iconbtn bb-x" data-i="${i}" title="Quitar botón" type="button">✕</button>
    </div>`).join("");
  return `
    <div class="bb-wrap" style="margin-top:9px;padding-top:9px;border-top:1px dashed var(--border)">
      <div style="font-size:11px;color:var(--muted);font-weight:700;margin-bottom:${bs.length ? "7px" : "6px"}">
        Botones <span style="font-weight:400;color:var(--faint)">— atajos para tocar. Al tocarlo es como si el cliente lo escribiera, así que si prefiere escribir funciona igual.</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">${filas}</div>
      ${bs.length < MAX_BOTONES
        ? `<button class="btn bb-add" type="button" style="height:29px;font-size:11.5px;margin-top:${bs.length ? "7px" : "0"}">+ Botón</button>`
        : `<div style="font-size:11px;color:var(--faint);margin-top:7px">Máximo ${MAX_BOTONES} — es el límite de WhatsApp.</div>`}
    </div>`;
}

// Conecta el bloque. `rerender` se llama solo al agregar/quitar (escribir no
// re-renderiza: perdería el foco a cada tecla).
export function wireBotones(el, bub, rerender) {
  el.querySelectorAll(".bb-t").forEach((inp) => inp.oninput = (e) => {
    const i = Number(inp.dataset.i);
    if (bub.buttons?.[i]) bub.buttons[i].title = e.target.value;
  });
  el.querySelectorAll(".bb-x").forEach((b) => b.onclick = () => {
    const i = Number(b.dataset.i);
    bub.buttons.splice(i, 1);
    if (!bub.buttons.length) delete bub.buttons; else reindex(bub.buttons);
    rerender();
  });
  const add = el.querySelector(".bb-add");
  if (add) add.onclick = () => {
    if (!Array.isArray(bub.buttons)) bub.buttons = [];
    if (bub.buttons.length >= MAX_BOTONES) return;
    bub.buttons.push({ id: "", title: "" });
    reindex(bub.buttons);
    rerender();
  };
}
