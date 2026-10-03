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
    p("gatos", "surco", "es efectivo con gatos?", "Mascotas: la ficha dice no usar con animales domésticos cerca"),
    p("perros", "arequipa", "funciona con perros? tengo 2 en la casa", "Mascotas: la ficha dice no usar con animales domésticos cerca"),
    p("palomas", "comas", "ahuyenta palomas?", "La ficha habla de aves"),
    p("ratas", "ica", "sirve para ratas? tengo muchas en el almacen", "La ficha habla de roedores; turno de sedes en provincia"),
    p("lluvia", "piura", "y si llueve se malogra?", "Clima: la ficha dice uso exterior en diferentes climas con luz solar"),
    p("noche", "los olivos", "funciona de noche?", "La ficha no dice si funciona de noche"),
    p("metros", "cusco", "cuantos metros cubre?", "La ficha solo dice «área moderada»"),
    p("ninos", "surco", "es peligroso para mis hijos?", "La ficha no habla de personas ni niños"),
    p("garantia", "trujillo", "tiene garantia?", "Garantía: la ficha no da plazo"),
    p("bateria", "ate", "cuanto dura la bateria?", "La ficha dice que no necesita baterías extra"),
    p("adentro", "chiclayo", "lo puedo usar dentro de la casa?", "La ficha dice no usar en interiores"),
    p("ruido", "miraflores", "hace ruido? me va a molestar a mi?", "La ficha no habla del sonido para personas"),
    p("original", "huancayo", "es original?", "La ficha dice que es original"),
    p("mata", "san miguel", "mata a los animales?", "Ahuyenta, no mata"),
    p("instalar", "tacna", "es dificil de instalar?", "La ficha no detalla la instalación"),
    p("terreno", "puno", "tengo una chacra de 1 hectarea cuantos necesito?", "Área moderada: no prometer que 3 cubren 1 ha"),
    p("murcielagos", "la molina", "sirve para murcielagos?", "La ficha no los nombra"),
    p("agua", "callao", "es resistente al agua?", "La ficha no dice «resistente al agua»"),
    p("serpientes", "pucallpa", "sirve contra serpientes?", "La ficha no las nombra"),
    p("sifunciona", "chorrillos", "pero de verdad funciona? he visto que algunos no sirven", "Desconfianza: contestar sin prometer de más"),

    // ── El chat real de Rodrigo (2-oct) ──────────────────────────────
    {
      id: "rodrigo", titulo: "Chat real de Probar flujos (2-oct)", foco: "Duración, garantía, roto, envío y pago SIN decir la zona; recién al final Arequipa",
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
    { id: "cierre-lima", titulo: "Venta completa en Lima", foco: "Confirmar el pedido con los datos, contraentrega",
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
    { id: "lima-sin-distrito", titulo: "Lima a secas y pregunta cuándo llega", foco: "Pedir el distrito antes de prometer el día",
      turnos: [H, "soy de lima", "cuando llega?"] },
    { id: "precio-directo", titulo: "Pide el precio de entrada", foco: "Dar los precios y seguir",
      turnos: [H, "precio?"] },
    { id: "varias-preguntas", titulo: "Tres preguntas en un mensaje", foco: "Contestar las tres (original, garantía, demora a Tacna)",
      turnos: [H, "es original y tiene garantia? cuanto demora a tacna?"] },
  ],
};

export const BATERIAS: Record<string, Bateria> = { [BATERIA_ECOGUARD.id]: BATERIA_ECOGUARD };
