#!/usr/bin/env node
/**
 * Builds the Zaitun far set (optimization track F2A): the whole site at far-view detail, which the
 * first frame waits for instead of the full model (docs/zaitun/perf/F2A.md).
 *
 *   node scripts/blender/far/far-set.mjs        (run by scripts/blender/export-far.sh)
 *
 * The geometry is simplified straight from the shipped full GLB, in its quantized space: a
 * simplifier only removes vertices, so every kept vertex keeps its exact quantized value, and the
 * nodes, instance transforms and quantization frames are never touched. The vertices that set a
 * primitive's bounding box and bounding sphere are locked, so both stay the full primitive's too.
 * That is what lets compoundModel.ts swap each mesh's geometry and textures in place when the full
 * file arrives: same transforms, same culling spheres, same material slots, nothing recompiled.
 * The textures come from scripts/blender/out/far-<tier>.textures.glb (export-far.sh), matched to the
 * full file's by name.
 *
 * Writes public/sawad/models/compound-zaitun-far-<tier>.glb and public/sawad/models/zaitun-far.json.
 * Exits 1 when a far file does not match its full file's structure.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STEPS, parseGlb, writeGlb } from "../diet.mjs";
import { shippedPath } from "../version-assets.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
export const MODELS_DIR = here("../../../public/sawad/models/");
export const OUT_DIR = here("../out/");
export const REPORT_PATH = MODELS_DIR + "zaitun-far.json";

export const TIERS = ["high", "low"];
export const fullFile = (tier) => `compound-zaitun-${tier}.glb`;
export const farFile = (tier) => `compound-zaitun-far-${tier}.glb`;
export const texturesFile = (tier) => `far-${tier}.textures.glb`;

/**
 * How each tier is simplified. `error`: how far a simplified surface may move from the modelled one,
 * in metres (the nearest building in a far view, the opening's gate, is about 60 m off). The model is
 * faceted: nearly every quad has its own trim-sheet UVs, so a simplifier that keeps every attribute
 * seam can remove almost nothing. `permissive` lets it collapse across seams; `weights` then price a
 * change of each vertex attribute in metres per unit (trim-sheet UV0, AO UV1, lightmap UV2, normal),
 * so a collapse that would smear an attribute costs as much as moving the surface.
 */
const FAR_PRECISION = { TEXCOORD_0: 0.0005, TEXCOORD_2: 0.00025, flatBakedAoUv: true };
/**
 * The amenity courts (parking, playground, tennis) carry no fine high-contrast detail, so their
 * seams may collapse, priced by the lightmap UVs and normals. Buildings, the site and the carports
 * keep every seam: across one, a window reveal smears onto its wall (look gate, docs/zaitun/perf/F2A.md).
 */
const COURTS = ["^amenity-(parking|playground|tennis)", { permissive: true, weights: { TEXCOORD_2: 1, NORMAL: 0.02 } }];
export const FAR_SETTINGS = {
  high: { error: 0.05, permissive: false, weights: {}, precision: FAR_PRECISION, byMesh: [COURTS] },
  low: { error: 0.08, permissive: false, weights: {}, precision: FAR_PRECISION, byMesh: [COURTS] },
};

/**
 * The centre of the brightest texel of a grey image after box-averaging it down to `size` x `size`
 * (the far-view AO map's size), as glTF UV (origin top left). `grey` is width x height values 0..255.
 */
export function brightestTexel(grey, width, height, size) {
  const sums = new Float64Array(size * size);
  const counts = new Uint32Array(size * size);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const k = Math.min(size - 1, Math.floor((y * size) / height)) * size + Math.min(size - 1, Math.floor((x * size) / width));
    sums[k] += grey[y * width + x];
    counts[k] += 1;
  }
  let best = 0;
  for (let k = 1; k < sums.length; k++) if (sums[k] / counts[k] > sums[best] / counts[best]) best = k;
  return { u: ((best % size) + 0.5) / size, v: (Math.floor(best / size) + 0.5) / size, value: sums[best] / counts[best] };
}

/**
 * Rounds stored integer components to a coarser step (keeps the low bits zero, which the meshopt
 * codec stores in fewer bits). `step` is in stored units; values stay inside the attribute's own
 * stored range, so its bounds never grow.
 */
export function roundStored(array, elementSize, size, step) {
  if (!(step > 1)) return array;
  const out = array.slice();
  const count = array.length / elementSize;
  const lo = new Array(size).fill(Infinity);
  const hi = new Array(size).fill(-Infinity);
  for (let i = 0; i < count; i++) for (let c = 0; c < size; c++) {
    lo[c] = Math.min(lo[c], array[i * elementSize + c]);
    hi[c] = Math.max(hi[c], array[i * elementSize + c]);
  }
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < size; c++) {
      const k = i * elementSize + c;
      out[k] = Math.min(hi[c], Math.max(lo[c], Math.round(array[k] / step) * step));
    }
  }
  return out;
}
/**
 * A tier's settings for one mesh: `byMesh` lists overrides as [regular expression on the mesh name,
 * settings]; the first match is merged over the tier's own.
 */
export function settingsFor(tier, meshName) {
  const hit = (tier.byMesh ?? []).find(([pattern]) => new RegExp(pattern).test(meshName));
  return hit ? { ...tier, ...hit[1] } : tier;
}

/** Vertex attributes the simplifier can price, with how many components it reads of each. */
export const PRICED = { TEXCOORD_0: 2, TEXCOORD_1: 2, TEXCOORD_2: 2, NORMAL: 3 };

/**
 * Byte budgets, just above what the far set measures (F2A.md). It is what the first frame waits for,
 * so it decides most of the 5 MB (desktop) and 3 MB (phone) transfer targets in OPTIMIZATION_PLAN.md.
 */
export const FAR_BUDGET = { high: 4_800_000, low: 2_800_000 };

// glTF component types.
const BYTE = 5120;
const UNSIGNED_BYTE = 5121;
const SHORT = 5122;
const UNSIGNED_SHORT = 5123;

/** Turns a stored component into its value (KHR_mesh_quantization normalized integers, or floats). */
export function dequantizer(componentType, normalized) {
  if (!normalized) return (v) => v;
  switch (componentType) {
    case BYTE:
      return (v) => Math.max(v / 127, -1);
    case UNSIGNED_BYTE:
      return (v) => v / 255;
    case SHORT:
      return (v) => Math.max(v / 32767, -1);
    case UNSIGNED_SHORT:
      return (v) => v / 65535;
    default:
      return (v) => v;
  }
}

/** The first `size` components of every element as floats (stride = the accessor's element size). */
export function toFloats(array, elementSize, size, decode) {
  const count = array.length / elementSize;
  const out = new Float32Array(count * size);
  for (let i = 0; i < count; i++) for (let c = 0; c < size; c++) out[i * size + c] = decode(array[i * elementSize + c]);
  return out;
}

/**
 * The vertices that set the bounding box and the bounding sphere as three.js computes them (over
 * every vertex in the buffer, the sphere centred on the box): the lowest and highest on each axis,
 * and the farthest from the box's centre. Locked, and kept in the buffer (`anchor`), they keep both.
 */
export function boundsLock(positions) {
  const count = positions.length / 3;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const loAt = [-1, -1, -1];
  const hiAt = [-1, -1, -1];
  for (let i = 0; i < count; i++) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i * 3 + a];
      if (v < lo[a]) [lo[a], loAt[a]] = [v, i];
      if (v > hi[a]) [hi[a], hiAt[a]] = [v, i];
    }
  }
  const lock = new Uint8Array(count);
  for (const i of [...loAt, ...hiAt]) if (i >= 0) lock[i] = 1;
  const centre = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2);
  let far = -1;
  let farD = -1;
  for (let i = 0; i < count; i++) {
    const d = (positions[i * 3] - centre[0]) ** 2 + (positions[i * 3 + 1] - centre[1]) ** 2 + (positions[i * 3 + 2] - centre[2]) ** 2;
    if (d > farD) [far, farD] = [i, d];
  }
  if (far >= 0) lock[far] = 1;
  return lock;
}

/**
 * Keeps every locked vertex in the mesh: one the simplified triangles no longer use gets a
 * zero-area triangle of its own (the GPU draws nothing for it), so compaction and reordering keep it.
 */
export function anchor(indices, lock) {
  const used = new Uint8Array(lock.length);
  for (const i of indices) used[i] = 1;
  const extra = [];
  for (let i = 0; i < lock.length; i++) if (lock[i] && !used[i]) extra.push(i, i, i);
  if (!extra.length) return indices;
  const out = new Uint32Array(indices.length + extra.length);
  out.set(indices);
  out.set(extra, indices.length);
  return out;
}

/** Box and sphere as three.js computes them: over every vertex, the sphere centred on the box. */
export function bounds(positions) {
  const count = positions.length / 3;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) for (let a = 0; a < 3; a++) {
    lo[a] = Math.min(lo[a], positions[i * 3 + a]);
    hi[a] = Math.max(hi[a], positions[i * 3 + a]);
  }
  const centre = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2);
  let r2 = 0;
  for (let i = 0; i < count; i++) r2 = Math.max(r2, (positions[i * 3] - centre[0]) ** 2 + (positions[i * 3 + 1] - centre[1]) ** 2 + (positions[i * 3 + 2] - centre[2]) ** 2);
  return { min: lo, max: hi, radius: Math.sqrt(r2) };
}

/** Keeps only the vertices the new indices use, in first-use order. Returns the old index of each kept vertex and the remapped indices. */
export function compact(indices) {
  const remap = new Map();
  const order = [];
  const out = new Uint32Array(indices.length);
  for (let k = 0; k < indices.length; k++) {
    const old = indices[k];
    let next = remap.get(old);
    if (next === undefined) {
      next = order.length;
      remap.set(old, next);
      order.push(old);
    }
    out[k] = next;
  }
  return { order: Uint32Array.from(order), indices: out };
}

/** Copies the listed elements of a typed array (elementSize components each) into a new array of the same type. */
export function gather(array, elementSize, order) {
  const out = new array.constructor(order.length * elementSize);
  for (let k = 0; k < order.length; k++) out.set(array.subarray(order[k] * elementSize, (order[k] + 1) * elementSize), k * elementSize);
  return out;
}

/** Largest axis scale of a column-major 4x4 matrix. */
export function matrixScale(m) {
  const col = (c) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]);
  return Math.max(col(0), col(1), col(2));
}

/** The error budget in the mesh's own (quantized) units: metres over the scale that turns them into metres. */
export function localError(metres, scale) {
  if (!(scale > 0)) throw new Error(`bad scale ${scale}`);
  return metres / scale;
}

/**
 * Interleaves the priced attributes for the simplifier: `parts` maps a semantic to its floats
 * (PRICED[semantic] per vertex) and `weights` to its price. Unpriced or missing ones are left out.
 * Returns one zero-weight column when nothing is priced (the simplifier needs at least one).
 */
export function pricedAttributes(parts, weights, count) {
  const used = Object.keys(PRICED).filter((sem) => parts[sem] && weights[sem] > 0);
  const stride = used.reduce((n, sem) => n + PRICED[sem], 0);
  if (stride === 0) return { data: new Float32Array(count), stride: 1, weights: [0] };
  const data = new Float32Array(count * stride);
  const w = [];
  let off = 0;
  for (const sem of used) {
    const size = PRICED[sem];
    for (let i = 0; i < count; i++) for (let c = 0; c < size; c++) data[i * stride + off + c] = parts[sem][i * size + c];
    for (let c = 0; c < size; c++) w.push(weights[sem]);
    off += size;
  }
  return { data, stride, weights: w };
}

/**
 * The checks that make the in-place swap safe, on two documents' summaries (see `summarize`):
 * same nodes and transforms, same instances, same primitives with the same materials and vertex
 * attributes, the same bounding box and sphere per primitive, the same material texture slots and
 * the same texture names. Returns a list of problems, empty when the far file can stand in.
 */
export function compareStructure(full, far, tolerance = 1e-6) {
  const problems = [];
  const near = (a, b) => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
  const sameList = (a, b) => a.length === b.length && a.every((v, i) => near(v, b[i]));
  if (full.nodes.length !== far.nodes.length) problems.push(`${far.nodes.length} nodes, full file has ${full.nodes.length}`);
  full.nodes.forEach((n, i) => {
    const f = far.nodes[i];
    if (!f) return;
    if (n.name !== f.name || n.mesh !== f.mesh) problems.push(`node ${i}: ${f.name}/${f.mesh}, full file has ${n.name}/${n.mesh}`);
    if (!sameList(n.matrix, f.matrix)) problems.push(`node ${i} (${n.mesh}): transform differs`);
    if (n.instances !== f.instances) problems.push(`node ${i} (${n.mesh}): ${f.instances} instances, full file has ${n.instances}`);
    else if (!sameList(n.instanceData, f.instanceData)) problems.push(`node ${i} (${n.mesh}): instance transforms differ`);
  });
  if (full.primitives.length !== far.primitives.length) problems.push(`${far.primitives.length} primitives, full file has ${full.primitives.length}`);
  full.primitives.forEach((p, i) => {
    const f = far.primitives[i];
    if (!f) return;
    const at = `${p.mesh}[${p.index}]`;
    if (p.mesh !== f.mesh || p.material !== f.material) problems.push(`${at}: ${f.mesh}/${f.material}, full file has ${p.mesh}/${p.material}`);
    if (p.attributes.join() !== f.attributes.join()) problems.push(`${at}: attributes ${f.attributes.join()}, full file has ${p.attributes.join()}`);
    if (!sameList(p.min, f.min) || !sameList(p.max, f.max)) problems.push(`${at}: bounding box differs`);
    if (!near(p.radius, f.radius)) problems.push(`${at}: bounding sphere ${f.radius}, full file has ${p.radius}`);
    if (f.triangles > p.triangles) problems.push(`${at}: ${f.triangles} triangles, more than the full file's ${p.triangles}`);
  });
  if (full.materials.join("|") !== far.materials.join("|")) problems.push("materials or their texture slots differ");
  if (full.textures.join() !== far.textures.join()) problems.push(`textures ${far.textures.join()}, full file has ${full.textures.join()}`);
  return problems;
}

// ------------------------------------------------------------------ build (needs ./node_modules)

async function tools() {
  const [{ NodeIO, PropertyType }, { ALL_EXTENSIONS, EXTMeshoptCompression }, { prune, reorder }, { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier }] = await Promise.all([
    import("@gltf-transform/core"),
    import("@gltf-transform/extensions"),
    import("@gltf-transform/functions"),
    import("meshoptimizer"),
  ]);
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
  return { io, PropertyType, EXTMeshoptCompression, prune, reorder, MeshoptEncoder, MeshoptSimplifier };
}

const floatsOf = (accessor, size = accessor.getElementSize()) =>
  toFloats(accessor.getArray(), accessor.getElementSize(), size, dequantizer(accessor.getComponentType(), accessor.getNormalized()));

/** The scale that turns a mesh's stored units into metres: its node's world scale times its first instance's scale. */
function meshScale(mesh) {
  const node = mesh.listParents().find((p) => p.propertyType === "Node");
  if (!node) throw new Error(`${mesh.getName()}: no node uses it`);
  let scale = matrixScale(node.getWorldMatrix());
  const gpu = node.getExtension("EXT_mesh_gpu_instancing");
  const s = gpu?.getAttribute("SCALE");
  if (s) scale *= Math.max(...s.getElement(0, []));
  return scale;
}

/** What `compareStructure` compares, read from a document. */
export function summarize(doc) {
  const root = doc.getRoot();
  const nodes = root.listNodes().map((n) => {
    const gpu = n.getExtension("EXT_mesh_gpu_instancing");
    const instanceData = gpu ? gpu.listSemantics().sort().flatMap((sem) => Array.from(gpu.getAttribute(sem).getArray())) : [];
    return { name: n.getName(), mesh: n.getMesh()?.getName() ?? null, matrix: Array.from(n.getMatrix()), instances: gpu ? gpu.getAttribute("TRANSLATION")?.getCount() ?? 0 : 0, instanceData };
  });
  const primitives = root.listMeshes().flatMap((m) =>
    m.listPrimitives().map((p, index) => {
      const pos = p.getAttribute("POSITION");
      const b = bounds(floatsOf(pos, 3));
      return { mesh: m.getName(), index, material: p.getMaterial()?.getName() ?? null, attributes: p.listSemantics().sort(), triangles: p.getIndices().getCount() / 3, ...b };
    }),
  );
  const slot = (t) => (t ? t.getName() : "-");
  const materials = root.listMaterials().map((m) => [m.getName(), slot(m.getBaseColorTexture()), slot(m.getNormalTexture()), slot(m.getOcclusionTexture()), slot(m.getMetallicRoughnessTexture()), slot(m.getEmissiveTexture())].join(":"));
  const textures = root.listTextures().map((t) => t.getName());
  return { nodes, primitives, materials, textures };
}

/** Placed triangles: each mesh's triangles times the copies its nodes place. */
function placedTriangles(summary) {
  const copies = {};
  for (const n of summary.nodes) if (n.mesh) copies[n.mesh] = (copies[n.mesh] ?? 0) + Math.max(1, n.instances);
  return summary.primitives.reduce((sum, p) => sum + p.triangles * (copies[p.mesh] ?? 0), 0);
}

/** The brightest far-view texel of each AO map, read from the raw masters (PNG) in scripts/blender/out. */
async function aoBrightSpots(t, tier, farTextures) {
  const { PNG } = (await import("pngjs")).default;
  const raw = await t.io.read(OUT_DIR + `compound-zaitun-${tier}.lit.raw.glb`);
  const spots = new Map();
  for (const texture of raw.getRoot().listTextures()) {
    const name = texture.getName();
    const far = farTextures.get(name);
    if (!/^ao-/.test(name) || !far) continue;
    const img = PNG.sync.read(Buffer.from(texture.getImage()));
    const grey = new Uint8Array(img.width * img.height);
    for (let i = 0; i < grey.length; i++) grey[i] = img.data[i * 4];
    const size = Buffer.from(far.getImage()).readUInt32LE(20); // the far KTX2's width
    spots.set(name, brightestTexel(grey, img.width, img.height, size));
  }
  return spots;
}

async function buildTier(t, tier, tierSettings = FAR_SETTINGS[tier], dest = MODELS_DIR + farFile(tier)) {
  const settings = tierSettings;
  const { io, PropertyType, EXTMeshoptCompression, prune, reorder, MeshoptEncoder, MeshoptSimplifier } = t;
  const fullPath = shippedPath("/sawad/models/" + fullFile(tier));
  const texPath = OUT_DIR + texturesFile(tier);
  if (!existsSync(texPath)) throw new Error(`missing ${texPath}: run scripts/blender/export-far.sh`);
  const doc = await io.read(fullPath);
  const fullSummary = summarize(doc);

  // Textures: the far-view encodes, by name.
  const farTextures = new Map((await io.read(texPath)).getRoot().listTextures().map((x) => [x.getName(), x]));
  for (const texture of doc.getRoot().listTextures()) {
    const far = farTextures.get(texture.getName());
    if (!far) throw new Error(`${tier}: no far-view texture named ${texture.getName()} in ${texturesFile(tier)}`);
    texture.setImage(far.getImage()).setMimeType(far.getMimeType());
  }

  // Where each AO map is brightest at far-view size (for `precision.flatBakedAoUv`).
  const aoSpots = settings.precision?.flatBakedAoUv ? await aoBrightSpots(t, tier, farTextures) : new Map();

  // Geometry: each primitive simplified within the tier's error, in metres, its bounds locked.
  const meshes = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    const scale = meshScale(mesh);
    const settings = settingsFor(tierSettings, mesh.getName());
    for (const prim of mesh.listPrimitives()) {
      const indices = Uint32Array.from(prim.getIndices().getArray());
      const local = floatsOf(prim.getAttribute("POSITION"), 3);
      const pos = local.map((v) => v * scale); // metres, so the error and the prices share a unit
      const count = pos.length / 3;
      const parts = Object.fromEntries(Object.keys(PRICED).filter((sem) => prim.getAttribute(sem)).map((sem) => [sem, floatsOf(prim.getAttribute(sem), PRICED[sem])]));
      const attrs = pricedAttributes(parts, settings.weights, count);
      const flags = ["ErrorAbsolute", ...(settings.permissive ? ["Permissive"] : [])];
      const lock = boundsLock(local);
      const [simplified] = MeshoptSimplifier.simplifyWithAttributes(indices, pos, 3, attrs.data, attrs.stride, attrs.weights, lock, 0, settings.error, flags);
      const { order, indices: next } = compact(anchor(simplified, lock));
      const prec = settings.precision ?? {};
      const baked = prim.getMaterial() && !/(-lattice|-screen|^glass-clear)$/.test(prim.getMaterial().getName()) && prim.getMaterial().getAlphaMode() === "OPAQUE";
      for (const semantic of prim.listSemantics()) {
        const a = prim.getAttribute(semantic);
        let data = a.getArray();
        const range = a.getComponentType() === UNSIGNED_SHORT ? 65535 : a.getComponentType() === SHORT ? 32767 : 0;
        if (semantic === "TEXCOORD_1" && prec.flatBakedAoUv && baked && aoSpots.has(prim.getMaterial().getOcclusionTexture()?.getName())) {
          // A baked surface multiplies its AO map by 0 (bakedLight.ts), so its AO UVs carry nothing:
          // one constant, on the map's brightest texel, so a far set left without the bake is not darkened.
          const { u, v } = aoSpots.get(prim.getMaterial().getOcclusionTexture().getName());
          const flat = new data.constructor(data.length);
          for (let i = 0; i < flat.length; i += a.getElementSize()) [flat[i], flat[i + 1]] = [Math.round(u * range), Math.round(v * range)];
          data = flat;
        }
        else if (/^TEXCOORD_\d$/.test(semantic) && prec[semantic] && range) data = roundStored(data, a.getElementSize(), 2, Math.floor(prec[semantic] * range));
        const copy = doc.createAccessor().setType(a.getType()).setNormalized(a.getNormalized()).setArray(gather(data, a.getElementSize(), order)).setBuffer(a.getBuffer());
        prim.setAttribute(semantic, copy);
      }
      const idx = prim.getIndices();
      prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(order.length <= 65535 ? Uint16Array.from(next) : next).setBuffer(idx.getBuffer()));
      meshes.push({ mesh: mesh.getName(), triangles: { full: indices.length / 3, far: next.length / 3 } });
    }
  }

  // Unused accessors go; vertex attributes stay (TEXCOORD_2 is read by no glTF texture slot).
  await doc.transform(prune({ propertyTypes: [PropertyType.ACCESSOR], keepAttributes: true, keepIndices: true }), reorder({ encoder: MeshoptEncoder, target: "size" }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const out = dest;
  await io.write(out, doc);
  // glTF Transform stores the full file's free TEXCOORD_1 placeholder as real zeros: the diet's AO
  // step puts the placeholder back, byte for byte the rest (diet.mjs, ledger T6).
  const dieted = STEPS.ao.apply(parseGlb(readFileSync(out)));
  if (dieted.changed) writeFileSync(out, writeGlb(dieted));

  // Read back what was written and hold it against the full file.
  const farSummary = summarize(await io.read(out));
  const problems = compareStructure(fullSummary, farSummary);
  return {
    tier,
    file: farFile(tier),
    bytes: statSync(out).size,
    fullBytes: statSync(fullPath).size,
    budget: FAR_BUDGET[tier],
    settings,
    triangles: { file: { full: fullSummary.primitives.reduce((s, p) => s + p.triangles, 0), far: farSummary.primitives.reduce((s, p) => s + p.triangles, 0) }, placed: { full: placedTriangles(fullSummary), far: placedTriangles(farSummary) } },
    meshes,
    problems,
  };
}

/**
 * `--try '<json settings>' [--tiers high]` builds a candidate into scripts/blender/out/ instead of
 * public/ (for comparing settings before choosing one), and prints its numbers.
 */
async function run() {
  const t = await tools();
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  if (flag("--try")) {
    const settings = JSON.parse(flag("--try"));
    for (const tier of (flag("--tiers") ?? "high,low").split(",")) {
      const r = await buildTier(t, tier, { ...FAR_SETTINGS[tier], ...settings }, OUT_DIR + `try-${farFile(tier)}`);
      console.log(`${tier} ${JSON.stringify(r.settings)}: ${(r.bytes / 1e6).toFixed(2)} MB, triangles in file ${r.triangles.file.far} of ${r.triangles.file.full}, placed ${r.triangles.placed.far} of ${r.triangles.placed.full}; ${r.problems.length} structure problems ${r.problems.slice(0, 3).join("; ")}`);
    }
    return;
  }
  const tiers = [];
  for (const tier of TIERS) tiers.push(await buildTier(t, tier));
  const problems = tiers.flatMap((r) => [...r.problems.map((p) => `${r.tier}: ${p}`), ...(r.bytes > r.budget ? [`${r.tier}: ${r.file} is ${r.bytes} bytes, over its ${r.budget} budget`] : [])]);
  writeFileSync(REPORT_PATH, JSON.stringify({ generatedBy: "scripts/blender/export-far.sh", tiers, passed: problems.length === 0 }, null, 2) + "\n");
  for (const r of tiers) {
    const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
    console.log(`${r.tier}: ${r.file} ${mb(r.bytes)} (full ${mb(r.fullBytes)}, budget ${mb(r.budget)}); triangles in file ${r.triangles.file.far} of ${r.triangles.file.full}, placed ${r.triangles.placed.far} of ${r.triangles.placed.full}`);
  }
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n` + problems.map((p) => "  - " + p).join("\n"));
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
