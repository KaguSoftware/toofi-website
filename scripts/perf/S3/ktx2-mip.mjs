#!/usr/bin/env node
/**
 * Drops the top mip level(s) of a Basis Universal KTX2 texture without re-encoding (S3 experiments).
 * The result is exactly what the GPU already shows one level down, at half the width and height,
 * so a look test of "this texture at half size" measures size alone, with no encoder noise.
 * Works for ETC1S (BasisLZ, per-level image descriptors in the global data) and UASTC (zstd or none).
 *
 *   node scripts/perf/S3/ktx2-mip.mjs in.ktx2 out.ktx2 [--drop 1]
 *   node scripts/perf/S3/ktx2-mip.mjs --glb in.glb out.glb --image atlas-normal [--image ...] [--drop 1]
 *
 * An experiment tool: product textures come from scripts/blender/export-final.sh.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseGlb } from "./glb-cost.mjs";
import { writeGlb } from "./strip-glb.mjs";

const HEADER = 80;
const LEVEL_ENTRY = 24;

/** Header fields of a KTX2 buffer. */
export function readKtx2(buf) {
  if (buf.toString("latin1", 1, 7) !== "KTX 20") throw new Error("not a KTX2 file");
  const u32 = (o) => buf.readUInt32LE(o);
  const u64 = (o) => Number(buf.readBigUInt64LE(o));
  const levelCount = u32(40);
  const levels = [];
  for (let i = 0; i < Math.max(1, levelCount); i++) {
    const o = HEADER + i * LEVEL_ENTRY;
    levels.push({ offset: u64(o), length: u64(o + 8), uncompressed: u64(o + 16) });
  }
  return {
    vkFormat: u32(12), typeSize: u32(16), width: u32(20), height: u32(24), depth: u32(28),
    layers: u32(32), faces: u32(36), levelCount, supercompression: u32(44),
    dfdOffset: u32(48), dfdLength: u32(52), kvdOffset: u32(56), kvdLength: u32(60),
    sgdOffset: u64(64), sgdLength: u64(72), levels,
  };
}

/** A new KTX2 buffer without the top `drop` levels. */
export function dropTopMips(buf, drop = 1) {
  const h = readKtx2(buf);
  if (drop < 1) return Buffer.from(buf);
  if (h.levelCount <= drop) throw new Error(`only ${h.levelCount} levels, cannot drop ${drop}`);
  const images = Math.max(1, h.layers) * h.faces; // image descriptors per level (depth is 0 for 2D)
  const keep = h.levels.slice(drop);
  const levelCount = h.levelCount - drop;
  const dfd = buf.subarray(h.dfdOffset, h.dfdOffset + h.dfdLength);
  const kvd = buf.subarray(h.kvdOffset, h.kvdOffset + h.kvdLength);
  let sgd = buf.subarray(h.sgdOffset, h.sgdOffset + h.sgdLength);
  if (h.supercompression === 1) {
    // BasisLZ global data: 20 bytes of counts and lengths, then one 20-byte descriptor per image of every level.
    const descBytes = 20 * images * drop;
    sgd = Buffer.concat([sgd.subarray(0, 20), sgd.subarray(20 + descBytes)]);
  }
  const out = [];
  const indexEnd = HEADER + levelCount * LEVEL_ENTRY;
  let o = indexEnd;
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
  // Mip data in the order the input stored it (smallest first, as KTX2 recommends).
  const alignment = h.supercompression ? 1 : 16; // 16 covers the 4-byte rule and BC/ASTC blocks
  const order = keep.map((l, i) => ({ ...l, i })).sort((a, b) => a.offset - b.offset);
  const placed = new Array(levelCount);
  for (const l of order) {
    o = Math.ceil(o / alignment) * alignment;
    placed[l.i] = { offset: o, length: l.length, uncompressed: l.uncompressed, src: l.offset };
    o += l.length;
  }
  const res = Buffer.alloc(o);
  buf.copy(res, 0, 0, HEADER);
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
    const e = HEADER + i * LEVEL_ENTRY;
    res.writeBigUInt64LE(BigInt(p.offset), e);
    res.writeBigUInt64LE(BigInt(p.length), e + 8);
    res.writeBigUInt64LE(BigInt(p.uncompressed), e + 16);
    buf.copy(res, p.offset, p.src, p.src + p.length);
  });
  dfd.copy(res, dfdOffset);
  kvd.copy(res, kvdOffset);
  sgd.copy(res, sgdOffset);
  out.push(res);
  return res;
}

/** Replaces named KTX2 images inside a parsed GLB with their dropped-mip versions; repacks the binary chunk. */
export function dropGlbImageMips({ json: src, bin }, names, drop = 1) {
  const json = structuredClone(src);
  const replace = new Map();
  json.images.forEach((im, i) => {
    if (names.includes(im.name) && im.bufferView !== undefined) {
      const v = json.bufferViews[im.bufferView];
      replace.set(im.bufferView, dropTopMips(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength), drop));
    }
  });
  const missing = names.filter((n) => !json.images.some((im) => im.name === n));
  if (missing.length) throw new Error(`no image named ${missing.join(", ")}`);
  const parts = [];
  let o = 0;
  json.bufferViews.forEach((v, i) => {
    const mo = v.extensions?.EXT_meshopt_compression;
    const take = (holder, bytes) => {
      o = (o + 3) & ~3;
      parts.push({ o, bytes });
      holder.byteOffset = o;
      holder.byteLength = bytes.length;
      o += bytes.length;
    };
    if (mo && mo.buffer === 0) {
      const b = bin.subarray(mo.byteOffset ?? 0, (mo.byteOffset ?? 0) + mo.byteLength);
      o = (o + 3) & ~3;
      parts.push({ o, bytes: b });
      mo.byteOffset = o;
      o += b.length;
    }
    if (v.buffer === 0) take(v, replace.get(i) ?? bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
  });
  const nb = Buffer.alloc((o + 3) & ~3);
  for (const p of parts) p.bytes.copy(nb, p.o);
  json.buffers[0].byteLength = nb.length;
  return { json, bin: nb };
}

function main() {
  const args = process.argv.slice(2);
  let drop = 1;
  const images = [];
  const files = [];
  let glb = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--drop") drop = Number(args[++i]);
    else if (args[i] === "--image") images.push(args[++i]);
    else if (args[i] === "--glb") glb = true;
    else files.push(args[i]);
  }
  const [input, output] = files;
  const before = readFileSync(input);
  const after = glb ? writeGlb(dropGlbImageMips(parseGlb(before), images, drop)) : dropTopMips(before, drop);
  writeFileSync(output, after);
  console.log(`${input}: ${before.length} -> ${after.length} bytes`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
