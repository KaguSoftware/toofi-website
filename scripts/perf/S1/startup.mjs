#!/usr/bin/env node
/**
 * Start-up attribution (search track S1). Cold loads of Home on the rig's phone and desktop
 * profiles, each in a fresh Chrome, recorded three ways:
 *
 *   --trace   a Chrome trace with the CPU profile: every long task on the main thread, and what
 *             ran in it (timeline events, script files, WebGL calls, the functions on top)
 *   --gl      every WebGL call timed in the page: shader work, uploads and draws, split into
 *             before, during and after the scene's first frame
 *   --salt    as --gl, with every shader made unique, so no shader cache anywhere has seen it:
 *             what a first-ever visit pays (start-up numbers only, never frame rates)
 *
 *   node scripts/perf/S1/startup.mjs --trace [--profiles phone,desktop] [--runs 3] [--route /]
 *   node scripts/perf/S1/startup.mjs --gl --salt --runs 3
 *   node scripts/perf/S1/startup.mjs --modes gl,gl+salt,gl+precompile,trace   several in one session
 *   node scripts/perf/S1/startup.mjs --trace --keep     also keeps the raw traces (gzip)
 *
 * What-if switches (see glprobe.js): `nocheck` turns three.js's shader error check off;
 * `precompile` compiles every program ahead of the first frame without blocking.
 *   --loads 2   a second load in a new context of the same browser (its GPU process is warm)
 *   --block <pattern>   fail requests whose URL contains the pattern (what-if: without a file)
 *
 * The trace and the call timing each slow the page a little, so keep the plain rig numbers
 * (scripts/perf/trace.mjs) as the reference and read these for the shares.
 * Timing only happens inside the rig (it holds the measurement lock).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch, openPage, waitForScene } from "../browser.mjs";
import { fmtMs, list, mdTable, median, parseArgs, saveResult } from "../lib.mjs";
import { analyzeTrace, SHADER_CALLS } from "./analyze.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));

/** Trace categories: the timeline, tasks, the CPU profile, user timing and the GPU process. */
export const CATEGORIES = [
  "-*",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "toplevel",
  "v8.execute",
  "disabled-by-default-v8.cpu_profiler",
  "blink.user_timing",
  "loading",
  "gpu",
  "gpu.angle",
];

const UPLOADS = new Set(["texImage2D", "texSubImage2D", "texImage3D", "texSubImage3D", "texStorage2D", "texStorage3D", "compressedTexImage2D", "compressedTexSubImage2D", "generateMipmap", "bufferData", "bufferSubData"]);
const DRAWS = new Set(["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced", "drawRangeElements", "clear", "blitFramebuffer"]);

/** Which group a WebGL call belongs to. */
export function glGroup(name) {
  if (SHADER_CALLS.has(name)) return "shader";
  if (UPLOADS.has(name)) return "upload";
  if (DRAWS.has(name)) return "draw";
  return "other";
}

/**
 * The page's call tallies (`"phase:name" → { n, ms, max }`) to totals per phase and group, and
 * the calls that cost the most in each phase.
 */
export function summarizeGl(snapshot) {
  /** @type {Record<string, { totalMs: number, calls: number, groups: Record<string, number>, byCall: Array<{ name: string, n: number, ms: number, max: number }> }>} */
  const phases = {};
  for (const [key, c] of Object.entries(snapshot.calls ?? {})) {
    const [phase, name] = key.split(":");
    const p = (phases[phase] ??= { totalMs: 0, calls: 0, groups: {}, byCall: [] });
    const group = glGroup(name);
    p.totalMs += c.ms;
    p.calls += c.n;
    p.groups[group] = (p.groups[group] ?? 0) + c.ms;
    p.byCall.push({ name, n: c.n, ms: c.ms, max: c.max });
  }
  for (const p of Object.values(phases)) p.byCall.sort((a, b) => b.ms - a.ms);
  return {
    phases,
    programs: snapshot.programs ?? 0,
    programList: snapshot.programList ?? [],
    shaders: snapshot.shaders ?? 0,
    salted: snapshot.salted ?? 0,
    saltMisses: snapshot.saltMisses ?? 0,
    parallelCompile: (snapshot.extensions ?? []).includes("KHR_parallel_shader_compile"),
    workers: (snapshot.workers ?? []).length,
    wasm: snapshot.wasm ?? [],
    slow: [...(snapshot.slow ?? [])].sort((a, b) => b.ms - a.ms).slice(0, 40),
  };
}

/** Time spent in the GPU process's own trace events inside a window, by event name (top ones). */
export function gpuProcessIn(events, thread, start, end, n = 8) {
  const from = thread.navStart + start * 1000;
  const to = thread.navStart + end * 1000;
  const sums = new Map();
  for (const e of events) {
    if (e.ph !== "X" || typeof e.dur !== "number" || e.pid === thread.pid) continue;
    if (!/gpu/.test(e.cat ?? "")) continue;
    const eEnd = e.ts + e.dur;
    if (eEnd <= from || e.ts >= to) continue;
    sums.set(e.name, (sums.get(e.name) ?? 0) + (Math.min(eEnd, to) - Math.max(e.ts, from)));
  }
  return [...sums.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, us]) => ({ name, ms: us / 1000 }));
}

const GLPROBE = () => readFileSync(join(HERE, "glprobe.js"), "utf8");

async function loadOnce(browser, baseUrl, profile, route, opts, tag, outDir) {
  const { context, page } = await openPage(browser, profile);
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err).slice(0, 300)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
  if (opts.gl || opts.salt || opts.nocheck || opts.precompile) {
    const salt = opts.salt ? Math.random().toString(36).slice(2, 10) : null;
    await context.addInitScript(`window.__S1_CONFIG__ = ${JSON.stringify({ salt, nocheck: opts.nocheck, precompile: opts.precompile })};`);
    await context.addInitScript(GLPROBE());
  }
  if (opts.block) await context.route((url) => url.href.includes(opts.block), (r) => r.abort());
  try {
    if (opts.trace) await browser.startTracing(page, { categories: CATEGORIES });
    await page.goto(baseUrl + route, { waitUntil: "load", timeout: 120000 });
    let live = true;
    try {
      await waitForScene(page, { timeoutMs: 120000 });
    } catch {
      live = false;
    }
    await page.waitForTimeout(3000);
    const inPage = await page.evaluate(() => ({
      vitals: window.__rig.vitals,
      startedAt: window.__rig.startedAt,
      runningAt: window.__rig.runningAt,
      level: window.__rig.level(),
      gl: window.__s1 ? window.__s1.snapshot() : null,
    }));
    const row = {
      profile,
      route,
      tag,
      tier: inPage.level?.tier ?? null,
      fcpMs: inPage.vitals.fcp,
      lcpMs: inPage.vitals.lcp,
      liveMs: live ? inPage.startedAt : NaN,
      runningMs: inPage.runningAt,
      pageLongTasks: inPage.vitals.longTasks,
      errors,
    };
    if (inPage.gl) row.gl = summarizeGl(inPage.gl);
    if (inPage.gl?.precompile) row.precompile = inPage.gl.precompile;
    if (opts.trace) {
      const buffer = await browser.stopTracing();
      const parsed = JSON.parse(buffer.toString("utf8"));
      const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;
      const until = (Number.isFinite(row.liveMs) ? row.liveMs : 0) + 1500;
      const a = analyzeTrace(events, { urlPrefix: baseUrl, from: row.fcpMs ?? 0, until });
      if (a.thread) for (const t of a.tasks) t.gpuProcess = gpuProcessIn(events, a.thread, t.start, t.end);
      row.trace = a;
      if (opts.keep) {
        const file = join(outDir, `trace-${profile}-${tag}.json.gz`);
        writeFileSync(file, gzipSync(buffer));
        row.traceFile = file;
      }
    }
    return row;
  } finally {
    await context.close();
  }
}

const kindMs = (task, kind) => task.kinds?.[kind] ?? 0;

/** One line per long task: when, how long, what the timeline calls it and where the time went. */
export function taskTable(tasks) {
  return mdTable(tasks, [
    ["Starts", (t) => fmtMs(t.start)],
    ["Lasts", (t) => fmtMs(t.dur)],
    ["Timeline", (t) => (t.timeline ?? []).slice(0, 2).map((e) => `${e.name}${e.url ? ` ${e.url}` : ""} ${fmtMs(e.ms)}`).join("; ")],
    ["Script", (t) => fmtMs(kindMs(t, "script"))],
    ["Shaders", (t) => fmtMs(kindMs(t, "shader"))],
    ["Uploads", (t) => fmtMs(kindMs(t, "upload"))],
    ["Draws", (t) => fmtMs(kindMs(t, "draw"))],
    ["Other WebGL", (t) => fmtMs(kindMs(t, "webgl"))],
    ["GC", (t) => fmtMs(kindMs(t, "gc"))],
    ["Browser", (t) => fmtMs(kindMs(t, "native"))],
    ["Top files", (t) => (t.files ?? []).slice(0, 2).map((f) => `${f.key} ${fmtMs(f.ms)}`).join("; ")],
  ]);
}

/** Medians across runs of the numbers the findings quote. */
export function summarizeRuns(rows) {
  const m = (f) => median(rows.map(f).filter((x) => Number.isFinite(x)));
  /** @type {Record<string, number>} */
  const out = { runs: rows.length, fcpMs: m((r) => r.fcpMs), liveMs: m((r) => r.liveMs) };
  if (rows.some((r) => r.trace?.blocking)) {
    out.blockingMs = m((r) => r.trace?.blocking?.blockingMs);
    out.longestTaskMs = m((r) => r.trace?.blocking?.longestMs);
    out.tasksOver200 = m((r) => r.trace?.blocking?.over200);
    for (const kind of ["script", "shader", "upload", "draw", "webgl", "gc", "native"]) {
      out[`${kind}Ms`] = m((r) => (r.trace?.tasks ?? []).reduce((a, t) => a + kindMs(t, kind), 0));
    }
  }
  if (rows.some((r) => r.gl)) {
    for (const phase of ["load", "first", "after"]) {
      out[`gl_${phase}_Ms`] = m((r) => r.gl?.phases?.[phase]?.totalMs ?? 0);
      out[`gl_${phase}_shaderMs`] = m((r) => r.gl?.phases?.[phase]?.groups?.shader ?? 0);
      out[`gl_${phase}_uploadMs`] = m((r) => r.gl?.phases?.[phase]?.groups?.upload ?? 0);
      out[`gl_${phase}_drawMs`] = m((r) => r.gl?.phases?.[phase]?.groups?.draw ?? 0);
    }
    out.programs = m((r) => r.gl?.programs);
    if (rows.some((r) => r.precompile)) out.precompileMs = m((r) => r.precompile?.ms);
    out.longestPageTaskMs = m((r) => Math.max(0, ...r.pageLongTasks.map((t) => t.duration)));
    out.pageBlockingMs = m((r) => r.pageLongTasks.filter((t) => t.start + t.duration > (r.fcpMs ?? 0) && t.start < r.liveMs + 1500).reduce((a, t) => a + Math.max(0, t.duration - 50), 0));
  }
  return out;
}

/** `"gl+salt"` to the switches it turns on; unknown names are an error. */
export function parseMode(mode) {
  const names = ["trace", "gl", "salt", "nocheck", "precompile", "plain"];
  const parts = String(mode).split("+").filter(Boolean);
  for (const p of parts) if (!names.includes(p)) throw new Error(`unknown mode "${p}" (use ${names.join(", ")}, joined with +)`);
  const on = (name) => parts.includes(name);
  return { trace: on("trace"), gl: on("gl") || on("salt") || on("nocheck") || on("precompile"), salt: on("salt"), nocheck: on("nocheck"), precompile: on("precompile") };
}

export async function run({ baseUrl, outDir, args = {} }) {
  // --modes gl,gl+salt,trace runs several recordings in one rig session, one after the other.
  const fromFlags = ["trace", "gl", "salt", "nocheck", "precompile"].filter((k) => args[k]).join("+") || "plain";
  const modes = list(args.modes) ?? [fromFlags];
  const all = [];
  for (const mode of modes) all.push(...(await runMode({ baseUrl, outDir, args, mode })));
  return all;
}

async function runMode({ baseUrl, outDir, args, mode }) {
  const profiles = list(args.profiles) ?? ["phone"];
  const route = typeof args.route === "string" ? args.route : "/";
  const runs = Number(args.runs ?? 3);
  const loads = Number(args.loads ?? 1);
  const opts = { ...parseMode(mode), keep: !!args.keep, block: typeof args.block === "string" ? args.block : null };
  const label = [mode, opts.block && `block=${opts.block}`].filter(Boolean).join("+");
  const results = [];
  for (const profile of profiles) {
    const rows = [];
    for (let i = 0; i < runs; i++) {
      const browser = await launch();
      try {
        for (let load = 1; load <= loads; load++) {
          const tag = `run${i + 1}${loads > 1 ? `-load${load}` : ""}`;
          const row = await loadOnce(browser, baseUrl, profile, route, opts, tag, outDir);
          row.load = load;
          rows.push(row);
          const longest = Math.max(0, ...row.pageLongTasks.map((t) => t.duration));
          console.log(
            `[S1 ${label}] ${profile} ${tag}: FCP ${fmtMs(row.fcpMs)}, live ${fmtMs(row.liveMs)}, longest task ${fmtMs(longest)}` +
              (row.gl ? `, ${row.gl.programs} programs, WebGL before/in/after first frame ${fmtMs(row.gl.phases.load?.totalMs ?? 0)} / ${fmtMs(row.gl.phases.first?.totalMs ?? 0)} / ${fmtMs(row.gl.phases.after?.totalMs ?? 0)}` : "") +
              (row.precompile ? `, compiled ahead in ${fmtMs(row.precompile.ms)} (${row.precompile.scenes} scenes)` : "") +
              (row.gl?.salted ? `, ${row.gl.salted} shaders salted (${row.gl.saltMisses} missed)` : "") +
              (row.errors.length ? `, ${row.errors.length} page errors: ${row.errors[0]}` : ""),
          );
          if (row.trace?.tasks?.length) console.log(taskTable(row.trace.tasks) + "\n");
        }
      } finally {
        await browser.close();
      }
    }
    for (let load = 1; load <= loads; load++) {
      const subset = rows.filter((r) => r.load === load);
      results.push({ profile, route, label, load, summary: summarizeRuns(subset), rows: subset });
    }
  }
  const file = saveResult(`startup-${label.replace(/[^a-z0-9+=-]/gi, "_")}`, { takenAt: new Date().toISOString(), results }, outDir);
  console.log(`[S1] ${file}`);
  for (const r of results) console.log(`\n${r.profile} ${r.label} load ${r.load}: ${JSON.stringify(r.summary)}`);
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { withRig, outDirFor } = await import("../rig.mjs");
  const out = outDirFor("S1-startup");
  await withRig("S1 startup", (ctx) => run({ ...ctx, outDir: out, args }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
