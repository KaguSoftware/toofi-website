#!/usr/bin/env node
/**
 * Track S5: what the scene leaves behind and what keeps running when it should not.
 *
 *   node scripts/perf/S5/leaks.mjs [--only route,sound,walk-away,explorer] [--cycles 6]
 *
 * - route: Home → Compounds → back, `cycles` times, by client-side navigation. Next keeps Home
 *   mounted but hidden (React <Activity>), so each "away" reading also records what still runs:
 *   render() calls and main-thread busy time per second, React Three Fiber's frame loop setting
 *   and subscribers, and whether the canvas is still displayed. Heap snapshots after the first
 *   and the last away (and open) readings are diffed by constructor.
 * - sound: turns the sound on, leaves Home and comes back: what the AudioContexts and the music
 *   element do while away, and what the sound button says on return.
 * - walk-away: leaves Home while walking: do the walk's keyboard handlers still act on the other
 *   page (arrow keys stop scrolling)?
 * - explorer: Explore → Back, `cycles` times, with heap snapshots after the first and last close.
 *
 * Desktop profile, no throttling. Runs under the rig's lock, on the rig's production build.
 */
import { pathToFileURL } from "node:url";
import { launch, openPage } from "../browser.mjs";
import { fmtBytes, fmtMs, list, mdTable, parseArgs, saveResult } from "../lib.mjs";
import { S5_PROBE } from "./frameloop.mjs";
import { aggregate, diff } from "./heapsnap.mjs";

/** Records every AudioContext and media element the page makes, for the sound check. */
const AUDIO_PROBE = `(() => {
  const made = (window.__s5audio = { contexts: [], media: [] });
  for (const name of ["AudioContext", "webkitAudioContext"]) {
    const C = window[name];
    if (!C) continue;
    window[name] = class extends C { constructor(...a) { super(...a); made.contexts.push(this); } };
  }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) { if (!made.media.includes(this)) made.media.push(this); return play.apply(this, a); };
})();`;

async function open(browser) {
  const { context, page, cdp } = await openPage(browser, "desktop", { throttle: false });
  await context.addInitScript(S5_PROBE);
  await context.addInitScript(AUDIO_PROBE);
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.enable");
  return { context, page, cdp };
}

async function gc(cdp, page) {
  await cdp.send("HeapProfiler.collectGarbage");
  await page.waitForTimeout(300);
  await cdp.send("HeapProfiler.collectGarbage");
}

async function metrics(cdp) {
  const { metrics: m } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(m.map((x) => [x.name, x.value]));
}

async function snapshot(cdp) {
  const chunks = [];
  const onChunk = (c) => chunks.push(c.chunk);
  cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, captureNumericValue: false });
  cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
  return aggregate(JSON.parse(chunks.join("")));
}

/** What the hidden scene is doing: renders and main-thread busy time per second, and its loop's state. */
async function whileAway(page, cdp) {
  const m0 = await metrics(cdp);
  const r0 = await page.evaluate(() => window.__rig.renderCount());
  await page.waitForTimeout(2000);
  const m1 = await metrics(cdp);
  const r1 = await page.evaluate(() => window.__rig.renderCount());
  const scene = await page.evaluate(() => {
    const st = window.__s5.r3fState();
    const canvas = document.querySelector(".xp__canvas canvas");
    let shown = null;
    if (canvas) shown = canvas.getClientRects().length > 0;
    return {
      frameloop: st ? st.frameloop : null,
      subscribers: st ? st.internal.subscribers.length : null,
      size: st ? `${st.size.width}x${st.size.height}` : null,
      canvasConnected: canvas ? canvas.isConnected : null,
      canvasDisplayed: shown,
    };
  });
  return { rendersPerSecond: (r1 - r0) / 2, busyMsPerSecond: ((m1.TaskDuration - m0.TaskDuration) * 1000) / 2, scriptMsPerSecond: ((m1.ScriptDuration - m0.ScriptDuration) * 1000) / 2, ...scene };
}

async function reading(page, cdp, label, extra = {}) {
  await gc(cdp, page);
  const m = await metrics(cdp);
  const gpu = await page.evaluate(() => window.__rig.memory());
  return { label, url: new URL(page.url()).pathname, heap: m.JSHeapUsedSize, nodes: m.Nodes, listeners: m.JSEventListeners, contexts: gpu.live, gpuBytes: gpu.liveBytes, ...extra };
}

async function waitForScene(page) {
  await page.waitForFunction(() => window.__rig.started, null, { timeout: 120000, polling: 200 });
  await page.waitForTimeout(4000);
}

async function toCompounds(page) {
  await page.evaluate(() => document.querySelector('a[href="/compounds"]').click());
  await page.waitForURL(/\/compounds/, { timeout: 30000 });
  await page.waitForTimeout(2000);
}

async function backHome(page) {
  await page.goBack();
  await page.waitForURL((u) => new URL(u).pathname === "/", { timeout: 30000 });
  await page.waitForTimeout(4000);
}

async function route(browser, cycles) {
  const { context, page, cdp } = await open(browser);
  const rows = [];
  const snaps = {};
  try {
    await page.goto(location0(), { waitUntil: "load" });
    await waitForScene(page);
    rows.push(await reading(page, cdp, "open 1", { scene: await whileAway(page, cdp) }));
    snaps["open 1"] = await snapshot(cdp);
    for (let i = 1; i <= cycles; i++) {
      await toCompounds(page);
      const away = await whileAway(page, cdp);
      rows.push(await reading(page, cdp, `away ${i}`, { scene: away }));
      if (i === 1 || i === cycles) snaps[`away ${i}`] = await snapshot(cdp);
      await backHome(page);
      rows.push(await reading(page, cdp, `open ${i + 1}`));
      if (i === 1 || i === cycles) snaps[`open ${i + 1}`] = await snapshot(cdp);
    }
  } finally {
    await context.close();
  }
  const awayDiff = diff(snaps["away 1"], snaps[`away ${cycles}`]);
  const openDiff = diff(snaps["open 2"], snaps[`open ${cycles + 1}`]);
  const firstLeave = diff(snaps["open 1"], snaps["away 1"]);
  const firstReturn = diff(snaps["away 1"], snaps["open 2"]);
  // External memory (typed array backing stores) per snapshot: what geometry and buffers hold.
  const buffers = Object.fromEntries(Object.entries(snaps).map(([k, a]) => [k, a.groups.get("native:system / JSArrayBufferData")?.bytes ?? 0]));
  return { rows, awayDiff, openDiff, firstLeave, firstReturn, buffers };
}

/** The served build's address, set by run(). */
let BASE = "";
const location0 = () => BASE + "/";

async function explorer(browser, cycles) {
  const { context, page, cdp } = await open(browser);
  const rows = [];
  const snaps = {};
  try {
    await page.goto(location0(), { waitUntil: "load" });
    await waitForScene(page);
    for (let i = 1; i <= cycles; i++) {
      await page.locator(".xp__explore").click();
      await page.waitForTimeout(3000);
      await page.locator(".xp__back").click();
      await page.waitForTimeout(3000);
      rows.push(await reading(page, cdp, `explorer closed ${i}`));
      if (i === 1 || i === cycles) snaps[i] = await snapshot(cdp);
    }
  } finally {
    await context.close();
  }
  return { rows, closedDiff: diff(snaps[1], snaps[cycles]) };
}

async function audioState(page) {
  return page.evaluate(() => ({
    contexts: window.__s5audio.contexts.map((c) => c.state),
    media: window.__s5audio.media.map((m) => ({ paused: m.paused, src: m.currentSrc ? m.currentSrc.split("/").pop() : "", time: Math.round(m.currentTime * 10) / 10 })),
    button: (() => {
      const b = [...document.querySelectorAll(".xp__hud .xp__btn[aria-pressed]")].find((x) => /sound/i.test(x.getAttribute("aria-label") || ""));
      return b ? { pressed: b.getAttribute("aria-pressed"), label: b.getAttribute("aria-label") } : null;
    })(),
  }));
}

async function sound(browser) {
  const { context, page } = await open(browser);
  const steps = [];
  try {
    await page.goto(location0(), { waitUntil: "load" });
    await waitForScene(page);
    const btn = page.locator(".xp__hud .xp__btn[aria-pressed]").filter({ has: page.locator("svg") });
    // The sound button is the one whose label speaks of sound.
    const handle = await page.evaluateHandle(() => [...document.querySelectorAll(".xp__hud .xp__btn[aria-pressed]")].find((x) => /sound/i.test(x.getAttribute("aria-label") || "")));
    if (!handle || !(await handle.evaluate((x) => !!x))) return { error: "no sound button", count: await btn.count() };
    await handle.click();
    await page.waitForTimeout(2500);
    steps.push({ at: "Home, sound turned on", ...(await audioState(page)) });
    await toCompounds(page);
    await page.waitForTimeout(1500);
    steps.push({ at: "Compounds (Home hidden)", ...(await audioState(page)) });
    await backHome(page);
    steps.push({ at: "Home again", ...(await audioState(page)) });
  } finally {
    await context.close();
  }
  return { steps };
}

async function walkAway(browser) {
  const { context, page } = await open(browser);
  try {
    await page.goto(location0(), { waitUntil: "load" });
    await waitForScene(page);
    await page.locator(".xp__explore").click();
    await page.waitForTimeout(1500);
    await page.locator('.xp__hud[data-hud="explore"] .xp__modes button:nth-child(2)').click();
    await page.waitForTimeout(2500);
    await toCompounds(page);
    const probe = await page.evaluate(() => {
      const before = window.scrollY;
      const e = new KeyboardEvent("keydown", { code: "ArrowDown", key: "ArrowDown", bubbles: true, cancelable: true });
      window.dispatchEvent(e);
      return { arrowPrevented: e.defaultPrevented, scrollBefore: before, htmlOverflow: document.documentElement.style.overflow };
    });
    // A real key press: does the page scroll?
    const y0 = await page.evaluate(() => window.scrollY);
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(500);
    const y1 = await page.evaluate(() => window.scrollY);
    return { ...probe, scrolledByArrows: y1 - y0 };
  } finally {
    await context.close();
  }
}

/** The first return to Home, under the sampling heap profiler: who makes the new buffers. */
async function firstReturn(browser) {
  const { context, page, cdp } = await open(browser);
  try {
    await page.goto(location0(), { waitUntil: "load" });
    await waitForScene(page);
    await toCompounds(page);
    await gc(cdp, page);
    await cdp.send("HeapProfiler.startSampling", { samplingInterval: 256, includeObjectsCollectedByMinorGC: false, includeObjectsCollectedByMajorGC: false });
    await backHome(page);
    await gc(cdp, page);
    const { profile } = await cdp.send("HeapProfiler.stopSampling");
    // Kept allocations by stack (leaf plus three callers), largest first.
    const out = new Map();
    const walk = (node, stack) => {
      const cf = node.callFrame;
      const here = [`${cf.functionName || "(anon)"} ${String(cf.url).split("/").pop()}:${cf.lineNumber}:${cf.columnNumber}`, ...stack].slice(0, 4);
      if (node.selfSize) out.set(here.join(" < "), (out.get(here.join(" < ")) ?? 0) + node.selfSize);
      for (const c of node.children ?? []) walk(c, here);
    };
    walk(profile.head, []);
    return [...out.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([stack, bytes]) => ({ stack, bytes }));
  } finally {
    await context.close();
  }
}

/**
 * What a visitor sees on returning to Home: the canvas captured at fixed delays after the URL
 * changes back, and which model files are requested again. Images go to the run folder.
 */
async function returnRebuild(browser, outDir) {
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { context, page } = await open(browser);
  const requests = [];
  try {
    await page.goto(location0(), { waitUntil: "load" });
    await waitForScene(page);
    await toCompounds(page);
    page.on("request", (r) => /\.(glb|ktx2|wasm)(\?|$)/.test(r.url()) && requests.push(r.url().split("/").pop()));
    await page.goBack();
    await page.waitForURL((u) => new URL(u).pathname === "/", { timeout: 30000 });
    const t0 = Date.now();
    const shots = [];
    for (const at of [50, 300, 700, 1500, 3000]) {
      await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
      // A screenshot of what is on screen (the canvas does not keep its drawing buffer between frames).
      const img = await page.screenshot({ type: "png", scale: "css" }).catch(() => null);
      // The model in the scene graph: is the compound there?
      const model = await page.evaluate(() => {
        const st = window.__s5.r3fState();
        return st ? !!st.scene.getObjectByName("architecture-model") : null;
      });
      const file = join(outDir, `return-${at}ms.png`);
      if (img) writeFileSync(file, img);
      shots.push({ at, model, file: img ? file : null });
    }
    return { requests, shots };
  } finally {
    await context.close();
  }
}

export async function run({ baseUrl, outDir, args = {} }) {
  const only = list(args.only) ?? ["route", "sound", "walk-away", "explorer"];
  const cycles = Number(args.cycles ?? 6);
  const browser = await launch();
  const result = { takenAt: new Date().toISOString(), cycles };
  BASE = baseUrl;
  try {
    if (only.includes("route")) {
      result.route = await route(browser, cycles);
      console.log(routeTable(result.route.rows));
      printDiff("away 1 → away " + cycles, result.route.awayDiff);
      printDiff("open 2 → open " + (cycles + 1), result.route.openDiff);
      printDiff("open 1 → away 1 (first leave)", result.route.firstLeave);
      printDiff("away 1 → open 2 (first return)", result.route.firstReturn);
      console.log("[S5 leaks] ArrayBuffer backing stores per snapshot:", Object.entries(result.route.buffers).map(([k, b]) => `${k} ${fmtBytes(b)}`).join(", "));
    }
    if (only.includes("return-rebuild")) {
      result.returnRebuild = await returnRebuild(browser, outDir);
      console.log("[S5 leaks] return-rebuild:", JSON.stringify(result.returnRebuild));
    }
    if (only.includes("first-return")) {
      result.firstReturn = await firstReturn(browser);
      for (const r of result.firstReturn) console.log(`   ${fmtBytes(r.bytes).padStart(10)}  ${r.stack}`);
    }
    if (only.includes("sound")) {
      result.sound = await sound(browser);
      console.log("[S5 leaks] sound:", JSON.stringify(result.sound, null, 1));
    }
    if (only.includes("walk-away")) {
      result.walkAway = await walkAway(browser);
      console.log("[S5 leaks] walk-away:", JSON.stringify(result.walkAway));
    }
    if (only.includes("explorer")) {
      result.explorer = await explorer(browser, cycles);
      console.log(routeTable(result.explorer.rows));
      printDiff("explorer closed 1 → " + cycles, result.explorer.closedDiff);
    }
  } finally {
    await browser.close();
  }
  const file = saveResult(args.name ?? "S5-leaks", result, outDir);
  console.log(`[S5 leaks] ${file}`);
  return result;
}

function printDiff(title, d) {
  console.log(`\n[S5 leaks] heap growth ${title}: ${fmtBytes(d.dTotal)} in ${d.dNodes} objects, detached DOM ${d.dDetached}`);
  for (const g of d.grew.slice(0, 15)) console.log(`   ${fmtBytes(g.dBytes).padStart(10)}  ${String(g.dCount).padStart(7)}  ${g.key}`);
}

export function routeTable(rows) {
  return mdTable(rows, [
    ["Reading", (r) => r.label],
    ["Page", (r) => r.url],
    ["JS heap", (r) => fmtBytes(r.heap)],
    ["DOM nodes", (r) => r.nodes],
    ["Listeners", (r) => r.listeners],
    ["GPU (est.)", (r) => fmtBytes(r.gpuBytes)],
    ["render()/s", (r) => r.scene?.rendersPerSecond ?? ""],
    ["Main thread busy/s", (r) => (r.scene ? fmtMs(r.scene.busyMsPerSecond) : "")],
    ["Loop", (r) => r.scene?.frameloop ?? ""],
    ["Canvas shown", (r) => (r.scene ? String(r.scene.canvasDisplayed) : "")],
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { withRig, outDirFor } = await import("../rig.mjs");
  const out = outDirFor("S5-leaks");
  await withRig("S5 leaks", (ctx) => run({ ...ctx, outDir: out, args }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
