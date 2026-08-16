// Cliente Supabase con service_role para las Edge Functions.
// Bypassa RLS → acceso total. NUNCA exponer esta key al frontend.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Cliente con el JWT del usuario que llama (para verificar identidad/rol).
export function userClient(authHeader: string): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ¿El usuario (por su id de auth) es miembro ACTIVO de la cuenta dueña del
// canal? Multi-tenant: las Edge Functions corren con service_role y se saltan
// la RLS, así que ESTE chequeo es el que impide operar el canal de OTRA cuenta
// pasando su channel_id. La RLS del panel tapa la lectura directa; esto tapa
// las funciones. Devuelve false ante cualquier duda (uid/canal faltante, canal
// sin cuenta, o sin membresía activa).
export async function userOwnsChannel(
  db: SupabaseClient,
  uid: string | undefined | null,
  channelId: string | undefined | null,
): Promise<boolean> {
  if (!uid || !channelId) return false;
  const { data: ch } = await db
    .from("channels").select("account_id").eq("id", channelId).maybeSingle();
  const accountId = (ch as { account_id?: string } | null)?.account_id;
  if (!accountId) return false;
  const { data: mem } = await db
    .from("account_members").select("user_id")
    .eq("account_id", accountId).eq("user_id", uid).eq("activo", true).maybeSingle();
  return !!mem;
}

// ¿El usuario es ADMIN de la cuenta dueña del canal? El rol vive en account_members.role
// (POR CUENTA), NO en app_users.role (legacy GLOBAL). Los dos DIVERGEN: signup deja
// app_users.role='operador' por default y apply_invitation solo setea account_members.role.
// Chequear app_users.role tenía DOS bugs: (1) escalada — un usuario con role='admin' global
// agregado a OTRA cuenta como operador pasaba como admin ahí; (2) bloqueo — un admin invitado
// (account_members.role='admin' pero app_users.role='operador') recibía 403 en su propio canal.
// platform_admin (superadmin de la plataforma) siempre pasa. Devuelve false ante cualquier duda.
export async function userIsChannelAdmin(
  db: SupabaseClient, uid: string | undefined | null, channelId: string | undefined | null,
): Promise<boolean> {
  if (!uid || !channelId) return false;
  const { data: u } = await db.from("app_users").select("platform_admin").eq("id", uid).maybeSingle();
  if ((u as { platform_admin?: boolean } | null)?.platform_admin === true) return true;
  const { data: ch } = await db.from("channels").select("account_id").eq("id", channelId).maybeSingle();
  const accountId = (ch as { account_id?: string } | null)?.account_id;
  if (!accountId) return false;
  const { data: mem } = await db.from("account_members").select("role")
    .eq("account_id", accountId).eq("user_id", uid).eq("activo", true).maybeSingle();
  return (mem as { role?: string } | null)?.role === "admin";
}

// Cuenta dueña de un canal. Multi-tenant: se usa para agrupar los archivos de
// Storage por cuenta (rutas acct/{account_id}/…). Devuelve null si no hay.
export async function accountOfChannel(
  db: SupabaseClient, channelId: string | undefined | null,
): Promise<string | null> {
  if (!channelId) return null;
  const { data } = await db.from("channels").select("account_id").eq("id", channelId).maybeSingle();
  return (data as { account_id?: string } | null)?.account_id ?? null;
}

// Descifra los secretos de un canal vía Vault (RPC SECURITY DEFINER).
export async function getChannelSecrets(db: SupabaseClient, channelId: string) {
  const { data, error } = await db
    .rpc("get_channel_secrets", { p_channel_id: channelId })
    .maybeSingle();
  if (error) throw new Error(`get_channel_secrets: ${error.message}`);
  return data as {
    access_token: string | null;
    app_secret: string | null;
    capi_token: string | null;
    telegram_bot_token: string | null;
    ads_token: string | null;
  } | null;
}
