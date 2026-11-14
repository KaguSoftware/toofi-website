import { describe, expect, it } from "vitest";
import {
  hrefSchema,
  imageValueSchema,
  richTextValueSchema,
  RICH_MAX_DEPTH,
  slugSchema,
} from "./schemas";

describe("hrefSchema", () => {
  it.each(["/about", "#top", "mailto:a@b.co", "tel:+123", "https://x.dev", ""])("accepts %s", (v) => {
    expect(hrefSchema.safeParse(v).success).toBe(true);
  });
  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,x",
    "//evil.com",
    "/\\evil.com",
    "/ok\u0000",
    "/a\nb",
    "vbscript:x",
  ])("rejects %j", (v) => {
    expect(hrefSchema.safeParse(v).success).toBe(false);
  });
});

describe("imageValueSchema", () => {
  it("rejects protocol-relative and backslash src", () => {
    for (const src of ["//evil.com/x.png", "/\\evil.com/x.png", "http://insecure/x.png", "javascript:x"]) {
      expect(imageValueSchema.safeParse({ src, alt: "" }).success).toBe(false);
    }
  });
  it("accepts relative and https src", () => {
    expect(imageValueSchema.safeParse({ src: "/api/media/x.png", alt: "" }).success).toBe(true);
    expect(imageValueSchema.safeParse({ src: "https://cdn.x/y.webp", alt: "a" }).success).toBe(true);
  });
});

describe("richTextValueSchema", () => {
  const nest = (depth: number) => {
    let node: Record<string, unknown> = { type: "text", text: "x" };
    for (let i = 1; i < depth; i++) node = { type: "blockquote", content: [node] };
    return { doc: { ...node, type: "doc" } };
  };

  it("accepts a normal document and strips unknown attrs", () => {
    const r = richTextValueSchema.safeParse({
      doc: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2, onclick: "x", style: "y" }, content: [{ type: "text", text: "Hi" }] },
          {
            type: "paragraph",
            content: [{ type: "text", text: "link", marks: [{ type: "link", attrs: { href: "/a", onmouseover: "x" } }] }],
          },
        ],
      },
    });
    expect(r.success).toBe(true);
    const json = JSON.stringify(r.data);
    expect(json).not.toContain("onclick");
    expect(json).not.toContain("onmouseover");
    expect(json).not.toContain("style");
  });

  it("rejects javascript: links in marks", () => {
    const r = richTextValueSchema.safeParse({
      doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] },
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown node types", () => {
    expect(richTextValueSchema.safeParse({ doc: { type: "doc", content: [{ type: "iframe" }] } }).success).toBe(false);
  });

  it("enforces a max depth without overflowing the stack", () => {
    expect(richTextValueSchema.safeParse(nest(RICH_MAX_DEPTH)).success).toBe(true);
    expect(richTextValueSchema.safeParse(nest(RICH_MAX_DEPTH + 1)).success).toBe(false);
    expect(richTextValueSchema.safeParse(nest(100_000)).success).toBe(false);
  });
});

describe("slugSchema", () => {
  it.each(["/", "/about", "/services/web-design"])("accepts %s", (v) => expect(slugSchema.safeParse(v).success).toBe(true));
  it.each(["/About", "/a/../b", "/a.php", "about", "/a/", "/a--b", "//x"])("rejects %s", (v) =>
    expect(slugSchema.safeParse(v).success).toBe(false),
  );
});
