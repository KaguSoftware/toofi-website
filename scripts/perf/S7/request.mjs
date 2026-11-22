#!/usr/bin/env node
/**
 * Track S7: the request path. Under the rig lock, on the production build of this checkout:
 *
 *   local     the rig's own build (sample data from files). Per page: time to first byte, to the
 *             page content (`<main id="main"`, as against the skeleton shell) and to the end,
 *             headers, bytes; then public files (matched and not matched by proxy.ts).
 *   supabase  a second build with NEXT_PUBLIC_SUPABASE_* pointing at a mock PostgREST on port
 *             54329 that counts every query and adds LATENCY ms (default 40). Per page: database
 *             calls on the first visit and on repeats, during the build and at run time, with
 *             the time added by the database.
 *
 *   node scripts/perf/S7/request.mjs [local|supabase|all] [--runs 20] [--latency 40]
 *
 * It changes no product code. The Supabase build is a clone of the rig's snapshot, in its own
 * folder under ~/.cache/sawad-perf/work/.
 */
import { execFileSync, spawn } from "node:child_process";
import { rmSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build, freePort, powerState, serve, workDir } from "../rig.mjs";
import { acquireLock, fmtMs, mdTable, median, parseArgs, percentile, powerProblem, saveResult } from "../lib.mjs";
import { mockSupabase, timeRequest } from "./lib.mjs";

const PAGES = ["/", "/ar", "/compounds", "/residences", "/contact", "/does-not-exist"];
const MARKER = '<main id="main"';
const MOCK_PORT = 54329;

/** mdTable wants [header, fn]; here columns are [key, header]. */
const cols = (pairs) => pairs.map(([k, h]) => [h, (r) => r[k]]);

async function measurePages(baseUrl, runs) {
  const rows = [];
  for (const path of PAGES) {
    const first = await timeRequest(baseUrl + path, { marker: MARKER });
    const ttfb = [], content = [], total = [];
    let last = first;
    for (let i = 0; i < runs; i++) {
      last = await timeRequest(baseUrl + path, { marker: MARKER });
      ttfb.push(last.ttfb);
      if (last.markerAt !== null) content.push(last.markerAt);
      total.push(last.total);
    }
    rows.push({
      path, status: last.status, bytes: last.bytes,
      first: { ttfb: first.ttfb, content: first.markerAt, total: first.total },
      ttfbMedian: median(ttfb), ttfbP95: percentile(ttfb, 95),
      contentMedian: content.length ? median(content) : null, totalMedian: median(total),
      headers: {
        "cache-control": last.headers["cache-control"], "x-nextjs-cache": last.headers["x-nextjs-cache"],
        "x-nextjs-prerender": last.headers["x-nextjs-prerender"], "content-encoding": last.headers["content-encoding"],
        vary: last.headers["vary"], "transfer-encoding": last.headers["transfer-encoding"],
      },
    });
  }
  return rows;
}

const FILES = [
  ["/favicon.ico", "excluded by the proxy matcher"],
  ["/sawad/scene-zaitun-poster.jpg", "excluded (.jpg)"],
  ["/sawad/models/compound-zaitun-far-low.glb", "NOT excluded (.glb), 2.7 MB"],
  ["/sawad/audio/with-these-hands.mp3", "NOT excluded (.mp3), 4.5 MB"],
];

async function measureFiles(baseUrl, runs) {
  const out = [];
  for (const [path, note] of FILES) {
    const probe = await fetch(baseUrl + path).catch(() => null);
    if (!probe || probe.status !== 200) { out.push({ path, note, status: probe?.status ?? "down" }); continue; }
    await probe.arrayBuffer();
    const ttfb = [];
    let headers = {};
    for (let i = 0; i < runs; i++) {
      const r = await timeRequest(baseUrl + path);
      ttfb.push(r.ttfb);
      headers = { "cache-control": r.headers["cache-control"], "content-encoding": r.headers["content-encoding"], "content-length": r.headers["content-length"] };
    }
    out.push({ path, note, status: 200, ttfbMedian: median(ttfb), headers });
  }
  return out;
}

/** Every /_next/image URL a page's HTML asks for (src and srcset), as found, unescaped. */
export function imageUrls(html) {
  const found = new Set();
  for (const m of html.matchAll(/\/_next\/image\?[^"'\s,]+/g)) found.add(m[0].replace(/&amp;/g, "&"));
  return [...found];
}

/** The image optimizer: first request (cold: decode, resize, encode) and repeats, bytes, type, against the source file. */
async function measureImages(baseUrl, pages, runs) {
  const out = [];
  for (const page of pages) {
    const html = await (await fetch(baseUrl + page)).text();
    for (const u of imageUrls(html)) {
      const url = new URL(u, baseUrl);
      const source = url.searchParams.get("url");
      const cold = await timeRequest(baseUrl + u, { headers: { accept: "image/avif,image/webp,*/*" } });
      const ttfb = [];
      for (let i = 0; i < runs; i++) ttfb.push((await timeRequest(baseUrl + u, { headers: { accept: "image/avif,image/webp,*/*" } })).ttfb);
      const src = source?.startsWith("/") ? await fetch(baseUrl + source) : null;
      const srcBytes = src ? (await src.arrayBuffer()).byteLength : null;
      out.push({ page, source, w: Number(url.searchParams.get("w")), q: Number(url.searchParams.get("q")), status: cold.status, type: cold.headers["content-type"], bytes: cold.bytes, srcBytes, coldMs: cold.total, warmMs: median(ttfb), cache: cold.headers["cache-control"] });
    }
  }
  return out;
}

async function localMode(runs) {
  const b = await build({});
  const srv = await serve(b.src);
  try {
    return { pages: await measurePages(srv.baseUrl, runs), files: await measureFiles(srv.baseUrl, runs), images: await measureImages(srv.baseUrl, ["/", "/compounds", "/contact"], runs), build: b.machine };
  } finally {
    await srv.stop();
  }
}

function sh(cmd, args, opts) {
  return new Promise((ok, fail) => {
    const c = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    const log = createWriteStream(opts.logFile);
    c.stdout.pipe(log); c.stderr.pipe(log);
    c.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(" ")} exited ${code}; see ${opts.logFile}`))));
  });
}

async function supabaseMode(runs, latencyMs) {
  const b = await build({});
  const dir = join(workDir(), "..", `${workDir().split("/").pop()}-supabase`);
  rmSync(dir, { recursive: true, force: true });
  execFileSync("mkdir", ["-p", dir]);
  execFileSync("cp", ["-cR", b.src, join(dir, "src")]); // APFS clone: cheap
  const src = join(dir, "src");
  rmSync(join(src, ".next"), { recursive: true, force: true });
  const env = {
    ...process.env, NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_mock", SAWAD_ALLOW_LOCAL_MODE: "0",
  };
  delete env.NODE_ENV;
  const mock = mockSupabase({ port: MOCK_PORT, latencyMs });
  await mock.start();
  try {
    await sh(process.execPath, ["node_modules/next/dist/bin/next", "build"], { cwd: src, env, logFile: join(dir, "build.log") });
    const buildQueries = { total: mock.log.length, byTable: mock.byTable() };
    mock.reset();
    const port = await freePort();
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: src, env, stdio: "ignore" });
    const baseUrl = `http://127.0.0.1:${port}`;
    for (let i = 0; ; i++) {
      try { if ((await fetch(baseUrl + "/robots.txt")).ok) break; } catch { /* starting */ }
      if (i > 200) throw new Error("supabase-mode server did not start");
      await new Promise((r) => setTimeout(r, 300));
    }
    try {
      const perPage = [];
      for (const path of PAGES) {
        mock.reset();
        const first = await timeRequest(baseUrl + path, { marker: MARKER });
        const firstQueries = mock.log.length;
        mock.reset();
        const ttfb = [], content = [];
        for (let i = 0; i < runs; i++) {
          const r = await timeRequest(baseUrl + path, { marker: MARKER });
          ttfb.push(r.ttfb);
          if (r.markerAt !== null) content.push(r.markerAt);
        }
        perPage.push({
          path, status: first.status, firstQueries, repeatQueries: mock.log.length,
          first: { ttfb: first.ttfb, content: first.markerAt, total: first.total },
          ttfbMedian: median(ttfb), contentMedian: content.length ? median(content) : null,
          cacheControl: first.headers["cache-control"],
        });
      }
      // A flood of distinct junk slugs: does each one reach the database?
      mock.reset();
      for (let i = 0; i < 20; i++) await timeRequest(`${baseUrl}/junk-${i}`);
      const junkQueries = mock.log.length;
      mock.reset();
      for (let i = 0; i < 20; i++) await timeRequest(`${baseUrl}/junk-${i}`);
      const junkRepeat = mock.log.length;
      const files = await measureFiles(baseUrl, runs);
      return { latencyMs, buildQueries, perPage, files, junk: { distinct20: junkQueries, repeat20: junkRepeat } };
    } finally {
      child.kill("SIGTERM");
    }
  } finally {
    await mock.stop();
  }
}

export function report(r) {
  const out = [];
  if (r.local) {
    out.push("### Local mode (sample data from files), production build\n");
    out.push(mdTable(r.local.pages.map((p) => ({ path: p.path, status: p.status, kb: (p.bytes / 1024).toFixed(0), first: fmtMs(p.first.ttfb, 1), ttfb: fmtMs(p.ttfbMedian, 1), p95: fmtMs(p.ttfbP95, 1), content: p.contentMedian === null ? "-" : fmtMs(p.contentMedian, 1), end: fmtMs(p.totalMedian, 1), cache: p.headers["cache-control"] ?? "-" })), cols([["path", "path"], ["status", "status"], ["kb", "KB"], ["first", "1st TTFB"], ["ttfb", "TTFB med"], ["p95", "TTFB p95"], ["content", "content med"], ["end", "end med"], ["cache", "cache-control"]])));
    out.push("\n### Public files\n");
    out.push(mdTable(r.local.files.map((f) => ({ path: f.path, note: f.note, status: f.status, ttfb: f.ttfbMedian ? fmtMs(f.ttfbMedian, 1) : "-", cache: f.headers?.["cache-control"] ?? "-" })), cols([["path", "file"], ["note", "proxy.ts"], ["status", "status"], ["ttfb", "TTFB med"], ["cache", "cache-control"]])));
  }
  if (r.local?.images?.length) {
    out.push("\n### Image optimizer (first request, then repeats)\n");
    out.push(mdTable(r.local.images.map((i) => ({ page: i.page, src: i.source, w: i.w, type: i.type, kb: (i.bytes / 1024).toFixed(0), srckb: i.srcBytes === null ? "-" : (i.srcBytes / 1024).toFixed(0), cold: fmtMs(i.coldMs, 0), warm: fmtMs(i.warmMs, 1), cache: i.cache })), cols([["page", "page"], ["src", "source"], ["w", "w"], ["type", "type"], ["kb", "KB out"], ["srckb", "KB source"], ["cold", "1st request"], ["warm", "repeat TTFB"], ["cache", "cache-control"]])));
  }
  if (r.supabase) {
    const s = r.supabase;
    out.push(`\n### Supabase mode (mock, ${s.latencyMs} ms per query)\n`);
    out.push(`Queries during \`next build\`: ${s.buildQueries.total} (${JSON.stringify(s.buildQueries.byTable)}).\n`);
    out.push(mdTable(s.perPage.map((p) => ({ path: p.path, status: p.status, q1: p.firstQueries, qn: p.repeatQueries, first: fmtMs(p.first.ttfb, 1), ttfb: fmtMs(p.ttfbMedian, 1), content: p.contentMedian === null ? "-" : fmtMs(p.contentMedian, 1) })), cols([["path", "path"], ["status", "status"], ["q1", "queries, 1st visit"], ["qn", "queries, repeats"], ["first", "1st TTFB"], ["ttfb", "TTFB med"], ["content", "content med"]])));
    out.push("\nPublic files in Supabase mode (proxy.ts runs getClaims on the non-excluded ones):\n");
    out.push(mdTable(s.files.map((f) => ({ path: f.path, ttfb: f.ttfbMedian ? fmtMs(f.ttfbMedian, 1) : "-" })), cols([["path", "file"], ["ttfb", "TTFB med"]])));
    out.push(`\nTwenty distinct junk slugs: ${s.junk.distinct20} queries; the same twenty again: ${s.junk.repeat20}.`);
  }
  return out.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const what = args._[0] ?? "all";
  const runs = Number(args.runs ?? 20);
  const power = powerState();
  const problem = power ? powerProblem(power) : null;
  if (problem && process.env.SAWAD_PERF_ALLOW_BATTERY !== "1") throw new Error(`[rig] not timing: ${problem}. Plug in the charger.`);
  const release = await acquireLock("S7 request path");
  const awake = spawn("caffeinate", ["-dis", "-w", String(process.pid)], { stdio: "ignore" });
  try {
    const result = {};
    if (what === "local" || what === "all") result.local = await localMode(runs);
    if (what === "supabase" || what === "all") result.supabase = await supabaseMode(runs, Number(args.latency ?? 40));
    const file = saveResult(`S7-request-${what}`, result);
    console.log(report(result));
    console.log(`\nraw: ${file}`);
  } finally {
    awake.kill();
    release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
