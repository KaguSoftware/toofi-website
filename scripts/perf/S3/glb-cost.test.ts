import { describe, expect, it } from "vitest";
import { costMarkdown, glbCost, imageUses, parseGlb, storedView, viewOwners } from "./glb-cost.mjs";
import { stripGlb, writeGlb } from "./strip-glb.mjs";

/**
 * A small GLB: one mesh with POSITION, TEXCOORD_0, TEXCOORD_1 and indices; a meshopt-compressed
 * NORMAL whose decoded view lives in a fallback buffer; two images (base, occlusion on uv1).
 */
export function sampleGlb() {
  const chunks: Buffer[] = [];
  let offset = 0;
  const views: Record<string, unknown>[] = [];
  const add = (bytes: Buffer, extra: Record<string, unknown> = {}) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...extra });
    chunks.push(bytes);
    offset += bytes.length;
    return views.length - 1;
  };
  const pos = add(Buffer.alloc(36, 1));
  const uv0 = add(Buffer.alloc(24, 2));
  const uv1 = add(Buffer.alloc(24, 3));
  const idx = add(Buffer.from([0, 0, 1, 0, 2, 0]));
  const img0 = add(Buffer.alloc(40, 5));
  const img1 = add(Buffer.alloc(16, 6));
  // meshopt: the stream sits in buffer 0, the view itself points at the data-less fallback buffer 1
  const stream = Buffer.alloc(10, 7);
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    offset += pad;
  }
  views.push({ buffer: 1, byteOffset: 0, byteLength: 12, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: offset, byteLength: 10, byteStride: 4, count: 3, mode: "ATTRIBUTES", filter: "OCTAHEDRAL" } } });
  chunks.push(stream);
  offset += stream.length;
  const normal = views.length - 1;
  const bin = Buffer.concat(chunks, offset + ((4 - (offset % 4)) % 4));
  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: bin.length }, { byteLength: 12, extensions: { EXT_meshopt_compression: { fallback: true } } }],
    bufferViews: views,
    accessors: [
      { bufferView: pos, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: uv0, componentType: 5126, count: 3, type: "VEC2" },
      { bufferView: uv1, componentType: 5126, count: 3, type: "VEC2" },
      { bufferView: idx, componentType: 5123, count: 3, type: "SCALAR" },
      { bufferView: normal, componentType: 5120, count: 3, type: "VEC3", normalized: true },
    ],
    images: [
      { name: "base", mimeType: "image/png", bufferView: img0 },
      { name: "ao", mimeType: "image/png", bufferView: img1 },
    ],
    textures: [{ source: 0 }, { source: 1 }],
    materials: [{ name: "wall", pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, occlusionTexture: { index: 1, texCoord: 1 } }],
    meshes: [{ name: "box", primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1, TEXCOORD_1: 2, NORMAL: 4 }, indices: 3, material: 0 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
  };
  return { json, bin };
}

describe("glb-cost", () => {
  it("round-trips a GLB through writeGlb and parseGlb", () => {
    const g = sampleGlb();
    const back = parseGlb(writeGlb(g));
    expect(back.json).toEqual(g.json);
    expect(Buffer.compare(back.bin, g.bin)).toBe(0);
  });

  it("counts the meshopt stream, not the decoded view", () => {
    const { json } = sampleGlb();
    const s = storedView(json, 6);
    expect(s).toMatchObject({ byteLength: 10, decoded: 12, meshopt: "ATTRIBUTES/OCTAHEDRAL" });
    expect(storedView(json, 0)).toMatchObject({ byteLength: 36, meshopt: null });
  });

  it("knows who uses each buffer view and each image", () => {
    const { json } = sampleGlb();
    const owners = viewOwners(json);
    expect(owners.get(2)).toEqual([{ mesh: 0, semantic: "TEXCOORD_1" }]);
    expect(owners.get(5)).toEqual([{ image: 1 }]);
    expect(imageUses(json).get(1)).toEqual([{ material: "wall", slot: "occlusion", texCoord: 1 }]);
  });

  it("splits a file into geometry per mesh and attribute, and images by use", () => {
    const r = glbCost(writeGlb(sampleGlb()), "box.glb");
    expect(r.meshes).toHaveLength(1);
    expect(r.meshes[0]).toMatchObject({ name: "box", vertices: 3, triangles: 1, copies: 1, materials: ["wall"] });
    expect(r.meshes[0].stored).toBe(36 + 24 + 24 + 6 + 10);
    expect(r.semantics.NORMAL.stored).toBe(10);
    expect(r.semantics.NORMAL.decoded).toBe(12);
    expect(r.images.map((i: { name: string; stored: number }) => [i.name, i.stored])).toEqual([
      ["base", 40],
      ["ao", 16],
    ]);
    expect(costMarkdown(r)).toContain("| ao | image/png | 0 KB | wall:occlusion@uv1 |");
  });
});

describe("strip-glb", () => {
  it("drops a slot and an attribute with everything only they used, keeping other bytes exact", () => {
    const g = sampleGlb();
    const out = stripGlb(g, { slots: ["occlusion"], attrs: ["TEXCOORD_1"] });
    const prim = out.json.meshes[0].primitives[0];
    expect(Object.keys(prim.attributes).sort()).toEqual(["NORMAL", "POSITION", "TEXCOORD_0"]);
    expect(out.json.materials[0].occlusionTexture).toBeUndefined();
    expect(out.json.images.map((i: { name: string }) => i.name)).toEqual(["base"]);
    expect(out.json.textures).toEqual([{ source: 0 }]);
    expect(out.json.accessors).toHaveLength(4);
    // every kept view carries exactly its original bytes
    const before = parseGlb(writeGlb(g));
    const after = parseGlb(writeGlb(out));
    for (const sem of ["POSITION", "TEXCOORD_0", "NORMAL"]) {
      const a = (j: typeof before.json, b: Buffer, acc: number) => {
        const s = storedView(j, j.accessors[acc].bufferView);
        return b.subarray(s.byteOffset, s.byteOffset + s.byteLength);
      };
      const src = a(before.json, before.bin, g.json.meshes[0].primitives[0].attributes[sem as "POSITION"]);
      const dst = a(after.json, after.bin, prim.attributes[sem]);
      expect(Buffer.compare(src, dst)).toBe(0);
    }
    expect(after.bin.length).toBeLessThan(before.bin.length);
    expect(out.json.buffers[0].byteLength).toBe(after.bin.length);
  });

  it("spares materials matching `keep`, with their primitives' attributes", () => {
    const out = stripGlb(sampleGlb(), { slots: ["occlusion"], attrs: ["TEXCOORD_1"], keep: /^wall$/ });
    expect(out.json.materials[0].occlusionTexture).toEqual({ index: 1, texCoord: 1 });
    expect(out.json.meshes[0].primitives[0].attributes.TEXCOORD_1).toBeDefined();
    expect(out.json.images).toHaveLength(2);
  });

  it("leaves the input untouched and does nothing when asked for nothing", () => {
    const g = sampleGlb();
    const copy = structuredClone(g.json);
    const out = stripGlb(g);
    expect(g.json).toEqual(copy);
    expect(out.json.images).toHaveLength(2);
    expect(out.json.accessors).toHaveLength(5);
  });
});
