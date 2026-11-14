import "server-only";
import { cache } from "react";
import { getAuth } from "./index";
import type { SessionUser } from "./roles";

/**
 * Current user for this request (deduped per request with React.cache).
 * Reads cookies → must be called inside a <Suspense> boundary in Server Components
 * (Cache Components rule), or from Server Actions / Route Handlers.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  return getAuth().getSessionUser();
});
