// ── Editor de pasos de secuencia COMPARTIDO ────────────────────────────
// Un solo editor para la página Secuencias (secuencias.html) y para la sección
// Reenganche del producto (productos.html). Antes eran dos implementaciones
// paralelas (renderMsgComposer vs remComposer) que había que mantener a mano.
// UI: recorrido visual (anuncio → no compró → toques por día), se edita UN toque
// a la vez, con plantillas de arranque, vista previa tipo WhatsApp, y el ángulo
// como switch "el mismo / según el anuncio". Opcional (para Secuencias): selector
// de Acción por paso (mensaje/plantilla/flujo). Guarda editando seq.pasos EN SITIO;
// cada página persiste con su propio botón (por eso el módulo expone normalize()).
import { supa, icon, toast, confirmDialog } from "./shell.js";
import { botonesHtml, wireBotones, limpiaBotones } from "./bubble-buttons.js";

const esc = (s)=> (s??"").toString().replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const uid = ()=> "v"+Math.random().toString(36).slice(2,9);
// `rev` sube cuando se reescribe el texto: los resultados medidos de un copy que ya
// cambió son de otro copy, y sumarlos con los nuevos corrompe justo el número que uno
// mira para decidir qué versión deja. Ver `subeRevSiCambio`.
// La primera «Versión X» libre entre estas versiones (las del mismo grupo/pestaña): cada pestaña cuenta A, B, C…
export function versionLibre(vs){ const usados=new Set((vs||[]).map(v=>String(v?.nombre||""))); for(let i=0;i<26;i++){ const n="Versión "+String.fromCharCode(65+i); if(!usados.has(n)) return n; } return "Versión "+((vs||[]).length+1); }
export function newVariant(idx){ return { id:uid(), rev:1, nombre:"Versión "+String.fromCharCode(65+(idx||0)), activo:true, peso:1, bubbles:[{text:""}] }; }
// Texto plano de una versión (para detectar el cambio).
export function textoVariante(v){ return (v?.bubbles||[]).map(b=>String(b?.text||"")).join("\n"); }
// Recorre los pasos y le sube el rev a las versiones cuyo texto cambió desde que se
// abrió el editor. Se llama al guardar, con la foto que se tomó al abrir.
// La foto se indexa SOLO por el id de la versión, nunca por su posición. Con el índice del
// paso en la clave, borrar o reordenar un toque —lo más normal al editar una secuencia—
// movía a las demás de sitio: la versión se buscaba en `2|vX` cuando la foto la guardó en
// `1|vX`, no se encontraba, y un copy reescrito NO reiniciaba su medición. Volvía a pasar
// justo lo que el `rev` viene a evitar: resultados de un texto viejo sumados con los del
// nuevo, en silencio. El id es único, así que la posición no aporta nada.
export function subeRevSiCambio(pasos, foto){
  (pasos||[]).forEach((p)=>{
    (p?.variantes||[]).forEach(v=>{
      if(!v) return;
      if(!v.id) v.id=uid();
      if(!v.rev) v.rev=1;
      const antes=foto?.[v.id];
      if(antes!==undefined && antes!==textoVariante(v)){ v.rev=Number(v.rev)+1; v.medido_desde=new Date().toISOString(); }
    });
  });
}
// Foto del texto de cada versión al abrir el editor.
export function fotoVariantes(pasos){
  const f={};
  (pasos||[]).forEach((p)=>(p?.variantes||[]).forEach(v=>{ if(v?.id) f[v.id]=textoVariante(v); }));
  return f;
}
// Frecuencia de una versión = su % editable a mano. Por debajo es `peso` (el
// motor normaliza por la suma). Solo se muestra cuando 2+ versiones compiten en
// el mismo grupo (mismo ángulo). El usuario escribió un % para ESTA versión: se
// traduce a un peso que da ese % dejando a las otras con su reparto actual del
// resto. peso = sumaOtras·P/(100-P).
export function pesoFromShare(othersSum, pct){
  pct=Math.max(0,Math.min(100,Number(pct)||0));
  const os=othersSum>0?othersSum:1;
  if(pct>=100) return os*10000; // domina (las otras ~0%)
  if(pct<=0) return 0;
  return os*pct/(100-pct);
}
// `sharePct` = % actual de esta versión dentro del grupo.
export function freqControlHtml(v, sharePct){
  return `<span style="font-size:11px;color:var(--muted)">Sale el</span><span style="display:inline-flex;align-items:center;gap:2px"><input class="se-share-num" type="number" min="0" max="100" value="${Math.round(sharePct)}" title="% que sale esta versión (a mano)" style="width:48px;height:30px;text-align:center;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;color:var(--brand);font-weight:700;font-size:13px;outline:none;font-family:inherit"/><span style="font-size:12px;color:var(--brand);font-weight:700">%</span></span><span style="font-size:11px;color:var(--muted)">de las veces</span>`;
}
const CAPTION_MAX = 1024;
const conCaption = (b) => !!(b && b.media_url && b.media_kind !== "audio");
// La imagen pegada a una burbuja de texto: primero la de ARRIBA (el texto queda debajo, como ya se leía) y si no, la de abajo.
function mediaVecina(v, bi){
  const bs=v.bubbles||[];
  if(conCaption(bs[bi-1])) return { idx:bi-1, arriba:true, b:bs[bi-1] };
  if(conCaption(bs[bi+1])) return { idx:bi+1, arriba:false, b:bs[bi+1] };
  return null;
}
function splitDur(sec){ sec=Number(sec||0); if(sec%86400===0&&sec>=86400)return{val:sec/86400,u:"86400"}; if(sec%3600===0&&sec>=3600)return{val:sec/3600,u:"3600"}; return{val:Math.round(sec/60)||1,u:"60"}; }
const UNITS=[["60","minutos"],["3600","horas"],["86400","días"]];

// Plantillas de arranque por defecto: VACÍO a propósito (Secuencias no muestra
// plantillas — arranca directo con un toque en blanco). Una página puede pasar
// las suyas por `opts.presets` (ej. Reenganche del producto sí las usa).
export const DEFAULT_PRESETS=[];

function sample(t){ return String(t||"").replace(/\{\{\s*nombre\s*\}\}/gi,"Ana").replace(/\{\{\s*precio\s*\}\}/gi,"S/ 100").replace(/\{\{\s*ciudad\s*\}\}/gi,"Lima").replace(/\{\{[^}]*\}\}/g,"…"); }
// Papel tapiz clásico de WhatsApp (beige con garabatos tenues). Va embebido en el
// atributo style=: url() SIN comillas y con las comillas del SVG como %27, así no
// pelea con las comillas del atributo.
const WA_WALL="url(data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2744%27%20height=%2744%27%3E%3Cg%20fill=%27none%27%20stroke=%27%23000%27%20stroke-opacity=%27.04%27%20stroke-width=%271.1%27%3E%3Cpath%20d=%27M8%209h6M11%206v6%27/%3E%3Ccircle%20cx=%2732%27%20cy=%2713%27%20r=%273%27/%3E%3Cpath%20d=%27M6%2032q4-4%208%200%27/%3E%3Cpath%20d=%27M28%2031h6M31%2028v6%27/%3E%3C/g%3E%3C/svg%3E)";
const _brandCache={};

// Nombre + logo del negocio para la cabecera de la preview (una consulta por
// canal, cacheada). Exportada para que "Cómo llegan los clientes" use el mismo dato.
export async function seqBrand(channelId){
  if(_brandCache[channelId]) return _brandCache[channelId];
  try{ const {data}=await supa.from("channels").select("nombre,logo_url").eq("id",channelId).single(); return _brandCache[channelId]=data||{}; }
  catch(e){ return _brandCache[channelId]={}; }
}

// Burbujas estilo WhatsApp (verde saliente a la derecha, colita en la 1ª, sombra
// y ✓✓ azul). `list` = burbujas {text|caption, media_url, media_kind}; `smp`
// resuelve los {{campos}}. Texto = text||caption (el motor manda caption ?? text).
export function waBubbles(list, smp){
  smp = smp || (t=>String(t||""));
  const bText=b=>(b&&(b.text||b.caption))||'';
  const bubs=(list||[]).filter(b=> b && (b.media_url||bText(b).trim()));
  if(!bubs.length) return '';
  return bubs.map((b,i)=>{
    let media=''; const cap=bText(b);
    if(b.media_url&&b.media_kind==='image') media=`<img src="${esc(b.media_url)}" style="max-width:100%;border-radius:6px;display:block;margin-bottom:${cap?'4px':'0'}">`;
    else if(b.media_url&&b.media_kind==='video') media=`<div style="position:relative;background:#0b141a;border-radius:6px;padding:20px 0;text-align:center;margin-bottom:${cap?'4px':'0'}"><span style="display:inline-flex;width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.85);color:#0b141a;align-items:center;justify-content:center;font-size:13px">▶</span><span style="position:absolute;right:6px;bottom:4px;color:#fff;font-size:8.5px;background:rgba(0,0,0,.4);border-radius:4px;padding:0 4px">0:12</span></div>`;
    else if(b.media_url&&b.media_kind==='audio') media=`<div style="display:flex;align-items:center;gap:6px;color:#5b8a72;font-size:11px;margin-bottom:${cap?'4px':'0'}"><span style="width:20px;height:20px;border-radius:50%;background:#c7e6d3;display:inline-flex;align-items:center;justify-content:center">${icon("mic")}</span><span style="flex:1;height:3px;background:#a9d3ba;border-radius:3px;position:relative"><span style="position:absolute;left:0;top:-2.5px;width:8px;height:8px;border-radius:50%;background:#4fa97e"></span></span><span>0:07</span></div>`;
    else if(b.media_url) media=`<div style="color:#5b8a72;font-size:11px;margin-bottom:${cap?'4px':'0'}">${icon("file")} archivo</div>`;
    const txt=cap?smp(esc(cap)).replace(/\n/g,"<br>"):'';
    const tail=i===0?`<span style="position:absolute;top:0;right:-6px;width:0;height:0;border-top:7px solid #DCF8C6;border-right:7px solid transparent"></span>`:'';
    const bubble=`<div style="position:relative;background:#DCF8C6;color:#111b21;border-radius:8px 8px 3px 8px;padding:5px 8px 4px;font-size:12px;line-height:1.4;box-shadow:0 1px 1px rgba(0,0,0,.13);word-break:break-word">${tail}${media}${txt}<div style="font-size:9px;color:#667781;text-align:right;margin-top:1px;line-height:1;white-space:nowrap">10:24 <span style="color:#53bdeb">✓✓</span></div></div>`;
    // Botones = atajos de respuesta rápida de WhatsApp: filas blancas bajo la
    // burbuja, texto azul centrado con flechita de respuesta (máx 3, 20 chars).
    const btns=(Array.isArray(b.buttons)?b.buttons:[]).map(x=>(x&&(x.title||"").trim())).filter(Boolean).slice(0,3);
    const btnsHtml=btns.length?`<div style="display:flex;flex-direction:column;gap:2px;margin-top:2px">${btns.map(t=>`<div style="background:#fff;border-radius:7px;box-shadow:0 1px 1px rgba(0,0,0,.13);padding:8px 6px;text-align:center;color:#00a5f4;font-size:12px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:5px"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#00a5f4" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h8a5 5 0 0 1 5 5v4"/></svg>${esc(t.slice(0,20))}</div>`).join("")}</div>`:'';
    return `<div style="align-self:flex-end;max-width:88%;display:flex;flex-direction:column">${bubble}${btnsHtml}</div>`;
  }).join('');
}

// Pantalla de WhatsApp completa: notch + cabecera (avatar/nombre/en línea) + cuerpo
// con papel tapiz, separador "HOY" y las burbujas. La usan el editor de pasos y
// "Cómo llegan los clientes" para verse idénticas.
export function waScreenHtml({ title, logoUrl, emoji, bubblesHtml, empty }={}){
  const ava = logoUrl ? `<img src="${esc(logoUrl)}" style="width:100%;height:100%;object-fit:cover">` : (emoji?esc(emoji):icon("message"));
  const body = bubblesHtml
    ? `<div style="align-self:center;background:rgba(225,245,254,.92);color:#54656f;font-size:9px;font-weight:600;padding:2px 9px;border-radius:7px;box-shadow:0 1px 1px rgba(0,0,0,.08);margin-bottom:2px">HOY</div>${bubblesHtml}`
    : `<div style="font-size:11.5px;color:#667781;text-align:center;padding:16px 6px">${esc(empty||"Escribe el mensaje para ver cómo llega…")}</div>`;
  return `<div style="border-radius:16px;overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,.28);border:1px solid rgba(0,0,0,.2)">
    <div style="background:#075E54;display:flex;justify-content:center;padding-top:5px"><div style="width:52px;height:4px;border-radius:3px;background:rgba(0,0,0,.28)"></div></div>
    <div style="background:#075E54;display:flex;align-items:center;gap:7px;padding:5px 9px 7px">
      <span style="color:#e9f5ef;font-size:16px;line-height:1;margin-right:-3px">‹</span>
      <div style="width:27px;height:27px;border-radius:50%;background:#128C7E;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;overflow:hidden;flex:none">${ava}</div>
      <div style="flex:1;min-width:0"><div style="color:#fff;font-size:11.5px;font-weight:600;line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title||"Tu negocio")}</div><div style="color:#a7d3c7;font-size:9px;line-height:1.2">en línea</div></div>
      <span style="color:#cfe9d8;font-size:12px">${icon("video")}</span><span style="color:#cfe9d8;font-size:12px">${icon("directo")}</span>
    </div>
    <div style="background-color:#E5DDD5;background-image:${WA_WALL};background-repeat:repeat;padding:9px 8px;display:flex;flex-direction:column;gap:5px;min-height:112px">${body}</div>
  </div>`;
}

// Sólo las burbujas del paso (extrae la 1ª variante activa). Se envuelve con waScreenHtml.
// Con ángulos, la de la pestaña elegida (si ese ángulo no tiene propio, la de Todos: es lo que le llega).
function previewHtml(paso, angulos=[]){
  let todas=(Array.isArray(paso?.variantes)?paso.variantes:[]);
  if(angulos.length){
    const known=new Set(angulos.map(a=>a.slug)), tab=tabDe.get(paso) ?? "";
    const de=(t)=>todas.filter(v=> t==="" ? (!v.angulo || !known.has(v.angulo)) : v.angulo===t);
    todas = de(tab).length ? de(tab) : de("");
  }
  const vs=todas.filter(v=>v.activo!==false && v.bubbles && v.bubbles.length);
  const v=vs[0]||todas[0];
  return waBubbles((v&&v.bubbles)||[], sample);
}

// ═════════════════════════════════════════════════════════════════════════
// Editor de UN mensaje (las versiones de un paso de secuencia o del saludo): texto, imágenes y archivos, botones,
// varias versiones que rotan con su %, y a qué ángulo responde cada una. Lo usan el editor de pasos (abajo) y la
// ficha del ángulo (angulos-mapa.js). Edita `paso.variantes` EN SITIO; cada página guarda con su botón.
// soloAngulo: muestra y crea solo las versiones de ese ángulo (sin el selector «el mismo / según el anuncio»).
// grupo: igual pero acepta "" = solo las generales (sin ángulo). Lo usan las pestañas del saludo del producto.
// ═════════════════════════════════════════════════════════════════════════
export function mountMensajeEditor(box, paso, { channelId, angulos = [], soloAngulo = "", grupo = null } = {}){
  hazComposer({ channelId, angulos: (angulos||[]).filter(a=>a&&a.slug), soloAngulo, grupo })(box, paso);
}
// La pestaña elegida en cada paso. Va aparte (no dentro del paso) para que no se guarde en la base.
const tabDe = new WeakMap();
export const pestanaDe = (paso) => tabDe.get(paso) ?? "";
function hazComposer({ channelId, angulos, soloAngulo = "", grupo = null }){
  const enTabDe=(t,v)=>{ const known=new Set(angulos.map(a=>a.slug)); return t==="" ? (!v.angulo || !known.has(v.angulo)) : v.angulo===t; };
  // El grupo que se edita (null = todos, como en Secuencias): "" = las generales, "slug" = las de ese ángulo.
  const solo = grupo != null ? String(grupo) : (soloAngulo ? String(soloAngulo) : null);
  function composer(box, paso){
    if(!Array.isArray(paso.variantes)||!paso.variantes.length){
      const first = paso.mensaje ? [{text:String(paso.mensaje)}] : (Array.isArray(paso.bubbles)&&paso.bubbles.length?paso.bubbles:[{text:""}]);
      paso.variantes=[{ ...newVariant(0), bubbles:first }];
    }
    delete paso.mensaje; delete paso.bubbles;
    if(paso.rotacion===undefined) paso.rotacion=false;
    // (1-nov, Rodrigo: «de saludo me gusta ese selector») Con ángulos, cada toque se edita por PESTAÑAS como el saludo
    // del producto: «Todos · Dolor · …», una a la vez. Reemplaza «El mismo para todos / Según el anuncio», los grupos
    // apilados («Respaldo general») y el «Mover a». El motor elige igual: la del ángulo del cliente; si no hay, la de Todos.
    const tabs = solo==null && angulos.length>0;
    const rot=solo!=null || tabs ? true : (paso.rotacion===true && paso.variantes.length>0);
    const known=new Set(angulos.map(a=>a.slug));
    const tab = tabs ? (tabDe.get(paso) ?? "") : null;
    // «Todos» = las versiones sin ángulo (y las de un ángulo que ya no existe, que el motor trata igual).
    const enTab=(v)=> tab==="" ? (!v.angulo || !known.has(v.angulo)) : v.angulo===tab;
    const tabBtn=(on)=>`font-size:12px;padding:5px 12px;border-radius:999px;cursor:pointer;font-weight:${on?'700':'600'};border:${on?'none':'0.5px solid var(--border)'};background:${on?'var(--ia1,#8b5cf6)':'transparent'};color:${on?'#fff':'var(--muted)'}`;
    if(solo!=null){ box.innerHTML=`<div class="se-varlist"></div>`; }
    else box.innerHTML=`
      <div style="border:1px solid var(--border);border-radius:11px;background:var(--surface-2);padding:11px 12px;margin-top:10px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
          <span style="flex:1;min-width:135px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px">${icon("message")} Mensaje del paso</span>
          ${tabs?``:`<span style="font-size:11.5px;color:var(--muted);font-weight:600">Varias versiones</span><div class="sw ${rot?'on':''}" data-rot title="Enviar una versión distinta cada vez"></div>`}
        </div>
        ${tabs?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
            <button type="button" class="se-tab" data-tab="" style="${tabBtn(tab==="")}">Todos</button>
            ${angulos.map(a=>{ const tiene=paso.variantes.some(v=>v.angulo===a.slug); return `<button type="button" class="se-tab" data-tab="${esc(a.slug)}" style="${tabBtn(tab===a.slug)}" title="${a.propia?"Tiene su propia secuencia: no recibe estos toques":tiene?"Tiene su propio mensaje":"Usa el mensaje de Todos"}">${esc(a.nombre||a.slug)}${a.propia?` <span style="opacity:.6;font-weight:500">· su secuencia</span>`:tiene?"":` <span style="opacity:.6;font-weight:500">· usa Todos</span>`}</button>`; }).join("")}
          </div>
          <div style="font-size:11px;color:var(--faint);margin-bottom:8px">${tab===""?"Lo reciben todos, salvo los que llegaron por un ángulo con su propio mensaje.":"Lo reciben solo los que llegaron por los anuncios de este ángulo."}</div>`
        :`<div style="font-size:11px;color:var(--faint);margin-bottom:8px">${rot?"El bot va alternando entre las versiones. Con 2+ puedes ajustar cuánto sale cada una.":"Un solo mensaje para todos los clientes de este público."}</div>`}
        <div class="se-varlist"></div>
        ${rot&&!tabs?`<button class="btn" data-addvar style="height:30px;padding:0 10px;font-size:12px;margin-top:10px">+ Agregar versión</button>`:``}
      </div>`;
    box.querySelectorAll(".se-tab").forEach(b=> b.onclick=()=>{ tabDe.set(paso, b.dataset.tab); composer(box,paso); box.dispatchEvent(new Event("click",{bubbles:true})); });
    const rtog=box.querySelector("[data-rot]"); if(rtog) rtog.onclick=()=>{ paso.rotacion=!rot; composer(box,paso); };
    const av=box.querySelector("[data-addvar]"); if(av) av.onclick=()=>{ paso.variantes.push({ ...newVariant(0), nombre:versionLibre(paso.variantes) }); composer(box,paso); };
    const vl=box.querySelector(".se-varlist");

    // Pinta una versión (tarjeta). `compite` = hay 2+ versiones activas en su
    // grupo → recién ahí aparece el control de frecuencia (Poco/Normal/Mucho) y
    // el % REAL dentro del grupo. Con una sola, nada de eso (no aplica).
    // `unico` = es la única versión de su grupo: sin encabezado (nombre, encendido, tacho), solo el mensaje — con una
    // sola no hay nada que elegir y la tarjeta «Versión A» confundía (1-nov, Rodrigo). Si está pausada sí se muestra,
    // para poder volver a prenderla.
    function renderCard(v, vi, compite, pesoG, groupActiveVs, unico){
      if(!Array.isArray(v.bubbles)||!v.bubbles.length) v.bubbles=[{text:""}];
      const card=document.createElement("div");
      if(rot && !(unico && v.activo!==false)){
        card.style.cssText="border:1px solid var(--border);border-radius:10px;padding:11px;background:var(--surface);margin-top:9px";
        const share=v.activo!==false?Math.round(Math.max(0,Number(v.peso??1))/pesoG*100):0;
        const freq = compite ? freqControlHtml(v, share) : "";
        card.innerHTML=`
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:${compite?'8px':'9px'}">
            <input class="in se-vname" style="flex:1;min-width:90px;font-weight:700;height:32px;padding:0 10px" value="${esc(v.nombre||('Versión '+String.fromCharCode(65+vi)))}"/>
            <div class="sw ${v.activo!==false?'on':''}" data-vact title="Activar/pausar"></div>
            <button class="iconbtn se-vdel" title="Eliminar versión">${icon("trash")}</button>
          </div>
          ${compite?`<div style="display:flex;align-items:center;gap:8px;margin-bottom:9px">${freq}</div>`:``}
          <div class="se-bubbles" style="display:flex;flex-direction:column;gap:8px"></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px">${addBtns()}</div>`;
        card.querySelector(".se-vname").oninput=(e)=>v.nombre=e.target.value;
        { const sn=card.querySelector(".se-share-num"); if(sn){ sn.onchange=()=>{ const others=(groupActiveVs||[]).filter(x=>x!==v); const os=others.reduce((a,x)=>a+Math.max(0,Number(x.peso??1)),0); v.peso=pesoFromShare(os, sn.value); composer(box,paso); }; } }
        card.querySelector("[data-vact]").onclick=()=>{ v.activo=v.activo===false?true:false; composer(box,paso); };
        card.querySelector(".se-vdel").onclick=async()=>{ if(solo==null && paso.variantes.length<=1){ toast("Debe quedar al menos una versión",true); return; } if(!await confirmDialog({title:"Eliminar versión",message:"¿Eliminar esta versión?",confirmText:"Eliminar",danger:true})) return; paso.variantes.splice(vi,1); composer(box,paso); };
      } else {
        card.innerHTML=`<div class="se-bubbles" style="display:flex;flex-direction:column;gap:8px"></div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px">${addBtns()}</div>`;
      }
      const bb=card.querySelector(".se-bubbles");
      v.bubbles.forEach((bub,bi)=> bb.appendChild(bubbleEl(box,paso,v,bub,bi)));
      card.querySelectorAll("[data-addb]").forEach(btn=> btn.onclick=()=>{
        const k=btn.dataset.addb;
        if(k==="text"){ v.bubbles.push({text:""}); composer(box,paso); }
        else pickMedia(box,paso,v,k);
      });
      return card;
    }

    if(!rot){ vl.appendChild(renderCard(paso.variantes[0], 0, false, 1)); return; }
    // Un grupo a la vez: la pestaña elegida, o el grupo fijo de quien lo usa (saludo del producto, ficha del ángulo).
    const grupoVis = solo!=null ? solo : tab;
    const angTab = tabs && tab ? angulos.find(a=>a.slug===tab) : null;
    if(angTab && angTab.propia){
      // (2-nov) Ángulo con secuencia PROPIA: no recibe los toques de esta secuencia, así que no se edita acá.
      const w=document.createElement("div");
      w.style.cssText="border:1px dashed var(--border);border-radius:10px;padding:14px;text-align:center;margin-top:4px;font-size:12.5px;color:var(--muted);line-height:1.5";
      w.innerHTML=`«<b style="color:var(--text)">${esc(angTab.nombre||tab)}</b>» tiene su <b style="color:var(--text)">propia secuencia</b>: los que llegan por sus anuncios no reciben este toque. Se edita en Productos → Ángulos → ${esc(angTab.nombre||tab)}.`;
      vl.appendChild(w);
      return;
    }
    if(grupoVis!=null){
      const mias=paso.variantes.map((v,vi)=>({v,vi})).filter(x=> solo!=null ? (x.v.angulo||"")===solo : enTab(x.v));
      if(!mias.length && tabs && tab!==""){
        // Ángulo sin mensaje propio: le llega el de Todos. Se crea copiando el de Todos para cambiarlo.
        const nom=esc((angulos.find(a=>a.slug===tab)||{}).nombre||tab);
        const w=document.createElement("div");
        w.style.cssText="border:1px dashed var(--border);border-radius:10px;padding:14px;text-align:center;margin-top:4px";
        w.innerHTML=`<div style="font-size:12.5px;color:var(--muted);margin-bottom:10px">Los que llegan por <b style="color:var(--text)">${nom}</b> reciben el mensaje de <b style="color:var(--text)">Todos</b>.</div>
          <button class="btn" type="button" data-propio style="height:32px;padding:0 13px;font-size:12.5px">＋ Mensaje propio para ${nom}</button>`;
        w.querySelector("[data-propio]").onclick=()=>{
          const base=paso.variantes.find(v=>enTabDe("",v) && v.activo!==false) || paso.variantes.find(v=>enTabDe("",v));
          const nv=newVariant(0); nv.angulo=tab;   // la primera de esta pestaña: «Versión A»
          if(base && Array.isArray(base.bubbles) && base.bubbles.length) nv.bubbles=JSON.parse(JSON.stringify(base.bubbles));
          paso.variantes.push(nv); composer(box,paso); box.dispatchEvent(new Event("input",{bubbles:true}));
        };
        vl.appendChild(w);
        return;
      }
      const act=mias.filter(x=>x.v.activo!==false), pesoG=act.reduce((s2,x)=>s2+Math.max(0,Number(x.v.peso??1)),0)||1;
      mias.forEach(({v,vi})=> vl.appendChild(renderCard(v, vi, act.length>1, pesoG, act.map(x=>x.v), mias.length===1)));
      // Pestaña de un ángulo con su único mensaje propio: cómo volver a usar el de Todos (sin tacho a la vista).
      if(tabs && tab!=="" && mias.length===1){ const q=document.createElement("button"); q.type="button"; q.className="btn"; q.style.cssText="height:28px;padding:0 11px;font-size:11.5px;margin:9px 8px 0 0;background:transparent;border:1px dashed var(--border);color:var(--muted)"; q.textContent="✕ Quitar y usar el de Todos"; q.onclick=async()=>{ if(!await confirmDialog({title:"Quitar el mensaje propio",message:"Los que llegan por este ángulo van a recibir el mensaje de Todos.",confirmText:"Quitar",danger:true})) return; paso.variantes.splice(mias[0].vi,1); composer(box,paso); box.dispatchEvent(new Event("input",{bubbles:true})); }; vl.appendChild(q); }
      const add=document.createElement("button"); add.className="btn"; add.style.cssText="height:28px;padding:0 11px;font-size:11.5px;margin-top:9px;background:transparent;border:1px dashed var(--border)";
      add.textContent="＋ Otra versión (el bot las rota)";
      add.onclick=()=>{ const nv={ ...newVariant(0), nombre:versionLibre(mias.map(x=>x.v)) }; if(grupoVis) nv.angulo=grupoVis; paso.variantes.push(nv); paso.rotacion=true; composer(box,paso); };   // rotacion: el motor rota entre las versiones de un mismo grupo
      vl.appendChild(add);
      return;
    }
    // Sin ángulos: un solo grupo con todas las versiones (A/B), que el bot rota.
    const withIdx = paso.variantes.map((v,vi)=>({v,vi}));
    const activas=withIdx.filter(x=>x.v.activo!==false);
    const pesoG=activas.reduce((a,x)=>a+Math.max(0,Number(x.v.peso??1)),0)||1;
    withIdx.forEach(({v,vi})=> vl.appendChild(renderCard(v, vi, activas.length>1, pesoG, activas.map(x=>x.v), withIdx.length===1)));
  }

  // 🖼️ Texto en la misma burbuja que la imagen (venía del saludo del producto, 2-oct): una burbuja de texto pegada a una
  // imagen/video/archivo se puede juntar como su texto debajo. Con botones no (es un mensaje interactivo); el audio no lleva texto.
  function juntarHtml(v,bub,bi){
    if(bub.media_url || (bub.buttons||[]).length) return "";
    const m=mediaVecina(v,bi); if(!m) return "";
    const que=m.b.media_kind==="video"?"el video":m.b.media_kind==="document"?"el archivo":"la imagen";
    return `<button class="btn se-juntar" type="button" style="margin-top:7px;height:28px;padding:0 10px;font-size:12px;background:transparent;border:1px dashed var(--border);color:var(--muted)">${icon("image")} Juntar con ${que} de ${m.arriba?"arriba":"abajo"}</button>`;
  }
  function juntarConMedia(box,paso,v,bi){
    const t=v.bubbles[bi]; const m=mediaVecina(v,bi); if(!t||!m) return;
    const txt=String(t.text||"").trim();
    if(!txt){ toast("Escribe el texto primero",true); return; }
    const cap=String(m.b.caption||"").trim();
    // El texto de la imagen siempre sale DEBAJO: si el texto iba antes, se antepone a lo que ya tuviera.
    const nuevo = cap ? (m.arriba ? `${cap}\n\n${txt}` : `${txt}\n\n${cap}`) : txt;
    if(nuevo.length>CAPTION_MAX){ toast(`Juntos tendrían ${nuevo.length} caracteres y WhatsApp corta el texto de una imagen en ${CAPTION_MAX}. Acórtalo primero.`,true); return; }
    m.b.caption=nuevo; v.bubbles.splice(bi,1);
    composer(box,paso);
    box.dispatchEvent(new Event("input",{bubbles:true}));   // la página que lo usa se entera (vista previa, «sin guardar»)
    toast("Listo: el texto va en la misma burbuja");
  }
  // (10-oct) Dos botones: el tipo (imagen/video/audio/archivo) se saca del archivo elegido.
  function addBtns(){ return ["text","file"].map(k=>`<button class="btn" data-addb="${k}" style="height:30px;padding:0 10px;font-size:12px">+ ${({text:"Texto",file:"Imagen o archivo"})[k]}</button>`).join(""); }

  function bubbleEl(box,paso,v,bub,bi){
    const el3=document.createElement("div");
    el3.style.cssText="border:1px solid var(--border);border-radius:9px;padding:9px 10px;background:var(--surface)";
    const kind=bub.media_kind||"text";
    const tIco={text:"note",image:"image",video:"video",audio:"mic",document:"file"}[kind]||"note";
    let prev="";
    if(kind==="image") prev=`<img src="${esc(bub.media_url)}" style="max-width:140px;max-height:100px;border-radius:7px;display:block;margin-bottom:7px"/>`;
    else if(kind==="video") prev=`<video src="${esc(bub.media_url)}" style="max-width:180px;max-height:120px;border-radius:7px;display:block;margin-bottom:7px" controls></video>`;
    else if(kind==="audio") prev=`<audio src="${esc(bub.media_url)}" style="height:34px;margin-bottom:7px;display:block" controls></audio>`;
    else if(kind==="document") prev=`<div style="font-size:12px;margin-bottom:7px;display:flex;align-items:center;gap:5px">${icon("file")} ${esc(bub.filename||"documento")}</div>`;
    el3.innerHTML=`
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:7px">
        <span style="flex:1;font-size:11.5px;font-weight:600;display:flex;align-items:center;gap:5px;color:var(--muted)">${icon(tIco)} ${kind==="text"?"Texto":kind.charAt(0).toUpperCase()+kind.slice(1)}</span>
        ${bi>0?`<button class="iconbtn se-bup" title="Subir"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg></button>`:""}
        ${bi<v.bubbles.length-1?`<button class="iconbtn se-bdown" title="Bajar"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>`:""}
        ${(v.bubbles.length>1||bub.media_url)?`<button class="iconbtn se-bdel" title="Quitar">${icon("trash")}</button>`:""}
      </div>
      ${prev}
      ${kind==="text"
        ? `<textarea class="in se-btext" style="width:100%;min-height:52px;field-sizing:content;max-height:320px" placeholder="Escribe el mensaje… puedes usar {{nombre}}, {{precio}}…">${esc(bub.text||"")}</textarea>${botonesHtml(bub)}`
        : (kind!=="audio"?`<textarea class="in se-bcap" style="width:100%;min-height:44px;field-sizing:content;max-height:320px" placeholder="Texto debajo (opcional) — sale en la MISMA burbuja que ${kind==="video"?"el video":kind==="document"?"el archivo":"la imagen"}">${esc(bub.caption||"")}</textarea><div class="se-capav" style="font-size:11.5px;margin-top:4px;color:var(--red,#e2564a)"></div>`:``)}
      ${juntarHtml(v,bub,bi)}`;
    if(kind==="text") wireBotones(el3,bub,()=>composer(box,paso));
    const tx=el3.querySelector(".se-btext"); if(tx) tx.oninput=(e)=>bub.text=e.target.value;
    const cp=el3.querySelector(".se-bcap");
    if(cp){ const av=el3.querySelector(".se-capav");
      // 🖼️ WhatsApp corta el texto debajo de una foto/video en 1024 caracteres.
      const pinta=()=>{ const n=cp.value.length; av.textContent = n>CAPTION_MAX ? `Tiene ${n} caracteres: WhatsApp corta el texto debajo de ${kind==="video"?"un video":"una imagen"} en ${CAPTION_MAX}. Acórtalo o pásalo a una burbuja de texto.` : ""; };
      cp.oninput=(e)=>{ bub.caption=e.target.value; pinta(); }; pinta(); }
    { const jb=el3.querySelector(".se-juntar"); if(jb) jb.onclick=()=>juntarConMedia(box,paso,v,bi); }
    const _bd=el3.querySelector(".se-bdel"), _bu=el3.querySelector(".se-bup"), _bw=el3.querySelector(".se-bdown");
    if(_bd) _bd.onclick=()=>{ v.bubbles.splice(bi,1); if(!v.bubbles.length) v.bubbles.push({text:""}); composer(box,paso); };
    if(_bu) _bu.onclick=()=>{ if(bi===0)return; [v.bubbles[bi-1],v.bubbles[bi]]=[v.bubbles[bi],v.bubbles[bi-1]]; composer(box,paso); };
    if(_bw) _bw.onclick=()=>{ if(bi>=v.bubbles.length-1)return; [v.bubbles[bi+1],v.bubbles[bi]]=[v.bubbles[bi],v.bubbles[bi+1]]; composer(box,paso); };
    return el3;
  }

  function pickMedia(box,paso,v,kind){
    const accept={image:"image/*",video:"video/*",audio:"audio/*",file:"image/*,video/*,audio/*,application/pdf,*/*"}[kind]||"*/*";
    const inp=document.createElement("input"); inp.type="file"; inp.accept=accept;
    inp.onchange=async()=>{
      const file=inp.files&&inp.files[0]; if(!file) return;
      if(kind==="file"){ const t=file.type||""; kind=t.startsWith("image/")?"image":t.startsWith("video/")?"video":t.startsWith("audio/")?"audio":"document"; }
      if(file.size>16*1024*1024){ toast("Archivo muy grande (máx 16 MB)",true); return; }
      toast("Subiendo…");
      try{
        const dataURL=await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); });
        const { data,error }=await supa.functions.invoke("media-upload",{ body:{ channel_id:channelId, filename:file.name, content_type:file.type, data:dataURL } });
        if(error||!data?.url){ toast("No se pudo subir el archivo",true); return; }
        v.bubbles.push({ media_kind:data.kind||kind, media_url:data.url, mime:file.type, filename:file.name, caption:"" });
        toast("Archivo agregado"); composer(box,paso);
      }catch(e){ toast("Error al subir",true); }
    };
    inp.click();
  }

  return composer;
}

export function mountStepsEditor(el, opts){
  const seq = opts.seq || {};
  const channelId = opts.channelId;
  const angulos = (opts.angulos||[]).filter(a=>a&&a.slug);
  const presets = opts.presets || DEFAULT_PRESETS;
  const ofertaProducts = opts.ofertaProducts || [];
  // Producto al que se enlaza ESTA secuencia (Secuencias lo elige en un select; desde Productos
  // ya viene fijo). El descuento del paso debe salir de él: una oferta para OTRO producto
  // nunca se aplica — el motor solo rebaja {{precio}} si la opción de la oferta es la que el
  // cliente está comprando (buildContext / precioEsperado). Antes el default era prods[0].
  const seqProductId = typeof opts.seqProductId === "function" ? opts.seqProductId : () => (opts.seqProductId || "");
  const actions = opts.actions || { enabled:false };
  if(!Array.isArray(seq.pasos)) seq.pasos = [];
  let sel = 0;
  // ⏱️ EL TOPE DE FRECUENCIA MANDA SOBRE ESTA ESPERA, Y HAY QUE DECIRLO ACÁ.
  // El anti-spam del canal (Productos → Reenganche) impide más de un mensaje automático cada
  // N horas. Si acá configuras «cada 6 min», el toque NO sale a los 6 min: sale cuando se
  // cumplan las N horas. Eso ya pasaba —medido: con umbrales de 3 y 6 min los tres leads
  // quedaron con el paso 2 programado a 18,00 h exactas— y la pantalla no lo decía en ningún
  // lado: escribías un número y el sistema hacía otra cosa, en silencio. Es la misma familia
  // de las perillas que mienten. Se carga una vez y se repinta cuando llega.
  let topeSeg = null;   // null = todavía no se sabe · 0 = el negocio lo apagó
  (async () => {
    if(!channelId) return;
    try{
      const { data } = await supa.from("channels").select("remarketing").eq("id", channelId).maybeSingle();
      const r = data?.remarketing || {};
      topeSeg = r.antispam === false ? 0
        : Math.min(72, Math.max(1, Math.round(Number(r.antispam_horas)) || 18)) * 3600;
      paintOne();
    }catch(_){ /* sin config → no se avisa nada, mejor callar que asustar de más */ }
  })();
  const durTxt = (s) => { const { val,u }=splitDur(s); const n=Number(u);
    return val+" "+(n===86400?(val===1?"día":"días"):n===3600?(val===1?"hora":"horas"):(val===1?"minuto":"minutos")); };
  // «a LAS 3 horas» pero «a LOS 6 minutos»: la preposición va con el género de la unidad.
  const aLa = (s) => (Number(splitDur(s).u)===3600 ? "a las " : "a los ") + durTxt(s);

  el.innerHTML = `<div class="se-journey" style="overflow-x:auto;padding:2px 2px 10px"></div><div class="se-body"></div>`;
  const jBox = el.querySelector(".se-journey");
  const body = el.querySelector(".se-body");

  const cumSec=(i)=>seq.pasos.slice(0,i+1).reduce((a,p)=>a+Math.max(0,Number(p.umbral_silencio_seg||0)),0);
  const jLabel=(s)=>{ if(s>=86400){ const d=s/86400; return "Día "+(Number.isInteger(d)?d:Math.round(d)); } if(s>=3600) return Math.round(s/3600)+" h"; return Math.max(1,Math.round(s/60))+" min"; };
  const jNode=(inner,sub,o={})=>`<div style="text-align:center;min-width:${o.min||64}px;flex:none">
      <div ${o.data||""} style="width:40px;height:40px;margin:0 auto;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;${o.click?"cursor:pointer;":""}${o.style||"background:var(--surface-2);color:var(--muted)"}">${inner}</div>
      <div style="font-size:11px;color:${o.subcol||"var(--muted)"};margin-top:5px;line-height:1.25">${sub}</div>
    </div>`;
  const jDash=`<div style="flex:none;width:20px;height:0;align-self:flex-start;margin-top:20px;border-top:1.5px dashed var(--border)"></div>`;

  function paintJourney(){
    const anchors = jNode(icon("megaphone"),"llegó por<br>un anuncio",{min:70}) + jDash + jNode(icon("clock"),"no compró",{min:58}) + jDash;
    const steps = seq.pasos.map((p,i)=>{
      const on=i===sel;
      const stl=on?"background:var(--brand,#2b7fff);color:#fff;font-weight:700":"background:var(--surface-2);color:var(--brand,#2b7fff);border:1.5px solid var(--brand,#2b7fff);font-weight:700";
      return jNode(String(i+1), jLabel(cumSec(i)), { click:true, data:`data-jstep="${i}"`, style:stl, subcol:on?"var(--text)":"var(--muted)" });
    }).join("");
    const add = jNode("+","añadir",{ click:true, data:"data-jadd", style:"border:1.5px dashed var(--border);color:var(--muted)", min:54 });
    jBox.innerHTML=`<div style="display:flex;align-items:flex-start;gap:8px">${anchors}${steps}${add}</div>`;
    jBox.querySelectorAll("[data-jstep]").forEach(n=> n.onclick=()=>{ sel=+n.dataset.jstep; paintJourney(); paintOne(); });
    const a=jBox.querySelector("[data-jadd]"); if(a) a.onclick=()=>{ seq.pasos.push({ umbral_silencio_seg:86400, rotacion:false, variantes:[newVariant(0)] }); sel=seq.pasos.length-1; paintJourney(); paintOne(); };
  }

  function paintOne(){
    body.innerHTML="";
    if(!seq.pasos.length){
      // Sin plantillas (ej. Secuencias): nada de pantalla de selección — arranca
      // directo con un toque en blanco, listo para editar.
      if(!presets.length){ seq.pasos=[{ umbral_silencio_seg:86400, rotacion:false, variantes:[newVariant(0)] }]; sel=0; paintJourney(); return paintOne(); }
      const box=document.createElement("div");
      box.innerHTML=`<div style="border:1px solid var(--border);border-radius:12px;padding:16px;background:var(--surface,#151a21)">
        <div style="font-size:13px;font-weight:700;margin-bottom:3px">Empieza con una plantilla</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Te dejamos los toques listos; luego editas los mensajes a tu gusto.</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:10px">
          ${presets.map((p,pi)=>`<button class="btn" data-preset="${pi}" style="text-align:left;height:auto;padding:11px 12px;display:block">
            <div style="font-size:13px;font-weight:700">${esc(p.nombre)}</div>
            <div style="font-size:11.5px;color:var(--muted);margin-top:2px">${esc(p.desc)}</div></button>`).join("")}
          <button class="btn" data-preset="blank" style="text-align:left;height:auto;padding:11px 12px;display:block">
            <div style="font-size:13px;font-weight:700">Desde cero</div>
            <div style="font-size:11.5px;color:var(--muted);margin-top:2px">Un toque en blanco</div></button>
        </div></div>`;
      box.querySelectorAll("[data-preset]").forEach(btn=> btn.onclick=()=>{
        const p=btn.dataset.preset;
        if(p==="blank"){ seq.pasos=[{ umbral_silencio_seg:86400, rotacion:false, variantes:[newVariant(0)] }]; }
        else { const pr=presets[+p]; seq.pasos=pr.pasos.map(([s,txt])=>({ umbral_silencio_seg:s, rotacion:false, variantes:[{ ...newVariant(0), bubbles:[{text:txt}] }] })); }
        sel=0; paintJourney(); paintOne();
      });
      body.appendChild(box);
      return;
    }
    if(sel>=seq.pasos.length) sel=seq.pasos.length-1;
    const i=sel, paso=seq.pasos[i];
    const { val,u }=splitDur(paso.umbral_silencio_seg);
    const mode = paso.template_name ? "plantilla" : (paso.flow_id ? "flow" : "mensaje");
    const el2=document.createElement("div");
    el2.style.cssText="border:1px solid var(--border);border-radius:12px;padding:13px;margin-top:4px;background:var(--surface,#151a21)";
    el2.innerHTML=`
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="width:24px;height:24px;border-radius:50%;background:var(--surface-2);display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--muted);flex:none">${i+1}</span>
        <span style="font-size:12.5px;color:var(--muted)">Espera</span>
        <input class="in se-num" type="number" min="1" value="${val}" style="width:70px;height:34px;padding:0 10px"/>
        <select class="sel se-unit" style="height:34px;padding:0 10px">${UNITS.map(([v,l])=>`<option value="${v}" ${v===u?"selected":""}>${l}</option>`).join("")}</select>
        <span style="font-size:12.5px;color:var(--muted)">desde el paso anterior</span>
        <span style="flex:1"></span>
        <button class="iconbtn se-del" title="Quitar toque" style="flex:none">${icon("trash")}</button>
      </div>
      ${topeSeg && Number(paso.umbral_silencio_seg||0) < topeSeg ? `
      <div style="margin-top:9px;display:flex;gap:8px;align-items:flex-start;border:1px solid var(--amber,#f0a92b);background:rgba(240,169,43,.10);border-radius:9px;padding:8px 10px">
        <span style="color:var(--amber,#f0a92b);flex:none;font-size:13px;line-height:1.3">⚠</span>
        <div style="font-size:11.5px;line-height:1.55;color:var(--text)">
          ${i>0
            // Del 2º toque en adelante el choque es SEGURO: el paso anterior ya fue un mensaje
            // automático, así que el reloj del tope está corriendo sí o sí.
            ? `Tu <b>tope de frecuencia</b> es de ${durTxt(topeSeg)}: aunque acá pongas
               <b>${durTxt(paso.umbral_silencio_seg)}</b>, este toque saldrá recién ${aLa(topeSeg)}
               del toque anterior.`
            // En el PRIMERO depende: si el cliente no recibió ningún automático antes, sale a su
            // hora. Decirle «saldrá tarde» sin ese matiz sería asustarlo de gratis — y un aviso
            // que exagera se termina ignorando, que es peor que no tenerlo.
            : `Ojo con tu <b>tope de frecuencia</b> (${durTxt(topeSeg)}): si el cliente ya recibió otro
               mensaje automático hace poco —otra secuencia, una campaña—, este toque no saldrá
               <b>${aLa(paso.umbral_silencio_seg)}</b>, sino cuando se cumpla el tope.`}
          <span style="color:var(--muted)">Se cambia en Productos → el producto → Secuencias.</span>
        </div>
      </div>` : ``}
      ${actions.enabled?`<div style="margin-top:11px"><div style="font-size:12px;color:var(--muted);margin-bottom:5px">Acción</div>
        <select class="sel se-act" style="width:100%;height:36px;padding:0 12px">
          <option value="mensaje" data-desc="Texto, fotos o archivos · dentro de las 24 h" ${mode==="mensaje"?"selected":""}>Enviar un mensaje</option>
          <option value="plantilla" data-desc="Para escribirle pasadas las 24 h" ${mode==="plantilla"?"selected":""}>Enviar una plantilla</option>
          <option value="flow" data-desc="Arranca uno de tus flujos" ${mode==="flow"?"selected":""}>Iniciar un flujo</option>
        </select></div>`:``}
      <div class="se-actbody"></div>
      <div class="se-ofer" style="margin-top:11px;border-top:1px dashed var(--border);padding-top:11px"></div>`;
    const setDur=()=>{ paso.umbral_silencio_seg=Math.max(1,Number(el2.querySelector(".se-num").value||1))*Number(el2.querySelector(".se-unit").value); paintJourney(); };
    el2.querySelector(".se-num").onchange=setDur; el2.querySelector(".se-unit").onchange=setDur;
    el2.querySelector(".se-del").onclick=async()=>{ if(!await confirmDialog({title:"Quitar toque",message:"¿Eliminar este toque?",confirmText:"Eliminar",danger:true})) return; seq.pasos.splice(i,1); if(sel>0)sel--; paintJourney(); paintOne(); };

    const actBody=el2.querySelector(".se-actbody");
    const ofer=el2.querySelector(".se-ofer");
    const renderAction=(m)=>{
      actBody.innerHTML="";
      if(m==="flow"){
        ofer.style.display="none"; if(paso.oferta) delete paso.oferta;
        delete paso.mensaje; delete paso.template_name; delete paso.variantes; delete paso.bubbles; delete paso.rotacion;
        actBody.innerHTML=`<div style="margin-top:11px"><div style="font-size:12px;color:var(--muted);margin-bottom:5px">Flujo a iniciar</div><select class="sel se-fs" style="width:100%;height:36px;padding:0 12px"><option value="">— elige —</option>${(actions.flows||[]).map(f=>`<option value="${f.id}" ${paso.flow_id===f.id?"selected":""}>${esc(f.nombre)}${f.role?" · "+esc(f.role):""}${f.estado&&f.estado!=="activo"?" — en borrador, no arranca":""}</option>`).join("")}</select>${(actions.flows||[]).some(f=>f.id===paso.flow_id&&f.estado&&f.estado!=="activo")?`<div style="font-size:11.5px;color:var(--amber);margin-top:7px;font-weight:600">Ese flujo está en borrador: el motor no lo arranca, así que este toque se salta. Publícalo en Flujos.</div>`:""}</div>`;
        actBody.querySelector(".se-fs").onchange=(e)=>paso.flow_id=e.target.value||undefined;
      } else if(m==="plantilla"){
        ofer.style.display="block"; oferta(ofer,paso);
        delete paso.mensaje; delete paso.flow_id; delete paso.variantes; delete paso.bubbles; delete paso.rotacion;
        actBody.innerHTML=`<div style="margin-top:11px"><div style="font-size:12px;color:var(--muted);margin-bottom:5px">Plantilla</div><select class="sel se-ts" style="width:100%;height:36px;padding:0 12px"><option value="">— elige —</option>${(actions.templates||[]).map(t=>`<option value="${esc(t.name)}" data-lang="${esc(t.language)}" ${paso.template_name===t.name?"selected":""}>${esc(t.name)} (${esc(t.language)})</option>`).join("")}</select>
          ${(actions.templates||[]).length?`<div style="font-size:12px;color:var(--muted);margin:9px 0 5px">Variables (una por línea)</div><textarea class="in se-pta" style="width:100%;min-height:60px">${esc((paso.template_params||[]).join("\n"))}</textarea>`:`<div style="font-size:11.5px;color:var(--amber);margin-top:8px">No hay plantillas activas.</div>`}</div>`;
        // Texto real de la plantilla y cuántos huecos {{n}} tiene: sin esto el operador escribía
        // las variables (posicionales) a ciegas → desfase = Meta 132000 o el dato en el hueco equivocado.
        const prev=document.createElement("div"); prev.className="fhint"; prev.style.cssText="margin-top:8px;white-space:pre-wrap;font-size:12px;line-height:1.45;background:var(--surface-2);border-radius:8px;padding:8px 10px";
        const sel=actBody.querySelector(".se-ts"); sel.insertAdjacentElement("afterend",prev);
        const pintaPrev=()=>{ const t=(actions.templates||[]).find(x=>x.name===paso.template_name); if(!t||!t.body_preview){ prev.style.display="none"; return; } const n=new Set(String(t.body_preview).match(/\{\{\s*\d+\s*\}\}/g)||[]).size; prev.style.display=""; prev.innerHTML=`<div style="font-weight:700;margin-bottom:4px">${n} variable${n===1?"":"s"} · en orden {{1}}, {{2}}…</div>${esc(t.body_preview)}`; };
        pintaPrev();
        actBody.querySelector(".se-ts").onchange=(e)=>{ paso.template_name=e.target.value||undefined; paso.template_lang=e.target.selectedOptions[0]?.dataset.lang||"es"; pintaPrev(); };
        // Las líneas son POSICIONALES ({{1}}, {{2}}…): una vacía en medio debe quedar (antes
        // `.filter(Boolean)` la borraba y los huecos se corrían → Meta 132000 y el paso se
        // saltaba). Solo se recortan las vacías del FINAL.
        const pta=actBody.querySelector(".se-pta"); if(pta) pta.oninput=()=>{ const ls=pta.value.split("\n").map(x=>x.trim()); while(ls.length&&!ls[ls.length-1]) ls.pop(); paso.template_params=ls; };
      } else {
        ofer.style.display="block"; oferta(ofer,paso);
        delete paso.flow_id; delete paso.template_name;
        if(!Array.isArray(paso.variantes)||!paso.variantes.length){
          const first = paso.mensaje ? [{text:String(paso.mensaje)}] : (Array.isArray(paso.bubbles)&&paso.bubbles.length?paso.bubbles:[{text:""}]);
          paso.variantes=[{ ...newVariant(0), bubbles:first }];
        }
        delete paso.mensaje; delete paso.bubbles;
        if(paso.rotacion===undefined) paso.rotacion=false;
        actBody.innerHTML=`<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(180px,220px);gap:12px;align-items:start;margin-top:2px">
            <div class="se-comp"></div>
            <div><div style="font-size:11px;color:var(--muted);margin-bottom:6px">Así le llega al cliente</div>
              <div class="se-prev"></div></div>
          </div>`;
        composer(actBody.querySelector(".se-comp"), paso);
        const prev=actBody.querySelector(".se-prev");
        const upd=()=>{ if(!prev) return; const b=_brandCache[channelId]||{}; prev.innerHTML=waScreenHtml({ title:b.nombre, logoUrl:b.logo_url, bubblesHtml:previewHtml(paso, angulos) }); };
        upd(); actBody.addEventListener("input", upd); actBody.addEventListener("click", ()=>setTimeout(upd,0));
        seqBrand(channelId).then(upd); // rellena nombre/logo real y repinta
      }
    };
    // Cambiar el tipo de acción a "flujo"/"plantilla" BORRA las versiones/burbujas del
    // mensaje (renderAction hace delete paso.variantes/bubbles). Si hay contenido escrito,
    // se confirma antes: un clic accidental en el desplegable no debe volar el trabajo.
    const hayContenido=(p)=>{
      const bt=(bs)=>Array.isArray(bs)&&bs.some(b=>b&&((b.text&&b.text.trim())||b.media_url));
      if(p.mensaje && String(p.mensaje).trim()) return true;
      if(bt(p.bubbles)) return true;
      if(Array.isArray(p.variantes)&&p.variantes.some(v=>bt(v.bubbles)||(v.text&&String(v.text).trim()))) return true;
      return false;
    };
    let curMode=mode;
    const asel=el2.querySelector(".se-act");
    if(asel) asel.onchange=async(e)=>{
      const nuevo=e.target.value;
      if((nuevo==="flow"||nuevo==="plantilla") && curMode!=="flow" && curMode!=="plantilla" && hayContenido(paso)){
        if(!await confirmDialog({ title:"Cambiar el tipo de acción",
          message:"Este toque tiene un mensaje escrito. Al cambiar a "+(nuevo==="flow"?"iniciar un flujo":"enviar una plantilla")+" se borrará. ¿Continuar?",
          confirmText:"Cambiar y borrar", danger:true })){ e.target.value=curMode; return; }
      }
      curMode=nuevo; renderAction(nuevo);
    };
    renderAction(mode);
    body.appendChild(el2);
  }

  const composer = hazComposer({ channelId, angulos });

  function ofWarn(paso){
    if(!paso.oferta) return "";
    // Precio vacío o ≤0 = producto GRATIS a todo el segmento. Se avisa en vivo y el guardado lo bloquea.
    if(paso.oferta.version_id && !(Number(paso.oferta.precio)>0)) return "Escribe el precio con descuento (mayor a 0). Si lo dejas vacío o en 0, se enviaría el producto GRATIS.";
    // Descuento de OTRO producto. El motor solo rebaja {{precio}} —y solo acepta ese precio
    // al validar el pago— si la opción de la oferta es la que el cliente está comprando. Con
    // un descuento de otro producto, quien siga interesado en el de la secuencia recibe el
    // copy con el precio de LISTA: el operador cree que mandó una oferta y no mandó nada.
    // (Vale como venta cruzada a propósito, por eso avisa y no bloquea el guardado.)
    const spId = seqProductId();
    if(spId && paso.oferta.product_id && paso.oferta.product_id !== spId){
      const nom = (ofertaProducts.find(p=>p.id===spId)||{}).nombre || "el de esta secuencia";
      return "El descuento es de otro producto. Esta secuencia re-engancha " + nom + ": a quien siga en ese producto le va a llegar el precio de lista, sin rebaja. Solo déjalo así si es una venta cruzada a propósito.";
    }
    const myP=Number(paso.oferta.precio); if(!Number.isFinite(myP)) return "";
    const idx=seq.pasos.indexOf(paso);
    for(let j=0;j<idx;j++){ const pj=seq.pasos[j];
      if(pj.oferta && pj.oferta.version_id===paso.oferta.version_id && Number.isFinite(Number(pj.oferta.precio)) && Number(pj.oferta.precio)<myP){
        return `El toque ${j+1} ya ofrece esta opción a S/ ${Number(pj.oferta.precio)} (más barato). Este subiría el precio — la escalera debería ir de mayor a menor.`;
      }
    }
    return "";
  }
  function oferta(box, paso){
    const prods=ofertaProducts;
    const on=!!paso.oferta;
    const pid = paso.oferta?.product_id || seqProductId() || prods[0]?.id || "";
    const prod = prods.find(p=>p.id===pid);
    const ops = prod?.opciones||[];
    box.innerHTML=`
      <div style="display:flex;align-items:center;gap:10px">
        <div class="sw ${on?'on':''}" data-oftog></div>
        <span style="font-size:12.5px;font-weight:600;display:flex;align-items:center;gap:5px">${icon("dollar")} Incluir un descuento (el sistema lo valida al pagar)</span>
      </div>
      ${on?(prods.length&&ops.length?`
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:11px">
        ${prods.length>1?`<select class="in" data-ofprod style="min-width:150px">${prods.map(p=>`<option value="${p.id}" ${pid===p.id?"selected":""}>${esc(p.nombre)}</option>`).join("")}</select>`:``}
        <select class="in" data-ofopt style="min-width:140px">${ops.map(o=>`<option value="${o.id}" ${paso.oferta?.version_id===o.id?"selected":""}>${esc(o.nombre)} (S/ ${esc(o.precio)})</option>`).join("")}</select>
        <span style="font-size:12px;color:var(--muted)">a S/</span>
        <input class="in" data-ofprecio type="number" min="0" step="0.5" value="${esc(paso.oferta.precio??"")}" style="width:100px" placeholder="precio"/>
        ${paso.oferta.no_caduca ? "" : `<span style="font-size:12px;color:var(--muted)">· vence en</span>
        <input class="in" data-ofvence type="number" min="0" step="1" value="${esc(paso.oferta.vence_horas??48)}" style="width:70px"/>
        <span style="font-size:12px;color:var(--muted)">horas</span>`}
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
        <div class="sw ${paso.oferta.no_caduca?"on":""}" data-ofnocad></div>
        <span style="font-size:12.5px;font-weight:600">No caduca</span>
      </div>
      <div style="font-size:11px;color:var(--faint);margin-top:6px">${paso.oferta.no_caduca
        ? "El cliente puede pagar este precio cuando quiera. Por seguridad se borra sola a los 90 días (para que no quede pegada en compras futuras), o antes si le llega otra oferta."
        : "Si dejas 0, la oferta caduca en 72 h."} Usa <b style="color:var(--brand)">{{precio}}</b> en el mensaje: saldrá rebajado.</div>
      <div class="se-ofwarn" style="font-size:11.5px;color:var(--amber);margin-top:8px;font-weight:600">${ofWarn(paso)}</div>`
      :`<div style="font-size:11.5px;color:var(--amber);margin-top:9px">Primero crea una opción de compra con precio para poder ofrecer un descuento.</div>`):""}
      ${prod?.tipo==="microapp"?`<div style="display:flex;align-items:center;gap:10px;margin-top:12px">
        <div class="sw ${paso.ofrece_prueba?"on":""}" data-prtog></div>
        <span style="font-size:12.5px;font-weight:600">🎁 Ofrece la prueba gratis</span></div>
      <div style="font-size:11px;color:var(--faint);margin-top:6px">${prod.prueba?"Si el cliente dice que sí en los 7 días siguientes, el bot le activa la prueba (con su correo).":"Primero enciende la prueba gratis en Productos → la app → Correo, renovación y conexión."}</div>`:""}`;
    const prt=box.querySelector("[data-prtog]"); if(prt) prt.onclick=()=>{ if(paso.ofrece_prueba) delete paso.ofrece_prueba; else paso.ofrece_prueba=true; oferta(box,paso); };
    box.querySelector("[data-oftog]").onclick=()=>{
      if(paso.oferta){ delete paso.oferta; }
      // Por defecto, el producto de la secuencia (no el primero de la lista): el descuento
      // tiene que ser del mismo producto que se está re-enganchando o no se aplica nunca.
      else { const p0=prods.find(p=>p.id===seqProductId())||prods[0], o0=p0?.opciones?.[0]; paso.oferta={ product_id:p0?.id||"", version_id:o0?.id||"", precio:o0?.precio??"", vence_horas:48 }; }
      oferta(box,paso);
    };
    const pp=box.querySelector("[data-ofprod]"); if(pp) pp.onchange=(e)=>{ paso.oferta.product_id=e.target.value; const np=prods.find(p=>p.id===e.target.value), o0=np?.opciones?.[0]; paso.oferta.version_id=o0?.id||""; paso.oferta.precio=o0?.precio??""; oferta(box,paso); };
    const so=box.querySelector("[data-ofopt]"); if(so) so.onchange=(e)=>{ paso.oferta.version_id=e.target.value; };
    const sp=box.querySelector("[data-ofprecio]"); if(sp) sp.oninput=(e)=>{ paso.oferta.precio=e.target.value===""?"":Number(e.target.value); const w=box.querySelector(".se-ofwarn"); if(w) w.textContent=ofWarn(paso); };
    const sv=box.querySelector("[data-ofvence]"); if(sv) sv.oninput=(e)=>{ paso.oferta.vence_horas=Math.max(0,Number(e.target.value)||0); };
    // «No caduca» (13-oct, Rodrigo): en el motor dura 90 días, no para siempre (un descuento eterno se quedaba pegado
    // en las recompras). Al apagarlo vuelve a 48 h.
    const nc=box.querySelector("[data-ofnocad]"); if(nc) nc.onclick=()=>{ if(paso.oferta.no_caduca){ delete paso.oferta.no_caduca; paso.oferta.vence_horas=48; } else { paso.oferta.no_caduca=true; paso.oferta.vence_horas=2160; } oferta(box,paso); };
  }

  function normalize(){
    seq.pasos=(seq.pasos||[]).map(p=>{
      if(p.flow_id||p.template_name) return p;
      if(Array.isArray(p.variantes)){
        p.variantes.forEach(v=>{ v.bubbles=limpiaBotones((v.bubbles||[]).filter(b=> b.media_url || (b.text&&b.text.trim()))); });
        p.variantes=p.variantes.filter(v=> v.bubbles.length);
        if(!p.variantes.length) p.variantes=[newVariant(0)];
      }
      return p;
    });
    return seq.pasos;
  }

  paintJourney(); paintOne();
  // `repaint`: la página de Secuencias deja cambiar el producto de la secuencia con el editor
  // ya montado, y el aviso del descuento depende de esa elección.
  return { normalize, repaint(){ paintJourney(); paintOne(); } };
}
