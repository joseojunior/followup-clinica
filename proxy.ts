import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const excludedApiPrefixes = ["/api/internal", "/api/webhooks", "/api/health"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (excludedApiPrefixes.some((prefix) => pathname.startsWith(prefix))) return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const isApi = pathname.startsWith("/api/");
  if (!url || !key) {
    if (pathname === "/login") return NextResponse.next();
    if (isApi) return NextResponse.json({ error: "Supabase Auth ainda não foi configurado." }, { status: 503 });
    return NextResponse.redirect(new URL("/login", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookies) {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    if (isApi) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
    if (pathname !== "/login") return NextResponse.redirect(new URL("/login", request.url));
  }
  if (user && pathname === "/login") return NextResponse.redirect(new URL("/", request.url));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
