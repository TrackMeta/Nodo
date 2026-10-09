// Utilidades compartidas de la base de Apps (kit + nodo).
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function db(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-nodo-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export async function sha256(txt: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Código aleatorio legible (sin 0/O/1/l para que no se confundan si alguien lo dicta).
const ABC = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function codigo(n = 24): string {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, (x) => ABC[x % ABC.length]).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Estado de un acceso en este instante. «por vencer» lo calcula quien muestra (panel).
export type Estado = "activo" | "prueba" | "vencido" | "prueba_terminada" | "bloqueado";
export function estadoDe(a: { bloqueado?: boolean; tipo: string; vence_at?: string | null }, ahora = Date.now()): Estado {
  if (a.bloqueado) return "bloqueado";
  if (!a.vence_at) return a.tipo === "prueba" ? "prueba_terminada" : "activo";
  const vivo = new Date(a.vence_at).getTime() > ahora;
  if (a.tipo === "prueba") return vivo ? "prueba" : "prueba_terminada";
  return vivo ? "activo" : "vencido";
}

// Link personal que se le manda al cliente.
export function linkPersonal(url: string, token: string): string {
  const u = (url || "").trim();
  if (!u) return "";
  return u + (u.includes("?") ? "&" : "?") + "acceso=" + encodeURIComponent(token);
}
