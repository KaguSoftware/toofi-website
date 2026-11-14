import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";
import type { Database } from "./database.types";

export type SupabaseServerClient = ReturnType<typeof createServerClient<Database>>;

/**
 * Cookie-backed client acting as the signed-in user (their JWT → RLS applies).
 * Reads `cookies()`, so it can NOT be used inside "use cache" functions or during
 * static prerender; use createSupabaseAnonClient() there. Create one per request —
 * never share it across requests.
 */
export async function createSupabaseServerClient(): Promise<SupabaseServerClient> {
  const { url, publishableKey } = getSupabaseConfig();
  const cookieStore = await cookies();
  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. Safe to ignore:
          // proxy.ts refreshes the session cookie on every request.
        }
      },
    },
  });
}

/**
 * Cookie-less client using only the publishable key (role `anon`). Safe inside
 * "use cache": it never touches request data, and RLS limits it to published content.
 */
export function createSupabaseAnonClient() {
  const { url, publishableKey } = getSupabaseConfig();
  return createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
