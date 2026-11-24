"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { reportError } from "@/lib/monitoring";
import type { ViewId } from "../scene/types";
import { INTRO_SECONDS, approach, scrollToPosition } from "./beats";
import { playsReel } from "../scene/capability";
import { REEL_FPS, TOUR_FRAMES, openingPosition, playableCodecs, reelFileOf, reelShape, reelSources, tourTime, type ReelCodec } from "./reel";
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
  const frame = Math.min(TOUR_FRAMES, Math.max(0, Math.round(tourTime(position) * REEL_FPS)));
  return (frame + 0.5) / REEL_FPS;
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
 * - The tour is never played. Each frame the playhead closes on where the scroll wants it, on
 *   the same easing the live camera used (beats.ts `approach`), and the video is sought to that
 *   frame; a seek still under way is left to finish, so a slow device shows fewer frames, never a
 *   wrong one. A scroll during the opening cuts to the tour.
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
  /** Which file is on screen. The playhead moves to the tour first (`st.part`); the picture follows once the tour has its frame. */
  const [shown, setShown] = useState<"opening" | "tour">("opening");
  const [started, setStarted] = useState(false);
  const st = useRef({ part: "opening" as "opening" | "tour", head: 0, started: false, introDone: false, failed: false, tourAsked: false, blocked: false, off: false, codecs: null as ReelCodec[] | null });
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

  /** The address of a part in the best codec that has not failed. */
  const address = useCallback(
    (video: HTMLVideoElement, part: "opening" | "tour") => {
      const codecs = (st.current.codecs ??= playableCodecs(video));
      return reelSources(view, reelShape(window.innerWidth, window.innerHeight), codecs[0])[part];
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
      const next = s.codecs[0];
      if (codec === "h264" || !next) {
        fail(error, part);
        return false;
      }
      reportError("StoryReel", error, { view, part, codec, severity: "warning", recoverable: true });
      const at = video.currentTime;
      video.src = reelSources(view, shape, next)[part];
      video.load();
      if (at > 0) video.currentTime = at;
      return true;
    },
    [view, fail],
  );

  const askForTour = useCallback(() => {
    const tour = tourRef.current;
    if (!tour || st.current.tourAsked || st.current.off) return;
    st.current.tourAsked = true;
    mute(tour);
    tour.preload = "auto";
    tour.src = address(tour, "tour");
    tour.load();
  }, [address]);

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
        s.head = approach(Math.max(s.head, INTRO_SECONDS), scrollToPosition(progress), dt);
        // One seek at a time: asking again while the last is under way would only queue up.
        if (tour.readyState >= 1 && !tour.seeking) {
          const want = tourSeekTime(s.head);
          if (Math.abs(tour.currentTime - want) > 0.25 / REEL_FPS) tour.currentTime = want;
          // The picture changes over once the tour shows the frame the playhead is on.
          else if (tour.readyState >= 2) setShown("tour");
        }
      }
      const state = rig.current;
      if (state) state.head = s.head;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, scroll, rig, askForTour, endIntro]);

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
    </div>
  );
}
