#!/usr/bin/env node
/**
 * Track S5: what the visitor gets when the GPU context is lost (a GPU reset, a phone reclaiming
 * memory from a background tab, a driver crash). `WEBGL_lose_context` drops the stage's context
 * on purpose, in the story and while exploring; after a second the browser offers it back
 * (restoreContext). Read: what is reported, what the page shows, whether anything keeps running,
 * and whether the scene comes back.
 *
 *   node scripts/perf/S5/context-loss.mjs
 *
 * Desktop profile, no throttling. Runs under the rig's lock, on the rig's production build.
 */
import { pathToFileURL } from "node:url";
import { launch, openPage } from "../browser.mjs";
import { parseArgs, saveResult } from "../lib.mjs";
import { S5_PROBE } from "./frameloop.mjs";

async function pageState(page) {
  return page.evaluate(() => {
    const root = document.querySelector(".xp");
    const canvas = document.querySelector(".xp__canvas canvas");
    const gl = canvas && (canvas.getContext("webgl2") || canvas.getContext("webgl"));
    return {
      state: root?.dataset.state ?? null,
      running: root?.dataset.running ?? null,
      mode: root?.dataset.mode ?? null,
      canvas: !!canvas,
      contextLost: gl ? gl.isContextLost() : null,
      htmlOverflow: document.documentElement.style.overflow,
      renders: window.__rig.renderCount(),
      contexts: window.__rig.memory().live,
    };
  });
}

async function scenario(browser, baseUrl, { explore }) {
  const { context, page } = await openPage(browser, "desktop", { throttle: false });
  await context.addInitScript(S5_PROBE);
  const consoleLines = [];
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && consoleLines.push(`${m.type()}: ${m.text().slice(0, 300)}`));
  page.on("pageerror", (e) => consoleLines.push(`pageerror: ${String(e).slice(0, 300)}`));
  const out = { explore, steps: [] };
  try {
    await page.goto(baseUrl + "/", { waitUntil: "load" });
    await page.waitForFunction(() => window.__rig.started, null, { timeout: 120000, polling: 200 });
    await page.waitForTimeout(3000);
    if (explore) {
      await page.locator(".xp__explore").click();
      await page.waitForTimeout(2000);
    }
    out.steps.push({ at: "before", ...(await pageState(page)) });
    await page.evaluate(() => {
      const canvas = document.querySelector(".xp__canvas canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      window.__s5lose = gl.getExtension("WEBGL_lose_context");
      window.__s5lose.loseContext();
    });
    await page.waitForTimeout(1000);
    out.steps.push({ at: "1 s after the loss", ...(await pageState(page)) });
    // The browser offers the context back.
    const restored = await page.evaluate(() => {
      try {
        window.__s5lose.restoreContext();
        return true;
      } catch (err) {
        return String(err);
      }
    });
    await page.waitForTimeout(3000);
    out.steps.push({ at: `3 s after restoreContext (${restored === true ? "offered" : restored})`, ...(await pageState(page)) });
    const r0 = await page.evaluate(() => window.__rig.renderCount());
    await page.waitForTimeout(1000);
    out.rendersPerSecondAfter = (await page.evaluate(() => window.__rig.renderCount())) - r0;
    // Can the visitor get the scene back without reloading?
    out.exploreButton = await page.locator(".xp__explore").count();
    out.offerButton = await page.locator(".xp__offer-btn").count();
  } finally {
    out.console = consoleLines;
    await context.close();
  }
  return out;
}

export async function run({ baseUrl, outDir, args = {} }) {
  const browser = await launch();
  const result = { takenAt: new Date().toISOString(), runs: [] };
  try {
    for (const explore of [false, true]) {
      const r = await scenario(browser, baseUrl, { explore });
      result.runs.push(r);
      console.log(`[S5 context] ${explore ? "exploring" : "story"}`);
      for (const s of r.steps) console.log(`   ${s.at.padEnd(40)} state ${s.state} running ${s.running} mode ${s.mode} canvas ${s.canvas} lost ${s.contextLost} overflow "${s.htmlOverflow}" contexts ${s.contexts}`);
      console.log(`   render()/s afterwards ${r.rendersPerSecondAfter}; explore button ${r.exploreButton}, 3D offer button ${r.offerButton}`);
      for (const c of r.console) console.log(`   ${c}`);
    }
  } finally {
    await browser.close();
  }
  const file = saveResult(args.name ?? "S5-context-loss", result, outDir);
  console.log(`[S5 context] ${file}`);
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { withRig, outDirFor } = await import("../rig.mjs");
  const out = outDirFor("S5-context-loss");
  await withRig("S5 context loss", (ctx) => run({ ...ctx, outDir: out, args }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
