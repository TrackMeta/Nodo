// 🏢 EL TEXTO DEL NEGOCIO que lee el bot (`channels.negocio`), armado desde el formulario (`channels.negocio_form`).
//
// Antes vivía COPIADO en negocio.html y en ia.html (las dos pantallas guardan el formulario completo y recompilan el
// texto): cada arreglo había que hacerlo dos veces, y una vez ya se desincronizaron (a la copia de IA le faltaba la
// biblioteca de archivos). Ahora es uno solo.
//
// 🧩 FICHA DEL NEGOCIO EN 4 CUADROS (6-oct, Rodrigo: «quiero hacer lo mismo que con la ficha del producto»). Eran 13
// casilleros y la mitad repetía la ficha del producto («pago único», «de por vida», «no prometer resultados»…):
//   1 · Tu negocio                          → nombre + rubro      («Cliente ideal» y «Propuesta» se juntan adentro)
//   2 · Cómo se paga y cómo se entrega       → pagos              («Envíos y entrega» se junta adentro)
//   3 · Políticas y lo que nunca se promete  → politicas          («Nunca hacer» se junta adentro)
//   4 · Cuándo pasar a una persona           → transferir + horario
//   Avanzado: preguntas frecuentes, archivos, información adicional.
// El motor NO depende de estos títulos (solo lee el texto, y filtra por las marcas «físico:» / «digital:»), así que
// reordenar es cosa del panel. Las perillas de estilo (negritas, emojis) y los archivos el motor los lee del formulario.

export const TONOS = { cercano:"Cercano y amigable, con tuteo", formal:"Formal y profesional, trato de usted", directo:"Directo y breve, sin rodeos", divertido:"Divertido y relajado, con buena onda", ventas:"Persuasivo y orientado a cerrar la venta" };

// El TONO se compila acá porque el motor no tiene de dónde deducirlo. Las negritas y
// los emojis NO: desde el 2026-08-31 el motor lee `negocio_form` directo y arma su
// propio bloque de formato (estiloDeEscritura). Dejarlos también acá metía DOS
// instrucciones distintas en el mismo prompt — y la de acá era la mala: "puedes usar
// … con moderación" es exactamente la redacción con la que el modelo no pone ni una
// negrita. Medido: el bot escribía plano teniendo las perillas activadas.
export function compilePersona(form){
  const p=[];
  if(form.nombre_ia&&form.nombre_ia.trim()) p.push(`Te llamas ${form.nombre_ia.trim()}${form.nombre?`, el asistente virtual de ventas de ${form.nombre.trim()}`:""}. Si te preguntan tu nombre, ese es.`);
  const t=[]; if(form.tono&&TONOS[form.tono]) t.push(TONOS[form.tono]); if(form.tono_detalle&&form.tono_detalle.trim()) t.push(form.tono_detalle.trim());
  if(t.length) p.push("Tono: "+t.join(". ")+".");
  return p.length?p.join(" "):"";
}

// Junta los casilleros viejos en su cuadro. Idempotente (no repite lo que ya está adentro) y sin perder nada: el texto
// viejo pasa entero al cuadro nuevo y recién ahí se borra su casillero. Corre al abrir, al guardar y al aplicar un
// borrador de «Armar con IA», en las dos pantallas.
const norm=(s)=>String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g," ").trim();
function juntar(form, destino, origenes, sep){
  for(const k of origenes){
    const v=String(form[k]||"").trim();
    if(v){
      const d=String(form[destino]||"").trim();
      form[destino] = !d ? v : (norm(d).includes(norm(v)) ? d : d+sep+v);
    }
    delete form[k];
  }
}
export function fusionarNegocio(form){
  if(!form||typeof form!=="object") return form;
  juntar(form, "rubro", ["publico","propuesta"], " ");
  juntar(form, "pagos", ["entrega"], "\n");
  juntar(form, "politicas", ["no_hacer"], "\n");
  return form;
}

export function compileNegocio(form){
  const L=[]; const add=(t,v)=>{ if(v&&String(v).trim()) L.push(`## ${t}\n${String(v).trim()}`); };
  if(form.nombre&&form.nombre.trim()) L.push(`# ${form.nombre.trim()}`);
  const persona=compilePersona(form); if(persona) L.push("## Cómo debes comportarte\n"+persona);
  add("Qué vendemos y a quién",form.rubro);
  // (por si llega un formulario sin fusionar: lo viejo sigue compilando, nunca se pierde)
  add("Cliente ideal",form.publico); add("Propuesta de valor",form.propuesta);
  add("Cómo se paga y cómo se entrega",form.pagos); add("Envíos y entrega",form.entrega);
  add("Políticas y lo que nunca se promete",form.politicas); add("Nunca hacer / no prometer",form.no_hacer);
  add("Cuándo transferir a una persona",form.transferir);
  add("Horario de atención",form.horario);
  const faq=(form.faq||[]).filter(x=>x&&(x.q||x.a));
  if(faq.length) L.push("## Preguntas frecuentes\n"+faq.map(x=>`- P: ${(x.q||"").trim()}\n  R: ${(x.a||"").trim()}`).join("\n"));
  if(form.extra&&form.extra.trim()) L.push("## Información adicional\n"+form.extra.trim());
  // Archivos del NEGOCIO que la IA puede mandar sola. Mismo marcador que los del
  // producto ([[media:TAG]]), y el motor junta las dos bibliotecas en un catálogo.
  // El límite va escrito acá a propósito: sin él, el modelo mete un archivo en cada
  // mensaje y la conversación se vuelve un álbum que el cliente tiene que ir pasando.
  const mm=(form.multimedia||[]).filter(m=>m&&m.media_url&&m.tag);
  if(mm.length) L.push("## Archivos que puedes enviar\n" +
    "Cuando la situación lo pida, envía el archivo escribiendo `[[media:TAG]]` en una línea aparte.\n" +
    mm.map(m=>`- [[media:${m.tag}]] — ${(m.descripcion||"").trim()||"archivo del negocio"}`).join("\n") +
    "\n⛔ Como MUCHO uno por conversación, y solo si responde algo que el cliente preguntó o una duda que mostró. " +
    "No los mandes de saludo ni encadenes varios: cada archivo es una burbuja más que él tiene que abrir.");
  return L.join("\n\n");
}
