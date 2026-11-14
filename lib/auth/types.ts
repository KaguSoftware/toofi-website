import type { SessionUser } from "./roles";

export type SignInResult = { ok: true; user: SessionUser } | { ok: false; error: string };

/**
 * AuthProvider — implemented by LocalAuth (signed cookie, seeded users) and
 * SupabaseAuth (@supabase/ssr). Both read/write cookies via next/headers, so
 * they may only be called from Server Components, Server Actions and Route Handlers.
 */
export interface AuthProvider {
  /** Resolve the current user from request cookies, with an up-to-date role. Never throws for "no session". */
  getSessionUser(): Promise<SessionUser | null>;
  signInWithPassword(email: string, password: string): Promise<SignInResult>;
  signOut(): Promise<void>;
}
