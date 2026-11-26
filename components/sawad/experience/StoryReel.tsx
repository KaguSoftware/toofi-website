"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { reportError } from "@/lib/monitoring";
import type { ViewId } from "../scene/types";
import { INTRO_SECONDS, follow, scrollToPosition } from "./beats";
import { playsReel } from "../scene/capability";
import { CODEC_ORDER, REEL_FPS, TOUR_FRAMES, TOUR_FRAMES_PER_UNIT, TOUR_FRAME_CAP, TOUR_GOP, bestCodec, openingPosition, playableCodecs, reelFileOf, reelShape, reelSources, tourTime, type ReelCodec } from "./reel";
import { TourDecoder } from "./reelDecoder";
import { FrameCache, frameTime, framePair, missingFrame, tourFrameAt } from "./reelFrames";
import type { RigState, ScrollState } from "./types";

export type StoryReelProps = {
  /** The owner's opening shot: which of the four openings plays. */
  view: ViewId;
  /** False pauses the opening (the pause button, off screen, a hidden tab). The scroll still moves the tour. */
  playing: boolean;
  /** False while the explorer is loading or open: the reel holds its frame. */
  active?: boolean;
  /** Scroll progress through the story, written by StoryScroll. */
  scroll: RefObject<ScrollState>;
  /** `head` is written with the sequence position on screen: the explorer opens on that shot. */
  rig: RefObject<RigState>;
  /** The opening's first frame is on screen. */
  onStart?: () => void;
  /** The opening has reached the gate, or the visitor scrolled past it. */
  onIntroEnd?: () => void;
  /** A file could not be played: reported here as `StoryReel`; the page goes back to the stills. */
  onError?: (error: unknown) => void;
};

/** Scroll progress under this counts as "at the top": the opening plays on. */
const AT_TOP = 0.002;
/** A frame's time step is capped, so a tab that slept does not jump the playhead. */
const MAX_FRAME_SECONDS = 0.1;
/** The tour is asked for once the opening has this many seconds buffered ahead, or at the first scroll. */
const TOUR_AFTER_SECONDS = 3;

/** The middle of a tour frame, so a seek never lands on the edge between two. */
export function tourSeekTime(position: number): number {
  return frameTime(Math.min(TOUR_FRAMES, Math.max(0, Math.round(tourTime(position) * REEL_FPS))));
}

/**
 * What the tour is drawn with when the page dissolves between frames: the canvas on screen, the
 * few frames already taken from the video (each on a canvas of its own), the frame a seek is out
 * for, and a note of what the canvas shows now, so a playhead that has not moved draws nothing.
 */
type Blend = { ctx: CanvasRenderingContext2D; cache: FrameCache<HTMLCanvasElement>; pending: number | null; key: string };

/**
 * The <video> fallback only (no WebCodecs, or the decoder failed): one frame of the dissolve, each
 * frame sought on the video and copied off it, two seeks for every frame step. True once the frame
 * under the playhead is on the canvas.
 */
function stepBlend(blend: Blend, tour: HTMLVideoElement, head: number): boolean {
  const { ctx, cache } = blend;
  const at = tourFrameAt(head);
  const pair = framePair(at);
  const capture = (frame: number) => {
    cache.slot(frame, at).getContext("2d")?.drawImage(tour, 0, 0);
  };
  // A seek that has landed: the frame is on the video now, and only now.
  if (blend.pending !== null && !tour.seeking && tour.readyState >= 2) {
    capture(blend.pending);
    blend.pending = null;
  }
  // One seek at a time, for whichever frame is still missing: the base first, then the one over it.
  if (blend.pending === null) {
    const missing = missingFrame(pair, (f) => cache.has(f));
    if (missing !== null) {
      const time = frameTime(missing);
      if (tour.readyState >= 2 && !tour.seeking && Math.abs(tour.currentTime - time) <= 0.25 / REEL_FPS) {
        capture(missing);
      } else {
        blend.pending = missing;
        tour.currentTime = time;
      }
    }
  }
  // The base at full strength (or the nearest frame held, while its seek is out), the next over it.
  const base = cache.has(pair.base) ? pair.base : cache.nearest(pair.base);
  if (base === null) return false;
  const next = base === pair.base && pair.next !== null && cache.has(pair.next) ? pair.next : null;
  const mix = next === null ? 0 : pair.mix;
  const key = `${base}|${next ?? ""}|${mix.toFixed(3)}`;
  if (key !== blend.key) {
    blend.key = key;
    ctx.globalAlpha = 1;
    ctx.drawImage(cache.get(base) as HTMLCanvasElement, 0, 0);
    if (next !== null) {
      ctx.globalAlpha = mix;
      ctx.drawImage(cache.get(next) as HTMLCanvasElement, 0, 0);
      ctx.globalAlpha = 1;
    }
  }
  return base === pair.base;
}

/** The decoded tour as drawn: the canvas on screen, and a note of what it shows now, so a playhead that has not moved draws nothing. */
type Paint = { ctx: CanvasRenderingContext2D; width: number; height: number; key: string };

/** Counts for `?reelstats=1` (development only), reset once a second. */
type ReelStats = { at: number; refreshes: number; missing: number; jobs: number };

/**
 * One frame of the decoded tour: the frame the playhead has passed at full strength (or, while it
 * is still being decoded, the nearest one held) and the next over it by the fraction it is through.
 * Returns "exact" once the frame under the playhead is drawn, "nearest" when a stand-in is, null
 * when nothing is held yet.
 */
function stepDecoded(paint: Paint, decoder: TourDecoder, at: number): "exact" | "nearest" | null {
  const pair = framePair(at);
  const exact = decoder.get(pair.base) !== null;
  const base = exact ? pair.base : decoder.nearest(pair.base);
  if (base === null) return null;
  const next = exact && pair.next !== null && decoder.get(pair.next) ? pair.next : null;
  const mix = next === null ? 0 : pair.mix;
  const key = `${base}|${next ?? ""}|${mix.toFixed(3)}`;
  if (key !== paint.key) {
    const { ctx, width, height } = paint;
    paint.key = key;
    ctx.globalAlpha = 1;
    decoder.get(base)?.draw(ctx, 0, 0, width, height);
    if (next !== null) {
      ctx.globalAlpha = mix;
      decoder.get(next)?.draw(ctx, 0, 0, width, height);
      ctx.globalAlpha = 1;
    }
  }
  return exact ? "exact" : "nearest";
}

/** `?reelstats=1` in development: frames held, decode jobs and missed frames a second, the codec. Never in production. */
function reelStatsWanted(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return new URLSearchParams(window.location.search).get("reelstats") === "1";
}

/** The decision the early script makes, read again here (no GPU probe): a visitor who gets the stills must not fetch a video. */
function reelWanted(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return playsReel({ saveData: connection?.saveData, effectiveType: connection?.effectiveType, reducedMotion });
}

function mute(video: HTMLVideoElement): void {
  // React leaves `muted` out of the markup it writes; browsers only start a muted video unasked.
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
}

function mediaError(video: HTMLVideoElement, part: string): Error {
  const e = video.error;
  return new Error(`The reel's ${part} could not be played (${e ? `code ${e.code}${e.message ? `: ${e.message}` : ""}` : "no detail"})`);
}

/**
 * The story as video (reel.ts), in the place where the live scene used to be drawn. Two files:
 *
 * - The opening plays by itself over the poster. The early script (early.ts) has usually started
 *   it while the page was still being parsed; if not (a page reached by a link), it starts here.
 *   A browser that will not play unasked keeps the poster until the visitor's first touch.
 * - The tour is never played. Each frame the playhead closes on where the scroll wants it, on a
 *   critically damped spring (beats.ts `follow`) that carries its speed, so it coasts to rest when
 *   the scroll stops instead of halting. The canvas shows the frame the playhead has passed with
 *   the next one dissolved over it by the fraction it is through (reelFrames.ts), so a slow scroll
 *   moves smoothly between the file's frames instead of stepping. Where the browser has WebCodecs
 *   the page decodes the tour itself into a window of frames around the playhead (reelDecoder.ts)
 *   and draws from memory on every refresh; the tour's <video> then never gets a file. Elsewhere,
 *   or if the decoder fails (reported as a warning; the video takes over from the same playhead),
 *   the video is sought to whole frames and each is copied onto a canvas of its own: the fallback.
 *   Either way, while a frame is not in yet the nearest one held stays on screen, so a slow device
 *   shows fewer frames, never a wrong one. A scroll during the opening cuts to the tour.
 *
 * Each file comes in AV1, HEVC and H.264; the browser gets the best one it says it plays. One that
 * then fails all the same is replaced by the next (a warning is reported); only H.264 failing ends
 * the reel.
 *
 * No 3D code, model or GPU is involved. The elements are decoration for assistive technology:
 * the captions are the story.
 */
export default function StoryReel({ view, playing, active = true, scroll, rig, onStart, onIntroEnd, onError }: StoryReelProps) {
  const openingRef = useRef<HTMLVideoElement>(null);
  const tourRef = useRef<HTMLVideoElement>(null);
  const blendRef = useRef<HTMLCanvasElement>(null);
  /** Which file is on screen. The playhead moves to the tour first (`st.part`); the picture follows once the tour has its frame. */
  const [shown, setShown] = useState<"opening" | "tour">("opening");
  const [started, setStarted] = useState(false);
  const statsRef = useRef<HTMLPreElement>(null);
  const [statsOn, setStatsOn] = useState(false);
  const st = useRef({ part: "opening" as "opening" | "tour", head: 0, velocity: 0, blend: undefined as Blend | false | undefined, decoder: null as TourDecoder | null, paint: null as Paint | null, stats: null as ReelStats | null, tourShown: false, started: false, introDone: false, failed: false, tourAsked: false, blocked: false, off: false, codecs: null as ReelCodec[] | null });
  const latest = useRef({ playing, active, onStart, onIntroEnd, onError });
  useEffect(() => {
    latest.current = { playing, active, onStart, onIntroEnd, onError };
  });

  const fail = useCallback(
    (error: unknown, part: string) => {
      if (st.current.failed) return;
      st.current.failed = true;
      reportError("StoryReel", error, { view, part });
      latest.current.onError?.(error);
    },
    [view],
  );

  /**
   * The canvas the tour is drawn on, once the video has a size: the same size as the video, so a
   * frame is copied without scaling. Undefined until then; false where no canvas can be had, and
   * the video itself is sought and shown instead.
   */
  const openBlend = useCallback(
    (tour: HTMLVideoElement, canvas: HTMLCanvasElement | null): Blend | false | undefined => {
      if (!canvas || !tour.videoWidth || !tour.videoHeight) return undefined;
      const { videoWidth: width, videoHeight: height } = tour;
      try {
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return false;
        canvas.width = width;
        canvas.height = height;
        const make = () => {
          const surface = document.createElement("canvas");
          surface.width = width;
          surface.height = height;
          return surface;
        };
        return { ctx, cache: new FrameCache(make), pending: null, key: "" };
      } catch (error) {
        reportError("StoryReel", error, { view, part: "tour", severity: "warning", recoverable: true });
        return false;
      }
    },
    [view],
  );

  /** The address of a part in the best codec that has not failed. */
  const address = useCallback(
    (video: HTMLVideoElement, part: "opening" | "tour") => {
      const codecs = (st.current.codecs ??= playableCodecs(video));
      return reelSources(view, reelShape(window.innerWidth, window.innerHeight), bestCodec(part, codecs))[part];
    },
    [view],
  );

  /** A file failed: the next codec takes its place from the same point, or, after H.264, the reel is over. True if it goes on. */
  const fallBack = useCallback(
    (video: HTMLVideoElement, part: "opening" | "tour", failed: string | null, error: unknown): boolean => {
      const s = st.current;
      if (s.failed) return false;
      // The error event and the rejected `play` both tell of one failure; the second finds it dealt with.
      if (video.getAttribute("src") !== failed) return true;
      const { codec, shape } = reelFileOf(failed ?? "");
      s.codecs = (s.codecs ?? playableCodecs(video)).filter((c) => c !== codec);
      const next = bestCodec(part, s.codecs);
      if (codec === "h264" || !next) {
        fail(error, part);
        return false;
      }
      reportError("StoryReel", error, { view, part, codec, severity: "warning", recoverable: true });
      // A seek out on the file that failed will never land.
      if (part === "tour" && s.blend) s.blend.pending = null;
      const at = video.currentTime;
      video.src = reelSources(view, shape, next)[part];
      video.load();
      if (at > 0) video.currentTime = at;
      return true;
    },
    [view, fail],
  );

  /** The tour as a <video> that is sought frame by frame: the fallback. */
  const loadTourVideo = useCallback(
    (tour: HTMLVideoElement) => {
      mute(tour);
      tour.preload = "auto";
      tour.src = address(tour, "tour");
      tour.load();
    },
    [address],
  );

  /** The decoder could not go on: it is reported, and the <video> takes over from where the playhead is. */
  const decoderFailed = useCallback(
    (decoder: TourDecoder, error: unknown) => {
      const s = st.current;
      if (s.decoder !== decoder) return;
      reportError("StoryReel", error, { view, part: "tour", stage: "decoder", severity: "warning", recoverable: true });
      decoder.close();
      s.decoder = null;
      s.paint = null;
      const tour = tourRef.current;
      if (tour && !s.failed) loadTourVideo(tour);
    },
    [view, loadTourVideo],
  );

  const askForTour = useCallback(() => {
    const tour = tourRef.current;
    const s = st.current;
    if (!tour || s.tourAsked || s.off) return;
    s.tourAsked = true;
    if (typeof VideoDecoder === "undefined") {
      loadTourVideo(tour);
      return;
    }
    // WebCodecs: the page decodes the tour itself, in the codecs' usual order for the tour; this browser's decoder decides which it can take.
    const shape = reelShape(window.innerWidth, window.innerHeight);
    const decoder: TourDecoder = new TourDecoder({
      sources: CODEC_ORDER.tour.map((codec) => ({ codec, url: reelSources(view, shape, codec).tour })),
      cap: TOUR_FRAME_CAP[shape],
      gop: TOUR_GOP,
      onCodecFailed: (codec, error) => reportError("StoryReel", error, { view, part: "tour", stage: "decoder", codec, severity: "warning", recoverable: true }),
      onError: (error) => decoderFailed(decoder, error),
    });
    s.decoder = decoder;
    decoder.update(tourFrameAt(s.head), 0);
    void decoder.open();
  }, [view, loadTourVideo, decoderFailed]);

  /**
   * The canvas the decoded tour is drawn on: the size of the decoded frames (the CSS covers the
   * screen with it). Null where no 2d canvas can be had: the decoder is given up for the video.
   */
  const openPaint = useCallback(
    (decoder: TourDecoder, canvas: HTMLCanvasElement | null): Paint | null => {
      if (!canvas) return null;
      let ctx: CanvasRenderingContext2D | null = null;
      try {
        ctx = canvas.getContext("2d", { alpha: false });
      } catch (error) {
        decoderFailed(decoder, error);
        return null;
      }
      if (!ctx) {
        decoderFailed(decoder, new Error("No 2d canvas to draw the decoded tour on"));
        return null;
      }
      canvas.width = decoder.width;
      canvas.height = decoder.height;
      return { ctx, width: decoder.width, height: decoder.height, key: "" };
    },
    [decoderFailed],
  );

  /** `?reelstats=1`: once a second, on the overlay and in the console. */
  const showStats = useCallback((s: typeof st.current, tour: HTMLVideoElement, now: number) => {
    const stats = s.stats as ReelStats;
    const seconds = (now - stats.at) / 1000;
    let line: string;
    if (s.decoder) {
      const d = s.decoder.stats();
      line = `decoder ${d.codec ?? "opening"} · held ${d.held} · jobs/s ${((d.jobs - stats.jobs) / seconds).toFixed(1)} · missing ${stats.missing}/${stats.refreshes} refreshes`;
      stats.jobs = d.jobs;
    } else {
      const src = tour.getAttribute("src");
      line = src ? `video fallback ${reelFileOf(src).codec}` : "tour not asked for yet";
    }
    Object.assign(stats, { at: now, refreshes: 0, missing: 0 });
    if (statsRef.current) statsRef.current.textContent = line;
    console.info(`[reelstats] ${line}`);
  }, []);

  const endIntro = useCallback(() => {
    const s = st.current;
    if (s.part === "tour") return;
    s.part = "tour";
    s.head = Math.max(s.head, INTRO_SECONDS);
    askForTour();
    if (!s.introDone) {
      s.introDone = true;
      latest.current.onIntroEnd?.();
    }
  }, [askForTour]);

  const play = useCallback(function start() {
    const opening = openingRef.current;
    const s = st.current;
    if (!opening || s.failed || s.off || s.part !== "opening") return;
    const src = opening.getAttribute("src");
    let attempt: Promise<void> | undefined;
    try {
      attempt = opening.play();
    } catch (err) {
      fail(err, "opening");
      return;
    }
    attempt?.catch((err: unknown) => {
      const name = (err as { name?: string } | null)?.name;
      // Paused again before it began: not an error.
      if (name === "AbortError") return;
      // The browser will not play unasked (iOS in Low Power Mode): the poster stays until a touch.
      if (name === "NotAllowedError") s.blocked = true;
      // The replacement is played by whichever of the two reports (this and the error event) came first.
      else if (opening.getAttribute("src") === src && fallBack(opening, "opening", src, err) && latest.current.playing && latest.current.active) start();
    });
  }, [fail, fallBack]);

  const onFileError = useCallback(
    (video: HTMLVideoElement | null, part: "opening" | "tour") => {
      // No error on the element: the event is late, from a file that has been replaced since.
      if (!video?.error) return;
      if (fallBack(video, part, video.getAttribute("src"), mediaError(video, part)) && part === "opening" && latest.current.playing && latest.current.active) play();
    },
    [fallBack, play],
  );

  // The opening's file, unless the early script has given it one already.
  useEffect(() => {
    const opening = openingRef.current;
    if (!opening) return;
    mute(opening);
    // A visitor who gets the stills (reduced motion, Save-Data, a 2g link): nothing is fetched.
    if (!opening.getAttribute("src") && !reelWanted()) {
      st.current.off = true;
      return;
    }
    opening.preload = "auto";
    if (!opening.getAttribute("src")) opening.src = address(opening, "opening");
    // An opening the early script has already brought to its first frame.
    if (opening.readyState >= 2 && !opening.paused && !st.current.started) {
      st.current.started = true;
      setStarted(true);
      latest.current.onStart?.();
    }
    // Only the view names the file; it does not change within a page.
  }, [address]);

  // Play and pause. Next keeps a page it has left, hidden, and runs this cleanup: the video stops with it.
  useEffect(() => {
    const opening = openingRef.current;
    if (!opening) return;
    if (playing && active) play();
    else opening.pause();
    return () => opening.pause();
  }, [playing, active, play]);

  // A browser that refused to play unasked plays at the visitor's first touch, key or click.
  useEffect(() => {
    const retry = () => {
      if (!st.current.blocked) return;
      st.current.blocked = false;
      if (latest.current.playing && latest.current.active) play();
    };
    const events = ["pointerdown", "touchend", "keydown"] as const;
    for (const e of events) window.addEventListener(e, retry, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, retry);
    };
  }, [play]);

  // The playhead, once a frame: the opening reports where it is; the tour follows the scroll.
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
      last = now;
      const s = st.current;
      const opening = openingRef.current;
      const tour = tourRef.current;
      if (s.failed || !opening || !tour) return;
      const progress = scroll.current?.progress ?? 0;
      if (s.part === "opening") {
        s.head = openingPosition(opening.currentTime);
        // The rest of the story is wanted soon: fetch it once the opening has a few seconds in hand.
        if (!s.tourAsked && opening.buffered.length && opening.buffered.end(opening.buffered.length - 1) - opening.currentTime > TOUR_AFTER_SECONDS) askForTour();
        if (progress > AT_TOP) endIntro();
      }
      if (s.part === "tour") {
        const next = follow(Math.max(s.head, INTRO_SECONDS), s.velocity, scrollToPosition(progress), dt);
        s.head = next.head;
        s.velocity = next.velocity;
        const decoder = s.decoder;
        if (decoder) {
          const at = tourFrameAt(s.head);
          decoder.update(at, s.velocity * TOUR_FRAMES_PER_UNIT);
          if (!s.paint && decoder.width && decoder.height) s.paint = openPaint(decoder, blendRef.current);
          const drawn = s.paint ? stepDecoded(s.paint, decoder, at) : null;
          if (s.stats) {
            s.stats.refreshes++;
            if (drawn === "nearest") s.stats.missing++;
          }
          // The picture changes over once the canvas shows the frame the playhead is on.
          if (drawn === "exact" && !s.tourShown) {
            s.tourShown = true;
            setShown("tour");
          }
        } else if (tour.readyState >= 1) {
          if (s.blend === undefined) s.blend = openBlend(tour, blendRef.current);
          if (s.blend) {
            // The picture changes over once the canvas shows the frame the playhead is on.
            if (stepBlend(s.blend, tour, s.head) && !s.tourShown) {
              s.tourShown = true;
              setShown("tour");
            }
          } else if (!tour.seeking) {
            // One seek at a time: asking again while the last is under way would only queue up.
            const want = tourSeekTime(s.head);
            if (Math.abs(tour.currentTime - want) > 0.25 / REEL_FPS) tour.currentTime = want;
            // The picture changes over once the tour shows the frame the playhead is on.
            else if (tour.readyState >= 2) setShown("tour");
          }
        }
      }
      const state = rig.current;
      if (state) state.head = s.head;
      if (s.stats && now - s.stats.at >= 1000) showStats(s, tour, now);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, scroll, rig, askForTour, endIntro, openBlend, openPaint, showStats]);

  // The decoder's frames and file are let go with the reel.
  useEffect(
    () => () => {
      st.current.decoder?.close();
      st.current.decoder = null;
    },
    [],
  );

  // `?reelstats=1`, development only.
  useEffect(() => {
    if (!reelStatsWanted()) return;
    st.current.stats = { at: performance.now(), refreshes: 0, missing: 0, jobs: 0 };
    setStatsOn(true);
  }, []);

  // The opening is done with once the tour is on screen.
  useEffect(() => {
    if (shown === "tour") openingRef.current?.pause();
  }, [shown]);

  const onPlaying = useCallback(() => {
    if (st.current.started) return;
    st.current.started = true;
    setStarted(true);
    latest.current.onStart?.();
  }, []);

  return (
    <div className="xp__reel" data-visible={started ? "true" : undefined} data-shown={shown} aria-hidden="true">
      {/* `src` is given by the early script or the effect above, never by the markup: the server cannot know who plays it. */}
      <video
        ref={openingRef}
        className="xp__reel-video"
        data-reel="opening"
        muted
        playsInline
        preload="none"
        disablePictureInPicture
        tabIndex={-1}
        onPlaying={onPlaying}
        onEnded={endIntro}
        onError={() => onFileError(openingRef.current, "opening")}
        suppressHydrationWarning
      />
      <video
        ref={tourRef}
        className="xp__reel-video"
        data-reel="tour"
        muted
        playsInline
        preload="none"
        disablePictureInPicture
        tabIndex={-1}
        onError={() => onFileError(tourRef.current, "tour")}
        suppressHydrationWarning
      />
      {/* The tour as the page draws it: the frame the playhead has passed, and the next dissolved over it. Shown and hidden with the tour's video. */}
      <canvas ref={blendRef} className="xp__reel-video" data-reel="tour" data-blend="" />
      {statsOn ? <pre ref={statsRef} data-reelstats="" style={{ position: "fixed", insetInlineStart: 8, insetBlockEnd: 8, zIndex: 99, margin: 0, padding: "4px 8px", font: "12px/1.4 ui-monospace, monospace", color: "#fff", background: "rgb(0 0 0 / 0.7)", pointerEvents: "none" }} /> : null}
    </div>
  );
}
