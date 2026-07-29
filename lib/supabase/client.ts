import { createBrowserClient } from "@supabase/ssr";
import { hasSupabaseAuthConfig, supabasePublishableKey, supabaseUrl } from "@/lib/supabase/config";

export function createSupabaseBrowserClient() {
  if (!hasSupabaseAuthConfig()) throw new Error("As credenciais do Supabase Auth ainda não foram configuradas.");
  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
