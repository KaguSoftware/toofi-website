/** Accepts only same-origin relative paths: one leading "/", not "//" or "/\". */
export function safeNext(value: unknown, fallback = "/admin"): string {
  if (typeof value !== "string" || value.length > 2000) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  for (const ch of value) {
    const c = ch.charCodeAt(0);
    if (c < 0x20 || c === 0x7f || ch === "\\") return fallback;
  }
  return value;
}
