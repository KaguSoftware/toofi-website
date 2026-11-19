import { describe, expect, it } from "vitest";
import { BUDGETS, buildManifest } from "./finalize-manifest.mjs";

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
    const m = buildManifest({ high: report("high"), low: report("low") }, (f: string) => (f === "compound-high.glb" ? 3_000_000 : 1_000_000));
    expect(m.files).toEqual({ "compound-high.glb": 3_000_000, "compound-low.glb": 1_000_000 });
    expect(m.budgets).toEqual(BUDGETS);
    expect(m.villas).toEqual(report("high").villas);
    expect(m.triangles).toEqual({ high: { site: 21000 }, low: { site: 17000 } });
    expect(m.aoSize).toEqual({ high: 1024, low: 512 });
  });

  it("refuses a model over its budget", () => {
    expect(() => buildManifest({ high: report("high"), low: report("low") }, (f: string) => (f === "compound-low.glb" ? 2_100_000 : 1))).toThrow(/compound-low\.glb 2\.10 MB > 2 MB/);
  });
});
