import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "./config";
import type { Database } from "./database.types";

/**
 * Refreshes the Supabase auth cookies for this request and returns the verified user id.
 * Runs in proxy.ts (no next/headers, no server-only): cookies are read from the request
 * and written to both the forwarded request (so Server Components see the fresh token)
 * and the response (so the browser stores it).
 *
 * `getClaims()` validates the JWT signature (JWKS, cached) and only calls the Auth
 * server when the token needs refreshing. This is an optimistic gate only — pages and
 * actions still authorize via lib/auth/guards.
 */
export async function updateSupabaseSession(
  request: NextRequest,
  response: NextResponse,
): Promise<{ response: NextResponse; userId: string | null }> {
  const { url, publishableKey } = getSupabaseConfig();

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // Responses that set auth cookies must not be cached by CDNs.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getClaims();
    userId = data?.claims.sub ?? null;
  } catch {
    // Auth server unreachable etc.: treat as signed out; the page-level guards decide.
    userId = null;
  }
  return { response, userId };
}
