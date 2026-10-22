// Avisos con la app cerrada (Firebase Cloud Messaging). Solo funciona dentro del APK (Capacitor); en el navegador
// no hace nada. El celular se registra en `push_dispositivos` y la función edge `push` le manda cada notificación
// que nace en Nodo, respetando «Qué avisos me llegan».
import { A, on, emit, supa, callFn, toast, cambiarBot, ir } from "./app.js";

// Barra del celular (hora, señal, batería): del mismo color que la cabecera y con los íconos legibles.
// En Android 15 la barra ya no se pinta: se ve el fondo de la ventana. NodoNativo.barras pinta ese fondo
// y elige íconos claros u oscuros; StatusBar queda de respaldo para celulares más viejos.
function barra(t) {
  const claro = t === "light", color = claro ? "#FFFFFF" : "#131A26";
  // (1.0.23+) arriba, el mismo degradado que la cabecera (diseño A); los APK de antes lo ignoran
  const NN = window.Capacitor?.Plugins?.NodoNativo;
  // NodoNativo.barras ya pinta la barra de arriba: StatusBar, después, la volvía a poner blanca
  if (NN?.barras) { NN.barras({ color, claro, arriba: ["#0044FE", "#01AFFE"] }).catch?.(() => {}); return; }
  const SB = window.Capacitor?.Plugins?.StatusBar; if (!SB) return;
  SB.setStyle?.({ style: claro ? "LIGHT" : "DARK" }).catch?.(() => {});
  SB.setBackgroundColor?.({ color }).catch?.(() => {});
}
// Canales de Android: uno por sonido (los mismos de la campanita web). El sonido de un canal no se puede
// cambiar después de creado: por eso llevan versión (nodo2_*) y los viejos se borran.
const CANALES = [["suave", "Urgente · Suave"], ["alerta", "Urgente · Alerta"], ["timbre", "Urgente · Timbre"], ["caja", "Venta · Caja"], ["monedas", "Venta · Monedas"], ["campana", "Venta · Campanita"], ["silencio", "Sin sonido"]];
const VIEJOS = ["nodo_alarma", "nodo_campana", "nodo_caja", "nodo_normal", "nodo_silencio"];

const cap = () => window.Capacitor;
const nativo = () => !!cap()?.isNativePlatform?.();
const plugin = (n) => cap()?.Plugins?.[n];
let TOKEN = null;

export function init() {
  window.NODO_APP_VERSION = "1.0";
  if (!nativo()) { on("pushPrueba", () => toast("Los avisos con la app cerrada llegan en la app del celular (APK). Aquí, en el navegador, solo los ves con la app abierta.")); return; }
  barra(document.documentElement.dataset.theme);
  on("tema", barra);
  on("listo", registrar);
  on("pushPrueba", probar);
  on("salir", olvidar);
  // Botón «atrás» de Android: lo maneja el historial de la app (app.js); sin nada abierto, minimiza.
  plugin("App")?.addListener?.("backButton", ({ canGoBack }) => { if (canGoBack) history.back(); else plugin("App").minimizeApp?.(); });
}
async function registrar() {
  const PN = plugin("PushNotifications"), NN = plugin("NodoNativo");
  if (!PN) return;
  try {
    const info = NN ? await NN.info() : { firebase: false };
    window.NODO_APP_VERSION = info?.version || "1.0";
    if (!info?.firebase) { console.warn("[push] APK sin Firebase: los avisos con la app cerrada no están activos todavía"); return; }
    // Un canal de Android por sonido (el sonido de un canal no se puede cambiar después de crearlo).
    // Los sonidos nuevos (los de la web) vienen desde el APK n.º 7: en uno más viejo los .wav no existen y el
    // canal quedaría mudo para siempre. Ahí se dejan los canales que ya tenía.
    if (Number(info.build) < 7) { console.warn("[push] APK viejo: se mantienen los sonidos anteriores"); }
    else for (const id of VIEJOS) await PN.deleteChannel({ id }).catch(() => {});
    if (Number(info.build) >= 7) for (const [k, l] of CANALES) {
      await PN.createChannel({ id: "nodo2_" + k, name: l, description: "Avisos de Nodo · " + l, importance: k === "silencio" ? 2 : 5, visibility: 1, vibration: k !== "silencio", lights: true, sound: k !== "silencio" ? k : undefined }).catch(() => {});
    }
    let p = await PN.checkPermissions();
    if (p.receive === "prompt" || p.receive === "prompt-with-rationale") p = await PN.requestPermissions();
    if (p.receive !== "granted") { toast("Sin permiso de notificaciones: no te sonará el celular. Actívalo en Ajustes → Apps → Nodo.", true); return; }
    await PN.removeAllListeners();
    PN.addListener("registration", async ({ value }) => {
      TOKEN = value;
      const { error } = await supa.from("push_dispositivos").upsert({ token: value, user_id: A.uid, plataforma: "android", modelo: navigator.userAgent.slice(0, 180), app_version: window.NODO_APP_VERSION, visto_at: new Date().toISOString() }, { onConflict: "token" });
      if (error) console.warn("[push] no se guardó el token", error.message);
    });
    PN.addListener("registrationError", (e) => console.warn("[push] registro", e));
    // Tocar el aviso → ir directo a lo suyo
    PN.addListener("pushNotificationActionPerformed", ({ notification }) => abrirDesde(notification?.data || {}));
    // Con la app abierta no se muestra el aviso del sistema: ya lo muestra la campanita en vivo.
    PN.addListener("pushNotificationReceived", () => {});
    await PN.register();
  } catch (e) { console.warn("[push]", e); }
}
async function abrirDesde(d) {
  try {
    if (d.channel_id && d.channel_id !== A.ch && A.channels.some((c) => c.id === d.channel_id)) await cambiarBot(d.channel_id);
    if (d.ir === "pagos") ir("pagos");
    else if (d.ir === "t4") ir("t4");
    else if (d.contact_id) emit("abrirChat", d.contact_id);
    else emit("abrirNotif");
  } catch (_) { /* */ }
}
async function probar() {
  if (!TOKEN) { toast("Este celular todavía no está registrado para avisos. Revisa el permiso de notificaciones.", true); return; }
  const r = await callFn("push", { prueba: true });
  if (r.ok && r.data?.enviados) toast("Listo: debería sonar en unos segundos");
  else toast(r.data?.motivo === "sin_fcm" ? "Falta conectar Firebase en el servidor" : "No se pudo mandar la prueba: " + (r.data?.motivo || r.data?.error || r.status), true);
}
async function olvidar() { if (TOKEN) await supa.from("push_dispositivos").delete().eq("token", TOKEN).then(() => {}, () => {}); }
