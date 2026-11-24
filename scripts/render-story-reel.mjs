#!/usr/bin/env node
/**
 * Records the reel: the Zaitun Hills story as video (components/sawad/experience/reel.ts), which
 * Home plays instead of drawing the live scene. Every frame is drawn by the live scene itself in
 * its capture mode (`/?reel=1&view=<view>`, components/sawad/experience/ReelCapture.tsx): the top
 * quality level at two device pixels per CSS pixel, with every tree at its finest level, at the
 * scene time and camera position this script gives. So the same frames come out however fast the
 * machine is, and nothing changes detail as the camera comes closer.
 *
 *   npm run dev:lan                                        # capture mode is development-only; use localhost
 *   pnpm install --dir scripts/perf --ignore-workspace     # once: playwright-core, drives your Google Chrome
 *   node scripts/render-story-reel.mjs [baseUrl] [--views flight,street] [--codecs av1,hevc] [--no-tour] [--encode-only] [--no-encode]
 *   node scripts/blender/version-assets.mjs                # then: content hashes in the file names
 *
 * Per start view it records the opening (480 frames: the hold on the poster frame, then the flight
 * to the gate); in the first view's session it runs on into the tour (1441 frames, twenty per sequence
 * second), so the tour's first frame is the frame every opening ends on. Frames go to
 * scripts/blender/out/reel/frames/ (not in git) as JPEG at 3840 x 2160; a frame already on disk is
 * drawn again (the scene's clock has to pass through it) but not read, so a stopped run resumes.
 * ffmpeg then writes public/sawad/reel/zaitun-{opening-<view>,tour}-{wide,tall}{-av1,-hevc,}.mp4:
 * AV1, HEVC for the devices that lack AV1, and H.264, which everything plays (`--codecs av1` limits it).
 *
 * Needs ffmpeg with libsvtav1, libx265 and libx264 on the PATH (or FFMPEG=/path/to/ffmpeg).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
export const ROOT = here("../");
export const FRAMES_DIR = join(ROOT, "scripts/blender/out/reel/frames");
export const OUT_DIR = join(ROOT, "public/sawad/reel");

// The timeline, as in components/sawad/experience/beats.ts and reel.ts (render-story-reel.test.ts holds them equal).
export const REEL_FPS = 30;
export const INTRO_HOLD_SECONDS = 2;
export const INTRO_SECONDS = 14;
export const STORY_END = 86;
export const OPENING_SECONDS = INTRO_HOLD_SECONDS + INTRO_SECONDS;
export const TOUR_FRAMES_PER_UNIT = 20;
/** Tour frames for each second of the scene's clock: people and cars cover the same ground for a given scroll at any density. */
export const TOUR_CLOCK_FPS = 3 * TOUR_FRAMES_PER_UNIT;
export const TOUR_FRAMES = (STORY_END - INTRO_SECONDS) * TOUR_FRAMES_PER_UNIT;

export const VIEWS = ["flight", "street", "terrace", "aerial"];
/** The canvas the capture mode draws: 1920 x 1080 CSS pixels at REEL_QUALITY's pixel ratio of 2. */
export const VIEWPORT = { width: 1920, height: 1080 };
export const MASTER = { width: 3840, height: 2160 };
/** The two shapes that ship (reel.ts `REEL_SIZE`). The tall one is the middle strip of the wide frame. */
export const SHAPES = {
  wide: { width: 1920, height: 1080 },
  tall: { width: 720, height: 1280 },
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const openingPosition = (seconds) => clamp(seconds - INTRO_HOLD_SECONDS, 0, INTRO_SECONDS);
export const tourPosition = (frame) => clamp(INTRO_SECONDS + frame / TOUR_FRAMES_PER_UNIT, INTRO_SECONDS, STORY_END);

/** The opening's frames: one for every 1/30 s of its 16 s, the last one a frame short of the gate. */
export function openingFrames() {
  return Array.from({ length: OPENING_SECONDS * REEL_FPS }, (_, k) => ({ part: "opening", index: k, seconds: k / REEL_FPS, position: openingPosition(k / REEL_FPS) }));
}

/** The tour's frames: the gate, then TOUR_FRAMES_PER_UNIT per sequence second to the final aerial. The scene's clock runs on from the opening; the plants stand still. */
export function tourFrames() {
  return Array.from({ length: TOUR_FRAMES + 1 }, (_, k) => ({ part: "tour", index: k, seconds: OPENING_SECONDS + k / TOUR_CLOCK_FPS, position: tourPosition(k), still: true }));
}

/** Everything one page session draws, in order: the view's opening, then (once) the tour. */
export function framePlan({ tour }) {
  return tour ? [...openingFrames(), ...tourFrames()] : openingFrames();
}

export const clipName = (part, view) => (part === "tour" ? "tour" : `opening-${view}`);
export const frameFile = (part, view, index, dir = FRAMES_DIR) => join(dir, clipName(part, view), `${String(index).padStart(5, "0")}.jpg`);
/** The codecs each file ships in, best first (reel.ts `REEL_CODECS`). H.264 carries the plain name. */
export const CODECS = ["av1", "hevc", "h264"];
export const outFile = (part, view, shape, dir = OUT_DIR, codec = "h264") => join(dir, `zaitun-${clipName(part, view)}-${shape}${codec === "h264" ? "" : `-${codec}`}.mp4`);

/**
 * How each file is encoded. The opening is played, so it gets an ordinary two-second group of
 * pictures and B-frames. The tour is never played, only sought as the page scrolls: a key frame
 * every twenty frames (one sequence second, so every stop is one) and, in HEVC and H.264, no
 * B-frames.
 *
 * The tour is also seen a frame at a time, so its frames must all be of one quality. Encoders give
 * key frames more bits than the frames between them, and at a strong setting the whole picture's
 * colour then jumped at every key frame: "it re-renders". `flat` takes that apart (equal quantisers
 * for all frames, more bits for colour). On 400 frames, the jump of the colour (U) at key frames
 * against the source's own: HEVC 0.18 ordinary, 0.04 to 0.06 flat; H.264 0.07 and 0.03; AV1 0.12 and
 * 0.08. Lowering the factor alone hardly moved it, so the tour plays HEVC first (reel.ts `TOUR_CODECS`).
 */
export const ENCODE = {
  opening: { crf: { av1: 38, hevc: 26, h264: 25 }, gop: 60, bframes: 3, flat: false },
  tour: { crf: { av1: 36, hevc: 28, h264: 29 }, gop: 20, bframes: 0, flat: true },
};

/**
 * The picture filter: the tall shape's strip is cut first, then the frame is scaled down (Lanczos)
 * and converted from JPEG's full-range BT.601 to video-range BT.709, and tagged as such (the frames
 * are sRGB; BT.709 is what every browser assumes for it).
 */
export function videoFilter(shape) {
  const { width, height } = SHAPES[shape];
  // 2160 * 9 / 16 = 1215; one more column keeps the width even, centred on the frame.
  const strip = Math.ceil((MASTER.height * width) / height / 2) * 2;
  const crop = shape === "tall" ? `crop=${strip}:${MASTER.height}:${Math.floor((MASTER.width - strip) / 2)}:0,` : "";
  return `${crop}scale=${width}:${height}:flags=lanczos+accurate_rnd+full_chroma_int:in_color_matrix=bt601:in_range=pc:out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709`;
}

/** The encoder's own arguments: 8 bits in every codec, which is what phones decode fastest. */
export function codecArgs(part, codec) {
  const e = ENCODE[part];
  const crf = String(e.crf[codec]);
  const gop = String(e.gop);
  if (codec === "av1") {
    const zeros = "[0,0,0,0,0,0]";
    const chroma = "[-40,-40,-40,-40,-40,-40]";
    const flat = `:pred-struct=1:rc=0:aq-mode=0:use-fixed-qindex-offsets=1:key-frame-qindex-offset=0:key-frame-chroma-qindex-offset=-40:qindex-offsets=${zeros}:chroma-qindex-offsets=${chroma}`;
    return ["-c:v", "libsvtav1", "-preset", e.flat ? "4" : "2", "-crf", crf, "-g", gop, "-svtav1-params", `tune=0:scd=0${e.flat ? flat : ""}`];
  }
  if (codec === "hevc") {
    // `hvc1`, not ffmpeg's default `hev1`: Safari plays only the first.
    const flat = e.flat ? ":ipratio=1.0:cutree=0:aq-mode=1:cbqpoffs=-6:crqpoffs=-6" : "";
    const params = `log-level=error:keyint=${gop}:min-keyint=${gop}:scenecut=0:open-gop=0:bframes=${e.bframes}${flat}`;
    return ["-c:v", "libx265", "-preset", e.flat ? "slow" : "slower", "-crf", crf, "-tag:v", "hvc1", "-x265-params", params];
  }
  const flat = e.flat ? ["-x264-params", "ipratio=1.0:mbtree=0:chroma-qp-offset=-4"] : [];
  return ["-c:v", "libx264", "-profile:v", "high", "-preset", e.flat ? "slow" : "veryslow", "-crf", crf, "-g", gop, "-keyint_min", gop, "-sc_threshold", "0", "-bf", String(e.bframes), ...flat];
}

/** The ffmpeg arguments for one file. */
export function ffmpegArgs(part, view, shape, { framesDir = FRAMES_DIR, outDir = OUT_DIR, codec = "h264" } = {}) {
  return [
    ...["-y", "-hide_banner", "-loglevel", "error"],
    ...["-framerate", String(REEL_FPS), "-start_number", "0", "-i", join(framesDir, clipName(part, view), "%05d.jpg")],
    ...["-vf", videoFilter(shape)],
    ...codecArgs(part, codec),
    ...["-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"],
    ...["-an", "-movflags", "+faststart"],
    outFile(part, view, shape, outDir, codec),
  ];
}

/** `--views a,b` (default: all four), `--codecs a,b` (default: all three), `--no-tour`, `--encode-only`, `--no-encode`, and the base address. */
export function parseArgs(argv) {
  const flag = (name) => argv.includes(name);
  const value = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const views = (value("--views") ?? VIEWS.join(",")).split(",").filter(Boolean);
  const unknown = views.filter((v) => !VIEWS.includes(v));
  if (unknown.length) throw new Error(`unknown view ${unknown.join(", ")}: one of ${VIEWS.join(", ")}`);
  const codecs = (value("--codecs") ?? CODECS.join(",")).split(",").filter(Boolean);
  const strange = codecs.filter((c) => !CODECS.includes(c));
  if (strange.length) throw new Error(`unknown codec ${strange.join(", ")}: one of ${CODECS.join(", ")}`);
  const skip = new Set(["--views", "--codecs"].map((n) => argv.indexOf(n) + 1).filter((i) => i > 0));
  const base = argv.find((a, i) => !a.startsWith("--") && !skip.has(i)) ?? "http://localhost:3000";
  return { base: base.replace(/\/$/, ""), views, codecs, tour: !flag("--no-tour"), record: !flag("--encode-only"), encode: !flag("--no-encode") };
}

/** Chrome through the rig's playwright-core (scripts/perf), or the checkout's own if it has one. */
export async function loadPlaywright() {
  const rig = join(ROOT, "scripts/perf/node_modules/playwright-core/index.mjs");
  if (existsSync(rig)) return import(pathToFileURL(rig).href);
  return import("playwright-core").catch(() => {
    throw new Error("playwright-core is not installed: pnpm install --dir scripts/perf --ignore-workspace");
  });
}

/** Draws one frame in the page and returns it as JPEG bytes (base64), or nothing when `read` is false. */
export async function drawFrame(page, frame, read) {
  return page.evaluate(
    async ({ seconds, position, still, read }) => {
      const canvas = document.querySelector(".xp__canvas canvas");
      if (!canvas) throw new Error("no canvas");
      window.__sawadReel.frame(seconds, position, still);
      if (!read) return null;
      // Read in the task that drew it: the drawing buffer is not kept past the next paint.
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.96));
      if (!blob) throw new Error("the canvas gave no picture");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let text = "";
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return { width: canvas.width, height: canvas.height, data: btoa(text) };
    },
    { ...frame, read },
  );
}

/** Opens the capture page for a view and waits until frames may be asked for (the full model is in). */
export async function openReelPage(browser, base, view, log = console.log) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: "no-preference", locale: "en-US" });
  const page = await context.newPage();
  page.on("pageerror", (err) => log(`${view}: page error: ${err.message}`));
  await page.goto(`${base}/?reel=1&view=${view}`, { waitUntil: "domcontentloaded" });
  // Pin the stage full screen, as the stills are taken: the canvas is then the viewport's size.
  await page.addStyleTag({
    content: `.xp__stage{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:9999!important}
              nextjs-portal,.site-header{display:none!important}`,
  });
  // "attached": with the stage pinned, the section itself has no height.
  await page.waitForSelector(".xp[data-scene-ready=true]", { state: "attached", timeout: 180000 });
  return { context, page };
}

export const CHROME_ARGS = ["--enable-gpu", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"];

/** One page session: a view's opening, and the tour after it when asked for. */
async function recordView(browser, base, view, { tour, log = console.log }) {
  const plan = framePlan({ tour });
  const todo = plan.filter((f) => !existsSync(frameFile(f.part, view, f.index)));
  if (!todo.length) {
    log(`${view}: all ${plan.length} frames are on disk`);
    return;
  }
  const last = plan.indexOf(todo[todo.length - 1]);
  for (const part of new Set(plan.map((f) => f.part))) mkdirSync(join(FRAMES_DIR, clipName(part, view)), { recursive: true });
  const { context, page } = await openReelPage(browser, base, view, log);
  const started = Date.now();
  let written = 0;
  for (let i = 0; i <= last; i++) {
    const f = plan[i];
    const file = frameFile(f.part, view, f.index);
    const shot = await drawFrame(page, f, !existsSync(file));
    if (!shot) continue;
    if (shot.width !== MASTER.width || shot.height !== MASTER.height) throw new Error(`the canvas is ${shot.width} x ${shot.height}, not ${MASTER.width} x ${MASTER.height}`);
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    written += 1;
    if (written % 60 === 0) log(`${view}: ${f.part} ${f.index} (${written}/${todo.length}, ${((Date.now() - started) / 1000 / written).toFixed(2)} s a frame)`);
  }
  log(`${view}: wrote ${written} frames in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  await context.close();
}

function encode(part, view, { codecs, log = console.log }) {
  const ffmpeg = process.env.FFMPEG || "ffmpeg";
  mkdirSync(OUT_DIR, { recursive: true });
  for (const shape of Object.keys(SHAPES)) {
    for (const codec of codecs) {
      const run = spawnSync(ffmpeg, ffmpegArgs(part, view, shape, { codec }), { stdio: ["ignore", "inherit", "inherit"] });
      if (run.status !== 0) throw new Error(`ffmpeg failed for ${clipName(part, view)} ${shape} ${codec}`);
      const out = outFile(part, view, shape, OUT_DIR, codec);
      log(`wrote ${out} (${(statSync(out).size / 1e6).toFixed(2)} MB)`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.record) {
    const { chromium } = await loadPlaywright();
    const browser = await chromium.launch({ channel: "chrome", args: CHROME_ARGS });
    try {
      // The tour is recorded once, in the first view's session.
      for (const [i, view] of args.views.entries()) await recordView(browser, args.base, view, { tour: args.tour && i === 0 });
    } finally {
      await browser.close();
    }
  }
  if (args.encode) {
    for (const view of args.views) if (existsSync(frameFile("opening", view, OPENING_SECONDS * REEL_FPS - 1))) encode("opening", view, args);
    if (args.tour && existsSync(frameFile("tour", null, TOUR_FRAMES))) encode("tour", null, args);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
