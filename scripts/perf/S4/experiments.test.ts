import { describe, expect, it } from "vitest";
import { BEST_LEVEL, DPR_AT, blockAverage, KNOCKOUT_SHOTS, LEVEL_DPR, MUTATE_AT, REPEAT, SETTLE, TICKS, VARIANTS, familyTable, fmt, pairStats, passFamily, pct, quantile, s4Config, splitWindows, summarizeSync } from "./experiments.mjs";
import { SHOTS } from "../shots.mjs";

describe("S4 experiments", () => {
  it("makes one change per variant, after the level and pixel ratio have settled", () => {
    expect(VARIANTS.base.mutations).toEqual([]);
    for (const [id, v] of Object.entries(VARIANTS)) {
      expect(v.note, id).toBeTruthy();
      expect(["same", "close", "breaks"], id).toContain(v.look);
      expect(v.tiers.length, id).toBeGreaterThan(0);
      for (const m of v.mutations) expect(m.frame, id).toBe(MUTATE_AT);
      for (const m of s4Config(id, { at: 300 }).mutations) expect(m.frame, id).toBeGreaterThanOrEqual(300);
    }
    expect(DPR_AT).toBeLessThan(MUTATE_AT);
  });

  it("only knocks out shadows, occlusion and depth of field where they exist (the high tier)", () => {
    for (const id of ["shadow-off", "shadow-frozen", "shadow-2048", "shadow-one-lookup", "no-ao", "level-2-chain", "no-dof"]) expect(VARIANTS[id].tiers).toEqual(["high"]);
    expect(VARIANTS["no-bloom"].tiers).toContain("low");
  });

  it("runs the knock-outs at cameras the rig knows, after the change is in", () => {
    for (const shot of KNOCKOUT_SHOTS) {
      const known = (SHOTS as Record<string, { record: number[] }>)[shot];
      expect(known, shot).toBeDefined();
      expect(known.record[0], shot).toBeGreaterThan(MUTATE_AT);
    }
  });

  it("builds the probe configuration: the change on the frame asked for, the pixel ratio before it", () => {
    expect(s4Config("base")).toEqual({ sync: true, mutations: [] });
    const cfg = s4Config("shadow-off", { dpr: 1.5 });
    expect(cfg.mutations.map((m) => m.do)).toEqual(["dpr", "shadow"]);
    expect(cfg.mutations[0]).toEqual({ frame: DPR_AT, do: "dpr", value: 1.5 });
    expect(s4Config("shadow-off", { at: 300, repeat: 6 })).toEqual({ sync: true, repeat: 6, mutations: [{ frame: 300, do: "shadow", cast: false }] });
    expect(s4Config("base", { sync: false, extra: { memory: true } })).toEqual({ sync: false, mutations: [], memory: true });
    // A step marked `after` lands that many frames later (the pixel ratio after a level change).
    expect(s4Config("level-2-chain", { at: 12 }).mutations).toEqual([
      { frame: 12, do: "pinLevel", level: 2, step: 2 },
      { frame: 16, do: "dpr", value: 1.75 },
    ]);
    expect(() => s4Config("nope")).toThrow(/unknown variant/);
  });

  it("times several frames per tick, with time for a change to settle", () => {
    expect(REPEAT).toBeGreaterThan(1);
    expect(TICKS).toBeGreaterThan(SETTLE);
  });

  it("matches the pixel ratios of quality.ts", () => {
    expect(LEVEL_DPR).toEqual({ 0: 1, 1: 1.25, 2: 1.5, 3: 1.75 });
    expect(BEST_LEVEL).toEqual({ high: 3, low: 1 });
  });

  it("skips only its own family's passes", () => {
    const chain = ["scene@2520x1456:f16", "ShaderMaterial#570@2520x1456:f16", "scene+1@2520x1456:f16", "ShaderMaterial#6413@1260x728:f32", "EdgeDetectionMaterial@2520x1456:u8", "SMAAWeightsMaterial@2520x1456:u8", "CircleOfConfusionMaterial@2520x1456:u8", "KawaseBlurMaterial@1260x728:u8", "CopyMaterial@1260x728:u8", "MaskMaterial@2520x1456:f16", "BokehMaterial@1260x728:f16", "LuminanceMaterial@2520x1456:f16", "DownsamplingMaterial@1260x728:f16", "UpsamplingMaterial@1260x728:f16", "EffectMaterial@2520x1456:f16", "CopyMaterial@screen"];
    const skipped = (id: string) => chain.filter((l) => new RegExp(String(VARIANTS[id].mutations[0].match)).test(l));
    expect(skipped("no-ao")).toEqual(["ShaderMaterial#570@2520x1456:f16", "scene+1@2520x1456:f16", "ShaderMaterial#6413@1260x728:f32"]);
    expect(skipped("no-ao-rerenders")).toEqual(["scene+1@2520x1456:f16"]);
    expect(skipped("no-smaa")).toEqual(["EdgeDetectionMaterial@2520x1456:u8", "SMAAWeightsMaterial@2520x1456:u8"]);
    expect(skipped("no-dof")).toEqual(["CircleOfConfusionMaterial@2520x1456:u8", "KawaseBlurMaterial@1260x728:u8", "CopyMaterial@1260x728:u8", "MaskMaterial@2520x1456:f16", "BokehMaterial@1260x728:f16"]);
    expect(skipped("no-bloom")).toEqual(["LuminanceMaterial@2520x1456:f16", "DownsamplingMaterial@1260x728:f16", "UpsamplingMaterial@1260x728:f16"]);
  });
});

describe("S4 statistics", () => {
  it("interpolates quantiles and ignores gaps", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([4, NaN, 1, 3, 2], 0)).toBe(1);
    expect(quantile([5], 0.9)).toBe(5);
    expect(quantile([], 0.5)).toBeNaN();
  });

  it("reduces a run to its median frame, spread and JavaScript time", () => {
    const frames = [8, 9, 10, 11, 30].map((ms, i) => ({ frame: i, ms, jsMs: 2 }));
    const s = summarizeSync(frames);
    expect(s).toMatchObject({ frames: 5, ms: 10, max: 30, jsMs: 2 });
    expect(s.p10).toBeCloseTo(8.4);
    expect(s.p90).toBeCloseTo(22.4);
  });

  it("splits a paired run into the window before the change and the one after it settled", () => {
    const frames = Array.from({ length: 30 }, (_, i) => ({ frame: 100 + i, ms: i < 12 ? 10 : 7 }));
    const { a, b } = splitWindows(frames, { from: 100, change: 110, resume: 120 });
    expect(a.map((f) => f.frame)).toEqual([102, 103, 104, 105, 106, 107, 108, 109]);
    expect(b[0].frame).toBe(122);
    expect(b.at(-1)!.frame).toBe(129);
  });

  it("reads a saving from pairs, and calls it sure only when every pair agrees and it beats the noise", () => {
    const sure = pairStats([{ a: 14.4, b: 11.2 }, { a: 16.8, b: 13.7 }], 0.2);
    expect(sure).toMatchObject({ pairs: 2, sure: true, noise: 0.2 });
    expect(sure.saved).toBeCloseTo(3.15);
    expect(sure.lo).toBeCloseTo(3.1);
    expect(sure.hi).toBeCloseTo(3.2);
    expect(sure.ms).toBeCloseTo(15.6);
    expect(sure.share).toBeCloseTo(3.15 / 15.6);
    // Pairs that disagree on the sign, or a saving inside the noise, are not sure.
    expect(pairStats([{ a: 10, b: 9.9 }, { a: 10, b: 10.2 }]).sure).toBe(false);
    expect(pairStats([{ a: 10, b: 9.9 }, { a: 10, b: 9.9 }], 0.3).sure).toBe(false);
    expect(pairStats([{ a: 10, b: 10.5 }, { a: 10, b: 10.6 }], 0.1)).toMatchObject({ sure: true });
  });

  it("formats numbers for the tables", () => {
    expect(fmt(1.234, 2)).toBe("1.23");
    expect(fmt(NaN)).toBe("–");
    expect(pct(0.256)).toBe("26%");
    expect(pct(NaN)).toBe("–");
  });
});

describe("S4 pass families", () => {
  it("names the family of a labelled pass", () => {
    expect(passFamily("00 scene@2520x1456:f16")).toBe("scene");
    expect(passFamily("00+ shadow")).toBe("shadow map");
    expect(passFamily("LuminanceMaterial@1260x728:f16")).toBe("bloom");
    expect(passFamily("12 DownsamplingMaterial@630x364:f16")).toBe("bloom");
    expect(passFamily("BokehMaterial@1260x728:f16")).toBe("depth of field");
    expect(passFamily("CircleOfConfusionMaterial@1260x728:f16")).toBe("depth of field");
    expect(passFamily("SMAAWeightsMaterial@2520x1456:u8")).toBe("SMAA");
    expect(passFamily("01 EdgeDetectionMaterial@2520x1456:u8")).toBe("SMAA");
    expect(passFamily("EffectMaterial@screen")).toBe("effects (merged)");
    expect(passFamily("KawaseBlurMaterial@1260x728:u8")).toBe("depth of field");
    expect(passFamily("19 CopyMaterial@1260x728:u8")).toBe("depth of field");
    expect(passFamily("42 CopyMaterial@screen")).toBe("final copy");
    expect(passFamily("ShaderMaterial#4810@1260x728:f16")).toBe("ambient occlusion");
    expect(passFamily("02 scene+1@2520x1456:f16")).toBe("ambient occlusion");
    expect(passFamily("FancyMaterial@10x10")).toBe("other");
  });

  it("sums passes into families per frame, largest first", () => {
    const table = familyTable(
      {
        "00 scene@100x50:f16": { n: 10, ms: 40 },
        "00+ shadow": { n: 10, ms: 20 },
        "02 LuminanceMaterial@50x25:f16": { n: 10, ms: 5 },
        "03 DownsamplingMaterial@25x12:f16": { n: 10, ms: 5 },
      },
      10,
    );
    expect(table.map((t) => t.family)).toEqual(["scene", "shadow map", "bloom"]);
    expect(table[0]).toMatchObject({ ms: 4, passes: 1, share: 4 / 7 });
    expect(table[2]).toMatchObject({ ms: 1, passes: 2, targets: ["50x25:f16", "25x12:f16"] });
  });
});

describe("S4 images", () => {
  it("averages blocks, so per-pixel grain cancels and a real change stays", () => {
    const width = 8;
    const height = 4;
    const flat = { width, height, data: new Uint8Array(width * height * 4).fill(100) };
    const grainy = { width, height, data: Uint8Array.from(flat.data, (v, i) => v + (i % 8 < 4 ? 8 : -8)) };
    const changed = { width, height, data: Uint8Array.from(flat.data, (v, i) => (Math.floor(i / 4) % width < 4 ? v + 40 : v)) };
    const a = blockAverage(flat, 4);
    expect(a).toMatchObject({ width: 2, height: 1 });
    expect(Array.from(blockAverage(grainy, 4).data)).toEqual(Array.from(a.data));
    expect(Array.from(blockAverage(changed, 4).data)).toEqual([140, 140, 140, 140, 100, 100, 100, 100]);
  });
});
