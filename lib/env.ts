import "server-only";
import { z } from "zod";

/**
 * Environment + backend mode detection.
 *
 * - "supabase": NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are set.
 * - "local":    nothing set → sample data from data/seed, writes to .data/ (dev only).
 *
 * Local mode is refused at request time in production unless TOOFI_ALLOW_LOCAL_MODE=1
 * (it is always allowed during `next build` so CI can build without a database).
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  SUPABASE_MEDIA_BUCKET: z.string().min(1).default("content-media"),
  AUTH_SECRET: z.string().min(32).optional(),
  TOOFI_ALLOW_LOCAL_MODE: z.enum(["0", "1"]).optional(),
  NEXT_PHASE: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(
    "Invalid environment variables:\n" + z.prettifyError(parsed.error),
  );
}

export const env = parsed.data;

export type BackendMode = "supabase" | "local";

export const backendMode: BackendMode =
  env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ? "supabase"
    : "local";

const isBuildPhase = env.NEXT_PHASE === "phase-production-build";

/** Throws if local mode is used on a production server without explicit opt-in. */
export function assertLocalModeAllowed() {
  if (backendMode !== "local") return;
  if (env.NODE_ENV !== "production" || isBuildPhase) return;
  if (env.TOOFI_ALLOW_LOCAL_MODE === "1") return;
  throw new Error(
    "Toofi is running in LOCAL mode (no Supabase env vars) on a production server. " +
      "Set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, " +
      "or TOOFI_ALLOW_LOCAL_MODE=1 for a throwaway demo.",
  );
}

const DEV_AUTH_SECRET = "toofi-dev-only-secret-do-not-use-in-production-0000";

/** Secret used to sign local-mode session cookies. */
export function getAuthSecret(): Uint8Array {
  const secret = env.AUTH_SECRET ?? (env.NODE_ENV === "production" && !isBuildPhase ? undefined : DEV_AUTH_SECRET);
  if (!secret) {
    throw new Error("AUTH_SECRET (min 32 chars) is required in production local mode.");
  }
  return new TextEncoder().encode(secret);
}
