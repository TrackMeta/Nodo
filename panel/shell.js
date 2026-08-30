// ═══════════════════════════════════════════════════════════════════
// Nodo · shell.js — cascarón compartido de todo el panel.
//   • Cliente Supabase único (config en un solo lugar).
//   • Sidebar fijo con iconos profesionales + etiquetas + comprimir.
//   • Tema claro/oscuro persistente.
//   • Selector global de bot (canal) + logo dinámico.
//   • toast() reutilizable.
// Uso en cada página:
//   import { supa, toast, mountShell } from "./shell.js";
//   const shell = await mountShell({ active:"productos" });
//   shell.channelId            // canal activo
//   shell.onChannel(cb)        // se llama al cambiar de bot
// ═══════════════════════════════════════════════════════════════════
// Bundle auto-alojado (un solo archivo, mismo origen) en vez del `/+esm` de
// jsdelivr, que se fragmentaba en ~9 peticiones encadenadas + DNS externo.
import { createClient } from "./vendor/supabase.min.js";
// La zona horaria del negocio vive en date-range.js (donde se usan los cortes de día); acá
// solo se publica al cargar el canal activo. date-range NO importa shell, así que no hay ciclo.
import { setTZ } from "./date-range.js";

export const SUPABASE_URL = "https://ahoxdyffbwjlshmdezwi.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFob3hkeWZmYndqbHNobWRlendpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNDU4MTksImV4cCI6MjA5ODYyMTgxOX0.4iY3gl1ZhxILv1kPF8-NYd4a0_MeAZmkyLqxx2BMW-Q";

export const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const FALLBACK_LOGO = "../assets/logo-128.png";

// ── Iconos (Lucide, stroke=currentColor) ───────────────────────────
const P = {
  inbox:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  contactos:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  flujos:'<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  productos:'<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  secuencias:'<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  plantillas:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  campanas:'<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  dashboard:'<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  pedidos:'<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  campos:'<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
  etiquetas:'<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  disparadores:'<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  palabras:'<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/><circle cx="19" cy="15" r="2.4"/><path d="m22.5 18.5-1.5-1.5"/>',
  respuestas:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8"/><path d="M8 13h5"/>',
  probar:'<path d="M9 3h6"/><path d="M10 3v6.5L4.6 18.6A1.5 1.5 0 0 0 5.9 21h12.2a1.5 1.5 0 0 0 1.3-2.4L14 9.5V3"/><path d="M7 15h10"/>',
  config:'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  canales:'<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon:'<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  panel:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M5.5 21a7.5 7.5 0 0 1 13 0"/>',
  chevron:'<path d="m6 9 6 6 6-6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  // ── Extra (iconos de interfaz, para reemplazar emojis) ──
  gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  plane:'<path d="M17.8 19.2 16 11l3.5-3.5a2.1 2.1 0 0 0-3-3L13 8 4.8 6.2a.5.5 0 0 0-.5.8l3.3 4-2.1 2.1-1.9-.5a.5.5 0 0 0-.5.8l2 2 2 2a.5.5 0 0 0 .8-.5l-.5-1.9 2.1-2.1 4 3.3a.5.5 0 0 0 .8-.5Z"/>',
  camera:'<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z"/><circle cx="12" cy="13" r="3"/>',
  wrench:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  bulb:'<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.1 14c.6-1 .9-1.6 1.6-2.4a6 6 0 1 0-9.4 0c.7.8 1 1.4 1.6 2.4"/>',
  globe:'<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20a15 15 0 0 1 0-20Z"/>',
  clipboard:'<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  calendar:'<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 2v4M16 2v4"/>',
  flame:'<path d="M12 22c4 0 7-2.5 7-6.5 0-4.5-4.5-6-4.5-10.5 0 0-3 1.5-3 5 0 2-1.5 2.5-1.5 1 0-1 .5-2 .5-2S5 11 5 15.5C5 19.5 8 22 12 22Z"/>',
  drop:'<path d="M12 2.7 6.9 8.1a7.2 7.2 0 1 0 10.2 0Z"/>',
  hook:'<path d="M12 2v11a4 4 0 0 1-8 0v-1"/><circle cx="12" cy="20" r="2"/><path d="M12 15v3"/>',
  party:'<path d="m3.5 20.5 5.4-13a1 1 0 0 1 1.7-.2l6.1 6.1a1 1 0 0 1-.2 1.7l-13 5.4Z"/><path d="M15 3v2M19 7h2M17.5 4.5l1.5-1.5M18 12l1.5 1.5"/>',
  help:'<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4"/><path d="M12 17h.01"/>',
  banknote:'<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  handshake:'<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.9-3.9a2 2 0 0 1 0-2.8l.4-.4a2.8 2.8 0 0 0-4 0l-1.6 1.6a2 2 0 0 1-2.8 0l-.4-.4a2 2 0 0 0-2.8 0L2 8.5"/><path d="m2 15 3 3"/>',
  bell:'<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>',
  refresh:'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
  download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  activity:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  pause:'<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play:'<polygon points="6 3 20 12 6 21 6 3"/>',
  star:'<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  flag:'<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  stop:'<rect x="5" y="5" width="14" height="14" rx="2"/>',
  dollar:'<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  alert:'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  note:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  message:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  node:'<circle cx="12" cy="12" r="3"/><path d="M3 12h6"/><path d="M15 12h6"/>',
  clock:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  eye:'<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  archive:'<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  ban:'<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  trash:'<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  x:'<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
  sparkles:'<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  robot:'<rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1"/>',
  eraser:'<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  bookmark:'<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  mail:'<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  dot:'<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
  folder:'<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  truck:'<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  box:'<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  rendimiento:'<line x1="3" y1="21" x2="21" y2="21"/><rect x="6" y="12" width="3.4" height="8" rx="1"/><rect x="11.5" y="8" width="3.4" height="12" rx="1"/><rect x="17" y="4" width="3.4" height="16" rx="1"/>',
  chevronRight:'<path d="m9 18 6-6-6-6"/>',
  chevronLeft:'<path d="m15 18-6-6 6-6"/>',
  image:'<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  video:'<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/>',
  mic:'<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
  file:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  key:'<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  sheet:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  building:'<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  pin:'<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  kanban:'<rect width="7" height="18" x="3" y="3" rx="1.5"/><rect width="7" height="11" x="14" y="3" rx="1.5"/>',
  shield:'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  compass:'<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  printer:'<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect width="12" height="8" x="6" y="14" rx="1"/>',
  copy:'<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  megaphone:'<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  embudo:'<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  lock:'<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  directo:'<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
};
const svg = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${P[n]||""}</svg>`;

// Icono SVG para las páginas (reemplaza emojis de interfaz). Trae stroke-width
// y clase `ico` para dimensionarlo por CSS. Ej: icon("refresh").
export function icon(n, cls = "ico") {
  // width/height en `em` → el icono se ajusta al font-size de su contenedor
  // (sirve sin CSS extra). Las páginas pueden sobrescribir con `.ico{...}`.
  return `<svg class="${cls}" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-.15em;flex:none">${P[n] || ""}</svg>`;
}

// Navegación agrupada (DESIGN_SYSTEM.md §7.2). El grupo sin `sec` va
// arriba sin etiqueta; los demás son colapsables (estado en localStorage).
// Sidebar hacia la simplicidad: arriba lo del día a día; luego lo que se
// configura ("Tu negocio"); y el 80% potente pero avanzado queda agrupado en
// "Avanzado" para no abrumar. Reordenar acá no rompe el resaltado (usa ids).
const NAV_GROUPS = [
  { key:"top", items:[
    { id:"inbox",       label:"Bandeja",              href:"index.html",      icon:"inbox", cta:true },
  ]},
  { key:"resumen", sec:"Resumen", items:[
    { id:"dashboard",   label:"Dashboard",            href:"dashboard.html",  icon:"dashboard" },
    { id:"embudo",      label:"Embudo",               href:"embudo.html",     icon:"embudo" },
    { id:"rendimiento", label:"Rendimiento",          href:"rendimiento.html",icon:"rendimiento" },
  ]},
  { key:"ventas", sec:"Ventas", items:[
    { id:"directo",     label:"Directo",              href:"directo.html",    icon:"directo" },
    { id:"pedidos",     label:"Pedidos",              href:"pedidos.html",    icon:"kanban" },
    { id:"compras",     label:"Compras",              href:"compras.html",    icon:"pedidos" },
    { id:"copiloto",    label:"Pagos por validar",    href:"copiloto.html",   icon:"compass" },
  ]},
  { key:"negocio", sec:"Tu negocio", items:[
    { id:"productos",   label:"Productos",            href:"productos.html",  icon:"productos" },
    { id:"negocio",     label:"Negocio",              href:"negocio.html",    icon:"building" },
    { id:"ia",          label:"IA",                   href:"ia.html",         icon:"robot", special:"ia" },
  ]},
  { key:"marketing", sec:"Marketing", items:[
    { id:"contactos",   label:"Contactos",            href:"contactos.html",  icon:"contactos" },
    { id:"campanas",    label:"Campañas",             href:"campanas.html",   icon:"campanas" },
    { id:"respuestas",  label:"Respuestas rápidas",   href:"respuestas.html", icon:"respuestas" },
    { id:"secuencias",  label:"Secuencias",           href:"secuencias.html", icon:"secuencias" },
  ]},
  { key:"auto", sec:"Automatización", items:[
    { id:"palabras",    label:"Palabras clave",       href:"palabras-clave.html", icon:"palabras" },
    { id:"plantillas",  label:"Plantillas",           href:"plantillas.html", icon:"plantillas" },
    { id:"probar",      label:"Probar flujos",        href:"probar.html",     icon:"probar" },
    { id:"etiquetas",   label:"Etiquetas",            href:"etiquetas.html",  icon:"etiquetas" },
  ]},
  // Avanzado: herramientas de poder que el dueño casi nunca toca. El editor visual
  // de flujos vive acá (el motor de flujos SIGUE corriendo por debajo; esto es solo
  // el editor, para casos raros/depurar). Los campos se crean solos. Arranca
  // colapsado para no abrumar; fuera del menú principal.
  { key:"avanzado", sec:"Avanzado", items:[
    { id:"editor",      label:"Flujos",               href:"editor.html",     icon:"flujos" },
    { id:"campos",      label:"Campos",               href:"campos.html",     icon:"campos" },
  ]},
  { key:"conf", sec:"Configuración", items:[
    { id:"canales",     label:"Canales",              href:"canales.html",    icon:"canales" },
    { id:"cuenta",      label:"Cuenta y equipo",      href:"cuenta.html",     icon:"users" },
    { id:"config",      label:"Ajustes",              href:"config.html",     icon:"config" },
  ]},
];

// ── grupos del sidebar colapsados (persistencia) ────────────────────
function closedGroups() {
  // Primera visita (sin preferencia guardada): "Avanzado" arranca colapsado
  // para no abrumar. Si el usuario ya tocó grupos, se respeta su elección.
  try {
    const raw = localStorage.getItem("nodo.navClosed");
    if (raw == null) return ["auto", "avanzado"];
    return JSON.parse(raw);
  } catch { return []; }
}
function toggleGroup(key, closed) {
  const set = new Set(closedGroups());
  closed ? set.add(key) : set.delete(key);
  localStorage.setItem("nodo.navClosed", JSON.stringify([...set]));
}

// ── toast global (DS §12: esquina inferior derecha, nivel 2) ────────
const TOAST_OK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const TOAST_ERR = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
export function toast(msg, err) {
  let t = document.getElementById("nodo-toast");
  if (!t) {
    t = document.createElement("div"); t.id = "nodo-toast";
    t.style.cssText = "position:fixed;bottom:24px;right:24px;display:flex;align-items:center;gap:11px;padding:12px 17px 12px 12px;border-radius:14px;font-size:13.5px;font-weight:600;letter-spacing:-.1px;opacity:0;transform:translateY(14px) scale(.94);transition:opacity .22s ease,transform .34s cubic-bezier(.34,1.56,.64,1);pointer-events:none;z-index:99999;border:1px solid var(--glass-brd,rgba(255,255,255,.08));background:var(--surface,#151E32);color:var(--text,#F1F5F9);box-shadow:0 14px 38px rgba(0,0,0,.34),0 2px 8px rgba(0,0,0,.2);max-width:min(440px,calc(100vw - 48px))";
    t.innerHTML = '<span id="nodo-toast-ic" style="width:27px;height:27px;border-radius:9px;flex:none;display:flex;align-items:center;justify-content:center"></span><span id="nodo-toast-msg" style="line-height:1.35"></span>';
    document.body.appendChild(t);
  }
  const ic = t.querySelector("#nodo-toast-ic");
  ic.innerHTML = err ? TOAST_ERR : TOAST_OK;
  ic.style.background = err ? "rgba(226,86,74,.16)" : "rgba(34,192,121,.16)";
  ic.style.color = err ? "var(--red,#e2564a)" : "var(--green,#22c079)";
  ic.style.boxShadow = `0 0 0 1px ${err ? "rgba(226,86,74,.28)" : "rgba(34,192,121,.28)"} inset`;
  // El check ya vive en el badge de la izquierda → quitamos cualquier ✓/✔ del
  // texto para no repetirlo (ej. "Guardado ✓" → "Guardado") y limpiamos espacios
  // o separadores "·" que queden sueltos.
  const clean = String(msg == null ? "" : msg)
    .replace(/[✓✔]/gu, " ").replace(/\s{2,}/g, " ").replace(/^[\s·]+|[\s·]+$/g, "").trim();
  t.querySelector("#nodo-toast-msg").textContent = clean;
  t.style.opacity = "1"; t.style.transform = "translateY(0) scale(1)";
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateY(14px) scale(.94)"; }, 3800);
}

// ── tema ────────────────────────────────────────────────────────────
export function getTheme() { return localStorage.getItem("nodo.theme") || "dark"; }
export function applyTheme(t) { document.documentElement.dataset.theme = t; localStorage.setItem("nodo.theme", t); }
applyTheme(getTheme()); // aplicar cuanto antes (evita parpadeo)

// ── Marca cacheada (evita el parpadeo del logo al navegar) ──────────
// Guardamos el logo/nombre del bot activo para pintarlos al instante en
// la siguiente página, sin esperar la consulta a Supabase.
function readBrandCache() {
  try { return JSON.parse(localStorage.getItem("nodo.brand") || "null"); } catch { return null; }
}
function writeBrandCache(b) {
  try { localStorage.setItem("nodo.brand", JSON.stringify(b)); } catch {}
}

// ── Usuario (chip de perfil en el pie del sidebar) ──────────────────
function readMeCache() { try { return JSON.parse(localStorage.getItem("nodo.me") || "null"); } catch { return null; } }
function writeMeCache(m) { try { localStorage.setItem("nodo.me", JSON.stringify(m)); } catch {} }
const ROLE_ES = { admin: "Administrador", owner: "Propietario", propietario: "Propietario", operador: "Operador", operator: "Operador", viewer: "Solo lectura" };
export function paintUserChip(info) { // usado por el shell y por Perfil (tras guardar)
  const nav = S.nav || document.querySelector(".nodo-nav");
  if (!nav || !info) return;
  const nm = nav.querySelector("#nodoUserName"), rl = nav.querySelector("#nodoUserRole"), av = nav.querySelector("#nodoUserAv");
  if (nm) nm.textContent = info.name || "Perfil";
  if (rl) rl.textContent = info.role || "Mi cuenta";
  if (av) { if (info.avatar) { av.innerHTML = '<img alt="" />'; av.querySelector("img").src = info.avatar; } else av.textContent = (info.name || "?").trim().charAt(0).toUpperCase() || "?"; }
}
async function loadMe(nav) {
  try {
    const cached = readMeCache();
    if (cached) paintUserChip(cached);
    const { data: { session } } = await supa.auth.getSession();
    if (!session) return;
    let me = null;
    try { ({ data: me } = await supa.from("app_users").select("nombre,role,avatar_url").eq("id", session.user.id).maybeSingle()); } catch {}
    const rl = (me?.role || "").toString();
    const info = {
      name: (me?.nombre && me.nombre.trim()) || (session.user.email || "").split("@")[0] || "Perfil",
      role: ROLE_ES[rl.toLowerCase()] || rl || "Mi cuenta",
      avatar: me?.avatar_url || null,
    };
    writeMeCache(info); paintUserChip(info);
  } catch (e) { console.error("[me]", e); }
}
// Permite que Perfil refresque el chip tras editar nombre/foto (merge con lo cacheado).
export function refreshUserChip(info) {
  const merged = Object.assign({}, readMeCache() || {}, info || {});
  writeMeCache(merged); paintUserChip(merged);
}

// ── Crear nuevo bot (= nuevo canal / espacio independiente) ─────────
// Un bot es un `channels` con su propia bandeja, contactos, flujos,
// productos, configuración y pixel. Solo `nombre` es obligatorio; el
// número de WhatsApp/pixel se conectan luego en Canales.
function openCreateBot() {
  if (document.getElementById("nb-modal")) return;
  const back = document.createElement("div");
  back.id = "nb-modal"; back.className = "nodo-modal-back";
  back.innerHTML = `
    <div class="nodo-modal" role="dialog" aria-modal="true" aria-label="Crear nuevo bot">
      <h3>Crear nuevo bot</h3>
      <p>Cada bot es un <b>espacio independiente</b> dentro de tu cuenta: su propia bandeja, contactos, flujos, productos, configuración y pixel. El número de WhatsApp y el pixel se conectan después, en <b>Canales</b>.</p>
      <label for="nbName">Nombre del bot</label>
      <input id="nbName" placeholder="Ej. Mi Negocio 2" maxlength="60" autocomplete="off" />
      <div class="nb-acts">
        <button class="nb-btn" id="nbCancel" type="button">Cancelar</button>
        <button class="nb-btn primary" id="nbCreate" type="button">Crear bot</button>
      </div>
    </div>`;
  document.body.appendChild(back);
  const input = back.querySelector("#nbName");
  const close = () => back.remove();
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  back.querySelector("#nbCancel").onclick = close;
  const create = async () => {
    const nombre = input.value.trim();
    if (!nombre) { input.focus(); return; }
    const btn = back.querySelector("#nbCreate"); btn.disabled = true; btn.textContent = "Creando…";
    const { data, error } = await supa.from("channels").insert({ nombre }).select("id,nombre").single();
    if (error) { btn.disabled = false; btn.textContent = "Crear bot"; toast(error.message || "No se pudo crear el bot", true); return; }
    S.channels.push({ id: data.id, nombre: data.nombre, logo_url: null });
    S.channels.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
    close();
    toast("Bot creado — conéctalo en Canales");
    // Guard de cambios sin guardar ANTES de cambiar de bot (setChannel recarga la página y
    // descartaría ediciones en silencio): el selector de bot existente ya lo respeta, esta
    // ruta no. Si hay cambios y el operador cancela, el bot queda creado y sigue en su página.
    if (!(await _dirtyGate())) return;
    S.api.setChannel(data.id); // cambia al bot nuevo (recarga los datos de la página)
  };
  back.querySelector("#nbCreate").onclick = create;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") create(); else if (e.key === "Escape") close(); });
  setTimeout(() => input.focus(), 30);
}
// ═══════════════════════════════════════════════════════════════════
//  Diálogos nativos de la app (reemplazan prompt()/confirm() del
//  navegador por modales con la identidad de Nodo). Todos devuelven una
//  Promesa. Respetan mayúsculas/minúsculas del texto que escribe el user.
// ═══════════════════════════════════════════════════════════════════
// Párrafo de mensaje de un diálogo. `message` se ESCAPA siempre (puede traer
// texto atacante-controlado: el nombre de perfil de WhatsApp del cliente entra
// como `c.nombre` en varios diálogos → sería XSS almacenado si fuera HTML crudo).
// Para el markup intencional (negritas, <br> de los avisos de desconexión, etc.)
// el caller pasa `messageHtml`, que confía y NO se escapa: ahí el caller es
// responsable de escapar cualquier dato variable que interpole.
function dlgMsg(o) {
  if (o.messageHtml != null) return `<p>${o.messageHtml}</p>`;
  return o.message ? `<p>${escHtml(o.message)}</p>` : "";
}
function mountModal(html, { onClose } = {}) {
  const back = document.createElement("div");
  back.className = "nodo-modal-back";
  back.innerHTML = html;
  document.body.appendChild(back);
  const close = () => { back.remove(); onClose && onClose(); };
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  return { back, close };
}
// Pide un texto (reemplaza prompt). opts: {title, message, label, placeholder,
// value, confirmText, multiline}. Resuelve con el string (recortado) o null si cancela.
export function askText(opts = {}) {
  const o = typeof opts === "string" ? { title: opts } : opts;
  return new Promise((resolve) => {
    let settled = false;
    const field = o.multiline
      ? `<textarea id="nmInput" rows="4" placeholder="${escAttr(o.placeholder || "")}">${escHtml(o.value || "")}</textarea>`
      : `<input id="nmInput" type="text" placeholder="${escAttr(o.placeholder || "")}" value="${escAttr(o.value || "")}" autocomplete="off" />`;
    const { back, close } = mountModal(`
      <div class="nodo-modal" role="dialog" aria-modal="true">
        <h3>${escHtml(o.title || "")}</h3>
        ${dlgMsg(o)}
        ${o.label ? `<label for="nmInput">${escHtml(o.label)}</label>` : ""}
        ${field}
        <div class="nb-acts">
          <button class="nb-btn" id="nmCancel" type="button">${escHtml(o.cancelText || "Cancelar")}</button>
          <button class="nb-btn primary" id="nmOk" type="button">${escHtml(o.confirmText || "Aceptar")}</button>
        </div>
      </div>`, { onClose: () => { if (!settled) { settled = true; resolve(null); } } });
    const input = back.querySelector("#nmInput");
    const okBtn = back.querySelector("#nmOk");
    const done = (v) => { settled = true; resolve(v); back.remove(); };
    // El texto vacío nunca se acepta (el onclick ya lo bloqueaba en silencio, sin
    // feedback). Ahora el botón se ve deshabilitado mientras el campo esté vacío,
    // así el usuario entiende por qué no pasa nada. Aplica a TODOS los askText.
    const sync = () => { okBtn.disabled = !input.value.trim(); okBtn.style.opacity = okBtn.disabled ? ".5" : ""; okBtn.style.cursor = okBtn.disabled ? "not-allowed" : ""; };
    input.addEventListener("input", sync); sync();
    back.querySelector("#nmCancel").onclick = () => close();
    okBtn.onclick = () => { const v = input.value.trim(); if (!v) { input.focus(); return; } done(v); };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !o.multiline) { e.preventDefault(); const v = input.value.trim(); if (v) done(v); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    });
    setTimeout(() => { input.focus(); if (input.select) input.select(); }, 30);
  });
}
// Confirmación (reemplaza confirm). opts: {title, message, confirmText,
// cancelText, danger}. Resuelve true/false.
export function confirmDialog(opts = {}) {
  const o = typeof opts === "string" ? { message: opts } : opts;
  return new Promise((resolve) => {
    let settled = false;
    const { back, close } = mountModal(`
      <div class="nodo-modal" role="dialog" aria-modal="true">
        <h3>${escHtml(o.title || "¿Confirmar?")}</h3>
        ${dlgMsg(o)}
        <div class="nb-acts">
          <button class="nb-btn" id="nmCancel" type="button">${escHtml(o.cancelText || "Cancelar")}</button>
          <button class="nb-btn ${o.danger ? "danger" : "primary"}" id="nmOk" type="button">${escHtml(o.confirmText || "Confirmar")}</button>
        </div>
      </div>`, { onClose: () => { if (!settled) { settled = true; resolve(false); } } });
    back.querySelector("#nmCancel").onclick = () => close();
    back.querySelector("#nmOk").onclick = () => { settled = true; resolve(true); back.remove(); };
    const okBtn = back.querySelector("#nmOk");
    back.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    setTimeout(() => okBtn.focus(), 30);
  });
}
// Selector de opciones (reemplaza selects nativos feos). opts: {title, message,
// options:[{value,label,desc,icon}], value}. Resuelve el value elegido o null.
export function askChoice(opts = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const rows = (opts.options || []).map((op) => `
      <button class="nodo-choice${op.value === opts.value ? " on" : ""}" type="button" data-v="${escAttr(op.value)}">
        ${op.icon ? `<span class="nc-ic">${icon(op.icon)}</span>` : ""}
        <span class="nc-tx"><b>${escHtml(op.label)}</b>${op.desc ? `<small>${escHtml(op.desc)}</small>` : ""}</span>
        <span class="nc-ck">${svg("check")}</span>
      </button>`).join("");
    const { back, close } = mountModal(`
      <div class="nodo-modal" role="dialog" aria-modal="true">
        <h3>${escHtml(opts.title || "Elige una opción")}</h3>
        ${dlgMsg(opts)}
        <div class="nodo-choices">${rows}</div>
        <div class="nb-acts"><button class="nb-btn" id="nmCancel" type="button">Cancelar</button></div>
      </div>`, { onClose: () => { if (!settled) { settled = true; resolve(null); } } });
    back.querySelectorAll(".nodo-choice").forEach((b) => b.onclick = () => { settled = true; resolve(b.dataset.v); back.remove(); });
    back.querySelector("#nmCancel").onclick = () => close();
    // Escape cierra, igual que askText/confirmDialog (antes solo cerraba con el
    // botón o clic afuera → inconsistente con los otros diálogos).
    back.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    setTimeout(() => back.querySelector("#nmCancel")?.focus(), 30);
  });
}
function escHtml(s) { return (s ?? "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function escAttr(s) { return escHtml(s).replace(/"/g, "&quot;"); }

// Normaliza para buscar SIN tildes ni mayúsculas: "José" y "jose" coinciden.
// Sin esto, un operador que escribe sin tilde nunca encuentra "María",
// "Ramírez", "Ángel"… (nombres peruanos comunes) en ninguna Bandeja/lista.
export function norm(s) { return (s ?? "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }

// ── Guarda de "cambios sin guardar" ─────────────────────────────────
// Las pantallas-formulario (Productos, Negocio, IA) usan Guardar explícito;
// como TODO navega por SPA (BOUNDARY vacío) y el bot se cambia en el sitio,
// salir a media edición perdía todo en silencio. Una página llama a
// guardUnsaved(selector) en su boot: a partir de ahí, editar cualquier input
// DENTRO de ese contenedor marca "sucio", y al intentar salir (nav del
// sidebar, cambio de bot, cerrar/recargar la pestaña) se pide confirmación.
// La página llama markClean() cuando guarda con éxito. El contenedor acota el
// rastreo para que la búsqueda/filtros y los modales de shell (que cuelgan del
// body) no marquen sucio por error.
let _dirty = false, _guardSel = null, _dirtyWired = false;
export function guardUnsaved(selector) {
  _guardSel = selector || ".nodo-page"; _dirty = false;
  if (_dirtyWired) return; _dirtyWired = true;
  // [data-noguard] marca sub-secciones con su PROPIO botón Guardar (p. ej. el
  // horario global en la ficha del producto): editarlas no debe ensuciar el
  // formulario principal ni pedir confirmación al salir tras guardarlas.
  const mark = (e) => { const t = e.target; if (_guardSel && t && t.closest && t.closest(_guardSel) && !t.closest("[data-noguard]")) _dirty = true; };
  document.addEventListener("input", mark, true);
  document.addEventListener("change", mark, true);
  window.addEventListener("beforeunload", (e) => { if (_dirty) { e.preventDefault(); e.returnValue = ""; } });
}
export function markClean() { _dirty = false; }
export function markDirty() { if (_guardSel) _dirty = true; }
export function isDirty() { return _dirty; }
// Trae TODAS las filas de una consulta paginando (Supabase/PostgREST topa en ~1000 por
// request). `makeQuery(from,to)` debe devolver una query FRESCA con `.range(from,to)` y
// un orden ESTABLE (incluye un desempate por id para no repetir/saltar filas entre
// páginas). Tope de seguridad para no colgar el navegador con un canal gigante.
export async function pageAll(makeQuery, { pageSize = 1000, max = 100000 } = {}) {
  const out = []; let from = 0;
  while (from < max) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error) return { data: out, error, truncado: false };
    const rows = data || [];
    out.push(...rows);
    if (rows.length < pageSize) return { data: out, error: null, truncado: false };
    from += pageSize;
  }
  return { data: out, error: null, truncado: true }; // llegó al tope de seguridad
}
// Parte una lista de ids en trozos para los `.in(...)`. NO es cosmético: la lista viaja en
// la URL y el servidor la rechaza cuando se pasa. Medido contra la base: 500 ids (18 KB de
// URL) pasan, 800 devuelven 400 y con 2000 la petición ni sale. 300 deja margen de sobra.
export function enTrozos(arr, n = 300) {
  const out = [];
  for (let i = 0; i < (arr || []).length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
// Freno para el realtime de las pantallas cuya carga es CARA (las que se traen el
// histórico completo del canal: Directo, Contactos, Embudo). El realtime de `contacts`
// se dispara con CADA mensaje que entra, porque cada mensaje toca `ultimo_mensaje_at`.
// Un handler que llamaba a recargar directo dejaba al panel bajando todo una y otra vez
// mientras el bot tuviera movimiento — y también en una pestaña de fondo que nadie mira.
// Devuelve la función que se le pasa al `.on(...)`: agrupa las ráfagas en una sola carga,
// respeta un mínimo entre cargas, y con la pestaña oculta no hace nada (deja la recarga
// pendiente y la ejecuta al volver, así no te encuentras datos viejos).
// `.marcar()` avisa de una carga hecha por otro camino (la inicial, o cambiar de bot).
export function recargaConFreno(cargar, { minEntre = 8000, esperaMin = 1500 } = {}) {
  let timer = null, ultima = 0, pendiente = false;
  const disparar = () => {
    if (document.hidden) { pendiente = true; return; }
    clearTimeout(timer);
    const espera = Math.max(esperaMin, minEntre - (Date.now() - ultima));
    timer = setTimeout(() => { ultima = Date.now(); pendiente = false; cargar(); }, espera);
  };
  document.addEventListener("visibilitychange", () => { if (!document.hidden && pendiente) disparar(); });
  disparar.marcar = () => { ultima = Date.now(); };
  return disparar;
}
// Se resetea al cambiar de página (teardown): la nueva vuelve a opt-in si toca.
function _resetGuard() { _guardSel = null; _dirty = false; }
// true = se puede salir; pregunta solo si hay cambios sin guardar.
async function _dirtyGate() {
  if (!_dirty) return true;
  const ok = await confirmDialog({ title: "Cambios sin guardar", message: "Hiciste cambios que no guardaste. Si sales ahora se perderán.", confirmText: "Salir sin guardar", cancelText: "Seguir aquí", danger: true });
  if (ok) _dirty = false;
  return ok;
}

// Favicon dinámico = logo del bot elegido.
export function setFavicon(href) {
  if (!href) return;
  document.querySelectorAll('link[rel~="icon"]').forEach((l) => l.parentNode.removeChild(l));
  const l = document.createElement("link");
  l.rel = "icon"; l.href = href;
  document.head.appendChild(l);
}

// ═══════════════════════════════════════════════════════════════════
//  SPA — estado singleton + router client-side
//  El shell (sidebar) se monta UNA vez y persiste; al navegar entre
//  páginas de shell completo se hace fetch del HTML destino y se cambia
//  solo el contenido (sin recargar). Bandeja (minimal) y Editor son
//  "fronteras": navegación normal. Ante cualquier fallo → location.href.
// ═══════════════════════════════════════════════════════════════════
const BOUNDARY = new Set(); // todo navega por SPA (la Bandeja colapsa el sidebar en vez de recargar)
const pageCache = new Map();  // pathname → html (para navegaciones repetidas)
const S = {
  nav: null, api: null, botSel: null, logo: null, brandName: null,
  paintBrand: null, subs: [], leaves: [],
  channels: [], channelId: null, loaded: false,
  routerReady: false, pageStyles: [],
};

const fileOf = (path) => path.split("/").pop() || "";

// ═══════════════════════════════════════════════════════════════════
//  Efectos de fondo — aurora + constelación de nodos (concepto de marca)
//  Configurable en Ajustes → Apariencia. Salvaguardas de rendimiento:
//  se pausa al ocultar la pestaña, tope de 64 nodos, glow con sprite
//  (sin shadowBlur), FPS configurable y respeta prefers-reduced-motion.
// ═══════════════════════════════════════════════════════════════════
const FX_LEVELS = ["full", "suave", "off"];
// El fondo animado (constelación) es un canvas a pantalla completa que se
// redibuja y RECOMPONE cada frame → cuesta CPU/GPU de forma continua y hace
// sentir pesado todo el navegador apenas se abre la app. Es decorativo, así
// que va APAGADO por defecto (opt-in): quien lo quiera lo enciende en
// Ajustes → Apariencia y su elección se recuerda.
export function getEffects() {
  let level = localStorage.getItem("nodo.fx.level");
  if (!FX_LEVELS.includes(level)) level = "off"; // default: sin fondo animado
  let fps = parseInt(localStorage.getItem("nodo.fx.fps") || "", 10);
  if (!Number.isFinite(fps)) fps = 30; // si lo encienden, 30 fps se ve fluido y cuesta la mitad
  fps = Math.min(60, Math.max(20, fps));
  return { level, fps };
}
export function setEffects({ level, fps } = {}) {
  if (level && FX_LEVELS.includes(level)) localStorage.setItem("nodo.fx.level", level);
  if (fps) localStorage.setItem("nodo.fx.fps", String(Math.min(60, Math.max(20, fps | 0))));
  if (getEffects().level !== "off") ensureFX(); // encenderlo desde Ajustes → monta la capa si aún no existe
  applyEffects();
  return getEffects();
}

const FX = { built: false, cv: null, cx: null, W: 0, H: 0, DPR: 1, nodes: [], signals: [], sprites: {}, sig: null, COL: [], raf: 0, last: 0, mouse: { x: -1e4, y: -1e4 }, reduce: false, level: "suave", fps: 60 };

function fxColors() {
  // En la sección IA las estrellas se vuelven violeta/fucsia (galaxia).
  if (document.documentElement.dataset.ia === "on")
    return getTheme() !== "light" ? ["168,85,247", "236,72,153", "139,92,246"] : ["168,85,247", "217,70,239", "124,58,237"];
  return getTheme() !== "light" ? ["0,125,253", "56,189,248", "96,165,250"] : ["0,113,230", "14,165,233", "59,130,246"];
}
function fxSprite(rgb) {
  const r = 16, s = document.createElement("canvas"); s.width = s.height = r * 2;
  const g = s.getContext("2d"), grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, `rgba(${rgb},.95)`); grd.addColorStop(.45, `rgba(${rgb},.35)`); grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd; g.beginPath(); g.arc(r, r, r, 0, 7); g.fill(); return s;
}
function fxBuildSprites() {
  FX.COL = fxColors();
  FX.sprites = {}; FX.COL.forEach((c) => { FX.sprites[c] = fxSprite(c); });
  FX.sig = fxSprite("226,244,255");
}
function fxRetheme() { // recolorea + arranca/detiene el canvas según el tema
  if (!FX.built) return;
  fxBuildSprites();
  FX.nodes.forEach((p) => { p.c = FX.COL[(Math.random() * FX.COL.length) | 0]; });
  applyEffects();
}
function fxResize() {
  if (!FX.cv) return;
  // El canvas es decorativo y va detrás de todo → renderizar a DPR 1 (no 2)
  // reduce ~4× el trabajo de píxeles/compositing. "full" sube a 1.5.
  FX.DPR = Math.min(devicePixelRatio || 1, FX.level === "full" ? 1.5 : 1);
  FX.W = FX.cv.width = Math.floor(innerWidth * FX.DPR);
  FX.H = FX.cv.height = Math.floor(innerHeight * FX.DPR);
  FX.cv.style.width = innerWidth + "px"; FX.cv.style.height = innerHeight + "px";
  // Menos nodos = menos O(n²) por frame. Tope 40 (full) / 28 (suave).
  const cap = FX.level === "full" ? 40 : 28;
  const n = Math.min(cap, Math.max(16, Math.round(innerWidth * innerHeight / 44000)));
  FX.nodes = Array.from({ length: n }, () => ({
    x: Math.random() * FX.W, y: Math.random() * FX.H,
    vx: (Math.random() - .5) * .10 * FX.DPR, vy: (-Math.random() * .14 - .03) * FX.DPR,
    r: (Math.random() * 1.9 + 1.2) * FX.DPR, c: FX.COL[(Math.random() * FX.COL.length) | 0],
    tw: .02 + Math.random() * .03, ph: Math.random() * 6.28, // parpadeo (estrellas)
  }));
  fxSeedSignals();
}
function fxNeighbors(i, maxD) {
  const out = [];
  for (let j = 0; j < FX.nodes.length; j++) {
    if (j === i) continue;
    const dx = FX.nodes[i].x - FX.nodes[j].x, dy = FX.nodes[i].y - FX.nodes[j].y;
    if (dx * dx + dy * dy < maxD * maxD) out.push(j);
  }
  return out;
}
function fxNewSignal() {
  if (!FX.nodes.length) return null;
  const maxD = 140 * FX.DPR, i = (Math.random() * FX.nodes.length) | 0, nb = fxNeighbors(i, maxD);
  if (!nb.length) return null;
  const j = nb[(Math.random() * nb.length) | 0];
  return { a: i, b: j, t: 0, spd: .006 + Math.random() * .01 };
}
function fxSeedSignals() {
  const cap = FX.level === "off" ? 0 : FX.level === "suave" ? 2 : 6;
  FX.signals = [];
  for (let k = 0; k < cap; k++) { const s = fxNewSignal(); if (s) FX.signals.push(s); }
}
function fxDraw() {
  if (!FX.cx) return;
  const cx = FX.cx;
  cx.clearRect(0, 0, FX.W, FX.H);
  if (FX.level === "off") return;
  // Perf: comparar distancias AL CUADRADO (evita Math.hypot en el bucle O(n²));
  // solo se calcula la raíz cuando el par realmente está dentro del radio.
  const maxD = 140 * FX.DPR, mR = 190 * FX.DPR, maxD2 = maxD * maxD, mR2 = mR * mR;
  const mx = FX.mouse.x, my = FX.mouse.y, hasM = mx > -9000;
  FX.t = (FX.t || 0) + 1;
  const lw = FX.DPR;
  // aristas base + refuerzo cerca del cursor
  for (let i = 0; i < FX.nodes.length; i++) for (let j = i + 1; j < FX.nodes.length; j++) {
    const a = FX.nodes[i], b = FX.nodes[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
    if (d2 < maxD2) {
      const d = Math.sqrt(d2);
      let al = .12 * (1 - d / maxD);
      if (hasM) { const cxx = (a.x + b.x) / 2 - mx, cyy = (a.y + b.y) / 2 - my, md2 = cxx * cxx + cyy * cyy; if (md2 < mR2) al += .4 * (1 - Math.sqrt(md2) / mR); }
      cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y);
      cx.strokeStyle = `rgba(${a.c},${al})`; cx.lineWidth = lw; cx.stroke();
    }
  }
  // constelación al cursor: une entre sí las estrellas cercanas al puntero
  if (hasM) {
    const near = [];
    for (const p of FX.nodes) { const ddx = p.x - mx, ddy = p.y - my; if (ddx * ddx + ddy * ddy < mR2) near.push(p); }
    for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
      const a = near[i], b = near[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 < mR2) { const d = Math.sqrt(d2); cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.strokeStyle = `rgba(${a.c},${.18 * (1 - d / mR)})`; cx.lineWidth = lw; cx.stroke(); }
    }
  }
  // estrellas HD: halo + núcleo nítido + parpadeo (brillan cerca del cursor)
  for (const p of FX.nodes) {
    p.x += p.vx; p.y += p.vy;
    if (p.y < -14) p.y = FX.H + 14; if (p.x < -14) p.x = FX.W + 14; if (p.x > FX.W + 14) p.x = -14;
    const tw = .72 + .28 * Math.sin(FX.t * p.tw + p.ph);
    const boost = hasM ? Math.max(0, 1 - Math.hypot(p.x - mx, p.y - my) / mR) : 0;
    const size = p.r * 7 * (1 + boost * .5);
    cx.globalAlpha = Math.min(1, tw + boost * .4);
    cx.drawImage(FX.sprites[p.c] || FX.sig, p.x - size / 2, p.y - size / 2, size, size);
    cx.globalAlpha = Math.min(1, tw + .18 + boost * .3);
    cx.beginPath(); cx.arc(p.x, p.y, p.r * .9 * (1 + boost * .3), 0, 7); cx.fillStyle = "rgba(234,241,255,.95)"; cx.fill();
  }
  cx.globalAlpha = 1;
  // señales viajando por las conexiones (datos fluyendo)
  for (let k = 0; k < FX.signals.length; k++) {
    const s = FX.signals[k]; s.t += s.spd;
    if (s.t >= 1) { FX.signals[k] = fxNewSignal() || { a: s.b, b: s.a, t: 0, spd: s.spd }; continue; }
    const a = FX.nodes[s.a], b = FX.nodes[s.b]; if (!a || !b) { FX.signals[k] = fxNewSignal() || s; continue; }
    const x = a.x + (b.x - a.x) * s.t, y = a.y + (b.y - a.y) * s.t, sz = 10 * FX.DPR;
    cx.drawImage(FX.sig, x - sz / 2, y - sz / 2, sz, sz);
  }
}
function fxStop() { cancelAnimationFrame(FX.raf); FX.raf = 0; }
function fxStart() {
  fxStop();
  if (FX.reduce) { fxDraw(); return; } // sin animación: un solo cuadro
  const loop = (now) => {
    if (FX.level === "off") { FX.raf = 0; return; } // apagado → detener el bucle del todo
    FX.raf = requestAnimationFrame(loop);
    if (now - FX.last < 1000 / FX.fps) return; // throttle a los FPS elegidos
    FX.last = now;
    fxDraw();
  };
  FX.last = performance.now();
  FX.raf = requestAnimationFrame(loop);
}
function applyEffects() {
  const e = getEffects();
  FX.level = e.level; FX.fps = e.fps;
  document.documentElement.setAttribute("data-nfx", e.level);
  if (!FX.built) return;
  fxSeedSignals();
  const dark = getTheme() !== "light"; // sin estrellas de día → canvas detenido
  if (e.level === "off" || !dark) { fxStop(); FX.cx && FX.cx.clearRect(0, 0, FX.W, FX.H); }
  else if (document.visibilityState !== "hidden") { fxStart(); }
}
// Nebulosa violeta/fucsia detrás de la sección IA: capa fija propia y barata
// (degradados radiales + deriva por transform, todo en GPU). Independiente del
// canvas de estrellas, así que se muestra aunque el fondo esté en Off — es el
// sello visual de la sección IA. Aparece/desaparece con fade (data-ia).
function setIaBackdrop(active) {
  if (!document.getElementById("nodo-nebula")) {
    const neb = document.createElement("div");
    neb.id = "nodo-nebula"; neb.className = "nodo-nebula"; neb.setAttribute("aria-hidden", "true");
    document.body.insertBefore(neb, document.body.firstChild);
  }
  const on = active === "ia";
  const was = document.documentElement.dataset.ia === "on";
  document.documentElement.dataset.ia = on ? "on" : "";
  if (on !== was && FX.built) fxRetheme(); // recolorea las estrellas al entrar/salir de IA
}
function ensureFX() {
  if (FX.built || document.getElementById("nodo-fx")) return;
  const eff = getEffects();
  if (eff.level === "off") return; // apagado → ni siquiera montar la capa (aurora CSS incluida)
  FX.level = eff.level; FX.fps = eff.fps; // fijar nivel ANTES del primer fxResize (elige DPR/nodos)
  try {
    FX.reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
    const box = document.createElement("div");
    box.id = "nodo-fx"; box.className = "nodo-fx"; box.setAttribute("aria-hidden", "true");
    box.innerHTML = `<div class="nfx-aurora"><i class="a1"></i><i class="a2"></i><i class="a3"></i></div><canvas class="nfx-canvas"></canvas><div class="nfx-veil"></div>`;
    document.body.insertBefore(box, document.body.firstChild);
    FX.cv = box.querySelector(".nfx-canvas"); FX.cx = FX.cv.getContext("2d");
    FX.built = true;
    fxBuildSprites(); fxResize();
    addEventListener("resize", fxResize, { passive: true });
    addEventListener("pointermove", (e) => { FX.mouse.x = e.clientX * FX.DPR; FX.mouse.y = e.clientY * FX.DPR; }, { passive: true });
    document.addEventListener("mouseleave", () => { FX.mouse.x = -1e4; FX.mouse.y = -1e4; });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") fxStop(); else applyEffects();
    });
    applyEffects();
  } catch (e) { console.error("[FX]", e); } // decorativo: nunca romper la app
}

// ── Cascarón ────────────────────────────────────────────────────────
export async function mountShell({ active } = {}) {
  // Branding inicial desde caché (mismo bot que la última página) → sin parpadeo.
  const savedId = localStorage.getItem("nodo.channelId");
  const cachedBrand = readBrandCache();
  const brandHit = cachedBrand && cachedBrand.id === savedId;
  const initLogo = brandHit && cachedBrand.logo ? cachedBrand.logo : FALLBACK_LOGO;
  const initName = brandHit && cachedBrand.name ? cachedBrand.name : "Nodo";
  setFavicon(initLogo); // aplica el favicon del bot cuanto antes
  // Marcar el nivel de efectos SIEMPRE (incluso "off") para que el CSS pueda
  // condicionar el glass/backdrop-filter (caro) a cuando hay fondo que frostear.
  document.documentElement.setAttribute("data-nfx", getEffects().level);
  ensureFX();           // capa de efectos de fondo (se auto-protege de doble init)
  setIaBackdrop(active); // galaxia violeta detrás de la sección IA (entra/sale)

  // ── Re-entrada SPA: el shell ya está montado → no reconstruir.
  if (S.nav && document.body.contains(S.nav)) {
    S.subs = []; S.leaves = [];      // limpia suscripciones/cleanups de la página anterior
    updateActive(active);
    applyInboxCollapse(active);
    return S.api;
  }

  const nav = document.createElement("aside");
  const startCollapsed = localStorage.getItem("nodo.collapsed") === "1";
  nav.className = "nodo-nav" + (startCollapsed ? " collapsed" : "");
  // Ítems: el grupo primario (Bandeja/Dashboard/Pedidos) va FIJO fuera del
  // scroll; los demás grupos van dentro del área scrolleable.
  const itemHTML = (it) => it.cta
    ? `<a class="nodo-link nodo-cta${it.id === active ? " active" : ""}" data-nav="${it.id}" href="${it.href}" title="${it.label}"><span class="cta-in"></span>${svg(it.icon)}<span class="nodo-lbl">${it.label}</span><span class="cta-dot"></span></a>`
    : `<a class="nodo-link${it.special ? " nodo-link-" + it.special : ""}${it.id === active ? " active" : ""}" data-nav="${it.id}" href="${it.href}" title="${it.label}">${svg(it.icon)}<span class="nodo-lbl">${it.label}</span></a>`;
  const topGroup = NAV_GROUPS.find((g) => !g.sec);
  const primaryHTML = (topGroup ? topGroup.items : []).map(itemHTML).join("");
  const groupsHTML = NAV_GROUPS.filter((g) => g.sec).map((g) => {
    const items = g.items.map(itemHTML).join("");
    const closed = closedGroups().includes(g.key) && !g.items.some((it) => it.id === active);
    return `<div class="nodo-group${closed ? " closed" : ""}" data-g="${g.key}"><button class="nodo-sec" type="button">${g.sec}${svg("chevron")}</button><div class="nodo-gitems">${items}</div></div>`;
  }).join("");
  nav.innerHTML = `
    <div class="nodo-brand">
      <button class="nodo-botsel" id="nodoBotBtn" type="button" title="Cambiar de bot">
        <img class="nb-logo" id="nodoBotLogo" src="${escAttr(initLogo)}" alt="" />
        <span class="nb-name" id="nodoBotName">${escHtml(initName)}</span>
        <svg class="nb-cx" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <button class="nodo-icnbtn" id="nodoCollapse" title="Comprimir menú"><span class="cl-shrink">${svg("panel")}</span><span class="cl-grow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></span></button>
    </div>
    <nav class="nodo-primary">${primaryHTML}</nav>
    <nav class="nodo-links">${groupsHTML}</nav>
    <div class="nodo-foot">
      <div class="nodo-userrow">
        <a class="nodo-user${active === "perfil" ? " active" : ""}" data-nav="perfil" href="perfil.html" title="Mi perfil y cuenta">
          <span class="nu-av" id="nodoUserAv">?</span>
          <span class="nu-meta"><b id="nodoUserName">Perfil</b><small id="nodoUserRole">Mi cuenta</small></span>
        </a>
        <button class="nodo-icnbtn" id="nodoTheme" title="Cambiar tema"></button>
      </div>
    </div>`;
  document.body.classList.add("nodo-shelled");
  document.querySelectorAll(".nodo-nav").forEach((n) => n.remove()); // sin sidebars duplicados
  document.body.insertBefore(nav, document.body.firstChild);
  S.nav = nav;

  // Tema toggle
  const themeBtn = nav.querySelector("#nodoTheme");
  const paintTheme = () => {
    const dark = getTheme() === "dark";
    themeBtn.innerHTML = svg(dark ? "sun" : "moon");
    themeBtn.title = dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
  };
  paintTheme();
  themeBtn.onclick = () => { applyTheme(getTheme() === "dark" ? "light" : "dark"); paintTheme(); fxRetheme(); };

  // Grupos colapsables (persisten en localStorage)
  nav.querySelectorAll(".nodo-group > .nodo-sec").forEach((btn) => {
    btn.onclick = () => {
      const g = btn.parentElement;
      g.classList.toggle("closed");
      toggleGroup(g.dataset.g, g.classList.contains("closed"));
    };
  });

  // Comprimir (no existe en modo minimal)
  const collapseBtn = nav.querySelector("#nodoCollapse");
  if (collapseBtn) collapseBtn.onclick = () => {
    nav.classList.toggle("collapsed");
    localStorage.setItem("nodo.collapsed", nav.classList.contains("collapsed") ? "1" : "0");
  };

  // Logout (solo existe en el rail minimal; en el completo vive en Perfil)
  const logoutBtn = nav.querySelector("#nodoLogout");
  if (logoutBtn) logoutBtn.onclick = async () => {
    // Limpia el caché LOCAL antes de salir: en una PC compartida, loadMe/paintBrand pintan
    // primero desde caché, así que sin esto el SIGUIENTE usuario veía el nombre/rol/logo/negocio
    // del anterior hasta que refrescara la red (fuga de identidad/negocio).
    try { localStorage.removeItem("nodo.me"); localStorage.removeItem("nodo.brand"); localStorage.removeItem("nodo.channelId"); } catch {}
    await supa.auth.signOut(); location.href = "index.html";
  };

  // Chip de usuario (perfil) en el pie del sidebar completo
  loadMe(nav);

  // Selector de bot + logo dinámico (el select no existe en modo minimal)
  const botBtn = nav.querySelector("#nodoBotBtn");
  const botLogo = nav.querySelector("#nodoBotLogo");
  const botName = nav.querySelector("#nodoBotName");
  // El popover va en <body> (no dentro del sidebar) porque el backdrop-filter
  // del nav recorta a los hijos position:fixed.
  let botPop = document.getElementById("nodoBotPop");
  if (!botPop) { botPop = document.createElement("div"); botPop.id = "nodoBotPop"; botPop.className = "nodo-botpop"; botPop.hidden = true; document.body.appendChild(botPop); }
  const logo = nav.querySelector("#nodoLogo");
  const brandName = nav.querySelector("#nodoBrandName");
  S.botBtn = botBtn; S.botLogo = botLogo; S.botName = botName; S.botPop = botPop; S.logo = logo; S.brandName = brandName;
  // Resiliente: si la columna logo_url aún no está migrada en la BD, reintenta sin ella.
  let { data, error } = await supa.from("channels").select("id,nombre,logo_url,timezone").eq("activo", true).order("nombre");
  if (error) ({ data } = await supa.from("channels").select("id,nombre,timezone").eq("activo", true).order("nombre"));
  if (error) ({ data } = await supa.from("channels").select("id,nombre").eq("activo", true).order("nombre"));
  S.channels = data || [];
  let saved = localStorage.getItem("nodo.channelId");
  if (!S.channels.find((c) => c.id === saved)) saved = S.channels[0]?.id || null;
  S.channelId = saved;
  // Zona horaria del NEGOCIO (la que se elige en Ajustes). El panel calculaba todas sus
  // fechas con Lima fija; el motor sí respeta esta columna, así que un negocio fuera de
  // Perú veía sus reportes cortados a una hora que no era la suya. Se publica acá para que
  // date-range.js y las pantallas la usen sin tener que consultar cada una por su lado.
  setTZ(S.channels.find((c) => c.id === saved)?.timezone);
  S.loaded = true;

  // Selector de bot personalizado (con logos + "Crear nuevo bot")
  const escBot = (s) => (s ?? "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const closeBotPop = () => { if (botPop) { botPop.hidden = true; if (botBtn) botBtn.classList.remove("open"); } };
  const renderBotPop = () => {
    if (!botPop) return;
    botPop.innerHTML = S.channels.map((c) => `<button class="nb-item${c.id === S.channelId ? " on" : ""}" type="button" data-id="${c.id}"><img src="${escBot(c.logo_url || FALLBACK_LOGO)}" alt="" /><span>${escBot(c.nombre)}</span>${c.id === S.channelId ? svg("check") : ""}</button>`).join("")
      + `<button class="nb-create" type="button">${svg("plus")}<span>Crear nuevo bot</span></button>`;
    botPop.querySelectorAll(".nb-item").forEach((b) => { b.onclick = async () => { if (b.dataset.id !== S.channelId && !(await _dirtyGate())) return; S.api.setChannel(b.dataset.id); closeBotPop(); }; });
    const cr = botPop.querySelector(".nb-create"); if (cr) cr.onclick = () => { closeBotPop(); openCreateBot(); };
  };
  const positionBotPop = () => {
    if (!botBtn || !botPop) return;
    const collapsed = nav.classList.contains("collapsed");
    botPop.classList.toggle("mini", collapsed); // comprimido = solo logos
    const nr = nav.getBoundingClientRect(), r = botBtn.getBoundingClientRect();
    botPop.style.top = (r.bottom + 6) + "px"; // siempre baja
    if (collapsed) { // centrado en el rail
      const MINI_W = 48;
      botPop.style.width = MINI_W + "px";
      botPop.style.left = (nr.left + (nr.width - MINI_W) / 2) + "px";
    } else { // ocupa el ancho del sidebar (centrado, con márgenes)
      botPop.style.width = (nr.width - 16) + "px";
      botPop.style.left = (nr.left + 8) + "px";
    }
  };
  if (botBtn) botBtn.onclick = (e) => {
    e.stopPropagation();
    if (botPop.hidden) { renderBotPop(); positionBotPop(); botPop.hidden = false; botBtn.classList.add("open"); } else closeBotPop();
  };
  // Cerrar el popover al hacer clic fuera (listener único por documento).
  if (!S.botDocClose) {
    S.botDocClose = true;
    document.addEventListener("click", (e) => {
      if (S.botPop && !S.botPop.hidden && !e.target.closest(".nodo-brand") && !e.target.closest("#nodoBotPop")) { S.botPop.hidden = true; if (S.botBtn) S.botBtn.classList.remove("open"); }
    });
  }

  const paintBrand = () => {
    const c = S.channels.find((x) => x.id === S.channelId);
    const src = (c && c.logo_url) ? c.logo_url : FALLBACK_LOGO;
    const name = c ? c.nombre : "Nodo";
    if (S.logo) S.logo.src = src;
    if (S.brandName) S.brandName.textContent = name;
    if (S.botLogo) S.botLogo.src = src;
    if (S.botName) S.botName.textContent = name;
    setFavicon(src); // favicon = logo del bot activo
    if (c) writeBrandCache({ id: c.id, logo: c.logo_url || null, name }); // caché anti-parpadeo
  };
  S.paintBrand = paintBrand;
  paintBrand();

  S.api = {
    get channelId() { return S.channelId; },
    get channels() { return S.channels; },
    onChannel(cb) { S.subs.push(cb); },
    onLeave(cb) { S.leaves.push(cb); }, // cleanup al salir de la página (SPA)
    setChannel(id, { silent } = {}) {
      if (!S.channels.find((c) => c.id === id)) return;
      S.channelId = id;
      localStorage.setItem("nodo.channelId", id);
      // Cada bot puede tener SU zona horaria: al cambiar de bot hay que cambiarla también, o
      // los reportes del nuevo se cortarían con la zona del anterior. Va ANTES de avisar a las
      // pantallas (`S.subs`), que es cuando recargan sus datos con el rango recalculado.
      setTZ(S.channels.find((c) => c.id === id)?.timezone);
      paintBrand();
      if (!silent) S.subs.forEach((cb) => { try { cb(id); } catch (e) { console.error(e); } });
    },
    // Comprime/expande el sidebar SIN persistir la preferencia del usuario
    // (lo usa el editor de flujos para dar aire al lienzo y luego restaurar).
    setCollapsed(v) { if (S.nav) S.nav.classList.toggle("collapsed", !!v); },
    isCollapsedPref() { return localStorage.getItem("nodo.collapsed") === "1"; },
  };
  window.NodoShell = S.api;

  // Listeners GLOBALES (una vez por carga de página; sobreviven a la navegación SPA):
  if (!S._globalWired) {
    S._globalWired = true;
    // Multi-pestaña: si cambias de bot en OTRA pestaña, ESTA se sincroniza. Sin esto seguía
    // mostrando/editando datos del bot VIEJO mientras el resto del sistema cree que el activo
    // es otro → el operador podía actuar sobre el bot equivocado (riesgo multi-tenant).
    window.addEventListener("storage", async (e) => {
      if (e.key === "nodo.channelId" && e.newValue && e.newValue !== S.channelId) {
        // Con cambios sin guardar se PREGUNTA, igual que al cambiar de bot desde el menú.
        // Este camino se saltaba el aviso: si tenías un producto o los ajustes de IA a medio
        // editar y cambiabas de bot en OTRA pestaña, esta recargaba sola y el trabajo se
        // perdía sin que nada lo dijera. Si eliges quedarte, esta pestaña se queda en SU bot
        // y no se toca la clave guardada: reescribirla dispararía este mismo evento en la
        // otra pestaña y le desharía el cambio que acaba de hacer. La única secuela es que,
        // si recargas ESTA pestaña, abrirá en el otro bot — que es justo lo que pediste allá.
        if (!(await _dirtyGate())) return;
        try { S.api.setChannel(e.newValue); } catch (_) {}
      }
    });
    // Sesión caída (refresh token vencido tras dejar la pestaña abierta de noche): al login,
    // no a un panel vacío/roto sin explicación. Limpia el caché LOCAL antes de redirigir: en una
    // PC compartida, mountShell pinta primero desde caché, así que sin esto el SIGUIENTE usuario
    // veía el nombre/rol/avatar y el logo/negocio del anterior hasta que resolvieran las queries
    // (misma fuga que ya cierra el botón de salir; la expiración pasiva no lo hacía).
    try { supa.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") {
      try { localStorage.removeItem("nodo.me"); localStorage.removeItem("nodo.brand"); localStorage.removeItem("nodo.channelId"); } catch (_) {}
      location.href = "index.html";
    } }); } catch (_) {}
  }

  applyInboxCollapse(active); // Bandeja arranca colapsada
  setupRouter(); // activa la navegación SPA
  return S.api;
}

// La Bandeja colapsa el sidebar (más espacio para el chat) sin persistir;
// las demás secciones respetan la preferencia guardada del usuario.
function applyInboxCollapse(active) {
  if (!S.nav) return;
  if (active === "inbox") S.nav.classList.add("collapsed");
  else S.nav.classList.toggle("collapsed", localStorage.getItem("nodo.collapsed") === "1");
}

// ── Resalta el ítem activo del sidebar sin reconstruirlo (SPA) ──────
function updateActive(active) {
  if (!S.nav) return;
  S.nav.querySelectorAll(".nodo-link.active").forEach((l) => l.classList.remove("active"));
  const el = S.nav.querySelector(`[data-nav="${active}"]`);
  if (el) {
    el.classList.add("active");
    const grp = el.closest(".nodo-group");
    if (grp) grp.classList.remove("closed"); // abre el grupo que contiene el activo
  }
}

// ── Router client-side ──────────────────────────────────────────────
function setupRouter() {
  if (S.routerReady) return;
  // No activar el router en las páginas frontera (Editor): allí la
  // navegación es normal para no arrastrar su canvas/estado pesado.
  if (BOUNDARY.has(fileOf(location.pathname))) return;
  S.routerReady = true;
  S.pageStyles = pageHeadAssets(document); // estilos de la página actual (style + link externos)
  document.addEventListener("click", onNavClick);
  // Prefetch: baja la sección al pasar el mouse/foco/toque por su link → clic instantáneo.
  if (S.nav) {
    S.nav.addEventListener("pointerover", onNavHover, { passive: true });
    S.nav.addEventListener("pointerdown", onNavHover, { passive: true });
    S.nav.addEventListener("focusin", onNavHover);
  }
  schedulePrefetchAll(); // y calienta todas en el tiempo muerto
  window.addEventListener("popstate", async () => {
    // Back/forward con cambios sin guardar: si el usuario elige quedarse,
    // rehacemos el push a la página actual para que URL y contenido no se
    // desincronicen (el navegador ya movió el puntero del historial).
    if (_dirty && !(await _dirtyGate())) { history.pushState({ spa: true }, "", _curHref); return; }
    navigate(location.href, { push: false });
  });
}

function onNavClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest("a[href]");
  if (!a) return;
  const navEl = a.closest(".nodo-nav");
  if (!navEl || navEl.classList.contains("minimal")) return; // solo sidebar completo
  if (a.target === "_blank") return;
  const href = a.getAttribute("href");
  if (!href || !href.endsWith(".html")) return;
  if (BOUNDARY.has(fileOf(href))) return; // Bandeja/Editor = navegación normal
  const dest = new URL(href, location.href);
  if (dest.origin !== location.origin) return;
  if (dest.pathname === location.pathname) { e.preventDefault(); return; } // ya estás aquí
  e.preventDefault();
  navigate(dest.href);
}

// Estilos propios de una página (para intercambiar al navegar): los <style>
// inline + los <link rel=stylesheet> externos, EXCEPTO shell.css (compartido).
function pageHeadAssets(docLike) {
  return Array.from(docLike.head.querySelectorAll('style, link[rel="stylesheet"]'))
    .filter((el) => !(el.tagName === "LINK" && /(^|\/)shell\.css(\?|#|$)/.test(el.getAttribute("href") || "")));
}

// Reemplaza el contenido (todo el <body> salvo el sidebar y el toast).
function removeContentNodes() {
  Array.from(document.body.children).forEach((el) => {
    if (el === S.nav || el.id === "nodo-toast" || el.id === "nodo-fx" || el.id === "nodoBotPop") return; // persisten
    el.remove();
  });
}

// Re-ejecuta los <script> de la página destino en orden. Los externos
// (src, p. ej. Drawflow) se esperan a que carguen ANTES de seguir, para
// que el script de módulo de la página ya tenga sus dependencias listas.
async function runScripts(scripts) {
  for (const old of scripts) {
    const s = document.createElement("script");
    if (old.type) s.type = old.type;
    if (old.src) {
      s.src = old.getAttribute("src");
      await new Promise((res) => { s.onload = s.onerror = res; document.body.appendChild(s); });
    } else {
      s.textContent = old.textContent;
      document.body.appendChild(s);
    }
  }
}

// Ejecuta cleanups registrados por la página saliente y limpia subs.
function teardown() {
  S.leaves.forEach((cb) => { try { cb(); } catch (e) { console.error(e); } });
  S.leaves = [];
  S.subs = [];
  _resetGuard(); // la nueva página vuelve a opt-in con guardUnsaved() si es un formulario
}

let _curHref = location.href; // página SPA mostrada ahora (para restaurar si se cancela un back/forward)
async function navigate(href, { push = true } = {}) {
  const dest = new URL(href, location.href);
  if (BOUNDARY.has(fileOf(dest.pathname)) || dest.origin !== location.origin) {
    location.href = dest.href; return; // frontera → navegación normal
  }
  // Navegación deliberada (clic del sidebar): frena si hay cambios sin guardar.
  // El back/forward (push=false) se controla en el listener de popstate.
  if (push && !(await _dirtyGate())) return;
  try {
    let html = pageCache.get(dest.pathname);
    if (html == null) {
      const res = await fetch(dest.href, { credentials: "same-origin" });
      if (!res.ok) throw new Error("fetch " + res.status);
      html = await res.text();
      pageCache.set(dest.pathname, html);
    }
    const doc = new DOMParser().parseFromString(html, "text/html");
    const newStyles = pageHeadAssets(doc).map((s) => s.cloneNode(true));
    const contentNodes = []; const scripts = [];
    Array.from(doc.body.childNodes).forEach((n) => {
      if (n.nodeType === 1 && n.tagName === "SCRIPT") scripts.push(n);
      else contentNodes.push(document.importNode(n, true));
    });

    teardown(); // limpia la página saliente ANTES de quitar su DOM

    // Swap instantáneo del contenido (el sidebar y el fondo no se tocan).
    document.title = doc.title || document.title;
    S.pageStyles.forEach((s) => s.remove());       // fuera estilos de la página anterior
    S.pageStyles = newStyles;
    newStyles.forEach((s) => document.head.appendChild(s)); // estilos de la nueva
    removeContentNodes();
    contentNodes.forEach((n) => document.body.appendChild(n));

    if (push) history.pushState({ spa: true }, "", dest.href);
    _curHref = dest.href; // el swap ya ocurrió: esta es la página mostrada
    const page = document.querySelector(".nodo-page");
    if (page) page.scrollTop = 0; else window.scrollTo(0, 0);
    await runScripts(scripts); // corre el boot() de la nueva página (usa mountShell idempotente)
  } catch (e) {
    console.error("[SPA] fallback a navegación normal:", e);
    location.href = dest.href; // degradación limpia
  }
}

// ── Prefetch de secciones: baja el HTML al pageCache ANTES del clic ──────
// La 1ª navegación a una sección baja su HTML completo (productos ~230KB). Si
// ya lo trajimos al pasar el mouse por el link, o en el tiempo muerto tras
// cargar, el clic es instantáneo (navigate lee de pageCache). Es solo warming
// de caché: idempotente, silencioso, y si falla no pasa nada (navigate hace el
// fetch normal). No re-baja lo ya cacheado ni las páginas "frontera".
const _prefetching = new Set();
function prefetchPage(href) {
  try {
    if (!href) return;
    const dest = new URL(href, location.href);
    if (dest.origin !== location.origin) return;
    if (!dest.pathname.endsWith(".html")) return;
    if (BOUNDARY.has(fileOf(dest.pathname))) return;   // frontera → navegación normal, no cachear
    if (dest.pathname === location.pathname) return;   // ya estás aquí
    if (pageCache.has(dest.pathname) || _prefetching.has(dest.pathname)) return;
    _prefetching.add(dest.pathname);
    fetch(dest.href, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.text() : null))
      .then((html) => { if (html != null) pageCache.set(dest.pathname, html); })
      .catch(() => {})
      .finally(() => _prefetching.delete(dest.pathname));
  } catch { /* noop */ }
}
function onNavHover(e) {
  const a = e.target.closest && e.target.closest('a[href$=".html"]');
  if (a) prefetchPage(a.getAttribute("href"));
}
const _requestIdle = window.requestIdleCallback ? window.requestIdleCallback.bind(window) : (fn) => setTimeout(fn, 200);
let _prefetchedAll = false;
// Tras cargar, en el tiempo muerto, calienta TODAS las secciones del sidebar
// (una por tick de idle para no saturar la red). Se salta si la conexión es
// lenta o el usuario pidió ahorro de datos.
function schedulePrefetchAll() {
  if (_prefetchedAll) return;
  _prefetchedAll = true;
  const con = navigator.connection;
  if (con && (con.saveData || /(^|-)2g$/.test(con.effectiveType || ""))) return;
  _requestIdle(() => {
    if (!S.nav) return;
    const links = Array.from(S.nav.querySelectorAll('a.nodo-link[href$=".html"]'));
    let i = 0;
    const next = () => {
      if (i >= links.length) return;
      prefetchPage(links[i++].getAttribute("href"));
      _requestIdle(next);
    };
    next();
  });
}

// Cambia UNA parte de products.config sin pisar el resto. `mutar(cfg)` recibe el config
// FRESCO de la base y lo modifica en sitio; devuelve {ok, error}.
//
// 🔒 Por qué releer en vez de usar el config que la pantalla tiene cargado: en
// products.config vive TODO el producto, y el `stock` lo descuenta el MOTOR con cada venta.
// Las pantallas cargan el config al abrirse y se quedan abiertas horas; escribir esa copia
// entera revierte los descuentos que ocurrieron mientras tanto — sobreventa muda — y de paso
// puede pisar extras, precios o conocimiento editados desde otra pestaña. "Guardar producto"
// ya se blinda así (reconcilia el stock por delta contra lo fresco); esto es lo mismo para
// las pantallas que solo tocan una clave suelta.
export async function patchProductConfig(id, mutar) {
  const { data: fresh, error: eRead } = await supa
    .from("products").select("config").eq("id", id).maybeSingle();
  if (eRead) return { ok: false, error: eRead };
  const cfg = { ...((fresh && fresh.config) || {}) };
  mutar(cfg);
  const { error } = await supa.from("products").update({ config: cfg }).eq("id", id);
  return error ? { ok: false, error } : { ok: true, config: cfg };
}

// ── Formato de WhatsApp en las burbujas del panel ──────────────────────────
// *negrita*, _cursiva_, ~tachado~ y ```mono```, como lo ve el cliente en su
// celular. Sin esto los chats mostraban los asteriscos crudos ("Ten listo
// *S/ 129* para pagar") y al releer una conversación no se distinguía lo
// resaltado de lo que no — justo el dato que uno va a buscar.
// 🔒 Escapa SIEMPRE primero: el HTML se arma sobre texto ya escapado, así un
// mensaje del cliente con etiquetas no puede inyectar nada (los marcadores solo
// envuelven texto que ya es inofensivo).
// Vive acá y no en cada página para que la Bandeja y Probar flujos no se
// separen: ya pasó que una mostraba el formato y la otra no.
const _escFmt = (s) => (s ?? "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function waFmt(s) {
  let t = _escFmt(s);
  // Cada delimitador exige BORDE: pegado a la palabra por dentro, espacio o signo
  // por fuera. Así un_link_con_guiones o un "2 * 3" no se vuelven estilo. Van como
  // literales y no con new RegExp: dentro de un string "\s" se queda en "s" y la
  // regex deja de hacer lo que dice.
  t = t.replace(/```([\s\S]+?)```/g, "<code>$1</code>");
  t = t.replace(/(^|[\s(¡¿«"])\*(?!\s)([^*\n]+?)(?<!\s)\*(?=$|[\s.,!?)»:;"])/g, "$1<b>$2</b>");
  t = t.replace(/(^|[\s(¡¿«"])_(?!\s)([^_\n]+?)(?<!\s)_(?=$|[\s.,!?)»:;"])/g, "$1<i>$2</i>");
  t = t.replace(/(^|[\s(¡¿«"])~(?!\s)([^~\n]+?)(?<!\s)~(?=$|[\s.,!?)»:;"])/g, "$1<s>$2</s>");
  return t;
}
