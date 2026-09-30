// GET /functions/v1/archivo/<ruta en el bucket>?s=<firma>
// Abre un comprobante / archivo del cliente guardado en el bucket privado: comprueba la firma
// HMAC del enlace (ver _shared/archivo.ts) y redirige a una URL de Storage de 10 minutos.
// Sin JWT a propósito: el enlace se abre desde un <img> del panel, desde Sheets o desde Telegram.
import { serviceClient } from "../_shared/db.ts";
import { ARCHIVO_BUCKET, firmaArchivoValida } from "../_shared/archivo.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("método no permitido", { status: 405, headers: CORS });
  const u = new URL(req.url);
  const m = u.pathname.match(/\/archivo\/(.+)$/);
  let path = "";
  try { path = m ? m[1].split("/").map(decodeURIComponent).join("/") : ""; } catch (_) { path = ""; }
  // Nada de subir de carpeta ni rutas raras: lo que se firma es exactamente lo que se abre.
  if (!path || path.includes("..") || !(await firmaArchivoValida(path, u.searchParams.get("s") ?? ""))) {
    return new Response("enlace no válido", { status: 403, headers: CORS });
  }
  const db = serviceClient();
  const { data, error } = await db.storage.from(ARCHIVO_BUCKET).createSignedUrl(path, 600);
  if (error || !data?.signedUrl) return new Response("archivo no encontrado", { status: 404, headers: CORS });
  return new Response(null, {
    status: 302,
    headers: { ...CORS, Location: data.signedUrl, "Cache-Control": "private, max-age=300" },
  });
});
