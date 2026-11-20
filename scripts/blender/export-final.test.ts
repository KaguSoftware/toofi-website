import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMPOUND_FILES,
  LIGHTMAP_SEMANTIC,
  PAGE_LIMIT,
  PAGE_OVERHEAD_ESTIMATE,
  ZAITUN_BUDGETS,
  checkKtx2,
  checkModel,
  describeGlb,
  evaluateBudgets,
  lightmapFiles,
  lightmapSets,
  readGlbJson,
  readKtx2Header,
  updateManifest,
} from "./export-final.mjs";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const MODELS = here("../../public/sawad/models/");
const LIGHTMAPS = here("../../public/sawad/lightmaps/zaitun/");

/** A GLB container around a JSON chunk (no binary chunk: the checks never read buffers). */
function glb(json: object): Buffer {
  const body = Buffer.from(JSON.stringify(json));
  const padded = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, padded]);
}

/** A KTX2 header with a one-block DFD, enough for readKtx2Header. */
function ktx2({ width = 8, height = 8, levels = 4, transfer = 2, supercompression = 1 } = {}): Buffer {
  const buffer = Buffer.alloc(120);
  Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32LE(width, 20);
  buffer.writeUInt32LE(height, 24);
  buffer.writeUInt32LE(levels, 40);
  buffer.writeUInt32LE(supercompression, 44);
  buffer.writeUInt32LE(80, 48); // dfdByteOffset
  buffer[80 + 12] = 163; // colour model: ETC1S
  buffer[80 + 14] = transfer;
  return buffer;
}

const EXTENSIONS = ["EXT_mesh_gpu_instancing", "EXT_meshopt_compression", "KHR_mesh_quantization", "KHR_texture_basisu"];

/**
 * A small model shaped like the shipped one: an instanced villa and a unique mosque on the buildings
 * page, `site` and `garden` on the site page, and a lamp and bench that keep real-time light.
 */
function sampleJson() {
  const uv = ["POSITION", "NORMAL", "TEXCOORD_0", "TEXCOORD_1", "TEXCOORD_2"];
  const attr = (names: string[]) => Object.fromEntries(names.map((n, i) => [n, i]));
  return {
    extensionsUsed: EXTENSIONS,
    extensionsRequired: ["EXT_meshopt_compression", "KHR_texture_basisu"],
    accessors: [{ count: 3 }, { count: 3 }, { count: 3 }, { count: 3 }, { count: 3 }, { count: 3 }],
    materials: [
      { name: "villa-atlas", occlusionTexture: { index: 0, texCoord: 1 } },
      { name: "mosque-atlas", occlusionTexture: { index: 1, texCoord: 1 } },
      { name: "site-atlas", occlusionTexture: { index: 2, texCoord: 1 } },
      { name: "garden-atlas", occlusionTexture: { index: 3, texCoord: 1 } },
      { name: "bench-atlas" },
      { name: "bronze" },
    ],
    meshes: [
      { name: "villa", primitives: [{ attributes: attr(uv), material: 0 }] },
      { name: "mosque", primitives: [{ attributes: attr(uv), material: 1 }] },
      { name: "site", primitives: [{ attributes: attr(uv), material: 2 }] },
      { name: "garden", primitives: [{ attributes: attr(uv), material: 3 }] },
      { name: "bench", primitives: [{ attributes: attr(["POSITION", "NORMAL", "TEXCOORD_0", "TEXCOORD_1"]), material: 4 }] },
      { name: "lamp", primitives: [{ attributes: attr(["POSITION", "NORMAL", "TEXCOORD_0", "TEXCOORD_1"]), material: 5 }] },
    ],
    nodes: [
      { mesh: 0, extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 0 } } } }, // 3 villas
      { mesh: 1 },
      { mesh: 2 },
      { mesh: 3 },
      { mesh: 4 },
      { mesh: 5 },
    ],
  };
}
const lightmapsFor = (buildings: number) => ({
  instances: {
    ...Object.fromEntries(Array.from({ length: buildings }, (_, i) => [`b${i}`, { page: "buildings" }])),
    site: { page: "site" },
    garden: { page: "site" },
  },
});
const describeSample = (edit?: (json: ReturnType<typeof sampleJson>) => void) => {
  const json = sampleJson();
  edit?.(json);
  return describeGlb(json);
};

describe("readGlbJson and describeGlb", () => {
  it("reads the JSON chunk of a GLB", () => {
    expect(readGlbJson(glb({ asset: { version: "2.0" } }))).toEqual({ asset: { version: "2.0" } });
  });

  it("rejects data that is not a GLB", () => {
    expect(() => readGlbJson(Buffer.alloc(32))).toThrow(/not a GLB/);
  });

  it("counts instanced nodes by their accessor and plain nodes as one", () => {
    const d = describeSample();
    expect(d.instances).toEqual({ villa: 3, mosque: 1, site: 1, garden: 1, bench: 1, lamp: 1 });
    expect(d.materials[0]).toEqual({ name: "villa-atlas", occlusionTexCoord: 1 });
    expect(d.materials[4]).toEqual({ name: "bench-atlas", occlusionTexCoord: null });
    expect(d.meshes.find((m: { name: string }) => m.name === "villa")?.primitives[0].attributes).toContain("TEXCOORD_2");
  });
});

describe("checkModel", () => {
  it("accepts a model that follows the lightmap contract", () => {
    expect(checkModel(describeSample(), { lightmaps: lightmapsFor(4) })).toEqual([]); // 3 villas + the mosque
  });

  it("names the lightmap UVs TEXCOORD_2, the third set", () => {
    expect(LIGHTMAP_SEMANTIC).toBe("TEXCOORD_2");
  });

  it("flags a codec the loaders are not wired for, and a codec that is not used", () => {
    const required = describeSample((j) => (j.extensionsRequired = [...j.extensionsRequired, "KHR_draco_mesh_compression"]));
    expect(checkModel(required, {})).toEqual(["requires KHR_draco_mesh_compression, which the loaders do not wire"]);
    const unused = describeSample((j) => (j.extensionsUsed = j.extensionsUsed.filter((e) => e !== "KHR_texture_basisu")));
    expect(checkModel(unused, {})).toEqual(["KHR_texture_basisu is not used"]);
  });

  it("flags an atlas primitive that lost its lightmap UVs", () => {
    const d = describeSample((j) => delete (j.meshes[0].primitives[0].attributes as Record<string, number>).TEXCOORD_2);
    expect(checkModel(d, {})).toContain("villa has an atlas primitive without TEXCOORD_2 (the lightmap UVs)");
  });

  it("flags a gap in the TEXCOORD sets, which the glTF validator rejects", () => {
    const d = describeSample((j) => delete (j.meshes[1].primitives[0].attributes as Record<string, number>).TEXCOORD_1);
    expect(checkModel(d, {})).toContain("mosque has a gap in its TEXCOORD sets");
  });

  it("flags lamps and benches that carry lightmap UVs", () => {
    const d = describeSample((j) => {
      (j.meshes[5].primitives[0].attributes as Record<string, number>).TEXCOORD_2 = 9;
    });
    expect(checkModel(d, {})).toContain("lamp must not carry lightmap UVs (it keeps real-time light)");
  });

  it("flags an AO map read from the trim sheet's UV set", () => {
    const d = describeSample((j) => ((j.materials[1].occlusionTexture as { texCoord: number }).texCoord = 0));
    expect(checkModel(d, {})).toContain("mosque-atlas samples its AO map from TEXCOORD_0, not the AO UV set");
  });

  it("flags meshes joined together, which would leave fewer lit copies than lightmap tiles", () => {
    const joined = describeSample((j) => j.nodes.splice(1, 1)); // the mosque node is gone
    expect(checkModel(joined, { lightmaps: lightmapsFor(4) })).toContain("3 lit building copies in the model, 4 tiles in lightmaps.json");
  });

  it("flags a missing site or garden mesh", () => {
    const d = describeSample((j) => delete (j.meshes[3].primitives[0].attributes as Record<string, number>).TEXCOORD_2);
    expect(checkModel(d, { lightmaps: lightmapsFor(4) })).toContain("garden is missing or has no lightmap UVs");
  });
});

describe("KTX2 lightmap pages", () => {
  it("reads size, mip count, supercompression and transfer function from the header", () => {
    expect(readKtx2Header(ktx2({ width: 2048, height: 1024, levels: 12 }))).toEqual({
      width: 2048,
      height: 1024,
      levelCount: 12,
      supercompression: 1,
      colorModel: 163,
      transfer: 2,
    });
  });

  it("rejects data that is not a KTX2 file", () => {
    expect(() => readKtx2Header(Buffer.alloc(120))).toThrow(/not a KTX2 file/);
  });

  it("accepts an sRGB, mipmapped page of the size lightmaps.json lists", () => {
    expect(checkKtx2(readKtx2Header(ktx2({ width: 8, height: 8 })), "p.ktx2", [8, 8])).toEqual([]);
  });

  it("flags a wrong size, a linear transfer function and a missing mip chain", () => {
    const problems = checkKtx2(readKtx2Header(ktx2({ width: 4, height: 8, levels: 1, transfer: 1 })), "p.ktx2", [8, 8]);
    expect(problems).toEqual(["p.ktx2 is 4x8, lightmaps.json says 8x8", "p.ktx2 is not sRGB-encoded", "p.ktx2 has no mip chain"]);
  });
});

const lightmapsJson = {
  tiers: {
    high: { pages: { buildings: { size: [8, 8], files: { day: "day-buildings-high.png", dusk: "dusk-buildings-high.png" } }, site: { size: [4, 4], files: { day: "day-site-high.png", dusk: "dusk-site-high.png" } } } },
    low: { pages: { buildings: { size: [4, 4], files: { day: "day-buildings-low.png", dusk: "dusk-buildings-low.png" } } } },
  },
};

describe("lightmapSets and lightmapFiles", () => {
  const sizes: Record<string, number> = { "day-buildings-high.ktx2": 500_000, "dusk-buildings-high.ktx2": 520_000, "day-site-high.ktx2": 100_000, "dusk-site-high.ktx2": 90_000 };

  it("sums each state's pages, reading the KTX2 file next to each PNG name", () => {
    expect(lightmapSets(lightmapsJson, "high", (f: string) => sizes[f] ?? null)).toEqual({ day: 600_000, dusk: 610_000 });
  });

  it("counts a missing file as infinitely large so it can never pass a budget", () => {
    expect(lightmapSets(lightmapsJson, "low", () => null)).toEqual({ day: Infinity, dusk: Infinity });
  });

  it("lists every page's KTX2 file per tier for the web scene", () => {
    const files = lightmapFiles(lightmapsJson, (f: string) => sizes[f] ?? null);
    expect(files.high.site).toEqual({ size: [4, 4], files: { day: { file: "day-site-high.ktx2", bytes: 100_000 }, dusk: { file: "dusk-site-high.ktx2", bytes: 90_000 } } });
    expect(Object.keys(files.low)).toEqual(["buildings"]);
  });
});

describe("evaluateBudgets", () => {
  const within = {
    sizes: { "compound-zaitun-high.glb": 10_260_000, "compound-zaitun-low.glb": 4_970_000, "vegetation-high.glb": 1_230_000, "vegetation-low.glb": 410_000, "life-high.glb": 240_000, "life-low.glb": 220_000 } as Record<string, number | null>,
    sets: { high: { day: 940_000, dusk: 910_000 }, low: { day: 310_000, dusk: 290_000 } },
  };

  it("passes the measured export", () => {
    const { rows, problems } = evaluateBudgets(within);
    expect(problems).toEqual([]);
    expect(rows.every((r: { ok: boolean }) => r.ok)).toBe(true);
  });

  it("keeps the whole-page estimate under the 15 MB initial-load limit with room to spare", () => {
    const high = 10_260_000 + 1_230_000 + 240_000 + PAGE_OVERHEAD_ESTIMATE;
    expect(high).toBeLessThan(PAGE_LIMIT);
    expect(PAGE_LIMIT).toBe(15_000_000);
  });

  it("refuses a compound file over its cap", () => {
    const { problems } = evaluateBudgets({ ...within, sizes: { ...within.sizes, "compound-zaitun-low.glb": 5_300_000 } });
    expect(problems).toContain("compound-zaitun-low.glb: 5.30 MB > 5.20 MB");
  });

  it("refuses a tier whose models together exceed the initial-load cap, though each file is within its own", () => {
    const { problems } = evaluateBudgets({ ...within, sizes: { ...within.sizes, "compound-zaitun-high.glb": 10_500_000, "vegetation-high.glb": 1_600_000 } });
    expect(problems).toEqual(["high models together (initial load): 12.34 MB > 12.00 MB"]);
  });

  it("refuses a lightmap set over its budget and a missing compound file", () => {
    const { problems } = evaluateBudgets({ ...within, sets: { ...within.sets, high: { day: 2_100_000, dusk: 910_000 } } });
    expect(problems).toEqual(["high day lightmap set (KTX2, after the first frame): 2.10 MB > 2.00 MB"]);
    const missing = evaluateBudgets({ ...within, sizes: { ...within.sizes, "compound-zaitun-high.glb": null } });
    expect(missing.problems).toContain("compound-zaitun-high.glb: missing > 10.50 MB");
  });

  it("checks the vegetation and life files only when they exist", () => {
    const { rows } = evaluateBudgets({ ...within, sizes: { "compound-zaitun-high.glb": 1, "compound-zaitun-low.glb": 1 } });
    expect(rows.map((r: { label: string }) => r.label).some((l: string) => l.startsWith("vegetation"))).toBe(false);
  });
});

describe("updateManifest", () => {
  it("rewrites files and budgets and leaves the rest of the manifest alone", () => {
    const manifest = { plan: "zaitun", villas: [1, 2], files: { old: 1 }, budgets: { old: 1 } };
    const sizes = { "compound-zaitun-high.glb": 10_260_000, "compound-zaitun-low.glb": 4_970_000 };
    expect(updateManifest(manifest, sizes)).toEqual({
      plan: "zaitun",
      villas: [1, 2],
      files: sizes,
      budgets: { "compound-zaitun-high.glb": ZAITUN_BUDGETS.compound.high, "compound-zaitun-low.glb": ZAITUN_BUDGETS.compound.low },
    });
  });
});

describe("the shipped Zaitun export", () => {
  const lightmaps = JSON.parse(readFileSync(LIGHTMAPS + "lightmaps.json", "utf8"));
  const sizeIn = (dir: string) => (f: string) => (existsSync(dir + f) ? statSync(dir + f).size : null);

  it.each(["high", "low"] as const)("the %s model honours the lightmap contract", (tier) => {
    const description = describeGlb(readGlbJson(readFileSync(MODELS + COMPOUND_FILES[tier])));
    expect(checkModel(description, { lightmaps: lightmaps.tiers[tier] })).toEqual([]);
  });

  it.each(["high", "low"] as const)("every %s lightmap page is a KTX2 file of the listed size, sRGB with mips", (tier) => {
    const pages = lightmaps.tiers[tier].pages as Record<string, { size: [number, number]; files: Record<string, string> }>;
    for (const [page, info] of Object.entries(pages)) {
      for (const png of Object.values(info.files)) {
        const file = png.replace(/\.png$/, ".ktx2");
        expect(checkKtx2(readKtx2Header(readFileSync(LIGHTMAPS + file)), `${tier} ${page} ${file}`, info.size)).toEqual([]);
      }
    }
  });

  it("is within every budget", () => {
    const sizes = Object.fromEntries([...Object.values(COMPOUND_FILES), ...Object.keys(ZAITUN_BUDGETS.optional)].map((f) => [f, sizeIn(MODELS)(f as string)]));
    const sets = Object.fromEntries((["high", "low"] as const).map((tier) => [tier, lightmapSets(lightmaps, tier, sizeIn(LIGHTMAPS))]));
    expect(evaluateBudgets({ sizes, sets }).problems).toEqual([]);
  });

  it("has a report that passed and a manifest that matches the files on disk", () => {
    const report = JSON.parse(readFileSync(MODELS + "zaitun-export.json", "utf8"));
    expect(report.passed).toBe(true);
    expect(report.lightmapUv).toEqual({ gltf: "TEXCOORD_2", channel: 2 });
    const manifest = JSON.parse(readFileSync(MODELS + "compound-zaitun.manifest.json", "utf8"));
    for (const file of Object.values(COMPOUND_FILES)) expect(manifest.files[file]).toBe(statSync(MODELS + file).size);
    expect(manifest.budgets).toEqual({ "compound-zaitun-high.glb": ZAITUN_BUDGETS.compound.high, "compound-zaitun-low.glb": ZAITUN_BUDGETS.compound.low });
  });
});
