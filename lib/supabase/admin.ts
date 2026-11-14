import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { getSupabaseConfig } from "./config";
import type { Database } from "./database.types";

/**
 * Secret-key client (bypasses RLS). SERVER ONLY — never import into client code and
 * never return its data without an explicit permission check by the caller
 * (listUsers / setUserRole are guarded by `users:manage` in lib/auth/guards).
 */
export function createSupabaseAdminClient() {
  const { url } = getSupabaseConfig();
  const secret = env.SUPABASE_SECRET_KEY;
  if (!secret) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. It is required for user management (listing users / changing roles). " +
        "Create a secret key in the Supabase dashboard (Project Settings → API Keys) and add it to your server environment.",
    );
  }
  return createClient<Database>(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
