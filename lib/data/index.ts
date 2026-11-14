import "server-only";
import { assertLocalModeAllowed, backendMode } from "@/lib/env";
import { localProvider } from "./local";
import { supabaseProvider, supabaseSessionProvider } from "./supabase";
import type { DataProvider } from "./types";

/**
 * The active DataProvider for request-time code (Server Actions, route handlers,
 * edit mode, admin pages). In Supabase mode it uses the signed-in user's session,
 * so editors also see draft pages, and RLS applies.
 *
 * It reads cookies, so it must NOT be called inside "use cache". Use getPublicData() there.
 * It does NOT authorize. Call lib/auth/guards first.
 */
export function getData(): DataProvider {
  if (backendMode === "supabase") return supabaseSessionProvider;
  assertLocalModeAllowed();
  return localProvider;
}

/**
 * Cookie-less provider for cached public reads (lib/content/get.ts). In Supabase mode
 * it uses the anon key, so it can only ever see published pages and content.
 */
export function getPublicData(): DataProvider {
  if (backendMode === "supabase") return supabaseProvider;
  assertLocalModeAllowed();
  return localProvider;
}

export type * from "./types";
