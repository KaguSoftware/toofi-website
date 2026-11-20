/**
 * The public address of the site, for the places that need an absolute URL
 * (canonical and hreflang links, social images, robots.txt).
 *
 * Set `NEXT_PUBLIC_SITE_URL` (for example `https://www.example.com`). On Vercel the production
 * domain is used when it is not set. With neither, there is no base: links stay relative
 * rather than pointing at a made-up host.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): URL | undefined {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const raw = explicit || (vercel ? `https://${vercel}` : "");
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}
