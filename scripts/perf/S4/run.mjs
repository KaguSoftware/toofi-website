#!/usr/bin/env node
/**
 * Track S4's runner (search: drawing each frame). Everything is timed through the rig
 * (../rig.mjs: the production build of this checkout, served locally, under the machine-wide
 * measurement lock), with S4's probe (probe.js) installed after the rig's.
 *
 *   node scripts/perf/S4/run.mjs describe              what the scene and each level's pass chain are made of
 *   node scripts/perf/S4/run.mjs knockouts             frame cost of each variant (experiments.mjs) against the base
 *   node scripts/perf/S4/run.mjs levels                each level at its own pixel ratio, and across pixel ratios
 *   node scripts/perf/S4/run.mjs passes                frame time split by render pass
 *   node scripts/perf/S4/run.mjs overdraw              fragments shaded per material in the real draw order
 *   node scripts/perf/S4/run.mjs memory                textures and render targets held, per level
 *   node scripts/perf/S4/run.mjs startup               the first frames: WebGL calls by kind
 *   node scripts/perf/S4/run.mjs look                  candidate fixes against the reference frames
 *
 * Options: --tiers high,low  --shots opening,stop-3  --variants base,shadow-off  --reps 3  --levels 1,2,3
 *
 * Frame times here are "sync" times: the frame callback plus a one-pixel read-back that waits for
 * the GPU. They are real milliseconds on this machine's GPU (not a phone's), with JavaScript and
 * GPU work counted one after the other, so they are an upper bound on what a frame needs. The low
 * tier runs without the 4× CPU slowdown here: this track is about the GPU's share.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch, openPage, waitForFrame, waitForScene } from "../browser.mjs";
import { REFERENCE_DIR, imageDiff, list, mdTable, parseArgs, saveResult, summarizeFrames } from "../lib.mjs";
import { LEVELS, REFERENCE_LEVEL, SHOTS, SHOT_NAMES, planFor } from "../shots.mjs";
import { BEST_LEVEL, DPR_AT, KNOCKOUT_SHOTS, LEVEL_DPR, MUTATE_AT, REPEAT, SETTLE, TICKS, VARIANTS, blockAverage, familyTable, fmt, pairStats, pct, quantile, s4Config, splitWindows, summarizeSync } from "./experiments.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const S4_PROBE = readFileSync(join(HERE, "probe.js"), "utf8");
const TIER_PROFILE = { high: "desktop", low: "phone" };

/**
 * One fresh load of Home with both probes: a shot's plan, a level pin, and S4's configuration.
 *
 * @param {any} browser
 * @param {string} baseUrl
 * @param {{ tier: string, shot: string, level?: number | null, s4?: Record<string, unknown>, rigProbe?: Record<string, unknown>, record?: boolean, ticks?: number | null, capture?: boolean, extraSteps?: Array<Record<string, unknown> & { frame: number }>, extraFrames?: number }} options
 */
export async function runOne(browser, baseUrl, { tier, shot, level = null, s4 = {}, rigProbe = {}, record = true, ticks = null, capture = false, extraSteps = [], extraFrames = 0 }) {
  // `ticks` shortens the shot's recording window (it starts where the shot's own does).
  const plan = planFor(shot, { level, record: record && ticks === null, capture });
  if (record && ticks !== null) {
    const from = SHOTS[shot].record[0];
    extraSteps = [...extraSteps, { frame: from, do: "record", on: true }, { frame: from + ticks, do: "record", on: false }];
  }
  const steps = [...plan.steps, ...extraSteps].sort((a, b) => a.frame - b.frame);
  const { context, page } = await openPage(browser, TIER_PROFILE[tier], { probe: { ...rigProbe, plan: steps }, throttle: false });
  await context.addInitScript(`window.__S4_CONFIG__ = ${JSON.stringify(s4)};`);
  await context.addInitScript(S4_PROBE);
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  try {
    await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
    await waitForScene(page);
    await waitForFrame(page, Math.max(plan.lastFrame, ...steps.map((s) => s.frame + 2)) + extraFrames);
    await page.waitForTimeout(150);
    const rig = await page.evaluate(() => window.__rig.snapshot());
    const s4snap = await page.evaluate(() => window.__s4.snapshot());
    const captures = capture ? await page.evaluate(() => window.__rig.captures) : {};
    return { rig, s4: s4snap, captures, errors: [...rig.errors, ...s4snap.errors, ...pageErrors] };
  } finally {
    await context.close();
  }
}

const tiersOf = (args) => list(args.tiers) ?? ["high", "low"];

/** How a command times: frames per tick and ticks timed (--repeat, --ticks). */
const pace = (args) => ({ repeat: Number(args.repeat ?? REPEAT), ticks: Number(args.ticks ?? TICKS) });

/**
 * One page load, two windows at the same camera: the shipped frame for `ticks` ticks, then
 * `mutations` (given without frames), `SETTLE` ticks for them to settle, and the changed frame
 * for `ticks` ticks. Returns each window's frame time and what the rig counted in it.
 *
 * @param {any} browser
 * @param {string} baseUrl
 * @param {{ tier: string, shot: string, level: number | null, mutations: Array<Record<string, unknown>>, repeat: number, ticks: number }} options
 */
export async function paired(browser, baseUrl, { tier, shot, level, mutations, repeat, ticks }) {
  const from = SHOTS[shot].record[0];
  const change = from + ticks;
  const resume = change + SETTLE;
  // A step marked `after` lands that many ticks after the change (a pixel ratio after a level change).
  const timedMutations = mutations.map((m) => {
    const step = { ...m, frame: change + Number(m.after ?? 0) };
    delete step.after;
    return step;
  });
  const cfg = { sync: true, repeat, mutations: timedMutations };
  const run = await runOne(browser, baseUrl, { tier, shot, level, ticks: resume + ticks - from, s4: cfg });
  const windows = { from, change, resume };
  const time = splitWindows(run.s4.frames, windows);
  const counted = splitWindows(run.rig.frames, windows);
  const n = Math.max(1, run.s4.frames[0]?.drawn ?? 1);
  const side = (frames, rigFrames) => {
    const f = summarizeFrames(rigFrames);
    return { ...summarizeSync(frames), calls: f.calls.median / n, triangles: f.triangles.median / n, sceneTriangles: f.sceneTriangles.median, passes: f.passes / n, buffer: f.drawingBuffer };
  };
  return { a: side(time.a, counted.a), b: side(time.b, counted.b), perTick: n, done: run.s4.done, skipped: run.s4.skipped, errors: run.errors };
}

// ---------------------------------------------------------------- describe

export async function describe({ baseUrl, outDir, args }) {
  const browser = await launch();
  const out = {};
  try {
    for (const tier of tiersOf(args)) {
      for (const level of LEVELS[tier]) {
        const run = await runOne(browser, baseUrl, { tier, shot: "stop-1", level, s4: { describe: true, memory: true } });
        out[`${tier}-L${level}`] = { describe: run.s4.describe, passOrder: run.s4.passOrder, memory: run.s4.memory, errors: run.errors };
        console.log(`\n[describe] ${tier} level ${level}: ${run.s4.passOrder.length} passes, buffer ${run.s4.describe?.renderer?.buffer}`);
        run.s4.passOrder.forEach((l, i) => console.log(`  ${String(i).padStart(2)} ${l}`));
        if (run.errors.length) console.log("  errors:", run.errors);
      }
      const d = out[`${tier}-L${BEST_LEVEL[tier]}`].describe;
      console.log(`\n[describe] ${tier} scene children:`);
      for (const c of d.children) console.log(`  ${(c.name || "(unnamed)").padEnd(22)} ${c.type.padEnd(18)} meshes ${c.meshes} instances ${c.instances} order ${c.renderOrder}`);
      console.log(`[describe] ${tier} materials (${d.materials.length}), programs ${d.renderer.programs}`);
      for (const m of d.materials) console.log(`  #${m.id} ${(m.name || "(unnamed)").padEnd(26)} ${m.type.padEnd(22)} ×${m.users} ${m.transparent ? "blend " : ""}${m.alphaTest ? `cut ${m.alphaTest} ` : ""}${m.side === 2 ? "double " : ""}${m.baked ? `baked:${m.baked} ` : ""}[${m.maps.join(",")}]`);
    }
  } finally {
    await browser.close();
  }
  console.log(`[describe] ${saveResult("describe", out, outDir)}`);
  return out;
}

// ---------------------------------------------------------------- knock-outs

export async function knockouts({ baseUrl, outDir, args }) {
  const reps = Number(args.reps ?? 2);
  const shots = list(args.shots) ?? KNOCKOUT_SHOTS;
  const { repeat, ticks } = pace(args);
  const browser = await launch();
  const rows = [];
  try {
    for (const tier of tiersOf(args)) {
      const level = args.level !== undefined ? Number(args.level) : BEST_LEVEL[tier];
      const ids = (list(args.variants) ?? Object.keys(VARIANTS)).filter((id) => id !== "base" && VARIANTS[id]?.tiers.includes(tier));
      for (const shot of shots) {
        // Nothing changed, timed the same way: what two windows differ by on their own.
        let noise = 0;
        for (const id of ["base", ...ids]) {
          const runs = [];
          for (let i = 0; i < (id === "base" ? Math.max(reps, 3) : reps); i++) runs.push(await paired(browser, baseUrl, { tier, shot, level, mutations: VARIANTS[id].mutations, repeat, ticks }));
          const stats = pairStats(runs.map((r) => ({ a: r.a.ms, b: r.b.ms })), id === "base" ? 0 : noise);
          if (id === "base") noise = Math.max(Math.abs(stats.lo), Math.abs(stats.hi));
          const row = { tier, level, shot, variant: id, note: VARIANTS[id].note, look: VARIANTS[id].look, repeat, ...stats, noise, jsMs: runs[0].a.jsMs, jsAfter: runs[0].b.jsMs, calls: runs[0].a.calls, callsAfter: runs[0].b.calls, triangles: runs[0].a.triangles, trianglesAfter: runs[0].b.triangles, buffer: runs[0].a.buffer, skipped: runs[0].skipped, done: runs[0].done, errors: runs.flatMap((r) => r.errors) };
          rows.push(row);
          console.log(
            `[knockouts] ${tier} L${level} ${shot.padEnd(8)} ${id.padEnd(18)} ${fmt(stats.ms, 2).padStart(6)} → ${fmt(stats.after, 2).padStart(6)} ms  ${id === "base" ? `noise ±${fmt(noise, 2)}` : `saves ${fmt(stats.saved, 2)} ms (${fmt(stats.lo, 2)} to ${fmt(stats.hi, 2)}) ${pct(stats.share)}${stats.sure ? "" : " (within noise)"}`}  js ${fmt(row.jsMs, 2)}→${fmt(row.jsAfter, 2)}  tris ${Math.round(row.triangles)}→${Math.round(row.trianglesAfter)} calls ${Math.round(row.calls)}→${Math.round(row.callsAfter)} ×${runs[0].perTick}${row.errors.length ? `  ERRORS ${row.errors.slice(0, 2).join("; ")}` : ""}`,
          );
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`[knockouts] ${saveResult(args.name ?? "knockouts", { takenAt: new Date().toISOString(), reps, repeat, ticks, rows }, outDir)}`);
  console.log("\n" + knockoutTable(rows));
  return rows;
}

export function knockoutTable(rows) {
  return mdTable(rows, [
    ["Tier", (r) => `${r.tier} L${r.level}`],
    ["Camera", (r) => r.shot],
    ["Variant", (r) => r.variant],
    ["Frame (ms)", (r) => fmt(r.ms, 2)],
    ["After (ms)", (r) => fmt(r.after, 2)],
    ["Saves (ms)", (r) => (r.variant === "base" ? `±${fmt(r.noise, 2)}` : `${fmt(r.saved, 2)} (${fmt(r.lo, 2)} to ${fmt(r.hi, 2)})`)],
    ["Share of frame", (r) => (r.variant === "base" ? "" : `${pct(r.share)}${r.sure ? "" : " (noise)"}`)],
    ["Triangles", (r) => `${Math.round(r.triangles).toLocaleString("en-US")} → ${Math.round(r.trianglesAfter).toLocaleString("en-US")}`],
    ["Calls", (r) => `${Math.round(r.calls)} → ${Math.round(r.callsAfter)}`],
  ]);
}

// ---------------------------------------------------------------- levels and pixel ratios

/**
 * Each level's chain and each pixel ratio against the tier's best level, paired in one page load
 * (the best level first, then the cell). A cell's frame time is the best level's (the median of
 * every pair's first window at that camera) plus the pair's difference.
 */
export async function levels({ baseUrl, outDir, args }) {
  const reps = Number(args.reps ?? 2);
  const shots = list(args.shots) ?? KNOCKOUT_SHOTS;
  const { repeat, ticks } = pace(args);
  const browser = await launch();
  const rows = [];
  try {
    for (const tier of tiersOf(args)) {
      const top = BEST_LEVEL[tier];
      const cells = [];
      for (const level of LEVELS[tier]) cells.push({ level, dpr: LEVEL_DPR[level] });
      for (const level of LEVELS[tier]) if (level !== top) cells.push({ level, dpr: LEVEL_DPR[top] });
      for (const dpr of tier === "high" ? [1, 1.25, 1.5, 2] : [1, 1.5, 2]) if (dpr !== LEVEL_DPR[top]) cells.push({ level: top, dpr });
      for (const shot of shots) {
        const mine = [];
        for (const { level, dpr } of cells) {
          const mutations = [];
          if (level !== top) mutations.push({ do: "pinLevel", level, step: 2 });
          if (dpr !== LEVEL_DPR[level] || level !== top) mutations.push({ do: "dpr", value: dpr, after: 3 });
          const runs = [];
          for (let i = 0; i < reps; i++) runs.push(await paired(browser, baseUrl, { tier, shot, level: top, mutations, repeat, ticks }));
          const stats = pairStats(runs.map((r) => ({ a: r.a.ms, b: r.b.ms })));
          const [w, h] = (runs[0].b.buffer ?? "0x0").split("x").map(Number);
          mine.push({ tier, shot, level, dpr, reference: stats.ms, difference: -stats.saved, lo: -stats.hi, hi: -stats.lo, buffer: runs[0].b.buffer, megapixels: (w * h) / 1e6, passes: runs[0].b.passes, jsMs: runs[0].b.jsMs, errors: runs.flatMap((r) => r.errors) });
        }
        const reference = quantile(mine.map((r) => r.reference), 0.5);
        for (const r of mine) {
          r.ms = reference + r.difference;
          rows.push(r);
          console.log(`[levels] ${tier} ${shot.padEnd(8)} L${r.level} @${r.dpr}  ${fmt(r.ms, 2).padStart(6)} ms (${r.difference >= 0 ? "+" : ""}${fmt(r.difference, 2)} against L${top}, ${fmt(r.lo, 2)} to ${fmt(r.hi, 2)})  ${r.buffer} passes ${Math.round(r.passes)}${r.errors.length ? `  ERRORS ${r.errors[0]}` : ""}`);
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`[levels] ${saveResult(args.name ?? "levels", { takenAt: new Date().toISOString(), reps, repeat, ticks, rows }, outDir)}`);
  return rows;
}

// ---------------------------------------------------------------- passes

export async function passes({ baseUrl, outDir, args }) {
  const shots = list(args.shots) ?? SHOT_NAMES.filter((s) => s !== "poster-hold");
  // Per-pass read-backs keep the GPU busy by themselves; a few frames per tick close the gap between ticks.
  const repeat = Number(args.repeat ?? 3);
  const ticks = Number(args.ticks ?? TICKS);
  const browser = await launch();
  const rows = [];
  try {
    for (const tier of tiersOf(args)) {
      const lv = list(args.levels)?.map(Number) ?? [BEST_LEVEL[tier]];
      for (const level of lv) {
        for (const shot of shots) {
          const run = await runOne(browser, baseUrl, { tier, shot, level, ticks, s4: { syncPass: true, sync: true, repeat } });
          const n = run.s4.passFrames;
          const families = familyTable(run.s4.passes, n);
          const s = summarizeSync(run.s4.frames);
          const f = summarizeFrames(run.rig.frames);
          rows.push({ tier, level, shot, frames: n, repeat, ms: s.ms, families, passes: Object.entries(run.s4.passes).map(([label, p]) => ({ label, ms: p.ms / n, perFrame: p.n / n })), buffer: f.drawingBuffer, sceneTriangles: f.sceneTriangles.median, shadowTriangles: f.shadowTriangles / repeat, errors: run.errors });
          console.log(`[passes] ${tier} L${level} ${shot.padEnd(8)} ${fmt(s.ms, 2)} ms  ` + families.map((x) => `${x.family} ${fmt(x.ms, 2)}`).join(" · "));
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`[passes] ${saveResult(args.name ?? "passes", { takenAt: new Date().toISOString(), rows }, outDir)}`);
  const families = [...new Set(rows.flatMap((r) => r.families.map((f) => f.family)))];
  console.log(
    "\n" +
      mdTable(rows, [
        ["Tier", (r) => `${r.tier} L${r.level}`],
        ["Camera", (r) => r.shot],
        ["Frame, passes synced (ms)", (r) => fmt(r.ms, 2)],
        ...families.map((fam) => [fam, (r) => fmt(r.families.find((f) => f.family === fam)?.ms ?? NaN, 2)]),
      ]),
  );
  return rows;
}

// ---------------------------------------------------------------- overdraw

export async function overdraw({ baseUrl, outDir, args }) {
  const shots = list(args.shots) ?? SHOT_NAMES.filter((s) => !["poster-hold", "orbit"].includes(s));
  const orders = list(args.variants) ?? ["base", "sky-last", "ground-last"];
  const browser = await launch();
  const rows = [];
  mkdirSync(join(outDir, "overdraw"), { recursive: true });
  try {
    for (const tier of tiersOf(args)) {
      for (const shot of shots) {
        for (const id of orders) {
          const cfg = s4Config(id, { sync: false });
          const frame = planFor(shot, { record: true }).lastFrame - 4;
          cfg.mutations.push({ frame, do: "overdraw" });
          const run = await runOne(browser, baseUrl, { tier, shot, level: BEST_LEVEL[tier], s4: cfg, extraFrames: 6 });
          const o = run.s4.overdraw;
          if (!o) {
            console.log(`[overdraw] ${tier} ${shot} ${id}: no result ${run.errors.join("; ")}`);
            continue;
          }
          writeFileSync(join(outDir, "overdraw", `${tier}-${shot}-${id}.png`), Buffer.from(o.heat.split(",")[1], "base64"));
          // The heat map is the PNG just written; the JSON keeps the counts.
          const counts = { ...o };
          delete counts.heat;
          rows.push({ tier, shot, order: id, ...counts, errors: run.errors });
          console.log(`[overdraw] ${tier} ${shot.padEnd(8)} ${id.padEnd(12)} shaded ${fmt(o.total, 2)} screens (opaque ${fmt(o.opaqueShaded, 2)}, of which visible ${fmt(o.opaqueVisible, 2)}; blended ${fmt(o.transparentShaded, 2)}); raster ${fmt(o.raster, 2)}`);
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`[overdraw] ${saveResult(args.name ?? "overdraw", { takenAt: new Date().toISOString(), rows }, outDir)}`);
  console.log(
    "\n" +
      mdTable(rows, [
        ["Tier", (r) => r.tier],
        ["Camera", (r) => r.shot],
        ["Draw order", (r) => r.order],
        ["Fragments shaded (screens)", (r) => fmt(r.total, 2)],
        ["Opaque shaded", (r) => fmt(r.opaqueShaded, 2)],
        ["Opaque visible", (r) => fmt(r.opaqueVisible, 2)],
        ["Wasted", (r) => fmt(r.opaqueShaded - r.opaqueVisible, 2)],
        ["Blended", (r) => fmt(r.transparentShaded, 2)],
        ["Covered with no depth test", (r) => fmt(r.raster, 2)],
      ]),
  );
  return rows;
}

// ---------------------------------------------------------------- memory

export async function memory({ baseUrl, outDir, args }) {
  const browser = await launch();
  const rows = [];
  try {
    for (const tier of tiersOf(args)) {
      for (const level of LEVELS[tier]) {
        for (const shot of list(args.shots) ?? ["stop-1", "dusk"]) {
          const run = await runOne(browser, baseUrl, { tier, shot, level, s4: { memory: true } });
          const rigMem = run.s4.memory;
          rows.push({ tier, level, shot, ...rigMem, errors: run.errors });
          console.log(`\n[memory] ${tier} L${level} ${shot}: ${fmt(rigMem.total / 2 ** 20, 0)} MB in ${rigMem.textures} textures and ${rigMem.renderbuffers} renderbuffers`);
          for (const g of rigMem.groups.slice(0, 14)) console.log(`  ${fmt(g.bytes / 2 ** 20, 1).padStart(7)} MB  ${String(g.count).padStart(3)} × ${g.key}`);
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`[memory] ${saveResult(args.name ?? "memory", { takenAt: new Date().toISOString(), rows }, outDir)}`);
  return rows;
}

// ---------------------------------------------------------------- start-up

export async function startup({ baseUrl, outDir, args }) {
  const reps = Number(args.reps ?? 3);
  const rows = [];
  for (const tier of tiersOf(args)) {
    for (let i = 0; i < reps; i++) {
      // A fresh browser each time: nothing compiled in the GPU process.
      const browser = await launch();
      try {
        const run = await runOne(browser, baseUrl, { tier, shot: "poster-hold", level: null, s4: { startup: { frames: 8 } } });
        const frames = run.s4.startup.frames;
        rows.push({ tier, rep: i, frames, errors: run.errors });
        for (const f of frames.slice(0, 4)) {
          const kinds = Object.entries(f.kinds).map(([k, v]) => `${k} ${fmt(v.ms, 0)} ms/${v.n}`).join(", ");
          console.log(`[startup] ${tier} #${i} frame ${f.frame}: ${fmt(f.ms, 0)} ms to GPU done (js ${fmt(f.jsMs, 0)}); +${f.programs} programs +${f.textures} textures +${f.geometries} geometries; ${kinds}`);
          for (const p of f.passes.slice(0, 6)) console.log(`     pass ${p.label} ${fmt(p.ms, 0)} ms`);
          console.log(`     calls ${Object.entries(f.calls).slice(0, 6).map(([name, c]) => `${name} ${fmt(c.ms, 0)} ms/${c.n}`).join(", ")}`);
        }
      } finally {
        await browser.close();
      }
    }
  }
  console.log(`[startup] ${saveResult(args.name ?? "startup", { takenAt: new Date().toISOString(), rows }, outDir)}`);
  return rows;
}

// ---------------------------------------------------------------- the look of candidate fixes

/**
 * Captures each candidate under virtual time, as the reference frames were, and compares it with
 * the shipped scene captured the same way in the same run (and that one with the stored reference).
 */
export async function look({ baseUrl, outDir, args }) {
  const { PNG } = await import("pngjs");
  const ids = (list(args.variants) ?? Object.keys(VARIANTS).filter((id) => VARIANTS[id].look !== "breaks")).filter((id) => id !== "base");
  const shots = list(args.shots) ?? SHOT_NAMES;
  const browser = await launch();
  const rows = [];
  mkdirSync(join(outDir, "look"), { recursive: true });
  const capture = async (tier, id, shot) => {
    // The level is pinned on fixed frames (probe.js pinLevel) and the change made on frame 12, so
    // every captured frame has both and two captures of the same thing are the same picture.
    const level = REFERENCE_LEVEL[tier];
    const pin = [
      { frame: 1, do: "pinLevel", level, step: 1 },
      { frame: 8, do: "pinLevel", level, step: 2 },
    ];
    const cfg = { sync: false, mutations: [...pin, ...s4Config(id, { at: 12 }).mutations] };
    const run = await runOne(browser, baseUrl, { tier, shot, level: null, s4: cfg, rigProbe: { virtualTime: true }, record: false, capture: true });
    const cap = run.captures[shot];
    if (!cap) {
      console.log(`[look] ${tier} ${id} ${shot}: no capture ${run.errors.join("; ")}`);
      return null;
    }
    const png = Buffer.from(cap.dataUrl.split(",")[1], "base64");
    writeFileSync(join(outDir, "look", `${tier}-${shot}-${id}.png`), png);
    return { img: PNG.sync.read(png), errors: run.errors };
  };
  // Each comparison both ways: every pixel, and 4 × 4 block averages (film grain cancelled).
  const compare = (a, b) => {
    const d = imageDiff(a, b);
    const smooth = imageDiff(blockAverage(a), blockAverage(b));
    return { ...d, grainFree: smooth.mean, grainFreeWorst: smooth.worst, grainFreeChanged: smooth.changedShare };
  };
  try {
    for (const tier of tiersOf(args)) {
      for (const shot of shots) {
        const base = await capture(tier, "base", shot);
        if (!base) continue;
        const ref = join(REFERENCE_DIR, tier, `${shot}.png`);
        if (existsSync(ref)) {
          const d = compare(PNG.sync.read(readFileSync(ref)), base.img);
          rows.push({ tier, variant: "base", against: "reference", shot, ...d, errors: base.errors });
          console.log(`[look] ${tier} ${"base vs reference".padEnd(20)} ${shot.padEnd(11)} mean ${d.mean.toFixed(3)}/255 worst ${d.worst}; grain-free ${d.grainFree.toFixed(3)} worst ${d.grainFreeWorst}`);
        }
        // The same thing captured twice: this harness's own noise (0 when captures repeat).
        const again = await capture(tier, "base", shot);
        if (again) {
          const d = compare(base.img, again.img);
          rows.push({ tier, variant: "base", against: "base", shot, ...d, errors: again.errors });
          console.log(`[look] ${tier} ${"base again".padEnd(20)} ${shot.padEnd(11)} mean ${d.mean.toFixed(3)}/255 worst ${d.worst}; grain-free ${d.grainFree.toFixed(3)} worst ${d.grainFreeWorst}`);
        }
        for (const id of ids.filter((v) => VARIANTS[v].tiers.includes(tier))) {
          const cap = await capture(tier, id, shot);
          if (!cap) continue;
          const d = compare(base.img, cap.img);
          rows.push({ tier, variant: id, against: "base", shot, ...d, pass: d.mean <= 2, errors: cap.errors });
          console.log(`[look] ${tier} ${id.padEnd(20)} ${shot.padEnd(11)} mean ${d.mean.toFixed(3)}/255 worst ${d.worst} changed ${(d.changedShare * 100).toFixed(2)}%; grain-free ${d.grainFree.toFixed(3)} worst ${d.grainFreeWorst} changed ${(d.grainFreeChanged * 100).toFixed(2)}%${cap.errors.length ? `  ERRORS ${cap.errors[0]}` : ""}`);
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`[look] ${saveResult(args.name ?? "look", { takenAt: new Date().toISOString(), rows }, outDir)}`);
  return rows;
}

export const COMMANDS = { describe, knockouts, levels, passes, overdraw, memory, startup, look };
export { DPR_AT, MUTATE_AT, SETTLE };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!COMMANDS[cmd]) {
    console.error(`usage: node scripts/perf/S4/run.mjs <${Object.keys(COMMANDS).join("|")}> [options]`);
    process.exit(2);
  }
  const { withRig, outDirFor } = await import("../rig.mjs");
  const outDir = args.out ? String(args.out) : outDirFor(`S4-${cmd}`);
  await withRig(`S4 ${cmd}`, (ctx) => COMMANDS[cmd]({ ...ctx, outDir, args }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
