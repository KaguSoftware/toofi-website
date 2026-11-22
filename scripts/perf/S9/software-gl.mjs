#!/usr/bin/env node
/**
 * Track S9: does the capability check tell a software renderer from a GPU?
 *
 *   node scripts/perf/S9/software-gl.mjs
 *
 * Opens a blank page in Chrome twice, once on the real GPU and once forced onto SwiftShader (the
 * software rasterizer a browser falls back to with hardware acceleration off, in a VM, on a
 * blocklisted driver or over remote desktop). In each it asks for a WebGL2 context the way
 * capability.ts does, and again with `failIfMajorPerformanceCaveat: true`, and reads the
 * renderer string. Times nothing, so it does not take the rig's lock.
 */
import { pathToFileURL } from "node:url";
import { mdTable } from "../lib.mjs";

export const VARIANTS = [
  { name: "GPU", args: ["--enable-gpu", "--ignore-gpu-blocklist"] },
  { name: "software (SwiftShader)", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"] },
];

/** Runs in the page: what each way of asking for a context returns. */
export function probeInPage() {
  const ask = (attrs) => {
    try {
      const gl = document.createElement("canvas").getContext("webgl2", attrs);
      if (!gl) return { context: false };
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return { context: true, renderer };
    } catch (err) {
      return { context: false, error: String(err) };
    }
  };
  return { plain: ask(undefined), strict: ask({ failIfMajorPerformanceCaveat: true }), concurrency: navigator.hardwareConcurrency, memory: navigator.deviceMemory ?? null };
}

/** The renderer strings that mean "no GPU", for a check that reads the string instead. */
export function isSoftwareRenderer(renderer) {
  return /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(renderer ?? "");
}

export async function run() {
  const { chromium } = await import("playwright-core");
  const rows = [];
  for (const v of VARIANTS) {
    const browser = await chromium.launch({ channel: "chrome", headless: true, args: v.args });
    try {
      const page = await browser.newPage();
      await page.goto("about:blank");
      const r = await page.evaluate(`(${probeInPage.toString()})()`);
      rows.push({ variant: v.name, ...r });
    } finally {
      await browser.close();
    }
  }
  console.log(
    mdTable(rows, [
      ["Chrome on", (r) => r.variant],
      ["WebGL2 as capability.ts asks", (r) => (r.plain.context ? "context" : "none")],
      ["with failIfMajorPerformanceCaveat", (r) => (r.strict.context ? "context" : "none")],
      ["Renderer", (r) => r.plain.renderer ?? ""],
      ["Threads / memory", (r) => `${r.concurrency} / ${r.memory}`],
    ]),
  );
  return rows;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
