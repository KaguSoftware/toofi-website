import "server-only";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { getAuthSecret, env } from "@/lib/env";
import { localFindUserByEmail, localFindUserById } from "@/lib/data/local";
import { signLocalSession, verifyLocalSession, LOCAL_SESSION_COOKIE, LOCAL_SESSION_MAX_AGE } from "./local-token";
import type { AuthProvider } from "./types";

// Constant-time-ish: always run a bcrypt compare, even for unknown emails.
const DUMMY_HASH = "$2b$10$TZKNaT4OgKAV6y.mskp8..eqasMfBhyJWn42kKJKBObt0wRsEgdPi";

export const localAuth: AuthProvider = {
  async getSessionUser() {
    const token = (await cookies()).get(LOCAL_SESSION_COOKIE)?.value;
    if (!token) return null;
    const payload = await verifyLocalSession(token, getAuthSecret());
    if (!payload) return null;
    // Re-read the user so role changes / deletions take effect immediately.
    const user = await localFindUserById(payload.sub);
    if (!user) return null;
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  },

  async signInWithPassword(email, password) {
    const user = await localFindUserByEmail(email.trim());
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) return { ok: false, error: "Invalid email or password" };

    const token = await signLocalSession(user.id, getAuthSecret());
    (await cookies()).set(LOCAL_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      path: "/",
      maxAge: LOCAL_SESSION_MAX_AGE,
    });
    return { ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  },

  async signOut() {
    (await cookies()).delete(LOCAL_SESSION_COOKIE);
  },
};
