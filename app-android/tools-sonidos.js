// Genera los 3 sonidos de los avisos (WAV 16 bits mono) sin archivos de terceros:
// alarma (insistente, 3 pitidos dobles), campana (ding con eco) y caja (cha-ching).
const fs = require("fs"), SR = 22050;
function wav(muestras) {
  const n = muestras.length, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  muestras.forEach((v, i) => b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
  return b;
}
const out = (seg) => new Float32Array(Math.round(seg * SR));
function tono(buf, ini, dur, freqs, vol, decae = 6) {
  const a = Math.round(ini * SR), m = Math.round(dur * SR);
  for (let i = 0; i < m && a + i < buf.length; i++) {
    const t = i / SR, env = Math.min(1, i / (0.004 * SR)) * Math.exp(-decae * t);
    let v = 0; freqs.forEach(([f, g]) => (v += g * Math.sin(2 * Math.PI * f * t)));
    buf[a + i] += vol * env * v;
  }
}
// alarma: 3 × (dos pitidos agudos)
const al = out(2.2); [0, 0.7, 1.4].forEach((s) => { tono(al, s, 0.18, [[1320, 1], [2640, 0.25]], 0.55, 2); tono(al, s + 0.24, 0.18, [[1568, 1], [3136, 0.25]], 0.55, 2); });
// campana: ding con armónicos
const ca = out(1.6); tono(ca, 0, 1.6, [[880, 1], [1760, 0.45], [2637, 0.25], [3520, 0.1]], 0.6, 3.2);
// caja registradora: dos «cling» rápidos + campanita
const cj = out(1.4); tono(cj, 0, 0.12, [[2093, 1], [4186, 0.4]], 0.45, 18); tono(cj, 0.13, 0.12, [[2349, 1], [4698, 0.4]], 0.45, 18); tono(cj, 0.3, 1.1, [[1568, 1], [3136, 0.5], [4704, 0.2]], 0.55, 3.5);
const dir = "android/app/src/main/res/raw/";
fs.writeFileSync(dir + "alarma.wav", wav(al)); fs.writeFileSync(dir + "campana.wav", wav(ca)); fs.writeFileSync(dir + "caja.wav", wav(cj));
console.log("sonidos listos");
