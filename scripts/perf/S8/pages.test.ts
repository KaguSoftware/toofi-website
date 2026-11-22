import { describe, expect, it } from "vitest";
import { pagesTable, shiftsByNode, summarize } from "./pages.mjs";

describe("shiftsByNode", () => {
  it("adds each shift's value to the element that moved, largest first", () => {
    const shifts = [
      { at: 1, value: 0.4, sources: [{ node: "div.finder" }] },
      { at: 2, value: 0.2, sources: [{ node: "div.finder" }, { node: "p.lead" }] },
      { at: 3, value: 0.05, sources: [] },
    ];
    const rows = shiftsByNode(shifts);
    expect(rows[0]).toMatchObject({ node: "div.finder", count: 2 });
    expect(rows[0].value).toBeCloseTo(0.5);
    expect(rows.map((r: { node: string }) => r.node)).toEqual(["div.finder", "p.lead", "(unknown)"]);
  });
});

describe("summarize and pagesTable", () => {
  const run = (cls: number, bytes: number) => ({
    fcpMs: 500, lcpMs: 900, cls, blocking: { blockingMs: 20, longestMs: 80 }, bytes, requests: 12,
    kinds: { js: 1000, font: 200 },
  });
  it("takes medians and prints a row per route", () => {
    const med = summarize([run(0.1, 100), run(0.3, 300), run(0.2, 200)]);
    expect(med.cls).toBeCloseTo(0.2);
    expect(med.bytes).toBe(200);
    expect(med.fontBytes).toBe(200);
    expect(pagesTable([{ profile: "phone", route: "/residences", median: med }])).toContain("/residences");
  });
});
