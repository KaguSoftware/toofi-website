import { describe, expect, it } from "vitest";
import { LOOK_GATE, framesTable, levelFromPasses } from "./frames.mjs";

describe("frames", () => {
  it("gates the look at a mean difference of 2/255", () => {
    expect(LOOK_GATE).toBe(2);
  });

  it("shows the level the monitor settled on for adaptive runs", () => {
    const base = { tier: "high", shot: "stop-3", fps: 60, p99Ms: 16.8, maxMs: 17, overBudget: 0, frames: 181, cpuMs: { median: 2.3 }, gpuMs: { median: 13 }, calls: { median: 166 }, sceneTriangles: { median: 300000 }, shadowTriangles: 500000, triangles: { median: 842431 }, passes: 20, drawingBuffer: "1800x1040" };
    const t = framesTable([
      { ...base, level: "adaptive", passes: 43 },
      { ...base, level: 1, endLevel: 1 },
    ]);
    expect(t).toContain("| high | adaptive → 3 | stop-3 | 60 | 16.8 ms | 17.0 ms | 0/181 | 2.3 ms | 13.0 ms | 166 | 300,000 | 500,000 | 842,431 | 43 | 1800x1040 |");
    expect(t).toContain("| high | 1 | stop-3 |");
  });

  it("reads the level a run drew at from its passes per frame", () => {
    expect(levelFromPasses("high", 20)).toBe(1);
    expect(levelFromPasses("high", 31)).toBe(2);
    expect(levelFromPasses("high", 43)).toBe(3);
    expect(levelFromPasses("low", 18)).toBe(0);
    expect(levelFromPasses("low", 20)).toBe(1);
    expect(levelFromPasses("low", 25)).toBeNull();
  });
});
