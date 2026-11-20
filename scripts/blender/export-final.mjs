#!/usr/bin/env node
/**
 * Checks and records the Zaitun final export (track 6B): the shipped GLBs and KTX2 lightmaps against
 * the budgets, and their structure against the lightmap contract (docs/zaitun/LIGHTING.md).
 *
 *   node scripts/blender/export-final.mjs      (run by scripts/blender/export-final.sh)
 *
 * Writes public/sawad/models/zaitun-export.json and updates `files` and `budgets` in
 * public/sawad/models/compound-zaitun.manifest.json. Exits 1 when a check or budget fails.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LIGHTMAP_BUDGET, OPTIONAL_BUDGETS } from "./finalize-manifest.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
export const MODELS_DIR = here("../../public/sawad/models/");
export const LIGHTMAPS_DIR = here("../../public/sawad/lightmaps/zaitun/");
export const REPORT_PATH = MODELS_DIR + "zaitun-export.json";
export const MANIFEST_PATH = MODELS_DIR + "compound-zaitun.manifest.json";

export const TIERS = ["high", "low"];
export const STATES = ["day", "dusk"];
export const COMPOUND_FILES = { high: "compound-zaitun-high.glb", low: "compound-zaitun-low.glb" };

/**
 * Budgets for the shipped Zaitun files. 6A proposed 7.0 / 2.8 MB per compound file and 8.5 / 4.0 MB
 * for all models of a tier (docs/zaitun/EXPORT_BUDGETS.md), estimated before the 28 ha model existed.
 * The real files carry the baked AO channel beside the lightmap UVs and measure 10.26 / 4.97 MB, so
 * on 2026-11-19 the owner chose to keep the AO channel and raise the compound caps to 10.5 / 5.2 MB
 * and the initial-load caps to 12.0 / 5.8 MB (docs/zaitun/EXPORT.md section 3). The vegetation, life
 * and lightmap-set caps are 6A's, unchanged.
 */
export const ZAITUN_BUDGETS = {
  compound: { high: 10_500_000, low: 5_200_000 },
  initialModels: { high: 12_000_000, low: 5_800_000 },
  lightmapSet: LIGHTMAP_BUDGET,
  optional: OPTIONAL_BUDGETS,
};
/** What the whole page adds to the models on first load (6A's estimate: transcoder, 3D JS, poster, fonts and app JS). QA measures the real number. */
export const PAGE_OVERHEAD_ESTIMATE = 2_300_000;
export const PAGE_LIMIT = 15_000_000;

/** Extensions the loader wiring covers (meshopt decoder, KTX2 loader); anything else required would throw at load. */
const SUPPORTED_REQUIRED = new Set(["EXT_meshopt_compression", "KHR_texture_basisu", "KHR_mesh_quantization", "EXT_mesh_gpu_instancing"]);
const MUST_USE = ["EXT_meshopt_compression", "KHR_texture_basisu", "EXT_mesh_gpu_instancing"];
/** Meshes that live on the shared `site` page (scaleOffset [1, 1, 0, 0]); every other lit mesh is a placed building copy. */
const SITE_PAGE_MESHES = new Set(["site", "garden"]);

export function readGlbJson(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB (bad magic)");
  const length = buffer.readUInt32LE(12);
  return JSON.parse(buffer.subarray(20, 20 + length).toString("utf8"));
}

/**
 * The facts the checks need, without decoding any buffer.
 * @param {any} json  the glTF JSON chunk
 */
export function describeGlb(json) {
  const accessors = json.accessors ?? [];
  const meshes = (json.meshes ?? []).map((mesh) => ({
    name: mesh.name ?? "",
    primitives: mesh.primitives.map((p) => ({ material: p.material, attributes: Object.keys(p.attributes) })),
  }));
  const instances = {};
  const nodes = json.nodes ?? [];
  for (const node of nodes) {
    if (node.mesh == null) continue;
    const name = meshes[node.mesh].name;
    const gpu = node.extensions?.EXT_mesh_gpu_instancing;
    instances[name] = (instances[name] ?? 0) + (gpu ? accessors[Object.values(gpu.attributes)[0]].count : 1);
  }
  return {
    extensionsUsed: json.extensionsUsed ?? [],
    extensionsRequired: json.extensionsRequired ?? [],
    meshes,
    materials: (json.materials ?? []).map((m) => ({ name: m.name ?? "", occlusionTexCoord: m.occlusionTexture ? (m.occlusionTexture.texCoord ?? 0) : null })),
    instances,
  };
}

const hasAttribute = (mesh, semantic) => mesh.primitives.some((p) => p.attributes.includes(semantic));
/** glTF requires TEXCOORD_n to start at 0 and be continuous; the validator errors on a gap. */
const texcoordGap = (attributes) => {
  const n = attributes.filter((a) => /^TEXCOORD_\d+$/.test(a)).length;
  return Array.from({ length: n }, (_, i) => `TEXCOORD_${i}`).some((a) => !attributes.includes(a));
};
/** The lightmap UVs: the third UV set, after the trim sheet (0) and the AO bake (1). three.js reads it as `uv2`, `texture.channel = 2`. */
export const LIGHTMAP_SEMANTIC = "TEXCOORD_2";

/**
 * Structural checks for one shipped GLB. `lightmaps` is the tier's `lightmaps.json` section; without
 * it only the checks that do not need the tiles run. Returns a list of problems, empty when the file
 * honours the lightmap contract.
 * @param {ReturnType<typeof describeGlb>} description
 * @param {{ lightmaps?: any }} [options]
 * @returns {string[]}
 */
export function checkModel(description, { lightmaps } = {}) {
  const problems = [];
  for (const ext of MUST_USE) if (!description.extensionsUsed.includes(ext)) problems.push(`${ext} is not used`);
  for (const ext of description.extensionsRequired) if (!SUPPORTED_REQUIRED.has(ext)) problems.push(`requires ${ext}, which the loaders do not wire`);

  const lit = description.meshes.filter((m) => hasAttribute(m, LIGHTMAP_SEMANTIC));
  for (const mesh of description.meshes) {
    if (mesh.primitives.some((p) => texcoordGap(p.attributes))) problems.push(`${mesh.name} has a gap in its TEXCOORD sets`);
    const atlas = mesh.primitives.filter((p) => p.material != null && description.materials[p.material].name.endsWith("-atlas"));
    if (mesh.name !== "bench" && atlas.some((p) => !p.attributes.includes(LIGHTMAP_SEMANTIC))) problems.push(`${mesh.name} has an atlas primitive without ${LIGHTMAP_SEMANTIC} (the lightmap UVs)`);
  }
  for (const name of ["lamp", "bench"]) if (lit.some((m) => m.name === name)) problems.push(`${name} must not carry lightmap UVs (it keeps real-time light)`);
  for (const m of description.materials) if (m.occlusionTexCoord === 0) problems.push(`${m.name} samples its AO map from TEXCOORD_0, not the AO UV set`);

  if (lightmaps) {
    const buildingCopies = Object.values(lightmaps.instances).filter((i) => i.page === "buildings").length;
    const modelCopies = lit.filter((m) => !SITE_PAGE_MESHES.has(m.name)).reduce((sum, m) => sum + (description.instances[m.name] ?? 0), 0);
    if (modelCopies !== buildingCopies) problems.push(`${modelCopies} lit building copies in the model, ${buildingCopies} tiles in lightmaps.json`);
    for (const name of SITE_PAGE_MESHES) if (!lit.some((m) => m.name === name)) problems.push(`${name} is missing or has no lightmap UVs`);
  }
  return problems;
}

/** The fields of a KTX2 file's header the checks need. */
export function readKtx2Header(buffer) {
  const identifier = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!identifier.every((byte, i) => buffer[i] === byte)) throw new Error("not a KTX2 file (bad identifier)");
  const dfd = buffer.readUInt32LE(48);
  return {
    width: buffer.readUInt32LE(20),
    height: buffer.readUInt32LE(24),
    levelCount: buffer.readUInt32LE(40),
    supercompression: buffer.readUInt32LE(44), // 1 = BasisLZ (ETC1S)
    colorModel: buffer[dfd + 12], // 163 = ETC1S, 166 = UASTC
    transfer: buffer[dfd + 14], // 2 = sRGB
  };
}

/** Problems with one KTX2 lightmap page: it must be sRGB, mipmapped and the size lightmaps.json says. */
export function checkKtx2(header, name, size) {
  const problems = [];
  if (header.width !== size[0] || header.height !== size[1]) problems.push(`${name} is ${header.width}x${header.height}, lightmaps.json says ${size.join("x")}`);
  if (header.transfer !== 2) problems.push(`${name} is not sRGB-encoded`);
  if (header.levelCount < 2) problems.push(`${name} has no mip chain`);
  return problems;
}

/** Sum of a tier's lightmap files for each state, in bytes. `sizeOf` returns null for a missing file. */
export function lightmapSets(lightmaps, tier, sizeOf) {
  const sets = {};
  for (const state of STATES) {
    sets[state] = Object.values(lightmaps.tiers[tier].pages).reduce((sum, page) => sum + (sizeOf(page.files[state].replace(/\.png$/, ".ktx2")) ?? Infinity), 0);
  }
  return sets;
}

/** Budget rows and problems for the sizes in bytes. `sizes` maps model file name to bytes (or null); `sets` is lightmapSets() per tier. */
export function evaluateBudgets({ sizes, sets }) {
  const rows = [];
  const problems = [];
  const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
  const check = (label, bytes, limit) => {
    rows.push({ label, bytes, limit, ok: bytes <= limit });
    if (!(bytes <= limit)) problems.push(`${label}: ${Number.isFinite(bytes) ? mb(bytes) : "missing"} > ${mb(limit)}`);
  };
  for (const tier of TIERS) {
    const compound = sizes[COMPOUND_FILES[tier]];
    check(COMPOUND_FILES[tier], compound ?? Infinity, ZAITUN_BUDGETS.compound[tier]);
    let models = compound ?? Infinity;
    for (const kind of ["vegetation", "life"]) {
      const file = `${kind}-${tier}.glb`;
      const size = sizes[file];
      if (size == null) continue; // the 3A files are checked when present
      check(file, size, ZAITUN_BUDGETS.optional[file]);
      models += size;
    }
    check(`${tier} models together (initial load)`, models, ZAITUN_BUDGETS.initialModels[tier]);
    check(`${tier} page estimate (models + ${mb(PAGE_OVERHEAD_ESTIMATE)} other)`, models + PAGE_OVERHEAD_ESTIMATE, PAGE_LIMIT);
    for (const state of STATES) check(`${tier} ${state} lightmap set (KTX2, after the first frame)`, sets[tier][state], ZAITUN_BUDGETS.lightmapSet[tier]);
  }
  return { rows, problems };
}

/** What the web loads for each tier: every page's KTX2 file per state, with its size in pixels and bytes. */
export function lightmapFiles(lightmaps, sizeOf) {
  return Object.fromEntries(
    TIERS.map((tier) => [
      tier,
      Object.fromEntries(
        Object.entries(lightmaps.tiers[tier].pages).map(([page, info]) => [
          page,
          { size: info.size, files: Object.fromEntries(STATES.map((state) => { const file = info.files[state].replace(/\.png$/, ".ktx2"); return [state, { file, bytes: sizeOf(file) }]; })) },
        ]),
      ),
    ]),
  );
}

/** The manifest with the shipped file sizes and the budgets they were checked against. */
export function updateManifest(manifest, sizes) {
  const files = Object.fromEntries(Object.values(COMPOUND_FILES).map((f) => [f, sizes[f]]));
  const budgets = Object.fromEntries(TIERS.map((tier) => [COMPOUND_FILES[tier], ZAITUN_BUDGETS.compound[tier]]));
  return { ...manifest, files, budgets };
}

function run() {
  const sizeAt = (dir) => (f) => (existsSync(dir + f) ? statSync(dir + f).size : null);
  const modelSize = sizeAt(MODELS_DIR);
  const lightmaps = JSON.parse(readFileSync(LIGHTMAPS_DIR + "lightmaps.json", "utf8"));
  const sizes = Object.fromEntries(
    [...Object.values(COMPOUND_FILES), ...Object.keys(ZAITUN_BUDGETS.optional)].map((f) => [f, modelSize(f)]),
  );
  const sets = Object.fromEntries(TIERS.map((tier) => [tier, lightmapSets(lightmaps, tier, sizeAt(LIGHTMAPS_DIR))]));
  const { rows, problems } = evaluateBudgets({ sizes, sets });

  const structure = {};
  for (const tier of TIERS) {
    structure[tier] = checkModel(describeGlb(readGlbJson(readFileSync(MODELS_DIR + COMPOUND_FILES[tier]))), { lightmaps: lightmaps.tiers[tier] });
    for (const [pageName, page] of Object.entries(lightmaps.tiers[tier].pages)) {
      for (const state of STATES) {
        const file = page.files[state].replace(/\.png$/, ".ktx2");
        structure[tier].push(...checkKtx2(readKtx2Header(readFileSync(LIGHTMAPS_DIR + file)), file, page.size));
      }
    }
    problems.push(...structure[tier].map((p) => `${tier}: ${p}`));
  }

  writeFileSync(
    REPORT_PATH,
    JSON.stringify({ generatedBy: "scripts/blender/export-final.sh", lightmapUv: { gltf: LIGHTMAP_SEMANTIC, channel: 2 }, lightmaps: lightmapFiles(lightmaps, sizeAt(LIGHTMAPS_DIR)), budgets: rows, structureProblems: structure, passed: problems.length === 0 }, null, 2) + "\n",
  );
  if (existsSync(MANIFEST_PATH)) {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    writeFileSync(MANIFEST_PATH, JSON.stringify(updateManifest(manifest, sizes), null, 2) + "\n");
  }
  for (const row of rows) console.log(`${row.ok ? "ok  " : "FAIL"} ${row.label}: ${(row.bytes / 1e6).toFixed(2)} MB (limit ${(row.limit / 1e6).toFixed(2)} MB)`);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n` + problems.map((p) => "  - " + p).join("\n"));
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
