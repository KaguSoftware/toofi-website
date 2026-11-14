import { z } from "zod";
import { AuthError } from "@/lib/auth/guards";

export type FieldErrors = Record<string, string[]>;
export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

export const GENERIC_ERROR = "Something went wrong. Please try again.";

export function fail(error: string, fieldErrors?: FieldErrors): ActionResult {
  return { ok: false, error, fieldErrors };
}

/** Maps any thrown value to a safe result. Never leaks messages of unknown errors. Re-throws Next control-flow errors. */
export function toFailure(err: unknown): ActionResult {
  if (err instanceof AuthError) {
    return fail(err.code === "UNAUTHENTICATED" ? "Your session has expired. Please sign in again." : "You don't have permission to do that.");
  }
  if (err instanceof z.ZodError) {
    return fail("Please fix the highlighted fields.", z.flattenError(err).fieldErrors as FieldErrors);
  }
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "DYNAMIC_SERVER_USAGE")) {
    throw err;
  }
  console.error("[admin action]", err instanceof Error ? err.message : "unknown error");
  return fail(GENERIC_ERROR);
}
