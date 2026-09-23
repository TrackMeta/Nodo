// ═══════════════════════════════════════════════════════════════════
// Nodo · salud-wa.ts — ¿Meta restringió, marcó o baneó el número?
//
// Dos fuentes, un solo aviso:
//  · El WEBHOOK: Meta manda account_update (ban, restricción, violación), account_alerts,
//    phone_number_quality_update (calidad baja / bajó el límite), account_review_update y
//    security. channel-config ya suscribe esos campos, pero el webhook los descartaba: te
//    podían banear el número y Nodo no decía nada.
//  · Un SONDEO cada 3 h (scheduler): pregunta a Meta el estado del número. Es el respaldo si
//    el webhook no llega (suscripción perdida, token vencido — eso el webhook nunca lo avisa).
//
// El aviso queda en `channels.wa_alerta` (cartel rojo en el panel) y sale por Telegram. Se
// repite a lo más cada 12 h si no cambia, para no martillar.
// ═══════════════════════════════════════════════════════════════════
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getChannelSecrets } from "./db.ts";
import { sendTelegram } from "./telegram.ts";
import { fetchConTimeout } from "./http.ts";

export type Alerta = { nivel: "rojo" | "amarillo"; texto: string; origen: string };
// `limpiar`: la buena noticia que apaga un aviso de ese origen (p. ej. volvió la calidad).
export type Veredicto = { alerta?: Alerta; limpiar?: string[]; info?: string } | null;

const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const RESTRICCION: Record<string, string> = {
  RESTRICTED_BIZ_INITIATED_MESSAGING: "no puedes INICIAR conversaciones (plantillas, campañas, remarketing)",
  RESTRICTED_CUSTOMER_INITIATED_MESSAGING: "no puedes RESPONDER a los clientes que te escriben",
  RESTRICTED_ADD_PHONE_NUMBER_ACTION: "no puedes agregar números nuevos a la cuenta",
};

// Traduce un change del webhook de Meta a un aviso. null = no es de salud o no importa.
export function veredictoWebhook(field: string, v: any): Veredicto {
  const ev = String(v?.event ?? "").toUpperCase();
  if (field === "account_update") {
    if (ev === "DISABLED_UPDATE" || v?.ban_info) {
      const st = String(v?.ban_info?.waba_ban_state ?? "").toUpperCase();
      const fecha = v?.ban_info?.waba_ban_date ? ` (fecha: ${v.ban_info.waba_ban_date})` : "";
      if (st === "REINSTATE") return { limpiar: ["ban"], info: "Meta levantó el bloqueo de tu cuenta de WhatsApp" };
      if (st === "SCHEDULE_FOR_DISABLE") return { alerta: { nivel: "rojo", origen: "ban", texto: `Meta PROGRAMÓ el bloqueo de tu cuenta de WhatsApp Business${fecha}. Entra al Business Manager → Calidad de la cuenta y apela antes de esa fecha.` } };
      return { alerta: { nivel: "rojo", origen: "ban", texto: `Meta BLOQUEÓ tu cuenta de WhatsApp Business${fecha}. El bot no puede enviar mensajes. Entra al Business Manager → Calidad de la cuenta para ver el motivo y apelar.` } };
    }
    if (ev === "ACCOUNT_RESTRICTION" || Array.isArray(v?.restriction_info)) {
      const rs = (Array.isArray(v?.restriction_info) ? v.restriction_info : []) as any[];
      if (!rs.length) return { limpiar: ["restriccion"], info: "Meta quitó la restricción de tu cuenta de WhatsApp" };
      const que = rs.map((r) => {
        const hasta = r?.expiration ? ` hasta ${String(r.expiration).slice(0, 16).replace("T", " ")}` : "";
        return (RESTRICCION[String(r?.restriction_type ?? "")] ?? String(r?.restriction_type ?? "restricción")) + hasta;
      }).join("; ");
      return { alerta: { nivel: "rojo", origen: "restriccion", texto: `Meta RESTRINGIÓ tu cuenta de WhatsApp: ${que}.` } };
    }
    if (ev === "ACCOUNT_VIOLATION") {
      const t = String(v?.violation_info?.violation_type ?? "").replace(/_/g, " ").toLowerCase();
      return { alerta: { nivel: "amarillo", origen: "violacion", texto: `Meta registró una infracción de políticas en tu cuenta de WhatsApp${t ? ` (${t})` : ""}. Varias seguidas terminan en bloqueo: revisa qué mensajes la causaron.` } };
    }
    if (ev === "ACCOUNT_DELETED" || ev === "PARTNER_REMOVED") {
      return { alerta: { nivel: "rojo", origen: "ban", texto: "Meta desvinculó o eliminó tu cuenta de WhatsApp Business. El bot no puede enviar mensajes: reconecta el número en Canales." } };
    }
    return null;
  }
  if (field === "phone_number_quality_update") {
    const lim = v?.current_limit ? ` Límite actual: ${String(v.current_limit).replace("TIER_", "").toLowerCase()} conversaciones al día.` : "";
    if (ev === "FLAGGED") return { alerta: { nivel: "amarillo", origen: "calidad", texto: `Meta marcó la CALIDAD de tu número como baja (muchos clientes te bloquean o reportan). Si no mejora en 7 días te baja el límite de envíos.${lim} Frena campañas y remarketing agresivo.` } };
    if (ev === "DOWNGRADE") return { alerta: { nivel: "rojo", origen: "calidad", texto: `Meta te BAJÓ el límite de conversaciones que puedes iniciar por mala calidad.${lim}` } };
    if (ev === "UNFLAGGED" || ev === "UPGRADE") return { limpiar: ["calidad"], info: `La calidad de tu número volvió a la normalidad.${lim}` };
    return null;
  }
  if (field === "account_alerts") {
    const ai = v?.alert_info ?? {};
    const sev = String(ai.alert_severity ?? "").toUpperCase();
    if (sev !== "CRITICAL" && sev !== "WARNING") return null;
    const desc = String(ai.alert_description ?? ai.alert_type ?? "").trim();
    return { alerta: { nivel: sev === "CRITICAL" ? "rojo" : "amarillo", origen: "meta_alerta", texto: `Aviso de Meta sobre tu WhatsApp: ${desc || "revisa el Business Manager"}.` } };
  }
  if (field === "account_review_update") {
    const d = String(v?.decision ?? "").toUpperCase();
    if (d === "REJECTED") return { alerta: { nivel: "rojo", origen: "revision", texto: "Meta RECHAZÓ la revisión de tu cuenta de WhatsApp Business. Revisa el motivo en el Business Manager." } };
    if (d === "APPROVED") return { limpiar: ["revision"] };
    return null;
  }
  if (field === "phone_number_name_update") {
    const d = String(v?.decision ?? "").toUpperCase();
    if (d === "REJECTED") return { alerta: { nivel: "amarillo", origen: "nombre", texto: `Meta rechazó el nombre visible de tu número${v?.requested_verified_name ? ` («${v.requested_verified_name}»)` : ""}.` } };
    if (d === "APPROVED") return { limpiar: ["nombre"] };
    return null;
  }
  if (field === "security") {
    // Cambio del PIN de verificación en dos pasos: si no fuiste tú, alguien está tocando tu número.
    if (ev) return { alerta: { nivel: "amarillo", origen: "seguridad", texto: `Cambio de seguridad en tu número de WhatsApp (${ev.replace(/_/g, " ").toLowerCase()}). Si no fuiste tú, cambia el PIN de verificación en dos pasos YA.` } };
    return null;
  }
  return null;
}

// Aplica un veredicto a uno o varios canales: guarda el cartel y avisa por Telegram.
export async function aplicarVeredicto(db: SupabaseClient, channelIds: string[], ver: Veredicto): Promise<void> {
  if (!ver) return;
  for (const id of channelIds) {
    try {
      const { data: ch } = await db.from("channels").select("nombre, telegram_chat_ids, wa_alerta").eq("id", id).maybeSingle();
      if (!ch) continue;
      const previo = (ch as any).wa_alerta as (Alerta & { at?: string }) | null;
      let nuevo: (Alerta & { at: string }) | null | undefined = undefined; // undefined = no tocar
      let mensaje = "";
      if (ver.alerta) {
        const repetido = previo && previo.texto === ver.alerta.texto && previo.at && Date.now() - Date.parse(previo.at) < 12 * 3600_000;
        // Un amarillo no pisa un rojo vigente de otro origen (el ban importa más que la calidad).
        const tapa = previo && previo.nivel === "rojo" && ver.alerta.nivel === "amarillo" && previo.origen !== ver.alerta.origen;
        if (!tapa) nuevo = { ...ver.alerta, at: repetido ? previo!.at! : new Date().toISOString() };
        if (!repetido) mensaje = `${ver.alerta.nivel === "rojo" ? "🚨" : "⚠️"} <b>WhatsApp · ${esc(String((ch as any).nombre ?? ""))}</b>\n${esc(ver.alerta.texto)}`;
      } else if (ver.limpiar?.length && previo && ver.limpiar.includes(previo.origen)) {
        nuevo = null;
        if (ver.info) mensaje = `✅ <b>WhatsApp · ${esc(String((ch as any).nombre ?? ""))}</b>\n${esc(ver.info)}`;
      }
      if (nuevo !== undefined) await db.from("channels").update({ wa_alerta: nuevo }).eq("id", id);
      if (mensaje) {
        const chatIds: string[] = Array.isArray((ch as any).telegram_chat_ids) ? (ch as any).telegram_chat_ids.map(String) : [];
        const secrets = chatIds.length ? await getChannelSecrets(db, id).catch(() => null) : null;
        if (secrets?.telegram_bot_token) await sendTelegram(secrets.telegram_bot_token, chatIds, mensaje);
      }
    } catch (e) { console.error("[salud-wa]", (e as any)?.message ?? e); }
  }
}

// Sondeo: pregunta a Meta el estado del número. Lo que el webhook NO avisa nunca: el token
// vencido/revocado (error 190) y un número desconectado.
export async function sondearNumero(db: SupabaseClient, channelId: string, phoneNumberId: string): Promise<Veredicto> {
  const secrets = await getChannelSecrets(db, channelId);
  const token = secrets?.access_token;
  if (!token) return null;
  const r = await fetchConTimeout(`https://graph.facebook.com/v25.0/${phoneNumberId}?fields=status,quality_rating,messaging_limit_tier`,
    { headers: { Authorization: `Bearer ${token}` } });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) {
    const code = Number(j?.error?.code);
    if (code === 190) return { alerta: { nivel: "rojo", origen: "sondeo", texto: "El token de WhatsApp venció o fue revocado: el bot NO puede responder. Reconecta el número en Canales." } };
    if (code === 100 || code === 803) return { alerta: { nivel: "rojo", origen: "sondeo", texto: "Meta ya no reconoce este número en tu cuenta (¿lo eliminaron o migraron?). Revisa Canales." } };
    return null; // hipo de red o de Meta: no alarmar por uno
  }
  const st = String(j?.status ?? "").toUpperCase();
  const q = String(j?.quality_rating ?? "").toUpperCase();
  if (st === "BANNED") return { alerta: { nivel: "rojo", origen: "sondeo", texto: "Meta BANEÓ tu número de WhatsApp. El bot no puede enviar mensajes. Revisa el Business Manager → Calidad de la cuenta para apelar." } };
  if (st === "RESTRICTED") return { alerta: { nivel: "rojo", origen: "sondeo", texto: "Meta RESTRINGIÓ tu número de WhatsApp: por ahora no puede iniciar conversaciones. Revisa el Business Manager." } };
  if (st === "FLAGGED" || q === "RED") return { alerta: { nivel: "amarillo", origen: "sondeo", texto: "La calidad de tu número está en ROJO (clientes que bloquean o reportan). Frena campañas y remarketing hasta que mejore o Meta te baja el límite." } };
  if (st === "DISCONNECTED" || st === "DELETED") return { alerta: { nivel: "rojo", origen: "sondeo", texto: "Tu número de WhatsApp aparece DESCONECTADO en Meta. Revisa Canales → Probar conexión." } };
  // Sano: apaga lo que el propio sondeo había levantado (y la calidad si Meta ya no la marca).
  return { limpiar: q === "GREEN" ? ["sondeo", "calidad"] : ["sondeo"], info: "Tu número de WhatsApp volvió a funcionar con normalidad." };
}

export const CAMPOS_SALUD = new Set([
  "account_update", "account_alerts", "phone_number_quality_update",
  "account_review_update", "phone_number_name_update", "security",
]);
