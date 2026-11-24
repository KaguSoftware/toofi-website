import { assetUrl } from "../scene/assetUrl";
import type { ViewId } from "../scene/types";
import { INTRO_HOLD_SECONDS, INTRO_SECONDS, STORY_END } from "./beats";

/**
 * The story as video: "the reel". Home plays it instead of drawing the live scene, so a visitor
 * downloads a few megabytes of video and no 3D code or models until they ask to explore. It is
 * recorded from the live scene itself (scripts/render-story-reel.mjs drives ReelCapture.tsx), so
 * the explorer opens on the same world, and it comes as two files per shape:
 *
 * - the opening, played by the clock: the hold on the poster frame, then the flight to the gate,
 *   one per owner start view;
 * - the tour, which the scroll moves through: it is never played, only sought, so it is encoded
 *   with a key frame every few frames.
 *
 * This module is the timeline both sides agree on, without any 3D code: safe on the page side.
 */

/** Frames a second of both files. */
export const REEL_FPS = 30;

/** The opening's length: the hold on the poster frame, then the sequence's first stretch at one second a second. */
export const OPENING_SECONDS = INTRO_HOLD_SECONDS + INTRO_SECONDS;

/**
 * Tour frames for each sequence second. Twenty puts the pictures about a metre of walking apart at
 * street level; at ten a slow scroll moved in visible steps.
 */
export const TOUR_FRAMES_PER_UNIT = 20;
export const TOUR_FRAMES = (STORY_END - INTRO_SECONDS) * TOUR_FRAMES_PER_UNIT;
/** The tour file's length in seconds. */
export const TOUR_SECONDS = TOUR_FRAMES / REEL_FPS;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));

/** The sequence position the opening shows `seconds` in: still for the hold, then at the gate by its end. */
export function openingPosition(seconds: number): number {
  return clamp(seconds - INTRO_HOLD_SECONDS, 0, INTRO_SECONDS);
}

/** Where in the tour file a sequence position is, in seconds. Positions before the gate are the gate. */
export function tourTime(position: number): number {
  return ((clamp(position, INTRO_SECONDS, STORY_END) - INTRO_SECONDS) * TOUR_FRAMES_PER_UNIT) / REEL_FPS;
}

/** The sequence position a tour frame shows (frame 0 is the gate, where the opening ends). */
export function tourPosition(frame: number): number {
  return clamp(INTRO_SECONDS + frame / TOUR_FRAMES_PER_UNIT, INTRO_SECONDS, STORY_END);
}

/**
 * The two shapes the reel ships in. A screen taller than it is wide gets the tall one: the live
 * camera keeps its vertical field of view, so a portrait canvas shows the middle strip of the
 * wide frame, and the tall file is that strip at a size a phone shows sharply.
 */
export type ReelShape = "wide" | "tall";
export const REEL_SIZE: Record<ReelShape, { width: number; height: number }> = {
  wide: { width: 1920, height: 1080 },
  tall: { width: 720, height: 1280 },
};

export function reelShape(width: number, height: number): ReelShape {
  return height > width ? "tall" : "wide";
}

/**
 * The codecs each file ships in, best first: AV1 (the smallest), HEVC (for Apple devices without
 * AV1 hardware) and H.264, which everything plays. The type is what `canPlayType` is asked about:
 * Main profile, 8 bits, level 4.0, the larger of the two shapes; H.264 is never asked about.
 */
export type ReelCodec = "av1" | "hevc" | "h264";
export const REEL_CODECS: readonly ReelCodec[] = ["av1", "hevc", "h264"];
export const REEL_TYPE: Record<ReelCodec, string> = {
  av1: 'video/mp4; codecs="av01.0.08M.08"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L120.B0"',
  h264: "",
};

/**
 * The tour's order. It is seen a frame at a time, and its HEVC holds one level from frame to frame
 * where its AV1 still pulses a little at key frames (scripts/render-story-reel.mjs `ENCODE`).
 */
export const TOUR_CODECS: readonly ReelCodec[] = ["hevc", "av1", "h264"];
export const CODEC_ORDER: Record<"opening" | "tour", readonly ReelCodec[]> = { opening: REEL_CODECS, tour: TOUR_CODECS };

/** The codecs this browser says it plays. Only a "probably" counts; H.264 is always one of them. */
export function playableCodecs(video: Pick<HTMLVideoElement, "canPlayType">): ReelCodec[] {
  return REEL_CODECS.filter((c) => !REEL_TYPE[c] || video.canPlayType(REEL_TYPE[c]) === "probably");
}

/** The best of some playable codecs for a part of the reel. */
export function bestCodec(part: "opening" | "tour", codecs: readonly ReelCodec[]): ReelCodec | undefined {
  return CODEC_ORDER[part].find((c) => codecs.includes(c));
}

/** The stable public paths; `reelSources` gives the versioned addresses to fetch. H.264 carries the plain name. */
const suffix = (codec: ReelCodec) => (codec === "h264" ? "" : `-${codec}`);
export const openingPath = (view: ViewId, shape: ReelShape, codec: ReelCodec = "h264") => `/sawad/reel/zaitun-opening-${view}-${shape}${suffix(codec)}.mp4`;
export const tourPath = (shape: ReelShape, codec: ReelCodec = "h264") => `/sawad/reel/zaitun-tour-${shape}${suffix(codec)}.mp4`;

export type ReelSources = { opening: string; tour: string };
export function reelSources(view: ViewId, shape: ReelShape, codec: ReelCodec = "h264"): ReelSources {
  return { opening: assetUrl(openingPath(view, shape, codec)), tour: assetUrl(tourPath(shape, codec)) };
}

/** The codec and shape of one of the reel's addresses, from its name. */
export function reelFileOf(src: string): { codec: ReelCodec; shape: ReelShape } {
  return { codec: REEL_CODECS.find((c) => src.includes(`-${c}.`)) ?? "h264", shape: src.includes("-tall") ? "tall" : "wide" };
}
