// ═══════════════════════════════════════════════════════════════════
// Nodo · Rastreo — la mitad frágil.
//
// Shalom no tiene API, y su endpoint interno contesta 403 "Origin not
// allowed" a cualquiera que no venga de su propia página. Por eso esto
// vive en el navegador: abre la página de verdad, escribe la guía y lee
// lo que sale, que es lo mismo que harías tú a mano.
//
// NO toca la base de datos de Nodo. Solo pregunta qué mirar y reporta qué
// vio. Si un día Shalom cambia su web, se rompe esto y nada más.
//
// Reglas que NO se negocian:
//  · Ritmo de persona: una guía a la vez, con pausas. Nunca en paralelo.
//  · Si varias seguidas fallan, PARA. No insiste contra una web caída.
//  · Si no pudo leer, lo dice. Jamás "sin novedad" cuando fue "no pude mirar".
// ═══════════════════════════════════════════════════════════════════

const API = "https://ahoxdyffbwjlshmdezwi.supabase.co/functions/v1/courier-sync";
const RASTREA = "https://shalom.com.pe/rastrea";

// Pausa entre guías. Consultar 30 guías tarda ~3 minutos, que es exactamente
// lo que debe tardar: no hay ninguna prisa y el ritmo es la mitad de la defensa.
const PAUSA_MS = 6000;
// Cuántos fallos seguidos antes de rendirse en esta pasada. Tres es "no es esta
// guía, es que algo se rompió": la web cambió, se cayó, o nos marcaron.
const FALLOS_SEGUIDOS_TOPE = 3;
// Tope duro por pasada. Con más guías que esto, se toman las más viejas y el
// resto espera a la siguiente ronda — mejor tardar un día más que que te corten.
const TOPE_POR_PASADA = 60;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const cfg = () => chrome.storage.local.get(["secreto", "cadaHoras", "ultimo", "ultimoDetalle"]);

async function apunte(detalle) {
  await chrome.storage.local.set({ ultimo: new Date().toISOString(), ultimoDetalle: detalle });
  // El icono lleva el resultado de la última pasada: verde si se leyó todo,
  // rojo si algo se rompió. Es lo primero que vas a mirar.
  const mal = detalle.roto || detalle.fallos > 0;
  try {
    await chrome.action.setBadgeText({ text: mal ? "!" : "" });
    await chrome.action.setBadgeBackgroundColor({ color: mal ? "#e2564a" : "#22c079" });
  } catch (_) { /* el icono es un lujo, no se cae la pasada por esto */ }
}

async function llamarNodo(secreto, cuerpo) {
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-rastreo-secret": secreto },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.detalle || j?.error || `Nodo respondió ${r.status}`);
  return j;
}

// Lee UNA guía. Abre la página en una pestaña de fondo, escribe los dos datos,
// espera el resultado y lo devuelve. La pestaña se cierra siempre, pase lo que pase.
async function leerGuia(guia, codigo) {
  const tab = await chrome.tabs.create({ url: RASTREA, active: false });
  try {
    // Esperar a que la página esté lista de verdad, no solo "cargada".
    for (let i = 0; i < 20; i++) {
      await dormir(500);
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.querySelectorAll("input").length >= 2,
      });
      if (result) break;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [guia, codigo],
      func: (g, c) => {
        const ins = [...document.querySelectorAll("input")];
        // React no se entera de un `el.value = x` a secas: hay que usar el setter
        // nativo y disparar el evento, si no el botón busca con los campos vacíos.
        const set = (el, v) => {
          const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          s.call(el, v);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        };
        set(ins[0], g);
        set(ins[1], c);
        const b = [...document.querySelectorAll("button")].find((x) => /buscar/i.test(x.innerText));
        if (b) b.click();
      },
    });

    // El resultado tarda: hay un captcha invisible puntuando de por medio.
    for (let i = 0; i < 30; i++) {
      await dormir(1000);
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const t = document.body.innerText.replace(/\s+/g, " ");
          if (!/N° DE ORDEN|N. DE ORDEN/i.test(t)) return null;
          // La etapa actual es el título grande; las cuatro de la línea de tiempo
          // aparecen siempre, así que no sirven para saber en cuál está.
          const m = t.match(/(En origen|En tr[aá]nsito|En destino|Entregado)\b/i);
          const d = t.match(/Desde el ([\d/]+ a las [\d:]+)/i);
          return { etapa: m ? m[1] : "", desde: d ? d[1] : null };
        },
      });
      if (result) return result;
    }
    return { error: "la página no mostró resultado" };
  } catch (e) {
    return { error: String(e?.message ?? e).slice(0, 180) };
  } finally {
    try { await chrome.tabs.remove(tab.id); } catch (_) { /* ya no estaba */ }
  }
}

async function pasada(motivo = "programada") {
  const { secreto } = await cfg();
  if (!secreto) { await apunte({ roto: true, nota: "Falta el código de Nodo", motivo }); return; }

  let guias;
  try {
    ({ guias } = await llamarNodo(secreto, { action: "pendientes" }));
  } catch (e) {
    // Si Nodo no contesta, no se toca Shalom. No tiene sentido leer estados que
    // después no vamos a poder reportar.
    await apunte({ roto: true, nota: `Nodo no contestó: ${e.message}`, motivo });
    return;
  }

  if (!guias.length) { await apunte({ roto: false, leidas: 0, fallos: 0, nota: "No hay guías que rastrear", motivo }); return; }

  const lote = guias.slice(0, TOPE_POR_PASADA);
  const items = [];
  let seguidos = 0, fallos = 0, cortado = false;

  for (const g of lote) {
    const r = await leerGuia(g.guia, g.codigo);
    if (r.error || !r.etapa) {
      fallos++; seguidos++;
      items.push({ order_id: g.order_id, error: r.error || "sin etapa" });
      if (seguidos >= FALLOS_SEGUIDOS_TOPE) { cortado = true; break; }
    } else {
      seguidos = 0;
      items.push({ order_id: g.order_id, etapa: r.etapa, desde: r.desde });
    }
    await dormir(PAUSA_MS);
  }

  let resumen = null;
  try { resumen = await llamarNodo(secreto, { action: "reportar", items }); }
  catch (e) { await apunte({ roto: true, nota: `No pude reportar a Nodo: ${e.message}`, motivo }); return; }

  const movidos = (resumen?.resultados ?? []).filter((x) => x.r === "movido_en_agencia").length;
  const sinSaldo = (resumen?.resultados ?? []).filter((x) => x.r === "entregado_sin_saldo").length;
  await apunte({
    roto: cortado, motivo,
    pendientes: guias.length, leidas: items.length - fallos, fallos,
    movidos, sin_saldo: sinSaldo,
    nota: cortado
      ? `Corté tras ${FALLOS_SEGUIDOS_TOPE} guías seguidas sin poder leer. Revisa si la página de Shalom cambió.`
      : null,
  });
}

// El reloj. Por defecto cada 4 horas: un paquete no cambia de etapa más seguido,
// y menos consultas es menos riesgo de que nos corten.
async function armarReloj() {
  const { cadaHoras } = await cfg();
  const h = Math.min(24, Math.max(1, Number(cadaHoras) || 4));
  await chrome.alarms.clear("rastreo");
  chrome.alarms.create("rastreo", { periodInMinutes: h * 60, delayInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(armarReloj);
chrome.runtime.onStartup.addListener(armarReloj);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "rastreo") pasada("programada"); });
chrome.runtime.onMessage.addListener((msg, _s, responder) => {
  if (msg?.t === "ahora") { pasada("a mano").then(() => responder({ ok: true })); return true; }
  if (msg?.t === "reloj") { armarReloj().then(() => responder({ ok: true })); return true; }
});
