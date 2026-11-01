import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function requireMetaAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const allowed = (process.env.META_ADMIN_EMAILS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!url || !key || !allowed.length) return null;
  const jar = await cookies();
  const client = createServerClient(url, key, { cookies: { getAll: () => jar.getAll(), setAll: () => undefined } });
  const { data: { user } } = await client.auth.getUser();
  if (!user?.email || !allowed.includes(user.email.toLowerCase())) return null;
  return user.email;
}
