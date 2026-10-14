// Genera los sonidos de los avisos del APK (WAV 16 bits mono) con LAS MISMAS NOTAS que la campanita del panel
// (notif-center.js: sonar() y sonarVenta()), para que el celular suene igual que la web:
//   urgente → suave (dos notas que suben) · alerta (tres pitidos) · timbre («din-don»)
//   venta   → caja (cha-ching) · monedas · campana (cuatro notas alegres)
// Uso: node tools-sonidos.js  → android/app/src/main/res/raw/*.wav
const fs = require("fs"), SR = 44100;
function wav(m) {
  const n = m.length, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  m.forEach((v, i) => b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
  return b;
}
const osc = { sine: (p) => Math.sin(2 * Math.PI * p), square: (p) => (p % 1 < 0.5 ? 1 : -1), triangle: (p) => { const x = p % 1; return x < 0.5 ? 4 * x - 1 : 3 - 4 * x; } };
// Nota con la misma envolvente de WebAudio: 0.0001 → g (en `ataque`) → 0.0001 al final, en rampas exponenciales
function nota(buf, f, ini, dur, g, tipo = "sine", ataque = 0.02) {
  const a = Math.round(ini * SR), m = Math.round((dur + 0.05) * SR);
  for (let i = 0; i < m && a + i < buf.length; i++) {
    const t = i / SR; let e;
    if (t < ataque) e = 0.0001 * Math.pow(g / 0.0001, t / ataque);
    else if (t < dur) e = g * Math.pow(0.0001 / g, (t - ataque) / (dur - ataque));
    else e = 0;
    buf[a + i] += e * osc[tipo](f * t);
  }
}
const nuevo = (seg) => new Float32Array(Math.round(seg * SR));
// El «limitador» de la web: se normaliza el pico a 0.9 (el volumen lo pone el celular)
const normal = (b) => { let p = 0; b.forEach((v) => (p = Math.max(p, Math.abs(v)))); if (p > 0) for (let i = 0; i < b.length; i++) b[i] = (b[i] / p) * 0.9; return b; };
const S = {};
// urgentes (sonar)
{ const b = nuevo(0.8); nota(b, 784, 0.02, 0.55, 0.09); nota(b, 1175, 0.15, 0.55, 0.09); S.suave = b; }
{ const b = nuevo(0.6); [0, 0.16, 0.32].forEach((d) => nota(b, 988, 0.02 + d, 0.12, 0.07, "square")); S.alerta = b; }
{ const b = nuevo(1.35); nota(b, 659, 0.02, 0.7, 0.12, "triangle"); nota(b, 523, 0.34, 0.9, 0.12, "triangle"); S.timbre = b; }
// ventas (sonarVenta), ataque de 8 ms como en la web
{ const b = nuevo(0.65); [[3150, 0], [3700, 0.07], [3400, 0.15], [4200, 0.21], [3900, 0.3]].forEach(([f, d]) => { nota(b, f, 0.02 + d, 0.2, 0.75, "sine", 0.008); nota(b, f * 1.5, 0.02 + d, 0.12, 0.25, "sine", 0.008); }); S.monedas = b; }
{ const b = nuevo(0.9); [[1047, 0], [1319, 0.1], [1568, 0.2], [2093, 0.3]].forEach(([f, d]) => nota(b, f, 0.02 + d, 0.5, 1, "triangle", 0.008)); S.campana = b; }
{ const b = nuevo(1.05);
  // golpe del cajón: ruido corto con paso-altos de 2,5 kHz
  const n = Math.round(SR * 0.05); let prevX = 0, prevY = 0; const rc = 1 / (2 * Math.PI * 2500), dt = 1 / SR, al = rc / (rc + dt);
  for (let i = 0; i < n; i++) { const x = (Math.random() * 2 - 1) * (1 - i / n); const y = al * (prevY + x - prevX); prevX = x; prevY = y; b[Math.round(0.02 * SR) + i] += y * 0.9; }
  nota(b, 2093, 0.08, 0.25, 0.7, "sine", 0.008); nota(b, 2093 * 2.76, 0.08, 0.18, 0.2, "sine", 0.008);
  nota(b, 2637, 0.22, 0.75, 1, "sine", 0.008); nota(b, 2637 * 2.76, 0.22, 0.35, 0.25, "sine", 0.008); nota(b, 2637 * 5.4, 0.22, 0.2, 0.1, "sine", 0.008);
  S.caja = b; }
const dir = __dirname + "/android/app/src/main/res/raw/";
for (const f of fs.readdirSync(dir)) if (f.endsWith(".wav")) fs.unlinkSync(dir + f);
for (const [k, b] of Object.entries(S)) fs.writeFileSync(dir + k + ".wav", wav(normal(b)));
console.log("sonidos:", Object.keys(S).join(", "));
