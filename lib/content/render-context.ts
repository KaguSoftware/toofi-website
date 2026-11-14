import "server-only";
import { draftMode } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { can, type SessionUser } from "@/lib/auth/roles";

/**
 * Is this request an authorized edit-mode request?
 *
 * Both are required:
 *  1. Draft Mode is on (cookie set by /api/edit/enable after an auth check), and
 *  2. the current session has `content:edit` right now (role may have changed).
 *
 * A stolen/leftover draft cookie without a valid editor session just renders the
 * published site. Reads cookies → call inside <Suspense>.
 */
export async function getEditor(): Promise<SessionUser | null> {
  const { isEnabled } = await draftMode();
  if (!isEnabled) return null;
  const user = await getCurrentUser();
  return user && can(user.role, "content:edit") ? user : null;
}
