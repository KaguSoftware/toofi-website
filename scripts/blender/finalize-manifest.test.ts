import { describe, expect, it } from "vitest";
import { BUDGETS, INITIAL_MODEL_BUDGET, OPTIONAL_BUDGETS, VISIBLE_TRIANGLE_BUDGET, buildManifest } from "./finalize-manifest.mjs";

const report = (tier: "high" | "low") => ({
  blender: "5.3.0",
  villas: [{ name: "villa-00", position: [-152, 1.2, 11.15] }],
  palette: { plaster_cream: { key: "cream", palette: "#ecdfc7", mean: "#ecdfc7" } },
  triangles: { site: tier === "high" ? 21000 : 17000 },
  aoSize: tier === "high" ? 1024 : 512,
  lamps: 52,
});

describe("finalize-manifest", () => {
  it("combines both tier reports with the file sizes", () => {
    const m = buildManifest({ high: report("high"), low: report("low") }, (f: string) => (f === "compound-high.glb" ? 3_000_000 : f === "compound-low.glb" ? 1_000_000 : null));
    expect(m.files).toEqual({ "compound-high.glb": 3_000_000, "compound-low.glb": 1_000_000 });
    expect(m.budgets).toEqual(BUDGETS);
    expect(m.villas).toEqual(report("high").villas);
    expect(m.triangles).toEqual({ high: { site: 21000 }, low: { site: 17000 } });
    expect(m.aoSize).toEqual({ high: 1024, low: 512 });
  });

  it("refuses a model over its budget", () => {
    expect(() => buildManifest({ high: report("high"), low: report("low") }, (f: string) => (f === "compound-low.glb" ? 2_900_000 : 1))).toThrow(/compound-low\.glb 2\.90 MB > 2\.8 MB/);
  });

  it("checks the vegetation and life files only when they exist", () => {
    const reports = { high: report("high"), low: report("low") };
    const sizes: Record<string, number> = { "compound-high.glb": 4_000_000, "compound-low.glb": 1_500_000, "vegetation-high.glb": 1_200_000, "life-high.glb": 240_000 };
    const m = buildManifest(reports, (f: string) => sizes[f] ?? null);
    expect(m.files).toEqual(sizes);
    expect((m.budgets as Record<string, number>)["vegetation-high.glb"]).toBe(OPTIONAL_BUDGETS["vegetation-high.glb"]);
    expect(m.budgets).not.toHaveProperty("vegetation-low.glb");
    sizes["vegetation-high.glb"] = 1_700_000;
    expect(() => buildManifest(reports, (f: string) => sizes[f] ?? null)).toThrow(/vegetation-high\.glb 1\.70 MB > 1\.6 MB/);
  });

  it("refuses a tier whose models together exceed the initial-load budget", () => {
    // Every file is within its own budget; together the high tier is 8.6 MB > 8.5 MB.
    const sizes: Record<string, number> = { "compound-high.glb": 7_000_000, "compound-low.glb": 1_000_000, "vegetation-high.glb": 1_500_000, "life-high.glb": 0 };
    expect(() => buildManifest({ high: report("high"), low: report("low") }, (f: string) => sizes[f] ?? null)).not.toThrow();
    sizes["vegetation-high.glb"] = 1_600_000;
    expect(() => buildManifest({ high: report("high"), low: report("low") }, (f: string) => sizes[f] ?? null)).toThrow(/initial-load budget: high models 8\.60 MB > 8\.5 MB/);
  });

  it("keeps the budgets consistent with the page targets", () => {
    const highMax = Object.entries({ ...BUDGETS, ...OPTIONAL_BUDGETS }).filter(([f]) => f.endsWith("-high.glb")).reduce((s, [, n]) => s + n, 0);
    const lowMax = Object.entries({ ...BUDGETS, ...OPTIONAL_BUDGETS }).filter(([f]) => f.endsWith("-low.glb")).reduce((s, [, n]) => s + n, 0);
    expect(highMax).toBeGreaterThan(INITIAL_MODEL_BUDGET.high); // the cap binds: not every file can be at its limit
    expect(lowMax).toBeLessThanOrEqual(INITIAL_MODEL_BUDGET.low);
    expect(INITIAL_MODEL_BUDGET.high).toBeLessThan(15_000_000);
    const { total, ...parts } = VISIBLE_TRIANGLE_BUDGET;
    expect(Object.values(parts).reduce((a, b) => a + b, 0)).toBe(total);
    expect(total).toBe(300_000);
  });
});
