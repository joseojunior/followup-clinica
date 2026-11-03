import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function requireMetaAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const jar = await cookies();
  const client = createServerClient(url, key, { cookies: { getAll: () => jar.getAll(), setAll: () => undefined } });
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  return user.id;
}
