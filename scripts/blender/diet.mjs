#!/usr/bin/env node
/**
 * The asset diet (optimization track F2B): byte-exact edits to the shipped Zaitun files, each one a
 * ledger row the search measured (docs/zaitun/perf/FINDINGS.md):
 *
 * - `ao`   (T6)  the per-template AO maps and their `TEXCOORD_1` leave the compound, full and far,
 *                both tiers, except on the two court lattices (the only materials the baked light
 *                leaves on real-time light, so the only ones whose AO shows).
 * - `atlas` (T42) the high tier's atlas one mip lower: base colour and ORM 2048² → 1024², the normal
 *                map 1024² → 512² (the full file only; the far set already carries far-view sizes).
 * - `vegetation` (T38) the high tier's vegetation atlas 2048² → 1024² (the owner's decision D6).
 * - `half` (T36) the high tier's day buildings lightmap page also as its half-size mip level,
 *                `day-buildings-high.half.ktx2`, which the first frame takes; the full page follows
 *                after the poster hold (compoundModel.ts `upgradeDayPage`).
 *
 *   node scripts/blender/diet.mjs                       every step, on the files in public/sawad/models
 *   node scripts/blender/diet.mjs --steps ao,atlas      some steps
 *   node scripts/blender/diet.mjs --out <dir>           write the results to <dir> instead (candidates for the look gate)
 *
 * Run by scripts/blender/export-final.sh after it encodes the compound, and before export-far.sh
 * builds the far set from it. Each step is idempotent: a file already on its diet is left alone.
 * It reads the shipped file (fresh or versioned, version-assets.mjs `shippedPath`) and writes the
 * stable name, which version-assets.mjs then versions.
 *
 * Why byte-exact: every kept buffer view is copied byte for byte, so meshopt streams are never
 * decoded and re-encoded (its octahedral normal filter drifts on a round trip), and a dropped mip
 * level is exactly what the GPU already samples one level down. The files that come out are the
 * ones S3 put through the look gate (scripts/perf/S3/strip-glb.mjs and ktx2-mip.mjs, whose
 * methods this module carries into the pipeline), not a re-encode that resembles them.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { shippedPath } from "./version-assets.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
export const MODELS_DIR = here("../../public/sawad/models/");
export const LIGHTMAPS_DIR = here("../../public/sawad/lightmaps/zaitun/");

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const align4 = (n) => (n + 3) & ~3;

// ------------------------------------------------------------------ GLB container

/** The JSON and BIN chunks of a GLB buffer. */
export function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error("not a GLB");
  let o = 12;
  let json = null;
  let bin = null;
  while (o < buf.length) {
    const len = buf.readUInt32LE(o);
    const type = buf.readUInt32LE(o + 4);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(data.toString("utf8"));
    else if (type === CHUNK_BIN) bin = data;
    o += 8 + len;
  }
  return { json, bin };
}

/** Serialises { json, bin } as a GLB. */
export function writeGlb({ json, bin }) {
  let text = Buffer.from(JSON.stringify(json), "utf8");
  text = Buffer.concat([text, Buffer.alloc(align4(text.length) - text.length, 0x20)]);
  const total = 12 + 8 + text.length + (bin ? 8 + bin.length : 0);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(GLB_MAGIC, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(text.length, 0);
  jh.writeUInt32LE(CHUNK_JSON, 4);
  const chunks = [head, jh, text];
  if (bin) {
    const bh = Buffer.alloc(8);
    bh.writeUInt32LE(bin.length, 0);
    bh.writeUInt32LE(CHUNK_BIN, 4);
    chunks.push(bh, bin);
  }
  return Buffer.concat(chunks);
}

/** The bytes of a buffer view as stored in the BIN chunk (buffer 0 only). */
const viewBytes = (bin, holder) => bin.subarray(holder.byteOffset ?? 0, (holder.byteOffset ?? 0) + holder.byteLength);

/**
 * Repacks the BIN chunk: every buffer view of buffer 0 (and every meshopt stream stored in buffer 0)
 * in order, each 4-byte aligned. `replace` maps a view index to new bytes for that view.
 * Mutates `json.bufferViews` and `json.buffers[0]`; returns the new chunk.
 */
function repack(json, bin, replace = new Map()) {
  const parts = [];
  let o = 0;
  const place = (holder, bytes) => {
    o = align4(o);
    parts.push({ o, bytes });
    holder.byteOffset = o;
    holder.byteLength = bytes.length;
    o += bytes.length;
  };
  json.bufferViews.forEach((v, i) => {
    const mo = v.extensions?.EXT_meshopt_compression;
    if (mo && mo.buffer === 0) place(mo, viewBytes(bin, mo));
    if (v.buffer === 0) place(v, replace.get(i) ?? viewBytes(bin, v));
  });
  const out = Buffer.alloc(align4(o));
  for (const p of parts) p.bytes.copy(out, p.o);
  json.buffers[0].byteLength = out.length;
  return out;
}

// ------------------------------------------------------------------ texture slots and attributes (T6)

const SLOT_PATHS = {
  base: (m) => [m.pbrMetallicRoughness, "baseColorTexture"],
  orm: (m) => [m.pbrMetallicRoughness, "metallicRoughnessTexture"],
  normal: (m) => [m, "normalTexture"],
  occlusion: (m) => [m, "occlusionTexture"],
  emissive: (m) => [m, "emissiveTexture"],
};
const textureInfos = (m) => {
  const pbr = m.pbrMetallicRoughness ?? {};
  return [pbr.baseColorTexture, pbr.metallicRoughnessTexture, m.normalTexture, m.occlusionTexture, m.emissiveTexture];
};

/** Index map from old to new for the kept indices 0..n-1. */
const remap = (n, used) => {
  const map = new Map();
  let k = 0;
  for (let i = 0; i < n; i++) if (used.has(i)) map.set(i, k++);
  return map;
};

/**
 * Removes material texture slots and vertex attributes, then whatever no longer has a user
 * (textures, images, accessors, buffer views), and repacks the BIN chunk. `keep` (a RegExp on
 * material names) spares those materials and their primitives. Pure: returns new objects.
 * @param {{ json: any, bin: Buffer }} glb
 * @param {{ slots?: string[], attrs?: string[], keep?: RegExp | null }} [options]
 * @returns {{ json: any, bin: Buffer }}
 */
export function stripGlb({ json: src, bin }, { slots = [], attrs = [], keep = null } = {}) {
  const json = structuredClone(src);
  const kept = (mi) => keep !== null && mi !== undefined && keep.test(json.materials[mi]?.name ?? "");
  (json.materials ?? []).forEach((m, mi) => {
    if (kept(mi)) return;
    for (const s of slots) {
      const [obj, key] = SLOT_PATHS[s](m);
      if (obj && key in obj) delete obj[key];
    }
  });
  for (const mesh of json.meshes ?? []) for (const p of mesh.primitives) if (!kept(p.material)) for (const a of attrs) delete p.attributes[a];

  const usedTex = new Set();
  for (const m of json.materials ?? []) for (const info of textureInfos(m)) if (info) usedTex.add(info.index);
  const usedImg = new Set();
  for (const ti of usedTex) {
    const t = json.textures[ti];
    const s = t.extensions?.KHR_texture_basisu?.source ?? t.source;
    if (s !== undefined) usedImg.add(s);
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

  const accMap = remap(json.accessors?.length ?? 0, usedAcc);
  const texMap = remap(json.textures?.length ?? 0, usedTex);
  const imgMap = remap(json.images?.length ?? 0, usedImg);
  const viewMap = remap(json.bufferViews.length, usedView);

  json.bufferViews = json.bufferViews.filter((_, i) => usedView.has(i));
  const newBin = repack(json, bin);

  json.accessors = (json.accessors ?? []).filter((_, i) => usedAcc.has(i)).map((a) => {
    const na = structuredClone(a);
    if (na.bufferView !== undefined) na.bufferView = viewMap.get(na.bufferView);
    if (na.sparse) {
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
  for (const m of json.materials ?? []) for (const info of textureInfos(m)) if (info) info.index = texMap.get(info.index);
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

/**
 * glTF wants the TEXCOORD_n sets of a primitive to start at 0 and run without a gap (the validator
 * errors on one). A primitive that lost TEXCOORD_1 but keeps TEXCOORD_2 (the lightmap UVs, which
 * three reads as `uv2`) gets a TEXCOORD_1 that costs no bytes: an accessor with no buffer view,
 * which glTF defines as all zeros. The loader drops it before upload (compoundModel.ts
 * `prepareCompound`). Pure: returns new objects; the BIN chunk is untouched.
 */
export function fillTexcoordGaps({ json: src, bin }) {
  const json = structuredClone(src);
  for (const mesh of json.meshes ?? []) for (const p of mesh.primitives) {
    const sets = Object.keys(p.attributes).filter((a) => /^TEXCOORD_\d+$/.test(a)).map((a) => Number(a.slice(9)));
    if (!sets.length) continue;
    const top = Math.max(...sets);
    const like = json.accessors[p.attributes[`TEXCOORD_${top}`]];
    const count = json.accessors[p.attributes.POSITION].count;
    for (let i = 0; i < top; i++) {
      if (p.attributes[`TEXCOORD_${i}`] !== undefined) continue;
      json.accessors.push({ componentType: like.componentType, ...(like.normalized ? { normalized: true } : {}), count, type: "VEC2" });
      p.attributes[`TEXCOORD_${i}`] = json.accessors.length - 1;
    }
  }
  return { json, bin };
}

// ------------------------------------------------------------------ mip levels (T38, T42)

const KTX_HEADER = 80;
const KTX_LEVEL = 24;

/** Header fields of a KTX2 buffer. */
export function readKtx2(buf) {
  if (buf.toString("latin1", 1, 7) !== "KTX 20") throw new Error("not a KTX2 file");
  const u32 = (o) => buf.readUInt32LE(o);
  const u64 = (o) => Number(buf.readBigUInt64LE(o));
  const levelCount = u32(40);
  const levels = [];
  for (let i = 0; i < Math.max(1, levelCount); i++) {
    const o = KTX_HEADER + i * KTX_LEVEL;
    levels.push({ offset: u64(o), length: u64(o + 8), uncompressed: u64(o + 16) });
  }
  return {
    width: u32(20), height: u32(24), layers: u32(32), faces: u32(36), levelCount, supercompression: u32(44),
    dfdOffset: u32(48), dfdLength: u32(52), kvdOffset: u32(56), kvdLength: u32(60), sgdOffset: u64(64), sgdLength: u64(72), levels,
  };
}

/**
 * A new KTX2 buffer without its top `drop` mip levels, no re-encode: works for ETC1S (BasisLZ, whose
 * global data holds one image descriptor per level) and UASTC (zstd or none).
 */
export function dropTopMips(buf, drop = 1) {
  const h = readKtx2(buf);
  if (drop < 1) return Buffer.from(buf);
  if (h.levelCount <= drop) throw new Error(`only ${h.levelCount} levels, cannot drop ${drop}`);
  const images = Math.max(1, h.layers) * h.faces;
  const keep = h.levels.slice(drop);
  const levelCount = h.levelCount - drop;
  const dfd = buf.subarray(h.dfdOffset, h.dfdOffset + h.dfdLength);
  const kvd = buf.subarray(h.kvdOffset, h.kvdOffset + h.kvdLength);
  let sgd = buf.subarray(h.sgdOffset, h.sgdOffset + h.sgdLength);
  if (h.supercompression === 1) sgd = Buffer.concat([sgd.subarray(0, 20), sgd.subarray(20 + 20 * images * drop)]);
  let o = KTX_HEADER + levelCount * KTX_LEVEL;
  const dfdOffset = o;
  o += dfd.length;
  const kvdOffset = kvd.length ? o : 0;
  o += kvd.length;
  let sgdOffset = 0;
  if (sgd.length) {
    o = (o + 7) & ~7;
    sgdOffset = o;
    o += sgd.length;
  }
  const alignment = h.supercompression ? 1 : 16;
  const placed = new Array(levelCount);
  for (const l of keep.map((l, i) => ({ ...l, i })).sort((a, b) => a.offset - b.offset)) {
    o = Math.ceil(o / alignment) * alignment;
    placed[l.i] = { offset: o, length: l.length, uncompressed: l.uncompressed, src: l.offset };
    o += l.length;
  }
  const res = Buffer.alloc(o);
  buf.copy(res, 0, 0, KTX_HEADER);
  res.writeUInt32LE(Math.max(1, h.width >> drop), 20);
  res.writeUInt32LE(h.height ? Math.max(1, h.height >> drop) : 0, 24);
  res.writeUInt32LE(levelCount, 40);
  res.writeUInt32LE(dfdOffset, 48);
  res.writeUInt32LE(dfd.length, 52);
  res.writeUInt32LE(kvdOffset, 56);
  res.writeUInt32LE(kvd.length, 60);
  res.writeBigUInt64LE(BigInt(sgdOffset), 64);
  res.writeBigUInt64LE(BigInt(sgd.length), 72);
  placed.forEach((p, i) => {
    const e = KTX_HEADER + i * KTX_LEVEL;
    res.writeBigUInt64LE(BigInt(p.offset), e);
    res.writeBigUInt64LE(BigInt(p.length), e + 8);
    res.writeBigUInt64LE(BigInt(p.uncompressed), e + 16);
    buf.copy(res, p.offset, p.src, p.src + p.length);
  });
  dfd.copy(res, dfdOffset);
  kvd.copy(res, kvdOffset);
  sgd.copy(res, sgdOffset);
  return res;
}

/**
 * Width and height of each KTX2 image in a parsed GLB, by image name.
 * @param {{ json: any, bin: Buffer }} glb
 * @returns {Record<string, [number, number]>}
 */
export function imageSizes({ json, bin }) {
  const out = {};
  for (const im of json.images ?? []) {
    if (im.bufferView === undefined || im.mimeType !== "image/ktx2") continue;
    const h = readKtx2(viewBytes(bin, json.bufferViews[im.bufferView]));
    out[im.name] = [h.width, h.height];
  }
  return out;
}

/**
 * Brings named KTX2 images inside a parsed GLB down to a width, by dropping top mip levels. `sizes`
 * maps image name to the target width. An image already at its width is left alone, so the step can
 * run twice; one that is smaller, or missing, is an error. Pure: returns new objects.
 */
export function shrinkGlbImages({ json: src, bin }, sizes) {
  const json = structuredClone(src);
  const replace = new Map();
  for (const [name, width] of Object.entries(sizes)) {
    const im = (json.images ?? []).find((x) => x.name === name);
    if (!im || im.bufferView === undefined) throw new Error(`no image named ${name}`);
    const bytes = viewBytes(bin, json.bufferViews[im.bufferView]);
    const have = readKtx2(bytes).width;
    if (have === width) continue;
    const drop = Math.log2(have / width);
    if (!Number.isInteger(drop) || drop < 1) throw new Error(`${name} is ${have} wide, cannot bring it to ${width} by dropping mip levels`);
    replace.set(im.bufferView, dropTopMips(bytes, drop));
  }
  if (!replace.size) return { json, bin, changed: false };
  return { json, bin: repack(json, bin, replace), changed: true };
}

// ------------------------------------------------------------------ the steps

/** Materials whose AO shows: the court lattices, which the baked light leaves on real-time light (bakedLight.ts UNBAKED_MATERIAL). */
export const AO_KEPT = /-lattice$/;

/**
 * Each step: the files it edits and what it does to one parsed file. `apply` returns the new
 * { json, bin } and whether anything changed.
 */
export const STEPS = {
  ao: {
    row: "T6",
    files: ["compound-zaitun-high.glb", "compound-zaitun-low.glb", "compound-zaitun-far-high.glb", "compound-zaitun-far-low.glb"],
    apply(glb) {
      const json = glb.json;
      const kept = (mi) => mi !== undefined && AO_KEPT.test(json.materials?.[mi]?.name ?? "");
      const maps = (json.materials ?? []).some((m) => m.occlusionTexture && !AO_KEPT.test(m.name ?? ""));
      // A TEXCOORD_1 stored with bytes where nothing reads it (a tool that rewrote the file, such as
      // far-set.mjs, stores the free placeholder as real zeros).
      const stored = (json.meshes ?? []).some((mesh) => mesh.primitives.some((p) => !kept(p.material) && p.attributes.TEXCOORD_1 !== undefined && json.accessors[p.attributes.TEXCOORD_1].bufferView !== undefined));
      if (!maps && !stored) return { ...glb, changed: false };
      return { ...fillTexcoordGaps(stripGlb(glb, { slots: ["occlusion"], attrs: ["TEXCOORD_1"], keep: AO_KEPT })), changed: true };
    },
  },
  atlas: {
    row: "T42",
    files: ["compound-zaitun-high.glb"],
    apply: (glb) => shrinkGlbImages(glb, { "atlas-base": 1024, "atlas-orm": 1024, "atlas-normal": 512 }),
  },
  vegetation: {
    row: "T38",
    files: ["vegetation-high.glb"],
    apply: (glb) => shrinkGlbImages(glb, { "vegetation-atlas-high": 1024 }),
  },
};

/** Problems with a file after its diet: what the steps that ran promise, read back from the file. Empty when it holds. */
export function checkDiet(name, glb, steps = Object.keys(STEPS)) {
  const problems = [];
  const ran = (s) => steps.includes(s) && STEPS[s].files.includes(name);
  if (ran("ao")) {
    for (const m of glb.json.materials ?? []) if (m.occlusionTexture && !AO_KEPT.test(m.name)) problems.push(`${name}: ${m.name} still has an AO map`);
    for (const mesh of glb.json.meshes) for (const p of mesh.primitives) {
      const sets = Object.keys(p.attributes).filter((a) => /^TEXCOORD_\d+$/.test(a)).map((a) => Number(a.slice(9))).sort((a, b) => a - b);
      if (sets.some((s, i) => s !== i)) problems.push(`${name}: ${mesh.name} has a gap in its TEXCOORD sets`);
    }
  }
  const sizes = imageSizes(glb);
  if (ran("atlas") && (sizes["atlas-base"]?.[0] !== 1024 || sizes["atlas-orm"]?.[0] !== 1024 || sizes["atlas-normal"]?.[0] !== 512)) problems.push(`${name}: atlas not at 1024/1024/512`);
  if (ran("vegetation") && sizes["vegetation-atlas-high"]?.[0] !== 1024) problems.push(`${name}: vegetation atlas not at 1024`);
  return problems;
}

/**
 * Where a file is read from: in the shipped folder, the file version-assets.mjs points at (or a fresh
 * stable-named output); in any other folder, the stable name itself.
 */
function source(dir, shipped, file) {
  if (dir === shipped.dir) return shippedPath(shipped.public + file);
  const path = join(dir, file);
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return path;
}

/** Runs the steps on the files in `dir`, writing stable names to `out` (default: the same folder). Returns one row per file and step. */
export function runDiet({ steps = Object.keys(STEPS), dir = MODELS_DIR, out = dir } = {}) {
  const rows = [];
  const files = [...new Set(steps.flatMap((s) => STEPS[s].files))];
  for (const file of files) {
    const path = source(dir, { dir: MODELS_DIR, public: "/sawad/models/" }, file);
    const before = readFileSync(path);
    let glb = parseGlb(before);
    for (const s of steps) {
      if (!STEPS[s].files.includes(file)) continue;
      const r = STEPS[s].apply(glb);
      rows.push({ file, step: s, row: STEPS[s].row, changed: r.changed });
      glb = { json: r.json, bin: r.bin };
    }
    const after = writeGlb(glb);
    writeFileSync(join(out, file), after);
    rows.push({ file, step: "total", bytes: { before: before.length, after: after.length }, problems: checkDiet(file, glb, steps) });
  }
  return rows;
}

/** Lightmap pages the first frame takes at half size (bakedLight.ts `bakedHalfPageUrl` names the file). */
export const HALF_PAGES = ["day-buildings-high.ktx2"];
export const halfName = (page) => page.replace(/\.ktx2$/, ".half.ktx2");

/** Writes each HALF_PAGES page's half-size level beside it (from `dir` into `out`). Returns one row per page. */
export function runHalfPages({ dir = LIGHTMAPS_DIR, out = dir } = {}) {
  return HALF_PAGES.map((page) => {
    const path = source(dir, { dir: LIGHTMAPS_DIR, public: "/sawad/lightmaps/zaitun/" }, page);
    const full = readFileSync(path);
    const half = dropTopMips(full, 1);
    writeFileSync(join(out, halfName(page)), half);
    const h = readKtx2(half);
    return { file: halfName(page), bytes: { full: full.length, half: half.length }, size: [h.width, h.height] };
  });
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const all = [...Object.keys(STEPS), "half"];
  const steps = flag("--steps")?.split(",") ?? all;
  for (const s of steps) if (!all.includes(s)) throw new Error(`unknown step ${s} (one of ${all.join(", ")})`);
  if (steps.includes("half")) {
    for (const r of runHalfPages({ out: flag("--out") ?? LIGHTMAPS_DIR })) console.log(`${r.file} (T36): ${r.size.join("x")}, ${(r.bytes.half / 1e6).toFixed(2)} MB (full page ${(r.bytes.full / 1e6).toFixed(2)} MB)`);
  }
  const glbSteps = steps.filter((s) => STEPS[s]);
  const rows = glbSteps.length ? runDiet({ steps: glbSteps, out: flag("--out") ?? MODELS_DIR }) : [];
  const problems = [];
  for (const r of rows) {
    if (r.step !== "total") console.log(`${r.file} ${r.step} (${r.row}): ${r.changed ? "applied" : "already on its diet"}`);
    else {
      console.log(`${r.file}: ${(r.bytes.before / 1e6).toFixed(2)} → ${(r.bytes.after / 1e6).toFixed(2)} MB`);
      problems.push(...r.problems);
    }
  }
  if (problems.length) {
    console.error(problems.map((p) => "  - " + p).join("\n"));
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
