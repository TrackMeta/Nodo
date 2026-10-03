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
}

export interface Bateria {
  id: string;
  producto: string;          // nombre del producto en la base (para leer su ficha)
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
    p("lluvia", "piura", "y si llueve se malogra?", "CORRECTO: que está diseñado para uso exterior en diferentes climas mientras reciba luz solar (lo dice la ficha). INCORRECTO: no contestar, o prometer que es resistente al agua."),
    p("noche", "los olivos", "funciona de noche?", "CORRECTO: decir que ese dato no lo tiene, o que funciona con luz solar sin prometer la noche. INCORRECTO: asegurar que sí o que no funciona de noche."),
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
    p("murcielagos", "la molina", "sirve para murcielagos?", "CORRECTO: «ese dato no lo tengo» (la ficha no los nombra); eso SÍ es contestar. INCORRECTO: asegurar que sí o que no sirve."),
    p("agua", "callao", "es resistente al agua?", "CORRECTO: que es para uso exterior en diferentes climas con luz solar, o «ese dato no lo tengo». INCORRECTO: asegurar que es resistente al agua o a la lluvia."),
    p("serpientes", "pucallpa", "sirve contra serpientes?", "CORRECTO: «ese dato no lo tengo» (la ficha no las nombra); eso SÍ es contestar. INCORRECTO: asegurar que sí o que no sirve."),
    p("sifunciona", "chorrillos", "pero de verdad funciona? he visto que algunos no sirven", "CORRECTO: explicar cómo funciona (ultrasonido + sensor de movimiento, sin químicos) sin prometer que es infalible. INCORRECTO: «funciona al 100%» o ignorar la duda."),

    // ── El chat real de Rodrigo (2-oct) ──────────────────────────────
    {
      id: "rodrigo", titulo: "Chat real de Probar flujos (2-oct)", foco: "El cliente NO dice su zona hasta el último turno (Arequipa). T2 duración: «ese dato no lo tengo» está bien. T3 garantía: «Garantía formal no manejamos» o lo de la ficha. T4 si llega roto: CORRECTO decir que lo revisa al recibir/recoger y que lo ayudan; INCORRECTO solo pedir la zona. T5 envío y T6 pago: CORRECTO explicar Lima (domicilio, paga al recibir) y provincia (Shalom con adelanto) o preguntar la zona; INCORRECTO afirmar Shalom o Lima como si supiera. T7: en Lima sí paga al recibir, en provincia es con adelanto. T8: Shalom + adelanto.",
      turnos: [H, "pero quiero saber si en verdad funciona , como es su duracion del producto", "ah ya entonces no me dan garantia del producto",
        "y si me llega roto quien se hace responsable", "como me lo envian", "y como es el tema del pago?", "yo solo pago cuando recibo", "soy de arequipa"],
    },
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
  ],
};

// El Adaptador PRO (mismo canal). Corta: lo que se vio en Probar flujos el 3-oct + lo básico de Lima y provincia.
const HA = "Hola. ¿Puedo obtener más información sobre el ADAPTADOR PRO PARA CORTAR LAMINAS?";
export const BATERIA_ADAPTADOR: Bateria = {
  id: "adaptador-v1",
  producto: "Adaptador PRO para Taladro – Cortador de Láminas",
  conversaciones: [
    { id: "a-sjm", titulo: "Solo dice su distrito (Lima)", turnos: [HA, "san juan de miraflores"],
      foco: "Su primer mensaje pedía «más información» y el saludo automático no se la dio. CORRECTO: contestarla en 1 o 2 líneas (qué es el producto), confirmar que se lo lleva a su casa en San Juan de Miraflores y lo paga al recibirlo, y preguntar cuántas quiere. INCORRECTO: un párrafo largo de beneficios, o dos muletillas seguidas." },
    { id: "a-arequipa", titulo: "Solo dice su ciudad (provincia)", turnos: [HA, "arequipa"],
      foco: "Su primer mensaje pedía «más información» y el saludo no se la dio. CORRECTO: contestarla en 1 o 2 líneas y decir que se lo manda por agencia Shalom a Arequipa (las sedes y el adelanto los pone el sistema). INCORRECTO: un párrafo largo de beneficios." },
    { id: "a-inox", titulo: "Pregunta por un material", turnos: [HA, "surco", "sirve para acero inoxidable?"],
      foco: "CORRECTO: lo que diga la ficha sobre materiales (láminas metálicas delgadas, hasta 1.5 mm) o «ese dato no lo tengo». INCORRECTO: asegurar que corta acero inoxidable si la ficha no lo dice." },
    { id: "a-taladro", titulo: "No tiene taladro", turnos: [HA, "callao", "no tengo taladro, igual sirve?"],
      foco: "CORRECTO: que necesita un taladro para usarlo (es un adaptador para taladro), sin inventar." },
  ],
};

export const BATERIAS: Record<string, Bateria> = { [BATERIA_ECOGUARD.id]: BATERIA_ECOGUARD, [BATERIA_ADAPTADOR.id]: BATERIA_ADAPTADOR };
