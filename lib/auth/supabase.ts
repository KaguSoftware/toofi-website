import "server-only";
import { isRole, type SessionUser } from "./roles";
import { createSupabaseServerClient, type SupabaseServerClient } from "@/lib/supabase/server";
import type { AuthProvider } from "./types";

/**
 * SupabaseAuth — cookie sessions via @supabase/ssr.
 * Identity comes from getClaims() (JWT signature verified), never from the unverified
 * cookie contents. The role is read from public.profiles, not from the token, so role
 * changes take effect immediately in the app.
 */

async function loadSessionUser(db: SupabaseServerClient, userId: string): Promise<SessionUser | null> {
  const { data, error } = await db.from("profiles").select("id, email, name, role").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  return { id: data.id, email: data.email, name: data.name, role: isRole(data.role) ? data.role : "member" };
}

export const supabaseAuth: AuthProvider = {
  async getSessionUser() {
    const db = await createSupabaseServerClient();
    const { data, error } = await db.auth.getClaims();
    const sub = data?.claims.sub;
    if (error || !sub) return null;
    return loadSessionUser(db, sub);
  },

  async signInWithPassword(email, password) {
    const db = await createSupabaseServerClient();
    const { data, error } = await db.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) return { ok: false, error: "Invalid email or password" };

    const user = await loadSessionUser(db, data.user.id);
    if (!user) {
      await db.auth.signOut({ scope: "local" });
      return { ok: false, error: "This account has no profile. Contact an administrator." };
    }
    return { ok: true, user };
  },

  async signOut() {
    const db = await createSupabaseServerClient();
    await db.auth.signOut({ scope: "local" });
  },
};
