#!/usr/bin/env node
/**
 * Writes public/sawad/models/compound.manifest.json from the Blender build reports (the
 * villa-NN empties' world positions in three.js space, the palette check, triangle counts)
 * plus the optimised file sizes, and fails if a file is over its budget.
 *
 *   node scripts/blender/finalize-manifest.mjs     (run by scripts/blender/build.sh)
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { shippedPath } from "./version-assets.mjs";

/**
 * Export budgets for the 28 ha site (docs/zaitun/EXPORT_BUDGETS.md has the reasoning).
 * Page-level targets: under 15 MB initial load, under 300k visible triangles, 2K textures
 * (1K on phones). Files are meshopt + KTX2; Draco was measured and rejected.
 */
// Built by build.sh; always present, always checked.
export const BUDGETS = { "compound-high.glb": 7_000_000, "compound-low.glb": 2_800_000 };
// Built by the vegetation and life tracks; checked only when the file exists.
export const OPTIONAL_BUDGETS = {
  "vegetation-high.glb": 1_600_000,
  "vegetation-low.glb": 700_000,
  "life-high.glb": 400_000,
  "life-low.glb": 300_000,
};
/** Sum of every model file a tier loads before the first live frame. */
export const INITIAL_MODEL_BUDGET = { high: 8_500_000, low: 4_000_000 };
/** Per lightmap set (day, dusk), KTX2, loaded after the first frame, so outside the initial load. */
export const LIGHTMAP_BUDGET = { high: 2_000_000, low: 800_000 };
/** Everything on screen at once, all tiers (architecture + vegetation + life + site). */
export const VISIBLE_TRIANGLE_BUDGET = { architecture: 180_000, vegetation: 90_000, life: 15_000, site: 15_000, total: 300_000 };

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
export const MODELS_DIR = here("../../public/sawad/models/");
export const MANIFEST_PATH = here("../../public/sawad/models/compound.manifest.json");

/**
 * Builds the manifest from the per-tier build reports. `sizeOf` returns a file's size in bytes,
 * or null for a file that does not exist (allowed only for OPTIONAL_BUDGETS files).
 */
export function buildManifest(reports, sizeOf) {
  const { high, low } = reports;
  const files = Object.fromEntries(Object.keys(BUDGETS).map((f) => [f, sizeOf(f)]));
  const optional = Object.fromEntries(Object.keys(OPTIONAL_BUDGETS).map((f) => [f, sizeOf(f)]).filter(([, size]) => size != null));
  const limits = { ...BUDGETS, ...OPTIONAL_BUDGETS };
  const present = { ...files, ...optional };
  const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
  const over = Object.entries(present).filter(([f, size]) => size > limits[f]);
  if (over.length) throw new Error(`Over budget: ${over.map(([f, s]) => `${f} ${mb(s)} > ${limits[f] / 1e6} MB`).join(", ")}`);
  for (const tier of ["high", "low"]) {
    const total = Object.entries(present).filter(([f]) => f.endsWith(`-${tier}.glb`)).reduce((sum, [, size]) => sum + size, 0);
    if (total > INITIAL_MODEL_BUDGET[tier]) throw new Error(`Over initial-load budget: ${tier} models ${mb(total)} > ${INITIAL_MODEL_BUDGET[tier] / 1e6} MB`);
  }
  return {
    generatedBy: "scripts/blender/build.sh",
    blender: high.blender,
    villas: high.villas,
    files: { ...files, ...optional },
    budgets: { ...BUDGETS, ...Object.fromEntries(Object.keys(optional).map((f) => [f, OPTIONAL_BUDGETS[f]])) },
    palette: high.palette,
    triangles: { high: high.triangles, low: low.triangles },
    aoSize: { high: high.aoSize, low: low.aoSize },
    lamps: high.lamps,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const read = (tier) => JSON.parse(readFileSync(here(`./out/build-report-${tier}.json`), "utf8"));
  // A fresh build output, or the versioned file version-assets.mjs left (ledger T32).
  const sizeOf = (f) => {
    try {
      return statSync(shippedPath(`/sawad/models/${f}`)).size;
    } catch {
      return null;
    }
  };
  const manifest = buildManifest({ high: read("high"), low: read("low") }, sizeOf);
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  for (const [f, size] of Object.entries(manifest.files)) console.log(`${f}: ${(size / 1e6).toFixed(2)} MB (budget ${manifest.budgets[f] / 1e6} MB)`);
}
