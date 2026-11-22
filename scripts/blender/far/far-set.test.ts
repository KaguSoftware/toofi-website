import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FAR_BUDGET,
  FAR_SETTINGS,
  MODELS_DIR,
  REPORT_PATH,
  TIERS,
  anchor,
  boundsLock,
  bounds,
  brightestTexel,
  compact,
  compareStructure,
  dequantizer,
  farFile,
  fullFile,
  gather,
  localError,
  matrixScale,
  pricedAttributes,
  roundStored,
  settingsFor,
  toFloats,
} from "./far-set.mjs";

describe("reading quantized attributes", () => {
  it("turns KHR_mesh_quantization integers into their values", () => {
    expect(dequantizer(5122, true)(32767)).toBe(1);
    expect(dequantizer(5122, true)(-32768)).toBe(-1); // clamped, as glTF says
    expect(dequantizer(5123, true)(65535)).toBe(1);
    expect(dequantizer(5120, true)(-127)).toBe(-1);
    expect(dequantizer(5121, true)(255)).toBe(1);
    expect(dequantizer(5122, false)(7)).toBe(7);
    expect(dequantizer(5126, true)(0.25)).toBe(0.25);
  });

  it("reads the first components of padded elements", () => {
    // Positions stored as 4 shorts each (3 + padding), read as 3 floats.
    const stored = new Int16Array([32767, 0, -32767, 99, 0, 32767, 0, 99]);
    expect(Array.from(toFloats(stored, 4, 3, dequantizer(5122, true)))).toEqual([1, 0, -1, 0, 1, 0]);
  });
});

// A strip of four vertices along x, the third standing higher and farther out than the others.
const strip = new Float32Array([0, 0, 0, 1, 0, 0, 2, 3, 1, 4, 0, 0]);

describe("keeping the bounds", () => {
  it("locks the vertices that set the box and the sphere", () => {
    expect(Array.from(boundsLock(strip))).toEqual([1, 0, 1, 1]);
  });

  it("measures the box and sphere over every vertex, as three.js does", () => {
    const b = bounds(strip);
    expect(b.min).toEqual([0, 0, 0]);
    expect(b.max).toEqual([4, 3, 1]);
    expect(b.radius).toBeCloseTo(Math.hypot(2, 1.5, 0.5)); // centre (2, 1.5, 0.5) to a corner
  });

  it("gives a locked vertex the simplified mesh no longer uses a zero-area triangle", () => {
    const lock = new Uint8Array([1, 0, 1, 1]);
    expect(Array.from(anchor(new Uint32Array([0, 1, 2]), lock))).toEqual([0, 1, 2, 3, 3, 3]);
    const all = new Uint32Array([0, 1, 2, 2, 1, 3]);
    expect(anchor(all, lock)).toBe(all);
  });
});

describe("compacting a simplified mesh", () => {
  it("keeps the vertices in first-use order and remaps the indices", () => {
    const { order, indices } = compact(new Uint32Array([5, 2, 9, 9, 2, 7]));
    expect(Array.from(order)).toEqual([5, 2, 9, 7]);
    expect(Array.from(indices)).toEqual([0, 1, 2, 2, 1, 3]);
  });

  it("gathers elements into an array of the same type", () => {
    const uv = new Uint16Array([0, 1, 10, 11, 20, 21, 30, 31]);
    const out = gather(uv, 2, new Uint32Array([3, 0]));
    expect(out).toBeInstanceOf(Uint16Array);
    expect(Array.from(out)).toEqual([30, 31, 0, 1]);
  });
});

describe("units", () => {
  it("reads a node's scale and turns metres into the mesh's quantized units", () => {
    const m = new Array(16).fill(0);
    m[0] = 460;
    m[5] = 460;
    m[10] = 460;
    m[15] = 1;
    expect(matrixScale(m)).toBe(460);
    expect(localError(0.05, 460)).toBeCloseTo(0.05 / 460);
    expect(() => localError(0.05, 0)).toThrow("bad scale");
  });

  it("interleaves the priced attributes with their weights", () => {
    const parts = { TEXCOORD_0: new Float32Array([0.1, 0.2, 0.3, 0.4]), NORMAL: new Float32Array([0, 1, 0, 1, 0, 0]) };
    const p = pricedAttributes(parts, { TEXCOORD_0: 2, NORMAL: 0.5, TEXCOORD_2: 9 }, 2);
    expect(p.stride).toBe(5);
    expect(p.weights).toEqual([2, 2, 0.5, 0.5, 0.5]);
    expect(Array.from(p.data)).toEqual([0.1, 0.2, 0, 1, 0, 0.3, 0.4, 1, 0, 0].map((v) => Math.fround(v)));
    const none = pricedAttributes(parts, {}, 2);
    expect(none).toEqual({ data: new Float32Array(2), stride: 1, weights: [0] });
  });
});

describe("cheaper storage for the far set", () => {
  it("rounds stored UVs to a coarser step, never past the attribute's own range", () => {
    const uv = new Uint16Array([0, 65535, 1000, 1100, 64999, 30001]);
    const out = roundStored(uv, 2, 2, 512);
    expect(Array.from(out)).toEqual([0, 65535, 1024, 1100, 64999, 30208]); // 1100 is the lowest V: it stays
    expect(out).not.toBe(uv);
    expect(roundStored(uv, 2, 2, 1)).toBe(uv);
  });

  it("finds an AO map's brightest texel at the far-view size, as glTF UV", () => {
    // 4 x 4 image, bright only in its lower right quarter; at 2 x 2 that is texel (1, 1).
    const grey = new Uint8Array(16);
    for (const i of [10, 11, 14, 15]) grey[i] = 255;
    grey[0] = 255; // one bright pixel alone averages to 64 in its quarter
    expect(brightestTexel(grey, 4, 4, 2)).toEqual({ u: 0.75, v: 0.75, value: 255 });
  });

  it("lets a mesh override its tier's settings", () => {
    const tier = { error: 0.05, permissive: false, weights: {}, precision: { flatBakedAoUv: true }, byMesh: [["^amenity-parking", { permissive: true }]] as Array<[string, object]> };
    expect(settingsFor(tier, "amenity-parking-8")).toMatchObject({ permissive: true, error: 0.05, precision: { flatBakedAoUv: true } });
    expect(settingsFor(tier, "villa-garden-3")).toBe(tier);
    expect(settingsFor({ error: 1 }, "site")).toEqual({ error: 1 });
  });
});

describe("compareStructure", () => {
  const summary = () => ({
    nodes: [{ name: "site", mesh: "site", matrix: [460, 0, 0, 0, 0, 460, 0, 0, 0, 0, 460, 0, 0, 9, -97, 1], instances: 0, instanceData: [] }, { name: "", mesh: "villa", matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], instances: 2, instanceData: [1, 2, 3, 4] }],
    primitives: [{ mesh: "site", index: 0, material: "site-atlas", attributes: ["NORMAL", "POSITION", "TEXCOORD_2"], triangles: 100, min: [-1, -1, -1], max: [1, 1, 1], radius: 1.7 }],
    materials: ["site-atlas:atlas-base:atlas-normal:ao-site:atlas-orm:-"],
    textures: ["atlas-base", "atlas-normal"],
  });

  it("accepts a far file that only has fewer triangles", () => {
    const far = summary();
    far.primitives[0].triangles = 20;
    expect(compareStructure(summary(), far)).toEqual([]);
  });

  it("names every difference that would break the in-place swap", () => {
    const far = summary();
    far.nodes[0].matrix[12] = 1;
    far.nodes[1].instanceData[2] = 3.5;
    far.primitives[0].attributes = ["NORMAL", "POSITION"];
    far.primitives[0].max = [1, 0.9, 1];
    far.primitives[0].radius = 1.6;
    far.primitives[0].triangles = 120;
    far.materials = ["site-atlas:atlas-base:atlas-normal:-:atlas-orm:-"];
    far.textures = ["atlas-base"];
    const problems = compareStructure(summary(), far).join("\n");
    for (const words of ["node 0 (site): transform differs", "instance transforms differ", "attributes NORMAL,POSITION", "bounding box differs", "bounding sphere", "more than the full file's 100", "texture slots differ", "textures atlas-base"]) {
      expect(problems).toContain(words);
    }
    const fewer = summary();
    fewer.nodes.pop();
    expect(compareStructure(summary(), fewer).join()).toContain("1 nodes, full file has 2");
  });
});

/** The JSON chunk of a GLB. */
const glbJson = (file: string) => {
  const b = readFileSync(MODELS_DIR + file);
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString("utf8"));
};

describe("the shipped far set", () => {
  const report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));

  it("passed its checks, with the settings in the script, and stays on budget", () => {
    expect(report.passed).toBe(true);
    for (const tier of TIERS) {
      const r = report.tiers.find((x: { tier: string }) => x.tier === tier);
      expect(r.problems).toEqual([]);
      expect(r.settings).toEqual(FAR_SETTINGS[tier as "high" | "low"]);
      expect(r.bytes).toBe(statSync(MODELS_DIR + farFile(tier)).size);
      expect(r.bytes).toBeLessThanOrEqual(FAR_BUDGET[tier as "high" | "low"]);
      expect(r.fullBytes).toBe(statSync(MODELS_DIR + fullFile(tier)).size); // built from the shipped full file
    }
  });

  it("has the full file's nodes, meshes, materials and textures, and the extensions the loader wires", () => {
    for (const tier of TIERS) {
      expect(existsSync(MODELS_DIR + farFile(tier))).toBe(true);
      const far = glbJson(farFile(tier));
      const full = glbJson(fullFile(tier));
      expect(far.nodes.map((n: { name?: string }) => n.name)).toEqual(full.nodes.map((n: { name?: string }) => n.name));
      expect(far.meshes.map((m: { name: string }) => m.name)).toEqual(full.meshes.map((m: { name: string }) => m.name));
      expect(far.materials.map((m: { name: string }) => m.name)).toEqual(full.materials.map((m: { name: string }) => m.name));
      expect(far.images.map((i: { name: string }) => i.name)).toEqual(full.images.map((i: { name: string }) => i.name));
      expect([...far.extensionsRequired].sort()).toEqual([...full.extensionsRequired].sort());
    }
  });
});
