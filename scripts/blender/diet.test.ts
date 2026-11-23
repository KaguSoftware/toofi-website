import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AO_KEPT, HALF_PAGES, STEPS, checkDiet, dropTopMips, fillTexcoordGaps, halfName, imageSizes, parseGlb, readKtx2, runDiet, runHalfPages, shrinkGlbImages, stripGlb, writeGlb } from "./diet.mjs";

/**
 * A minimal KTX2: `levels` levels of a w×h texture, level i filled with byte (i + 1), stored
 * smallest first. BasisLZ gets a global-data block with one 20-byte descriptor per level.
 */
function sampleKtx2({ width = 8, height = 8, levels = 3, basis = false } = {}): Buffer {
  const dfd = Buffer.alloc(44, 0xdd);
  const kvd = Buffer.alloc(12, 0xee);
  const sgd = basis ? Buffer.concat([Buffer.alloc(20, 0xaa), ...Array.from({ length: levels }, (_, i) => Buffer.alloc(20, 0x10 + i)), Buffer.alloc(8, 0xbb)]) : Buffer.alloc(0);
  const lengths = Array.from({ length: levels }, (_, i) => 16 >> i || 1);
  let o = 80 + levels * 24;
  const dfdOff = o;
  o += dfd.length;
  const kvdOff = o;
  o += kvd.length;
  let sgdOff = 0;
  if (sgd.length) {
    o = (o + 7) & ~7;
    sgdOff = o;
    o += sgd.length;
  }
  const offsets: number[] = new Array(levels);
  for (let i = levels - 1; i >= 0; i--) {
    o = Math.ceil(o / 16) * 16;
    offsets[i] = o;
    o += lengths[i];
  }
  const buf = Buffer.alloc(o);
  buf.write("«KTX 20»\r\n\x1A\n", 0, "latin1");
  buf.writeUInt32LE(width, 20);
  buf.writeUInt32LE(height, 24);
  buf.writeUInt32LE(1, 36);
  buf.writeUInt32LE(levels, 40);
  buf.writeUInt32LE(basis ? 1 : 0, 44);
  buf.writeUInt32LE(dfdOff, 48);
  buf.writeUInt32LE(dfd.length, 52);
  buf.writeUInt32LE(kvdOff, 56);
  buf.writeUInt32LE(kvd.length, 60);
  buf.writeBigUInt64LE(BigInt(sgdOff), 64);
  buf.writeBigUInt64LE(BigInt(sgd.length), 72);
  for (let i = 0; i < levels; i++) {
    buf.writeBigUInt64LE(BigInt(offsets[i]), 80 + i * 24);
    buf.writeBigUInt64LE(BigInt(lengths[i]), 88 + i * 24);
    buf.writeBigUInt64LE(BigInt(lengths[i]), 96 + i * 24);
    buf.fill(i + 1, offsets[i], offsets[i] + lengths[i]);
  }
  dfd.copy(buf, dfdOff);
  kvd.copy(buf, kvdOff);
  sgd.copy(buf, sgdOff);
  return buf;
}

const pad4 = (b: Buffer) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);

/**
 * Two materials (a baked wall and a court lattice), each with an AO map; two primitives with
 * TEXCOORD_0, _1 (AO) and _2 (lightmap). Images: the atlas, the wall's AO, the lattice's AO.
 */
function sampleGlb() {
  const blobs: Buffer[] = [];
  const views: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  let o = 0;
  const add = (b: Buffer) => {
    const p = pad4(b);
    views.push({ buffer: 0, byteOffset: o, byteLength: b.length });
    blobs.push(p);
    o += p.length;
    return views.length - 1;
  };
  const vec = (n: number, fill: number) => Buffer.alloc(n, fill);
  const accessors: Record<string, unknown>[] = [];
  const acc = (bytes: Buffer, type: string, count: number, componentType = 5126, normalized = false) => {
    accessors.push({ bufferView: add(bytes), componentType, count, type, ...(normalized ? { normalized } : {}) });
    return accessors.length - 1;
  };
  const prim = (material: number, k: number): { material: number; indices: number; attributes: Record<string, number> } => ({
    material,
    indices: acc(vec(6, k), "SCALAR", 3, 5123),
    attributes: { POSITION: acc(vec(36, k + 1), "VEC3", 3), TEXCOORD_0: acc(vec(24, k + 2), "VEC2", 3), TEXCOORD_1: acc(vec(12, k + 3), "VEC2", 3, 5123, true), TEXCOORD_2: acc(vec(12, k + 4), "VEC2", 3, 5123, true) },
  });
  const meshes = [{ name: "wall", primitives: [prim(0, 10)] }, { name: "court", primitives: [prim(1, 20)] }];
  const images = [
    { name: "atlas-base", mimeType: "image/ktx2", bufferView: add(sampleKtx2({ width: 8, height: 8, levels: 3, basis: true })) },
    { name: "ao-wall", mimeType: "image/ktx2", bufferView: add(sampleKtx2({ width: 4, height: 4, levels: 2 })) },
    { name: "ao-court", mimeType: "image/ktx2", bufferView: add(sampleKtx2({ width: 4, height: 4, levels: 2 })) },
  ];
  const tex = (source: number) => ({ extensions: { KHR_texture_basisu: { source } } });
  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: o }],
    bufferViews: views,
    accessors,
    meshes,
    nodes: [{ mesh: 0 }, { mesh: 1 }],
    images,
    textures: [tex(0), tex(1), tex(2)],
    materials: [
      { name: "wall-atlas", pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, occlusionTexture: { index: 1, texCoord: 1 } },
      { name: "amenity-tennis-lattice", pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, occlusionTexture: { index: 2, texCoord: 1 } },
    ],
  };
  return { json, bin: Buffer.concat(blobs) };
}

/** The bytes an accessor points at. */
type Views = { bufferViews: { byteOffset: number; byteLength: number }[]; accessors: { bufferView: number }[] };
const accessorBytes = (glb: { json: unknown; bin: Buffer }, i: number) => {
  const json = glb.json as Views;
  const v = json.bufferViews[json.accessors[i].bufferView];
  return glb.bin.subarray(v.byteOffset, v.byteOffset + v.byteLength);
};

describe("GLB container", () => {
  it("round-trips a GLB byte for byte", () => {
    const g = sampleGlb();
    const out = parseGlb(writeGlb(g));
    expect(out.json).toEqual(g.json);
    expect(out.bin.equals(g.bin)).toBe(true);
    expect(() => parseGlb(Buffer.alloc(16))).toThrow(/not a GLB/);
  });
});

describe("stripGlb (T6)", () => {
  it("removes the AO slot and TEXCOORD_1 except on kept materials, and everything left without a user", () => {
    const g = sampleGlb();
    const out = stripGlb(g, { slots: ["occlusion"], attrs: ["TEXCOORD_1"], keep: AO_KEPT });
    expect(out.json.materials[0].occlusionTexture).toBeUndefined();
    expect(out.json.materials[1].occlusionTexture).toBeDefined();
    expect(Object.keys(out.json.meshes[0].primitives[0].attributes).sort()).toEqual(["POSITION", "TEXCOORD_0", "TEXCOORD_2"]);
    expect(Object.keys(out.json.meshes[1].primitives[0].attributes)).toContain("TEXCOORD_1");
    expect(out.json.images.map((i: { name: string }) => i.name)).toEqual(["atlas-base", "ao-court"]);
    expect(out.json.accessors).toHaveLength(g.json.accessors.length - 1);
    expect(out.bin.length).toBeLessThan(g.bin.length);
  });

  it("copies every kept buffer view byte for byte", () => {
    const g = sampleGlb();
    const out = stripGlb(g, { slots: ["occlusion"], attrs: ["TEXCOORD_1"], keep: AO_KEPT });
    const wall = g.json.meshes[0].primitives[0].attributes;
    const wallOut = out.json.meshes[0].primitives[0].attributes;
    for (const sem of ["POSITION", "TEXCOORD_0", "TEXCOORD_2"]) expect(accessorBytes(out, wallOut[sem]).equals(accessorBytes(g, wall[sem]))).toBe(true);
    const lattice = out.json.materials[1].occlusionTexture.index;
    const img = out.json.images[out.json.textures[lattice].extensions.KHR_texture_basisu.source];
    const v = out.json.bufferViews[img.bufferView];
    expect(readKtx2(out.bin.subarray(v.byteOffset, v.byteOffset + v.byteLength)).width).toBe(4);
  });

  it("changes nothing when asked for nothing", () => {
    const g = sampleGlb();
    const out = stripGlb(g);
    expect(out.json.accessors).toHaveLength(g.json.accessors.length);
    expect(out.bin.equals(g.bin)).toBe(true);
  });
});

describe("fillTexcoordGaps", () => {
  it("gives a primitive that lost TEXCOORD_1 a zero-cost one shaped like its lightmap UVs", () => {
    const stripped = stripGlb(sampleGlb(), { slots: ["occlusion"], attrs: ["TEXCOORD_1"], keep: AO_KEPT });
    const out = fillTexcoordGaps(stripped);
    const a = out.json.accessors[out.json.meshes[0].primitives[0].attributes.TEXCOORD_1];
    expect(a).toEqual({ componentType: 5123, normalized: true, count: 3, type: "VEC2" });
    expect(a.bufferView).toBeUndefined();
    expect(out.bin).toBe(stripped.bin);
    // The lattice kept its own set: untouched.
    expect(out.json.meshes[1].primitives[0].attributes.TEXCOORD_1).toBe(stripped.json.meshes[1].primitives[0].attributes.TEXCOORD_1);
  });
});

describe("mip levels (T38, T42)", () => {
  it("drops top levels of a BasisLZ file, keeping the smaller levels and their descriptors", () => {
    const src = sampleKtx2({ basis: true });
    const out = dropTopMips(src, 1);
    const h = readKtx2(out);
    expect([h.width, h.height, h.levelCount]).toEqual([4, 4, 2]);
    const level = (b: Buffer, i: number) => {
      const k = readKtx2(b).levels[i];
      return b.subarray(k.offset, k.offset + k.length);
    };
    expect(level(out, 0).equals(level(src, 1))).toBe(true);
    const sgd = out.subarray(h.sgdOffset, h.sgdOffset + h.sgdLength);
    expect(sgd[20]).toBe(0x11);
    expect(() => dropTopMips(sampleKtx2({ levels: 1 }), 1)).toThrow(/cannot drop/);
    expect(() => readKtx2(Buffer.alloc(100))).toThrow(/not a KTX2/);
  });

  it("brings a named image down to a width, once", () => {
    const g = sampleGlb();
    const once = shrinkGlbImages(g, { "atlas-base": 4 });
    expect(once.changed).toBe(true);
    expect(imageSizes(once)["atlas-base"]).toEqual([4, 4]);
    expect(imageSizes(once)["ao-wall"]).toEqual([4, 4]);
    const twice = shrinkGlbImages(once, { "atlas-base": 4 });
    expect(twice.changed).toBe(false);
    expect(() => shrinkGlbImages(g, { "atlas-base": 16 })).toThrow(/cannot bring it to 16/);
    expect(() => shrinkGlbImages(g, { nope: 4 })).toThrow(/no image named nope/);
  });
});

describe("the steps", () => {
  it("ao runs once and leaves a file checkDiet accepts", () => {
    const first = STEPS.ao.apply(sampleGlb());
    expect(first.changed).toBe(true);
    expect(STEPS.ao.apply(first).changed).toBe(false);
    expect(checkDiet("compound-zaitun-low.glb", first)).toEqual([]);
    expect(checkDiet("compound-zaitun-low.glb", sampleGlb())).toEqual(["compound-zaitun-low.glb: wall-atlas still has an AO map"]);
  });

  it("ao also puts back the free placeholder where a tool stored TEXCOORD_1 as real bytes", () => {
    const g = sampleGlb();
    g.json.materials[0] = { ...g.json.materials[0], occlusionTexture: undefined } as never;
    delete (g.json.materials[0] as { occlusionTexture?: unknown }).occlusionTexture;
    const out = STEPS.ao.apply(g);
    expect(out.changed).toBe(true);
    expect(out.json.accessors[out.json.meshes[0].primitives[0].attributes.TEXCOORD_1].bufferView).toBeUndefined();
    expect(STEPS.ao.apply(out).changed).toBe(false);
  });

  it("checkDiet names a TEXCOORD gap and an atlas left at full size", () => {
    const gap = stripGlb(sampleGlb(), { slots: ["occlusion"], attrs: ["TEXCOORD_1"], keep: AO_KEPT });
    expect(checkDiet("compound-zaitun-far-low.glb", gap)).toEqual(["compound-zaitun-far-low.glb: wall has a gap in its TEXCOORD sets"]);
    expect(checkDiet("vegetation-high.glb", sampleGlb())).toEqual(["vegetation-high.glb: vegetation atlas not at 1024"]);
  });

  it("runDiet writes each file once, with every step that edits it, to another folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "diet-"));
    const out = mkdtempSync(join(tmpdir(), "diet-out-"));
    for (const f of STEPS.ao.files) writeFileSync(join(dir, f), writeGlb(sampleGlb()));
    const rows = runDiet({ steps: ["ao"], dir, out });
    expect(rows.filter((r) => r.step === "ao").every((r) => r.changed)).toBe(true);
    const total = rows.find((r) => r.step === "total" && r.file === "compound-zaitun-high.glb")!;
    expect(total.bytes!.after).toBeLessThan(total.bytes!.before);
    expect(total.problems).toEqual([]);
    expect(parseGlb(readFileSync(join(out, "compound-zaitun-high.glb"))).json.materials[0].occlusionTexture).toBeUndefined();
    // The source folder is untouched.
    expect(parseGlb(readFileSync(join(dir, "compound-zaitun-high.glb"))).json.materials[0].occlusionTexture).toBeDefined();
    expect(() => runDiet({ steps: ["vegetation"], dir, out })).toThrow(/missing/);
  });
});

describe("half pages (T36)", () => {
  it("writes the high tier's day buildings page at half size beside it, named as bakedLight.ts expects", () => {
    expect(HALF_PAGES).toEqual(["day-buildings-high.ktx2"]);
    expect(halfName("day-buildings-high.ktx2")).toBe("day-buildings-high.half.ktx2");
    const dir = mkdtempSync(join(tmpdir(), "half-"));
    writeFileSync(join(dir, "day-buildings-high.ktx2"), sampleKtx2({ width: 8, height: 8, levels: 3, basis: true }));
    const [row] = runHalfPages({ dir });
    expect(row.size).toEqual([4, 4]);
    expect(row.bytes.half).toBeLessThan(row.bytes.full);
    expect(readKtx2(readFileSync(join(dir, "day-buildings-high.half.ktx2"))).levelCount).toBe(2);
    expect(() => runHalfPages({ dir: mkdtempSync(join(tmpdir(), "half-none-")) })).toThrow(/missing/);
  });
});
