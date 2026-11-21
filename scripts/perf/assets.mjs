#!/usr/bin/env node
/**
 * Asset report (optimization track P0). Every GLB in public/ broken down by mesh (vertices,
 * triangles, copies through EXT_mesh_gpu_instancing, geometry bytes) and by texture (format,
 * size in pixels, bytes), and every image, KTX2, audio, wasm and model file with its size on
 * disk and, for the types a host compresses, gzip -9 and brotli -11.
 *
 *   node scripts/perf/assets.mjs [--dir public]
 *
 * It reads files only, so it needs neither the server nor the measurement lock.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { REPO_DIR, fmtBytes, fmtNum, mdTable, parseArgs, saveResult } from "./lib.mjs";

/** Types a host would compress on the wire; images, audio and video are already compressed. */
export const COMPRESSIBLE = new Set([".glb", ".gltf", ".wasm", ".json", ".js", ".svg", ".ktx2", ".bin", ".txt", ".css"]);

export function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Width and height from a KTX2 header (pixelWidth at byte 20, pixelHeight at 24). */
export function ktx2Size(buf) {
  if (buf.length < 28 || buf.toString("latin1", 1, 7) !== "KTX 20") return null;
  return { width: buf.readUInt32LE(20), height: buf.readUInt32LE(24), levels: buf.readUInt32LE(40), supercompression: buf.readUInt32LE(44) };
}

/** Width and height from a PNG or JPEG header. */
export function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o < buf.length) {
      if (buf[o] !== 0xff) return null;
      const marker = buf[o + 1];
      const len = buf.readUInt16BE(o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: buf.readUInt16BE(o + 7), height: buf.readUInt16BE(o + 5) };
      o += 2 + len;
    }
  }
  return null;
}

async function glbReport(path) {
  const { NodeIO } = await import("@gltf-transform/core");
  const { ALL_EXTENSIONS } = await import("@gltf-transform/extensions");
  const { MeshoptDecoder } = await import("meshoptimizer");
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.read(path);
  const root = doc.getRoot();
  const copies = new Map();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const inst = node.getExtension("EXT_mesh_gpu_instancing");
    const n = inst ? (inst.listAttributes()[0]?.getCount() ?? 1) : 1;
    copies.set(mesh, (copies.get(mesh) ?? 0) + n);
  }
  const meshes = root.listMeshes().map((mesh) => {
    let vertices = 0;
    let triangles = 0;
    let bytes = 0;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      vertices += pos?.getCount() ?? 0;
      const idx = prim.getIndices();
      triangles += Math.floor((idx ? idx.getCount() : (pos?.getCount() ?? 0)) / 3);
      for (const a of [...prim.listAttributes(), ...(idx ? [idx] : [])]) bytes += a.getArray()?.byteLength ?? 0;
    }
    const n = copies.get(mesh) ?? 0;
    return { name: mesh.getName() || "(unnamed)", primitives: mesh.listPrimitives().length, vertices, triangles, copies: n, trianglesPlaced: triangles * n, decodedBytes: bytes };
  });
  const textures = root.listTextures().map((t) => {
    const image = t.getImage();
    const buf = image ? Buffer.from(image) : Buffer.alloc(0);
    const dims = t.getMimeType() === "image/ktx2" ? ktx2Size(buf) : imageSize(buf);
    return { name: t.getName() || t.getURI() || "(unnamed)", mime: t.getMimeType(), bytes: buf.length, width: dims?.width ?? null, height: dims?.height ?? null };
  });
  return {
    meshes: meshes.sort((a, b) => b.decodedBytes - a.decodedBytes),
    textures: textures.sort((a, b) => b.bytes - a.bytes),
    totals: {
      meshes: meshes.length,
      triangles: meshes.reduce((a, m) => a + m.triangles, 0),
      trianglesPlaced: meshes.reduce((a, m) => a + m.trianglesPlaced, 0),
      geometryDecodedBytes: meshes.reduce((a, m) => a + m.decodedBytes, 0),
      textureBytes: textures.reduce((a, t) => a + t.bytes, 0),
      materials: root.listMaterials().length,
      extensions: root.listExtensionsUsed().map((e) => e.extensionName),
    },
  };
}

export async function run({ outDir, args = {} }) {
  const dir = join(REPO_DIR, args.dir ?? "public");
  const files = [];
  for (const path of walk(dir)) {
    const ext = extname(path).toLowerCase();
    const buf = readFileSync(path);
    const row = { file: relative(dir, path), ext, raw: buf.length };
    if (COMPRESSIBLE.has(ext)) {
      row.gzip = gzipSync(buf, { level: 9 }).length;
      row.brotli = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length;
    }
    if (ext === ".ktx2") Object.assign(row, ktx2Size(buf) ?? {});
    if (ext === ".png" || ext === ".jpg" || ext === ".jpeg") Object.assign(row, imageSize(buf) ?? {});
    files.push(row);
  }
  files.sort((a, b) => b.raw - a.raw);
  const glbs = {};
  for (const f of files.filter((x) => x.ext === ".glb")) {
    glbs[f.file] = await glbReport(join(dir, f.file));
    const t = glbs[f.file].totals;
    console.log(`[assets] ${f.file}: ${fmtBytes(f.raw)}, ${t.meshes} meshes, ${fmtNum(t.triangles)} triangles (${fmtNum(t.trianglesPlaced)} placed), geometry ${fmtBytes(t.geometryDecodedBytes)} decoded, textures ${fmtBytes(t.textureBytes)}`);
  }
  const byType = {};
  for (const f of files) byType[f.ext] = (byType[f.ext] ?? 0) + f.raw;
  const result = { takenAt: new Date().toISOString(), dir: relative(REPO_DIR, dir), totalBytes: files.reduce((a, f) => a + f.raw, 0), byType, files, glbs };
  const file = saveResult("assets", result, outDir);
  console.log("\n" + filesTable(files.slice(0, 30)));
  console.log(`[assets] ${file}`);
  return result;
}

export function filesTable(files) {
  return mdTable(files, [
    ["File", (r) => r.file],
    ["Size", (r) => fmtBytes(r.raw)],
    ["gzip", (r) => (r.gzip ? fmtBytes(r.gzip) : "–")],
    ["brotli", (r) => (r.brotli ? fmtBytes(r.brotli) : "–")],
    ["Pixels", (r) => (r.width ? `${r.width}×${r.height}` : "")],
  ]);
}

export function meshTable(meshes) {
  return mdTable(meshes, [
    ["Mesh", (r) => r.name],
    ["Triangles", (r) => fmtNum(r.triangles)],
    ["Copies", (r) => fmtNum(r.copies)],
    ["Triangles placed", (r) => fmtNum(r.trianglesPlaced)],
    ["Geometry (decoded)", (r) => fmtBytes(r.decodedBytes)],
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { outDirFor } = await import("./rig.mjs");
  await run({ outDir: outDirFor("assets"), args });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
