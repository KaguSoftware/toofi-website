import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

/** Crawlers may read the public site; the admin panel and the API are not for them. */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] },
    ...(base ? { host: base.origin } : {}),
  };
}
