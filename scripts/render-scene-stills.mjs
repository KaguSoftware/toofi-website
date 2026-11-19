#!/usr/bin/env node
/**
 * Renders the 12 scene stills in public/sawad (3 compounds × 4 viewpoints). They are the
 * posters shown before the 3D view loads, the fallback on slow devices, and the compound
 * images. Re-run after changing anything in components/sawad/scene.
 *
 *   npm run dev                       # in another terminal (capture mode is dev-only)
 *   pnpm add -D playwright-core       # once; uses your installed Google Chrome
 *   node scripts/render-scene-stills.mjs [baseUrl]
 */
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://127.0.0.1:3000";
const out = fileURLToPath(new URL("../public/sawad", import.meta.url));
const { chromium } = await import("playwright-core").catch(() => {
  console.error("playwright-core is not installed: pnpm add -D playwright-core");
  process.exit(1);
});

const variants = { dijla: "bustan-dijla", zaitun: "zaitun-hills", shatt: "shatt-gardens" };
const views = ["flight", "street", "terrace", "aerial"];
const browser = await chromium.launch({ channel: "chrome", args: ["--enable-gpu", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

for (const [variant, compound] of Object.entries(variants)) {
  for (const view of views) {
    const page = await ctx.newPage();
    await page.goto(`${base}/residences?compound=${compound}&view=${view}&capture=1`, { waitUntil: "networkidle" });
    // Pin the stage full screen and hide the page around it.
    await page.addStyleTag({
      content: `.finder__stage{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:9999!important}
                .finder__stage-ui,nextjs-portal,.site-header{display:none!important}`,
    });
    await page.waitForSelector(".scene[data-scene-ready=true]", { timeout: 60000 });
    await page.waitForTimeout(2500);
    const file = `${out}/scene-${variant}-${view}.jpg`;
    await page.locator(".finder__stage").screenshot({ path: file, type: "jpeg", quality: 82 });
    console.log("wrote", file);
    await page.close();
  }
}
await browser.close();
