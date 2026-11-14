/**
 * Path helpers shared by the editor (client), Server Actions and route handlers.
 * Pure — safe in any environment.
 */

/**
 * Returns the pathname if `input` is a same-origin relative path ("/about"),
 * otherwise null. Rejects protocol-relative ("//evil.com"), backslash tricks
 * ("/\\evil.com"), absolute URLs and control characters (open-redirect protection).
 */
export function safeRelativePath(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0 || input.length > 2_000) return null;
  if (!input.startsWith("/") || input.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(input)) return null;
  try {
    const base = "http://toofi.invalid";
    const url = new URL(input, base);
    if (url.origin !== base) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

/** URL of the route that turns edit mode on for a page path. */
export function editEnableUrl(pathname: string): string {
  return `/api/edit/enable?path=${encodeURIComponent(pathname)}`;
}

/** Cookie set (non-httpOnly, UX hint only) for users who may edit content. */
export const CAN_EDIT_HINT_COOKIE = "toofi_can_edit";

/** `<html>` attribute set while the inline editor is mounted. */
export const EDITING_HTML_ATTR = "data-toofi-editing";
