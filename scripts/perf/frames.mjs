#!/usr/bin/env node
/**
 * Frame capture (optimization track P0). For each fixed camera (shots.mjs), each quality level
 * and both tiers: frame interval, JavaScript per frame, draw calls, triangles, render passes
 * and GPU time per pass (shadow split out), read by the probe from the production build.
 *
 *   node scripts/perf/frames.mjs [--tiers high,low] [--shots stop-1,aerial] [--levels adaptive,3] [--quick]
 *   node scripts/perf/frames.mjs reference [--update] [--tiers high] [--shots …] [--repeat]
 *
 * `reference` captures every camera under virtual time (frame-exact, repeatable) at each tier's
 * best level. With --update it rewrites scripts/perf/reference/<tier>/<shot>.png; otherwise it
 * compares against them (the look gate: mean difference of 2/255 or less) and writes the new
 * frames and heat maps to the run's folder. --repeat captures twice to show the rig's own noise.
 *
 * The high tier runs on the desktop profile without throttling; the low tier on the phone
 * profile with its 4× CPU slowdown (no network throttling: the load is not being timed here).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launch, openPage, waitForFrame, waitForScene } from "./browser.mjs";
import { REFERENCE_DIR, diffImage, fmtMs, fmtNum, imageDiff, list, mdTable, parseArgs, saveResult, summarizeFrames } from "./lib.mjs";
import { LEVELS, REFERENCE_LEVEL, SHOT_NAMES, SHOTS, planFor } from "./shots.mjs";

const TIER_PROFILE = { high: "desktop", low: "phone" };
export const LOOK_GATE = 2; // mean difference per channel, 0..255

async function runShot(browser, baseUrl, { tier, plan, probe = {}, throttle = true }) {
  const { context, page } = await openPage(browser, TIER_PROFILE[tier], { probe: { ...probe, plan: plan.steps }, throttle });
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  try {
    await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
    await waitForScene(page);
    await waitForFrame(page, plan.lastFrame);
    // Let the last GPU queries resolve.
    await page.waitForTimeout(150);
    const snap = await page.evaluate(() => window.__rig.snapshot());
    const captures = await page.evaluate(() => window.__rig.captures);
    return { snap, captures, consoleErrors };
  } finally {
    await context.close();
  }
}

/** Timing: every shot × level × tier. */
export async function run({ baseUrl, outDir, args = {} }) {
  const tiers = list(args.tiers) ?? ["high", "low"];
  const shots = list(args.shots) ?? (args.quick ? ["opening", "stop-3", "aerial"] : SHOT_NAMES);
  const browser = await launch();
  const rows = [];
  try {
    for (const tier of tiers) {
      const levels = list(args.levels) ?? (args.quick ? ["adaptive"] : ["adaptive", ...LEVELS[tier]]);
      for (const lv of levels) {
        for (const shot of shots) {
          const level = lv === "adaptive" ? null : Number(lv);
          const plan = planFor(shot, { level, record: true });
          const { snap, consoleErrors } = await runShot(browser, baseUrl, { tier, shot, plan, probe: { gpuTimers: args.gpu === "pass" ? "pass" : "frame" } });
          const s = summarizeFrames(snap.frames);
          const row = { tier, level: lv, shot, gpuMode: args.gpu === "pass" ? "pass" : "frame", endLevel: snap.level?.level ?? null, pin: snap.pin, ...s, errors: [...snap.errors, ...consoleErrors] };
          rows.push(row);
          console.log(
            `[frames] ${tier} L${lv} ${shot.padEnd(11)} fps ${fmtNum(s.fps, 0).padStart(4)}  p99 ${fmtMs(s.p99Ms, 1).padStart(8)}  cpu ${fmtMs(s.cpuMs.median, 1).padStart(7)}  gpu ${fmtMs(s.gpuMs.median, 1).padStart(7)}  calls ${fmtNum(s.calls.median)}  tris ${fmtNum(s.triangles.median)}  dpr ${s.dpr} drew L${levelFromPasses(tier, s.passes) ?? "?"}${row.pin && !row.pin.ok ? `  PIN FAILED: ${row.pin.why}` : ""}`,
          );
        }
      }
    }
  } finally {
    await browser.close();
  }
  const file = saveResult(args.name ?? "frames", { takenAt: new Date().toISOString(), rows }, outDir);
  console.log(`[frames] ${file}`);
  console.log("\n" + framesTable(rows));
  return rows;
}

/**
 * The level a run actually drew at, from its render passes per frame (each level runs a known
 * effect chain). More reliable than reading React's state, which can be a stale fiber copy.
 */
export const PASSES_PER_LEVEL = { high: { 20: 1, 31: 2, 43: 3 }, low: { 18: 0, 20: 1 } };
export function levelFromPasses(tier, passes) {
  return PASSES_PER_LEVEL[tier]?.[Math.round(passes)] ?? null;
}

export function framesTable(rows) {
  return mdTable(rows, [
    ["Tier", (r) => r.tier],
    ["Level", (r) => (r.level === "adaptive" ? `adaptive → ${levelFromPasses(r.tier, r.passes) ?? "?"}` : r.level)],
    ["Camera", (r) => r.shot],
    ["fps (median)", (r) => fmtNum(r.fps)],
    ["p99 frame", (r) => fmtMs(r.p99Ms, 1)],
    ["Worst frame", (r) => fmtMs(r.maxMs, 1)],
    ["Frames > 20 ms", (r) => `${r.overBudget}/${r.frames}`],
    ["JS / frame", (r) => fmtMs(r.cpuMs.median, 1)],
    ["GPU / frame", (r) => fmtMs(r.gpuMs.median, 1)],
    ["Draw calls", (r) => fmtNum(r.calls.median)],
    ["Scene triangles", (r) => fmtNum(r.sceneTriangles?.median)],
    ["Shadow triangles", (r) => fmtNum(r.shadowTriangles)],
    ["All triangles", (r) => fmtNum(r.triangles.median)],
    ["Passes", (r) => fmtNum(r.passes)],
    ["Buffer", (r) => r.drawingBuffer],
  ]);
}

// ------------------------------------------------------------------ reference frames

// pngjs is the rig's own dependency (scripts/perf/package.json), loaded only when frames are
// compared, so the repo's tests run without the rig's tools installed.
let PNG = null;
const loadPng = async () => (PNG ??= (await import("pngjs")).PNG);
const decode = (dataUrl) => PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
const encode = (img) => PNG.sync.write(Object.assign(new PNG({ width: img.width, height: img.height }), { data: img.data }));

/** Two images side by side with the heat map under them, for the owner. */
function sideBySide(a, b, heat) {
  const out = new PNG({ width: a.width * 2, height: a.height * 2 });
  out.data.fill(0);
  const blit = (img, ox, oy) => {
    for (let y = 0; y < img.height; y++) img.data.copy(out.data, ((oy + y) * out.width + ox) * 4, y * img.width * 4, (y + 1) * img.width * 4);
  };
  blit(a, 0, 0);
  blit(b, a.width, 0);
  blit(heat, 0, a.height);
  return PNG.sync.write(out);
}

/**
 * One shot, retried once in a fresh browser if Chrome closes under it (it did once, mid-capture,
 * in the baseline run). `holder.browser` is replaced when that happens.
 */
async function runShotRetrying(holder, baseUrl, opts) {
  try {
    return await runShot(holder.browser, baseUrl, opts);
  } catch (err) {
    if (!/closed|disconnected|crash/i.test(String(err))) throw err;
    console.log(`[reference] ${opts.tier} ${opts.shot}: browser closed (${String(err).split("\n")[0]}); retrying once`);
    await holder.browser.close().catch(() => {});
    holder.browser = await launch();
    return runShot(holder.browser, baseUrl, opts);
  }
}

async function captureAll(holder, baseUrl, { tiers, shots, width }) {
  const out = {};
  for (const tier of tiers) {
    for (const shot of shots) {
      const plan = planFor(shot, { level: REFERENCE_LEVEL[tier], record: false, capture: true, width });
      if (shot === "poster-hold") {
        plan.steps.unshift({ frame: 0, do: "capture", name: "handover-scene", width }, { frame: 0, do: "capturePoster", name: "handover-poster", width });
      }
      const { captures, snap } = await runShotRetrying(holder, baseUrl, { tier, shot, plan, probe: { virtualTime: true }, throttle: false });
      for (const [name, c] of Object.entries(captures)) out[`${tier}/${name}`] = { ...c, img: decode(c.dataUrl), pin: snap.pin };
      if (!captures[shot]) console.log(`[reference] ${tier} ${shot}: no capture (${snap.errors.join("; ") || "no error"})`);
    }
  }
  return out;
}

export async function reference({ baseUrl, outDir, args = {} }) {
  const tiers = list(args.tiers) ?? ["high", "low"];
  const shots = list(args.shots) ?? SHOT_NAMES;
  const width = Number(args.width ?? 960);
  await loadPng();
  const holder = { browser: await launch() };
  const result = { takenAt: new Date().toISOString(), level: REFERENCE_LEVEL, width, frames: [], noise: [], handover: {} };
  try {
    const first = await captureAll(holder, baseUrl, { tiers, shots, width });
    const second = args.repeat ? await captureAll(holder, baseUrl, { tiers, shots, width }) : null;
    const framesDir = join(outDir, "frames");
    mkdirSync(framesDir, { recursive: true });

    for (const tier of tiers) {
      const s = first[`${tier}/handover-scene`];
      const p = first[`${tier}/handover-poster`];
      if (s && p) {
        result.handover[tier] = { ...imageDiff(s.img, p.img), poster: p.src };
        writeFileSync(join(framesDir, `${tier}-handover.png`), sideBySide(p.img, s.img, diffImage(p.img, s.img)));
      }
    }
    for (const [key, cap] of Object.entries(first)) {
      if (key.includes("handover")) continue;
      const [tier, shot] = key.split("/");
      writeFileSync(join(framesDir, `${tier}-${shot}.png`), encode(cap.img));
      if (second?.[key]) result.noise.push({ tier, shot, ...imageDiff(cap.img, second[key].img) });
      const refFile = join(REFERENCE_DIR, tier, `${shot}.png`);
      if (args.update) {
        mkdirSync(join(REFERENCE_DIR, tier), { recursive: true });
        writeFileSync(refFile, encode(cap.img));
        result.frames.push({ tier, shot, updated: true, size: `${cap.img.width}x${cap.img.height}`, frame: cap.frame });
      } else if (existsSync(refFile)) {
        const ref = PNG.sync.read(readFileSync(refFile));
        const d = imageDiff(ref, cap.img);
        const pass = d.mean <= LOOK_GATE;
        result.frames.push({ tier, shot, ...d, pass });
        if (!pass) writeFileSync(join(framesDir, `${tier}-${shot}-vs-reference.png`), sideBySide(ref, cap.img, diffImage(ref, cap.img)));
      } else {
        result.frames.push({ tier, shot, missing: true });
      }
    }
    if (args.update) {
      writeFileSync(join(REFERENCE_DIR, "manifest.json"), JSON.stringify({ takenAt: result.takenAt, level: REFERENCE_LEVEL, width, shots: Object.fromEntries(shots.map((s) => [s, SHOTS[s].note])), handover: result.handover, noise: result.noise }, null, 2) + "\n");
    }
  } finally {
    await holder.browser.close();
  }
  const file = saveResult("reference", result, outDir);
  for (const f of result.frames) console.log(`[reference] ${f.tier} ${f.shot.padEnd(11)} ${f.updated ? "updated" : f.missing ? "no reference yet" : `mean ${f.mean.toFixed(2)}/255 ${f.pass ? "pass" : "FAIL"}`}`);
  for (const n of result.noise) console.log(`[reference] noise ${n.tier} ${n.shot.padEnd(11)} ${n.mean.toFixed(3)}/255 (worst pixel ${n.worst})`);
  for (const [tier, h] of Object.entries(result.handover)) console.log(`[reference] handover ${tier}: ${h.mean.toFixed(1)}/255`);
  console.log(`[reference] ${file}`);
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { withRig, outDirFor } = await import("./rig.mjs");
  const mode = args._[0] === "reference" ? "reference" : "run";
  const out = outDirFor(mode === "reference" ? "reference" : "frames");
  await withRig(`frames ${mode}`, (ctx) => (mode === "reference" ? reference : run)({ ...ctx, outDir: out, args }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
