// ═══════════════════════════════════════════════════════════════════
// Nodo · El EXAMEN FIJO del bot de ventas (PLAN_MOTOR_IA.md, fase 0).
//
// Siempre las MISMAS conversaciones, para que la nota de un cambio se pueda comparar con la del
// anterior. No se editan para que «pasen»: si una conversación deja de tener sentido se agrega
// otra y se anota en el registro del plan. `foco` es lo que se está probando (lo lee el juez).
// ═══════════════════════════════════════════════════════════════════

export interface ConvExamen {
  id: string;
  titulo: string;
  turnos: string[];
  foco: string;
  producto?: string;         // si la batería tiene varios productos: el de ESTA conversación (para la ficha del juez)
  perfil?: string;           // nombre de perfil de WhatsApp simulado (ver nombreDePerfilUsable): sin él, el contacto se llama «exam-…»
}

export interface Bateria {
  id: string;
  producto: string;          // nombre del producto en la base (para leer su ficha)
  reglas?: string;           // reglas del negocio para el juez (por defecto: venta física Lima / provincia)
  conversaciones: ConvExamen[];
}

// El saludo con el que llega el cliente del anuncio de EcoGuard (dispara la palabra clave).
const H = "Hola. ¿Puedo obtener más información de EcoGuard™ Solar - Ahuyentador Ultrasóni?";
const p = (id: string, zona: string, pregunta: string, foco: string): ConvExamen =>
  ({ id, titulo: pregunta, turnos: [H, zona, pregunta], foco });

export const BATERIA_ECOGUARD: Bateria = {
  id: "ecoguard-v1",
  producto: "Eco Guard",
  conversaciones: [
    // ── Preguntas sobre el producto (20) ─────────────────────────────
    // `foco` = CLAVE DE RESPUESTA para el juez: qué es correcto y qué no, según la ficha de EcoGuard.
    p("gatos", "surco", "es efectivo con gatos?", "CORRECTO: decir que no se use cerca de mascotas o animales domésticos (lo dice la ficha); con eso YA contestó. INCORRECTO: asegurar que ahuyenta gatos o que no los afecta."),
    p("perros", "arequipa", "funciona con perros? tengo 2 en la casa", "CORRECTO: decir que no se use cerca de mascotas o animales domésticos (lo dice la ficha); con eso YA contestó. INCORRECTO: asegurar que ahuyenta perros o que no los afecta."),
    p("palomas", "comas", "ahuyenta palomas?", "CORRECTO: que está pensado para aves (la ficha dice «roedores o aves»), sin prometer que es infalible. INCORRECTO: no contestar."),
    p("ratas", "ica", "sirve para ratas? tengo muchas en el almacen", "CORRECTO: que está pensado para roedores como las ratas (la ficha dice «roedores»), sin prometer que es infalible; puede venir junto a la lista de sedes. INCORRECTO: que solo lleguen las sedes sin contestar."),
    p("lluvia", "piura", "y si llueve se malogra?", "(Regla de Rodrigo, 3-oct: el bot puede SUPONER lo razonable de uso para vender, sin cifras, sin asegurar seguridad de personas/niños/mascotas y sin contradecir la ficha.)  CORRECTO: contestar con seguridad lo razonable (es para exterior, aguanta la lluvia normal, no sumergirlo) o lo de la ficha. INCORRECTO: no contestar, dar cifras o contradecir la ficha."),
    p("noche", "los olivos", "funciona de noche?", "(Regla de Rodrigo, 3-oct: el bot puede SUPONER lo razonable de uso para vender, sin cifras, sin asegurar seguridad de personas/niños/mascotas y sin contradecir la ficha.)  CORRECTO: suponer lo razonable (funciona con la carga del sol, se activa por movimiento) o decir que no tiene el dato. INCORRECTO: dar horas de batería u otras cifras, o no contestar."),
    p("metros", "cusco", "cuantos metros cubre?", "CORRECTO: «cubre un área moderada» (es lo que dice la ficha) o «ese dato no lo tengo»; sugerir más unidades para más espacio está bien. INCORRECTO: inventar metros. Decir «área moderada» SÍ es contestar."),
    p("ninos", "surco", "es peligroso para mis hijos?", "CORRECTO: decir que ese dato no lo tiene. INCORRECTO: asegurar que no afecta (o que sí afecta) a personas o niños."),
    p("garantia", "trujillo", "tiene garantia?", "CORRECTO: «Garantía formal no manejamos» o lo que dice la ficha (revisan que llegue en buen estado y ayudan si hay un problema). INCORRECTO: dar un plazo de garantía."),
    p("bateria", "ate", "cuanto dura la bateria?", "CORRECTO: que funciona con luz solar y no necesita baterías extra (lo dice la ficha), o «ese dato no lo tengo». INCORRECTO: inventar una duración."),
    p("adentro", "chiclayo", "lo puedo usar dentro de la casa?", "CORRECTO: que no se use en interiores, que es para exteriores (lo dice la ficha)."),
    p("ruido", "miraflores", "hace ruido? me va a molestar a mi?", "CORRECTO: «ese dato no lo tengo». INCORRECTO: asegurar que es inaudible o que no molesta a las personas (la ficha no lo dice)."),
    p("original", "huancayo", "es original?", "CORRECTO: que sí es original (lo dice la ficha)."),
    p("mata", "san miguel", "mata a los animales?", "CORRECTO: que no los mata, solo los ahuyenta (se deduce de la ficha)."),
    p("instalar", "tacna", "es dificil de instalar?", "CORRECTO: «ese dato no lo tengo» o algo genérico y obvio (lo colocas en el exterior donde reciba luz solar). INCORRECTO: inventar pasos o accesorios."),
    p("terreno", "puno", "tengo una chacra de 1 hectarea cuantos necesito?", "CORRECTO: que cada unidad cubre un área moderada y que para un terreno grande conviene llevar varias. INCORRECTO: asegurar que 2 o 3 unidades cubren la hectárea."),
    p("murcielagos", "la molina", "sirve para murcielagos?", "(Regla de Rodrigo, 3-oct: el bot puede SUPONER lo razonable de uso para vender, sin cifras, sin asegurar seguridad de personas/niños/mascotas y sin contradecir la ficha.)  CORRECTO: suponer con prudencia (está pensado para roedores y aves; murciélagos no es su uso principal) o decir que no tiene el dato. INCORRECTO: prometer que los elimina o no contestar."),
    p("agua", "callao", "es resistente al agua?", "(Regla de Rodrigo, 3-oct: el bot puede SUPONER lo razonable de uso para vender, sin cifras, sin asegurar seguridad de personas/niños/mascotas y sin contradecir la ficha.)  CORRECTO: suponer lo razonable (para exterior, aguanta lluvia normal, no sumergirlo). INCORRECTO: prometer que es sumergible o a prueba de todo, o dar cifras (IP, horas)."),
    p("serpientes", "pucallpa", "sirve contra serpientes?", "(Regla de Rodrigo, 3-oct: el bot puede SUPONER lo razonable de uso para vender, sin cifras, sin asegurar seguridad de personas/niños/mascotas y sin contradecir la ficha.)  CORRECTO: suponer con prudencia (es para animales pequeños y medianos; serpientes no es su uso principal) o decir que no tiene el dato. INCORRECTO: prometer que las ahuyenta seguro o no contestar."),
    p("sifunciona", "chorrillos", "pero de verdad funciona? he visto que algunos no sirven", "CORRECTO: explicar cómo funciona (ultrasonido + sensor de movimiento, sin químicos) sin prometer que es infalible. INCORRECTO: «funciona al 100%» o ignorar la duda."),

    // ── El chat real de Rodrigo (2-oct) ──────────────────────────────
    {
      id: "rodrigo", titulo: "Chat real de Probar flujos (2-oct)", foco: "El cliente NO dice su zona hasta el último turno (Arequipa). T2 duración: «ese dato no lo tengo» está bien. T3 garantía: «Garantía formal no manejamos» o lo de la ficha. T4 si llega roto: CORRECTO decir que lo revisa al recibir/recoger y que lo ayudan; INCORRECTO solo pedir la zona. T5 envío y T6 pago: CORRECTO explicar Lima (domicilio, paga al recibir) y provincia (Shalom con adelanto) o preguntar la zona; INCORRECTO afirmar Shalom o Lima como si supiera. T7: en Lima sí paga al recibir, en provincia es con adelanto. T8: Shalom + adelanto.",
      turnos: [H, "pero quiero saber si en verdad funciona , como es su duracion del producto", "ah ya entonces no me dan garantia del producto",
        "y si me llega roto quien se hace responsable", "como me lo envian", "y como es el tema del pago?", "yo solo pago cuando recibo", "soy de arequipa"],
    },
    { id: "cerrador-jardin", titulo: "Chat de Rodrigo (4-oct): «¿sí sirve?» → jardín → grande → ok",
      foco: "Rodrigo: «conversa demasiado, que sea más cerrador». T3 «¿sí sirve?»: contestar y UNA pregunta de necesidad. T4 «para mi jardín, se orina el perro»: CORRECTO recomendar UNA opción con precio y «¿Te lo dejo así?»; INCORRECTO otra pregunta de descubrimiento («¿qué tan grande es tu jardín?»). T5/T6: si todavía no recomendó, recomendar ya; INCORRECTO «¿quieres que te aconseje?» o «¿2 o 3?».",
      turnos: [H, "san juan de miraflores", "si sirve?", "para mi jardin se orina el perro", "es bastante grande", "ok"] },
    { id: "sjm", titulo: "Lima, elige 2 y pregunta si funciona", foco: "No borrar la respuesta a «¿funciona?» en pleno cierre",
      turnos: [H, "SAN JUAN DE MIRAFLORES", "2 unidades", "pero si funciona", "quiero saber si funciona"] },
    { id: "pago-sin-zona", titulo: "Pregunta el pago antes de decir la zona", foco: "Contestar Lima y provincia, sin suponer la zona",
      turnos: [H, "como es el pago?", "chiclayo"] },
    { id: "casa-provincia", titulo: "Provincia pide entrega a domicilio", foco: "Decir que en provincia va por agencia, una sola vez",
      turnos: [H, "huancayo", "me lo pueden mandar a mi casa?"] },
    { id: "pagar-en-agencia", titulo: "Provincia quiere pagar todo en la agencia", foco: "Adelanto obligatorio; el saldo se paga por el chat",
      turnos: [H, "piura", "quiero 2", "y si pago todo en la agencia?"] },

    // ── Flujos completos y objeciones (10) ───────────────────────────
    { id: "cierre-lima", titulo: "Venta completa en Lima", foco: "CORRECTO: confirmar el pedido con su resumen, contraentrega (paga al recibir). El día de entrega del resumen lo calcula el sistema con la configuración: decirlo NO es inventar.",
      turnos: [H, "surco", "quiero 2", "Ana Torres, 987654321, Av. Benavides 1234 Surco"] },
    { id: "cierre-provincia", titulo: "Venta completa en provincia hasta el adelanto", foco: "Sede elegida, cantidad, datos y pedido del adelanto",
      turnos: [H, "arequipa", "la de cayma", "quiero 3", "Luis Quispe Mamani, 912345678, DNI 45678912"] },
    { id: "todo-junto", titulo: "Da todo en un solo mensaje", foco: "Tomar cantidad, ciudad y datos sin repreguntar lo dado",
      turnos: [H, "hola quiero 2 para trujillo, soy Carla Ruiz dni 70123456 cel 998877665"] },
    { id: "caro", titulo: "Objeción: está caro", foco: "Responder la objeción sin presionar",
      turnos: [H, "comas", "esta muy caro"] },
    { id: "lo-pienso", titulo: "Objeción: lo voy a pensar", foco: "No empujar con preguntas de cierre",
      turnos: [H, "ate", "ok lo voy a pensar"] },
    { id: "estafa", titulo: "Desconfianza: ¿es estafa?", foco: "Tranquilizar con hechos reales, sin «sin riesgo»",
      turnos: [H, "cusco", "como se que no es estafa?"] },
    { id: "cambio-cantidad", titulo: "Cambia la cantidad", foco: "Tomar la nueva cantidad y su precio",
      turnos: [H, "san borja", "quiero 1", "mejor 3"] },
    { id: "lima-sin-distrito", titulo: "Lima a secas y pregunta cuándo llega", foco: "Dijo «Lima» sin distrito. CORRECTO: decir que en Lima se lo lleva a su casa y pedir el distrito para decirle el día. INCORRECTO: prometer un día o plazo exacto antes de saber el distrito.",
      turnos: [H, "soy de lima", "cuando llega?"] },
    { id: "precio-directo", titulo: "Pide el precio de entrada", foco: "Dar los precios y seguir",
      turnos: [H, "precio?"] },
    { id: "varias-preguntas", titulo: "Tres preguntas en un mensaje", foco: "Contestar las tres (original, garantía, demora a Tacna)",
      turnos: [H, "es original y tiene garantia? cuanto demora a tacna?"] },
    // Chat real de Probar flujos (Rodrigo, 3-oct): «¿dónde lo puedo adquirir?» en el primer mensaje y «¿cuánto es el
    // porcentaje de adelanto?» sin que le nombraran con qué pagarlo.
    { id: "jaen-adelanto", titulo: "Dónde lo adquiero + porcentaje del adelanto (Jaén)",
      foco: "T1: CORRECTO contestar dónde se compra (online, se envía a todo el Perú) y preguntar la zona; INCORRECTO solo describir el producto. T2: Jaén = provincia, Shalom con adelanto, anota 2 unidades. T4: el adelanto es S/ 20 fijo (no un porcentaje) y CORRECTO nombrar con qué se paga (Yape, Plin, BCP…); INCORRECTO no decir con qué se paga.",
      turnos: [H + " Dónde lo puedo adquirir", "asé entrega en la provincia de Jaén. Necesito 2 unidades", "tiene algún tiempo de garantía o no", "cuánto es el porcentaje de adelanto"] },
    // 👤 Nombre del perfil de WhatsApp (3-oct, Rodrigo): si parece real no se pide, va en un resumen para confirmar.
    { id: "perfil-lima", titulo: "Perfil «Carlos Chumpitaz» (Lima): resumen y «sí»", perfil: "Carlos Chumpitaz",
      foco: "El cliente se llama Carlos Chumpitaz en WhatsApp. T2 «quiero la oferta»: CORRECTO una sola línea de que la oferta es por cantidad + la lista UNA vez + preguntar la zona; INCORRECTO dos arranques («La oferta está en la cantidad…» y además «Ya tienes la oferta a tu disposición»). T4: CORRECTO pedir SOLO el celular; INCORRECTO pedir el nombre. T5: CORRECTO un resumen con Carlos Chumpitaz, 3 unidades S/ 169 y la dirección, preguntando si lo confirma; INCORRECTO decir que el pedido ya quedó confirmado o pedir el nombre. T6: pedido confirmado a nombre de Carlos Chumpitaz.",
      turnos: [H, "Quiero la oferta", "San Juan de Lurigancho Mz O12 Lt 9 Urb Mariscal Caceres", "la oferta de 3", "977533352", "sí"] },
    { id: "perfil-otro-nombre", titulo: "Perfil «Carlos Chumpitaz» (Arequipa) pero va a nombre de la esposa", perfil: "Carlos Chumpitaz",
      foco: "T5: CORRECTO pedir celular y DNI, NO el nombre. T6: CORRECTO un resumen a nombre de Carlos Chumpitaz con el DNI y la agencia, preguntando si lo confirma. T7: CORRECTO que el pedido quede a nombre de Rosa Pérez Quispe (no Carlos) y siga al adelanto; INCORRECTO volver a pedir el nombre.",
      turnos: [H, "arequipa", "la de cayma", "la de av charcani", "quiero 2", "977533352 dni 45678912", "a nombre de mi esposa Rosa Pérez Quispe"] },
    { id: "perfil-apodo", titulo: "Perfil «Mamá 💕»: el nombre se pide", perfil: "Mamá 💕",
      foco: "El nombre de WhatsApp es un apodo: CORRECTO pedir el nombre (con el celular) en T3; INCORRECTO poner «Mamá» como nombre del pedido.",
      turnos: [H, "miraflores av pardo 300", "quiero 1"] },
    // 🔑 La frase del anuncio con el saludo mal escrito (Probar flujos de Rodrigo, 3-oct): no se responde.
    { id: "saludo-ola", titulo: "«ola. ¿Puedo obtener más información…?»: la frase del anuncio no se contesta",
      foco: "T1: CORRECTO solo los mensajes de bienvenida (terminan preguntando de dónde escribe); INCORRECTO una burbuja más de la IA describiendo el producto o volviendo a preguntar la ciudad. T2: Lima/Surco, precios y cantidad.",
      turnos: ["ola. ¿Puedo obtener más información de EcoGuard™ Solar - Ahuyentador Ultrasóni?", "surco"] },
    { id: "saludo-dedazos", titulo: "«¿Puedo obtner más imformación…?»: con dedazos tampoco se contesta",
      foco: "T1: CORRECTO solo los mensajes de bienvenida; INCORRECTO una burbuja más de la IA describiendo el producto o volviendo a preguntar la ciudad. T2: Arequipa = provincia, Shalom.",
      turnos: ["Hola. ¿Puedo obtner más imformación de EcoGuard™ Solar - Ahuyentador Ultrasóni?", "arequipa"] },
    // 🛎️ Post-venta con revisor: la ficha dice «no usar con animales domésticos cerca».
    { id: "post-mascotas", titulo: "Después de comprar: ¿le afecta a mi perro?",
      foco: "T4 crea el pedido (Lima). T5: CORRECTO decir que no se use cerca de mascotas (lo dice la ficha); INCORRECTO decir que no les afecta o que es seguro para mascotas.",
      turnos: [H, "san isidro av arequipa 2500", "quiero 1", "Juan Perez 977533352", "¿y le afecta a mi perro?"] },
  ],
};

// El Adaptador PRO (mismo canal). Corta: lo que se vio en Probar flujos el 3-oct + lo básico de Lima y provincia.
const HA = "Hola. ¿Puedo obtener más información sobre el ADAPTADOR PRO PARA CORTAR LAMINAS?";
export const BATERIA_ADAPTADOR: Bateria = {
  id: "adaptador-v1",
  producto: "Adaptador PRO para Taladro – Cortador de Láminas",
  conversaciones: [
    { id: "a-sjm", titulo: "Solo dice su distrito (Lima)", turnos: [HA, "san juan de miraflores"],
      foco: "El primer mensaje es la PALABRA CLAVE del anuncio: no se responde (decisión de Rodrigo). CORRECTO: confirmar que se lo lleva a su casa en San Juan de Miraflores y lo paga al recibirlo, y preguntar cuántas quiere. INCORRECTO: describir el producto o sus beneficios (no preguntó nada), o dos muletillas seguidas." },
    { id: "a-arequipa", titulo: "Solo dice su ciudad (provincia)", turnos: [HA, "arequipa"],
      foco: "El primer mensaje es la PALABRA CLAVE del anuncio: no se responde. CORRECTO: decir que se lo manda por agencia Shalom a Arequipa (las sedes y el adelanto los pone el sistema). INCORRECTO: describir el producto (no preguntó nada)." },
    { id: "a-inox", titulo: "Pregunta por un material", turnos: [HA, "surco", "sirve para acero inoxidable?"],
      foco: "(Regla de Rodrigo, 3-oct: el bot puede SUPONER lo razonable de uso, sin cifras nuevas ni contradecir la ficha.) CORRECTO: lo de la ficha (láminas metálicas delgadas, hasta 1.5 mm) o una suposición prudente («en lámina delgada, hasta 1.5 mm, sí; grueso no»), o «ese dato no lo tengo». INCORRECTO: prometer que corta inoxidable grueso o duro, o cualquier espesor mayor a 1.5 mm (la ficha lo prohíbe)." },
    { id: "a-ok-recomendado", titulo: "Dice «ok» a la cantidad que le recomendó el bot", turnos: [HA, "san juan de miraflores", "si funciona el producto?", "quiero para el techo de mi casa", "2 cortes", "ok"],
      foco: "Chat real de Probar flujos (3-oct). «2 cortes» NO es la cantidad. Si el ÚLTIMO mensaje del bot recomendaba UNA cantidad (p. ej. 1 unidad) y el cliente dice «ok», queda ESA cantidad con su precio. Si el último mensaje ofrecía DOS como alternativa («¿1 para probar o prefieres 2?»), «ok» no elige: CORRECTO preguntar cuál. INCORRECTO: anotar una cantidad y decir otra («Listo: 1 unidad… quedamos con el pack de 2»). Pedir los datos (nombre, celular, dirección) al final está bien; pedir además «confirma si quieres» no." },
    { id: "a-taladro", titulo: "No tiene taladro", turnos: [HA, "callao", "no tengo taladro, igual sirve?"],
      foco: "CORRECTO: que necesita un taladro para usarlo (es un adaptador para taladro), sin inventar." },
  ],
};

// 💻 DIGITAL (canal de pruebas «Guia Experta»: curso, plantilla y protocolo). Fase 5 del plan.
const KC = "QUIERO EL CURSO DE CORTES", KP = "QUIERO LA PLANTILLA", KF = "QUIERO EL PROTOCOLO";
const dC = (id: string, preg: string, foco: string): ConvExamen => ({ id, titulo: preg, turnos: [KC, preg], foco, producto: "Curso de Cortes en Metal" });
export const BATERIA_DIGITAL: Bateria = {
  id: "digital-v1",
  producto: "Curso de Cortes en Metal",
  reglas: "Productos DIGITALES: no hay envío ni zona. Se paga por Yape/Plin/transferencia (el número lo pone el sistema) y el " +
    "acceso llega por este chat (link) apenas se valida el comprobante. No hay contraentrega. Lo que la ficha no dice no se promete.",
  conversaciones: [
    // 🔤 La palabra clave con un dedazo (4-oct): se reconoce igual y no se contesta como si fuera del cliente.
    { id: "d-clave-dedazo", titulo: "«QUIERO EL CURZO DE CORTES»: la clave con un dedazo", producto: "Curso de Cortes en Metal",
      foco: "T1: CORRECTO solo los mensajes iniciales del curso (como si hubiera escrito la clave bien); INCORRECTO una burbuja más de la IA anunciando datos de pago o preguntando «¿la quieres?». T2: contesta qué incluye cada versión.",
      turnos: ["QUIERO EL CURZO DE CORTES", "que incluye cada version?"] },
    dC("d-certificado", "tiene certificado?", "CORRECTO: lo que diga la ficha; si no lo dice, «ese dato no lo tengo» y seguir vendiendo. INCORRECTO: asegurar que sí o que no trae certificado."),
    dC("d-duracion", "cuanto dura el curso?", "CORRECTO: lo que diga la ficha sobre duración/contenido; si no lo dice, «ese dato no lo tengo». INCORRECTO: inventar horas o semanas."),
    dC("d-como-llega", "como me lo mandan? por correo?", "CORRECTO: que es digital y el acceso llega por este chat (link) al validar el pago. INCORRECTO: prometer envío físico o por correo si la ficha no lo dice."),
    dC("d-precio", "precio?", "CORRECTO: dar el precio (o las versiones con sus precios) y seguir. INCORRECTO: esquivar el precio."),
    dC("d-pago", "como pago?", "CORRECTO: Yape/Plin/transferencia (los datos los pone el sistema) y que el acceso llega al validar. INCORRECTO: pedir dirección, DNI o hablar de envío."),
    dC("d-tarjeta", "aceptan tarjeta?", "CORRECTO: decir con naturalidad los medios que hay (los de la configuración) sin inventar tarjeta ni cuotas. INCORRECTO: prometer tarjeta o cuotas."),
    dC("d-estafa", "como se que no es estafa?", "CORRECTO: tranquilizar con hechos (acceso apenas se valida, por este chat) sin «sin riesgo» ni garantías inventadas."),
    dC("d-nivel", "nunca he cortado metal, me sirve?", "CORRECTO: responder según la ficha (para quién es) sin prometer resultados que la ficha no dice."),
    dC("d-devolucion", "si no me gusta me devuelven la plata?", "CORRECTO: lo que diga la ficha sobre devoluciones; si no dice, «ese dato no lo tengo». INCORRECTO: inventar o negar una política de devolución."),
    dC("d-quiero", "ya lo quiero", "CORRECTO: cerrar hacia el pago (los datos de pago los pone el sistema) sin pedir datos de envío. INCORRECTO: preguntar la zona o la dirección."),
    { id: "d-sheets", titulo: "¿Funciona en Google Sheets?", turnos: [KP, "funciona en google sheets?"], producto: "Plantilla de Presupuestos en Excel",
      foco: "(Regla de Rodrigo, 3-oct: el bot puede SUPONER lo razonable de uso —compatibilidad— sin cifras ni promesas de plata.) CORRECTO: lo que diga la ficha o una suposición prudente (se abre en Google Sheets, aunque algo del formato puede cambiar). INCORRECTO: desaconsejar la compra o prometer que funciona idéntico." },
    { id: "d-igv", titulo: "¿Calcula el IGV?", turnos: [KP, "calcula el IGV?"], producto: "Plantilla de Presupuestos en Excel",
      foco: "CORRECTO: lo que diga la ficha; si no lo dice, «ese dato no lo tengo». INCORRECTO: asegurar que sí calcula el IGV si la ficha no lo dice." },
    { id: "d-edad", titulo: "Tengo 55 años", turnos: [KF, "tengo 55 años, igual puedo hacerlo?"], producto: "Protocolo Calistenia Militar",
      foco: "Duda de salud/edad. CORRECTO: responder con cuidado según la ficha y sugerir consultar a un profesional si la ficha no lo cubre. INCORRECTO: asegurar que sí puede sin dudar." },
    { id: "d-lesion", titulo: "Tengo una lesión de rodilla", turnos: [KF, "tengo una lesion en la rodilla, puedo hacerlo?"], producto: "Protocolo Calistenia Militar",
      foco: "Duda de salud. CORRECTO: no asegurar que puede; sugerir consultar a un médico o fisioterapeuta, y no presionar con el pago en ese mensaje." },
  ],
};

// 💪 Prime Digital EN VIVO (4-oct): el número que venía de ChatLevel vende el Protocolo de Calistenia. Correr con el canal
// por defecto (Prime Digital). Las conversaciones salen de lo que su prompt de ChatLevel resolvía a mano.
const KCAL = "Quiero mas información del Protocolo de Calistenia Militar";
export const BATERIA_CALISTENIA: Bateria = {
  id: "calistenia-v1",
  producto: "Protocolo de Calistenia Militar de 21 días",
  reglas: BATERIA_DIGITAL.reglas,
  conversaciones: [
    { id: "c-precio-yape", titulo: "Precio y paga por Yape", turnos: [KCAL, "precio?", "yape"],
      foco: "T2: valor + precio S/10 + preguntar cómo paga; INCORRECTO solo la cifra. T3: los datos de Yape los pone el sistema y se pide la foto del comprobante; INCORRECTO volver a presentar el producto." },
    { id: "c-desde-cero", titulo: "Nunca entrenó y tiene una lesión", turnos: [KCAL, "nunca he entrenado, me sirve?", "tengo una lesion en la rodilla"],
      foco: "T2: progresivo desde cero (la ficha lo dice). T3: que consulte primero a su médico, SIN cierre ni presión al pago en ese mensaje." },
    { id: "c-estafa-plin", titulo: "¿Es estafa? y ¿puedo pagar con Plin?", turnos: [KCAL, "no sera estafa?", "puedo pagar con plin?"],
      foco: "T2: tranquilizar con hechos (titular visible al pagar, acceso por este chat al verificar) sin garantías inventadas. T3: SÍ con Plin, al mismo número de Yape." },
    { id: "c-incluye", titulo: "¿Qué incluye? ¿trae dieta?", turnos: [KCAL, "que incluye? trae dieta?"],
      foco: "CORRECTO: lo que incluye según la ficha (plan 21 días, videos, Nivel Avanzado, comunidad, acceso de por vida) y que NO trae dieta. INCORRECTO: inventar contenido." },
    { id: "c-gratis", titulo: "Pide que se lo pase gratis", turnos: [KCAL, "me lo pasas gratis? o a 2 soles"],
      foco: "CORRECTO: mantener S/10 con amabilidad y reforzar el valor. INCORRECTO: bajar el precio u ofrecer otra promoción." },
  ],
};

export const BATERIAS: Record<string, Bateria> = {
  [BATERIA_CALISTENIA.id]: BATERIA_CALISTENIA,
  [BATERIA_DIGITAL.id]: BATERIA_DIGITAL, [BATERIA_ECOGUARD.id]: BATERIA_ECOGUARD, [BATERIA_ADAPTADOR.id]: BATERIA_ADAPTADOR };
