import { describe, expect, it } from "vitest";
import { fpsBounds, pixelRatio, QUALITY, QUALITY_RANGE, REEL_QUALITY, startQuality, stepQuality, type QualityLevel } from "./quality";

describe("quality ranges", () => {
  it("start inside their own range", () => {
    expect(QUALITY_RANGE.low).toEqual({ min: 0, max: 1, start: 0 });
    expect(QUALITY_RANGE.high).toEqual({ min: 1, max: 3, start: 2 });
    expect(startQuality("low")).toBe(0);
    expect(startQuality("high")).toBe(2);
  });

  it("never give the low tier depth of field or ambient occlusion, and cap it at one pixel", () => {
    for (let l = QUALITY_RANGE.low.min; l <= QUALITY_RANGE.low.max; l++) {
      const q = QUALITY[l as QualityLevel];
      expect(q.dof).toBe(false);
      expect(q.ssao).toBe(false);
      expect(q.maxDpr).toBeLessThanOrEqual(1.25);
    }
    expect(QUALITY[0].maxDpr).toBe(1);
  });

  it("add features and resolution as the level rises", () => {
    for (let l = 1; l <= 3; l++) expect(QUALITY[l as QualityLevel].maxDpr).toBeGreaterThan(QUALITY[(l - 1) as QualityLevel].maxDpr);
    expect(QUALITY[3].ssao).toBe(true);
    expect(QUALITY[2].dof).toBe(true);
    for (const l of [0, 1, 2, 3] as const) {
      expect(QUALITY[l].grain).toBe(true);
      expect(QUALITY[l].vignette).toBe(true);
    }
  });
});

describe("the reel's quality", () => {
  it("is the top level's effects, supersampled, without grain", () => {
    expect(REEL_QUALITY).toEqual({ ...QUALITY[3], maxDpr: 2, grain: false });
    expect(REEL_QUALITY.maxDpr).toBeGreaterThan(QUALITY[3].maxDpr);
  });
});

describe("stepQuality", () => {
  it("moves one level and clamps to the tier's range", () => {
    expect(stepQuality(2, 1, "high")).toBe(3);
    expect(stepQuality(3, 1, "high")).toBe(3);
    expect(stepQuality(1, -1, "high")).toBe(1);
    expect(stepQuality(0, 1, "low")).toBe(1);
    expect(stepQuality(1, 1, "low")).toBe(1);
    expect(stepQuality(0, -1, "low")).toBe(0);
  });
});

describe("pixelRatio", () => {
  it("is the device ratio capped by the level", () => {
    expect(pixelRatio(0, 3)).toBe(1);
    expect(pixelRatio(3, 3)).toBe(1.75);
    expect(pixelRatio(3, 1.5)).toBe(1.5);
  });

  it("never drops below 1 and tolerates a missing ratio", () => {
    expect(pixelRatio(3, 0.5)).toBe(1);
    expect(pixelRatio(3, NaN)).toBe(1);
  });
});

describe("fpsBounds", () => {
  it("holds phones to a 30 fps floor whatever the refresh rate", () => {
    expect(fpsBounds("low", 60)).toEqual([30, 50]);
    expect(fpsBounds("low", 120)).toEqual([30, 50]);
  });

  it("holds desktops to their refresh rate", () => {
    expect(fpsBounds("high", 60)).toEqual([48, 57]);
    expect(fpsBounds("high", 90)).toEqual([48, 57]);
    expect(fpsBounds("high", 144)).toEqual([55, 85]);
  });
});
