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
  accion:       { label:"Acción",        color:"#F97316", desc:"Etiquetas, campos y otras acciones internas" },
  ia:           { label:"IA",            color:"#EC4899", desc:"Genera texto, analiza imágenes o extrae datos" },
  esperar:      { label:"Esperar",       color:"#94A3B8", desc:"Pausa el flujo unos segundos" },
  iniciar_flujo:{ label:"Ir a flujo",    color:"#06B6D4", desc:"Salta a otro flujo del canal" },
  evento_fb:    { label:"Evento Meta",   color:"#6366F1", desc:"Envía una conversión a Meta (CAPI)" },
  plantilla:    { label:"Plantilla",     color:"#14B8A6", desc:"Envía una plantilla aprobada de WhatsApp" },
  google_sheets:{ label:"Google Sheets", color:"#22C55E", desc:"Agrega o actualiza una fila en tu hoja" },
  fin:          { label:"Fin",           color:"#EF4444", desc:"Termina la conversación" },
  rotador:      { label:"Rotador",       color:"#EAB308", desc:"Rota variantes de mensaje inicial" },
};

// Iconos Lucide (paths) por tipo de nodo.
const IC = {
  mensaje:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  pregunta:'<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  condicion:'<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>',
  accion:'<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  ia:'<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  esperar:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  iniciar_flujo:'<polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>',
  evento_fb:'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  plantilla:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  google_sheets:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  fin:'<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  rotador:'<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>',
};

const esc = (s)=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

export function nodeIcon(tipo){
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${IC[tipo]||'<circle cx="12" cy="12" r="9"/>'}</svg>`;
}

// Resumen de una línea que se muestra dentro de la tarjeta del nodo.
const clip = (s,n)=>{ s=String(s||"").replace(/\s+/g," ").trim(); return s.length>n ? s.slice(0,n-1)+"…" : s; };
export function summarize(tipo, c={}){
  switch(tipo){
    case "mensaje": { const b=c.bubbles||[]; const t=clip(b[0]?.text,64); const extra=b.length>1?`  (+${b.length-1} burbuja${b.length>2?"s":""})`:""; return (t||"Sin texto aún")+extra; }
    case "pregunta": return (clip(c.text,56)||"Sin pregunta aún")+(c.guardar_en?` → ${c.guardar_en}`:"");
    case "condicion": { const n=(c.rutas||[]).length; return n?`${n} ruta${n>1?"s":""} + si no cumple`:"Sin rutas definidas"; }
    case "accion": { const n=(c.acciones||[]).length; return n?`${n} acción${n>1?"es":""}`:"Sin acciones aún"; }
    case "ia": { const ops={generar_texto:"Generar texto",analizar_imagen:"Analizar imagen",extraer:"Extraer datos"}; return (ops[c.operacion]||"Generar texto")+(c.guardar_en?` → ${c.guardar_en}`:""); }
    case "esperar": return `Pausa de ${c.segundos??"?"} s`;
    case "iniciar_flujo": return c.target_role?`Salta a: ${c.target_role}`:"Elige el flujo destino";
    case "evento_fb": return (c.event_name||"Lead")+(c.value?` · ${c.value}`:"");
    case "plantilla": return c.template_name||"Sin plantilla elegida";
    case "google_sheets": return (c.accion==="update"?"Actualizar fila":"Agregar fila")+(c.hoja?` · ${c.hoja}`:"");
    case "fin": return "Termina la conversación";
    case "rotador": { const n=(c.variantes||c.mensajes||[]).length; return n?`${n} variantes en rotación`:"Rotación de mensajes"; }
    default: return "";
  }
}

// Tarjeta del nodo. m: { tipo, nombre, config, es_inicial }
export function nodeHtml(m){
  const t=NODE_TYPES[m.tipo]||{label:m.tipo};
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

// Instala todo sobre una instancia Drawflow ya iniciada.
export function installCanvas(editor){
  editor.reroute=false;
  editor.zoom_min=.25; editor.zoom_max=1.6;

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

// Controles flotantes de zoom (− % + · encuadrar).
export function mountZoomControls(editor, host, api){
  const el=document.createElement("div");
  el.className="flow-zoomctl";
  el.innerHTML=`
    <button data-z="out" title="Alejar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
    <span class="zpct">100%</span>
    <button data-z="in" title="Acercar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
    <span class="zsep"></span>
    <button data-z="fit" title="Encuadrar el flujo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>`;
  const pct=el.querySelector(".zpct");
  const paint=()=>{ pct.textContent=Math.round((editor.zoom||1)*100)+"%"; };
  el.querySelector('[data-z="in"]').onclick=()=>{ editor.zoom_in(); paint(); };
  el.querySelector('[data-z="out"]').onclick=()=>{ editor.zoom_out(); paint(); };
  el.querySelector('[data-z="fit"]').onclick=()=>{ (api?.fitView||(()=>fitView(editor)))(); paint(); };
  editor.on("zoom",paint);
  host.appendChild(el);
  return el;
}
