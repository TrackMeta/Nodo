/* ═══════════════════════════════════════════════════════════════════
   Kit de Nodo para micro apps — v1 (8-oct-2026)
   Lo que hace por la app (el negocio no programa nada de esto):
     · lee el link personal (?acceso=…) que el bot le mandó al cliente,
     · deja una «pulsera» en este navegador para que la próxima vez entre solo,
     · pregunta a la base de Apps si tiene acceso (al abrir y cada 10 min),
     · si venció / está en pausa / terminó la prueba: tapa la app con «Renueva para seguir»,
     · guarda y lee el PROGRESO del cliente (su «casillero»), para que no lo pierda
       al cambiar de celular ni al renovar.
   Uso (2 líneas):
     <script src="https://trackmeta.github.io/Nodo/panel/kit/nodo-apps.js"></script>
     <script>NodoApps.iniciar({ app: "app_xxx", alEntrar: (cliente) => { … muestra tu app … } });</script>
   Nivel «reforzado» (por defecto): la app debe cargar su contenido recién en alEntrar.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  // Dirección de la base de Apps. Se puede pasar `api` en iniciar() para otra base.
  var API_DEFECTO = "https://zllosysoknhtalpkjabv.supabase.co/functions/v1/kit";
  var REVISAR_MS = 10 * 60 * 1000;
  var cfg = null, cliente = null, timer = null, guardando = null, pendiente = null;

  function k(n) { return "nodoapps." + cfg.app + "." + n; }
  function get(n) { try { return localStorage.getItem(k(n)); } catch (e) { return null; } }
  function set(n, v) { try { v == null ? localStorage.removeItem(k(n)) : localStorage.setItem(k(n), v); } catch (e) {} }

  function etiqueta() {
    var ua = navigator.userAgent || "";
    var so = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "Otro";
    var nav = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Navegador";
    return so + " · " + nav;
  }

  function llamar(cuerpo) {
    cuerpo.app = cfg.app;
    return fetch(cfg.api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) })
      .then(function (r) { return r.json(); });
  }

  // ── Pantalla que tapa la app ──────────────────────────────────────
  var CSS = ".nodoapps-tapa{position:fixed;inset:0;z-index:2147483646;background:#0e1116;color:#e7ecf2;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}" +
    ".nodoapps-caja{max-width:360px;text-align:center}" +
    ".nodoapps-ic{font-size:44px;margin-bottom:10px}" +
    ".nodoapps-t{font-size:20px;font-weight:800;margin:0 0 8px}" +
    ".nodoapps-s{font-size:14.5px;line-height:1.55;color:#a9b4c2;margin:0 0 20px}" +
    ".nodoapps-b{display:inline-block;background:#25d366;color:#06240f;font-weight:800;font-size:15px;padding:13px 22px;border-radius:12px;text-decoration:none;border:none;cursor:pointer}" +
    ".nodoapps-b2{display:block;margin:14px auto 0;background:none;border:none;color:#8a97a8;font-size:13px;text-decoration:underline;cursor:pointer}";
  function tapar(ic, titulo, texto, boton, href) {
    if (!document.getElementById("nodoapps-css")) { var st = document.createElement("style"); st.id = "nodoapps-css"; st.textContent = CSS; document.head.appendChild(st); }
    var t = document.getElementById("nodoapps-tapa");
    if (!t) { t = document.createElement("div"); t.id = "nodoapps-tapa"; t.className = "nodoapps-tapa"; document.body.appendChild(t); }
    t.innerHTML = '<div class="nodoapps-caja"><div class="nodoapps-ic">' + ic + '</div><p class="nodoapps-t"></p><p class="nodoapps-s"></p>' +
      (boton ? '<a class="nodoapps-b" target="_blank" rel="noopener"></a>' : "") +
      '<button class="nodoapps-b2" type="button">Ya lo hice, volver a revisar</button></div>';
    t.querySelector(".nodoapps-t").textContent = titulo;
    t.querySelector(".nodoapps-s").textContent = texto;
    if (boton) { var a = t.querySelector(".nodoapps-b"); a.textContent = boton; a.href = href || "#"; if (!href) a.style.display = "none"; }
    t.querySelector(".nodoapps-b2").onclick = function () { revisar(); };
  }
  function destapar() { var t = document.getElementById("nodoapps-tapa"); if (t) t.remove(); }

  function fechaCorta(iso) {
    try { return new Date(iso).toLocaleDateString("es-PE", { day: "numeric", month: "long" }); } catch (e) { return ""; }
  }

  function aplicar(r) {
    if (r && r.renovar) set("renovar", r.renovar);
    var renovar = (r && r.renovar) || get("renovar") || "";
    if (!r || !r.ok) {
      var m = r && r.motivo;
      if (m === "sin_sesion") {
        set("pulsera", null);
        tapar("📱", "Este celular se desconectó", "Entraste desde otro celular y se cerró la sesión en este. Abre de nuevo tu link personal (escribe «mi acceso» en el chat y te lo reenviamos).", "Pedir mi acceso por WhatsApp", renovar ? renovar.replace(/text=[^&]*/, "text=" + encodeURIComponent("mi acceso")) : "");
      } else if (m === "link_invalido") {
        tapar("🔗", "Este link no es válido", "Abre el link personal que te llegó por WhatsApp. Si no lo encuentras, escribe «mi acceso» en el chat.", "", "");
      } else if (m === "app_desconocida") {
        tapar("⚙️", "Esta app no está conectada", "El dueño de la app tiene que conectarla en Nodo.", "", "");
      } else {
        tapar("📶", "No pudimos revisar tu acceso", "Revisa tu conexión a internet y vuelve a intentar.", "", "");
      }
      cliente = null; return;
    }
    cliente = { estado: r.estado, tipo: r.tipo, vence_at: r.vence_at, nombre: r.nombre, app: r.app };
    if (r.estado === "activo" || r.estado === "prueba") {
      destapar();
      if (!cfg._entro) { cfg._entro = true; try { cfg.alEntrar && cfg.alEntrar(cliente); } catch (e) { console.error(e); } }
      return;
    }
    if (r.estado === "vencido") tapar("⏸️", "Tu acceso venció", "Tu progreso está guardado. Renueva y sigues exactamente donde te quedaste.", "Renovar por WhatsApp", renovar);
    else if (r.estado === "prueba_terminada") tapar("🎁", "Terminó tu prueba gratis", "Tu progreso está guardado. Si te gustó, quédate con la app y sigues donde te quedaste.", "Comprar por WhatsApp", renovar);
    else if (r.estado === "bloqueado") tapar("⛔", "Tu acceso está en pausa", "Escríbenos por WhatsApp y lo revisamos.", "Escribir por WhatsApp", renovar ? renovar.replace(/text=[^&]*/, "text=" + encodeURIComponent("Hola, mi acceso está en pausa")) : "");
    try { cfg.alCerrar && cfg.alCerrar(cliente); } catch (e) {}
  }

  function revisar() {
    var acceso = null;
    try { acceso = new URLSearchParams(location.search).get("acceso"); } catch (e) {}
    var pulsera = get("pulsera");
    var p;
    if (acceso) {
      p = llamar({ accion: "entrar", acceso: acceso, pulsera: pulsera || undefined, etiqueta: etiqueta() }).then(function (r) {
        if (r && r.pulsera) set("pulsera", r.pulsera);
        // El código no queda en la barra (ni en el historial ni en una captura de pantalla).
        try { var u = new URL(location.href); u.searchParams.delete("acceso"); history.replaceState(null, "", u.toString()); } catch (e) {}
        return r;
      });
    } else if (pulsera) {
      p = llamar({ accion: "estado", pulsera: pulsera });
    } else {
      tapar("🔑", "Entra con tu link personal", "Para usar la app, abre el link que te mandamos por WhatsApp después de tu compra.", "", "");
      return Promise.resolve();
    }
    return p.then(aplicar, function () { aplicar({ ok: false, motivo: "red" }); });
  }

  function ping() {
    // «Probar conexión» del panel: la app avisa que tiene el kit. Una vez al día por navegador.
    var hoy = new Date().toISOString().slice(0, 10);
    if (get("ping") === hoy) return;
    llamar({ accion: "ping", nivel: cfg.nivel }).then(function (r) { if (r && r.ok) set("ping", hoy); }, function () {});
  }

  window.NodoApps = {
    version: 1,
    iniciar: function (o) {
      if (!o || !o.app) { console.error("[NodoApps] falta { app: 'app_…' }"); return; }
      cfg = { app: String(o.app), api: o.api || API_DEFECTO, nivel: o.nivel === "basico" ? "basico" : "reforzado", alEntrar: o.alEntrar, alCerrar: o.alCerrar, _entro: false };
      var go = function () {
        ping(); revisar();
        clearInterval(timer); timer = setInterval(revisar, REVISAR_MS);
        document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") revisar(); });
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
    },
    // Quién es y en qué está su acceso (null si todavía no entró).
    cliente: function () { return cliente; },
    // Su casillero: lo que la app guardó la última vez ({} si nada).
    leer: function () {
      var pul = cfg && get("pulsera");
      if (!pul) return Promise.resolve({});
      return llamar({ accion: "leer", pulsera: pul }).then(function (r) { return (r && r.ok && r.datos) || {}; });
    },
    // Guarda el casillero (se agrupan los guardados seguidos: uno cada 2 s como mucho).
    guardar: function (datos) {
      pendiente = datos;
      if (guardando) return guardando;
      guardando = new Promise(function (ok) {
        setTimeout(function () {
          var pul = cfg && get("pulsera"), d = pendiente; pendiente = null; guardando = null;
          if (!pul) return ok(false);
          llamar({ accion: "guardar", pulsera: pul, datos: d }).then(function (r) { ok(!!(r && r.ok)); }, function () { ok(false); });
        }, 2000);
      });
      return guardando;
    },
    revisar: revisar,
    // Texto listo para mostrar: «Tu plan vence el 8 de noviembre».
    venceTexto: function () {
      if (!cliente) return "";
      if (!cliente.vence_at) return cliente.tipo === "unico" ? "Acceso de por vida" : "";
      return (cliente.tipo === "prueba" ? "Tu prueba termina el " : "Tu plan vence el ") + fechaCorta(cliente.vence_at);
    },
  };
})();
