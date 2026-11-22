#!/usr/bin/env node
/**
 * Byte-exact GLB surgery for the S3 experiments: removes material texture slots and vertex
 * attributes, then drops whatever no longer has a user (textures, images, accessors, buffer views)
 * and repacks the binary chunk. Every kept buffer view is copied byte for byte, so meshopt streams
 * are never decoded and re-encoded (its octahedral normal filter is lossy on a round trip) and the
 * only difference from the input is what was asked to go.
 *
 *   node scripts/perf/S3/strip-glb.mjs in.glb out.glb [--slot occlusion] [--slot normal] [--attr TEXCOORD_1] [--keep "-lattice$"]
 *
 * Slots: base, orm, normal, occlusion, emissive. An experiment tool only: product files are
 * produced by scripts/blender/export-final.sh.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseGlb } from "./glb-cost.mjs";

const SLOT_PATHS = {
  base: (m) => [m.pbrMetallicRoughness, "baseColorTexture"],
  orm: (m) => [m.pbrMetallicRoughness, "metallicRoughnessTexture"],
  normal: (m) => [m, "normalTexture"],
  occlusion: (m) => [m, "occlusionTexture"],
  emissive: (m) => [m, "emissiveTexture"],
};

const align4 = (n) => (n + 3) & ~3;

/**
 * Rewrites a parsed GLB ({ json, bin }) without the given slots and attributes. Pure: returns new objects.
 * @param {{ json: any, bin: Buffer }} glb
 * @param {{ slots?: string[], attrs?: string[], keep?: RegExp | null }} [options]
 * @returns {{ json: any, bin: Buffer }}
 */
export function stripGlb({ json: src, bin }, { slots = [], attrs = [], keep = null } = {}) {
  const json = structuredClone(src);
  // `keep` (a RegExp on material names) spares those materials and their primitives' attributes.
  const kept = (mi) => keep !== null && mi !== undefined && keep.test(json.materials[mi]?.name ?? "");
  (json.materials ?? []).forEach((m, mi) => {
    if (kept(mi)) return;
    for (const s of slots) {
      const [obj, key] = SLOT_PATHS[s](m) ?? [];
      if (obj && key in obj) delete obj[key];
    }
  });
  for (const mesh of json.meshes ?? []) for (const p of mesh.primitives) if (!kept(p.material)) for (const a of attrs) delete p.attributes[a];

  // Users of every accessor, texture and image after the removals.
  const usedTex = new Set();
  const visitTex = (info) => info && usedTex.add(info.index);
  for (const m of json.materials ?? []) {
    const pbr = m.pbrMetallicRoughness ?? {};
    [pbr.baseColorTexture, pbr.metallicRoughnessTexture, m.normalTexture, m.occlusionTexture, m.emissiveTexture].forEach(visitTex);
  }
  const usedImg = new Set();
  for (const ti of usedTex) {
    const t = json.textures[ti];
    const src = t.extensions?.KHR_texture_basisu?.source ?? t.source;
    if (src !== undefined) usedImg.add(src);
  }
  const usedAcc = new Set();
  for (const mesh of json.meshes ?? []) for (const p of mesh.primitives) {
    Object.values(p.attributes).forEach((a) => usedAcc.add(a));
    if (p.indices !== undefined) usedAcc.add(p.indices);
    for (const t of p.targets ?? []) Object.values(t).forEach((a) => usedAcc.add(a));
  }
  for (const n of json.nodes ?? []) {
    const inst = n.extensions?.EXT_mesh_gpu_instancing;
    if (inst) Object.values(inst.attributes).forEach((a) => usedAcc.add(a));
  }
  for (const an of json.animations ?? []) for (const s of an.samplers) usedAcc.add(s.input).add(s.output);
  for (const sk of json.skins ?? []) if (sk.inverseBindMatrices !== undefined) usedAcc.add(sk.inverseBindMatrices);

  const usedView = new Set();
  for (const ai of usedAcc) {
    const a = json.accessors[ai];
    if (a.bufferView !== undefined) usedView.add(a.bufferView);
    if (a.sparse) usedView.add(a.sparse.indices.bufferView).add(a.sparse.values.bufferView);
  }
  for (const ii of usedImg) if (json.images[ii].bufferView !== undefined) usedView.add(json.images[ii].bufferView);

  const remap = (n, used) => {
    const map = new Map();
    let k = 0;
    for (let i = 0; i < n; i++) if (used.has(i)) map.set(i, k++);
    return map;
  };
  const accMap = remap(json.accessors?.length ?? 0, usedAcc);
  const texMap = remap(json.textures?.length ?? 0, usedTex);
  const imgMap = remap(json.images?.length ?? 0, usedImg);
  const viewMap = remap(json.bufferViews.length, usedView);

  // Repack the binary chunk: only buffer 0 (the GLB chunk) holds bytes; meshopt fallback buffers hold none.
  const parts = [];
  let offset = 0;
  const views = [];
  json.bufferViews.forEach((v, i) => {
    if (!usedView.has(i)) return;
    const nv = structuredClone(v);
    const mo = nv.extensions?.EXT_meshopt_compression;
    const place = (holder, key = "byteOffset") => {
      const start = holder[key] ?? 0;
      const bytes = bin.subarray(start, start + holder.byteLength);
      offset = align4(offset);
      parts.push({ offset, bytes });
      holder[key] = offset;
      offset += bytes.length;
    };
    if (mo && mo.buffer === 0) place(mo);
    if (nv.buffer === 0) place(nv);
    views.push(nv);
  });
  json.bufferViews = views;
  const newBin = Buffer.alloc(align4(offset));
  for (const p of parts) p.bytes.copy(newBin, p.offset);
  json.buffers[0].byteLength = newBin.length;

  json.accessors = (json.accessors ?? []).filter((_, i) => usedAcc.has(i)).map((a) => {
    const na = { ...a };
    if (na.bufferView !== undefined) na.bufferView = viewMap.get(na.bufferView);
    if (na.sparse) {
      na.sparse = structuredClone(na.sparse);
      na.sparse.indices.bufferView = viewMap.get(na.sparse.indices.bufferView);
      na.sparse.values.bufferView = viewMap.get(na.sparse.values.bufferView);
    }
    return na;
  });
  json.images = (json.images ?? []).filter((_, i) => usedImg.has(i)).map((im) => (im.bufferView !== undefined ? { ...im, bufferView: viewMap.get(im.bufferView) } : im));
  json.textures = (json.textures ?? []).filter((_, i) => usedTex.has(i)).map((t) => {
    const nt = structuredClone(t);
    if (nt.source !== undefined) nt.source = imgMap.get(nt.source);
    if (nt.extensions?.KHR_texture_basisu) nt.extensions.KHR_texture_basisu.source = imgMap.get(nt.extensions.KHR_texture_basisu.source);
    return nt;
  });
  const fixTex = (info) => info && (info.index = texMap.get(info.index));
  for (const m of json.materials ?? []) {
    const pbr = m.pbrMetallicRoughness ?? {};
    [pbr.baseColorTexture, pbr.metallicRoughnessTexture, m.normalTexture, m.occlusionTexture, m.emissiveTexture].forEach(fixTex);
  }
  const fixAcc = (o) => {
    for (const k of Object.keys(o)) o[k] = accMap.get(o[k]);
  };
  for (const mesh of json.meshes ?? []) for (const p of mesh.primitives) {
    fixAcc(p.attributes);
    if (p.indices !== undefined) p.indices = accMap.get(p.indices);
    for (const t of p.targets ?? []) fixAcc(t);
  }
  for (const n of json.nodes ?? []) {
    const inst = n.extensions?.EXT_mesh_gpu_instancing;
    if (inst) fixAcc(inst.attributes);
  }
  for (const an of json.animations ?? []) for (const s of an.samplers) {
    s.input = accMap.get(s.input);
    s.output = accMap.get(s.output);
  }
  for (const sk of json.skins ?? []) if (sk.inverseBindMatrices !== undefined) sk.inverseBindMatrices = accMap.get(sk.inverseBindMatrices);
  if (json.textures.length === 0) delete json.textures;
  if (json.images.length === 0) delete json.images;
  return { json, bin: newBin };
}

/** Serialises { json, bin } as a GLB. */
export function writeGlb({ json, bin }) {
  let text = Buffer.from(JSON.stringify(json), "utf8");
  const pad = align4(text.length) - text.length;
  text = Buffer.concat([text, Buffer.alloc(pad, 0x20)]);
  const total = 12 + 8 + text.length + (bin ? 8 + bin.length : 0);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(text.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const chunks = [head, jh, text];
  if (bin) {
    const bh = Buffer.alloc(8);
    bh.writeUInt32LE(bin.length, 0);
    bh.writeUInt32LE(0x004e4942, 4);
    chunks.push(bh, bin);
  }
  return Buffer.concat(chunks);
}

function main() {
  const args = process.argv.slice(2);
  const slots = [];
  const attrs = [];
  const files = [];
  let keep = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--keep") keep = new RegExp(args[++i]);
    else if (args[i] === "--slot") slots.push(args[++i]);
    else if (args[i] === "--attr") attrs.push(args[++i]);
    else files.push(args[i]);
  }
  const [input, output] = files;
  if (!input || !output) throw new Error("usage: strip-glb.mjs in.glb out.glb [--slot occlusion] [--attr TEXCOORD_1]");
  const before = readFileSync(input);
  const after = writeGlb(stripGlb(parseGlb(before), { slots, attrs, keep }));
  writeFileSync(output, after);
  console.log(`${input}: ${before.length} -> ${after.length} bytes (${(((before.length - after.length) / before.length) * 100).toFixed(1)}% smaller)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
