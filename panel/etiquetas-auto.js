// 🏷️ ETIQUETAS AUTOMÁTICAS: las pone el motor solo, buscándolas por su NOMBRE exacto
// (engine.ts → addTag(«Compra», «Venta manual») y autoEtiquetaZona(«Lima», «Provincia», «Digital»)).
// Si el motor agrega o renombra una, hay que cambiarla también acá.
//
// (4-nov, Rodrigo) En la pantalla de Etiquetas van aparte de las del usuario, con candado: renombrar o borrar una
// no sirve de nada (en la próxima venta el motor la vuelve a crear con el nombre original y los contactos quedan
// repartidos en dos). Solo se les cambia el color. Y existen desde que se crea el bot, en 0 contactos, para que un
// usuario nuevo no vea la sección vacía y entienda qué hace cada una.
export const ETIQUETAS_AUTO = [
  { nombre: "Compra",       color: "#22c55e", cuando: "Cuando el cliente compra." },
  { nombre: "Digital",      color: "#8b5cf6", cuando: "Cuando el cliente se interesa en un producto digital." },
  { nombre: "Lima",         color: "#378ADD", cuando: "Cuando un pedido físico va a Lima." },
  { nombre: "Provincia",    color: "#EF9F27", cuando: "Cuando un pedido físico va a provincia." },
  { nombre: "Venta manual", color: "#64748b", cuando: "Cuando registras una venta a mano." },
];

export function etiquetaAuto(nombre) {
  const n = String(nombre ?? "").trim();
  return ETIQUETAS_AUTO.find((e) => e.nombre === n) || null;
}

// Crea las que falten en el bot (las que ya existen no se tocan: ni el color). Silenciosa: nunca rompe la pantalla.
export async function asegurarEtiquetasAuto(supa, channelId) {
  if (!channelId) return;
  try {
    const { data } = await supa.from("tags").select("nombre").eq("channel_id", channelId);
    const hay = new Set((data || []).map((t) => String(t.nombre || "").trim()));
    const faltan = ETIQUETAS_AUTO.filter((e) => !hay.has(e.nombre)).map((e) => ({ channel_id: channelId, nombre: e.nombre, color: e.color }));
    if (faltan.length) await supa.from("tags").upsert(faltan, { onConflict: "channel_id,nombre", ignoreDuplicates: true });
  } catch (_) {}
}
