#!/usr/bin/env node
/**
 * Memory check (optimization track P0). Opens Home, then closes and reopens the scene five
 * times by client-side navigation (Home → Compounds → back), then opens and closes the explorer
 * five times (Explore → Back to the story), forcing garbage collection before each reading.
 * Next keeps a route it navigated away from mounted but hidden, so "closed" does not unmount
 * the scene: each closed reading also counts the render() calls per second made while away. Reads the JavaScript heap, DOM nodes and listeners (DevTools Performance
 * metrics), live WebGL contexts and what they hold on the GPU (the probe's allocation tally),
 * and three.js's own counts per renderer.
 *
 *   node scripts/perf/memory.mjs [--cycles 5] [--profile desktop]
 *
 * "No growth" means the closed-state readings after cycle 5 match cycle 1.
 */
import { pathToFileURL } from "node:url";
import { launch, openPage } from "./browser.mjs";
import { fmtBytes, mdTable, parseArgs, saveResult } from "./lib.mjs";

async function reading(page, cdp, label) {
  await cdp.send("HeapProfiler.collectGarbage");
  await page.waitForTimeout(300);
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const gpu = await page.evaluate(() => window.__rig.memory());
  return {
    label,
    url: new URL(page.url()).pathname,
    heapUsed: m.JSHeapUsedSize,
    heapTotal: m.JSHeapTotalSize,
    nodes: m.Nodes,
    listeners: m.JSEventListeners,
    documents: m.Documents,
    liveContexts: gpu.live,
    gpuBytes: gpu.liveBytes,
    renderers: gpu.renderers,
    contexts: gpu.contexts,
  };
}

async function waitForScene(page) {
  await page.waitForFunction(() => window.__rig.started, null, { timeout: 120000, polling: 200 });
  // A few seconds of frames so lazy work (shaders, textures) has happened.
  await page.waitForTimeout(4000);
}

async function rendersPerSecond(page) {
  const a = await page.evaluate(() => window.__rig.renderCount());
  await page.waitForTimeout(2000);
  const b = await page.evaluate(() => window.__rig.renderCount());
  return (b - a) / 2;
}

export async function run({ baseUrl, outDir, args = {} }) {
  const cycles = Number(args.cycles ?? 5);
  const profile = args.profile ?? "desktop";
  const browser = await launch();
  const rows = [];
  try {
    const { context, page, cdp } = await openPage(browser, profile, { throttle: false });
    await cdp.send("Performance.enable");
    await page.goto(baseUrl + "/", { waitUntil: "load" });
    await waitForScene(page);
    rows.push(await reading(page, cdp, "open 1"));
    for (let i = 1; i <= cycles; i++) {
      await page.locator('a[href="/compounds"]').first().click();
      await page.waitForURL(/\/compounds/, { timeout: 30000 });
      await page.waitForTimeout(2000);
      const away = await rendersPerSecond(page);
      rows.push({ ...(await reading(page, cdp, `route closed ${i}`)), rendersPerSecond: away });
      await page.goBack();
      await page.waitForURL((u) => new URL(u).pathname === "/", { timeout: 30000 });
      await page.waitForTimeout(4000);
      rows.push(await reading(page, cdp, `route open ${i + 1}`));
    }
    for (let i = 1; i <= cycles; i++) {
      await page.locator(".xp__explore").click();
      await page.waitForTimeout(3000);
      rows.push(await reading(page, cdp, `explorer open ${i}`));
      await page.locator(".xp__back").click();
      await page.waitForTimeout(3000);
      rows.push(await reading(page, cdp, `explorer closed ${i}`));
    }
    await context.close();
  } finally {
    await browser.close();
  }
  const growthOf = (prefix) => {
    const closed = rows.filter((r) => r.label.startsWith(prefix));
    if (closed.length < 2) return null;
    const [a, b] = [closed[0], closed.at(-1)];
    return { heap: b.heapUsed - a.heapUsed, gpu: b.gpuBytes - a.gpuBytes, contexts: b.liveContexts - a.liveContexts, nodes: b.nodes - a.nodes, listeners: b.listeners - a.listeners };
  };
  const growth = { route: growthOf("route closed"), explorer: growthOf("explorer closed") };
  const file = saveResult("memory", { takenAt: new Date().toISOString(), profile, cycles, rows, growth }, outDir);
  console.log(memoryTable(rows));
  for (const [k, g] of Object.entries(growth)) console.log(`[memory] ${k} growth, closed 1 → closed ${cycles}: heap ${fmtBytes(g?.heap)}, GPU ${fmtBytes(g?.gpu)}, contexts ${g?.contexts}, nodes ${g?.nodes}, listeners ${g?.listeners}`);
  console.log(`[memory] ${file}`);
  return { rows, growth };
}

export function memoryTable(rows) {
  return mdTable(rows, [
    ["Reading", (r) => r.label],
    ["Page", (r) => r.url],
    ["JS heap used", (r) => fmtBytes(r.heapUsed)],
    ["DOM nodes", (r) => r.nodes],
    ["Listeners", (r) => r.listeners],
    ["Live WebGL contexts", (r) => r.liveContexts],
    ["GPU memory (est.)", (r) => fmtBytes(r.gpuBytes)],
    ["Renderers seen", (r) => r.renderers.length],
    ["render() calls/s while away", (r) => r.rendersPerSecond ?? ""],
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { withRig, outDirFor } = await import("./rig.mjs");
  const out = outDirFor("memory");
  await withRig("memory", (ctx) => run({ ...ctx, outDir: out, args }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
