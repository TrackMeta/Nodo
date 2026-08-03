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
export function newVariant(idx){ return { id:uid(), nombre:"Versión "+String.fromCharCode(65+(idx||0)), activo:true, peso:1, bubbles:[{text:""}] }; }
function splitDur(sec){ sec=Number(sec||0); if(sec%86400===0&&sec>=86400)return{val:sec/86400,u:"86400"}; if(sec%3600===0&&sec>=3600)return{val:sec/3600,u:"3600"}; return{val:Math.round(sec/60)||1,u:"60"}; }
const UNITS=[["60","minutos"],["3600","horas"],["86400","días"]];

// Plantillas de arranque por defecto (una página puede pasar las suyas).
export const DEFAULT_PRESETS=[
  { nombre:"Recordatorio suave", desc:"3 toques · Día 1, 3 y 7", pasos:[
    [86400,"¡Hola {{nombre}}! ¿Aún te interesa? Cualquier duda te ayudo 😊"],
    [172800,"Te sigo guardando tu pedido 👀 ¿Lo cerramos hoy?"],
    [345600,"Última oportunidad — luego libero tu cupo. ¿Te animas?"],
  ]},
  { nombre:"Oferta directa", desc:"2 toques · Día 1 y 4", pasos:[
    [86400,"{{nombre}}, te reservé una oferta especial por hoy 🎁"],
    [259200,"Tu oferta vence hoy. ¿La aprovechas?"],
  ]},
];

function sample(t){ return String(t||"").replace(/\{\{\s*nombre\s*\}\}/gi,"Ana").replace(/\{\{\s*precio\s*\}\}/gi,"S/ 100").replace(/\{\{\s*ciudad\s*\}\}/gi,"Lima").replace(/\{\{[^}]*\}\}/g,"…"); }
function previewHtml(paso){
  const vs=(Array.isArray(paso?.variantes)?paso.variantes:[]).filter(v=>v.activo!==false && v.bubbles && v.bubbles.length);
  const v=vs[0]||(paso&&paso.variantes&&paso.variantes[0]);
  // Texto que se ve en la burbuja: las de texto usan .text; las de media guardan
  // su pie en .caption. El motor manda `caption ?? text`, así que aquí igualamos
  // con `text || caption` para que el caption de una imagen (p.ej. "MENSAJE 2") sí salga.
  const bText=b=>(b&&(b.text||b.caption))||'';
  const bubs=((v&&v.bubbles)||[]).filter(b=> b && (b.media_url||bText(b).trim()));
  if(!bubs.length) return `<div style="font-size:12px;color:#cfe9d8">Escribe el mensaje para ver cómo llega…</div>`;
  return bubs.map(b=>{
    let media=''; const cap=bText(b);
    if(b.media_url&&b.media_kind==='image') media=`<img src="${esc(b.media_url)}" style="max-width:150px;border-radius:6px;display:block;margin-bottom:${cap?'5px':'0'}">`;
    else if(b.media_url&&b.media_kind==='video') media=`<div style="font-size:11px;color:#3a6b52;margin-bottom:4px">▶ video</div>`;
    else if(b.media_url&&b.media_kind==='audio') media=`<div style="font-size:11px;color:#3a6b52;margin-bottom:4px">♪ audio</div>`;
    else if(b.media_url) media=`<div style="font-size:11px;color:#3a6b52;margin-bottom:4px">▤ archivo</div>`;
    const txt=cap?sample(esc(cap)).replace(/\n/g,"<br>"):'';
    return `<div style="background:#DCF8C6;color:#0b3b2e;border-radius:8px;padding:6px 9px;font-size:12.5px;line-height:1.45;max-width:210px;margin-bottom:6px;word-break:break-word">${media}${txt}<div style="font-size:9.5px;color:#3a6b52;text-align:right;margin-top:2px">10:24 ✓✓</div></div>`;
  }).join('');
}

export function mountStepsEditor(el, opts){
  const seq = opts.seq || {};
  const channelId = opts.channelId;
  const angulos = (opts.angulos||[]).filter(a=>a&&a.slug);
  const presets = opts.presets || DEFAULT_PRESETS;
  const ofertaProducts = opts.ofertaProducts || [];
  const actions = opts.actions || { enabled:false };
  if(!Array.isArray(seq.pasos)) seq.pasos = [];
  let sel = 0;

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
    const anchors = jNode("📣","llegó por<br>un anuncio",{min:70}) + jDash + jNode("💤","no compró",{min:58}) + jDash;
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
        <input class="in se-num" type="number" min="1" value="${val}" style="width:70px;height:34px"/>
        <select class="sel se-unit" style="height:34px">${UNITS.map(([v,l])=>`<option value="${v}" ${v===u?"selected":""}>${l}</option>`).join("")}</select>
        <span style="font-size:12.5px;color:var(--muted)">desde el paso anterior</span>
        <span style="flex:1"></span>
        <button class="iconbtn se-del" title="Quitar toque" style="flex:none">${icon("trash")}</button>
      </div>
      ${actions.enabled?`<div style="margin-top:11px"><div style="font-size:12px;color:var(--muted);margin-bottom:5px">Acción</div>
        <select class="sel se-act" style="width:100%;height:36px">
          <option value="mensaje" ${mode==="mensaje"?"selected":""}>Enviar mensaje (texto/multimedia, dentro de 24h)</option>
          <option value="plantilla" ${mode==="plantilla"?"selected":""}>Enviar una plantilla (fuera de 24h)</option>
          <option value="flow" ${mode==="flow"?"selected":""}>Iniciar un flujo</option>
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
        actBody.innerHTML=`<div style="margin-top:11px"><div style="font-size:12px;color:var(--muted);margin-bottom:5px">Flujo a iniciar</div><select class="sel se-fs" style="width:100%;height:36px"><option value="">— elige —</option>${(actions.flows||[]).map(f=>`<option value="${f.id}" ${paso.flow_id===f.id?"selected":""}>${esc(f.nombre)}${f.role?" · "+esc(f.role):""}</option>`).join("")}</select></div>`;
        actBody.querySelector(".se-fs").onchange=(e)=>paso.flow_id=e.target.value||undefined;
      } else if(m==="plantilla"){
        ofer.style.display="block"; oferta(ofer,paso);
        delete paso.mensaje; delete paso.flow_id; delete paso.variantes; delete paso.bubbles; delete paso.rotacion;
        actBody.innerHTML=`<div style="margin-top:11px"><div style="font-size:12px;color:var(--muted);margin-bottom:5px">Plantilla</div><select class="sel se-ts" style="width:100%;height:36px"><option value="">— elige —</option>${(actions.templates||[]).map(t=>`<option value="${t.name}" data-lang="${esc(t.language)}" ${paso.template_name===t.name?"selected":""}>${esc(t.name)} (${esc(t.language)})</option>`).join("")}</select>
          ${(actions.templates||[]).length?`<div style="font-size:12px;color:var(--muted);margin:9px 0 5px">Variables (una por línea)</div><textarea class="in se-pta" style="width:100%;min-height:60px">${esc((paso.template_params||[]).join("\n"))}</textarea>`:`<div style="font-size:11.5px;color:var(--amber);margin-top:8px">No hay plantillas activas.</div>`}</div>`;
        actBody.querySelector(".se-ts").onchange=(e)=>{ paso.template_name=e.target.value||undefined; paso.template_lang=e.target.selectedOptions[0]?.dataset.lang||"es"; };
        const pta=actBody.querySelector(".se-pta"); if(pta) pta.oninput=()=>paso.template_params=pta.value.split("\n").map(x=>x.trim()).filter(Boolean);
      } else {
        ofer.style.display="block"; oferta(ofer,paso);
        delete paso.flow_id; delete paso.template_name;
        if(!Array.isArray(paso.variantes)||!paso.variantes.length){
          const first = paso.mensaje ? [{text:String(paso.mensaje)}] : (Array.isArray(paso.bubbles)&&paso.bubbles.length?paso.bubbles:[{text:""}]);
          paso.variantes=[{ ...newVariant(0), bubbles:first }];
        }
        delete paso.mensaje; delete paso.bubbles;
        if(paso.rotacion===undefined) paso.rotacion=false;
        actBody.innerHTML=`<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(165px,205px);gap:12px;align-items:start;margin-top:2px">
            <div class="se-comp"></div>
            <div><div style="font-size:11px;color:var(--muted);margin-bottom:6px">Así le llega al cliente</div>
              <div class="se-prev" style="background:#075E54;border-radius:12px;padding:10px;min-height:56px"></div></div>
          </div>`;
        composer(actBody.querySelector(".se-comp"), paso);
        const prev=actBody.querySelector(".se-prev"); const upd=()=>{ if(prev) prev.innerHTML=previewHtml(paso); };
        upd(); actBody.addEventListener("input", upd); actBody.addEventListener("click", ()=>setTimeout(upd,0));
      }
    };
    const asel=el2.querySelector(".se-act");
    if(asel) asel.onchange=(e)=>renderAction(e.target.value);
    renderAction(mode);
    body.appendChild(el2);
  }

  function composer(box, paso){
    if(!Array.isArray(paso.variantes)||!paso.variantes.length){
      const first = paso.mensaje ? [{text:String(paso.mensaje)}] : (Array.isArray(paso.bubbles)&&paso.bubbles.length?paso.bubbles:[{text:""}]);
      paso.variantes=[{ ...newVariant(0), bubbles:first }];
    }
    delete paso.mensaje; delete paso.bubbles;
    if(paso.rotacion===undefined) paso.rotacion=false;
    const rot=paso.rotacion===true && paso.variantes.length>0;
    const activeVars=paso.variantes.filter(v=>v.activo!==false);
    const pesoTotal=activeVars.reduce((a,v)=>a+Math.max(0,Number(v.peso??1)),0)||1;
    const hasAng=angulos.length>0;
    box.innerHTML=`
      <div style="border:1px solid var(--border);border-radius:11px;background:var(--surface-2);padding:11px 12px;margin-top:10px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
          <span style="flex:1;min-width:135px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px">${icon("message")} Mensaje del paso</span>
          ${hasAng?`<div style="display:inline-flex;border:0.5px solid var(--border);border-radius:999px;padding:3px;gap:2px">
            <button class="se-mode" data-mode="todos" style="font-size:11.5px;padding:5px 11px;border-radius:999px;border:none;cursor:pointer;font-weight:600;background:${!rot?'var(--ia1,#8b5cf6)':'transparent'};color:${!rot?'#fff':'var(--muted)'}">El mismo para todos</button>
            <button class="se-mode" data-mode="angulo" style="font-size:11.5px;padding:5px 11px;border-radius:999px;border:none;cursor:pointer;font-weight:600;background:${rot?'var(--ia1,#8b5cf6)':'transparent'};color:${rot?'#fff':'var(--muted)'}">Según el anuncio</button>
          </div>`:`<span style="font-size:11.5px;color:var(--muted);font-weight:600">Varias versiones</span><div class="sw ${rot?'on':''}" data-rot title="Enviar una versión distinta cada vez"></div>`}
        </div>
        <div style="font-size:11px;color:var(--faint);margin-bottom:8px">${rot?(hasAng?"Cada versión responde a un ángulo del anuncio; el cliente recibe la suya. Deja una en <b>General</b> como respaldo.":"El bot elige una versión por peso cada vez que envía este paso."):"Un solo mensaje para todos los clientes de este público."}</div>
        <div class="se-varlist"></div>
        ${rot?`<button class="btn" data-addvar style="height:30px;padding:0 10px;font-size:12px;margin-top:10px">+ Agregar versión</button>`:``}
      </div>`;
    box.querySelectorAll(".se-mode").forEach(b=> b.onclick=()=>{ const ang=(b.dataset.mode==="angulo"); paso.rotacion=ang; if(!ang && paso.variantes[0]) delete paso.variantes[0].angulo; composer(box,paso); });
    const rtog=box.querySelector("[data-rot]"); if(rtog) rtog.onclick=()=>{ paso.rotacion=!rot; composer(box,paso); };
    const av=box.querySelector("[data-addvar]"); if(av) av.onclick=()=>{ paso.variantes.push(newVariant(paso.variantes.length)); composer(box,paso); };
    const vl=box.querySelector(".se-varlist");
    const listv = rot ? paso.variantes : paso.variantes.slice(0,1);
    listv.forEach((v,vi)=>{
      if(!Array.isArray(v.bubbles)||!v.bubbles.length) v.bubbles=[{text:""}];
      const card=document.createElement("div");
      if(rot){
        card.style.cssText="border:1px solid var(--border);border-radius:10px;padding:11px;background:var(--surface);margin-top:9px";
        const share=v.activo!==false?Math.round(Math.max(0,Number(v.peso??1))/pesoTotal*100):0;
        card.innerHTML=`
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:9px">
            <input class="in se-vname" style="flex:1;font-weight:700;height:32px" value="${esc(v.nombre||('Versión '+String.fromCharCode(65+vi)))}"/>
            <span style="font-size:11px;color:var(--muted)">Peso</span>
            <input class="in se-vpeso" type="number" min="0" step="1" style="width:54px;height:32px;text-align:center" value="${Number(v.peso??1)}"/>
            <span style="font-size:11px;color:var(--brand);font-weight:700;min-width:32px">${v.activo!==false?share+'%':'—'}</span>
            <div class="sw ${v.activo!==false?'on':''}" data-vact title="Activar/pausar"></div>
            <button class="iconbtn se-vdel" title="Eliminar versión">${icon("trash")}</button>
          </div>
          ${hasAng?`<div style="display:flex;align-items:center;gap:7px;margin:2px 0 9px">
            <span style="font-size:11px;color:var(--ia1,#8b5cf6);font-weight:600;white-space:nowrap">🎯 Responde al ángulo</span>
            <select class="in se-vangulo" style="height:34px;padding:0 10px;flex:1;max-width:240px">
              <option value="">General · cualquier cliente</option>
              ${angulos.map(a=>`<option value="${esc(a.slug)}"${(v.angulo||"")===a.slug?" selected":""}>${esc(a.nombre||a.slug)}</option>`).join("")}
            </select></div>`:``}
          <div class="se-bubbles" style="display:flex;flex-direction:column;gap:8px"></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px">${addBtns()}</div>`;
        card.querySelector(".se-vname").oninput=(e)=>v.nombre=e.target.value;
        card.querySelector(".se-vpeso").oninput=(e)=>v.peso=Math.max(0,Number(e.target.value)||0);
        card.querySelector("[data-vact]").onclick=()=>{ v.activo=v.activo===false?true:false; composer(box,paso); };
        card.querySelector(".se-vdel").onclick=async()=>{ if(paso.variantes.length<=1){ toast("Debe quedar al menos una versión",true); return; } if(!await confirmDialog({title:"Eliminar versión",message:"¿Eliminar esta versión?",confirmText:"Eliminar",danger:true})) return; paso.variantes.splice(vi,1); composer(box,paso); };
        { const ag=card.querySelector(".se-vangulo"); if(ag) ag.onchange=(e)=>v.angulo=e.target.value; }
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
      vl.appendChild(card);
    });
  }

  function addBtns(){ return ["text","image","video","audio"].map(k=>`<button class="btn" data-addb="${k}" style="height:30px;padding:0 10px;font-size:12px">+ ${({text:"Texto",image:"Imagen",video:"Video",audio:"Audio"})[k]}</button>`).join(""); }

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
        <button class="iconbtn se-bup" title="Subir">▲</button>
        <button class="iconbtn se-bdown" title="Bajar">▼</button>
        <button class="iconbtn se-bdel" title="Quitar">${icon("trash")}</button>
      </div>
      ${prev}
      ${kind==="text"
        ? `<textarea class="in se-btext" style="width:100%;min-height:52px" placeholder="Escribe el mensaje… puedes usar {{nombre}}, {{precio}}…">${esc(bub.text||"")}</textarea>${botonesHtml(bub)}`
        : (kind!=="audio"?`<input class="in se-bcap" placeholder="Texto/caption (opcional)" value="${esc(bub.caption||"")}"/>`:``)}`;
    if(kind==="text") wireBotones(el3,bub,()=>composer(box,paso));
    const tx=el3.querySelector(".se-btext"); if(tx) tx.oninput=(e)=>bub.text=e.target.value;
    const cp=el3.querySelector(".se-bcap"); if(cp) cp.oninput=(e)=>bub.caption=e.target.value;
    el3.querySelector(".se-bdel").onclick=()=>{ v.bubbles.splice(bi,1); if(!v.bubbles.length) v.bubbles.push({text:""}); composer(box,paso); };
    el3.querySelector(".se-bup").onclick=()=>{ if(bi===0)return; [v.bubbles[bi-1],v.bubbles[bi]]=[v.bubbles[bi],v.bubbles[bi-1]]; composer(box,paso); };
    el3.querySelector(".se-bdown").onclick=()=>{ if(bi>=v.bubbles.length-1)return; [v.bubbles[bi+1],v.bubbles[bi]]=[v.bubbles[bi],v.bubbles[bi+1]]; composer(box,paso); };
    return el3;
  }

  function pickMedia(box,paso,v,kind){
    const accept={image:"image/*",video:"video/*",audio:"audio/*"}[kind]||"*/*";
    const inp=document.createElement("input"); inp.type="file"; inp.accept=accept;
    inp.onchange=async()=>{
      const file=inp.files&&inp.files[0]; if(!file) return;
      toast("Subiendo…");
      try{
        const dataURL=await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); });
        const { data,error }=await supa.functions.invoke("media-upload",{ body:{ channel_id:channelId, filename:file.name, content_type:file.type, data:dataURL } });
        if(error||!data?.url){ toast("No se pudo subir el archivo",true); return; }
        v.bubbles.push({ media_kind:data.kind||kind, media_url:data.url, mime:file.type, filename:file.name, caption:"" });
        toast("Archivo agregado ✓"); composer(box,paso);
      }catch(e){ toast("Error al subir",true); }
    };
    inp.click();
  }

  function ofWarn(paso){
    if(!paso.oferta) return "";
    const myP=Number(paso.oferta.precio); if(!Number.isFinite(myP)) return "";
    const idx=seq.pasos.indexOf(paso);
    for(let j=0;j<idx;j++){ const pj=seq.pasos[j];
      if(pj.oferta && pj.oferta.version_id===paso.oferta.version_id && Number.isFinite(Number(pj.oferta.precio)) && Number(pj.oferta.precio)<myP){
        return `⚠️ El toque ${j+1} ya ofrece esta opción a S/ ${Number(pj.oferta.precio)} (más barato). Este subiría el precio — la escalera debería ir de mayor a menor.`;
      }
    }
    return "";
  }
  function oferta(box, paso){
    const prods=ofertaProducts;
    const on=!!paso.oferta;
    const pid = paso.oferta?.product_id || prods[0]?.id || "";
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
        <span style="font-size:12px;color:var(--muted)">· vence en</span>
        <input class="in" data-ofvence type="number" min="0" step="1" value="${esc(paso.oferta.vence_horas??48)}" style="width:70px"/>
        <span style="font-size:12px;color:var(--muted)">horas</span>
      </div>
      <div style="font-size:11px;color:var(--faint);margin-top:6px">Usa <b style="color:var(--brand)">{{precio}}</b> en el mensaje: saldrá rebajado. 0 horas = sin caducidad.</div>
      <div class="se-ofwarn" style="font-size:11.5px;color:var(--amber);margin-top:8px;font-weight:600">${ofWarn(paso)}</div>`
      :`<div style="font-size:11.5px;color:var(--amber);margin-top:9px">Primero crea una opción de compra con precio para poder ofrecer un descuento.</div>`):""}`;
    box.querySelector("[data-oftog]").onclick=()=>{
      if(paso.oferta){ delete paso.oferta; }
      else { const p0=prods[0], o0=p0?.opciones?.[0]; paso.oferta={ product_id:p0?.id||"", version_id:o0?.id||"", precio:o0?.precio??"", vence_horas:48 }; }
      oferta(box,paso);
    };
    const pp=box.querySelector("[data-ofprod]"); if(pp) pp.onchange=(e)=>{ paso.oferta.product_id=e.target.value; const np=prods.find(p=>p.id===e.target.value), o0=np?.opciones?.[0]; paso.oferta.version_id=o0?.id||""; paso.oferta.precio=o0?.precio??""; oferta(box,paso); };
    const so=box.querySelector("[data-ofopt]"); if(so) so.onchange=(e)=>{ paso.oferta.version_id=e.target.value; };
    const sp=box.querySelector("[data-ofprecio]"); if(sp) sp.oninput=(e)=>{ paso.oferta.precio=e.target.value===""?"":Number(e.target.value); const w=box.querySelector(".se-ofwarn"); if(w) w.textContent=ofWarn(paso); };
    const sv=box.querySelector("[data-ofvence]"); if(sv) sv.oninput=(e)=>{ paso.oferta.vence_horas=Math.max(0,Number(e.target.value)||0); };
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
  return { normalize };
}
