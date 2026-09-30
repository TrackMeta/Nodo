// 🔗 Enlace PERMANENTE y REVOCABLE a un archivo del bucket privado «comprobantes».
//
// Antes se guardaba una URL firmada de Storage de 10 años (en messages, orders.shipping, Sheets y
// Telegram): una vez filtrada no había forma de anularla —la única llave es el secreto JWT del
// proyecto, que no se puede rotar sin tumbar el panel— y un comprobante es dato financiero del
// cliente (auditoría 2026-09-30). Ahora se guarda un enlace a la función `archivo`, firmado con
// HMAC; la función comprueba la firma y redirige a una URL de Storage de pocos minutos. Para
// anular TODOS los enlaces basta con cambiar el secreto ARCHIVO_SECRET.
//
// El archivo va en la RUTA (…/archivo/<cuenta>/<contacto>/<n>.pdf?s=…), no en la query: el
// código que decide «es PDF» mira la extensión antes del «?», y así sigue funcionando.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "./crypto.ts";
import { serviceClient } from "./db.ts";

export const ARCHIVO_BUCKET = "comprobantes";

function secreto(): string {
  // Sin ARCHIVO_SECRET se deriva de la service key (el HMAC no la expone). Ojo: definirlo DESPUÉS
  // invalida los enlaces ya guardados — es justamente el botón de «anular todo».
  return Deno.env.get("ARCHIVO_SECRET") || ("archivo:" + (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""));
}

async function hmacHex(texto: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(texto));
  // 32 hex (128 bits) alcanzan de sobra para no poder adivinarla y acortan el enlace.
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

const ruta = (path: string) => path.split("/").map(encodeURIComponent).join("/");

// El enlace que se guarda. `path` es la ruta dentro del bucket (sin el nombre del bucket).
export async function urlArchivo(path: string): Promise<string> {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  return `${base}/functions/v1/archivo/${ruta(path)}?s=${await hmacHex(path)}`;
}

export async function firmaArchivoValida(path: string, firma: string): Promise<boolean> {
  if (!path || !firma) return false;
  return timingSafeEqual(await hmacHex(path), firma);
}

// ¿Es un enlace nuestro? Devuelve la ruta dentro del bucket (validada) o null.
export async function pathDeUrlArchivo(url: string): Promise<string | null> {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/functions\/v1\/archivo\/(.+)$/);
    if (!m) return null;
    const path = m[1].split("/").map(decodeURIComponent).join("/");
    return (await firmaArchivoValida(path, u.searchParams.get("s") ?? "")) ? path : null;
  } catch (_) { return null; }
}

// Para quien baja el archivo del lado del SERVIDOR (el modelo que lee el Yape, Telegram): una URL
// directa de Storage corta, sin pasar por la redirección (no todos la siguen). Si no es nuestra, igual.
export async function urlDirecta(url: string, segundos = 3600, db?: SupabaseClient): Promise<string> {
  const path = await pathDeUrlArchivo(url);
  if (!path) return url;
  const { data } = await (db ?? serviceClient()).storage.from(ARCHIVO_BUCKET).createSignedUrl(path, segundos);
  return data?.signedUrl ?? url;
}
