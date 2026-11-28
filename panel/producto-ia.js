// ═════════════════════════════════════════════════════════════════
// Nodo · panel/producto-ia.js — la FICHA del producto que lee la IA (28-nov-2026)
//   Sacado tal cual de productos.html para que el MCP (supabase/functions/mcp) compile config.faq y
//   config.contexto_producto EXACTAMENTE igual que el panel al guardar. Funciones puras: sin DOM ni estado.
//   Lo importan productos.html y supabase/functions/mcp/index.ts — si cambias las exportaciones, sube el ?v= en productos.html.
// ═════════════════════════════════════════════════════════════════
// FAQ del producto: editor de pares P/R que compila a config.faq (texto que
// lee el motor). Se conserva config.faq_items para poder re-editarlo.
export function parseFaq(txt){
  if(!txt||!txt.trim()) return [];
  const items=[]; const re=/P(?:regunta)?\s*:?\s*([\s\S]*?)\s*R(?:espuesta)?\s*:?\s*([\s\S]*?)(?=(?:\n\s*P(?:regunta)?\s*:)|$)/gi;
  let m; while((m=re.exec(txt))){ const q=(m[1]||"").trim(), a=(m[2]||"").trim(); if(q||a) items.push({q,a}); }
  if(!items.length) items.push({q:"", a:txt.trim()});
  return items;
}
export function compileFaq(items){ return (items||[]).filter(x=>x&&(x.q||x.a)).map(x=>`P: ${(x.q||"").trim()}\nR: ${(x.a||"").trim()}`).join("\n\n"); }
// Objeciones estructuradas ↔ texto "«objeción» → respuesta" (lo que ya lee el prompt).
export function parseObj(txt){
  if(!txt||!txt.trim()) return [];
  return txt.split(/\n+/).map(line=>{
    const m=line.match(/^\s*[«"']?\s*(.*?)\s*[»"']?\s*(?:→|->|=>|:)\s*([\s\S]*)$/);
    if(m && m[1]) return { o:m[1].trim(), r:(m[2]||"").trim() };
    const t=line.trim(); return t?{o:t,r:""}:null;
  }).filter(Boolean);
}
export function compileObj(items){ return (items||[]).filter(x=>x&&(x.o||x.r)).map(x=>`«${(x.o||"").trim()}» → ${(x.r||"").trim()}`).join("\n"); }

// 🧩 LA FICHA DE 3 CUADROS (6-oct, Rodrigo: «¿no crees que es muy largo de rellenar?»).
// Eran 17 casilleros y en Calistenia «de por vida» salía 12 veces en el prompt: cada casillero invitaba a escribir
// otra regla, y esas reglas chocaban con las del motor (auditoría del prompt digital). Ahora son tres:
//   1 · ¿Qué es y qué incluye?            → ia.detalle   (el «Resumen» se junta adentro)
//   2 · Lo que NO incluye o no se promete  → ia.limites   (las «Reglas del producto» se juntan adentro)
//   3 · Lo que te preguntan → respuesta   → faq_items    (las «Objeciones» se juntan en la misma lista)
// Nada se borra sin pasar antes a su cuadro, y es idempotente (prodSync lo corre en cada tecla). El motor no cambia:
// lee los mismos campos. `ia.resumen` queda DERIVADO (primera línea de la descripción, `_resumen_auto`) porque el
// motor lo usa para listar «lo demás que vende el negocio»; compileProductoIA ya no lo repite en la ficha.
// Solo productos principales: el EXTRA usa su formulario corto con resumen y detalle aparte (renderExtraIA).
export function primeraLineaFicha(t){
  const l=String(t||"").split(/\n/).map(s=>s.replace(/^[#*\-•\s]+/,"").trim()).find(Boolean)||"";
  return l.length>160 ? l.slice(0,157).replace(/\s+\S*$/,"")+"…" : l;
}
export function fusionarFicha(c){
  if(!c) return; const ia=c.ia=c.ia||{};
  const norm=(s)=>String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g," ").trim();
  // 1) Resumen → arriba de la descripción (si no estaba ya adentro)
  if(String(ia.resumen||"").trim() && !ia._resumen_auto){
    const r=String(ia.resumen).trim(), d=String(ia.detalle||"").trim();
    ia.detalle = !d ? r : (norm(d).includes(norm(r)) ? d : r+"\n\n"+d);
  }
  if(String(ia.detalle||"").trim()){ ia.resumen=primeraLineaFicha(ia.detalle); ia._resumen_auto=true; }
  else if(ia._resumen_auto){ delete ia.resumen; }
  // 2) Reglas del producto → al principio del cuadro de límites
  if(String(ia.reglas_producto||"").trim()){
    const rp=String(ia.reglas_producto).trim(), li=String(ia.limites||"").trim();
    ia.limites = !li ? rp : (norm(li).includes(norm(rp)) ? li : rp+"\n"+li);
  }
  delete ia.reglas_producto;
  // 3) Objeciones → a la lista de «lo que te preguntan» (sin repetir la misma pregunta)
  const obs=(Array.isArray(ia.objeciones_items) ? ia.objeciones_items : parseObj(ia.objeciones)).filter(o=>o&&(String(o.o||"").trim()||String(o.r||"").trim()));
  if(obs.length){
    if(!Array.isArray(c.faq_items)) c.faq_items=parseFaq(c.faq);
    const ya=new Set(c.faq_items.map(x=>norm(x.q)).filter(Boolean));
    obs.forEach(o=>{ const k=norm(o.o); if(!k || !ya.has(k)){ c.faq_items.push({ q:String(o.o||"").trim(), a:String(o.r||"").trim() }); if(k) ya.add(k); } });
    c.faq=compileFaq(c.faq_items);
  }
  if(Array.isArray(ia.objeciones_items) || ia.objeciones!=null){ ia.objeciones_items=[]; delete ia.objeciones; }
}

export const ESTILOS_VENTA={ consultivo:"Consultivo (entiende antes de ofrecer)", directo:"Directo (va al grano y cierra)", educativo:"Educativo (enseña y genera confianza)", urgencia:"Urgencia / Escasez (motiva a decidir ya)", objeciones:"Basado en objeciones (rebate dudas)" };

export const CONFIRM_COD=[["referencia","Referencia de envío"],["mapa","Mapa de ubicación enviado por el cliente"],["rango_fecha","Confirmación de rango de entrega y fecha"]];

export const CONFIRM_AG=[["agencia_def","Agencia de envío definida"],["adelanto","Adelanto de pago"],["dni","DNI / Carné de extranjería"]];

export function compileConfirmaciones(c,tipo){
  if(tipo!=="fisico") return "";
  const cf=(c.envio&&c.envio.confirmaciones)||{};
  const on=(arr)=>arr.filter(([k])=>cf[k]).map(([,l])=>"- "+l);
  const cod=on(CONFIRM_COD), ag=on(CONFIRM_AG);
  if(!cod.length&&!ag.length) return "";
  // "Verifica antes de confirmar" se leía como "pídele que te lo confirme": con
  // el DNI ya capturado y válido, la IA respondía "confírmame cuál es el DNI
  // correcto" — repreguntaba un dato bueno justo cuando el pedido ya estaba
  // creado. Es una lista de lo que NO puede faltar, no un pedido de confirmación.
  const L=["## Requisitos para confirmar el pedido",
    "Es lo que no puede FALTAR para cerrar el pedido. Si el cliente ya te lo dio, dalo por bueno: no se lo vuelvas a pedir ni le pidas que lo confirme."];
  if(cod.length) L.push("Para pedidos contraentrega, no cierres el pedido sin tener:\n"+cod.join("\n"));
  if(ag.length) L.push("Para pedidos por agencia, no cierres el pedido sin tener:\n"+ag.join("\n"));
  return L.join("\n\n");
}

export function compileProductoIA(c,tipo){
  const ia=c.ia||{}; const L=[];
  const add=(t,v)=>{ if(v&&String(v).trim()) L.push(`## ${t}\n${String(v).trim()}`); };
  const cv=[];
  if(ia.estilo_venta&&ESTILOS_VENTA[ia.estilo_venta]) cv.push("Estilo de venta: "+ESTILOS_VENTA[ia.estilo_venta]+".");
  // (11-oct) «Cerrar preguntando cómo paga» — el cierre de ChatLevel, con la pregunta que el dueño escriba (Yape no existe
  //  fuera de Perú). Solo digital: en lo físico el cierre es la ciudad / cuántas / los datos.
  if(tipo!=="fisico" && ia.cierre_alt==="1" && String(ia.cierre_alt_txt||"").trim())
    cv.push("Cierre alternativo (regla de oro): cuando resuelvas una duda o muestre interés, no le preguntes si quiere comprar ni si lo empieza hoy: pregúntale cómo lo paga, «"+String(ia.cierre_alt_txt).trim()+"». Cuando ya eligió el medio, dice que lo quiere o pregunta cómo pagar, dale el siguiente paso: los datos de pago y que te mande la captura.");
  if(ia.proceso&&ia.proceso.trim()) cv.push("Proceso de venta:\n"+ia.proceso.trim());
  if(ia.tecnicas&&ia.tecnicas.trim()) cv.push("Técnicas de venta:\n"+ia.tecnicas.trim());
  if(cv.length) L.push("## Cómo vender este producto\n"+cv.join("\n\n"));
  // Objeciones: la munición del vendedor. Se compila prominente para que la IA
  // las tenga a la mano y rebata con tacto (no discutir), sin inventar.
  if(ia.objeciones&&ia.objeciones.trim()) L.push("## Objeciones frecuentes y cómo responderlas\nCuando el cliente ponga una de estas dudas o pegas, responde en esta línea (con tacto, nunca discutas ni presiones de más; si no aplica, sé honesto):\n"+ia.objeciones.trim());
  // (con la ficha de 3 cuadros el resumen es la primera línea de la descripción: no se repite — ver fusionarFicha)
  if(!ia._resumen_auto) add("Resumen del producto",ia.resumen);
  add("Descripción / detalle",ia.detalle);
  add("Reglas del producto",ia.reglas_producto);
  add("Límites: lo que este producto NO hace, NO incluye o NO se promete, y lo que hay que respetar siempre (si te lo preguntan, dilo de frente, sin inventar más)",ia.limites);
  add("Reglas del precio",ia.reglas_precio);
  // Las ofertas por cantidad ya NO se compilan acá: son Opciones de compra
  // reales (migración 0029) y el motor le inyecta a la IA el catálogo con sus
  // precios de verdad. Tenerlas en dos lados se contradecía.
  add("Precios con descuento",ia.descuentos);
  // (25-oct) Los medios PROPIOS ahora son una lista (config.pago_propio): acá van en texto para que la IA los conozca.
  const _pp=((c.pago_propio&&c.pago_propio.metodos)||[]).filter(m=>m&&(m.app||m.numero||m.titular));
  add("Formas de pago de este producto (REEMPLAZAN a las generales: cóbralo SOLO con estas)", _pp.length ? _pp.map(m=>"- "+[m.app,m.numero,m.titular&&("a nombre de "+m.titular),m.notas].filter(Boolean).join(" · ")).join("\n") : ia.metodos_pago);
  const ej=(ia.ejemplos||[]).filter(e=>e&&(e.sit||e.resp));
  if(ej.length) L.push("## Ejemplos de respuesta\n"+ej.map(e=>`- Si el cliente ${(e.sit||"").trim()} → responde: ${(e.resp||"").trim()}`).join("\n"));
  // (con lista de permitidos ya dice «ninguno fuera de esa lista»: la de prohibidos sobra y el panel ya no la pide)
  if(ia.emojis_prohibidos&&ia.emojis_prohibidos.trim()&&!String(c.emojis||"").trim()) L.push("## Emojis prohibidos\nNunca uses estos emojis ni de ese estilo: "+ia.emojis_prohibidos.trim());
  const mm=(c.ia_multimedia||[]).filter(m=>m&&m.media_url);
  if(mm.length) L.push("## Archivos que puedes enviar\nCuando la situación lo pida, envía el archivo escribiendo `[[media:TAG]]` en una línea aparte.\n"+mm.map(m=>`- [[media:${m.tag||"archivo"}]] — ${m.descripcion||m.filename||"archivo"}`).join("\n"));
  const req=compileConfirmaciones(c,tipo); if(req) L.push(req);
  // 🎁 Regalo con la compra: si está activado "mencionar", la IA lo usa de gancho.
  const regs=(c.regalos||[]).filter(r=>r&&r.nombre);
  if(c.regalo_mencionar && regs.length){
    const lista=regs.map(r=> (r.desc&&String(r.desc).trim()) ? `- ${r.nombre}: ${String(r.desc).trim()}` : `- ${r.nombre}`).join("\n");
    L.push("## 🎁 Regalo con la compra\nAl comprar, el cliente se lleva GRATIS de regalo:\n"+lista+"\nPuedes mencionarlo con naturalidad para incentivar el cierre (\"y de regalo te incluyo…\"). Si el cliente pregunta qué es, explícaselo con su descripción. No lo cobres, no lo prometas dos veces ni exageres; se entrega solo al cerrar la compra.");
  }
  return L.join("\n\n");
}
