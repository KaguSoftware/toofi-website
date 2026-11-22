import { describe, expect, it } from "vitest";
import { families, knockoutPivot, levelsTable, lookTable, memoryTable, overdrawMaterials, overdrawTable, passFloor, passList, passTable, startupTable } from "./report.mjs";

const passes = [
  { label: "00 scene@2520x1456:f16", ms: 8.3, perFrame: 1 },
  { label: "00+ shadow", ms: 3.3, perFrame: 1 },
  { label: "01 scene+1@2520x1456:f16", ms: 1.3, perFrame: 1 },
  { label: "02 LuminanceMaterial@2520x1456:f16", ms: 1.3, perFrame: 1 },
  { label: "03 DownsamplingMaterial@10x6:f16", ms: 0.3, perFrame: 1 },
  { label: "04 EffectMaterial@screen", ms: 1.8, perFrame: 1 },
  { label: "05 CopyMaterial@screen", ms: 0.02, perFrame: 0.1 },
];
const run = { tier: "high", level: 3, shot: "stop-1", passes };

describe("S4 report: passes", () => {
  it("takes the read-back floor (the smallest pass) off every pass", () => {
    expect(passFloor(passes)).toBeCloseTo(0.3);
    const f = families(run);
    expect(f.floor).toBeCloseTo(0.3);
    expect(f.families.map((x) => x.family)).toEqual(["scene", "shadow map", "effects (merged)", "ambient occlusion", "bloom", "final copy"]);
    expect(f.families[0].ms).toBeCloseTo(8);
    expect(f.families.find((x) => x.family === "bloom")!.ms).toBeCloseTo(1);
    expect(f.total).toBeCloseTo(14.5);
  });

  it("prints families per camera and the pass list in draw order", () => {
    const table = passTable([run]);
    expect(table.split("\n")[0]).toBe("| Tier | Camera | All passes (ms) | scene | shadow map | ambient occlusion | bloom | effects (merged) | final copy |");
    expect(table).toContain("| high L3 | stop-1 | 14.5 | 8.0 (55%) | 3.0 (21%) | 1.0 (7%) | 1.0 (7%) | 1.5 (10%) | 0.0 (0%) |");
    const list = passList(run).split("\n");
    expect(list[2]).toBe("| 00 | scene@2520x1456:f16 | scene | 8.00 |");
    expect(list[3]).toBe("| 00+ | shadow | shadow map | 3.00 |");
    // A pass drawn in one frame out of ten is left out of the list.
    expect(list.join("\n")).not.toContain("CopyMaterial@screen");
  });
});

describe("S4 report: knock-outs, levels, overdraw", () => {
  it("pivots variants against cameras and marks what is within noise", () => {
    const rows = [
      { tier: "high", shot: "stop-1", variant: "base", ms: 17.4, noise: 0.2 },
      { tier: "high", shot: "stop-3", variant: "base", ms: 12.1, noise: 0.1 },
      { tier: "high", shot: "stop-1", variant: "shadow-off", ms: 14.3, saved: 3.1, share: 0.178, sure: true },
      { tier: "high", shot: "stop-3", variant: "shadow-off", ms: 12.0, saved: 0.1, share: 0.008, sure: false },
      { tier: "low", shot: "stop-1", variant: "base", ms: 3 },
    ];
    const lines = knockoutPivot(rows, { tier: "high" }).split("\n");
    expect(lines[0]).toBe("| Change | What it is | stop-1 | stop-3 |");
    expect(lines[2]).toBe("| base | The shipped scene | **17.4 ms** (±0.2) | **12.1 ms** (±0.1) |");
    expect(lines[3]).toBe("| shadow-off | No sun shadow at all (no shadow pass, no shadow lookups) | 3.1 (18%) | ~0.1 |");
    expect(lines).toHaveLength(4);
  });

  it("shows each level and pixel ratio against the tier's best level", () => {
    const table = levelsTable([
      { tier: "high", shot: "stop-3", level: 3, dpr: 1.75, buffer: "2520x1456", megapixels: 3.67, passes: 43, ms: 14.68, difference: 0.03, lo: -0.1, hi: 0.1 },
      { tier: "high", shot: "stop-3", level: 1, dpr: 1.25, buffer: "1800x1040", megapixels: 1.87, passes: 20, ms: 6.2, difference: -8.48, lo: -8.6, hi: -8.4 },
    ]);
    expect(table).toContain("| high | stop-3 | 3 | 1.75 | 2520x1456 (3.67 MP) | 43 | 14.7 | +0.0 (-0.1 to 0.1) |");
    expect(table).toContain("| high | stop-3 | 1 | 1.25 | 1800x1040 (1.87 MP) | 20 | 6.2 | -8.5 (-8.6 to -8.4) |");
  });

  it("shows what the draw order wastes, in all and per material", () => {
    const row = {
      tier: "high",
      shot: "stop-3",
      order: "base",
      total: 4.16,
      opaqueShaded: 2.52,
      opaqueVisible: 1,
      transparentShaded: 1.64,
      materials: [
        { index: 1, name: "", objects: ["sky"], type: "ShaderMaterial", shaded: 1, visible: 0.21, transparent: false, alphaTest: 0 },
        { index: 52, name: "", objects: ["god-rays"], type: "ShaderMaterial", shaded: 1.64, visible: null, transparent: true, alphaTest: 0 },
        { index: 20, name: "veg-palm", objects: [], type: "MeshStandardMaterial", shaded: 0.1, visible: 0.02, transparent: false, alphaTest: 0.5 },
        { index: 30, name: "tiny", objects: [], type: "MeshStandardMaterial", shaded: 0.001, visible: 0.001, transparent: false, alphaTest: 0 },
      ],
    };
    expect(overdrawTable([row])).toContain("| high | stop-3 | shipped | 4.16 | 2.52 | 1.00 | 1.52 | 1.64 |");
    const lines = overdrawMaterials(row).split("\n");
    expect(lines[2]).toBe("| god-rays (blended) | #52 | 1.64 | – | – |");
    expect(lines[3]).toBe("| sky | #1 | 1.00 | 0.21 | 0.79 |");
    expect(lines[4]).toBe("| veg-palm (cut-out) | #20 | 0.10 | 0.02 | 0.08 |");
    expect(lines).toHaveLength(5);
  });
});

describe("S4 report: first frame, look, memory", () => {
  it("takes the median first frame over fresh browsers", () => {
    const frame = (ms: number, program: number) => ({ frame: 0, started: false, ms, jsMs: ms - 4, kinds: { program: { n: 100, ms: program }, texture: { n: 10, ms: 3 }, buffer: { n: 10, ms: 4 } }, programs: 45, textures: 59, geometries: 114, passes: [], calls: {} });
    const next = { frame: 1, started: true, ms: 20, jsMs: 9, kinds: {}, programs: 2 };
    const rows = [280, 300, 293].map((ms, rep) => ({ tier: "high", rep, frames: [frame(ms, ms - 67), next] }));
    expect(startupTable(rows).split("\n")[2]).toBe("| high | 3 | 293 ms | 226 ms | 45 | 3 ms | 4 ms | 20 ms |");
  });

  it("judges a candidate by its worst camera", () => {
    const rows = [
      { tier: "high", variant: "base", against: "reference", shot: "stop-1", mean: 0.7, worst: 16, changedShare: 0 },
      { tier: "high", variant: "base", against: "base", shot: "stop-1", mean: 0, worst: 0, changedShare: 0 },
      { tier: "high", variant: "shadow-2048", against: "base", shot: "stop-1", mean: 1.37, worst: 105, changedShare: 0.0107 },
      { tier: "high", variant: "shadow-2048", against: "base", shot: "stop-3", mean: 2.4, worst: 90, changedShare: 0.02, grainFree: 1.9, grainFreeWorst: 60, grainFreeChanged: 0.01 },
    ];
    const lines = lookTable(rows).split("\n");
    expect(lines[2]).toBe("| high | none (captured twice) | 1 | 0.00/255 (stop-1) | – | 0 | 0.00% | passes |");
    expect(lines[3]).toBe("| high | shadow-2048 | 2 | 2.40/255 (stop-3) | 1.90/255 (stop-3) | 105 | 1.07% | fails |");
  });

  it("splits texture memory into the shadow map, render targets and the model's textures", () => {
    const MB = 2 ** 20;
    const table = memoryTable({
      "high-L3": {
        describe: { renderer: { buffer: "2520x1456" } },
        memory: {
          total: 400 * MB,
          groups: [
            { key: "texture RGBA16F 2520x1456", format: "RGBA16F", w: 2520, h: 1456, count: 8, bytes: 224 * MB, compressed: false },
            { key: "texture RGBA8 4096x4096", format: "RGBA8", w: 4096, h: 4096, count: 1, bytes: 64 * MB, compressed: false },
            { key: "texture DEPTH24 4096x4096", format: "DEPTH24", w: 4096, h: 4096, count: 1, bytes: 64 * MB, compressed: false },
            { key: "texture RGBA16F 1260x728", format: "RGBA16F", w: 1260, h: 728, count: 5, bytes: 35 * MB, compressed: false },
            { key: "texture ETC2_SRGBA 2048x2048 mips", format: "ETC2_SRGBA", w: 2048, h: 2048, count: 2, bytes: 11 * MB, compressed: true },
          ],
        },
      },
    });
    expect(table.split("\n")[2]).toBe("| high-L3 | 2520x1456 | 400 MB | 128 MB | 224 MB in 8 | 35 MB | 11 MB |");
  });
});
