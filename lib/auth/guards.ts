import "server-only";
import { redirect, forbidden } from "next/navigation";
import { getCurrentUser } from "./session";
import { can, type Permission, type SessionUser } from "./roles";

/**
 * Authorization guards. Call one at the top of EVERY Server Action, Route Handler
 * and protected Server Component. Never rely on UI hiding or proxy.ts alone.
 */

export class AuthError extends Error {
  constructor(
    public readonly code: "UNAUTHENTICATED" | "FORBIDDEN",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AuthError";
  }
}

/** For Server Actions / Route Handlers: throws AuthError (convert to a result or 401/403). */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("UNAUTHENTICATED", "You must be signed in");
  if (!can(user.role, permission)) throw new AuthError("FORBIDDEN", `Missing permission: ${permission}`);
  return user;
}

/** For Server Components / pages: redirects to login, or renders forbidden.tsx. */
export async function requirePagePermission(permission: Permission, returnTo?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(returnTo ? `/admin/login?next=${encodeURIComponent(returnTo)}` : "/admin/login");
  }
  if (!can(user.role, permission)) forbidden();
  return user;
}

/** Route-handler helper mapping AuthError → HTTP response. */
export function authErrorResponse(err: unknown): Response | null {
  if (err instanceof AuthError) {
    return Response.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 403 });
  }
  return null;
}
