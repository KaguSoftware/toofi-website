#!/usr/bin/env node
/**
 * Track S9: the tier and quality gates on the running site.
 *
 *   node scripts/perf/S9/live.mjs adapt  [--scenario heat,weak-phone,slow-desktop] [--tick 500]
 *   node scripts/perf/S9/live.mjs pixels [--viewports 1440x900@2,2560x1440@1,3840x2160@1] [--levels 2,3]
 *   node scripts/perf/S9/live.mjs network [--presets fast-4g,iraq-4g,fast-3g,slow-3g]
 *
 * adapt: the shipped adaptive quality over a long run while the CPU slowdown changes (a stand-in
 *   for a hot or slow device): the level read from the React state every tick, and the frame rate.
 * pixels: the same camera and level at larger canvases (a 4K monitor, a 5K display): frame cost
 *   and drawing-buffer size.
 * network: what navigator.connection says under each DevTools network preset, and what the page
 *   then did (3D or poster).
 *
 * Runs under the rig's lock on the rig's production build, with the P0 probe. No product code
 * changes. The GPU is this Mac's, so levels are compared with each other, not with a phone.
 */
import { pathToFileURL } from "node:url";
import { PROFILES, launch, openPage, waitForFrame, waitForScene } from "../browser.mjs";
import { fmtMs, fmtNum, list, mdTable, parseArgs, saveResult, summarizeFrames } from "../lib.mjs";
import { planFor } from "../shots.mjs";

// ------------------------------------------------------------------ adapt

/** CPU slowdown schedules: `at` seconds after the first frame, then `cpu` ×. */
export const SCENARIOS = {
  heat: { profile: "desktop", note: "A fast laptop that heats up: no slowdown, then 12×, then cooled", schedule: [{ at: 0, cpu: 1 }, { at: 30, cpu: 12 }, { at: 80, cpu: 1 }], seconds: 120 },
  "slow-desktop": { profile: "desktop", note: "A slow desktop from the start: 8× for the whole run", schedule: [{ at: 0, cpu: 8 }], seconds: 90 },
  "weak-phone": { profile: "phone", note: "The QA phone (4×) that gets a weaker phone's CPU (16×) after 30 s", schedule: [{ at: 0, cpu: 4 }, { at: 30, cpu: 16 }], seconds: 90 },
};

/** Collapses a tick timeline into runs of equal level: [{level, from, to}]. */
export function levelRuns(samples) {
  const runs = [];
  for (const s of samples) {
    if (s.level === null || s.level === undefined) continue;
    const last = runs.at(-1);
    if (last && last.level === s.level) last.to = s.t;
    else runs.push({ level: s.level, from: s.t, to: s.t });
  }
  return runs;
}

/** Average fps over the ticks inside [from, to). */
export function fpsBetween(samples, from, to) {
  const inside = samples.filter((s) => s.t >= from && s.t < to && s.fps !== null);
  return inside.length ? inside.reduce((a, s) => a + s.fps, 0) / inside.length : NaN;
}

async function adaptRun(browser, baseUrl, name, tickMs) {
  const sc = SCENARIOS[name];
  const { context, page, cdp } = await openPage(browser, sc.profile, { probe: {}, throttle: false });
  const setCpu = (rate) => cdp.send("Emulation.setCPUThrottlingRate", { rate });
  try {
    await setCpu(sc.schedule[0].cpu);
    await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
    await waitForScene(page);
    const t0 = Date.now();
    let prev = { frame: await page.evaluate(() => window.__rig.frame), t: t0 };
    const samples = [];
    let step = 0;
    while ((Date.now() - t0) / 1000 < sc.seconds) {
      await page.waitForTimeout(tickMs);
      const now = Date.now();
      const t = (now - t0) / 1000;
      while (step + 1 < sc.schedule.length && t >= sc.schedule[step + 1].at) {
        step += 1;
        await setCpu(sc.schedule[step].cpu);
      }
      const { frame, level } = await page.evaluate(() => ({ frame: window.__rig.frame, level: window.__rig.level() }));
      samples.push({ t: Math.round(t * 10) / 10, level: level?.level ?? null, tier: level?.tier ?? null, cpu: sc.schedule[step].cpu, fps: ((frame - prev.frame) * 1000) / (now - prev.t) });
      prev = { frame, t: now };
    }
    return { name, note: sc.note, schedule: sc.schedule, samples, runs: levelRuns(samples) };
  } finally {
    await context.close();
  }
}

export async function adapt({ baseUrl, outDir, args = {} }) {
  const names = list(args.scenario) ?? Object.keys(SCENARIOS);
  const tickMs = Number(args.tick ?? 500);
  const browser = await launch();
  const results = [];
  try {
    for (const name of names) {
      const r = await adaptRun(browser, baseUrl, name, tickMs);
      results.push(r);
      console.log(`[S9 adapt] ${name}: ${r.note}`);
      for (const run of r.runs) console.log(`   level ${run.level}  ${run.from.toFixed(1)}–${run.to.toFixed(1)} s  fps ${fmtNum(fpsBetween(r.samples, run.from, run.to + tickMs / 1000), 1)}`);
      for (const [i, seg] of r.schedule.entries()) {
        const to = r.schedule[i + 1]?.at ?? sc(r.name).seconds;
        console.log(`   cpu ${seg.cpu}× ${seg.at}–${to} s: fps ${fmtNum(fpsBetween(r.samples, seg.at, to), 1)}`);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`[S9 adapt] ${saveResult(args.name ?? "S9-adapt", { takenAt: new Date().toISOString(), results }, outDir)}`);
  return results;
}
const sc = (name) => SCENARIOS[name];

// ------------------------------------------------------------------ pixels

export function parseViewport(spec) {
  const m = /^(\d+)x(\d+)@([\d.]+)$/.exec(spec);
  if (!m) throw new Error(`viewport must look like 2560x1440@1, got ${spec}`);
  return { width: Number(m[1]), height: Number(m[2]), dpr: Number(m[3]) };
}

/** Pixels in the drawing buffer when the canvas is `viewport` at a level's maximum ratio. */
export function bufferPixels({ width, height, dpr }, maxDpr) {
  const ratio = Math.min(Math.max(1, dpr || 1), maxDpr);
  return Math.round(width * ratio) * Math.round(height * ratio);
}

export async function pixels({ baseUrl, outDir, args = {} }) {
  const specs = list(args.viewports) ?? ["1440x900@2", "2560x1440@1", "2560x1440@2", "3840x2160@1"];
  const levels = (list(args.levels) ?? ["2", "3"]).map(Number);
  const browser = await launch();
  const rows = [];
  try {
    for (const spec of specs) {
      const vp = parseViewport(spec);
      PROFILES.s9 = { ...PROFILES.desktop, viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr };
      for (const level of levels) {
        const plan = planFor("aerial", { level });
        const { context, page } = await openPage(browser, "s9", { probe: { gpuTimers: "frame", plan: plan.steps }, throttle: true });
        try {
          await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
          await waitForScene(page);
          await waitForFrame(page, plan.lastFrame);
          await page.waitForTimeout(150);
          const snap = await page.evaluate(() => window.__rig.snapshot());
          const s = summarizeFrames(snap.frames);
          const row = { viewport: spec, level, pin: snap.pin?.ok, buffer: s.drawingBuffer, dpr: s.dpr, megapixels: (() => { const [w, h] = (s.drawingBuffer ?? "0x0").split("x").map(Number); return (w * h) / 1e6; })(), fps: s.fps, over20: s.overBudget, frames: s.frames, gpuMs: s.gpuMs.median, cpuMs: s.cpuMs.median };
          rows.push(row);
          console.log(`[S9 pixels] ${spec} L${level}: buffer ${row.buffer} (${fmtNum(row.megapixels, 2)} MP, dpr ${row.dpr})  fps ${fmtNum(row.fps)}  GPU timer ${fmtMs(row.gpuMs, 1)}  JS ${fmtMs(row.cpuMs, 1)}  pin ${row.pin}`);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${pixelsTable(rows)}\n[S9 pixels] ${saveResult(args.name ?? "S9-pixels", { takenAt: new Date().toISOString(), rows }, outDir)}`);
  return rows;
}

export function pixelsTable(rows) {
  return mdTable(rows, [
    ["Viewport (CSS px @ ratio)", (r) => r.viewport],
    ["Level", (r) => r.level],
    ["Drawing buffer", (r) => r.buffer],
    ["Megapixels", (r) => fmtNum(r.megapixels, 2)],
    ["fps", (r) => fmtNum(r.fps)],
    ["GPU timer (relative)", (r) => fmtMs(r.gpuMs, 1)],
  ]);
}

// ------------------------------------------------------------------ network

export const NETWORK_PRESETS = {
  "fast-4g": { downloadThroughput: (9e6 / 8) * 0.9, uploadThroughput: (1.5e6 / 8) * 0.9, latency: 165 },
  "fast-3g": { downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (750e3 / 8) * 0.9, latency: 562.5 },
  "slow-3g": { downloadThroughput: (500e3 / 8) * 0.8, uploadThroughput: (500e3 / 8) * 0.8, latency: 2000 },
  "iraq-4g": { downloadThroughput: (5e6 / 8) * 0.9, uploadThroughput: (1e6 / 8) * 0.9, latency: 300 },
};

export async function network({ baseUrl, outDir, args = {} }) {
  const presets = list(args.presets) ?? ["fast-4g", "iraq-4g", "fast-3g", "slow-3g"];
  const browser = await launch();
  const rows = [];
  try {
    for (const name of presets) {
      const { context, page, cdp } = await openPage(browser, "phone", { probe: {}, throttle: false });
      try {
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await cdp.send("Network.emulateNetworkConditions", { offline: false, ...NETWORK_PRESETS[name] });
        const t0 = Date.now();
        await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
        // Chrome's estimate settles as requests complete; read it at three moments.
        const read = () => page.evaluate(() => ({ effectiveType: navigator.connection?.effectiveType ?? null, rtt: navigator.connection?.rtt ?? null, downlink: navigator.connection?.downlink ?? null, scene: !!(window.__rig && window.__rig.started), canvas: !!document.querySelector(".xp__canvas canvas") }));
        await page.waitForTimeout(4000);
        const early = await read();
        await page.waitForTimeout(16000);
        const late = await read();
        rows.push({ preset: name, early, late, seconds: (Date.now() - t0) / 1000 });
        console.log(`[S9 network] ${name}: at 4 s ${JSON.stringify(early)}  at 20 s ${JSON.stringify(late)}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`[S9 network] ${saveResult(args.name ?? "S9-network", { takenAt: new Date().toISOString(), rows }, outDir)}`);
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0];
  const fn = { adapt, pixels, network }[mode];
  if (!fn) {
    console.error("usage: live.mjs adapt|pixels|network");
    process.exit(2);
  }
  const { withRig, outDirFor } = await import("../rig.mjs");
  const out = outDirFor(`S9-${mode}`);
  await withRig(`S9 ${mode}`, (ctx) => fn({ ...ctx, outDir: out, args }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
