#!/usr/bin/env node
/**
 * Lighthouse (optimization track P0). Official runs, Lighthouse's own mobile configuration
 * (simulated slow 4G and 4× CPU, Moto G Power screen) and its desktop configuration, on Home in
 * English and Arabic, Compounds, Residences and Contact. Each page runs five times in a fresh
 * headless Chrome; the table shows the median run (by performance score) and its metrics.
 *
 *   node scripts/perf/lighthouse.mjs [--runs 5] [--forms mobile,desktop] [--routes /,/ar]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fmtMs, list, mdTable, median, parseArgs, saveResult } from "./lib.mjs";

export const ROUTES = ["/", "/ar", "/compounds", "/residences", "/contact"];

/** The run whose performance score is the median (Lighthouse's own advice for repeated runs). */
export function medianRun(runs) {
  const sorted = [...runs].sort((a, b) => a.score - b.score);
  return sorted[(sorted.length - 1) >> 1];
}

async function lighthouseOnce(url, form) {
  const { default: lighthouse } = await import("lighthouse");
  const chromeLauncher = await import("chrome-launcher");
  const config = form === "desktop" ? (await import("lighthouse/core/config/desktop-config.js")).default : undefined;
  const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new", "--enable-gpu", "--ignore-gpu-blocklist", "--no-first-run"] });
  try {
    const result = await lighthouse(url, { port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["performance", "accessibility", "best-practices", "seo"] }, config);
    const lhr = result.lhr;
    const a = lhr.audits;
    return {
      score: Math.round((lhr.categories.performance.score ?? 0) * 100),
      accessibility: Math.round((lhr.categories.accessibility?.score ?? 0) * 100),
      bestPractices: Math.round((lhr.categories["best-practices"]?.score ?? 0) * 100),
      seo: Math.round((lhr.categories.seo?.score ?? 0) * 100),
      fcpMs: a["first-contentful-paint"]?.numericValue,
      lcpMs: a["largest-contentful-paint"]?.numericValue,
      tbtMs: a["total-blocking-time"]?.numericValue,
      cls: a["cumulative-layout-shift"]?.numericValue,
      siMs: a["speed-index"]?.numericValue,
      bytes: a["total-byte-weight"]?.numericValue,
      mainThreadMs: a["mainthread-work-breakdown"]?.numericValue,
      bootupMs: a["bootup-time"]?.numericValue,
      runWarnings: lhr.runWarnings,
      lighthouseVersion: lhr.lighthouseVersion,
      opportunities: Object.values(a)
        .filter((x) => x.details?.type === "opportunity" && (x.details.overallSavingsMs ?? 0) > 0)
        .map((x) => ({ id: x.id, savingsMs: x.details.overallSavingsMs, savingsBytes: x.details.overallSavingsBytes ?? 0 }))
        .sort((x, y) => y.savingsMs - x.savingsMs)
        .slice(0, 6),
      report: result.report,
    };
  } finally {
    await chrome.kill();
  }
}

export async function run({ baseUrl, outDir, args = {} }) {
  const forms = list(args.forms) ?? ["mobile", "desktop"];
  const routes = list(args.routes) ?? ROUTES;
  const runs = Number(args.runs ?? (args.quick ? 1 : 5));
  const reportsDir = join(outDir, "lighthouse");
  mkdirSync(reportsDir, { recursive: true });
  const rows = [];
  for (const form of forms) {
    for (const route of routes) {
      const all = [];
      for (let i = 0; i < runs; i++) {
        const r = await lighthouseOnce(baseUrl + route, form);
        all.push(r);
        console.log(`[lighthouse] ${form} ${route} run ${i + 1}: performance ${r.score}, LCP ${fmtMs(r.lcpMs)}, TBT ${fmtMs(r.tbtMs)}, CLS ${r.cls?.toFixed(3)}`);
      }
      const mid = medianRun(all);
      const slug = route === "/" ? "home" : route.slice(1).replace(/\//g, "-");
      writeFileSync(join(reportsDir, `${form}-${slug}.json`), mid.report);
      const strip = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "report"));
      rows.push({ form, route, runs: all.map(strip), median: strip(mid), scores: all.map((r) => r.score), tbtMedian: median(all.map((r) => r.tbtMs)) });
    }
  }
  const file = saveResult("lighthouse", { takenAt: new Date().toISOString(), rows }, outDir);
  console.log(`[lighthouse] ${file}`);
  console.log("\n" + lighthouseTable(rows));
  return rows;
}

export function lighthouseTable(rows) {
  return mdTable(rows, [
    ["Form", (r) => r.form],
    ["Page", (r) => r.route],
    ["Performance (median; all runs)", (r) => `${r.median.score} (${r.scores.join(", ")})`],
    ["FCP", (r) => fmtMs(r.median.fcpMs)],
    ["LCP", (r) => fmtMs(r.median.lcpMs)],
    ["TBT", (r) => fmtMs(r.median.tbtMs)],
    ["CLS", (r) => (Number.isFinite(r.median.cls) ? r.median.cls.toFixed(3) : "–")],
    ["Speed Index", (r) => fmtMs(r.median.siMs)],
    ["A11y / BP / SEO", (r) => `${r.median.accessibility} / ${r.median.bestPractices} / ${r.median.seo}`],
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { withRig, outDirFor } = await import("./rig.mjs");
  const out = outDirFor("lighthouse");
  await withRig("lighthouse", (ctx) => run({ ...ctx, outDir: out, args }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
