#!/usr/bin/env node
/**
 * Where a GLB's bytes go (optimization search track S3). Reads the file's JSON and binary chunk
 * directly, so the numbers are what is on disk and on the wire, not what the decoder expands to:
 *
 * - per mesh: compressed bytes (meshopt bitstream as stored), decoded bytes, brotli of the stored
 *   bytes, vertices, triangles, placed copies;
 * - per attribute semantic (POSITION, NORMAL, TEXCOORD_n, COLOR_0, indices, instancing...);
 * - per image: bytes, which materials use it and in which slot.
 *
 *   node scripts/perf/S3/glb-cost.mjs public/sawad/models/compound-zaitun-high.glb [...more] [--json out.json]
 *
 * Reads files only: no server, no measurement lock.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

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

/** The bytes a buffer view occupies in the file: the meshopt stream when compressed, else the view. */
export function storedView(json, i) {
  const v = json.bufferViews[i];
  const m = v.extensions?.EXT_meshopt_compression;
  if (m) return { buffer: m.buffer, byteOffset: m.byteOffset ?? 0, byteLength: m.byteLength, decoded: v.byteLength, meshopt: `${m.mode}/${m.filter ?? "NONE"}` };
  return { buffer: v.buffer, byteOffset: v.byteOffset ?? 0, byteLength: v.byteLength, decoded: v.byteLength, meshopt: null };
}

const brotli = (b) => (b.length ? brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length : 0);

/** Which buffer view each piece of the file belongs to, and who uses it. */
export function viewOwners(json) {
  const owners = new Map(); // view -> [{ mesh, semantic }]
  const add = (accessor, mesh, semantic) => {
    const a = json.accessors?.[accessor];
    if (a?.bufferView === undefined) return;
    const list = owners.get(a.bufferView) ?? [];
    list.push({ mesh, semantic });
    owners.set(a.bufferView, list);
  };
  (json.meshes ?? []).forEach((mesh, mi) => {
    for (const p of mesh.primitives) {
      for (const [sem, acc] of Object.entries(p.attributes)) add(acc, mi, sem);
      if (p.indices !== undefined) add(p.indices, mi, "indices");
      for (const t of p.targets ?? []) for (const [sem, acc] of Object.entries(t)) add(acc, mi, `morph:${sem}`);
    }
  });
  for (const node of json.nodes ?? []) {
    const inst = node.extensions?.EXT_mesh_gpu_instancing;
    if (inst) for (const [sem, acc] of Object.entries(inst.attributes)) add(acc, node.mesh ?? -1, `instance:${sem}`);
  }
  for (const anim of json.animations ?? []) for (const s of anim.samplers) {
    add(s.input, -1, "animation");
    add(s.output, -1, "animation");
  }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) add(skin.inverseBindMatrices, -1, "skin");
  (json.images ?? []).forEach((img, ii) => {
    if (img.bufferView === undefined) return;
    const list = owners.get(img.bufferView) ?? [];
    list.push({ image: ii });
    owners.set(img.bufferView, list);
  });
  return owners;
}

/** Texture slots per image: [{ material, slot }]. Handles KHR_texture_basisu sources. */
export function imageUses(json) {
  const uses = new Map();
  const texImage = (ti) => {
    const t = json.textures?.[ti];
    return t?.extensions?.KHR_texture_basisu?.source ?? t?.extensions?.EXT_texture_webp?.source ?? t?.source;
  };
  const note = (info, material, slot) => {
    if (!info) return;
    const img = texImage(info.index);
    if (img === undefined) return;
    const list = uses.get(img) ?? [];
    list.push({ material, slot, texCoord: info.texCoord ?? 0 });
    uses.set(img, list);
  };
  for (const m of json.materials ?? []) {
    const pbr = m.pbrMetallicRoughness ?? {};
    note(pbr.baseColorTexture, m.name, "base");
    note(pbr.metallicRoughnessTexture, m.name, "orm");
    note(m.normalTexture, m.name, "normal");
    note(m.occlusionTexture, m.name, "occlusion");
    note(m.emissiveTexture, m.name, "emissive");
  }
  return uses;
}

/** The full cost report of one GLB buffer. */
export function glbCost(buf, name = "model.glb") {
  const { json, bin } = parseGlb(buf);
  const owners = viewOwners(json);
  const copies = new Map();
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const inst = node.extensions?.EXT_mesh_gpu_instancing;
    const n = inst ? (json.accessors[Object.values(inst.attributes)[0]]?.count ?? 1) : 1;
    copies.set(node.mesh, (copies.get(node.mesh) ?? 0) + n);
  }
  const meshes = (json.meshes ?? []).map((m, i) => {
    let vertices = 0;
    let triangles = 0;
    const materials = new Set();
    for (const p of m.primitives) {
      vertices += json.accessors[p.attributes.POSITION]?.count ?? 0;
      triangles += Math.floor((p.indices !== undefined ? json.accessors[p.indices].count : (json.accessors[p.attributes.POSITION]?.count ?? 0)) / 3);
      if (p.material !== undefined) materials.add(json.materials[p.material]?.name ?? `#${p.material}`);
    }
    return { name: m.name ?? `mesh-${i}`, vertices, triangles, copies: copies.get(i) ?? 0, materials: [...materials], stored: 0, decoded: 0, brotli: 0, chunks: [] };
  });
  const semantics = new Map();
  const images = [];
  const other = { stored: 0, brotli: 0 };
  const uses = imageUses(json);
  json.bufferViews.forEach((_, vi) => {
    const s = storedView(json, vi);
    if (s.buffer !== 0 && !bin) return;
    // Only bytes that really sit in the BIN chunk count (meshopt fallback buffers have no data).
    const fallback = json.buffers?.[s.buffer]?.extensions?.EXT_meshopt_compression?.fallback;
    if (fallback) return;
    const bytes = bin.subarray(s.byteOffset, s.byteOffset + s.byteLength);
    const list = owners.get(vi) ?? [];
    const br = brotli(bytes);
    if (!list.length) {
      other.stored += s.byteLength;
      other.brotli += br;
      return;
    }
    const share = 1 / list.length;
    for (const o of list) {
      if (o.image !== undefined) {
        const img = json.images[o.image];
        images.push({ index: o.image, name: img.name ?? `image-${o.image}`, mimeType: img.mimeType, stored: s.byteLength, brotli: br, uses: uses.get(o.image) ?? [] });
        continue;
      }
      const key = o.semantic.replace(/^morph:.*/, "morph");
      const sem = semantics.get(key) ?? { stored: 0, decoded: 0, brotli: 0 };
      sem.stored += s.byteLength * share;
      sem.decoded += s.decoded * share;
      sem.brotli += br * share;
      semantics.set(key, sem);
      if (o.mesh >= 0) {
        const m = meshes[o.mesh];
        m.stored += s.byteLength * share;
        m.decoded += s.decoded * share;
        m.brotli += br * share;
        m.chunks.push({ semantic: o.semantic, stored: s.byteLength * share, meshopt: s.meshopt });
      } else {
        other.stored += s.byteLength * share;
        other.brotli += br * share;
      }
    }
  });
  for (const m of meshes) delete m.chunks;
  const jsonBytes = buf.readUInt32LE(12);
  return {
    file: name,
    bytes: buf.length,
    brotli: brotli(buf),
    jsonBytes,
    extensionsUsed: json.extensionsUsed ?? [],
    geometry: { stored: meshes.reduce((a, m) => a + m.stored, 0), brotli: meshes.reduce((a, m) => a + m.brotli, 0) },
    imagesTotal: { stored: images.reduce((a, i) => a + i.stored, 0), brotli: images.reduce((a, i) => a + i.brotli, 0) },
    other,
    meshes: meshes.sort((a, b) => b.stored - a.stored),
    semantics: Object.fromEntries([...semantics.entries()].sort((a, b) => b[1].stored - a[1].stored)),
    images: images.sort((a, b) => b.stored - a.stored),
  };
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

export function costMarkdown(r) {
  const out = [];
  out.push(`### ${r.file}: ${kb(r.bytes)} (brotli ${kb(r.brotli)})`);
  out.push("");
  out.push(`Geometry ${kb(r.geometry.stored)} stored / ${kb(r.geometry.brotli)} brotli; images ${kb(r.imagesTotal.stored)}; JSON ${kb(r.jsonBytes)}; other ${kb(r.other.stored)}.`);
  out.push("");
  out.push("| Mesh | Vertices | Triangles | Copies | Stored | Brotli | Materials |");
  out.push("|---|---|---|---|---|---|---|");
  for (const m of r.meshes) out.push(`| ${m.name} | ${m.vertices} | ${m.triangles} | ${m.copies} | ${kb(m.stored)} | ${kb(m.brotli)} | ${m.materials.join(", ")} |`);
  out.push("");
  out.push("| Attribute | Stored | Decoded | Brotli |");
  out.push("|---|---|---|---|");
  for (const [k, s] of Object.entries(r.semantics)) out.push(`| ${k} | ${kb(s.stored)} | ${kb(s.decoded)} | ${kb(s.brotli)} |`);
  out.push("");
  out.push("| Image | Type | Stored | Used as |");
  out.push("|---|---|---|---|");
  for (const i of r.images) out.push(`| ${i.name} | ${i.mimeType} | ${kb(i.stored)} | ${i.uses.map((u) => `${u.material}:${u.slot}${u.texCoord ? `@uv${u.texCoord}` : ""}`).join(", ")} |`);
  return out.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const jsonAt = args.indexOf("--json");
  const outPath = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
  const reports = args.map((p) => glbCost(readFileSync(p), basename(p)));
  for (const r of reports) console.log(costMarkdown(r) + "\n");
  if (outPath) writeFileSync(outPath, JSON.stringify(reports, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
