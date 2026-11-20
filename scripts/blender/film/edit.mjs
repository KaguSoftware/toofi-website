#!/usr/bin/env node
/**
 * The Zaitun Hills film's edit (track 5B): turns film.py's frames into the deliverables.
 *
 *   node scripts/blender/film/edit.mjs [--preview] [--music bed.wav] [--logo logo.png] [--no-letterbox] [--dry-run]
 *
 * reads   scripts/blender/out/film/frames/f_####.png        (film.py --shots; frames-25/ with --preview)
 *         scripts/blender/out/film/stills/zaitun-*.png      (film.py --stills)
 *         scripts/blender/film/shots.json, scripts/blender/out/film/scene.json (the vertical cut)
 * writes  scripts/blender/out/film/deliver/
 *           zaitun-hills-film[-preview].mp4      the 87 s film, 3840 x 2160 (preview: 960 x 540), 2.39:1 letterbox
 *           zaitun-hills-vertical[-preview].mp4  the 15 s social cut, 1080 x 1920
 *           stills/zaitun-*.jpg                  the 4K stills, graded like the film
 *
 * The edit adds what the render doesn't: the grade (GRADE), vignette, light grain, the letterbox, the
 * English and Arabic end card (endcard.html, rendered by headless Chrome so the Arabic is shaped and
 * ordered right) and the sound. Until the owner's music arrives the films carry a silent stereo track;
 * `--music` lays a bed under the film and fades it out with the end card.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FILM_OUT = join(HERE, "../out/film");
export const DELIVER = join(FILM_OUT, "deliver");
export const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * Display-referred grade after AgX: teal-leaning shadows, warm highlights, a soft S-curve, a little
 * more saturation and a gentle vignette. Chosen on the stills (film/FILM.md shows before and after).
 */
export const GRADE = [
  "colorbalance=rs=-0.035:gs=-0.005:bs=0.035:bm=-0.01:rh=0.035:gh=0.01:bh=-0.04",
  "curves=master='0/0.015 0.25/0.22 0.5/0.5 0.75/0.79 1/0.98'",
  "eq=saturation=1.1",
  "vignette=angle=0.42",
].join(",");
/** End card: on screen for the last seconds of the film, fading in; the film fades to black under it. */
export const END_CARD = { seconds: 5.5, fadeIn: 1.5, tallSeconds: 2, tallFadeIn: 0.6 };
export const FADE = { in: 0.6, out: 1.2 };
export const AUDIO = { rate: 48000, musicFadeOut: 3 };

export function loadPlan() {
  const shots = JSON.parse(readFileSync(join(HERE, "shots.json"), "utf8"));
  const scenePath = join(FILM_OUT, "scene.json");
  const scene = existsSync(scenePath) ? JSON.parse(readFileSync(scenePath, "utf8")) : null;
  return { shots, vertical: scene?.vertical ?? null };
}

/** Height of each letterbox bar (even, for yuv420p) for an aspect ratio on a frame. */
export function letterboxBar(width, height, aspect) {
  const picture = Math.round(width / aspect);
  return Math.max(0, Math.floor((height - picture) / 4) * 2);
}

/** Film grain strength by output height: the same apparent grain at 540 p and 2160 p. */
export const grainFor = (height) => Math.round(3 + (height / 2160) * 4);

/**
 * The film: frames -> grade -> end card -> fades, grain, letterbox -> H.264 + AAC.
 * @param {{ shots: any, framesDir: string, width: number, height: number, out: string, card: string, music?: string | null, letterbox?: boolean }} opts
 */
export function filmArgs({ shots, framesDir, width, height, out, card, music = null, letterbox = true }) {
  const fps = shots.fps;
  const seconds = shots.frames / fps;
  const cardStart = seconds - END_CARD.seconds;
  const bar = letterbox ? letterboxBar(width, height, shots.letterbox) : 0;
  const chain = [
    `[0:v]scale=${width}:${height}:flags=lanczos,format=gbrp16le,${GRADE},format=yuv420p10le`,
    `fade=t=in:st=0:d=${FADE.in}`,
    `fade=t=out:st=${(seconds - FADE.out).toFixed(3)}:d=${FADE.out}[graded]`,
  ].join(",");
  const cardChain = `[1:v]scale=${width}:${height},format=rgba,fade=t=in:st=${cardStart.toFixed(3)}:d=${END_CARD.fadeIn}:alpha=1,fade=t=out:st=${(seconds - 0.4).toFixed(3)}:d=0.4:alpha=1[card]`;
  const tail = [`noise=c0s=${grainFor(height)}:c0f=t+u`, bar ? `drawbox=x=0:y=0:w=iw:h=${bar}:color=black:t=fill,drawbox=x=0:y=ih-${bar}:w=iw:h=${bar}:color=black:t=fill` : null, "format=yuv420p"]
    .filter(Boolean)
    .join(",");
  const graph = `${chain};${cardChain};[graded][card]overlay=0:0:format=auto:shortest=1,${tail}[v]`;
  const audio = music
    ? ["-i", music, "-map", "2:a", "-af", `afade=t=in:d=1,afade=t=out:st=${(seconds - AUDIO.musicFadeOut).toFixed(3)}:d=${AUDIO.musicFadeOut}`]
    : ["-f", "lavfi", "-i", `anullsrc=r=${AUDIO.rate}:cl=stereo`, "-map", "2:a"];
  return [
    "-y", "-framerate", String(fps), "-start_number", "1", "-i", join(framesDir, "f_%04d.png"),
    "-loop", "1", "-framerate", String(fps), "-i", card,
    ...audio.slice(0, audio.indexOf("-map")),
    "-filter_complex", graph, "-map", "[v]", ...audio.slice(audio.indexOf("-map")),
    "-t", seconds.toFixed(3), "-r", String(fps),
    "-c:v", "libx264", "-preset", "slow", "-crf", height >= 2160 ? "16" : "18", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "256k", "-ar", String(AUDIO.rate), "-movflags", "+faststart", out,
  ];
}

/**
 * The 15 s vertical cut: each segment of scene.json's `vertical` plan, cropped 9:16 where the shot
 * list says (center 0 left .. 1 right), scaled to 1080 x 1920, joined, graded, end card on the last.
 */
/**
 * @param {{ shots: any, plan: Array<{ firstFrame: number, lastFrame: number, center: number }>, framesDir: string, out: string, card: string, music?: string | null, size?: { width: number, height: number } }} opts
 */
export function verticalArgs({ shots, plan, framesDir, out, card, music = null, size = shots.vertical }) {
  const fps = shots.fps;
  const inputs = [];
  const parts = [];
  plan.forEach((seg, i) => {
    const n = seg.lastFrame - seg.firstFrame + 1;
    inputs.push("-framerate", String(fps), "-start_number", String(seg.firstFrame), "-i", join(framesDir, "f_%04d.png"));
    parts.push(
      `[${i}:v]trim=end_frame=${n},setpts=PTS-STARTPTS,crop=w=ih*9/16:h=ih:x=(iw-ih*9/16)*${seg.center}:y=0,scale=${size.width}:${size.height}:flags=lanczos,setsar=1[s${i}]`,
    );
  });
  const seconds = plan.reduce((t, s) => t + (s.lastFrame - s.firstFrame + 1), 0) / fps;
  const k = plan.length;
  const cardStart = seconds - END_CARD.tallSeconds;
  const graph = [
    ...parts,
    `${plan.map((_, i) => `[s${i}]`).join("")}concat=n=${k}:v=1:a=0,format=gbrp16le,${GRADE},format=yuv420p10le,fade=t=in:st=0:d=0.3,fade=t=out:st=${(seconds - 0.6).toFixed(3)}:d=0.6[cut]`,
    `[${k}:v]scale=${size.width}:${size.height},format=rgba,fade=t=in:st=${cardStart.toFixed(3)}:d=${END_CARD.tallFadeIn}:alpha=1[card]`,
    `[cut][card]overlay=0:0:format=auto:shortest=1,noise=c0s=${grainFor(size.height)}:c0f=t+u,format=yuv420p[v]`,
  ].join(";");
  const audioIn = music ? ["-i", music] : ["-f", "lavfi", "-i", `anullsrc=r=${AUDIO.rate}:cl=stereo`];
  const audioMap = music ? ["-map", `${k + 1}:a`, "-af", `afade=t=out:st=${(seconds - 1.5).toFixed(3)}:d=1.5`] : ["-map", `${k + 1}:a`];
  return [
    "-y", ...inputs, "-loop", "1", "-framerate", String(fps), "-i", card, ...audioIn,
    "-filter_complex", graph, "-map", "[v]", ...audioMap,
    "-t", seconds.toFixed(3), "-r", String(fps),
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", String(AUDIO.rate), "-movflags", "+faststart", out,
  ];
}

/** A graded 4K still: the film's grade on the 16-bit render, saved as a high-quality JPEG. */
export function stillArgs(src, out) {
  return ["-y", "-i", src, "-vf", `format=gbrp16le,${GRADE},format=yuvj444p`, "-q:v", "2", "-frames:v", "1", out];
}

/**
 * headless Chrome arguments for the end card at a size (`tall` for the vertical cut).
 * @param {{ width: number, height: number, layout: "wide" | "tall", out: string, logo?: string | null }} opts
 */
export function cardArgs({ width, height, layout, out, logo = null }) {
  const url = new URL(pathToFileURL(join(HERE, "endcard.html")));
  url.searchParams.set("layout", layout);
  if (logo) url.searchParams.set("logo", pathToFileURL(logo).href);
  return ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", "--force-device-scale-factor=1", `--window-size=${width},${height}`, `--screenshot=${out}`, url.href];
}

/** How many frames of the film are on disk, and the first missing one. */
export function frameStatus(dir, total) {
  const have = existsSync(dir) ? new Set(readdirSync(dir).filter((f) => /^f_\d{4}\.png$/.test(f))) : new Set();
  let missing = null;
  for (let f = 1; f <= total; f++) {
    if (!have.has(`f_${String(f).padStart(4, "0")}.png`)) {
      missing = f;
      break;
    }
  }
  return { count: have.size, missing };
}

function run(cmd, args, dry) {
  console.log(`$ ${cmd} ${args.map((a) => (/\s|;|\[/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
  if (dry) return;
  const r = spawnSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`${cmd} exited with ${r.status}`);
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
  const preview = argv.includes("--preview");
  const dry = argv.includes("--dry-run");
  const music = opt("--music");
  const logo = opt("--logo");
  const { shots, vertical } = loadPlan();
  const framesDir = join(FILM_OUT, preview ? "frames-25" : "frames");
  const suffix = preview ? "-preview" : "";
  const width = preview ? shots.frame.width / 4 : shots.frame.width;
  const height = preview ? shots.frame.height / 4 : shots.frame.height;
  const status = frameStatus(framesDir, shots.frames);
  if (status.missing && !dry) throw new Error(`${framesDir}: ${status.count} of ${shots.frames} frames; first missing f_${String(status.missing).padStart(4, "0")}.png (run film.py --shots)`);
  if (!vertical) throw new Error("no scene.json: run scene.mjs first");
  mkdirSync(join(DELIVER, "stills"), { recursive: true });
  const cards = { wide: join(DELIVER, `endcard-wide${suffix}.png`), tall: join(DELIVER, "endcard-tall.png") };
  run(CHROME, cardArgs({ width, height, layout: "wide", out: cards.wide, logo }), dry);
  run(CHROME, cardArgs({ width: shots.vertical.width, height: shots.vertical.height, layout: "tall", out: cards.tall, logo }), dry);
  run("ffmpeg", filmArgs({ shots, framesDir, width, height, out: join(DELIVER, `zaitun-hills-film${suffix}.mp4`), card: cards.wide, music, letterbox: !argv.includes("--no-letterbox") }), dry);
  run("ffmpeg", verticalArgs({ shots, plan: vertical, framesDir, out: join(DELIVER, `zaitun-hills-vertical${suffix}.mp4`), card: cards.tall, music }), dry);
  const stillsDir = join(FILM_OUT, "stills");
  for (const f of existsSync(stillsDir) ? readdirSync(stillsDir).filter((n) => n.endsWith(".png")) : []) {
    run("ffmpeg", ["-v", "error", ...stillArgs(join(stillsDir, f), join(DELIVER, "stills", f.replace(/\.png$/, ".jpg")))], dry);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
