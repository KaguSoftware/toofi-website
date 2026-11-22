#!/usr/bin/env node
/**
 * Track S8: the admin panel where it is slow to use (only if the owner puts it in scope).
 *
 *   node scripts/perf/S8/admin.mjs [--profiles desktop,phone]
 *
 * Signs in as the demo admin (local mode, sample data), then loads each panel page by full
 * navigation and reports first content, LCP, long tasks and JavaScript and bytes. Also times
 * the sign-in itself and one client-side navigation from the pages list to a page's editor.
 */
import { pathToFileURL } from "node:url";
import { launch, openPage } from "../browser.mjs";
import { blocking, fileKind } from "../trace.mjs";
import { fmtBytes, fmtMs, list, mdTable, parseArgs, saveResult } from "../lib.mjs";
import { withRig, outDirFor } from "../rig.mjs";

export const PANEL_ROUTES = ["/admin", "/admin/pages", "/admin/media", "/admin/users", "/admin/pages/new"];

export function adminTable(rows) {
  return mdTable(rows, [
    ["Profile", (r) => r.profile],
    ["Step", (r) => r.step],
    ["Time", (r) => fmtMs(r.ms)],
    ["FCP", (r) => fmtMs(r.fcpMs)],
    ["LCP", (r) => fmtMs(r.lcpMs)],
    ["Blocking", (r) => fmtMs(r.blockingMs)],
    ["Longest task", (r) => fmtMs(r.longestMs)],
    ["Bytes", (r) => fmtBytes(r.bytes)],
    ["JS", (r) => fmtBytes(r.js)],
  ]);
}

async function readPage(page) {
  return page.evaluate(() => ({ v: window.__rig.vitals }));
}

export async function measure(browser, baseUrl, profile) {
  const { context, page, cdp } = await openPage(browser, profile);
  const rows = [];
  let bytes = 0;
  let js = 0;
  const open = new Map();
  cdp.on("Network.requestWillBeSent", (e) => open.set(e.requestId, { url: e.request.url, type: e.type }));
  cdp.on("Network.loadingFinished", (e) => {
    const r = open.get(e.requestId);
    if (!r) return;
    bytes += e.encodedDataLength ?? 0;
    if (fileKind(r.url, r.type) === "js") js += e.encodedDataLength ?? 0;
  });
  const record = async (step, ms) => {
    const { v } = await readPage(page);
    const b = blocking(v.longTasks, 0, Infinity);
    rows.push({ profile, step, ms, fcpMs: v.fcp, lcpMs: v.lcp, blockingMs: b.blockingMs, longestMs: b.longestMs, bytes, js });
  };
  try {
    await page.goto(`${baseUrl}/admin/login`, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    await record("login page", 0);
    await page.fill("#email", "admin@sawad.local");
    await page.fill("#password", "password");
    const t0 = Date.now();
    await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);
    await page.waitForLoadState("load");
    await record("sign in → dashboard", Date.now() - t0);
    for (const route of PANEL_ROUTES) {
      bytes = 0;
      js = 0;
      await page.evaluate(() => (window.__rig.vitals.longTasks.length = 0)).catch(() => {});
      const t = Date.now();
      await page.goto(baseUrl + route, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      await record(route, Date.now() - t);
    }
    // Editing one page: the list's first "Edit" link, client-side.
    await page.goto(`${baseUrl}/admin/pages`, { waitUntil: "load" });
    await page.waitForTimeout(1000);
    const link = page.locator("a[href^='/admin/pages/']:not([href$='/new'])").first();
    if (await link.count()) {
      bytes = 0;
      js = 0;
      const t = Date.now();
      await link.click();
      await page.waitForLoadState("load");
      await page.waitForTimeout(1500);
      await record("pages list → editor (client nav)", Date.now() - t);
    }
  } finally {
    await context.close();
  }
  return rows;
}

export async function run({ baseUrl, outDir, args = {} }) {
  const profiles = list(args.profiles) ?? ["desktop", "phone"];
  const all = [];
  for (const profile of profiles) {
    const browser = await launch();
    try {
      all.push(...(await measure(browser, baseUrl, profile)));
    } finally {
      await browser.close();
    }
  }
  const file = saveResult("S8-admin", { takenAt: new Date().toISOString(), rows: all }, outDir);
  console.log(`[S8 admin] ${file}\n\n` + adminTable(all));
  return all;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await withRig("S8 admin", ({ baseUrl }) => run({ baseUrl, outDir: outDirFor("S8-admin"), args }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((e) => { console.error(e); process.exit(1); });
