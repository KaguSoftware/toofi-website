#!/usr/bin/env node
/**
 * Track S8: the pages other than Home, loaded cold on both profiles.
 *
 *   node scripts/perf/S8/pages.mjs [--routes /compounds,/residences] [--profiles phone,desktop] [--runs 3]
 *
 * Per route: first content, LCP and its element, layout shift with each shift's sources (the
 * element, its box before and after), long tasks, bytes by file type, fonts, and whether a 3D
 * scene came up (and how much it fetched). Each run is a fresh Chrome context. Runs under the
 * rig's lock on the rig's production build.
 */
import { pathToFileURL } from "node:url";
import { launch, openPage } from "../browser.mjs";
import { fileKind, blocking } from "../trace.mjs";
import { fmtBytes, fmtMs, list, mdTable, median, parseArgs, saveResult } from "../lib.mjs";
import { withRig, outDirFor } from "../rig.mjs";

export const ROUTES = ["/", "/compounds", "/residences", "/contact", "/what-we-do", "/our-story", "/ar/compounds", "/ar/residences", "/ar/contact", "/ar/what-we-do", "/ar/our-story"];

/** Layout-shift and LCP detail the rig's own probe does not keep. */
export const SHIFT_PROBE = `(() => {
  const s = (window.__s8 = { shifts: [], lcp: null });
  const name = (n) => {
    if (!n || !n.nodeType) return null;
    const e = n.nodeType === 1 ? n : n.parentElement;
    if (!e) return null;
    const cls = typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
    return e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + cls;
  };
  const box = (r) => [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue;
        s.shifts.push({ at: Math.round(e.startTime), value: e.value, sources: (e.sources || []).map((x) => ({ node: name(x.node), from: box(x.previousRect), to: box(x.currentRect) })) });
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((l) => {
      const e = l.getEntries().at(-1);
      if (e) s.lcp = { at: Math.round(e.startTime), node: name(e.element), url: e.url || null, size: e.size };
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}
})();`;

/** Shifts grouped by the element that moved, largest total first. */
export function shiftsByNode(shifts) {
  const by = new Map();
  for (const sh of shifts) {
    const srcs = sh.sources.length ? sh.sources : [{ node: "(unknown)" }];
    for (const s of srcs) {
      const key = s.node ?? "(unknown)";
      const row = by.get(key) ?? { node: key, value: 0, count: 0 };
      row.value += sh.value / srcs.length;
      row.count += 1;
      by.set(key, row);
    }
  }
  return [...by.values()].sort((a, b) => b.value - a.value);
}

export async function loadOnce(browser, baseUrl, profile, route) {
  const { context, page, cdp } = await openPage(browser, profile);
  await context.addInitScript(SHIFT_PROBE);
  const reqs = new Map();
  let t0 = null;
  cdp.on("Network.requestWillBeSent", (e) => {
    if (t0 === null && e.type === "Document") t0 = e.timestamp;
    reqs.set(e.requestId, { url: e.request.url, type: e.type, start: e.timestamp });
  });
  cdp.on("Network.loadingFinished", (e) => {
    const r = reqs.get(e.requestId);
    if (r) Object.assign(r, { end: e.timestamp, bytes: e.encodedDataLength });
  });
  try {
    await page.goto(baseUrl + route, { waitUntil: "load", timeout: 120000 });
    await page.waitForTimeout(4000);
    const d = await page.evaluate(() => {
      const scene = document.querySelector(".scene");
      const n = performance.getEntriesByType("navigation")[0];
      return {
        vitals: window.__rig.vitals,
        s8: window.__s8,
        nav: n ? { ttfb: n.responseStart, load: n.loadEventEnd } : null,
        scenePhase: scene ? scene.getAttribute("data-phase") : null,
        sceneRan: !!(window.__rig && window.__rig.started),
        fonts: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family + " " + f.weight),
        height: document.documentElement.scrollHeight,
      };
    });
    const rows = [...reqs.values()]
      .filter((r) => !r.url.startsWith("data:") && r.end)
      .map((r) => ({ url: r.url.replace(baseUrl, ""), kind: fileKind(r.url, r.type), start: (r.start - t0) * 1000, end: (r.end - t0) * 1000, bytes: r.bytes ?? 0 }));
    const kinds = {};
    for (const r of rows) kinds[r.kind] = (kinds[r.kind] ?? 0) + r.bytes;
    return {
      route,
      profile,
      fcpMs: d.vitals.fcp,
      lcpMs: d.vitals.lcp,
      lcp: d.s8?.lcp ?? null,
      cls: d.vitals.cls,
      shifts: d.s8?.shifts ?? [],
      blocking: blocking(d.vitals.longTasks, 0, Infinity),
      bytes: rows.reduce((a, r) => a + r.bytes, 0),
      requests: rows.length,
      kinds,
      scenePhase: d.scenePhase,
      sceneRan: d.sceneRan,
      fonts: d.fonts,
      fontFiles: rows.filter((r) => r.kind === "font").map((r) => ({ url: r.url, bytes: r.bytes })),
      biggest: [...rows].sort((a, b) => b.bytes - a.bytes).slice(0, 8),
    };
  } finally {
    await context.close();
  }
}

export function summarize(runs) {
  const m = (f) => median(runs.map(f));
  return {
    fcpMs: m((r) => r.fcpMs),
    lcpMs: m((r) => r.lcpMs),
    cls: m((r) => r.cls),
    blockingMs: m((r) => r.blocking.blockingMs),
    longestMs: m((r) => r.blocking.longestMs),
    bytes: m((r) => r.bytes),
    requests: m((r) => r.requests),
    jsBytes: m((r) => r.kinds.js ?? 0),
    fontBytes: m((r) => r.kinds.font ?? 0),
    imageBytes: m((r) => r.kinds.image ?? 0),
    modelBytes: m((r) => r.kinds.model ?? 0),
  };
}

export function pagesTable(rows) {
  return mdTable(rows, [
    ["Profile", (r) => r.profile],
    ["Route", (r) => r.route],
    ["FCP", (r) => fmtMs(r.median.fcpMs)],
    ["LCP", (r) => fmtMs(r.median.lcpMs)],
    ["CLS", (r) => r.median.cls.toFixed(3)],
    ["Blocking", (r) => fmtMs(r.median.blockingMs)],
    ["Longest task", (r) => fmtMs(r.median.longestMs)],
    ["Bytes", (r) => fmtBytes(r.median.bytes)],
    ["JS", (r) => fmtBytes(r.median.jsBytes)],
    ["Fonts", (r) => fmtBytes(r.median.fontBytes)],
    ["Models", (r) => fmtBytes(r.median.modelBytes)],
    ["Requests", (r) => r.median.requests],
  ]);
}

export async function run({ baseUrl, outDir, args = {} }) {
  const profiles = list(args.profiles) ?? ["phone", "desktop"];
  const routes = list(args.routes) ?? ROUTES;
  const runs = Number(args.runs ?? 3);
  const results = [];
  for (const profile of profiles) {
    for (const route of routes) {
      const got = [];
      for (let i = 0; i < runs; i++) {
        const browser = await launch();
        try {
          const r = await loadOnce(browser, baseUrl, profile, route);
          got.push(r);
          console.log(`[S8 pages] ${profile} ${route} #${i + 1}: FCP ${fmtMs(r.fcpMs)} LCP ${fmtMs(r.lcpMs)} CLS ${r.cls.toFixed(3)} ${fmtBytes(r.bytes)} scene=${r.scenePhase}`);
        } finally {
          await browser.close();
        }
      }
      results.push({ profile, route, runs: got, median: summarize(got) });
    }
  }
  const file = saveResult("S8-pages", { takenAt: new Date().toISOString(), results }, outDir);
  console.log(`[S8 pages] ${file}\n\n` + pagesTable(results));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await withRig("S8 pages", ({ baseUrl }) => run({ baseUrl, outDir: outDirFor("S8-pages"), args }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((e) => { console.error(e); process.exit(1); });
