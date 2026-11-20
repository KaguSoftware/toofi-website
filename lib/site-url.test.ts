import { describe, expect, it } from "vitest";
import { siteUrl } from "./site-url";

describe("siteUrl", () => {
  it("is undefined when nothing is configured, so links stay relative", () => {
    expect(siteUrl({})).toBeUndefined();
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "   " })).toBeUndefined();
  });

  it("reads NEXT_PUBLIC_SITE_URL", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://www.example.com" })?.href).toBe("https://www.example.com/");
  });

  it("falls back to the Vercel production domain", () => {
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "sawad.example.app" })?.href).toBe("https://sawad.example.app/");
  });

  it("prefers the explicit address over Vercel's", () => {
    const url = siteUrl({ NEXT_PUBLIC_SITE_URL: "https://www.example.com", VERCEL_PROJECT_PRODUCTION_URL: "sawad.example.app" });
    expect(url?.host).toBe("www.example.com");
  });

  it("ignores an address that is not a web URL", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "not a url" })).toBeUndefined();
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "ftp://files.example.com" })).toBeUndefined();
  });
});
