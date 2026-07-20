// ═══════════════════════════════════════════════════════════════════
// Nodo · avisos.ts — Los avisos que el bot te manda por Telegram.
//
// FUENTE ÚNICA: el catálogo vive acá y el panel lo pide por
// channel-config (action:"avisos_catalogo"). Si el panel tuviera su
// propia copia, las dos listas se separarían al primer cambio.
//
// Cada aviso se puede APAGAR y REESCRIBIR desde el panel; lo elegido se
// guarda en `channels.telegram_avisos`. El texto se escribe como en el
// compositor de WhatsApp —*negrita*, _cursiva_ y {{variables}}— para no
// obligar a nadie a saber HTML.
// ═══════════════════════════════════════════════════════════════════

export type AvisoDef = {
  clave: string;
  grupo: "ventas" | "pagos" | "atencion";
  titulo: string;      // cómo se llama en el panel
  desc: string;        // cuándo se dispara, en cristiano
  vars: string[];      // variables disponibles para ESTE aviso
  texto: string;       // el texto por defecto
};

// El estilo de la casa: título con emoji, línea por dato, y un emoji por
// campo para que el ojo encuentre el dato sin leer las etiquetas.
export const AVISOS: AvisoDef[] = [
  // ── Ventas y pedidos ─────────────────────────────────────────────
  {
    clave: "venta_digital", grupo: "ventas",
    titulo: "Venta digital confirmada",
    desc: "Cuando alguien paga un producto digital y el bot ya le entregó el acceso.",
    vars: ["cliente", "telefono", "producto", "opcion", "monto", "pago_metodo", "origen"],
    texto:
      "💰 *VENTA CONFIRMADA*\n" +
      "\n" +
      "🛍 {{producto}}\n" +
      "📦 {{opcion}}\n" +
      "💵 *S/ {{monto}}* · {{pago_metodo}}\n" +
      "\n" +
      "👤 {{cliente}}\n" +
      "📱 {{telefono}}\n" +
      "📣 Vino de: {{origen}}",
  },
  {
    clave: "pedido_lima", grupo: "ventas",
    titulo: "Pedido nuevo · Lima",
    desc: "Pedido físico en Lima, contraentrega. Es el que le pasas al motorizado.",
    vars: ["cliente", "telefono", "producto", "opcion", "total_cobrar", "zona_nombre", "direccion", "referencia", "entrega_hoy"],
    texto:
      "🛵 *PEDIDO NUEVO · LIMA*\n" +
      "\n" +
      "🛍 {{producto}} — {{opcion}}\n" +
      "💵 *A COBRAR: S/ {{total_cobrar}}* (contraentrega)\n" +
      "\n" +
      "👤 {{cliente}}\n" +
      "📱 {{telefono}}\n" +
      "📍 {{direccion}}, {{zona_nombre}}\n" +
      "🔎 Ref: {{referencia}}\n" +
      "🕒 Entrega hoy: {{entrega_hoy}}",
  },
  {
    clave: "pedido_provincia", grupo: "ventas",
    titulo: "Pedido nuevo · Provincia",
    desc: "Pedido físico a provincia. Todavía no está confirmado: falta que pague el adelanto.",
    vars: ["cliente", "telefono", "producto", "opcion", "total_cobrar", "adelanto", "saldo", "ciudad", "sede", "dni"],
    texto:
      "📦 *PEDIDO NUEVO · PROVINCIA*\n" +
      "\n" +
      "🛍 {{producto}} — {{opcion}}\n" +
      "💵 Total: *S/ {{total_cobrar}}*\n" +
      "⏳ Esperando adelanto de *S/ {{adelanto}}*\n" +
      "\n" +
      "👤 {{cliente}}\n" +
      "🪪 DNI {{dni}}\n" +
      "📱 {{telefono}}\n" +
      "🚌 Agencia: {{ciudad}} · {{sede}}",
  },
  {
    clave: "venta_extra", grupo: "ventas",
    titulo: "Venta extra",
    desc: "Cuando el cliente suma un producto adicional al que ya estaba comprando.",
    vars: ["cliente", "telefono", "extra", "monto"],
    texto:
      "🎁 *VENTA EXTRA*\n" +
      "\n" +
      "🛍 {{extra}}\n" +
      "💵 *S/ {{monto}}*\n" +
      "\n" +
      "👤 {{cliente}}\n" +
      "📱 {{telefono}}",
  },

  // ── Pagos por validar ────────────────────────────────────────────
  {
    clave: "adelanto_validar", grupo: "pagos",
    titulo: "Adelanto por validar",
    desc: "Llegó el comprobante del adelanto y hay que aprobarlo. Trae el botón para aprobar desde acá.",
    vars: ["cliente", "telefono", "monto_leido", "monto_esperado", "motivo", "operacion"],
    texto:
      "💰 *ADELANTO POR VALIDAR*\n" +
      "\n" +
      "👤 {{cliente}}\n" +
      "💵 Mandó: *S/ {{monto_leido}}* · esperado: S/ {{monto_esperado}}\n" +
      "🧾 Operación: {{operacion}}\n" +
      "⚠️ {{motivo}}",
  },
  {
    clave: "adelanto_auto", grupo: "pagos",
    titulo: "Adelanto aprobado solo",
    desc: "El bot validó el adelanto sin consultarte. Es solo para que estés al tanto — apágalo si te llena el chat.",
    vars: ["cliente", "monto", "operacion"],
    texto:
      "✅ *Adelanto validado*\n" +
      "👤 {{cliente}} · 💵 S/ {{monto}} · 🧾 {{operacion}}\n" +
      "_Lo aprobó el bot. Ya le avisó al cliente._",
  },
  {
    clave: "saldo_validar", grupo: "pagos",
    titulo: "Saldo por revisar",
    desc: "Pagó el saldo para recoger en agencia. Al aprobar, el bot le suelta la clave de recojo.",
    vars: ["cliente", "telefono", "monto_leido", "monto_esperado", "motivo", "operacion", "clave_recojo"],
    texto:
      "🕵️ *SALDO POR REVISAR*\n" +
      "\n" +
      "👤 {{cliente}}\n" +
      "💵 Mandó: *S/ {{monto_leido}}* · esperado: S/ {{monto_esperado}}\n" +
      "🧾 Operación: {{operacion}}\n" +
      "⚠️ {{motivo}}\n" +
      "\n" +
      "🔑 Al aprobar, el bot le manda la clave de recojo.",
  },
  {
    clave: "saldo_auto", grupo: "pagos",
    titulo: "Saldo aprobado solo",
    desc: "El bot validó el saldo y ya mandó la clave de recojo. Informativo.",
    vars: ["cliente", "monto", "operacion"],
    texto:
      "✅ *Saldo validado · clave enviada*\n" +
      "👤 {{cliente}} · 💵 S/ {{monto}} · 🧾 {{operacion}}\n" +
      "_Lo aprobó el bot y ya le pasó la clave de recojo._",
  },
  {
    clave: "pago_digital_validar", grupo: "pagos",
    titulo: "Pago digital por validar",
    desc: "Producto digital con validación manual: el cliente pagó y espera. Hasta que apruebes, no recibe nada.",
    vars: ["cliente", "telefono", "producto", "monto", "operacion"],
    texto:
      "💳 *PAGO DIGITAL POR VALIDAR*\n" +
      "\n" +
      "🛍 {{producto}}\n" +
      "💵 *S/ {{monto}}* · 🧾 {{operacion}}\n" +
      "\n" +
      "👤 {{cliente}}\n" +
      "📱 {{telefono}}\n" +
      "\n" +
      "⏳ El cliente está esperando su acceso.",
  },
  {
    clave: "pago_extra_validar", grupo: "pagos",
    titulo: "Pago de venta extra por validar",
    desc: "Pagó un producto adicional y hay que aprobarlo para que se lo entreguen.",
    vars: ["cliente", "telefono", "extra", "monto"],
    texto:
      "🎁 *PAGO DE VENTA EXTRA*\n" +
      "\n" +
      "🛍 {{extra}}\n" +
      "💵 *S/ {{monto}}*\n" +
      "\n" +
      "👤 {{cliente}}\n" +
      "⏳ Espera que lo apruebes para recibirlo.",
  },
  {
    clave: "pago_de_mas", grupo: "pagos",
    titulo: "Pagó de más",
    desc: "El cliente pagó más de lo que costaba. Decides si le devuelves o le queda a favor.",
    vars: ["cliente", "telefono", "monto", "vuelto"],
    texto:
      "💸 *PAGÓ DE MÁS*\n" +
      "\n" +
      "👤 {{cliente}}\n" +
      "💵 Pagó S/ {{monto}} — *le sobran S/ {{vuelto}}*\n" +
      "\n" +
      "🤔 Decide si se lo devuelves o le queda a favor.",
  },
  {
    clave: "reclama_vuelto", grupo: "pagos",
    titulo: "Reclama su vuelto",
    desc: "El cliente escribió reclamando la plata que pagó de más. El bot ya le dijo que lo estás viendo.",
    vars: ["cliente", "telefono", "vuelto"],
    texto:
      "💸 *RECLAMA SU VUELTO*\n" +
      "\n" +
      "👤 {{cliente}}\n" +
      "📱 {{telefono}}\n" +
      "💵 A favor: *S/ {{vuelto}}*\n" +
      "\n" +
      "🙏 Hazle la devolución y mándale la captura. El bot lo sigue atendiendo.",
  },

  {
    clave: "entrega_fallida", grupo: "pagos",
    titulo: "No se pudo entregar algo ya pagado",
    desc: "El cliente pagó pero el envío del acceso falló (se cayó WhatsApp, venció el token…). Hay que mandárselo a mano. Este no conviene apagarlo.",
    vars: ["cliente", "telefono", "producto"],
    texto:
      "⚠️ *NO SE PUDO ENTREGAR*\n" +
      "\n" +
      "🛍 {{producto}}\n" +
      "\n" +
      "👤 {{cliente}}\n" +
      "📱 {{telefono}}\n" +
      "\n" +
      "💸 Ya te pagó y NO lo recibió. Mándaselo tú por el chat.",
  },

  {
    clave: "envio_fallido", grupo: "atencion",
    titulo: "WhatsApp rechazó un mensaje",
    desc: "El bot quiso escribirle a un cliente y WhatsApp no lo dejó. La causa típica: pasaron más de 24 h desde que el cliente escribió, y para eso hace falta una plantilla aprobada. El cliente NO recibió nada.",
    vars: ["cliente", "telefono", "motivo"],
    texto:
      "📵 *WHATSAPP RECHAZÓ UN MENSAJE*\n" +
      "\n" +
      "👤 {{cliente}}\n" +
      "📱 {{telefono}}\n" +
      "⚠️ {{motivo}}\n" +
      "\n" +
      "❗ El cliente *no recibió* ese mensaje. Escríbele tú.",
  },

  // ── Atención ─────────────────────────────────────────────────────
  {
    clave: "pide_humano", grupo: "atencion",
    titulo: "Te necesita a ti",
    desc: "El cliente pidió hablar con una persona, o el bot detectó un reclamo. El bot queda en pausa en ese chat.",
    vars: ["cliente", "telefono", "motivo", "horario"],
    texto:
      "🙋 *TE NECESITAN*\n" +
      "\n" +
      "👤 {{cliente}}\n" +
      "📱 {{telefono}}\n" +
      "💬 {{motivo}}\n" +
      "\n" +
      "⏸ El bot quedó en pausa en esa conversación.{{horario}}",
  },
  {
    clave: "transferido", grupo: "atencion",
    titulo: "Transferido a una persona",
    desc: "Cuando un flujo transfiere la conversación a mano (acción \"Transferir a humano\").",
    vars: ["cliente", "telefono", "motivo"],
    texto:
      "🤝 *CONVERSACIÓN TRANSFERIDA*\n" +
      "\n" +
      "👤 {{cliente}}\n" +
      "📱 {{telefono}}\n" +
      "💬 {{motivo}}",
  },
];

export const AVISO_POR_CLAVE = new Map(AVISOS.map((a) => [a.clave, a]));

// ── Render ─────────────────────────────────────────────────────────
// Telegram con parse_mode HTML tumba el mensaje ENTERO si el HTML está mal
// formado. Por eso el orden importa: primero se convierte el marcado de la
// PLANTILLA (que la escribimos/edita el operador), y recién después se meten
// los valores ya escapados. Al revés, un cliente llamado "Ana & <Co>" —o con un
// asterisco en el nombre— reventaría el aviso.
const escaparHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function marcadoAHtml(t: string): string {
  return escaparHtml(t)
    .replace(/\*([^*\n]+)\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, "$1<i>$2</i>");
}

// Renderiza un aviso.
//
// Campos sin dato: si en una línea NINGUNA variable trajo valor, la línea entera
// se borra — un aviso lleno de "🔎 Ref: —" es ruido. Pero si la línea tiene algo
// que sí llegó ("mandó S/ 50 · esperado S/ —"), se conserva y el hueco va como
// "—": ahí el dato que falta ES la información.
export function renderAviso(plantilla: string, datos: Record<string, unknown>): string {
  // Centinela imposible de teclear: marca "acá no había dato" sin chocar con
  // ningún texto real. Se construye en código para no dejar un byte nulo suelto
  // en el fuente (git lo tomaría como binario).
  const HUECO = String.fromCharCode(0);
  const lineas = marcadoAHtml(plantilla).split("\n").map((linea) => {
    let conValor = 0, total = 0;
    const out = linea.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m: string, k: string) => {
      total++;
      const v = datos[k];
      if (v === null || v === undefined || String(v).trim() === "") return HUECO;
      conValor++;
      return escaparHtml(String(v));
    });
    if (total > 0 && conValor === 0) return null;   // línea entera sin datos → fuera
    return out.split(HUECO).join("—");
  });
  return lineas
    .filter((l) => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")   // sin huecos donde se borraron líneas
    .trim();
}

// Config guardada del canal → ¿está encendido? ¿con qué texto?
export type AvisosConfig = { items?: Record<string, { on?: boolean; texto?: string }>; hora?: boolean };

export function avisoActivo(cfg: AvisosConfig | null | undefined, clave: string): boolean {
  return cfg?.items?.[clave]?.on !== false; // por defecto, todos encendidos
}

export function textoDeAviso(cfg: AvisosConfig | null | undefined, clave: string): string {
  const propio = cfg?.items?.[clave]?.texto;
  if (typeof propio === "string" && propio.trim()) return propio;
  return AVISO_POR_CLAVE.get(clave)?.texto ?? "";
}
