import { describe, expect, it, vi } from "vitest";
import pages from "@/data/seed/pages.json";

vi.mock("server-only", () => ({}));

const { FALLBACK_TEMPLATE_ID, getTemplate, hasTemplate, listTemplates } = await import("./registry");

describe("template registry", () => {
  it("registers the six Sawad page types plus the generic page", () => {
    expect(listTemplates().map((t) => t.id).sort()).toEqual(
      ["compounds", "contact", "generic", "home", "residences", "story", "what-we-do"].sort(),
    );
  });

  it("covers every seeded page", () => {
    for (const p of pages) expect(hasTemplate(p.template), p.slug).toBe(true);
  });

  it("falls back safely for unknown or prototype ids", () => {
    expect(hasTemplate("constructor")).toBe(false);
    expect(getTemplate("__proto__").id).toBe(FALLBACK_TEMPLATE_ID);
    expect(getTemplate("story").id).toBe("story");
  });

  it("seeds each page in English and Arabic", () => {
    const slugs = new Set(pages.map((p) => p.slug));
    for (const p of pages.filter((x) => !x.slug.startsWith("/ar"))) {
      expect(slugs.has(p.slug === "/" ? "/ar" : `/ar${p.slug}`), p.slug).toBe(true);
    }
  });
});
