/**
 * Browser set-up shared by the rig's scripts: Chrome through playwright-core, the two
 * profiles (the QA phone profile and a desktop one), throttling over the DevTools protocol,
 * and the in-page probe (probe.js).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PERF_DIR } from "./lib.mjs";

/** Chrome DevTools' "Fast 4G" preset, the one QA used (9 Mbps down, 1.5 up, 60 ms × 2.75 RTT). */
export const FAST_4G = { offline: false, downloadThroughput: (9e6 / 8) * 0.9, uploadThroughput: (1.5e6 / 8) * 0.9, latency: 60 * 2.75 };

/**
 * Profiles. `phone` is QA's: a 412 × 915 screen, 4× CPU slowdown, Fast 4G, and a device that
 * reports 4 GB and 6 cores so it gets the low tier. `desktop` is a 1440 × 900 laptop screen at
 * 2× with no throttling, which gets the high tier on this Mac.
 */
export const PROFILES = {
  phone: {
    tier: "low",
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36",
    cpu: 4,
    network: FAST_4G,
    device: { deviceMemory: 4, hardwareConcurrency: 6 },
  },
  desktop: {
    tier: "high",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    userAgent: undefined,
    cpu: 1,
    network: null,
    device: { deviceMemory: 8, hardwareConcurrency: 12 },
  },
};

const PROBE = readFileSync(join(PERF_DIR, "probe.js"), "utf8");

/**
 * Headless Chrome on the real GPU (ANGLE on Metal here). Its frame rate is capped at 60 Hz.
 * Turning vsync off (--disable-gpu-vsync, --disable-frame-rate-limit) was tried and stalls
 * React Three Fiber's loop after one frame, so frame cost is read from JavaScript time and the
 * GPU timer instead.
 */
export async function launch({ headless = true } = {}) {
  const { chromium } = await import("playwright-core");
  return chromium.launch({
    channel: "chrome",
    headless,
    args: ["--enable-gpu", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
  });
}

/**
 * A fresh, isolated context (cold cache) with a profile applied and the probe installed.
 * `throttle: false` keeps the viewport and tier but drops the CPU and network slowdown.
 */
export async function openPage(browser, profileName, { probe = {}, throttle = true, reducedMotion = "no-preference" } = {}) {
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`unknown profile ${profileName}`);
  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    userAgent: profile.userAgent,
    reducedMotion,
    locale: "en-US",
  });
  const config = { gpuTimers: false, virtualTime: false, ...profile.device, ...probe };
  await context.addInitScript(`window.__RIG_CONFIG__ = ${JSON.stringify(config)};`);
  await context.addInitScript(PROBE);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  if (throttle && profile.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
  if (throttle && profile.network) await cdp.send("Network.emulateNetworkConditions", profile.network);
  return { context, page, cdp, profile };
}

/** Waits until the experience has drawn its first frame (the probe saw the stage renderer render). */
export async function waitForScene(page, { timeoutMs = 90000 } = {}) {
  await page.waitForFunction(() => window.__rig && window.__rig.started, null, { timeout: timeoutMs, polling: 100 });
}

/** Waits until the scene has drawn `frame` frames since its first. */
export async function waitForFrame(page, frame, { timeoutMs = 120000 } = {}) {
  await page.waitForFunction((n) => window.__rig.frame >= n, frame, { timeout: timeoutMs, polling: 100 });
}
