import "server-only";

/**
 * Best-effort in-memory login limiter. State lives in one server instance, so it resets
 * on restart and isn't shared across serverless instances. For real protection add an
 * edge/WAF rate limit (and, in Supabase mode, its built-in auth limits / CAPTCHA).
 *
 * - Attempts are counted BEFORE the password check, so parallel bursts can't all slip
 *   through while bcrypt runs.
 * - Two independent buckets: per email (can't be bypassed by rotating X-Forwarded-For)
 *   and per IP (stops spraying many emails from one client).
 * - The map is capped; the oldest entries are evicted first.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_PER_EMAIL = 10;
const MAX_PER_IP = 30;
const MAX_ENTRIES = 10_000;

type Bucket = { count: number; first: number };
const buckets = new Map<string, Bucket>();

function hit(key: string, max: number, now: number): number {
  let b = buckets.get(key);
  if (b && now - b.first > WINDOW_MS) {
    buckets.delete(key);
    b = undefined;
  }
  if (b && b.count >= max) return Math.ceil((b.first + WINDOW_MS - now) / 1000);
  if (b) b.count++;
  else {
    if (buckets.size >= MAX_ENTRIES) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
    buckets.set(key, { count: 1, first: now });
  }
  return 0;
}

/**
 * Register a login attempt. Returns seconds to wait if blocked (attempt not counted),
 * otherwise 0 (attempt counted).
 */
export function beginLoginAttempt(email: string, ip: string): number {
  const now = Date.now();
  const emailWait = hit(`e:${email.toLowerCase()}`, MAX_PER_EMAIL, now);
  if (emailWait) return emailWait;
  return hit(`i:${ip}`, MAX_PER_IP, now);
}

/** Successful sign-in clears that email's bucket (the IP bucket keeps counting). */
export function loginSucceeded(email: string) {
  buckets.delete(`e:${email.toLowerCase()}`);
}
