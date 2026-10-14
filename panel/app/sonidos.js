// Los sonidos de los avisos, con las mismas notas que la campanita del panel (notif-center.js: sonar y
// sonarVenta). Aquí solo se usan para escucharlos al elegirlos; en el celular con la app cerrada suenan los
// .wav del APK, generados con las mismas notas (app-android/tools-sonidos.js).
export const TONOS_URGENTE = [["suave", "Suave", "dos notas que suben"], ["alerta", "Alerta", "tres pitidos cortos"], ["timbre", "Timbre", "un «din-don»"]];
export const TONOS_VENTA = [["caja", "Caja", "el «cha-ching» de una venta"], ["monedas", "Monedas", "unas monedas que caen"], ["campana", "Campanita", "cuatro notas alegres"]];
let _ac = null;
function ctx() { try { _ac = _ac || new (window.AudioContext || window.webkitAudioContext)(); if (_ac.state === "suspended") _ac.resume(); return _ac; } catch (_) { return null; } }
function bus(ac) { const c = ac.createDynamicsCompressor(); c.threshold.value = -10; c.connect(ac.destination); return c; }
export function escuchar(tono) {
  const ac = ctx(); if (!ac) return;
  const t0 = ac.currentTime + 0.02, b = bus(ac);
  const nota = (f, d, dur, g, tipo = "sine", at = 0.02) => {
    const o = ac.createOscillator(), gn = ac.createGain();
    o.type = tipo; o.frequency.value = f;
    gn.gain.setValueAtTime(0.0001, t0 + d); gn.gain.exponentialRampToValueAtTime(Math.max(g, 0.0002), t0 + d + at); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + d + dur);
    o.connect(gn).connect(b); o.start(t0 + d); o.stop(t0 + d + dur + 0.05);
  };
  const k = 3.2, v = 0.6;
  if (tono === "alerta") [0, 0.16, 0.32].forEach((d) => nota(988, d, 0.12, 0.07 * k, "square"));
  else if (tono === "timbre") { nota(659, 0, 0.7, 0.12 * k, "triangle"); nota(523, 0.32, 0.9, 0.12 * k, "triangle"); }
  else if (tono === "suave") { nota(784, 0, 0.55, 0.09 * k); nota(1175, 0.13, 0.55, 0.09 * k); }
  else if (tono === "monedas") [[3150, 0], [3700, 0.07], [3400, 0.15], [4200, 0.21], [3900, 0.3]].forEach(([f, d]) => { nota(f, d, 0.2, v * 0.75, "sine", 0.008); nota(f * 1.5, d, 0.12, v * 0.25, "sine", 0.008); });
  else if (tono === "campana") [[1047, 0], [1319, 0.1], [1568, 0.2], [2093, 0.3]].forEach(([f, d]) => nota(f, d, 0.5, v, "triangle", 0.008));
  else if (tono === "caja") {
    const n = Math.ceil(ac.sampleRate * 0.05), buf = ac.createBuffer(1, n, ac.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ac.createBufferSource(), hp = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = buf; hp.type = "highpass"; hp.frequency.value = 2500; g.gain.value = v * 0.9; src.connect(hp).connect(g).connect(b); src.start(t0);
    nota(2093, 0.06, 0.25, v * 0.7, "sine", 0.008); nota(2093 * 2.76, 0.06, 0.18, v * 0.2, "sine", 0.008);
    nota(2637, 0.2, 0.75, v, "sine", 0.008); nota(2637 * 2.76, 0.2, 0.35, v * 0.25, "sine", 0.008); nota(2637 * 5.4, 0.2, 0.2, v * 0.1, "sine", 0.008);
  }
}
