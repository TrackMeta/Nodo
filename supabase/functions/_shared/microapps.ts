// ═══════════════════════════════════════════════════════════════════
// 📱 MICRO APPS — el puente de Nodo con la base de Apps (8-oct-2026)
//
// Una micro app se VENDE como un digital (mismo precio/OCR/pedido en engine.ts) y se
// ENTREGA como acceso: correo obligatorio → la base de Apps (proyecto Supabase aparte,
// apps-base/) crea o extiende el acceso → el bot manda el link personal.
// Este módulo no sabe de runs ni de flujos: habla con la base de Apps, arregla correos y
// arma los textos. Lo que toca la conversación vive en engine.ts (entregarMicroapp…).
//
// Configuración (secretos de las Edge Functions de NODO):
//   NODO_APPS_URL    → https://<ref-de-apps>.supabase.co/functions/v1/nodo
//   NODO_APPS_SECRET → el mismo valor que NODO_APPS_SECRET en el proyecto de Apps
// Sin eso, todo devuelve { ok:false, error:"apps_sin_configurar" } y el motor pasa la entrega
// a una persona (nunca deja al cliente pagado y sin respuesta).
// ═══════════════════════════════════════════════════════════════════
import { fetchConTimeout } from "./http.ts";

export type Modalidad = "unico" | "mensual" | "prueba";

// Config del producto (products.config.microapp). Todo opcional: los defectos van abajo.
export interface MicroappCfg {
  destacada?: "unico" | "mensual";
  correo?: { recordar?: boolean; veces?: number; cada_min?: number[]; mensaje?: string; mensaje_pedir?: string };
  renovacion?: { previo?: boolean; dias?: number; plantilla_previo?: string; vencido?: boolean; plantilla_vencido?: string };
  prueba?: { activa?: boolean; horas?: number; plantilla_fin?: string };
  conexion?: { url?: string; max_celulares?: number };
  video_instalacion?: string;   // url de un video corto de «cómo instalarla» (opcional)
}

export const CORREO_PEDIR_DEF =
  "¡Pago recibido! 🎉 Para crear tu acceso a *{{app}}*, pásame tu correo 📧\n" +
  "(Ahí te llegan tu acceso y novedades de la app; si no quieres novedades, dime.)";
export const CORREO_RECORDAR_DEF = "Solo me falta tu correo para activar tu acceso 🙌";

export function appsConfigurada(): boolean {
  return !!(Deno.env.get("NODO_APPS_URL") && Deno.env.get("NODO_APPS_SECRET"));
}

// Llama a la función `nodo` de la base de Apps. Nunca lanza: devuelve { ok:false, error }.
export async function appsApi(accion: string, cuerpo: Record<string, unknown> = {}, ms = 8000): Promise<any> {
  const url = Deno.env.get("NODO_APPS_URL"), secret = Deno.env.get("NODO_APPS_SECRET");
  if (!url || !secret) return { ok: false, error: "apps_sin_configurar" };
  try {
    const r = await fetchConTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-nodo-secret": secret },
      body: JSON.stringify({ accion, ...cuerpo }),
    }, ms);
    const j = await r.json().catch(() => ({}));
    if (!r.ok && j?.ok !== false) return { ok: false, error: `http_${r.status}` };
    return j;
  } catch (e) {
    return { ok: false, error: String((e as any)?.message ?? e).slice(0, 120) };
  }
}

// ── Correos ─────────────────────────────────────────────────────────
// Los errores que de verdad se escriben en Perú. Solo dominios conocidos: «gmail.co» se
// arregla (nadie tiene Gmail colombiano), pero «empresa.co» no se toca.
const DOMINIOS: Array<[RegExp, string]> = [
  [/^(?:gmial|gmal|gamil|gmai|gnail|gmil|gimail|gemail|gmaill|gmali|gmsil|gmaul|g-mail|gmail)\.(?:com|con|cm|co|comm|cpm|vom|xom|om|c)$/i, "gmail.com"],
  [/^(?:hotmial|hotmal|hotmai|hotamil|hotmil|homail|htmail|hotmaill|hotmail)\.(?:com|con|cm|co|comm|cpm|es)$/i, "hotmail.com"],
  [/^(?:outlok|outloo|outlock|outllok|otlook|outlook)\.(?:com|con|cm|co|comm|es)$/i, "outlook.com"],
  [/^(?:yaho|yahooo|yhaoo|yahoo)\.(?:com|con|cm|co|es)$/i, "yahoo.com"],
  [/^(?:icloud|iclod|icloud)\.(?:com|con|cm|co)$/i, "icloud.com"],
];

// Saca el correo de un mensaje (aunque venga con «mi correo es …», con «arroba» o con
// espacios) y corrige el dominio. `corregido` = se cambió algo que el cliente escribió.
export function extraerCorreo(txt: string): { correo: string; corregido: boolean; original: string } | null {
  let t = String(txt ?? "").replace(/[​-‍﻿]/g, "");
  t = t.replace(/\s*\(?\s*arroba\s*\)?\s*/gi, "@").replace(/\s+punto\s+/gi, ".");
  // «rodrigo @ gmail . com» → junto
  t = t.replace(/\s*@\s*/g, "@").replace(/@([a-z0-9-]+)\s*\.\s*([a-z]{2,4})\b/gi, "@$1.$2");
  const m = /([a-z0-9][a-z0-9._%+-]{0,63})@([a-z0-9-]+(?:\.[a-z0-9-]+)*)/i.exec(t);
  if (!m) return null;
  const usuario = m[1].replace(/\.+$/, "");
  let dominio = m[2].toLowerCase().replace(/\.+$/, "");
  const original = `${usuario}@${dominio}`.toLowerCase();
  if (!/\./.test(dominio)) {
    // «rodrigo@gmail» sin .com
    const solo = dominio;
    const fix = DOMINIOS.find(([rx]) => rx.test(solo + ".com"));
    if (!fix) return null;
    dominio = fix[1];
  } else {
    const fix = DOMINIOS.find(([rx]) => rx.test(dominio));
    // hotmail.es / outlook.es / yahoo.es existen: se arregla el nombre, no el país.
    if (fix) dominio = /.es$/i.test(dominio) && fix[1] !== "gmail.com" ? fix[1].replace(/.com$/, ".es") : fix[1];
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dominio)) return null;
  const correo = `${usuario}@${dominio}`.toLowerCase();
  return { correo, corregido: correo !== original, original };
}

// Celular peruano de 9 dígitos (con o sin +51 / espacios). Devuelve «51XXXXXXXXX».
export function extraerCelular(txt: string): string | null {
  const d = String(txt ?? "").replace(/[^\d+]/g, " ");
  const m = /(?:\+?51\s*)?(9\d{2})\s*(\d{3})\s*(\d{3})(?!\d)/.exec(d.replace(/\s+/g, ""));
  return m ? `51${m[1]}${m[2]}${m[3]}` : null;
}

export function noQuiereNovedades(txt: string): boolean {
  return /\bsin\s+(?:novedades|promos?|promociones|publicidad)\b|\bno\s+(?:quiero|deseo|me\s+mandes|me\s+env[ií]es)\s+(?:novedades|promos?|promociones|publicidad|ofertas)\b/i.test(String(txt ?? ""));
}

// ── Fechas y textos ─────────────────────────────────────────────────
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function fechaLarga(iso: string | null | undefined, tz = "America/Lima"): string {
  if (!iso) return "";
  try {
    const p = new Intl.DateTimeFormat("es-PE", { timeZone: tz, day: "numeric", month: "numeric", year: "numeric" }).formatToParts(new Date(iso));
    const dia = p.find((x) => x.type === "day")?.value ?? "", mes = Number(p.find((x) => x.type === "month")?.value ?? 1);
    return `${dia} de ${MESES[mes - 1]}`;
  } catch { return ""; }
}

export function duracionLegible(horas: number): string {
  if (horas % 24 === 0) { const d = horas / 24; return d === 1 ? "24 horas" : `${d} días`; }
  return `${horas} horas`;
}

const INSTALAR = "📌 *Para tenerla como app:* ábrela y toca ⋮ → «Agregar a pantalla principal» (en iPhone: Compartir → «Añadir a inicio»).";

// El mensaje de entrega (momento 6). Sin la línea del 🔒 «este link es solo tuyo» (Rodrigo: confunde).
export function mensajeEntrega(o: {
  app: string; link: string; correo?: string | null; telefono?: string | null; tipo: Modalidad;
  vence_at?: string | null; renovado?: boolean; corregido?: { de: string } | null; horas?: number;
}): string {
  const llave = o.correo ? `con *${o.correo}*` : (o.telefono ? `con tu número *${o.telefono.replace(/^51/, "")}*` : "");
  const vence = fechaLarga(o.vence_at);
  if (o.renovado && o.tipo === "mensual") {
    return `✅ ¡Renovado! Tu acceso a *${o.app}* ahora vence el *${vence}* 🗓️\nSigues entrando con el mismo link:\n${o.link}`;
  }
  const lineas: string[] = [];
  if (o.tipo === "prueba") {
    lineas.push(`🎁 ¡Listo! Tienes *${duracionLegible(o.horas || 24)} gratis* de *${o.app}*${llave ? `, ${llave}` : ""}.`);
  } else {
    lineas.push(`✅ ¡Listo! Tu acceso a *${o.app}* quedó ${llave || "activado"}.`);
  }
  if (o.corregido) lineas.push(`(Lo dejé como *${o.correo}*: escribiste «${o.corregido.de}».)`);
  lineas.push(`📱 Entra aquí: ${o.link}`);
  lineas.push(INSTALAR);
  if (o.tipo === "mensual" && vence) lineas.push(`🗓️ Tu plan mensual vence el *${vence}*.`);
  if (o.tipo === "prueba" && vence) lineas.push(`⏳ Tu prueba termina el *${vence}*.`);
  return lineas.join("\n");
}

// Qué compró, según la presentación (product_versions.config).
export function modalidadDeOpcion(opcion: any): { tipo: Modalidad; meses: number } {
  const c = (opcion?.config ?? {}) as Record<string, unknown>;
  const tipo = c.modalidad === "mensual" ? "mensual" : "unico";
  const meses = Math.max(1, Math.min(24, Math.round(Number(c.meses) || 1)));
  return { tipo, meses: tipo === "mensual" ? meses : 0 };
}

export function cfgDe(config: any): MicroappCfg {
  return ((config?.microapp ?? {}) || {}) as MicroappCfg;
}

// Minutos hasta el recordatorio N (0 = el primero). null = ya no hay más.
export function proximoRecordatorioMin(cfg: MicroappCfg, yaEnviados: number): number | null {
  const c = cfg.correo ?? {};
  if (c.recordar === false) return null;
  const veces = Math.max(0, Math.min(5, Number(c.veces ?? 2)));
  if (yaEnviados >= veces) return null;
  const cada = Array.isArray(c.cada_min) && c.cada_min.length ? c.cada_min : [15, 180];
  const m = Number(cada[Math.min(yaEnviados, cada.length - 1)]) || 60;
  return Math.max(5, Math.min(24 * 60, m));
}
