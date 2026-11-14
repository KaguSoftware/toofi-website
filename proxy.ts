import { NextResponse, type NextRequest } from "next/server";
import { LOCAL_SESSION_COOKIE, verifyLocalSession } from "@/lib/auth/local-token";
import { updateSupabaseSession } from "@/lib/supabase/proxy";

/**
 * Proxy (Next 16's middleware). Two jobs only:
 *  1. Supabase mode: refresh the auth session cookie on every matched request.
 *  2. Optimistic gate: bounce signed-out users from /admin to /admin/login.
 *
 * This is NOT authorization — roles are checked in every page/action via lib/auth/guards.
 */
const isSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

const DEV_AUTH_SECRET = "toofi-dev-only-secret-do-not-use-in-production-0000";

async function localUserId(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(LOCAL_SESSION_COOKIE)?.value;
  const secret = process.env.AUTH_SECRET ?? (process.env.NODE_ENV === "production" ? undefined : DEV_AUTH_SECRET);
  if (!token || !secret) return null;
  return (await verifyLocalSession(token, new TextEncoder().encode(secret)))?.sub ?? null;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  let userId: string | null;

  if (isSupabase) {
    ({ response, userId } = await updateSupabaseSession(request, response));
  } else {
    userId = await localUserId(request);
  }

  const { pathname, search } = request.nextUrl;
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const isLogin = pathname === "/admin/login";

  if (isAdmin && !isLogin && !userId) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets & image optimizer.
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
