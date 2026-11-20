#!/usr/bin/env node
/**
 * Renders the stills of the Zaitun Hills story in public/sawad/story: one frame per beat, taken
 * from the live experience at the sequence position where that beat's panel is centred. They are
 * what visitors see instead of the 3D scene (no JavaScript, weak devices, Save-Data, reduced
 * motion, edit mode). Re-run after changing the story's camera (components/sawad/experience/story.ts)
 * or the scene's look. Track 5B replaces them with the Cycles renders.
 *
 *   npm run dev:lan                   # in another terminal (capture mode is development-only; use localhost)
 *   pnpm add -D playwright-core       # once; uses your installed Google Chrome
 *   node scripts/render-story-stills.mjs [baseUrl] [--dusk]
 *
 * `--dusk` writes the same frames at dusk as zaitun-<beat>-dusk.jpg (not used by the site yet).
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Beat id to sequence position: `at` of each beat in components/sawad/experience/beats.ts. */
export const STORY_STILLS = { entrance: 21, boulevard: 32, villa: 48, amenities: 66, aerial: 86 };

const args = process.argv.slice(2);
const dusk = args.includes("--dusk");
const base = args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000";
const out = fileURLToPath(new URL("../public/sawad/story", import.meta.url));

if (import.meta.url === `file://${process.argv[1]}`) {
  const { chromium } = await import("playwright-core").catch(() => {
    console.error("playwright-core is not installed: pnpm add -D playwright-core");
    process.exit(1);
  });
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", args: ["--enable-gpu", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  for (const [beat, at] of Object.entries(STORY_STILLS)) {
    const page = await ctx.newPage();
    await page.goto(`${base}/?story=${at}${dusk ? "&dusk=1" : ""}`, { waitUntil: "domcontentloaded" });
    // Pin the stage full screen and hide the page around it.
    await page.addStyleTag({
      content: `.xp__stage{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:9999!important}
                nextjs-portal,.site-header{display:none!important}`,
    });
    // "attached", not visible: with the stage pinned, the section itself has no height.
    await page.waitForSelector(".xp[data-scene-ready=true]", { state: "attached", timeout: 90000 });
    // Let the plants settle on their level of detail (and the dusk change finish).
    await page.waitForTimeout(dusk ? 8000 : 2500);
    const file = `${out}/zaitun-${beat}${dusk ? "-dusk" : ""}.jpg`;
    await page.locator(".xp__stage").screenshot({ path: file, type: "jpeg", quality: 82 });
    console.log("wrote", file);
    await page.close();
  }
  await browser.close();
}
