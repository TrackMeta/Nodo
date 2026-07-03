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
  } | null;
}
