#!/usr/bin/env node
/**
 * Load trace (optimization track P0). Cold loads of Home on the QA phone profile (Fast 4G,
 * 4× CPU, low tier) and the desktop profile (no throttling, high tier): first content, the
 * live scene, long tasks on the main thread, the request waterfall and bytes per file type.
 *
 *   node scripts/perf/trace.mjs [--profiles phone,desktop] [--routes /,/ar] [--runs 3]
 *
 * Each run launches a fresh Chrome, so its first load starts with an empty HTTP cache and a GPU
 * process that has compiled nothing ("cold"); a second load in a new context of the same browser
 * (empty HTTP cache, the browser's GPU program cache warm) is reported as "warm". The first
 * baseline run saw a single 3–4 s task on the first load after start-up and never again; this
 * split is there to catch it if it comes back.
 *
 * "Live scene" is the scene's first drawn frame (the probe sees the stage renderer render).
 * "Blocking" is the sum over long tasks of the part beyond 50 ms (as in Total Blocking Time),
 * counted from first content until one second after the live scene.
 */
import { pathToFileURL } from "node:url";
import { launch, openPage, waitForScene } from "./browser.mjs";
import { fmtBytes, fmtMs, list, mdTable, median, parseArgs, saveResult } from "./lib.mjs";

/** File type from a URL and the DevTools resource type. */
export function fileKind(url, resourceType) {
  const path = url.split("?")[0].toLowerCase();
  if (/\.glb$/.test(path)) return "model";
  if (/\.ktx2$/.test(path)) return "texture";
  if (/\.wasm$/.test(path)) return "wasm";
  if (/\.(mp3|m4a|ogg|wav|aac|opus)$/.test(path)) return "audio";
  if (/\.(woff2?|ttf|otf)$/.test(path)) return "font";
  if (/\.(avif|webp|jpe?g|png|gif|svg)$/.test(path) || path.includes("/_next/image")) return "image";
  if (/\.css$/.test(path)) return "css";
  if (/\.m?js$/.test(path) || resourceType === "Script") return "js";
  if (resourceType === "Document") return "document";
  if (/\.json$/.test(path) || resourceType === "Fetch" || resourceType === "XHR") return "data";
  return "other";
}

/** Long tasks to blocking numbers within [from, to] (ms since navigation). */
export function blocking(tasks, from, to) {
  const inside = tasks.filter((t) => t.start + t.duration > from && t.start < to);
  return {
    count: inside.length,
    totalMs: inside.reduce((a, t) => a + t.duration, 0),
    blockingMs: inside.reduce((a, t) => a + Math.max(0, t.duration - 50), 0),
    longestMs: inside.reduce((a, t) => Math.max(a, t.duration), 0),
    over200: inside.filter((t) => t.duration > 200).length,
  };
}

async function traceOnce(browser, baseUrl, profile, route) {
  const { context, page, cdp } = await openPage(browser, profile);
  const requests = new Map();
  let t0 = null;
  cdp.on("Network.requestWillBeSent", (e) => {
    if (t0 === null && e.type === "Document") t0 = e.timestamp;
    requests.set(e.requestId, { url: e.request.url, type: e.type, start: e.timestamp, priority: e.request.initialPriority });
  });
  cdp.on("Network.responseReceived", (e) => {
    const r = requests.get(e.requestId);
    if (r) Object.assign(r, { status: e.response.status, mime: e.response.mimeType, protocol: e.response.protocol, encoding: e.response.headers["content-encoding"] ?? e.response.headers["Content-Encoding"] ?? null, fromCache: e.response.fromDiskCache });
  });
  cdp.on("Network.loadingFinished", (e) => {
    const r = requests.get(e.requestId);
    if (r) Object.assign(r, { end: e.timestamp, bytes: e.encodedDataLength });
  });
  cdp.on("Network.loadingFailed", (e) => {
    const r = requests.get(e.requestId);
    if (r) Object.assign(r, { end: e.timestamp, failed: e.errorText, bytes: 0 });
  });
  try {
    await page.goto(baseUrl + route, { waitUntil: "load", timeout: 120000 });
    let live = null;
    try {
      await waitForScene(page, { timeoutMs: 120000 });
    } catch {
      live = NaN;
    }
    await page.waitForTimeout(3000);
    const page_ = await page.evaluate(() => ({
      vitals: window.__rig.vitals,
      startedAt: window.__rig.startedAt,
      runningAt: window.__rig.runningAt,
      longFrames: window.__rig.longFrames,
      nav: (() => {
        const n = performance.getEntriesByType("navigation")[0];
        return n ? { ttfb: n.responseStart, domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd } : null;
      })(),
      level: window.__rig.level(),
    }));
    live = live ?? page_.startedAt;
    const rel = (ts) => (ts - t0) * 1000;
    const waterfall = [...requests.values()]
      .filter((r) => !r.url.startsWith("data:"))
      .map((r) => ({ url: r.url.replace(baseUrl, ""), kind: fileKind(r.url, r.type), start: rel(r.start), end: r.end ? rel(r.end) : null, bytes: r.bytes ?? 0, status: r.status, encoding: r.encoding, priority: r.priority, failed: r.failed }))
      .sort((a, b) => a.start - b.start);
    const before = waterfall.filter((r) => r.end !== null && r.end <= live);
    const byKind = (rows) => rows.reduce((acc, r) => ((acc[r.kind] = (acc[r.kind] ?? 0) + r.bytes), acc), {});
    const fcp = page_.vitals.fcp;
    return {
      route,
      profile,
      tier: page_.level?.tier ?? null,
      ttfbMs: page_.nav?.ttfb,
      fcpMs: fcp,
      lcpMs: page_.vitals.lcp,
      cls: page_.vitals.cls,
      loadMs: page_.nav?.load,
      liveMs: live,
      runningMs: page_.runningAt,
      bytesBeforeLive: before.reduce((a, r) => a + r.bytes, 0),
      bytesTotal: waterfall.reduce((a, r) => a + r.bytes, 0),
      requests: waterfall.length,
      blockingToLive: blocking(page_.vitals.longTasks, fcp ?? 0, (Number.isFinite(live) ? live : 0) + 1000),
      blockingAll: blocking(page_.vitals.longTasks, 0, Infinity),
      kindsBeforeLive: byKind(before),
      kindsTotal: byKind(waterfall),
      longTasks: page_.vitals.longTasks,
      longFrames: page_.longFrames.slice(0, 40),
      waterfall,
    };
  } finally {
    await context.close();
  }
}

export async function run({ baseUrl, outDir, args = {} }) {
  const profiles = list(args.profiles) ?? ["phone", "desktop"];
  const routes = list(args.routes) ?? ["/"];
  const runs = Number(args.runs ?? (args.quick ? 1 : 3));
  const results = [];
  for (const profile of profiles) {
    for (const route of routes) {
      const cold = [];
      const warm = [];
      for (let i = 0; i < runs; i++) {
        const browser = await launch();
        try {
          for (const [label, list] of [["cold", cold], ["warm", warm]]) {
            const r = await traceOnce(browser, baseUrl, profile, route);
            list.push(r);
            console.log(`[trace] ${profile} ${route} ${label} run ${i + 1}: FCP ${fmtMs(r.fcpMs)}, LCP ${fmtMs(r.lcpMs)}, live ${fmtMs(r.liveMs)}, blocking ${fmtMs(r.blockingToLive.blockingMs)} (longest ${fmtMs(r.blockingToLive.longestMs)}), ${fmtBytes(r.bytesBeforeLive)} before live`);
          }
        } finally {
          await browser.close();
        }
      }
      results.push({ profile, route, gpuCache: "cold", runs: cold, median: summarizeRuns(cold) });
      results.push({ profile, route, gpuCache: "warm", runs: warm, median: summarizeRuns(warm) });
    }
  }
  const file = saveResult("trace", { takenAt: new Date().toISOString(), results }, outDir);
  console.log(`[trace] ${file}`);
  console.log("\n" + traceTable(results));
  return results;
}

export function summarizeRuns(runs) {
  const m = (f) => median(runs.map(f));
  const kinds = [...new Set(runs.flatMap((r) => Object.keys(r.kindsBeforeLive)))];
  return {
    tier: runs[0]?.tier,
    ttfbMs: m((r) => r.ttfbMs),
    fcpMs: m((r) => r.fcpMs),
    lcpMs: m((r) => r.lcpMs),
    cls: m((r) => r.cls),
    loadMs: m((r) => r.loadMs),
    liveMs: m((r) => r.liveMs),
    bytesBeforeLive: m((r) => r.bytesBeforeLive),
    bytesTotal: m((r) => r.bytesTotal),
    blockingMs: m((r) => r.blockingToLive.blockingMs),
    blockingMin: Math.min(...runs.map((r) => r.blockingToLive.blockingMs)),
    blockingMax: Math.max(...runs.map((r) => r.blockingToLive.blockingMs)),
    longestTaskMs: m((r) => r.blockingToLive.longestMs),
    tasksOver200: m((r) => r.blockingToLive.over200),
    kindsBeforeLive: Object.fromEntries(kinds.map((k) => [k, m((r) => r.kindsBeforeLive[k] ?? 0)])),
  };
}

export function traceTable(results) {
  return mdTable(results, [
    ["Profile", (r) => `${r.profile} (${r.median.tier ?? "?"} tier)`],
    ["Route", (r) => r.route],
    ["Shaders", (r) => r.gpuCache ?? "–"],
    ["Runs", (r) => r.runs.length],
    ["TTFB", (r) => fmtMs(r.median.ttfbMs)],
    ["First content", (r) => fmtMs(r.median.fcpMs)],
    ["LCP", (r) => fmtMs(r.median.lcpMs)],
    ["Live scene", (r) => fmtMs(r.median.liveMs)],
    ["Blocking to live (median, range)", (r) => `${fmtMs(r.median.blockingMs)} (${fmtMs(r.median.blockingMin)}–${fmtMs(r.median.blockingMax)})`],
    ["Longest task", (r) => fmtMs(r.median.longestTaskMs)],
    ["Tasks > 200 ms", (r) => r.median.tasksOver200],
    ["Bytes before live", (r) => fmtBytes(r.median.bytesBeforeLive)],
    ["Bytes total", (r) => fmtBytes(r.median.bytesTotal)],
    ["CLS", (r) => (Number.isFinite(r.median.cls) ? r.median.cls.toFixed(3) : "–")],
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { withRig, outDirFor } = await import("./rig.mjs");
  const out = outDirFor("trace");
  await withRig("trace", (ctx) => run({ ...ctx, outDir: out, args }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
