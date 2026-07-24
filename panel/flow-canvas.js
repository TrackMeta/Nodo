// ═══════════════════════════════════════════════════════════════════
// Nodo · flow-canvas.js — identidad visual + enrutado del lienzo de
// flujos (Drawflow). Lo comparten editor.html y canvas-demo.html
// (demo sin login para iterar el diseño).
//   • NODE_TYPES: catálogo por tipo (color, icono Lucide, etiqueta).
//   • nodeHtml(m): tarjeta del nodo (cabecera coloreada + resumen).
//   • decorateNode(editor, m): pinta puertos y etiqueta las salidas.
//   • installCanvas(editor): líneas rectas con codos de 90°, carriles
//     anti-solape, flechas y color de línea = color del nodo origen.
//   • mountZoomControls(editor, host, api): zoom ± / % / encuadrar.
// ═══════════════════════════════════════════════════════════════════

export const NODE_TYPES = {
  mensaje:      { label:"Mensaje",       color:"#3B82F6", desc:"Envía texto (con burbujas y botones)" },
  pregunta:     { label:"Pregunta",      color:"#F59E0B", desc:"Pregunta y guarda la respuesta en un campo" },
  condicion:    { label:"Condición",     color:"#A855F7", desc:"Bifurca según reglas (rutas)" },
  accion:       { label:"Acción",        color:"#F97316", desc:"Etiquetas, campos, secuencias y más acciones" },
  ia:           { label:"IA",            color:"#EC4899", desc:"Genera texto, analiza imágenes o extrae datos" },
  rotador:      { label:"Dado (reparto)",color:"#84CC16", desc:"Reparte por peso entre variantes de mensaje" },
  esperar:      { label:"Esperar",       color:"#94A3B8", desc:"Pausa el flujo unos segundos" },
  iniciar_flujo:{ label:"Ir a flujo",    color:"#06B6D4", desc:"Salta a otro flujo del canal" },
  evento_fb:    { label:"Evento Meta",   color:"#6366F1", desc:"Envía una conversión a Meta (CAPI)" },
  plantilla:    { label:"Plantilla",     color:"#14B8A6", desc:"Envía una plantilla aprobada de WhatsApp" },
  google_sheets:{ label:"Google Sheets", color:"#22C55E", desc:"Agrega o actualiza una fila en tu hoja" },
  nota:         { label:"Nota",          color:"#EAB308", desc:"Anotación libre en el lienzo (no se ejecuta)" },
  fin:          { label:"Fin",           color:"#EF4444", desc:"Termina la conversación" },
};

// Iconos Lucide (paths) por tipo de nodo.
const IC = {
  mensaje:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  pregunta:'<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  condicion:'<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>',
  accion:'<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  ia:'<rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1"/>',
  esperar:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  iniciar_flujo:'<polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>',
  evento_fb:'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  plantilla:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  google_sheets:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  fin:'<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  rotador:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 8h.01"/><path d="M12 12h.01"/><path d="M16 16h.01"/><path d="M16 8h.01"/><path d="M8 16h.01"/>',
  nota:'<path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9Z"/><path d="M15 3v6h6"/>',
};

const esc = (s)=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

export function nodeIcon(tipo){
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${IC[tipo]||'<circle cx="12" cy="12" r="9"/>'}</svg>`;
}

// Resumen de una línea que se muestra dentro de la tarjeta del nodo.
const clip = (s,n)=>{ s=String(s||"").replace(/\s+/g," ").trim(); return s.length>n ? s.slice(0,n-1)+"…" : s; };
const ACCION_LABELS={ add_tag:"Añadir etiqueta", remove_tag:"Quitar etiqueta", set_field:"Establecer campo", clear_field:"Limpiar campo", nota:"Añadir nota", seguimiento_on:"Marcar seguimiento", seguimiento_off:"Quitar seguimiento", archivar:"Archivar", desarchivar:"Desarchivar", bloquear:"Bloquear contacto", borrar_info:"Borrar información", transfer_human:"Transferir a humano", return_bot:"Devolver al bot", notify_admin:"Notificar admins", subscribe_seq:"Suscribir a secuencia", unsubscribe_seq:"Baja de secuencia", fecha_formato:"Formato fecha/hora", aleatorio:"Aleatorio", contar_caracteres:"Contar caracteres" };
export function summarize(tipo, c={}){
  switch(tipo){
    case "mensaje": { const b=c.bubbles||[]; const t=clip(b[0]?.text,64); const extra=b.length>1?`  (+${b.length-1} burbuja${b.length>2?"s":""})`:""; return (t||"Sin texto aún")+extra; }
    case "pregunta": return (clip(c.text,56)||"Sin pregunta aún")+(c.guardar_en?` → ${c.guardar_en}`:"");
    case "condicion": { const n=(c.rutas||[]).length; return n?`${n} ruta${n>1?"s":""} + si no cumple`:"Sin rutas definidas"; }
    case "accion": { const a=c.acciones||[]; if(!a.length) return "Sin acciones aún"; if(a.length===1) return ACCION_LABELS[a[0].tipo]||a[0].tipo; return `${a.length} acciones · ${ACCION_LABELS[a[0].tipo]||a[0].tipo}…`; }
    case "ia": { const ops={generar_texto:"Generar texto",analizar_imagen:"Analizar imagen",extraer:"Extraer datos"}; return (ops[c.operacion]||"Generar texto")+(c.guardar_en?` → ${c.guardar_en}`:""); }
    case "esperar": return `Pausa de ${c.segundos??"?"} s`;
    case "iniciar_flujo": return c.target_role?`Salta a: ${c.target_role}`:"Elige el flujo destino";
    case "evento_fb": return (c.event_name||"Lead")+(c.value?` · ${c.value}`:"");
    case "plantilla": return c.template_name||"Sin plantilla elegida";
    case "google_sheets": return (c.accion==="update"?"Actualizar fila":"Agregar fila")+(c.hoja?` · ${c.hoja}`:"");
    case "fin": return "Termina la conversación";
    case "rotador": { const v=(c.variantes||[]).filter(x=>x.activo!==false); const n=v.length; return n?`Reparte entre ${n} variante${n>1?"s":""} por peso`:"Sin variantes"; }
    case "nota": return clip(c.text,90)||"Nota vacía";
    default: return "";
  }
}
export { ACCION_LABELS };

// Tarjeta del nodo. m: { tipo, nombre, config, es_inicial }
export function nodeHtml(m){
  const t=NODE_TYPES[m.tipo]||{label:m.tipo};
  // La Nota es una anotación libre (post-it), sin cabecera ni puertos.
  if(m.tipo==="nota"){
    const txt=(m.config?.text||"").trim();
    return `<div class="nd nd-note">
      <div class="nd-note-head">${nodeIcon("nota")}<span>Nota</span></div>
      <div class="nd-note-txt">${txt?esc(txt):'<span class="nd-note-ph">Doble clic o edita en el panel…</span>'}</div>
    </div>`;
  }
  const sub=summarize(m.tipo, m.config||{});
  return `<div class="nd">
    <div class="nd-head">
      <span class="nd-ic">${nodeIcon(m.tipo)}</span>
      <span class="nd-type">${esc(t.label)}</span>
      ${m.es_inicial?`<span class="nd-start" title="Paso inicial del flujo"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21 6 3"/></svg>Inicio</span>`:""}
    </div>
    <div class="nd-body">
      <div class="nd-nm">${esc(m.nombre||t.label)}</div>
      ${sub?`<div class="nd-sub">${esc(sub)}</div>`:""}
    </div>
  </div>`;
}

// Puertos: color por semántica (éxito/fallo) o color del tipo, más una
// etiqueta flotante con el nombre de la salida cuando hay varias.
const HANDLE_TXT = { exito:"éxito", fallo:"fallo", continuar:"sigue", si_no_cumple:"no cumple" };
function prettyHandle(h){ return HANDLE_TXT[h] || h.replace(/^boton:/,"").replace(/^ruta:/,"ruta ").replace(/_/g," "); }
export function decorateNode(editor, m){
  const el=document.getElementById("node-"+m.dfId); if(!el) return;
  const handles=m.handles||[];
  el.classList.toggle("multi-out", handles.length>1);
  el.querySelectorAll(".outputs .output").forEach((o,i)=>{
    const h=handles[i]||"";
    const col=/fallo|si_no_cumple/.test(h) ? "var(--red)" : /exito/.test(h) ? "var(--green)" : (NODE_TYPES[m.tipo]?.color||"var(--brand)");
    o.title=h; o.style.background=col;
    let lb=o.querySelector(".plabel");
    if(handles.length>1 && h){
      if(!lb){ lb=document.createElement("span"); lb.className="plabel"; o.appendChild(lb); }
      lb.textContent=prettyHandle(h);
    } else lb?.remove();
  });
  const inp=el.querySelector(".inputs .input"); if(inp) inp.style.background="var(--faint)";
}

// ── Router ortogonal ────────────────────────────────────────────────
// Las líneas van rectas y doblan en ángulos de 90° con esquinas
// redondeadas. Un pase de "carriles" separa los segmentos que
// coincidirían para que ninguna línea se solape con otra.
const STUB=26, GAP=14, RADIUS=9, MARGIN=30;

function pathD(pts, r=RADIUS){
  if(pts.length<2) return "";
  const f=(n)=>+n.toFixed(1);
  let d=`M ${f(pts[0].x)} ${f(pts[0].y)}`;
  for(let i=1;i<pts.length-1;i++){
    const p=pts[i], a=pts[i-1], b=pts[i+1];
    const d1=Math.hypot(p.x-a.x,p.y-a.y), d2=Math.hypot(b.x-p.x,b.y-p.y);
    const rr=Math.min(r, d1/2, d2/2);
    if(rr<1 || !d1 || !d2){ d+=` L ${f(p.x)} ${f(p.y)}`; continue; }
    const u1={x:(p.x-a.x)/d1, y:(p.y-a.y)/d1}, u2={x:(b.x-p.x)/d2, y:(b.y-p.y)/d2};
    d+=` L ${f(p.x-u1.x*rr)} ${f(p.y-u1.y*rr)} Q ${f(p.x)} ${f(p.y)} ${f(p.x+u2.x*rr)} ${f(p.y+u2.y*rr)}`;
  }
  const l=pts[pts.length-1];
  return d+` L ${f(l.x)} ${f(l.y)}`;
}

// Ruta provisional (mientras el usuario arrastra una conexión nueva).
function simpleD(sx,sy,ex,ey){
  let pts;
  if(ex-sx>=STUB*2){
    const mx=(sx+ex)/2;
    pts = Math.abs(ey-sy)<=3 ? [{x:sx,y:sy},{x:ex,y:ey}] : [{x:sx,y:sy},{x:mx,y:sy},{x:mx,y:ey},{x:ex,y:ey}];
  } else {
    const my=(sy+ey)/2;
    pts=[{x:sx,y:sy},{x:sx+STUB,y:sy},{x:sx+STUB,y:my},{x:ex-STUB,y:my},{x:ex-STUB,y:ey},{x:ex,y:ey}];
  }
  return pathD(pts);
}

// Agrupa segmentos paralelos demasiado próximos y los reparte en
// carriles equidistantes (GAP px) alrededor de su centro.
function spread(items, gap){
  items.sort((a,b)=>a.get()-b.get());
  const clusters=[];
  for(const s of items){
    const cl=clusters.find(cl=>cl.some(o=>Math.abs(o.get()-s.get())<gap && o.lo<s.hi-2 && s.lo<o.hi-2));
    if(cl) cl.push(s); else clusters.push([s]);
  }
  for(const cl of clusters){
    if(cl.length<2) continue;
    const cen=cl.reduce((t,o)=>t+o.get(),0)/cl.length;
    cl.sort((a,b)=>(a.lo+a.hi)-(b.lo+b.hi));
    cl.forEach((s,k)=>{
      let v=cen+(k-(cl.length-1)/2)*gap;
      if(s.min!=null) v=Math.max(v,s.min);
      if(s.max!=null) v=Math.min(v,s.max);
      s.set(v);
    });
  }
}

function routeAll(editor){
  const pre=editor.precanvas; if(!pre) return;
  const z=editor.zoom||1, pr=pre.getBoundingClientRect();
  const local=(r)=>({x:(r.x-pr.x)/z, y:(r.y-pr.y)/z, w:r.width/z, h:r.height/z});
  const conns=[];
  pre.querySelectorAll("svg.connection").forEach(svg=>{
    let so,si,oc,icls;
    for(const c of svg.classList){
      if(c.startsWith("node_out_node-")) so=c.slice(14);
      else if(c.startsWith("node_in_node-")) si=c.slice(13);
      else if(c.startsWith("output_")) oc=c;
      else if(c.startsWith("input_")) icls=c;
    }
    if(so==null||si==null||!oc||!icls) return;
    const sEl=document.getElementById("node-"+so), tEl=document.getElementById("node-"+si);
    const oEl=sEl?.querySelector(".outputs ."+oc), iEl=tEl?.querySelector(".inputs ."+icls);
    if(!sEl||!tEl||!oEl||!iEl) return;
    const or=local(oEl.getBoundingClientRect()), ir=local(iEl.getBoundingClientRect());
    const sr=local(sEl.getBoundingClientRect()), tr=local(tEl.getBoundingClientRect());
    const tipo=[...sEl.classList].find(c=>NODE_TYPES[c]);
    conns.push({ svg, x1:or.x+or.w/2, y1:or.y+or.h/2, x2:ir.x+ir.w/2, y2:ir.y+ir.h/2, sr, tr,
      color:(NODE_TYPES[tipo]?.color)||"#64748B" });
  });

  // Rectángulos de los nodos (obstáculos que las líneas deben esquivar).
  const rects=[...pre.querySelectorAll(".drawflow-node")].map(n=>{
    const r=local(n.getBoundingClientRect());
    return {x0:r.x-6, y0:r.y-6, x1:r.x+r.w+6, y1:r.y+r.h+6};
  });

  // Geometría base de cada conexión.
  for(const c of conns){
    if(c.x2-c.x1 >= STUB*2){
      c.kind="F"; c.mx=(c.x1+c.x2)/2;
    } else {
      c.kind="B"; c.sx=c.x1+STUB; c.ex=c.x2-STUB;
      const top=Math.min(c.sr.y,c.tr.y)-MARGIN, bot=Math.max(c.sr.y+c.sr.h,c.tr.y+c.tr.h)+MARGIN;
      const mid=(c.y1+c.y2)/2;
      c.myDir=(mid-top <= bot-mid) ? -1 : 1;
      c.my=c.myDir<0 ? top : bot;
    }
  }

  // Tramos horizontales que NO pueden moverse (llegan/salen de un puerto):
  // los canales de retorno deben mantenerse a distancia de ellos.
  const fixedH=[];
  for(const c of conns){
    if(c.kind==="F"){
      fixedH.push({y:c.y1, x0:c.x1, x1:c.mx});
      fixedH.push({y:c.y2, x0:c.mx, x1:c.x2});
    } else {
      fixedH.push({y:c.y1, x0:c.x1, x1:c.sx});
      fixedH.push({y:c.y2, x0:c.ex, x1:c.x2});
    }
  }
  // El canal de un tramo de retorno esquiva nodos y líneas fijas,
  // avanzando siempre en su dirección elegida (arriba o abajo).
  const avoidH=(c)=>{
    for(let g=0; g<14; g++){
      const lo=Math.min(c.sx,c.ex), hi=Math.max(c.sx,c.ex);
      const r=rects.find(r=> c.my>r.y0 && c.my<r.y1 && lo<r.x1-2 && hi>r.x0+2);
      if(r){ c.my = c.myDir<0 ? r.y0 : r.y1; continue; }
      const f=fixedH.find(f=> Math.abs(f.y-c.my)<GAP-2 && lo<f.x1-2 && hi>f.x0+2);
      if(f){ c.my = f.y + c.myDir*GAP; continue; }
      break;
    }
  };
  const backs=conns.filter(c=>c.kind==="B");
  backs.forEach(avoidH);
  spread(backs.map(c=>({get:()=>c.my,set:v=>c.my=v,lo:Math.min(c.sx,c.ex),hi:Math.max(c.sx,c.ex)})), GAP);
  backs.forEach(avoidH);

  // Tramos verticales: esquivan nodos y luego se reparten en carriles.
  const vs=[];
  for(const c of conns){
    if(c.kind==="F"){ if(Math.abs(c.y1-c.y2)>3) vs.push({get:()=>c.mx,set:v=>c.mx=v,lo:Math.min(c.y1,c.y2),hi:Math.max(c.y1,c.y2),min:c.x1+12,max:c.x2-12}); }
    else {
      vs.push({get:()=>c.sx,set:v=>c.sx=v,lo:Math.min(c.y1,c.my),hi:Math.max(c.y1,c.my),min:c.x1+10});
      vs.push({get:()=>c.ex,set:v=>c.ex=v,lo:Math.min(c.my,c.y2),hi:Math.max(c.my,c.y2),max:c.x2-10});
    }
  }
  const avoidV=(s)=>{
    for(let g=0; g<12; g++){
      const x=s.get();
      const r=rects.find(r=> x>r.x0 && x<r.x1 && s.lo<r.y1-2 && s.hi>r.y0+2);
      if(!r) break;
      let nx=(x-r.x0 <= r.x1-x) ? r.x0 : r.x1;
      if(s.min!=null && nx<s.min) nx=r.x1;
      if(s.max!=null && nx>s.max) nx=r.x0;
      if((s.min!=null && nx<s.min)||(s.max!=null && nx>s.max)||Math.abs(nx-x)<.5) break;
      s.set(nx);
    }
  };
  vs.forEach(avoidV);
  spread(vs, GAP);
  vs.forEach(avoidV);

  // Pintar: trazo principal + zona de click ancha + flecha de llegada.
  for(const c of conns){
    const pts = c.kind==="F"
      ? (Math.abs(c.y1-c.y2)<=3 ? [{x:c.x1,y:c.y1},{x:c.x2,y:c.y2}] : [{x:c.x1,y:c.y1},{x:c.mx,y:c.y1},{x:c.mx,y:c.y2},{x:c.x2,y:c.y2}])
      : [{x:c.x1,y:c.y1},{x:c.sx,y:c.y1},{x:c.sx,y:c.my},{x:c.ex,y:c.my},{x:c.ex,y:c.y2},{x:c.x2,y:c.y2}];
    const d=pathD(pts);
    const main=c.svg.querySelector(".main-path"); if(!main) continue;
    main.setAttribute("d",d); main.style.stroke=c.color; main.style.color=c.color;
    let hit=c.svg.querySelector(".hit-path");
    if(!hit){
      hit=document.createElementNS("http://www.w3.org/2000/svg","path");
      hit.classList.add("hit-path");
      c.svg.insertBefore(hit, main);
      hit.addEventListener("mousedown",(e)=>{
        e.stopPropagation();
        main.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true,clientX:e.clientX,clientY:e.clientY,button:e.button}));
      });
    }
    hit.setAttribute("d",d);
    let arr=c.svg.querySelector(".arrow-path");
    if(!arr){ arr=document.createElementNS("http://www.w3.org/2000/svg","path"); arr.classList.add("arrow-path"); c.svg.appendChild(arr); }
    arr.setAttribute("d",`M ${c.x2-7} ${c.y2} L ${c.x2-15} ${c.y2-5} L ${c.x2-15} ${c.y2+5} Z`);
    arr.style.fill=c.color;
  }
}

// Encuadra todos los nodos en el viewport.
export function fitView(editor, pad=70){
  const nodes=editor.precanvas?.querySelectorAll(".drawflow-node");
  const cont=editor.container, cw=cont.clientWidth, ch=cont.clientHeight;
  if(!nodes||!nodes.length){
    editor.zoom=1; editor.zoom_last_value=1; editor.canvas_x=0; editor.canvas_y=0;
    editor.precanvas.style.transform="translate(0px, 0px) scale(1)";
    editor.dispatch && editor.dispatch("zoom",1);
    return;
  }
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  nodes.forEach(n=>{
    const x=parseFloat(n.style.left)||0, y=parseFloat(n.style.top)||0;
    x0=Math.min(x0,x); y0=Math.min(y0,y);
    x1=Math.max(x1,x+n.offsetWidth); y1=Math.max(y1,y+n.offsetHeight);
  });
  let zm=Math.min((cw-pad*2)/Math.max(x1-x0,1),(ch-pad*2)/Math.max(y1-y0,1),1);
  zm=Math.max(zm,.25);
  editor.zoom=zm; editor.zoom_last_value=zm;
  editor.canvas_x=(cw-(x1-x0)*zm)/2 - x0*zm;
  editor.canvas_y=(ch-(y1-y0)*zm)/2 - y0*zm;
  editor.precanvas.style.transform=`translate(${editor.canvas_x}px, ${editor.canvas_y}px) scale(${zm})`;
  editor.dispatch && editor.dispatch("zoom",zm);
  editor.dispatch && editor.dispatch("translate",{x:editor.canvas_x,y:editor.canvas_y});
}

// Zoom centrado en un punto (px de pantalla). Mantiene fijo lo que está
// bajo el cursor mientras se acerca/aleja.
function zoomAt(editor, nz, clientX, clientY){
  nz=Math.min(Math.max(nz, editor.zoom_min||.25), editor.zoom_max||1.6);
  const r=editor.container.getBoundingClientRect();
  const px=clientX-r.left, py=clientY-r.top;
  const wx=(px-(editor.canvas_x||0))/editor.zoom, wy=(py-(editor.canvas_y||0))/editor.zoom;
  editor.canvas_x=px-wx*nz; editor.canvas_y=py-wy*nz;
  editor.zoom=nz; editor.zoom_last_value=nz;
  editor.precanvas.style.transform=`translate(${editor.canvas_x}px, ${editor.canvas_y}px) scale(${nz})`;
  editor.dispatch&&editor.dispatch("zoom",nz);
  editor.dispatch&&editor.dispatch("translate",{x:editor.canvas_x,y:editor.canvas_y});
}

// Instala todo sobre una instancia Drawflow ya iniciada.
export function installCanvas(editor){
  editor.reroute=false;
  editor.zoom_min=.25; editor.zoom_max=1.6;
  editor.zoomAt=(nz,cx,cy)=>zoomAt(editor,nz,cx,cy);

  // Zoom con la RUEDA del mouse (sin Ctrl): acerca/aleja hacia el cursor.
  // En captura + stopPropagation para ganarle al handler propio de Drawflow.
  editor.container.addEventListener("wheel",(e)=>{
    e.preventDefault(); e.stopPropagation();
    // Zoom exponencial proporcional al desplazamiento de la rueda/trackpad:
    // suave y preciso (mantiene fijo el punto exacto bajo el cursor). Se acota
    // el delta por evento para que un "flick" fuerte no salte de golpe.
    const dy=Math.max(-60,Math.min(60,e.deltaY));
    const factor=Math.exp(-dy*0.0022);
    zoomAt(editor, (editor.zoom||1)*factor, e.clientX, e.clientY);
  }, { passive:false, capture:true });

  // Variables --nd-color por tipo (nodos, paleta y chips con data-tipo).
  if(!document.getElementById("flow-node-colors")){
    const st=document.createElement("style"); st.id="flow-node-colors";
    st.textContent=Object.entries(NODE_TYPES)
      .map(([k,v])=>`.drawflow-node.${k},[data-tipo="${k}"]{--nd-color:${v.color}}`).join("\n");
    document.head.appendChild(st);
  }
  editor.container.classList.add("flow-canvas");

  // Trazado provisional al arrastrar; el definitivo lo pone routeAll.
  editor.createCurvature=(sx,sy,ex,ey)=>simpleD(sx,sy,ex,ey);

  let raf=0;
  const schedule=()=>{ if(raf) return; raf=requestAnimationFrame(()=>{ raf=0; routeAll(editor); }); };
  const origU=editor.updateConnectionNodes.bind(editor);
  editor.updateConnectionNodes=(id)=>{ origU(id); schedule(); };
  ["connectionCreated","connectionRemoved","nodeRemoved","nodeCreated","import"].forEach(ev=>editor.on(ev,schedule));

  // La cuadrícula de puntos acompaña el paneo y el zoom.
  const grid=()=>{
    const z=editor.zoom||1;
    editor.container.style.backgroundSize=`${24*z}px ${24*z}px`;
    editor.container.style.backgroundPosition=`${editor.canvas_x||0}px ${editor.canvas_y||0}px`;
  };
  editor.on("zoom",()=>{ grid(); schedule(); });
  editor.on("translate",grid);
  grid();

  return { schedule, routeAll:()=>routeAll(editor), fitView:()=>{ fitView(editor); grid(); } };
}

// Auto-organiza los nodos en columnas por profundidad del flujo (layout
// por capas: raíces a la izquierda, cada salto una columna a la derecha).
// Las Notas (sin conexiones) se apilan aparte, arriba.
export function autoLayout(editor){
  const data=editor.export().drawflow.Home.data;
  const ids=Object.keys(data); if(!ids.length) return;
  const size=(id)=>{ const el=document.getElementById("node-"+id); return { w:el?el.offsetWidth:220, h:el?el.offsetHeight:80 }; };
  const isNota=(id)=> data[id]?.name==="nota" || data[id]?.class==="nota";
  const flow=ids.filter(id=>!isNota(id)), notas=ids.filter(isNota);
  const out={}, indeg0={};
  flow.forEach(id=>{ out[id]=[]; indeg0[id]=0; });
  flow.forEach(id=>{ const o=data[id].outputs||{}; for(const k in o) for(const c of (o[k].connections||[])) if(out[c.node]!=null) out[id].push(c.node); });
  flow.forEach(id=> out[id].forEach(t=>{ indeg0[t]++; }));
  // Detecta y descarta aristas de RETORNO (ciclos) con un DFS que arranca en las
  // RAÍCES (sin entradas), quedándonos con un DAG; sobre él se hace el layering
  // por camino más largo (orden topológico de Kahn).
  const dag={}; flow.forEach(id=>dag[id]=[]);
  const state={}; // 0 sin ver · 1 en pila · 2 hecho
  const visit=(id)=>{ state[id]=1;
    for(const t of out[id]){ if(state[t]===1) continue; /* back edge → ignora */ dag[id].push(t); if(!state[t]) visit(t); }
    state[id]=2; };
  flow.filter(id=>indeg0[id]===0).forEach(id=>{ if(!state[id]) visit(id); });
  flow.forEach(id=>{ if(!state[id]) visit(id); }); // por si hay componentes en ciclo puro
  const indeg={}; flow.forEach(id=>indeg[id]=0);
  flow.forEach(id=> dag[id].forEach(t=>{ indeg[t]++; }));
  const layer={}; flow.forEach(id=>layer[id]=0);
  const q=flow.filter(id=>indeg[id]===0); const din={}; flow.forEach(id=>din[id]=indeg[id]);
  while(q.length){ const id=q.shift();
    for(const t of dag[id]){ if(layer[t]<layer[id]+1) layer[t]=layer[id]+1; if(--din[t]===0) q.push(t); } }
  const byLayer={};
  flow.forEach(id=>{ (byLayer[layer[id]] ||= []).push(id); });
  Object.values(byLayer).forEach(arr=> arr.sort((a,b)=>(data[a].pos_y||0)-(data[b].pos_y||0)));
  const GX=100, GY=40; let x=80;
  const move=(id,nx,ny)=>{ const el=document.getElementById("node-"+id); if(el){ el.style.left=nx+"px"; el.style.top=ny+"px"; } data[id].pos_x=nx; data[id].pos_y=ny; const dd=editor.drawflow.drawflow.Home.data[id]; if(dd){ dd.pos_x=nx; dd.pos_y=ny; } editor.updateConnectionNodes("node-"+id); };
  const layers=Object.keys(byLayer).map(Number).sort((a,b)=>a-b);
  for(const L of layers){
    const arr=byLayer[L]; let colW=0; arr.forEach(id=>{ colW=Math.max(colW,size(id).w); });
    let y=80; for(const id of arr){ move(id,x,y); y+=size(id).h+GY; }
    x+=colW+GX;
  }
  // Notas: columna extra a la derecha.
  let ny=80; for(const id of notas){ move(id, x, ny); ny+=size(id).h+GY; }
  editor.dispatch&&editor.dispatch("import");
}

// Controles flotantes: deshacer/rehacer · zoom (−/%/+) · encuadrar ·
// auto-organizar. `api` puede traer { fitView, undo, redo, organize }.
export function mountZoomControls(editor, host, api){
  const btn=(z,title,path)=>`<button data-z="${z}" title="${title}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${path}</svg></button>`;
  const el=document.createElement("div"); el.className="flow-zoomctl";
  el.innerHTML=
    btn("undo","Deshacer (Ctrl+Z)",'<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>')
    +btn("redo","Rehacer (Ctrl+Y)",'<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/>')
    +`<span class="zsep"></span>`
    +btn("out","Alejar",'<path d="M5 12h14"/>')
    +`<span class="zpct">100%</span>`
    +btn("in","Acercar",'<path d="M12 5v14M5 12h14"/>')
    +`<span class="zsep"></span>`
    +btn("fit","Encuadrar el flujo",'<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>')
    +btn("org","Auto-organizar pasos",'<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><path d="M10 6.5h4"/><path d="M17.5 10v4"/>');
  const pct=el.querySelector(".zpct");
  const paint=()=>{ pct.textContent=Math.round((editor.zoom||1)*100)+"%"; };
  const midX=()=>editor.container.getBoundingClientRect().left+editor.container.clientWidth/2;
  const midY=()=>editor.container.getBoundingClientRect().top+editor.container.clientHeight/2;
  el.querySelector('[data-z="in"]').onclick=()=>{ editor.zoomAt((editor.zoom||1)*1.15, midX(), midY()); paint(); };
  el.querySelector('[data-z="out"]').onclick=()=>{ editor.zoomAt((editor.zoom||1)/1.15, midX(), midY()); paint(); };
  el.querySelector('[data-z="fit"]').onclick=()=>{ (api?.fitView||(()=>fitView(editor)))(); paint(); };
  el.querySelector('[data-z="org"]').onclick=()=>{ (api?.organize||(()=>{ autoLayout(editor); (api?.fitView||(()=>fitView(editor)))(); }))(); paint(); };
  const undoBtn=el.querySelector('[data-z="undo"]'), redoBtn=el.querySelector('[data-z="redo"]');
  undoBtn.onclick=()=> api?.undo && api.undo();
  redoBtn.onclick=()=> api?.redo && api.redo();
  el._setHistory=(canUndo,canRedo)=>{ undoBtn.disabled=!canUndo; redoBtn.disabled=!canRedo; };
  editor.on("zoom",paint);
  host.appendChild(el);
  return el;
}
