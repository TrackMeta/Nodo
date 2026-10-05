// ═══════════════════════════════════════════════════════════════════
// 📣 La ventana SIN COSTO del anuncio (Free Entry Point, «FEP») — UN solo cálculo para el motor, las campañas y
// el envío manual (el panel lleva su espejo en shell.js: finVentanaAnuncio).
//
// Regla de Meta, leída en la doc oficial de precios el 5-oct-2026 (antes eran 72 h desde el clic):
//   · El cliente toca un anuncio Click-to-WhatsApp (desde la app de celular) y escribe.
//   · Si el NEGOCIO le responde dentro de las 24 h siguientes, ese mensaje no se cobra y se abre el FEP
//     «a partir del momento en que respondes». «El intervalo FEP puede permanecer abierto hasta 7 días.»
//   · Dentro del FEP no se cobra nada (servicio, utilidad, marketing). No da texto libre: eso es la ventana de 24 h.
//   · El FEP es del par negocio↔cliente, no de la app: si respondió otra app en el mismo número, también vale.
//
// `contacts.fep_hasta` se sigue grabando como «clic + 72 h» (de ahí lo deducen el ruteo por anuncio y la
// atribución: clic = fep_hasta − 72 h); acá solo se usa para saber CUÁNDO fue el clic.
// ═══════════════════════════════════════════════════════════════════
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const FEP_DIAS = 7;
const H = 3600_000;

// Hasta cuándo dura la ventana sin costo del anuncio para este contacto, en ms (0 = no hay ventana abierta ni por
// abrir). Si todavía nadie le respondió y estamos dentro de las 24 h del clic, el mensaje que se está por mandar ES
// el que la abre: se devuelve ahora + 7 días.
export async function finVentanaAnuncio(db: SupabaseClient, contactId: string, ahora = Date.now()): Promise<number> {
  try {
    const { data } = await db.from("contacts").select("fep_hasta").eq("id", contactId).maybeSingle();
    const marca = (data as any)?.fep_hasta ? Date.parse(String((data as any).fep_hasta)) : NaN;
    if (!Number.isFinite(marca)) return 0;                       // no vino por anuncio
    const clic = marca - 72 * H;
    const limite = clic + 24 * H;                                // hasta cuándo responder para abrirla
    const { data: r } = await db.from("messages").select("ts").eq("contact_id", contactId).eq("direction", "out")
      .gte("ts", new Date(clic).toISOString()).order("ts", { ascending: true }).limit(1).maybeSingle();
    const primera = (r as any)?.ts ? Date.parse(String((r as any).ts)) : NaN;
    if (Number.isFinite(primera) && primera <= limite) return primera + FEP_DIAS * 24 * H;   // se abrió con esa respuesta
    if (ahora <= limite) return ahora + FEP_DIAS * 24 * H;       // nadie respondió aún: esta respuesta la abre
    return 0;                                                    // nadie respondió en 24 h: no se abrió
  } catch (_) { return 0; }
}
