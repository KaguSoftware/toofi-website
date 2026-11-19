import { describe, expect, it } from "vitest";
import blocks from "./blocks.json";
import pages from "./pages.json";
import { blockContentSchema, blockKeySchema, scopeSchema } from "../../lib/content/schemas";

describe("seed content", () => {
  it("has blocks", () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  it.each(blocks.map((b) => [`${b.scope.slice(0, 8)}:${b.key}`, b] as const))("%s is valid", (_, b) => {
    expect(scopeSchema.safeParse(b.scope).success).toBe(true);
    expect(blockKeySchema.safeParse(b.key).success).toBe(true);
    const r = blockContentSchema.safeParse({ type: b.type, value: b.value });
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues)).toBe(true);
  });

  it("every block scope is global or a seeded page", () => {
    const ids = new Set(["global", ...pages.map((p) => p.id)]);
    for (const b of blocks) expect(ids.has(b.scope)).toBe(true);
  });

  it("list items have their field blocks' parent list", () => {
    const keys = new Set(blocks.map((b) => `${b.scope}|${b.key}`));
    for (const b of blocks.filter((x) => x.type === "list")) {
      expect((b.value as unknown as { items: string[] }).items.length).toBeGreaterThan(0);
      expect(keys.has(`${b.scope}|${b.key}`)).toBe(true);
    }
  });
});
