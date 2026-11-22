#!/usr/bin/env node
/**
 * Track S8: the finder's scene per compound. Loads /residences?compound=<id> cold and reports
 * the poster-to-scene time (the `.scene` region reaches data-scene-ready), bytes fetched by
 * type, and the time and bytes of a switch to another compound with the scene already running.
 *
 *   node scripts/perf/S8/switch.mjs [--profiles phone,desktop] [--runs 2]
 */
import { pathToFileURL } from "node:url";
import { launch, openPage } from "../browser.mjs";
import { fileKind } from "../trace.mjs";
import { fmtBytes, fmtMs, list, mdTable, median, parseArgs, saveResult } from "../lib.mjs";
import { withRig, outDirFor } from "../rig.mjs";

export const COMPOUND_IDS = ["zaitun-hills", "bustan-dijla", "shatt-gardens"];

/** Sums encoded bytes by file kind. */
export function bytesByKind(rows) {
  const out = {};
  for (const r of rows) out[r.kind] = (out[r.kind] ?? 0) + r.bytes;
  return out;
}

async function sceneReady(page, timeout = 90000) {
  await page.waitForSelector(".scene[data-scene-ready='true']", { timeout, state: "attached" });
}

export async function once(browser, baseUrl, profile, from, to) {
  const { context, page, cdp } = await openPage(browser, profile);
  const rows = [];
  const open = new Map();
  cdp.on("Network.requestWillBeSent", (e) => open.set(e.requestId, { url: e.request.url, type: e.type }));
  cdp.on("Network.loadingFinished", (e) => {
    const r = open.get(e.requestId);
    if (r) rows.push({ url: r.url.replace(baseUrl, ""), kind: fileKind(r.url, r.type), bytes: e.encodedDataLength ?? 0, at: Date.now() });
  });
  try {
    const t0 = Date.now();
    await page.goto(`${baseUrl}/residences?compound=${from}`, { waitUntil: "load", timeout: 120000 });
    let readyMs = null;
    // Phones leave the scene behind a "Load 3D" button: tap it and time from the tap.
    const button = page.locator(".scene__load");
    let tapAt = t0;
    if (await button.count()) {
      await button.tap();
      tapAt = Date.now();
    }
    try {
      await sceneReady(page, 60000);
      readyMs = Date.now() - tapAt;
    } catch {}
    const loadBytes = bytesByKind(rows);
    const files = rows.filter((r) => r.kind === "model" || r.kind === "texture").map((r) => `${r.url.split("/").pop()} ${fmtBytes(r.bytes)}`);
    let switchMs = null;
    let switchBytes = {};
    if (readyMs !== null && to) {
      const n = rows.length;
      const t1 = Date.now();
      await page.locator(`input[name='finder-compound'][value='${to}']`).locator("xpath=..").click();
      await page.waitForSelector(".scene:not([data-scene-ready='true'])", { timeout: 5000, state: "attached" }).catch(() => {});
      try {
        await sceneReady(page, 60000);
        switchMs = Date.now() - t1;
      } catch {}
      switchBytes = bytesByKind(rows.slice(n));
    }
    return { profile, from, to, readyMs, loadBytes, files, switchMs, switchBytes };
  } finally {
    await context.close();
  }
}

export function switchTable(rows) {
  return mdTable(rows, [
    ["Profile", (r) => r.profile],
    ["Open", (r) => r.from],
    ["Scene ready", (r) => fmtMs(r.median.readyMs)],
    ["Models before", (r) => fmtBytes(r.median.model)],
    ["Switch to", (r) => r.to ?? "–"],
    ["Switch time", (r) => fmtMs(r.median.switchMs)],
    ["Switch bytes (models)", (r) => fmtBytes(r.median.switchModel)],
  ]);
}

export async function run({ baseUrl, outDir, args = {} }) {
  const profiles = list(args.profiles) ?? ["phone", "desktop"];
  const runs = Number(args.runs ?? 2);
  const results = [];
  for (const profile of profiles) {
    for (const from of COMPOUND_IDS) {
      const to = COMPOUND_IDS[(COMPOUND_IDS.indexOf(from) + 1) % COMPOUND_IDS.length];
      const got = [];
      for (let i = 0; i < runs; i++) {
        const browser = await launch();
        try {
          const r = await once(browser, baseUrl, profile, from, to);
          got.push(r);
          console.log(`[S8 switch] ${profile} ${from}→${to} #${i + 1}: ready ${fmtMs(r.readyMs)} models ${fmtBytes(r.loadBytes.model ?? 0)}, switch ${fmtMs(r.switchMs)}`);
        } finally {
          await browser.close();
        }
      }
      const m = (f) => median(got.map(f).filter((v) => v !== null && Number.isFinite(v)));
      results.push({ profile, from, to, runs: got, median: { readyMs: m((r) => r.readyMs), model: m((r) => r.loadBytes.model ?? 0), switchMs: m((r) => r.switchMs), switchModel: m((r) => r.switchBytes.model ?? 0) } });
    }
  }
  const file = saveResult("S8-switch", { takenAt: new Date().toISOString(), results }, outDir);
  console.log(`[S8 switch] ${file}\n\n` + switchTable(results));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await withRig("S8 switch", ({ baseUrl }) => run({ baseUrl, outDir: outDirFor("S8-switch"), args }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((e) => { console.error(e); process.exit(1); });
