import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ page: null as null | Record<string, unknown> }));
vi.mock("@/lib/content/get", () => ({
  getPublishedPageBySlug: async () => m.page,
  getPublishedContent: async () => ({}),
  listPublishedPages: async () => [{ slug: "/" }, { slug: "/ar/residences" }],
}));
vi.mock("@/lib/data", () => ({ getData: () => ({}) }));
vi.mock("@/lib/content/render-context", () => ({ getEditor: async () => null }));
vi.mock("@/components/editable/client", () => ({ EditorRoot: () => null }));

const { generateMetadata, generateStaticParams } = await import("./page");

const props = (slug: string[] | undefined) => ({ params: Promise.resolve({ slug }) }) as never;

describe("CMS page route", () => {
  it("prerenders every published page", async () => {
    expect(await generateStaticParams()).toEqual([{ slug: [] }, { slug: ["ar", "residences"] }]);
  });

  it("links each page to its other-language version (hreflang)", async () => {
    m.page = { slug: "/ar/residences", title: "ابحث عن منزل", seo: { description: "d" } };
    const meta = await generateMetadata(props(["ar", "residences"]));
    expect(meta.title).toBe("ابحث عن منزل");
    expect(meta.alternates).toEqual({
      canonical: "/ar/residences",
      languages: { en: "/residences", ar: "/ar/residences", "x-default": "/residences" },
    });
  });

  it("maps the home page to /ar and back", async () => {
    m.page = { slug: "/", title: "Home", seo: { noindex: true } };
    const meta = await generateMetadata(props(undefined));
    expect(meta.alternates?.languages).toMatchObject({ en: "/", ar: "/ar" });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("returns no metadata for unknown pages", async () => {
    m.page = null;
    expect(await generateMetadata(props(["nope"]))).toEqual({});
  });
});
