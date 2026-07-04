// ═══════════════════════════════════════════════════════════════════
// Nodo · Edge Function: media-upload  (AUTENTICADA — verify_jwt=true)
//   Recibe un archivo (base64 / dataURL) del panel, lo sube al bucket
//   público `media` con el service_role (bypassa RLS de Storage) y
//   devuelve su URL pública. Crea el bucket la primera vez.
// ═══════════════════════════════════════════════════════════════════
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/db.ts";

const db = serviceClient();
const BUCKET = "media";
const MAX_BYTES = 16 * 1024 * 1024; // 16 MB

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const { data: u } = await userClient(auth).auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return json({ error: "no_auth" }, 401);
  const { data: member } = await db.from("app_users").select("id").eq("id", uid).eq("activo", true).maybeSingle();
  if (!member) return json({ error: "not_member" }, 403);

  let body: { channel_id?: string; filename?: string; content_type?: string; data?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const { channel_id, filename, content_type, data } = body;
  if (!data) return json({ error: "falta_data" }, 400);

  await ensureBucket();

  // data puede venir como dataURL ("data:mime;base64,....") o base64 puro.
  const b64 = data.includes(",") ? data.split(",")[1] : data;
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }
  catch { return json({ error: "base64_invalido" }, 400); }
  if (bytes.length > MAX_BYTES) return json({ error: "muy_grande", detalle: "Máx 16 MB" }, 413);

  const ext = ((filename?.split(".").pop() || guessExt(content_type) || "bin")).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  const path = `chat/${channel_id || "misc"}/${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType: content_type || "application/octet-stream", upsert: false,
  });
  if (error) return json({ error: "upload_error", detalle: error.message }, 500);

  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
  return json({ ok: true, url: pub.publicUrl, path, kind: kindOf(content_type) });
});

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  try {
    const { data } = await db.storage.getBucket(BUCKET);
    if (!data) await db.storage.createBucket(BUCKET, { public: true });
  } catch {
    try { await db.storage.createBucket(BUCKET, { public: true }); } catch { /* ya existe */ }
  }
  bucketReady = true;
}
function kindOf(ct?: string): string {
  if (!ct) return "document";
  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("audio/")) return "audio";
  if (ct.startsWith("video/")) return "video";
  return "document";
}
function guessExt(ct?: string): string | null {
  const map: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
    "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/webm": "webm", "audio/wav": "wav",
    "video/mp4": "mp4", "application/pdf": "pdf",
  };
  return ct ? (map[ct] ?? null) : null;
}
