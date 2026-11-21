/**
 * Shared helpers for the measurement rig (optimization track P0): the machine-wide lock,
 * statistics, the image difference used by the look gate, and Markdown tables.
 * Everything here is plain Node with no browser, so it is unit tested (lib.test.ts).
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PERF_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_DIR = join(PERF_DIR, "..", "..");
export const CACHE_DIR = process.env.SAWAD_PERF_CACHE ?? join(homedir(), ".cache", "sawad-perf");
export const LOCK_PATH = join(CACHE_DIR, "rig.lock");
export const RESULTS_DIR = join(PERF_DIR, "results");
export const REFERENCE_DIR = join(PERF_DIR, "reference");

// ---------------------------------------------------------------- statistics

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Nearest-rank percentile, p in 0..100. */
export function percentile(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const rank = Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1));
  return v[rank];
}

export function mean(values) {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}

/** The numbers every timing table shows. */
export function summarize(values) {
  const v = values.filter((x) => Number.isFinite(x));
  return {
    n: v.length,
    mean: mean(v),
    median: median(v),
    p95: percentile(v, 95),
    p99: percentile(v, 99),
    max: v.length ? Math.max(...v) : NaN,
    min: v.length ? Math.min(...v) : NaN,
  };
}

/** Frame intervals (ms) to the frame-rate view: fps from the median, and how many frames ran long. */
export function frameStats(intervals, { budgetMs = 20 } = {}) {
  const s = summarize(intervals);
  return {
    frames: s.n,
    fps: s.median > 0 ? 1000 / s.median : NaN,
    meanFps: s.mean > 0 ? 1000 / s.mean : NaN,
    medianMs: s.median,
    p95Ms: s.p95,
    p99Ms: s.p99,
    maxMs: s.max,
    overBudget: intervals.filter((x) => x > budgetMs).length,
  };
}

/**
 * Per-run results to one row: the median of each numeric field across runs (the plan's
 * "median of five"). Non-numeric fields come from the first run.
 */
export function medianOfRuns(runs) {
  if (!runs.length) return {};
  const out = {};
  for (const key of Object.keys(runs[0])) {
    const vals = runs.map((r) => r[key]);
    out[key] = vals.every((x) => typeof x === "number") ? median(vals) : vals[0];
  }
  return out;
}

/** One recorded window to the numbers the tables show. */
export function summarizeFrames(frames) {
  const intervals = frames.map((f) => f.interval).filter((x) => x !== null && x > 0);
  const gpuFrames = frames.filter((f) => f.gpuComplete && !f.gpuDisjoint && Object.keys(f.gpu).length);
  const gpuTotal = gpuFrames.map((f) => Object.values(f.gpu).reduce((a, b) => a + b, 0));
  const passes = {};
  for (const f of gpuFrames) for (const [label, ms] of Object.entries(f.gpu)) (passes[label] ??= []).push(ms);
  const passTable = Object.entries(passes)
    .map(([label, v]) => ({ label, medianMs: median(v), share: v.length / gpuFrames.length }))
    .sort((a, b) => b.medianMs - a.medianMs);
  return {
    ...frameStats(intervals),
    cpuMs: { median: median(frames.map((f) => f.cpuMs)), p95: percentile(frames.map((f) => f.cpuMs), 95), max: Math.max(...frames.map((f) => f.cpuMs ?? 0)) },
    renderCpuMs: median(frames.map((f) => f.renderMs)),
    gpuMs: { median: median(gpuTotal), p95: percentile(gpuTotal, 95), max: gpuTotal.length ? Math.max(...gpuTotal) : NaN, frames: gpuTotal.length },
    shadowGpuMs: median(gpuFrames.map((f) => f.shadowGpuMs)),
    calls: { median: median(frames.map((f) => f.calls)), max: Math.max(...frames.map((f) => f.calls)) },
    triangles: { median: median(frames.map((f) => f.triangles)), max: Math.max(...frames.map((f) => f.triangles)) },
    sceneTriangles: { median: median(frames.map((f) => f.sceneTriangles)), max: Math.max(...frames.map((f) => f.sceneTriangles ?? 0)) },
    sceneCalls: median(frames.map((f) => f.sceneCalls)),
    shadowTriangles: median(frames.map((f) => f.shadowTriangles)),
    shadowCalls: median(frames.map((f) => f.shadowCalls)),
    passes: median(frames.map((f) => f.passes)),
    dpr: median(frames.map((f) => f.dpr)),
    drawingBuffer: frames.length ? `${frames.at(-1).width}x${frames.at(-1).height}` : null,
    gpuPasses: passTable.slice(0, 12),
  };
}

// ---------------------------------------------------------------- images

/**
 * Mean absolute difference per channel (RGB, alpha ignored) between two RGBA images of the
 * same size, in 0..255 units: the look gate's number. Also the share of pixels that moved by
 * more than `threshold` on any channel, and the worst pixel.
 */
export function imageDiff(a, b, { threshold = 16 } = {}) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`image sizes differ: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const n = a.width * a.height;
  let sum = 0;
  let changed = 0;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const dr = Math.abs(a.data[o] - b.data[o]);
    const dg = Math.abs(a.data[o + 1] - b.data[o + 1]);
    const db = Math.abs(a.data[o + 2] - b.data[o + 2]);
    sum += dr + dg + db;
    const m = Math.max(dr, dg, db);
    if (m > threshold) changed++;
    if (m > worst) worst = m;
  }
  return { mean: sum / (n * 3), changedShare: changed / n, worst };
}

/** A grey heat map of the difference (brighter = larger), scaled so `full` maps to white. */
export function diffImage(a, b, { full = 32 } = {}) {
  const out = Buffer.alloc(a.width * a.height * 4);
  for (let i = 0; i < a.width * a.height; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(a.data[o] - b.data[o]), Math.abs(a.data[o + 1] - b.data[o + 1]), Math.abs(a.data[o + 2] - b.data[o + 2]));
    const v = Math.min(255, Math.round((d / full) * 255));
    out[o] = v;
    out[o + 1] = v;
    out[o + 2] = v;
    out[o + 3] = 255;
  }
  return { width: a.width, height: a.height, data: out };
}

// ---------------------------------------------------------------- the lock

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/** Who holds the lock, or null. A lock left by a dead process on this machine counts as free. */
export function readLock(path = LOCK_PATH) {
  if (!existsSync(path)) return null;
  try {
    const info = JSON.parse(readFileSync(path, "utf8"));
    if (info.host === hostname() && !processAlive(info.pid)) return null;
    return info;
  } catch {
    return null;
  }
}

/** Takes the lock once, without waiting. Returns a release function, or null if it is held. */
export function tryLock(label, path = LOCK_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && readLock(path) === null) rmSync(path, { force: true });
  let fd;
  try {
    fd = openSync(path, "wx");
  } catch (err) {
    if (err.code === "EEXIST") return null;
    throw err;
  }
  const info = { pid: process.pid, host: hostname(), label, since: new Date().toISOString() };
  writeSync(fd, JSON.stringify(info));
  closeSync(fd);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const held = readLock(path);
    if (held && held.pid === process.pid) rmSync(path, { force: true });
  };
}

/**
 * Waits for the machine-wide measurement lock, so parallel sessions queue instead of slowing
 * each other's numbers. The lock is released on exit, Ctrl-C and crashes.
 */
export async function acquireLock(label, { path = LOCK_PATH, pollMs = 2000, timeoutMs = 3 * 60 * 60 * 1000, log = console.log } = {}) {
  const start = Date.now();
  let told = false;
  for (;;) {
    const release = tryLock(label, path);
    if (release) {
      const onExit = () => release();
      const onSignal = (sig) => {
        release();
        process.exit(sig === "SIGINT" ? 130 : 143);
      };
      process.once("exit", onExit);
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
      return () => {
        release();
        process.off("exit", onExit);
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
      };
    }
    if (!told) {
      const held = readLock(path);
      log(`[rig] waiting for the measurement lock (held by ${held?.label ?? "?"}, pid ${held?.pid ?? "?"}, since ${held?.since ?? "?"})`);
      told = true;
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${path}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// ---------------------------------------------------------------- power

/**
 * Power state from `pmset -g batt` and `pmset -g` output (macOS). On battery or in Low Power
 * Mode, macOS throttles the CPU and GPU and caps the frame rate (runs pin at 30 fps), so the
 * rig refuses to time anything then.
 */
export function parsePower(batt, settings) {
  const source = /'AC Power'/.test(batt) ? "ac" : /'Battery Power'/.test(batt) ? "battery" : "unknown";
  const pct = batt.match(/(\d+)%/);
  const low = settings.match(/lowpowermode\s+(\d)/);
  return { source, batteryPercent: pct ? Number(pct[1]) : null, lowPowerMode: low ? low[1] === "1" : false };
}

/** Why timing would be invalid on this power state, or null when it is fine. */
export function powerProblem(power) {
  if (power.source === "battery") return `running on battery (${power.batteryPercent ?? "?"}%)`;
  if (power.lowPowerMode) return "Low Power Mode is on";
  return null;
}

// ---------------------------------------------------------------- output

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return "–";
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${Math.round(n)} B`;
}

export function fmtMs(n, digits = 0) {
  if (!Number.isFinite(n)) return "–";
  return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n.toFixed(digits)} ms`;
}

export function fmtNum(n, digits = 0) {
  if (!Number.isFinite(n)) return "–";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** A Markdown table. `columns` is [header, (row) => cell] pairs. Pipes in cells are escaped. */
export function mdTable(rows, columns) {
  const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const head = `| ${columns.map(([h]) => esc(h)).join(" | ")} |`;
  const rule = `|${columns.map(() => "---").join("|")}|`;
  const body = rows.map((r) => `| ${columns.map(([, f]) => esc(f(r))).join(" | ")} |`);
  return [head, rule, ...body].join("\n");
}

/** `--key value`, `--key=value` and bare `--flag` to an object; the rest are positional. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

/** Comma list to array (`"a,b"` → ["a","b"]); undefined stays undefined. */
export function list(value) {
  if (value === undefined || value === true) return undefined;
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function stamp(date = new Date()) {
  return date.toISOString().replace(/[:]/g, "-").replace(/\..+$/, "");
}

/** Writes a result as JSON under scripts/perf/results/ and returns its path. */
export function saveResult(name, data, dir = RESULTS_DIR) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  return file;
}
