import { describe, expect, it } from "vitest";
import { NETWORK_PRESETS, SCENARIOS, bufferPixels, fpsBetween, levelRuns, parseViewport, pixelsTable } from "./live.mjs";

describe("levelRuns", () => {
  it("collapses ticks into runs of equal level and skips unknown levels", () => {
    const samples = [
      { t: 0.5, level: 2 },
      { t: 1, level: 2 },
      { t: 1.5, level: null },
      { t: 2, level: 3 },
      { t: 2.5, level: 2 },
    ];
    expect(levelRuns(samples)).toEqual([
      { level: 2, from: 0.5, to: 1 },
      { level: 3, from: 2, to: 2 },
      { level: 2, from: 2.5, to: 2.5 },
    ]);
  });
});

describe("fpsBetween", () => {
  it("averages the ticks inside the window", () => {
    const samples = [
      { t: 1, fps: 60 },
      { t: 2, fps: 30 },
      { t: 3, fps: 10 },
    ];
    expect(fpsBetween(samples, 1, 3)).toBe(45);
    expect(Number.isNaN(fpsBetween(samples, 10, 20))).toBe(true);
  });
});

describe("viewports", () => {
  it("parses size and ratio, and rejects anything else", () => {
    expect(parseViewport("2560x1440@1")).toEqual({ width: 2560, height: 1440, dpr: 1 });
    expect(() => parseViewport("2560x1440")).toThrow();
  });

  it("counts the drawing buffer the way quality.ts sizes it", () => {
    // A 4K monitor at 100% draws every pixel; a 2x laptop is held at the level's ratio.
    expect(bufferPixels({ width: 3840, height: 2160, dpr: 1 }, 1.5)).toBe(3840 * 2160);
    expect(bufferPixels({ width: 1440, height: 900, dpr: 2 }, 1.5)).toBe(2160 * 1350);
  });

  it("tabulates rows", () => {
    expect(pixelsTable([{ viewport: "a", level: 2, buffer: "1x1", megapixels: 1, fps: 60, gpuMs: 7 }])).toContain("| a | 2 | 1x1 |");
  });
});

describe("scenarios and presets", () => {
  it("start at their own first tick and stay inside the run", () => {
    for (const s of Object.values(SCENARIOS) as { schedule: { at: number }[]; seconds: number }[]) {
      expect(s.schedule[0].at).toBe(0);
      expect(s.schedule.at(-1)?.at).toBeLessThan(s.seconds);
    }
  });

  it("gives every network preset a throughput and a latency", () => {
    for (const p of Object.values(NETWORK_PRESETS) as { downloadThroughput: number; latency: number }[]) {
      expect(p.downloadThroughput).toBeGreaterThan(0);
      expect(p.latency).toBeGreaterThan(0);
    }
  });
});
