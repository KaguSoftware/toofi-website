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

export const BUDGETS = { "compound-high.glb": 5_000_000, "compound-low.glb": 2_000_000 };

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
export const MODELS_DIR = here("../../public/sawad/models/");
export const MANIFEST_PATH = here("../../public/sawad/models/compound.manifest.json");

/** Builds the manifest from the per-tier build reports; `sizeOf` returns a file's size in bytes. */
export function buildManifest(reports, sizeOf) {
  const { high, low } = reports;
  const files = Object.fromEntries(Object.keys(BUDGETS).map((f) => [f, sizeOf(f)]));
  const over = Object.entries(files).filter(([f, size]) => size > BUDGETS[f]);
  if (over.length) throw new Error(`Over budget: ${over.map(([f, s]) => `${f} ${(s / 1e6).toFixed(2)} MB > ${BUDGETS[f] / 1e6} MB`).join(", ")}`);
  return {
    generatedBy: "scripts/blender/build.sh",
    blender: high.blender,
    villas: high.villas,
    files,
    budgets: BUDGETS,
    palette: high.palette,
    triangles: { high: high.triangles, low: low.triangles },
    aoSize: { high: high.aoSize, low: low.aoSize },
    lamps: high.lamps,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const read = (tier) => JSON.parse(readFileSync(here(`./out/build-report-${tier}.json`), "utf8"));
  const manifest = buildManifest({ high: read("high"), low: read("low") }, (f) => statSync(MODELS_DIR + f).size);
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  for (const [f, size] of Object.entries(manifest.files)) console.log(`${f}: ${(size / 1e6).toFixed(2)} MB (budget ${BUDGETS[f] / 1e6} MB)`);
}
