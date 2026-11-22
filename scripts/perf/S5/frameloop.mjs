#!/usr/bin/env node
/**
 * Track S5: JavaScript per frame, React commits per frame, and what each frame allocates.
 *
 *   node scripts/perf/S5/frameloop.mjs [--tiers high,low] [--shots opening,walk-long] [--levels adaptive,2] [--runs 2]
 *   node scripts/perf/S5/frameloop.mjs alloc [--tiers …] [--shots …]
 *
 * Timing (default): every S5 camera (shots-s5.mjs) on both tiers; for each recorded frame, the
 * whole requestAnimationFrame callback, each useFrame subscriber by name, the time outside them
 * (the render and React Three Fiber's own work), React commits per second and the components
 * they rendered, and every frame over 20 ms with what was in it.
 *
 * `alloc`: the same cameras with V8's sampling heap profiler and a GC trace running over the
 * recording window: bytes allocated per second, where (function, script, line, and a snippet of
 * the minified source so the site can be found), and minor/major GC count and pause time.
 * Profiling slows the page, so its frame times are not kept.
 *
 * Runs under the rig's lock, on the rig's production build (../rig.mjs).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launch, openPage, waitForScene } from "../browser.mjs";
import { PERF_DIR, fmtBytes, fmtMs, fmtNum, list, mdTable, parseArgs, saveResult, summarizeFrames } from "../lib.mjs";
import { commitSummary, levelChanges, longFrames, subscriberTable } from "./labels.mjs";
import { S5_SHOT_NAMES, S5_SHOTS, planS5 } from "./shots-s5.mjs";

const TIER_PROFILE = { high: "desktop", low: "phone" };
export const S5_PROBE = readFileSync(join(PERF_DIR, "S5", "probe-s5.js"), "utf8");

/** Opens Home with both probes, plans the shot (resolving scroll sweeps once laid out) and waits for the scene. */
export async function openShot(browser, baseUrl, { tier, shot, level }) {
  const { context, page, cdp } = await openPage(browser, TIER_PROFILE[tier], { probe: { gpuTimers: false }, throttle: true });
  await context.addInitScript(S5_PROBE);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
  // Sweep steps need the page's layout: resolve them before the first frame.
  const probePlan = planS5(shot, { level, scrollRange: await scrollRange(page) });
  await page.evaluate((steps) => window.__rig.setPlan(steps), probePlan.steps);
  await waitForScene(page);
  return { context, page, cdp, plan: probePlan, errors };
}

async function scrollRange(page) {
  await page.waitForSelector("[data-beat]", { timeout: 30000 });
  return page.evaluate(() => {
    const beats = document.querySelectorAll("[data-beat]");
    const last = beats[beats.length - 1];
    return { top: 0, bottom: last.getBoundingClientRect().top + window.scrollY };
  });
}

async function waitUntilFrame(page, frame) {
  await page.waitForFunction((n) => window.__rig.frame >= n, frame, { timeout: 180000, polling: 100 });
}

async function timingRun(browser, baseUrl, { tier, shot, level }) {
  const { context, page, plan, errors } = await openShot(browser, baseUrl, { tier, shot, level });
  try {
    await waitUntilFrame(page, plan.lastFrame);
    await page.waitForTimeout(100);
    const rigSnap = await page.evaluate(() => window.__rig.snapshot());
    const s5 = await page.evaluate(() => window.__s5.snapshot());
    return { rigSnap, s5, errors };
  } finally {
    await context.close();
  }
}

/** Timing: subscribers, commits and long frames per camera. */
export async function run({ baseUrl, outDir, args = {} }) {
  const tiers = list(args.tiers) ?? ["high", "low"];
  const shots = list(args.shots) ?? S5_SHOT_NAMES;
  const levels = list(args.levels) ?? ["adaptive"];
  const runs = Number(args.runs ?? 1);
  const browser = await launch();
  const rows = [];
  try {
    for (const tier of tiers) {
      for (const lv of levels) {
        for (const shot of shots) {
          for (let r = 1; r <= runs; r++) {
            const level = lv === "adaptive" ? null : Number(lv);
            const { rigSnap, s5, errors } = await timingRun(browser, baseUrl, { tier, shot, level });
            const frames = summarizeFrames(rigSnap.frames);
            const seconds = rigSnap.frames.length / 60;
            const subs = subscriberTable(s5);
            const commits = commitSummary(s5, seconds);
            const long = longFrames(s5, rigSnap.frames);
            const changes = levelChanges(rigSnap.frames);
            const row = { tier, level: lv, shot, run: r, frames, subs, commits, long, levelChanges: changes, passes: frames.passes, errors: [...rigSnap.errors, ...s5.errors, ...errors] };
            rows.push(row);
            console.log(
              `[S5] ${tier} ${String(lv).padEnd(8)} ${shot.padEnd(12)} #${r}  fps ${fmtNum(frames.fps).padStart(3)}  >20ms ${frames.overBudget}/${frames.frames}  cb ${fmtMs(subs.callback.median, 2)} (p95 ${fmtMs(subs.callback.p95, 2)})  outside ${fmtMs(subs.outsideSubscribers.median, 2)}  commits dom ${commits.dom} r3f ${commits.r3f}`,
            );
            console.log(`        other rAF ${fmtMs(subs.otherCallbacks.median, 2)} (p95 ${fmtMs(subs.otherCallbacks.p95, 2)})  GPU uploads/frame: buffers ${fmtBytes(subs.uploads.bufferMean)} mean (median ${fmtBytes(subs.uploads.bufferMedian)}), textures ${fmtBytes(subs.uploads.textureMean)} mean, worst frame ${fmtBytes(subs.uploads.max)}`);
            for (const s of subs.rows.slice(0, 6)) console.log(`        ${s.label.padEnd(36)} mean ${fmtMs(s.mean, 3)}  p95 ${fmtMs(s.p95, 3)}  max ${fmtMs(s.max, 2)}`);
            if (changes.length) console.log(`        level changes (passes/frame): ${changes.map((c) => `${c.from}→${c.to} @${c.frame}`).join(", ")}`);
            for (const l of long.slice(0, 6)) console.log(`        long frame ${l.frame}: ${fmtMs(l.interval, 1)} (cb ${fmtMs(l.callback, 1)}, other rAF ${fmtMs(l.other, 1)}, render ${fmtMs(l.renderMs, 1)}, top ${l.top?.label ?? "-"} ${fmtMs(l.top?.ms, 1)}, commits ${l.commits}, passes ${l.passes}${l.levelChange ? ", LEVEL CHANGE" : ""})`);
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
  const file = saveResult(args.name ?? "S5-frameloop", { takenAt: new Date().toISOString(), shots: Object.fromEntries(shots.map((s) => [s, S5_SHOTS[s].note])), rows }, outDir);
  console.log(`\n${frameloopTable(rows)}\n[S5] ${file}`);
  return rows;
}

export function frameloopTable(rows) {
  return mdTable(rows, [
    ["Tier", (r) => r.tier],
    ["Level", (r) => r.level],
    ["Camera", (r) => r.shot],
    ["Frames > 20 ms", (r) => `${r.frames.overBudget}/${r.frames.frames}`],
    ["JS / frame (median)", (r) => fmtMs(r.subs.callback.median, 2)],
    ["p95", (r) => fmtMs(r.subs.callback.p95, 2)],
    ["Outside subscribers", (r) => fmtMs(r.subs.outsideSubscribers.median, 2)],
    ["Top subscriber (mean)", (r) => (r.subs.rows[0] ? `${r.subs.rows[0].label} ${fmtMs(r.subs.rows[0].mean, 2)}` : "")],
    ["GPU uploads / frame (mean)", (r) => (r.subs.uploads ? fmtBytes((r.subs.uploads.bufferMean ?? 0) + (r.subs.uploads.textureMean ?? 0)) : "")],
    ["Commits (page / scene)", (r) => `${r.commits.dom} / ${r.commits.r3f}`],
  ]);
}

// ------------------------------------------------------------------ allocations and GC

/** Sums a sampling heap profile's self sizes by call site (function, url, line, column). */
export function allocationSites(profile) {
  const sites = new Map();
  let total = 0;
  const walk = (node) => {
    const cf = node.callFrame;
    const key = `${cf.functionName}|${cf.url}|${cf.lineNumber}|${cf.columnNumber}`;
    if (node.selfSize) {
      const s = sites.get(key) ?? { functionName: cf.functionName || "(anonymous)", url: cf.url, line: cf.lineNumber, column: cf.columnNumber, bytes: 0 };
      s.bytes += node.selfSize;
      sites.set(key, s);
      total += node.selfSize;
    }
    for (const c of node.children ?? []) walk(c);
  };
  if (profile?.head) walk(profile.head);
  return { total, sites: [...sites.values()].sort((a, b) => b.bytes - a.bytes) };
}

/** Minor and major GC on the page's main thread, from trace events. */
export function gcFromTrace(events) {
  const main = new Set(events.filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`));
  const out = { minor: 0, major: 0, minorMs: 0, majorMs: 0, worstMs: 0 };
  for (const e of events) {
    if (e.ph !== "X" || !(e.name === "MinorGC" || e.name === "MajorGC")) continue;
    if (main.size && !main.has(`${e.pid}:${e.tid}`)) continue;
    const ms = (e.dur ?? 0) / 1000;
    if (e.name === "MinorGC") {
      out.minor += 1;
      out.minorMs += ms;
    } else {
      out.major += 1;
      out.majorMs += ms;
    }
    out.worstMs = Math.max(out.worstMs, ms);
  }
  return out;
}

const sourceCache = new Map();
async function snippet(url, line, column) {
  if (!url || !/^https?:/.test(url)) return null;
  try {
    let text = sourceCache.get(url);
    if (text === undefined) {
      text = await (await fetch(url)).text();
      sourceCache.set(url, text);
    }
    const lines = text.split("\n");
    const l = lines[line] ?? "";
    return l.slice(Math.max(0, column - 60), column + 140);
  } catch {
    return null;
  }
}

async function allocRun(browser, baseUrl, { tier, shot }) {
  const { context, page, cdp, errors } = await openShot(browser, baseUrl, { tier, shot, level: null });
  try {
    const [start, end] = S5_SHOTS[shot].record;
    await waitUntilFrame(page, start);
    const events = [];
    cdp.on("Tracing.dataCollected", (d) => events.push(...d.value));
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("Tracing.start", { categories: "devtools.timeline,v8,disabled-by-default-v8.gc", transferMode: "ReportEvents" });
    await cdp.send("HeapProfiler.startSampling", { samplingInterval: 1024, includeObjectsCollectedByMinorGC: true, includeObjectsCollectedByMajorGC: true });
    const t0 = await page.evaluate(() => [performance.now(), window.__rig.frame]);
    await waitUntilFrame(page, end);
    const t1 = await page.evaluate(() => [performance.now(), window.__rig.frame]);
    const { profile } = await cdp.send("HeapProfiler.stopSampling");
    const done = new Promise((ok) => cdp.once("Tracing.tracingComplete", ok));
    await cdp.send("Tracing.end");
    await done;
    const seconds = (t1[0] - t0[0]) / 1000;
    const framesDrawn = t1[1] - t0[1];
    const { total, sites } = allocationSites(profile);
    const top = [];
    for (const s of sites.slice(0, 12)) top.push({ ...s, perSecond: s.bytes / seconds, snippet: await snippet(s.url, s.line, s.column) });
    return { seconds, framesDrawn, bytes: total, perSecond: total / seconds, perFrame: framesDrawn ? total / framesDrawn : null, gc: gcFromTrace(events), top, errors };
  } finally {
    await context.close();
  }
}

export async function alloc({ baseUrl, outDir, args = {} }) {
  const tiers = list(args.tiers) ?? ["high", "low"];
  const shots = list(args.shots) ?? S5_SHOT_NAMES;
  const browser = await launch();
  const rows = [];
  try {
    for (const tier of tiers) {
      for (const shot of shots) {
        const r = await allocRun(browser, baseUrl, { tier, shot });
        rows.push({ tier, shot, ...r });
        console.log(`[S5 alloc] ${tier} ${shot.padEnd(12)} ${fmtBytes(r.perSecond)}/s (${fmtBytes(r.perFrame)}/frame over ${r.framesDrawn} frames)  GC minor ${r.gc.minor} (${fmtMs(r.gc.minorMs, 1)}) major ${r.gc.major} (${fmtMs(r.gc.majorMs, 1)}) worst ${fmtMs(r.gc.worstMs, 1)}`);
        for (const s of r.top.slice(0, 6)) console.log(`        ${fmtBytes(s.perSecond).padStart(10)}/s  ${s.functionName} ${s.url.split("/").pop()}:${s.line}:${s.column}  ${JSON.stringify(s.snippet?.slice(40, 140) ?? "")}`);
      }
    }
  } finally {
    await browser.close();
  }
  const file = saveResult(args.name ?? "S5-alloc", { takenAt: new Date().toISOString(), rows }, outDir);
  console.log(`[S5 alloc] ${file}`);
  return rows;
}

// ------------------------------------------------------------------ CPU profile

/** Self time per function from a V8 CPU profile, with the whole window's total. */
export function selfTimes(profile) {
  const nodes = new Map((profile?.nodes ?? []).map((n) => [n.id, n]));
  const samples = profile?.samples ?? [];
  const deltas = profile?.timeDeltas ?? [];
  const self = new Map();
  let total = 0;
  for (let i = 0; i < samples.length; i++) {
    // Each sample's time is the gap to the next one.
    const ms = (deltas[i + 1] ?? 0) / 1000;
    total += ms;
    self.set(samples[i], (self.get(samples[i]) ?? 0) + ms);
  }
  const byKey = new Map();
  for (const [id, ms] of self) {
    const cf = nodes.get(id)?.callFrame;
    if (!cf) continue;
    const key = `${cf.functionName}|${cf.url}|${cf.lineNumber}|${cf.columnNumber}`;
    const e = byKey.get(key) ?? { functionName: cf.functionName || "(anonymous)", url: cf.url, line: cf.lineNumber, column: cf.columnNumber, ms: 0 };
    e.ms += ms;
    byKey.set(key, e);
  }
  return { total, rows: [...byKey.values()].sort((a, b) => b.ms - a.ms) };
}

async function cpuRun(browser, baseUrl, { tier, shot }) {
  const { context, page, cdp, errors } = await openShot(browser, baseUrl, { tier, shot, level: null });
  try {
    const [start, end] = S5_SHOTS[shot].record;
    await waitUntilFrame(page, start);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    await cdp.send("Profiler.start");
    const f0 = await page.evaluate(() => window.__rig.frame);
    await waitUntilFrame(page, end);
    const f1 = await page.evaluate(() => window.__rig.frame);
    const { profile } = await cdp.send("Profiler.stop");
    const { total, rows } = selfTimes(profile);
    const frames = f1 - f0;
    const top = [];
    for (const r of rows.slice(0, 25)) top.push({ ...r, perFrame: frames ? r.ms / frames : null, snippet: await snippet(r.url, r.line, r.column) });
    return { frames, totalMs: total, top, errors };
  } finally {
    await context.close();
  }
}

export async function cpu({ baseUrl, outDir, args = {} }) {
  const tiers = list(args.tiers) ?? ["high", "low"];
  const shots = list(args.shots) ?? S5_SHOT_NAMES;
  const browser = await launch();
  const rows = [];
  try {
    for (const tier of tiers) {
      for (const shot of shots) {
        const r = await cpuRun(browser, baseUrl, { tier, shot });
        rows.push({ tier, shot, ...r });
        const busy = r.top.filter((x) => x.functionName !== "(idle)" && x.functionName !== "(program)");
        console.log(`[S5 cpu] ${tier} ${shot.padEnd(12)} ${r.frames} frames`);
        for (const x of busy.slice(0, 14)) console.log(`        ${fmtMs(x.perFrame, 3).padStart(10)}/frame  ${x.functionName} ${String(x.url).split("/").pop()}:${x.line}:${x.column}  ${JSON.stringify(x.snippet?.slice(50, 150) ?? "")}`);
      }
    }
  } finally {
    await browser.close();
  }
  const file = saveResult(args.name ?? "S5-cpu", { takenAt: new Date().toISOString(), rows }, outDir);
  console.log(`[S5 cpu] ${file}`);
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { withRig, outDirFor } = await import("../rig.mjs");
  const mode = ["alloc", "cpu"].includes(args._[0]) ? args._[0] : "run";
  const out = outDirFor(`S5-${mode === "run" ? "frameloop" : mode}`);
  const fn = { run, alloc, cpu }[mode];
  await withRig(`S5 ${mode}`, (ctx) => fn({ ...ctx, outDir: out, args }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
