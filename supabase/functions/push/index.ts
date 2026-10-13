// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: push  (avisos al celular con la app cerrada)
//   · La llama el disparador de `notificaciones` (0137) con x-push-secret y el id
//     de la notificación: busca a los miembros activos de la cuenta del bot, sus
//     celulares (push_dispositivos) y lo que cada uno eligió en «Qué avisos me
//     llegan» (notificacion_usuario.prefs.app), y manda por Firebase (FCM v1).
//   · La app la llama con la sesión del usuario y { prueba: true } para «Mandarme
//     un aviso de prueba».
//   · Sin FCM_SERVICE_ACCOUNT (JSON de la cuenta de servicio de Firebase) no manda
//     nada y lo dice ({ ok:false, motivo:"sin_fcm" }).
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/db.ts";

const db = serviceClient();
const VALIDAR = new Set(["adelanto_validar", "saldo_validar", "pago_digital_validar", "pago_extra_validar", "prepago_lima_validar", "entrega_fallida"]);
const SONIDOS = new Set(["alarma", "campana", "caja", "normal", "silencio"]);
const DEF_SONIDO: Record<string, string> = { pagos: "alarma", humano: "alarma", ventas: "caja", atencion: "campana", sistema: "alarma" };

function categoria(n: any): string {
  if (VALIDAR.has(n.tipo)) return "pagos";
  if (n.tipo === "pide_humano") return "humano";
  if (n.grupo === "ventas") return "ventas";
  if (n.grupo === "sistema") return "sistema";
  return "atencion";
}
// Hora local HH:MM en la zona del negocio
function minutosEn(tz: string): number {
  try {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
    const h = Number(p.find((x) => x.type === "hour")?.value ?? 0) % 24, m = Number(p.find((x) => x.type === "minute")?.value ?? 0);
    return h * 60 + m;
  } catch { return new Date().getUTCHours() * 60 + new Date().getUTCMinutes() - 300; }
}
const mm = (s: string) => { const [a, b] = String(s || "0:0").split(":").map(Number); return (a || 0) * 60 + (b || 0); };
function enNoMolestar(dnd: any, tz: string): boolean {
  if (!dnd?.on) return false;
  const now = minutosEn(tz), a = mm(dnd.desde ?? "23:00"), b = mm(dnd.hasta ?? "07:00");
  return a <= b ? now >= a && now < b : now >= a || now < b;
}

// ── Firebase (FCM HTTP v1) con la cuenta de servicio ──
let _tok: { v: string; exp: number } | null = null;
function b64url(buf: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof buf === "string" ? new TextEncoder().encode(buf) : buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function tokenGoogle(sa: any): Promise<string> {
  if (_tok && _tok.exp > Date.now() + 60_000) return _tok.v;
  const ahora = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: ahora, exp: ahora + 3600 }));
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${body}.${b64url(firma)}` }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("google_token: " + JSON.stringify(j).slice(0, 200));
  _tok = { v: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return _tok.v;
}
function cuentaServicio(): any | null {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (!raw) return null;
  try { const sa = JSON.parse(raw); return sa.client_email && sa.private_key && sa.project_id ? sa : null; } catch { return null; }
}
async function enviar(sa: any, token: string, msg: { titulo: string; cuerpo: string; data: Record<string, string>; canal: string; tag: string }): Promise<"ok" | "borrar" | "error"> {
  const at = await tokenGoogle(sa);
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST", headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: {
      token,
      notification: { title: msg.titulo.slice(0, 120), body: msg.cuerpo.slice(0, 240) },
      data: msg.data,
      android: { priority: "HIGH", ttl: "86400s", notification: { channel_id: msg.canal, tag: msg.tag, icon: "ic_stat_nodo", color: "#0B63E5", default_vibrate_timings: true, notification_priority: "PRIORITY_MAX", visibility: "PRIVATE" } },
    } }),
  });
  if (r.ok) return "ok";
  const t = await r.text();
  // Celular desinstalado o token vencido → se borra
  if (r.status === 404 || /UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT.*token/i.test(t)) return "borrar";
  console.warn("[push] FCM", r.status, t.slice(0, 300));
  return "error";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let b: any; try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const sa = cuentaServicio();

  // ── Prueba desde la app (con la sesión del usuario) ──
  if (b?.prueba) {
    const { data: u } = await userClient(req.headers.get("Authorization") ?? "").auth.getUser();
    const uid = u?.user?.id; if (!uid) return json({ error: "no_auth" }, 401);
    if (!sa) return json({ ok: false, motivo: "sin_fcm" });
    const { data: devs } = await db.from("push_dispositivos").select("token").eq("user_id", uid);
    let enviados = 0;
    for (const d of devs ?? []) {
      const r = await enviar(sa, (d as any).token, { titulo: "Aviso de prueba de Nodo", cuerpo: "Si ves esto con la app cerrada, los avisos funcionan.", data: { ir: "notif" }, canal: "nodo_campana", tag: "prueba" });
      if (r === "ok") enviados++; else if (r === "borrar") await db.from("push_dispositivos").delete().eq("token", (d as any).token);
    }
    return json({ ok: enviados > 0, enviados, motivo: devs?.length ? undefined : "sin_dispositivos" });
  }

  // ── Disparo desde la base (secreto) ──
  const sec = Deno.env.get("PUSH_SECRET") ?? "";
  const got = req.headers.get("x-push-secret") ?? "";
  if (!sec || got.length !== sec.length || !crypto.subtle || got !== sec) return json({ error: "forbidden" }, 403);
  if (!sa) return json({ ok: false, motivo: "sin_fcm" });
  const id = String(b?.notificacion_id ?? ""); if (!id) return json({ error: "sin_id" }, 400);
  const { data: n } = await db.from("notificaciones").select("id,channel_id,contact_id,order_id,tipo,grupo,prioridad,titulo,detalle,resuelta_at,repeticiones,created_at,contact:contacts(nombre)").eq("id", id).maybeSingle();
  if (!n || (n as any).resuelta_at) return json({ ok: true, omitido: "no_existe_o_resuelta" });
  const nn: any = n;
  // Solo lo que importa en el bolsillo: urgente, importante y las ventas (lo «info» suelto queda en la campanita).
  if (!(nn.prioridad === "urgente" || nn.prioridad === "importante" || nn.grupo === "ventas")) return json({ ok: true, omitido: "info" });
  const { data: ch } = await db.from("channels").select("id,nombre,account_id,timezone").eq("id", nn.channel_id).maybeSingle();
  if (!ch) return json({ ok: true, omitido: "sin_canal" });
  const { data: mem } = await db.from("account_members").select("user_id").eq("account_id", (ch as any).account_id).eq("activo", true);
  const uids = (mem ?? []).map((m: any) => m.user_id);
  if (!uids.length) return json({ ok: true, omitido: "sin_miembros" });
  const [{ data: devs }, { data: prefs }, { data: chs }] = await Promise.all([
    db.from("push_dispositivos").select("token,user_id").in("user_id", uids),
    db.from("notificacion_usuario").select("user_id,prefs").in("user_id", uids),
    db.from("channels").select("id").eq("account_id", (ch as any).account_id).eq("activo", true),
  ]);
  if (!devs?.length) return json({ ok: true, omitido: "sin_dispositivos" });
  const pref = new Map((prefs ?? []).map((p: any) => [p.user_id, p.prefs || {}]));
  const cat = categoria(nn), urgente = nn.prioridad === "urgente";
  const varios = (chs ?? []).length > 1;
  const cuerpo = [varios ? (ch as any).nombre : "", nn.contact?.nombre, nn.detalle].filter(Boolean).join(" · ") || "Abre Nodo para verlo";
  const ir = VALIDAR.has(nn.tipo) ? "pagos" : ["pedido_lima", "pedido_provincia", "cambio_tras_despacho", "entrega_pedida", "microapp_sin_correo", "cuenta_compartida"].includes(nn.tipo) ? "t4" : nn.contact_id ? "chat" : "notif";
  let enviados = 0, saltados = 0;
  for (const d of devs as any[]) {
    const p: any = pref.get(d.user_id) || {}, app = p.app || {};
    // Tipos que la persona escondió en la campanita (lo crítico nunca se esconde)
    if (!urgente && Array.isArray(p.ocultos) && p.ocultos.includes(nn.tipo)) { saltados++; continue; }
    if (app.tipos && app.tipos[cat] === false) { saltados++; continue; }
    if (app.bots && app.bots[nn.channel_id] === false) { saltados++; continue; }
    let son = String(app.sonidos?.[cat] ?? DEF_SONIDO[cat] ?? "normal"); if (!SONIDOS.has(son)) son = "normal";
    if (enNoMolestar(app.dnd, (ch as any).timezone || "America/Lima") && !(app.dnd?.urg !== false && urgente)) son = "silencio";
    const r = await enviar(sa, d.token, {
      titulo: nn.titulo + (nn.repeticiones > 1 ? ` (×${nn.repeticiones})` : ""), cuerpo,
      data: { notificacion_id: nn.id, channel_id: nn.channel_id, contact_id: nn.contact_id ?? "", order_id: nn.order_id ? String(nn.order_id) : "", tipo: nn.tipo, ir },
      canal: "nodo_" + son, tag: nn.id,
    });
    if (r === "ok") enviados++;
    else if (r === "borrar") await db.from("push_dispositivos").delete().eq("token", d.token);
  }
  return json({ ok: true, enviados, saltados });
});
