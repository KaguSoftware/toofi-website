#!/usr/bin/env node
/**
 * The far set's look gate (optimization track F2A), on the P0 rig: the rig's lock, build, server,
 * browser profiles, probe and fixed cameras (scripts/perf/), with one addition the rig's own
 * `frames.mjs reference` has no switch for: which compound file the page may fetch.
 *
 *   node scripts/blender/far/gate.mjs far   [--tiers high,low] [--shots poster-hold,aerial]
 *   node scripts/blender/far/gate.mjs full  [--tiers …] [--shots …]
 *   node scripts/blender/far/gate.mjs mixed [--tiers …] [--shots …]
 *   node scripts/blender/far/gate.mjs far --candidates c1,c2      (far files from scripts/blender/out/cand-<name>/)
 *   node scripts/blender/far/gate.mjs mixed --capture-at 900      (each camera's capture moved to frame 900)
 *
 * - `far`: the full files are refused, so the far set stays on screen; every camera is the far set
 *   against the reference frame (the plan's gate: the aerial and the poster handover).
 * - `full`: the far files are refused, so the loader falls back to the full file before the first
 *   frame, exactly as before F2A; every camera should match its reference at 0/255.
 * - `mixed`: nothing refused, the path a visitor gets: the far set first, the full model swapped in
 *   after the poster hold.
 * - `--candidates`: the far files are served from scripts/blender/out/cand-<name>/ instead of the
 *   build's own, so several far sets are judged on one build and one hold of the lock.
 *
 * Frames, heat maps and a JSON result go to scripts/blender/out/far-gate/<stamp>-<mode>/.
 * Needs the rig's tools: pnpm install --dir scripts/perf --ignore-workspace.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
export const PERF_DIR = here("../../perf/");
export const OUT_DIR = here("../out/far-gate/");
export const MODES = ["far", "full", "mixed"];
export const DEFAULT_SHOTS = { far: ["poster-hold", "aerial", "opening"], full: null, mixed: null };

/** URL patterns refused in each mode (Playwright glob syntax). */
export function blockedPatterns(mode) {
  if (mode === "far") return ["**/sawad/models/compound-zaitun-high.glb", "**/sawad/models/compound-zaitun-low.glb"];
  if (mode === "full") return ["**/sawad/models/compound-zaitun-far-*.glb"];
  if (mode === "mixed") return [];
  throw new Error(`unknown mode ${mode} (one of ${MODES.join(", ")})`);
}

/** Where a candidate's far file for a tier lives. */
export function candidateFile(name, tier) {
  if (!/^[\w-]+$/.test(name)) throw new Error(`bad candidate name ${name}`);
  return join(here("../out/"), `cand-${name}`, `compound-zaitun-far-${tier}.glb`);
}

/**
 * Mean difference per channel (0..255) of `block` x `block` pixel averages. The post chain's film
 * grain shifts its per-pixel pattern whenever three's random stream changes (S3 found one texture
 * more or less is enough), which adds speckle to a plain comparison; averaging blocks cancels the
 * grain and keeps real changes. Images are { width, height, data: RGBA bytes }.
 */
export function blockDiff(a, b, block = 4) {
  const bw = Math.floor(a.width / block);
  const bh = Math.floor(a.height / block);
  let total = 0;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) for (let c = 0; c < 3; c++) {
    let sa = 0;
    let sb = 0;
    for (let y = 0; y < block; y++) for (let x = 0; x < block; x++) {
      const k = ((by * block + y) * a.width + bx * block + x) * 4 + c;
      sa += a.data[k];
      sb += b.data[k];
    }
    total += Math.abs(sa - sb) / (block * block);
  }
  return total / (bw * bh * 3);
}

/**
 * Moves a plan's capture to another frame (a later look at the same camera, to tell a swap still
 * under way from a swap that went wrong). The frame then has no reference: compare two modes' runs.
 */
export function moveCapture(plan, frame) {
  for (const step of plan.steps) if (step.do === "capture") step.frame = frame;
  plan.steps.sort((x, y) => x.frame - y.frame);
  plan.lastFrame = Math.max(plan.lastFrame, frame + 2);
  return plan;
}

/** One line per frame for the console and the result file. */
export function verdict(row, gate) {
  const who = row.candidate ? `[${row.candidate}] ` : "";
  if (row.missing) return `${who}${row.tier} ${row.shot}: no reference`;
  if (row.error) return `${who}${row.tier} ${row.shot}: ${row.error}`;
  const grainFree = row.blockMean == null ? "" : ` (grain-free ${row.blockMean.toFixed(2)})`;
  return `${who}${row.tier} ${row.shot.padEnd(11)} mean ${row.mean.toFixed(2)}/255${grainFree}, changed ${(row.changedShare * 100).toFixed(1)}%, worst ${row.worst} ${row.mean <= gate ? "pass" : "FAIL"}`;
}

async function main() {
  const [{ withRig }, { launch, openPage, waitForFrame, waitForScene }, { REFERENCE_DIR, diffImage, imageDiff, list, parseArgs, saveResult, stamp }, { REFERENCE_LEVEL, SHOT_NAMES, planFor }, { LOOK_GATE }] = await Promise.all(
    ["rig.mjs", "browser.mjs", "lib.mjs", "shots.mjs", "frames.mjs"].map((f) => import(pathToFileURL(join(PERF_DIR, f)).href)),
  );
  const { PNG } = createRequire(join(PERF_DIR, "package.json"))("pngjs");
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0] ?? "far";
  const blocked = blockedPatterns(mode);
  const tiers = list(args.tiers) ?? ["high", "low"];
  const shots = list(args.shots) ?? DEFAULT_SHOTS[mode] ?? SHOT_NAMES;
  const width = Number(args.width ?? 960);
  const candidates = list(args.candidates) ?? [null];
  for (const c of candidates) for (const tier of tiers) if (c && !existsSync(candidateFile(c, tier))) throw new Error(`missing ${candidateFile(c, tier)}`);
  const out = join(OUT_DIR, `${stamp()}-${mode}`);
  mkdirSync(out, { recursive: true });
  const decode = (dataUrl) => PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
  const encode = (img) => PNG.sync.write(Object.assign(new PNG({ width: img.width, height: img.height }), { data: img.data }));
  const sideBySide = (a, b, heat) => {
    const img = new PNG({ width: a.width * 2, height: a.height * 2 });
    img.data.fill(0);
    const blit = (src, ox, oy) => {
      for (let y = 0; y < src.height; y++) src.data.copy(img.data, ((oy + y) * img.width + ox) * 4, y * src.width * 4, (y + 1) * src.width * 4);
    };
    blit(a, 0, 0);
    blit(b, a.width, 0);
    blit(heat, 0, a.height);
    return PNG.sync.write(img);
  };

  const rows = [];
  await withRig(`far gate ${mode}`, async ({ baseUrl }) => {
    const browser = await launch();
    // openPage only calls newContext: refuse the blocked files (and serve a candidate's far files) in every context it opens.
    let candidate = null;
    const routed = {
      newContext: async (options) => {
        const context = await browser.newContext(options);
        for (const pattern of blocked) await context.route(pattern, (route) => route.abort("failed"));
        if (candidate) {
          await context.route("**/sawad/models/compound-zaitun-far-*.glb", (route) => {
            const tier = /far-(high|low)\.glb/.exec(route.request().url())[1];
            return route.fulfill({ status: 200, contentType: "model/gltf-binary", body: readFileSync(candidateFile(candidate, tier)) });
          });
        }
        return context;
      },
    };
    try {
      for (const cand of candidates) for (const tier of tiers) {
        candidate = cand;
        const tag = cand ? `${cand}-` : "";
        for (const shot of shots) {
          const plan = planFor(shot, { level: REFERENCE_LEVEL[tier], record: false, capture: true, width });
          if (args["capture-at"]) moveCapture(plan, Number(args["capture-at"]));
          if (shot === "poster-hold") plan.steps.unshift({ frame: 0, do: "capture", name: "handover-scene", width }, { frame: 0, do: "capturePoster", name: "handover-poster", width });
          const { context, page } = await openPage(routed, tier === "high" ? "desktop" : "phone", { probe: { virtualTime: true, plan: plan.steps }, throttle: false });
          const fetched = [];
          page.on("requestfinished", (r) => {
            if (/compound-zaitun/.test(r.url())) fetched.push(r.url().split("/").pop());
          });
          try {
            await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
            await waitForScene(page);
            await waitForFrame(page, plan.lastFrame);
            await page.waitForTimeout(150);
            const captures = await page.evaluate(() => window.__rig.captures);
            const snap = await page.evaluate(() => window.__rig.snapshot());
            if (captures["handover-scene"] && captures["handover-poster"]) {
              const s = decode(captures["handover-scene"].dataUrl);
              const p = decode(captures["handover-poster"].dataUrl);
              rows.push({ candidate: cand, tier, shot: "handover", vs: "poster", ...imageDiff(s, p), fetched });
              writeFileSync(join(out, `${tag}${tier}-handover.png`), sideBySide(p, s, diffImage(p, s)));
            }
            const cap = captures[shot];
            if (!cap) {
              rows.push({ candidate: cand, tier, shot, error: `no capture (${snap.errors.join("; ") || "no error"})`, fetched });
              continue;
            }
            const img = decode(cap.dataUrl);
            writeFileSync(join(out, `${tag}${tier}-${shot}.png`), encode(img));
            const refFile = join(REFERENCE_DIR, tier, `${shot}.png`);
            if (!existsSync(refFile)) {
              rows.push({ candidate: cand, tier, shot, missing: true, fetched });
              continue;
            }
            const ref = PNG.sync.read(readFileSync(refFile));
            const d = imageDiff(ref, img);
            rows.push({ candidate: cand, tier, shot, ...d, blockMean: blockDiff(ref, img), pass: d.mean <= LOOK_GATE, fetched, errors: snap.errors });
            writeFileSync(join(out, `${tag}${tier}-${shot}-vs-reference.png`), sideBySide(ref, img, diffImage(ref, img)));
          } finally {
            await context.close();
          }
        }
      }
    } finally {
      await browser.close();
    }
  });
  const file = saveResult("far-gate", { takenAt: new Date().toISOString(), mode, blocked, candidates, gate: LOOK_GATE, rows }, out);
  for (const r of rows) console.log(r.vs === "poster" ? `${r.candidate ? `[${r.candidate}] ` : ""}${r.tier} handover   mean ${r.mean.toFixed(2)}/255 against the poster (fetched ${r.fetched.join(", ")})` : verdict(r, LOOK_GATE));
  console.log(file);
  if (rows.some((r) => r.pass === false || r.error)) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
