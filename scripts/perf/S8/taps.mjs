#!/usr/bin/env node
/**
 * Track S8: how fast the finder answers a tap or click.
 *
 *   node scripts/perf/S8/taps.mjs [--profiles phone,desktop] [--runs 3] [--route /residences]
 *
 * Opens the finder, waits for it to settle, then does each action `runs` times with a real
 * input event and reads the Event Timing entry for it: input delay, processing, and the wait
 * for the next paint (what INP reports). Target is under 200 ms. Phone: 4× CPU, touch taps.
 */
import { pathToFileURL } from "node:url";
import { launch, openPage } from "../browser.mjs";
import { fmtMs, list, mdTable, median, parseArgs, saveResult } from "../lib.mjs";
import { withRig, outDirFor } from "../rig.mjs";

/** Records every event that takes 16 ms or more, with the pieces of its duration. */
export const EVENT_PROBE = `(() => {
  const log = (window.__s8events = []);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (!e.interactionId) continue;
        log.push({ type: e.name, start: e.startTime, duration: e.duration, delay: e.processingStart - e.startTime, processing: e.processingEnd - e.processingStart, present: e.startTime + e.duration - e.processingEnd });
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: true });
  } catch {}
})();`;

/** The actions: a label and a locator query (role/name or CSS) run in the finder. */
export const ACTIONS = [
  { id: "viewpoint", label: "Viewpoint button", css: ".viewpoints button:not([aria-pressed='true'])" },
  { id: "compound", label: "Compound switch", css: "input[name='finder-compound']:not(:checked)", label_for: true },
  { id: "list-row", label: "Residence row", css: ".finder__panel li button:not([aria-pressed])" },
  { id: "compare", label: "Compare toggle", css: ".finder__panel button[aria-pressed]" },
  { id: "filter", label: "Filter chip", css: ".finder__panel input[type='radio']:not(:checked)", label_for: true },
];

/** Worst interaction duration among events that started after `since`. */
export function worstSince(events, since) {
  const later = events.filter((e) => e.start >= since);
  if (!later.length) return null;
  return later.reduce((a, b) => (b.duration > a.duration ? b : a));
}

export async function measure(browser, baseUrl, profile, route, runs) {
  const { context, page } = await openPage(browser, profile);
  await context.addInitScript(EVENT_PROBE);
  const out = [];
  try {
    await page.goto(baseUrl + route, { waitUntil: "load", timeout: 120000 });
    await page.waitForTimeout(6000);
    const touch = profile === "phone";
    for (const a of ACTIONS) {
      const durations = [];
      let last = null;
      for (let i = 0; i < runs; i++) {
        const loc = page.locator(a.css).nth(i % 3);
        if (!(await loc.count())) break;
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        const since = await page.evaluate(() => performance.now());
        const target = a.label_for ? loc.locator("xpath=..") : loc;
        try {
          if (touch) await target.tap({ timeout: 5000 });
          else await target.click({ timeout: 5000 });
        } catch {
          break;
        }
        await page.waitForTimeout(700);
        const ev = worstSince(await page.evaluate(() => window.__s8events), since);
        durations.push(ev ? ev.duration : 0);
        if (ev) last = ev;
      }
      out.push({ id: a.id, label: a.label, n: durations.length, durations, medianMs: durations.length ? median(durations) : null, worstMs: durations.length ? Math.max(...durations) : null, last });
    }
  } finally {
    await context.close();
  }
  return out;
}

export function tapsTable(results) {
  return mdTable(
    results.flatMap((r) => r.actions.map((a) => ({ profile: r.profile, ...a }))),
    [
      ["Profile", (r) => r.profile],
      ["Action", (r) => r.label],
      ["Taps", (r) => r.n],
      ["Median", (r) => fmtMs(r.medianMs)],
      ["Worst", (r) => fmtMs(r.worstMs)],
      ["Input delay", (r) => fmtMs(r.last?.delay)],
      ["Processing", (r) => fmtMs(r.last?.processing)],
      ["To next paint", (r) => fmtMs(r.last?.present)],
    ],
  );
}

export async function run({ baseUrl, outDir, args = {} }) {
  const profiles = list(args.profiles) ?? ["phone", "desktop"];
  const route = args.route ?? "/residences";
  const runs = Number(args.runs ?? 3);
  const results = [];
  for (const profile of profiles) {
    const browser = await launch();
    try {
      const actions = await measure(browser, baseUrl, profile, route, runs);
      results.push({ profile, route, actions });
    } finally {
      await browser.close();
    }
  }
  const file = saveResult("S8-taps", { takenAt: new Date().toISOString(), results }, outDir);
  console.log(`[S8 taps] ${file}\n\n` + tapsTable(results));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await withRig("S8 taps", ({ baseUrl }) => run({ baseUrl, outDir: outDirFor("S8-taps"), args }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((e) => { console.error(e); process.exit(1); });
