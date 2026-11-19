import { describe, expect, it } from "vitest";
import { LEADERSHIP, OPERATIONS, PARTNERS, PRINCIPLES, PROCESS, TIMELINE } from "./content";

const texts = (o: unknown): string[] =>
  typeof o === "string" ? [o] : typeof o === "object" && o ? Object.values(o).flatMap(texts) : [];

describe("long-form content", () => {
  it("matches the design overview structure", () => {
    expect(OPERATIONS.map((o) => o.id)).toEqual(["development", "construction", "landscape", "sales", "community"]);
    expect(PROCESS.map((p) => p.title.en)).toEqual(["Choose", "Visit", "Reserve", "Sign", "Move in"]);
    expect(PARTNERS.map((p) => p.interest)).toEqual(["landowner", "investor", "supplier"]);
    expect(TIMELINE.map((m) => m.year)).toEqual([2009, 2014, 2018, 2021, 2024]);
    expect(PRINCIPLES.length).toBeGreaterThanOrEqual(3);
    expect(LEADERSHIP.length).toBeGreaterThan(0);
  });

  it("has English and Arabic for every string, without em dashes", () => {
    for (const s of texts([OPERATIONS, PROCESS, PARTNERS, TIMELINE, PRINCIPLES, LEADERSHIP])) {
      expect(s.trim()).not.toBe("");
      expect(s).not.toContain("—");
    }
    for (const item of [...OPERATIONS, ...PROCESS, ...PRINCIPLES]) {
      expect(item.title.ar).toMatch(/[؀-ۿ]/);
      expect(item.body.ar).toMatch(/[؀-ۿ]/);
    }
  });
});
