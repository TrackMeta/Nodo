// 🔎 REVISOR DE TEXTOS al guardar (ficha del producto, bienvenida y Negocio).
//
// Por qué existe: la auditoría del prompt digital (6-oct) encontró que casi todos los errores del bot salían de lo
// que el DUEÑO escribe — un prompt traído de otra plataforma le pedía al bot pasos que en Nodo hace el sistema
// solo («pregúntale cómo prefiere pagar», «pásale el Yape»), cifras de ofertas que el bot repite, «un asesor te
// contactará», el mismo tema con tres órdenes distintas, emojis prohibidos en la bienvenida. Nada de eso es un error
// de código: es texto. Esto lo señala ANTES de guardar, con el porqué y cómo escribirlo. Nunca bloquea: avisa.
//
// Funciones puras (sin DOM ni base): reciben el texto y devuelven avisos {campo, titulo, detalle}.

const RE_EMOJI = /\p{Extended_Pictographic}/gu;
const emojisDe = (t) => [...new Set(String(t ?? "").match(RE_EMOJI) ?? [])];

// 1) Pedirle al bot lo que Nodo ya hace solo: preguntar el medio de pago o pasar el número.
// (con «no» delante es justo la regla buena: «no le preguntes por cuál medio va a pagar»)
const RE_PIDE_COBRAR =
  /(?<!\bno\s(?:le\s|les\s)?)preg[uú]nt\w*\s+(?:le\s+)?(?:c[oó]mo|con\s+qu[eé]|por\s+(?:cu[aá]l|qu[eé])|qu[eé]\s+(?:medio|m[eé]todo))[^.\n]{0,25}pag|pregunta\s+c[oó]mo\s+paga|(?:p[aá]sale|env[ií]ale|m[aá]ndale|dale|comp[aá]rtele)\s+(?:el\s+|los\s+|tu\s+|nuestro\s+)?(?:yape|plin|n[uú]mero|cuenta|datos\s+de\s+pago|datos\s+para\s+(?:el\s+)?pago)|¿?\s*(?:yape|yape\s*\/\s*plin)\s+o\s+(?:transferencia|bcp)\s*\?/i;
// 3) El bot no es una persona ni promete personas que no van a aparecer.
// (la `u` y el lookahead por letra: con `\b` ASCII, «asesoría médica» contaba como «asesor»)
const RE_PERSONA =
  /(?<![\p{L}])asesor(?:a|\(a\)|es|as)?(?![\p{L}])|te\s+(?:va|van)\s+a\s+(?:llamar|escribir|contactar)|(?:un|una)\s+persona\s+(?:real|del\s+equipo)\s+te|no\s+soy\s+(?:un\s+)?(?:bot|robot)|soy\s+(?:una\s+)?persona\b/iu;
// Números de cuenta o de Yape escritos en la ficha (van en IA → Validador de comprobantes).
const RE_NUMERO_CUENTA = /(?<!\d)(?:9\d{2}[\s.-]?\d{3}[\s.-]?\d{3}|\d{10,20})(?!\d)/;
// 2) Montos escritos: «S/ 7», «S/7», «7 soles», «$ 5».
const RE_MONTO = /(?:S\/\.?|US\$|\$)\s?(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*soles\b/gi;
// 4) Temas que suelen quedar escritos en dos sitios con órdenes distintas.
const TEMAS = [
  ["«Lo pensaré»", /\blo\s+pens(?:ar[eé]|ar[aá]|amos)|\blo\s+pienso|d[eé]jame\s+pensarlo|luego\s+compro/i],
  ["«Está caro»", /\bcaro\b|no\s+tengo\s+(?:plata|dinero)|no\s+me\s+alcanza/i],
  ["«¿Es estafa?»", /estafa|confiable|\bseguro\s+(?:pagar|comprar)/i],
  ["«¿Me lo pasas gratis?»", /\bgratis\b|muestra\s+gratis|\bmuestra\b/i],
];

const ETIQUETAS = {
  resumen: "Información resumida", detalle: "Descripción / detalle", reglas_producto: "Reglas del producto",
  limites: "Límites", reglas_precio: "Reglas del precio", descuentos: "Precios con descuento",
  proceso: "Proceso de venta", tecnicas: "Técnicas de venta", objeciones: "Objeciones",
  ejemplos: "Ejemplos de respuesta", faq: "Preguntas frecuentes", saludo: "Mensajes iniciales",
  transferir: "Cuándo transferir a una persona", tono_detalle: "Tono", no_hacer: "Nunca hacer",
  politicas: "Políticas", extra: "Instrucciones extra", pagos: "Cómo se paga", entrega: "Envíos y entrega",
};
const et = (k) => ETIQUETAS[k] || k;
const lista = (ks) => ks.map((k) => `«${et(k)}»`).join(", ");

function avisoCobro(campos) {
  const en = Object.keys(campos).filter((k) => RE_PIDE_COBRAR.test(campos[k]));
  return en.length ? [{
    campo: en[0], titulo: "Le pides al bot que pregunte o pase los datos de pago",
    detalle: `En ${lista(en)}. Nodo le manda solo al cliente el número, el titular y el monto apenas quiere pagar. ` +
      `Si además el bot pregunta «¿Yape o BCP?» o pasa el número, al cliente le llega todo repetido. ` +
      `Escríbelo así: «confírmalo y pídele la captura del pago».`,
  }] : [];
}
function avisoNumeros(campos) {
  const en = Object.keys(campos).filter((k) => RE_NUMERO_CUENTA.test(campos[k]));
  return en.length ? [{
    campo: en[0], titulo: "Hay un número de cuenta o de Yape escrito en el texto",
    detalle: `En ${lista(en)}. Los números de cobro van en IA → Validador de comprobantes: de ahí los manda el sistema ` +
      `bien armados (para copiar de un toque) y de ahí se valida el pago. Escritos acá, el bot los pega en medio de una frase.`,
  }] : [];
}
function avisoPersona(campos) {
  const en = Object.keys(campos).filter((k) => RE_PERSONA.test(campos[k]));
  return en.length ? [{
    campo: en[0], titulo: "El texto habla de un «asesor» o de una persona que va a escribir",
    detalle: `En ${lista(en)}. El bot es un asistente: no puede decir que es una persona ni prometer que «un asesor te ` +
      `contactará» (el cliente se queda esperando). Para reclamos basta con «discúlpate y dile que ya lo estás revisando»: ` +
      `Nodo le avisa a tu equipo solo.`,
  }] : [];
}
function avisoMontos(campos, precios) {
  const ok = new Set((precios ?? []).map((p) => Number(p)).filter((p) => p > 0));
  const hall = [];
  for (const k of Object.keys(campos)) {
    const vistos = [];
    for (const m of String(campos[k] ?? "").matchAll(RE_MONTO)) {
      const n = Number(String(m[1] ?? m[2]).replace(",", "."));
      if (n > 0 && !ok.has(n) && !vistos.includes(n)) vistos.push(n);
    }
    if (vistos.length) hall.push([k, vistos]);
  }
  if (!hall.length) return [];
  const cifras = [...new Set(hall.flatMap(([, v]) => v))].slice(0, 6).map((n) => `S/ ${n}`).join(", ");
  return [{
    campo: hall[0][0], titulo: `Escribiste montos que no son el precio de venta (${cifras})`,
    detalle: `En ${lista(hall.map(([k]) => k))}. El bot repite las cifras que lee: tarde o temprano ofrece ese monto ` +
      `a quien no le toca. Las ofertas ya las maneja Remarketing (con su precio real) y los packs, Presentaciones y precios. ` +
      `Escribe la regla sin la cifra: «si pide un precio menor, mantén el precio con amabilidad».`,
  }];
}
function avisoTemasRepetidos(reglasDeVenta, objeciones) {
  const rv = String(reglasDeVenta ?? ""), ob = String(objeciones ?? "");
  if (!rv.trim() || !ob.trim()) return [];
  const temas = TEMAS.filter(([, re]) => re.test(rv) && re.test(ob)).map(([n]) => n);
  return temas.length ? [{
    campo: "tecnicas", titulo: `${temas.join(" y ")} está${temas.length > 1 ? "n" : ""} en dos sitios`,
    detalle: `Aparece${temas.length > 1 ? "n" : ""} en «Proceso / Técnicas de venta» y también en «Objeciones». Si las dos ` +
      `dicen cosas distintas, el bot no sabe cuál seguir. Deja la respuesta solo en Objeciones.`,
  }] : [];
}
function avisoEmojis(permitidos, prohibidos, saludo) {
  const proh = emojisDe(prohibidos);
  if (!proh.length) return [];
  const out = [];
  const enLista = emojisDe(permitidos).filter((e) => proh.includes(e));
  if (enLista.length) out.push({
    campo: "emojis", titulo: `${enLista.join(" ")} está en permitidos y en prohibidos a la vez`,
    detalle: "El bot recibe las dos órdenes. Sácalo de una de las dos listas.",
  });
  const enSaludo = emojisDe(saludo).filter((e) => proh.includes(e));
  if (enSaludo.length) out.push({
    campo: "saludo", titulo: `Tu bienvenida usa ${enSaludo.join(" ")}, que está en tus emojis prohibidos`,
    detalle: "La bienvenida sale tal cual la escribiste. Cámbialo por uno de tus emojis permitidos.",
  });
  return out;
}
// La bienvenida se manda TAL CUAL: signos de apertura que faltan y exclamaciones sin cerrar.
function avisoOrtografiaSaludo(saludo) {
  const frases = String(saludo ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const sinApertura = frases.filter((l) => /\?/.test(l) && !/¿/.test(l)).map((l) => l.replace(RE_EMOJI, "").trim()).filter(Boolean);
  const sinCierre = frases.filter((l) => /¡/.test(l) && !/!/.test(l)).map((l) => l.replace(RE_EMOJI, "").trim()).filter(Boolean);
  const ej = [...sinApertura, ...sinCierre].slice(0, 3).map((l) => `«${l.length > 70 ? l.slice(0, 70) + "…" : l}»`);
  return ej.length ? [{
    campo: "saludo", titulo: "A la bienvenida le faltan signos ¿ ? o ¡ !",
    detalle: `La bienvenida sale tal cual al cliente: ${ej.join(" · ")}.`,
  }] : [];
}

// Textos sueltos de la ficha (lo que el motor lee del producto).
export function revisarFicha({ ia = {}, faq = [], emojis = "", precios = [], saludo = "" } = {}) {
  const ejemplos = (ia.ejemplos ?? []).map((e) => `${e?.sit ?? ""} ${e?.resp ?? ""}`).join("\n");
  const faqTxt = (faq ?? []).map((q) => `${q?.q ?? q?.p ?? ""} ${q?.a ?? q?.r ?? ""}`).join("\n");
  const campos = {
    resumen: ia.resumen, detalle: ia.detalle, reglas_producto: ia.reglas_producto, limites: ia.limites,
    reglas_precio: ia.reglas_precio, descuentos: ia.descuentos, proceso: ia.proceso, tecnicas: ia.tecnicas,
    objeciones: ia.objeciones, ejemplos, faq: faqTxt,
  };
  for (const k of Object.keys(campos)) if (!String(campos[k] ?? "").trim()) delete campos[k];
  const conSaludo = String(saludo ?? "").trim() ? { ...campos, saludo } : campos;
  return [
    ...avisoCobro(conSaludo),
    ...avisoNumeros(campos),            // (el método de pago especial del producto sí lleva su número: no se mira)
    ...avisoPersona(conSaludo),
    ...avisoMontos(conSaludo, precios),
    ...avisoTemasRepetidos(`${ia.proceso ?? ""}\n${ia.tecnicas ?? ""}`, ia.objeciones),
    ...avisoEmojis(emojis, ia.emojis_prohibidos, saludo),
    ...avisoOrtografiaSaludo(saludo),
  ];
}

// La sección Negocio (instrucciones generales del vendedor).
export function revisarNegocio(form = {}) {
  const campos = {};
  for (const k of ["tono_detalle", "transferir", "no_hacer", "politicas", "extra", "pagos", "entrega"]) {
    if (String(form[k] ?? "").trim()) campos[k] = String(form[k]);
  }
  const { pagos: _p, ...sinPagos } = campos;   // en «Cómo se paga» nombrar Yape/BCP es justo lo que corresponde
  return [...avisoCobro(sinPagos), ...avisoNumeros(campos), ...avisoPersona(campos)];
}

// El cuerpo del diálogo: un aviso por renglón, con su porqué.
export function avisosHtml(avisos, esc) {
  const e = esc || ((s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]));
  return `Encontré ${avisos.length === 1 ? "algo" : avisos.length + " cosas"} que suele hacer que el bot se equivoque. ` +
    `Puedes guardar igual, pero conviene corregirl${avisos.length === 1 ? "o" : "as"}:` +
    avisos.map((a) => `<span style="display:block;margin-top:12px;padding:10px 12px;border:1px solid var(--border);` +
      `border-radius:10px;text-align:left"><b>${e(a.titulo)}</b><br><span style="color:var(--muted);font-size:12.5px;` +
      `line-height:1.5">${e(a.detalle)}</span></span>`).join("");
}
