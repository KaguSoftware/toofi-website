import "server-only";
import { assertLocalModeAllowed, backendMode } from "@/lib/env";
import { localAuth } from "./local";
import { supabaseAuth } from "./supabase";
import type { AuthProvider } from "./types";

export function getAuth(): AuthProvider {
  if (backendMode === "supabase") return supabaseAuth;
  assertLocalModeAllowed();
  return localAuth;
}
