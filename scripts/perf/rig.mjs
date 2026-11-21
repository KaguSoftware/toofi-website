#!/usr/bin/env node
/**
 * The measurement rig (optimization track P0): builds the checkout it runs in for production,
 * serves it on a free port, and holds the machine-wide lock (~/.cache/sawad-perf/rig.lock)
 * while it builds or times anything, so parallel sessions queue instead of skewing each
 * other's numbers.
 *
 *   node scripts/perf/rig.mjs status               who holds the lock
 *   node scripts/perf/rig.mjs build                snapshot + production build (cached by content)
 *   node scripts/perf/rig.mjs serve                build if needed and serve until Ctrl-C
 *   node scripts/perf/rig.mjs all [--quick]        every report, into scripts/perf/results/<stamp>/
 *
 * The build runs in a snapshot of the working tree (tracked and untracked files, not ignored
 * ones) under ~/.cache/sawad-perf/work/, so the checkout's own `.next` and a running
 * `next dev` are left alone, uncommitted changes are measured, and `.env*` never applies: the
 * server runs in local mode (sample data), as QA did.
 *
 * Install the rig's tools once: pnpm install --dir scripts/perf --ignore-workspace
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, createWriteStream } from "node:fs";
import { createServer } from "node:net";
import { cpus, totalmem, release, hostname } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CACHE_DIR, REPO_DIR, RESULTS_DIR, acquireLock, parseArgs, parsePower, powerProblem, readLock, stamp } from "./lib.mjs";

const git = (args, cwd = REPO_DIR, input) => execFileSync("git", args, { cwd, encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 }).trim();

/** The checkout this script lives in, and where its snapshot and build live. */
export function workDir(checkout = REPO_DIR) {
  const slug = `${basename(checkout)}-${createHash("sha1").update(resolve(checkout)).digest("hex").slice(0, 8)}`;
  return join(CACHE_DIR, "work", slug);
}

/**
 * A hash of the working tree as it is now (tracked and untracked, not ignored files), from a
 * throwaway git index: equal hashes mean an identical build input.
 */
export function treeHash(checkout = REPO_DIR) {
  const index = join(workDir(checkout), "index");
  mkdirSync(workDir(checkout), { recursive: true });
  const env = { ...process.env, GIT_INDEX_FILE: index };
  // The rig's own files and the docs do not change what is built.
  execFileSync("git", ["add", "-A", "--", ".", ":!scripts/perf", ":!docs"], { cwd: checkout, env, stdio: "ignore" });
  return execFileSync("git", ["write-tree"], { cwd: checkout, env, encoding: "utf8" }).trim();
}

/** The Mac's power state (null elsewhere). */
export function powerState() {
  if (process.platform !== "darwin") return null;
  try {
    return parsePower(execFileSync("pmset", ["-g", "batt"], { encoding: "utf8" }), execFileSync("pmset", ["-g"], { encoding: "utf8" }));
  } catch {
    return null;
  }
}

/** What the numbers were taken on. */
export function machineInfo(checkout = REPO_DIR) {
  const dirty = git(["status", "--porcelain"], checkout).length > 0;
  return {
    host: hostname(),
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    memoryGB: Math.round(totalmem() / 2 ** 30),
    os: `darwin ${release()}`,
    node: process.version,
    commit: git(["rev-parse", "--short", "HEAD"], checkout),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"], checkout),
    dirty,
    next: JSON.parse(readFileSync(join(checkout, "node_modules/next/package.json"), "utf8")).version,
    power: powerState(),
  };
}

function nodeModulesSource(checkout) {
  if (existsSync(join(checkout, "node_modules/next"))) return join(checkout, "node_modules");
  const common = resolve(checkout, git(["rev-parse", "--git-common-dir"], checkout));
  const main = resolve(common, "..");
  if (existsSync(join(main, "node_modules/next"))) return join(main, "node_modules");
  throw new Error("no node_modules with next installed (run pnpm install)");
}

const cleanEnv = () => {
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  for (const k of Object.keys(env)) if (/SUPABASE/.test(k)) delete env[k];
  delete env.NODE_ENV;
  return env;
};

function run(cmd, args, { cwd, env, logFile }) {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const log = createWriteStream(logFile);
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    child.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(" ")} exited ${code}; see ${logFile}`))));
  });
}

/**
 * Snapshot the working tree and build it for production, unless the same tree was built
 * last time. Call with the lock held. Returns the build's directory and metadata.
 */
export async function build({ checkout = REPO_DIR, force = false, log = console.log } = {}) {
  const work = workDir(checkout);
  const src = join(work, "src");
  const tree = treeHash(checkout);
  const stampFile = join(work, "built.json");
  const prior = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, "utf8")) : null;
  if (!force && prior?.tree === tree && existsSync(join(src, ".next/BUILD_ID"))) {
    log(`[rig] build is current (${tree.slice(0, 10)})`);
    return { src, ...prior };
  }
  log(`[rig] snapshot ${checkout} → ${src}`);
  mkdirSync(src, { recursive: true });
  for (const name of readdirSync(src)) if (name !== "node_modules" && name !== ".next") rmSync(join(src, name), { recursive: true, force: true });
  rmSync(join(src, ".next"), { recursive: true, force: true });
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: checkout, maxBuffer: 256 * 1024 * 1024 });
  const existing = files
    .toString("utf8")
    .split("\0")
    .filter((f) => f && !f.startsWith("scripts/perf/") && existsSync(join(checkout, f)));
  execFileSync("tar", ["--null", "-T", "-", "-cf", join(work, "snapshot.tar")], { cwd: checkout, input: existing.join("\0") });
  execFileSync("tar", ["-xf", join(work, "snapshot.tar"), "-C", src]);
  rmSync(join(work, "snapshot.tar"));

  const modules = nodeModulesSource(checkout);
  const lock = ["pnpm-lock.yaml", "package-lock.json"].map((f) => (existsSync(join(checkout, f)) ? readFileSync(join(checkout, f)) : "")).join("");
  const modulesKey = createHash("sha1").update(lock).update(modules).digest("hex");
  const keyFile = join(work, "node_modules.key");
  if (!existsSync(join(src, "node_modules/next")) || (existsSync(keyFile) ? readFileSync(keyFile, "utf8") : "") !== modulesKey) {
    log(`[rig] cloning node_modules from ${modules}`);
    rmSync(join(src, "node_modules"), { recursive: true, force: true });
    execFileSync("cp", ["-cR", modules, join(src, "node_modules")]);
    writeFileSync(keyFile, modulesKey);
  }

  log("[rig] next build (production) …");
  const t0 = Date.now();
  await run(process.execPath, ["node_modules/next/dist/bin/next", "build"], { cwd: src, env: cleanEnv(), logFile: join(work, "build.log") });
  const info = { tree, builtAt: new Date().toISOString(), buildSeconds: Math.round((Date.now() - t0) / 1000), buildId: readFileSync(join(src, ".next/BUILD_ID"), "utf8").trim(), machine: machineInfo(checkout) };
  writeFileSync(stampFile, JSON.stringify(info, null, 2));
  log(`[rig] built in ${info.buildSeconds} s (${info.buildId})`);
  return { src, ...info };
}

export function freePort() {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => ok(port));
    });
  });
}

/** Starts `next start` on the build in local mode and waits until Home answers. */
export async function serve(src, { port, log = console.log } = {}) {
  port ??= await freePort();
  const env = { ...cleanEnv(), SAWAD_ALLOW_LOCAL_MODE: "1", PORT: String(port) };
  const logFile = join(src, "..", "server.log");
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: src, env, stdio: ["ignore", "pipe", "pipe"] });
  const out = createWriteStream(logFile);
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`next start exited ${child.exitCode}; see ${logFile}`);
    try {
      const res = await fetch(baseUrl + "/");
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`next start did not answer on ${baseUrl}; see ${logFile}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  // Warm the server once so the first measured request is not a cold module load.
  for (const path of ["/", "/ar", "/compounds", "/residences", "/contact"]) await fetch(baseUrl + path).catch(() => {});
  log(`[rig] serving ${baseUrl}`);
  const stop = () =>
    new Promise((ok) => {
      if (child.exitCode !== null) return ok();
      child.once("exit", () => ok());
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    });
  return { baseUrl, port, stop };
}

/**
 * Runs `fn({ baseUrl, build })` with the lock held, on a current production build served
 * locally. Pass `server: false` for work that only needs the build (bundle reports).
 */
export async function withRig(label, fn, { checkout = REPO_DIR, server = true, force = false, log = console.log } = {}) {
  // Timing on battery or in Low Power Mode is throttled (frames pin at 30 fps): refuse.
  const power = powerState();
  const problem = server && power ? powerProblem(power) : null;
  if (problem && process.env.SAWAD_PERF_ALLOW_BATTERY !== "1") {
    throw new Error(`[rig] not timing: ${problem}. Plug in the charger and turn Low Power Mode off (System Settings → Battery), or set SAWAD_PERF_ALLOW_BATTERY=1 to measure anyway.`);
  }
  const release = await acquireLock(label, { log });
  // Keep the display and the machine awake while timing (a sleeping display drops frames to 30 Hz).
  const awake = process.platform === "darwin" && server ? spawn("caffeinate", ["-dis", "-w", String(process.pid)], { stdio: "ignore" }) : null;
  let srv = null;
  try {
    const b = await build({ checkout, force, log });
    if (server) srv = await serve(b.src, { log });
    return await fn({ baseUrl: srv?.baseUrl ?? null, build: b });
  } finally {
    if (srv) await srv.stop();
    awake?.kill();
    release();
  }
}

/** A run's output folder: scripts/perf/results/<stamp>-<label>/. */
export function outDirFor(label) {
  const dir = join(RESULTS_DIR, `${stamp()}-${label}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] ?? "status";
  if (cmd === "status") {
    const held = readLock();
    console.log(held ? `locked by ${held.label} (pid ${held.pid} on ${held.host}) since ${held.since}` : "free");
    return;
  }
  if (cmd === "build") {
    await withRig("build", async ({ build: b }) => console.log(JSON.stringify(b, null, 2)), { server: false, force: !!args.force });
    return;
  }
  if (cmd === "serve") {
    await withRig("serve", ({ baseUrl }) => {
      console.log(`[rig] ${baseUrl} (Ctrl-C to stop; the lock is held meanwhile)`);
      return new Promise(() => {});
    });
    return;
  }
  if (cmd === "all") {
    const quick = !!args.quick;
    // --out continues an earlier run's folder (for example with --only after a failure).
    const out = args.out ? resolve(String(args.out)) : outDirFor(quick ? "all-quick" : "all");
    const steps = [
      ["assets", () => import("./assets.mjs")],
      ["bundles", () => import("./bundles.mjs")],
      ["trace", () => import("./trace.mjs")],
      ["frames", () => import("./frames.mjs")],
      ["reference", () => import("./frames.mjs"), "reference"],
      ["memory", () => import("./memory.mjs")],
      ["lighthouse", () => import("./lighthouse.mjs")],
    ];
    const only = args.only ? String(args.only).split(",") : null;
    await withRig("all", async (ctx) => {
      for (const [name, load, entry] of steps) {
        if (only && !only.includes(name)) continue;
        const mod = await load();
        console.log(`\n[rig] ── ${name}`);
        await mod[entry ?? "run"]({ ...ctx, outDir: out, args: { ...args, quick } });
      }
    });
    console.log(`\n[rig] results in ${out}`);
    return;
  }
  console.error(`unknown command ${cmd}`);
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
