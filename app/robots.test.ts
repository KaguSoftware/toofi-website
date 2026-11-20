import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "./robots";

afterEach(() => vi.unstubAllEnvs());

describe("robots", () => {
  it("lets crawlers read the site and keeps them out of the admin panel and the API", () => {
    const out = robots();
    expect(out.rules).toEqual({ userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] });
  });

  it("names the host only when the site address is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(robots().host).toBeUndefined();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.example.com/some/path");
    expect(robots().host).toBe("https://www.example.com");
  });
});
