#!/usr/bin/env node
/**
 * Where a variant moved pixels (S3). The look gate writes side-by-side frames only for failures; this
 * writes them for every frame of a reference run, with the heat map amplified (`--full 8`: a change
 * of 8/255 shows white) so a passing change can still be located. Also prints the share of the frame
 * that moved and in which band of rows, which says sky, horizon, buildings or ground.
 *
 *   node scripts/perf/S3/compare.mjs <run-dir> [--out dir] [--full 8] [--block 4] [--against <run-dir>] [--shots stop-1,aerial] [--tiers high]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { REFERENCE_DIR, diffImage, imageDiff } from "../lib.mjs";

/** Decodes a PNG buffer to { width, height, data }. */
export const decodePng = (buf) => PNG.sync.read(buf);
const readPng = (p) => decodePng(readFileSync(p));

/** Reference | variant | heat, side by side. */
export function strip(a, b, heat) {
  const out = new PNG({ width: a.width * 3, height: a.height });
  [a, b, heat].forEach((img, k) => {
    for (let y = 0; y < img.height; y++) img.data.copy(out.data, (y * out.width + k * img.width) * 4, y * img.width * 4, (y + 1) * img.width * 4);
  });
  return PNG.sync.write(out);
}

/**
 * The image averaged over `block` × `block` squares. Film grain is per-pixel noise whose pattern
 * moves when anything shifts the random stream (a texture fewer changes three's UUID draws), so a
 * raw difference shows grain all over the sky; averaged blocks cancel it and keep real changes.
 */
export function blockAverage(img, block) {
  if (block <= 1) return img;
  const w = Math.floor(img.width / block);
  const h = Math.floor(img.height / block);
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sum = [0, 0, 0];
      for (let dy = 0; dy < block; dy++) {
        for (let dx = 0; dx < block; dx++) {
          const o = ((y * block + dy) * img.width + x * block + dx) * 4;
          sum[0] += img.data[o];
          sum[1] += img.data[o + 1];
          sum[2] += img.data[o + 2];
        }
      }
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = Math.round(sum[c] / (block * block));
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Mean difference per horizontal band (top to bottom), `bands` of them. */
export function bandMeans(a, b, bands = 4) {
  const res = [];
  const rows = Math.ceil(a.height / bands);
  for (let k = 0; k < bands; k++) {
    let sum = 0;
    let n = 0;
    for (let y = k * rows; y < Math.min(a.height, (k + 1) * rows); y++) {
      for (let x = 0; x < a.width; x++) {
        const o = (y * a.width + x) * 4;
        sum += Math.abs(a.data[o] - b.data[o]) + Math.abs(a.data[o + 1] - b.data[o + 1]) + Math.abs(a.data[o + 2] - b.data[o + 2]);
        n += 3;
      }
    }
    res.push(n ? sum / n : 0);
  }
  return res;
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : def;
  };
  const full = Number(opt("--full", "8"));
  const block = Number(opt("--block", "1"));
  // Another run's captures as the baseline, to isolate one change stacked on an earlier variant.
  const against = opt("--against", null);
  const shots = opt("--shots", null)?.split(",");
  const tiers = opt("--tiers", "high,low").split(",");
  const run = args[0];
  const out = opt("--out", join(run, "compare"));
  mkdirSync(out, { recursive: true });
  console.log("| Tier | Camera | Mean | Moved > 4/255 | Worst | Bands top→bottom |");
  console.log("|---|---|---|---|---|---|");
  for (const tier of tiers) {
    for (const file of JSON.parse(readFileSync(join(run, "reference.json"), "utf8")).frames.filter((f) => f.tier === tier)) {
      if (shots && !shots.includes(file.shot)) continue;
      const capPath = join(run, "frames", `${tier}-${file.shot}.png`);
      const refPath = against ? join(against, "frames", `${tier}-${file.shot}.png`) : join(REFERENCE_DIR, tier, `${file.shot}.png`);
      if (!existsSync(capPath) || !existsSync(refPath)) continue;
      const a = blockAverage(readPng(refPath), block);
      const b = blockAverage(readPng(capPath), block);
      const d = imageDiff(a, b, { threshold: 4 });
      writeFileSync(join(out, `${tier}-${file.shot}.png`), strip(a, b, diffImage(a, b, { full })));
      console.log(`| ${tier} | ${file.shot} | ${d.mean.toFixed(2)} | ${(d.changedShare * 100).toFixed(1)}% | ${d.worst} | ${bandMeans(a, b).map((m) => m.toFixed(2)).join(" / ")} |`);
    }
  }
  console.log(`\n${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
