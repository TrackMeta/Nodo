// Catálogo curado de plantillas RECOMENDADAS — se muestra en la sección
// "Recomendadas" de Plantillas para TODA cuenta (no se siembra en la BD; vive
// acá y llega a todos por defecto). El usuario la usa y la envía a aprobar a
// Meta con un clic. Se cura en un solo lugar: mejorar acá mejora para todos.
//   · params   = mapeo POSICIONAL a variables de Nodo ({{1}}→{{nombre}}…), lo que
//                el motor rellena al enviar.
//   · ejemplos = valores de muestra que Meta exige al aprobar (body_text example).
//   · categoria= UTILITY (transaccional, aprueba fácil) | MARKETING (promos).
export const CATALOGO = [
  // ── Físico · Provincia (Utility) ──
  {
    folder: "Recomendadas · Provincia", categoria: "UTILITY", name: "recordatorio_adelanto", language: "es",
    titulo: "Recordatorio de adelanto",
    body: "¡Hola {{1}}! 👋 Tu pedido de {{2}} sigue apartado a tu nombre. Para prepararlo y despacharlo solo falta tu adelanto de {{3}}. Escríbenos por aquí y te ayudamos a completarlo. 😊",
    params: ["{{nombre}}", "{{producto_nombre}}", "{{adelanto}}"],
    ejemplos: ["María", "Zapatillas Runner", "S/ 20"],
  },
  {
    folder: "Recomendadas · Provincia", categoria: "UTILITY", name: "pedido_en_agencia", language: "es",
    titulo: "Llegó a la agencia (cobrar saldo)",
    body: "¡Buenas noticias, {{1}}! 🎉 Tu pedido de {{2}} ya llegó a la agencia {{3}} 📦. Para entregártelo, realiza el pago del saldo de {{4}} y te enviamos tu clave de recojo por aquí.",
    params: ["{{nombre}}", "{{producto_nombre}}", "{{pedido_sede}}", "{{pedido_saldo}}"],
    ejemplos: ["María", "Zapatillas Runner", "Shalom Arequipa", "S/ 89"],
  },
  {
    folder: "Recomendadas · Provincia", categoria: "UTILITY", name: "clave_recojo", language: "es",
    titulo: "Clave de recojo",
    body: "¡Pago confirmado, {{1}}! ✅ Tu clave de recojo es {{2}} 🔑. Preséntala junto a tu DNI en la agencia {{3}} para recoger tu pedido. ¡Gracias por tu compra! 🙌",
    params: ["{{nombre}}", "{{pedido_clave_recojo}}", "{{pedido_sede}}"],
    ejemplos: ["María", "RCJ-4821", "Shalom Arequipa"],
  },
  {
    folder: "Recomendadas · Provincia", categoria: "UTILITY", name: "pedido_despachado", language: "es",
    titulo: "Pedido despachado (guía)",
    body: "¡Hola {{1}}! Tu pedido de {{2}} ya fue despachado y va en camino 🚚. Número de guía: {{3}}. Te avisamos por aquí apenas llegue a la agencia. 📍",
    params: ["{{nombre}}", "{{producto_nombre}}", "{{pedido_guia}}"],
    ejemplos: ["María", "Zapatillas Runner", "00123456789"],
  },
  // ── Físico · Lima (Utility) ──
  {
    folder: "Recomendadas · Lima", categoria: "UTILITY", name: "pedido_confirmado_lima", language: "es",
    titulo: "Pedido confirmado (contraentrega)",
    body: "¡Listo, {{1}}! 🛵 Confirmamos tu pedido de {{2}} para entrega en {{3}}. Nuestro repartidor te contactará. Ten listo el pago de {{4}} (pagas al recibir). ¡Gracias! 🙌",
    params: ["{{nombre}}", "{{producto_nombre}}", "{{pedido_distrito}}", "{{total_cobrar}}"],
    ejemplos: ["Juan", "Zapatillas Runner", "Miraflores", "S/ 99"],
  },
  // ── Digital (Utility) ──
  {
    folder: "Recomendadas · Digital", categoria: "UTILITY", name: "entrega_digital", language: "es",
    titulo: "Entrega digital (acceso)",
    body: "¡Gracias por tu compra, {{1}}! 🎉 Aquí tienes el acceso a tu {{2}}: {{3}}. Cualquier duda, escríbenos por aquí y te ayudamos. 😊",
    params: ["{{nombre}}", "{{producto_nombre}}", "{{link_entrega}}"],
    ejemplos: ["Ana", "Curso de Steel Framing", "https://tusitio.com/acceso"],
  },
  // ── Reenganche (Marketing) ──
  {
    folder: "Recomendadas · Reenganche", categoria: "MARKETING", name: "interesado_seguimiento", language: "es",
    titulo: "Seguimiento a interesado",
    body: "¡Hola {{1}}! 👋 Vimos que te interesó {{2}} pero no llegamos a cerrar tu pedido. ¿Te quedó alguna duda? Estamos aquí para ayudarte a completarlo cuando quieras. 😊",
    params: ["{{nombre}}", "{{producto_nombre}}"],
    ejemplos: ["María", "Zapatillas Runner"],
  },
  {
    folder: "Recomendadas · Reenganche", categoria: "MARKETING", name: "promo_reactivacion", language: "es",
    titulo: "Promoción / reactivación",
    body: "¡Hola {{1}}! 🎉 Tenemos una promoción especial en {{2}}: {{3}}. Responde este mensaje y te damos todos los detalles. ✨",
    params: ["{{nombre}}", "{{producto_nombre}}", "{{oferta}}"],
    ejemplos: ["María", "Zapatillas Runner", "15% de descuento"],
  },
];
