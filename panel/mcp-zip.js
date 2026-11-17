// 📦 Complemento de Nodo en .zip para Claude o ChatGPT (16-nov-2026, Rodrigo: «a ver que se pueda para ChatGPT y Claude»).
// Se arma EN EL NAVEGADOR para la cuenta de cada persona.
//   ChatGPT: plugin.json + .app.json + skills/ + assets/. La app se registra antes por enlace en ChatGPT.
//     Un mcp.json remoto funciona en Codex, pero no bastó para el chat normal; app vinculada probada el 16-nov.
//     El ZIP solo lleva el ID de esa app, no la llave de Nodo. No fijar un ID personal en este generador público.
//   Claude (claude.com/docs/plugins/build): .claude-plugin/plugin.json + .mcp.json (type "http") + skills/ + logo.png.
//     Lleva el enlace personal adentro: quien tenga ese ZIP entra como esa persona. No publicarlo.
//     En claude.ai hay que conectarlo en la pestaña «Connectors» del complemento.
// ZIP sin compresión (método «store»): son 5 archivos chicos, no hace falta una librería.

const VERSION = "1.0.0";
const VERSION_CHATGPT = "1.0.2";
const WEB = "https://trackmeta.github.io/Nodo/panel/";
const DESC = "Nodo es tu CRM de ventas por WhatsApp con IA. Pregúntale cómo te fue, qué clientes están por comprar, " +
  "qué pagos faltan validar o pídele cambiar un precio: revisa los bots de todos tus equipos y te pregunta antes de cambiar algo.";

// Instrucciones que la IA lee al usar Nodo (lo mismo que dice el servidor en `instructions`, más el tono).
const SKILL = `---
name: nodo
description: Usar Nodo, el CRM de ventas por WhatsApp con IA. Úsalo cuando la persona pregunte por sus ventas, chats, clientes, pedidos, pagos por validar, productos, precios o la configuración de sus bots de Nodo, o quiera cambiar algo en ellos.
---

# Nodo

Nodo es el CRM donde esta persona vende por WhatsApp con un bot de IA. Las herramientas del conector «Nodo» leen y cambian sus datos reales.

## Cómo hablar
- Español sencillo de Perú, con tuteo («tú», «puedes»). Nada de voseo.
- Respuestas cortas: primero el dato que pidió, luego el detalle en una lista breve.
- El dinero, con el símbolo que devuelven las herramientas (S/ en Perú). Las horas ya vienen en la zona del bot.

## Cómo trabajar
- Si no sabes qué bots tiene, llama primero a \`mis_bots\`. Si tiene varios y no dijo cuál, pregúntale.
- Para «¿cómo me fue?» usa \`resumen\`; para «¿qué tengo que atender?», \`pendientes\`.
- Las herramientas que cambian algo devuelven primero una vista previa: muéstrasela y vuelve a llamar con \`confirmar: true\` SOLO si te dice que sí.
- Nunca inventes números de pago, precios ni datos del negocio: pregúntalos.
- Conectar WhatsApp y poner claves de IA se hace en el panel de Nodo (${WEB}), no aquí.
- Si cambió algo desde otro lado, vuelve a consultar en vez de responder de memoria.
`;

// ── ZIP «store» ────────────────────────────────────────────────────────────────────────────────────────────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(archivos) {   // [{ nombre, datos: Uint8Array }]
  const enc = new TextEncoder(), partes = [], central = [];
  const d = new Date(), hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const fecha = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  let off = 0;
  for (const a of archivos) {
    const nom = enc.encode(a.nombre), crc = crc32(a.datos), n = a.datos.length;
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true); loc.setUint16(8, 0, true);
    loc.setUint16(10, hora, true); loc.setUint16(12, fecha, true); loc.setUint32(14, crc, true); loc.setUint32(18, n, true);
    loc.setUint32(22, n, true); loc.setUint16(26, nom.length, true); loc.setUint16(28, 0, true);
    partes.push(new Uint8Array(loc.buffer), nom, a.datos);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true); cen.setUint16(12, hora, true); cen.setUint16(14, fecha, true); cen.setUint32(16, crc, true);
    cen.setUint32(20, n, true); cen.setUint32(24, n, true); cen.setUint16(28, nom.length, true);
    cen.setUint32(42, off, true);
    central.push(new Uint8Array(cen.buffer), nom);
    off += 30 + nom.length + n;
  }
  const tamCen = central.reduce((s, p) => s + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCen, true); fin.setUint32(16, off, true);
  return new Blob([...partes, ...central, new Uint8Array(fin.buffer)], { type: "application/zip" });
}

const json = (o) => new TextEncoder().encode(JSON.stringify(o, null, 2) + "\n");
const txt = (s) => new TextEncoder().encode(s);

// ChatGPT requiere el ID de la app registrada; Claude conserva la URL personal del MCP.
export async function descargarComplemento(ia, url, appId = "") {
  if (ia !== "ChatGPT" && ia !== "Claude") throw new Error("Elige ChatGPT o Claude para descargar el complemento.");
  appId = String(appId).trim();
  const sinVincular = ia === "ChatGPT" && appId === "sin-vincular";
  if (ia === "ChatGPT" && !sinVincular && !/^asdk_app_[a-zA-Z0-9]+$/.test(appId)) {
    throw new Error("Pega el ID de la aplicación de NODO MCP: empieza con asdk_app_. No uses el ID de versión ni tu enlace personal.");
  }
  // Logo chico (80×80, 7,9 KB): ChatGPT pide íconos livianos y cuadrados de al menos 48 px.
  const respuesta = await fetch(new URL("../assets/logo-chatgpt.png", import.meta.url));
  if (!respuesta.ok) throw new Error("No se pudo cargar el logo del complemento. Vuelve a intentarlo.");
  const logo = new Uint8Array(await respuesta.arrayBuffer());
  let archivos;
  if (ia === "ChatGPT") {
    archivos = [
      { nombre: "plugin.json", datos: json({
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: "nodo", version: VERSION_CHATGPT, description: DESC,
        author: { name: "Nodo", url: WEB }, homepage: WEB, keywords: ["crm", "whatsapp", "ventas"],
        extensions: { "com.openai": { ...(sinVincular ? {} : { apps: "./.app.json" }), interface: {
          displayName: "Nodo", shortDescription: "Tu CRM de WhatsApp con IA", longDescription: DESC,
          developerName: "Nodo", category: "Productivity",
          capabilities: ["Ver ventas y conversión", "Revisar chats y clientes", "Atender pendientes", "Cambiar precios y configuración"],
          websiteURL: WEB, defaultPrompt: ["¿Cómo me fue esta semana?", "¿Hay algo que deba atender?", "¿Qué clientes están por comprar?"],
          brandColor: "#2B7FFF", composerIcon: "./assets/icon.png", logo: "./assets/logo.png" } } },
      }) },
      ...(sinVincular ? [] : [{ nombre: ".app.json", datos: json({ apps: { nodo: { id: appId, required: true } } }) }]),
      { nombre: "skills/nodo/SKILL.md", datos: txt(SKILL) },
      { nombre: "assets/icon.png", datos: logo },
      { nombre: "assets/logo.png", datos: logo },
    ];
  } else {
    archivos = [
      { nombre: ".claude-plugin/plugin.json", datos: json({
        name: "nodo", displayName: "Nodo", version: VERSION, description: DESC,
        author: { name: "Nodo", url: WEB }, homepage: WEB, keywords: ["crm", "whatsapp", "ventas"], icon: "./logo.png",
      }) },
      { nombre: ".mcp.json", datos: json({ mcpServers: { nodo: { type: "http", url } } }) },
      { nombre: "skills/nodo/SKILL.md", datos: txt(SKILL) },
      { nombre: "logo.png", datos: logo },
    ];
  }
  const blob = zip(archivos);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = ia === "ChatGPT" ? "nodo-chatgpt.zip" : "nodo-claude.zip";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
