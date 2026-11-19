// ═════════════════════════════════════════════════════════════════════════
// 🗑️ Apagar, reactivar y ELIMINAR un bot (19-nov, Rodrigo: «mejor ubícalo dentro de Equipo»; antes era la tarjeta
// «Dar de baja este bot» al final de Conexiones). Lo usa cuenta.html, en la fila de cada bot de su equipo.
//
// «Eliminar bot» va DIRECTO (Rodrigo: «¿por qué existe archivar?»): por dentro sigue siendo apagar → borrar, porque el
// servidor (channel-config channel_delete) solo borra un bot ya apagado. Las mismas protecciones de siempre: se CUENTA
// lo que se va a borrar antes de preguntar, hay que escribir el nombre (y el servidor lo vuelve a comprobar), y no se
// puede dejar a nadie sin ningún bot activo (channel_archive → «ultimo_canal»).
// «Apagar» (archivar) queda como opción chica: deja de responder y de gastar, no borra nada y se reactiva.
// ═════════════════════════════════════════════════════════════════════════
import { supa, toast, askText } from "./shell.js";

const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const n = (x) => (x == null ? "?" : Number(x).toLocaleString("es-PE"));
const mb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const igual = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

async function callFn(fn, body) {
  const { data, error } = await supa.functions.invoke(fn, { body });
  if (error) { let d = ""; try { d = (await error.context?.json?.())?.detalle || ""; } catch { /* sin detalle */ } throw new Error(d || error.message || "error"); }
  if (data && data.error) throw new Error(data.detalle || data.error);
  return data;
}
// Si el bot que se apaga o se borra es el que tienes abierto, el panel salta a otro (el selector solo lista activos).
function soltarSiEsElAbierto(id) {
  try { if (localStorage.getItem("nodo.channelId") === String(id)) { localStorage.removeItem("nodo.channelId"); return true; } } catch { /* sin almacenamiento */ }
  return false;
}

// Devuelve true si eliminó.
export async function eliminarBot({ id, nombre, activo }) {
  let pv;
  try { pv = await callFn("channel-config", { action: "channel_delete_preview", channel_id: id }); }
  catch (e) { toast(e.message || "No se pudo leer el bot", true); return false; }
  const c = pv.cuentas || {}, a = pv.archivos;
  const filas = [["contactos", c.contactos], ["conversaciones", c.conversaciones], ["mensajes", c.mensajes], ["pedidos", c.pedidos], ["productos", c.productos], ["flujos", c.flujos]]
    .filter(([, v]) => v).map(([k, v]) => `<b>${n(v)}</b> ${k}`)
    .concat(a && a.n ? [`<b>${n(a.n)}</b> archivos (${mb(a.bytes || 0)}: fotos, audios, comprobantes y adjuntos)`] : [])
    .join("<br>");
  const v = await askText({ title: `Eliminar «${nombre}» para siempre`,
    messageHtml: `Esto <b>no se puede deshacer</b> y no hay copia de seguridad: las ventas de este bot también salen de Inicio y de Compras.<br><br>
      ${filas ? `Se borra ahora mismo:<br>${filas}<br><br>` : "Este bot está vacío: no tiene contactos, pedidos ni productos.<br><br>"}
      ${activo ? "Si solo quieres que deje de responder, usa <b>Apagar</b>: no borra nada.<br><br>" : ""}Escribe <b>${esc(nombre)}</b> para confirmar.`,
    label: "Nombre del bot", placeholder: nombre, confirmText: "Eliminar para siempre" });
  if (v === null) return false;
  if (!igual(v, nombre)) { toast("El nombre no coincide: no se borró nada", true); return false; }
  if (activo) {
    try { await callFn("channel-config", { action: "channel_archive", channel_id: id, archivar: true }); }
    catch (e) { toast((e.message || "No se pudo eliminar").replace("antes de archivar este", "antes de eliminar este"), true); return false; }
  }
  try {
    const r = await callFn("channel-config", { action: "channel_delete", channel_id: id, confirmar: v.trim() });
    const ar = r && r.archivos;
    toast(`«${nombre}» se eliminó${ar && ar.borrados ? ` con ${n(ar.borrados)} archivos` : ""}${ar && ar.fallidos ? ` · ${n(ar.fallidos)} archivos no se pudieron borrar` : ""}`, !!(ar && ar.fallidos));
  } catch (e) {
    toast(`No se pudo eliminar: ${e.message || "error"}.${activo ? " El bot quedó apagado (no se borró nada): puedes reactivarlo o volver a intentarlo." : ""}`, true);
    if (activo && soltarSiEsElAbierto(id)) location.reload();
    return false;
  }
  if (soltarSiEsElAbierto(id)) { location.reload(); return true; }
  return true;
}

// Apagar (archivar): no borra nada. Devuelve true si lo apagó.
export async function apagarBot({ id, nombre }) {
  const v = await askText({ title: `Apagar «${nombre}»`,
    messageHtml: `Este bot <b>deja de responder</b> a partir de ahora y sale de tu lista de bots.<br><br>
      <b>No se borra nada</b>: contactos, chats, pedidos y productos quedan intactos, y lo puedes reactivar aquí mismo, en Equipo.<br><br>
      Escribe <b>${esc(nombre)}</b> para confirmar.`,
    label: "Nombre del bot", placeholder: nombre, confirmText: "Apagar" });
  if (v === null) return false;
  if (!igual(v, nombre)) { toast("El nombre no coincide: no se apagó nada", true); return false; }
  try { await callFn("channel-config", { action: "channel_archive", channel_id: id, archivar: true }); }
  catch (e) { toast((e.message || "No se pudo apagar").replace("antes de archivar este", "antes de apagar este"), true); return false; }
  toast(`«${nombre}» quedó apagado`);
  if (soltarSiEsElAbierto(id)) location.reload();
  return true;
}

export async function reactivarBot({ id, nombre }) {
  try { await callFn("channel-config", { action: "channel_archive", channel_id: id, archivar: false }); }
  catch (e) { toast(e.message || "No se pudo reactivar", true); return false; }
  toast(`«${nombre}» volvió a estar activo`);
  location.reload();   // el selector de bots se arma al cargar
  return true;
}
