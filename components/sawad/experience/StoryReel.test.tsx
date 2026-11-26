// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reportError = vi.fn();
vi.mock("@/lib/monitoring", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

// The page-side decoder (reelDecoder.ts), faked: a test puts frames in it and reads what the reel asked of it.
type FakeFrame = { draw: (ctx: { globalAlpha: number }, ...rest: number[]) => void };
type FakeDecoder = {
  options: { sources: Array<{ codec: string; url: string }>; cap: number; gop: number; onError: (e: unknown) => void; onCodecFailed: (codec: string, e: unknown) => void };
  frames: Map<number, FakeFrame>;
  width: number;
  height: number;
  updates: Array<[number, number]>;
  opened: number;
  closed: boolean;
};
const decoders = vi.hoisted(() => [] as FakeDecoder[]);
vi.mock("./reelDecoder", () => ({
  TourDecoder: class {
    frames = new Map<number, FakeFrame>();
    width = 0;
    height = 0;
    updates: Array<[number, number]> = [];
    opened = 0;
    closed = false;
    constructor(public options: FakeDecoder["options"]) {
      decoders.push(this as unknown as FakeDecoder);
    }
    open() {
      this.opened++;
      return Promise.resolve("hevc");
    }
    update(frame: number, velocity: number) {
      this.updates.push([frame, velocity]);
    }
    get(frame: number) {
      return this.frames.get(frame) ?? null;
    }
    nearest(frame: number) {
      let best: number | null = null;
      for (const f of this.frames.keys()) if (best === null || Math.abs(f - frame) < Math.abs(best - frame)) best = f;
      return best;
    }
    stats() {
      return { held: this.frames.size, jobs: 3, codec: "hevc" };
    }
    close() {
      this.closed = true;
    }
  },
}));

import { BEATS, INTRO_HOLD_SECONDS, INTRO_SECONDS, STORY_END } from "./beats";
import { REEL_FPS, TOUR_FRAMES, reelSources, tourTime } from "./reel";
import StoryReel, { tourSeekTime, type StoryReelProps } from "./StoryReel";
import { frameTime, tourFrameAt } from "./reelFrames";
import { initialRigState } from "./types";

// jsdom has video elements but no playback: each one's state is whatever the test says.
type Fake = { currentTime: number; readyState: number; seeking: boolean; paused: boolean; bufferedEnd: number | null; error: { code: number; message: string } | null };
const fakes = new WeakMap<HTMLVideoElement, Fake>();
const fake = (v: HTMLVideoElement): Fake => {
  let f = fakes.get(v);
  if (!f) {
    f = { currentTime: 0, readyState: 0, seeking: false, paused: true, bufferedEnd: null, error: null };
    fakes.set(v, f);
  }
  return f;
};
let playResult: () => Promise<void> | undefined;
const play = vi.fn(function (this: HTMLVideoElement) {
  fake(this).paused = false;
  return playResult();
});
const pause = vi.fn(function (this: HTMLVideoElement) {
  fake(this).paused = true;
});
const load = vi.fn();
const seeks: Array<{ part: string | undefined; time: number }> = [];

const proto = HTMLMediaElement.prototype;
const define = (key: string, descriptor: PropertyDescriptor) => Object.defineProperty(proto, key, { configurable: true, ...descriptor });
let plays: string[] = [];
const canPlayType = vi.fn((type: string) => (plays.some((c) => type.includes(c)) ? "probably" : ""));
define("canPlayType", { value: canPlayType });
define("play", { value: play });
define("pause", { value: pause });
define("load", { value: load });
define("currentTime", {
  get(this: HTMLVideoElement) {
    return fake(this).currentTime;
  },
  set(this: HTMLVideoElement, time: number) {
    fake(this).currentTime = time;
    fake(this).seeking = true;
    seeks.push({ part: this.dataset.reel, time });
  },
});
for (const key of ["readyState", "seeking", "paused", "error"] as const) {
  define(key, {
    get(this: HTMLVideoElement) {
      return fake(this)[key];
    },
  });
}
define("buffered", {
  get(this: HTMLVideoElement) {
    const end = fake(this).bufferedEnd;
    return { length: end === null ? 0 : 1, start: () => 0, end: () => end ?? 0 };
  },
});

// The frame loop, run by hand.
let frame: FrameRequestCallback | null = null;
let now = 0;
const tick = (seconds = 1 / 60) => {
  now += seconds * 1000;
  const run = frame;
  frame = null;
  act(() => run?.(now));
};
const ticks = (n: number, seconds = 1 / 60) => {
  for (let i = 0; i < n; i++) tick(seconds);
};

function mount(props: Partial<StoryReelProps> = {}) {
  const refs = { scroll: { current: { progress: 0 } }, rig: { current: initialRigState() } };
  const handlers = { onStart: vi.fn(), onIntroEnd: vi.fn(), onError: vi.fn() };
  const all = (p: Partial<StoryReelProps>): StoryReelProps => ({ view: "flight", playing: true, ...refs, ...handlers, ...p });
  let current = props;
  const view = render(<StoryReel {...all(props)} />);
  const opening = view.container.querySelector<HTMLVideoElement>('video[data-reel="opening"]')!;
  const tour = view.container.querySelector<HTMLVideoElement>('video[data-reel="tour"]')!;
  return {
    ...refs,
    ...handlers,
    opening,
    tour,
    reel: view.container.querySelector<HTMLElement>(".xp__reel")!,
    update: (next: Partial<StoryReelProps>) => view.rerender(<StoryReel {...all((current = { ...current, ...next }))} />),
    unmount: view.unmount,
  };
}

const shape = (width: number, height: number) => {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true, writable: true });
};
const rejected = (name: string) => () => Promise.reject(Object.assign(new Error(name), { name }));
const settle = () => act(async () => {});

beforeEach(() => {
  shape(1440, 900);
  now = 0;
  frame = null;
  seeks.length = 0;
  playResult = () => Promise.resolve();
  plays = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frame = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frame = null;
  });
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const m of [play, pause, load, reportError]) m.mockClear();
});

describe("tourSeekTime", () => {
  it("lands in the middle of the frame a position belongs to, within the file", () => {
    expect(tourSeekTime(INTRO_SECONDS)).toBeCloseTo(0.5 / REEL_FPS);
    expect(tourSeekTime(0)).toBeCloseTo(0.5 / REEL_FPS);
    expect(tourSeekTime(STORY_END)).toBeCloseTo((TOUR_FRAMES + 0.5) / REEL_FPS);
    expect(tourSeekTime(STORY_END + 40)).toBeCloseTo((TOUR_FRAMES + 0.5) / REEL_FPS);
    for (const beat of BEATS) expect(tourSeekTime(beat.at)).toBeCloseTo(tourTime(beat.at) + 0.5 / REEL_FPS);
  });
});

describe("StoryReel", () => {
  it("is two silent inline videos with no file in the markup, hidden from assistive technology", () => {
    const refs = { scroll: { current: { progress: 0 } }, rig: { current: initialRigState() } };
    const html = renderToString(<StoryReel view="flight" playing {...refs} />);
    const host = document.createElement("div");
    host.innerHTML = html;
    const videos = Array.from(host.querySelectorAll("video"));
    expect(videos.map((v) => v.dataset.reel)).toEqual(["opening", "tour"]);
    // The server cannot know who plays the reel: no `src`, and nothing fetched until a script says so.
    expect(videos.every((v) => !v.hasAttribute("src") && v.getAttribute("preload") === "none" && v.hasAttribute("playsinline"))).toBe(true);
    expect(host.querySelector(".xp__reel")!.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector(".xp__reel")!.hasAttribute("data-visible")).toBe(false);
  });

  it("gives the opening its file for the screen's shape and plays it, muted", () => {
    const wide = mount();
    expect(wide.opening.getAttribute("src")).toBe(reelSources("flight", "wide").opening);
    expect(wide.opening.muted).toBe(true);
    expect(wide.opening.preload).toBe("auto");
    expect(play).toHaveBeenCalledTimes(1);
    expect(wide.tour.hasAttribute("src")).toBe(false);
    wide.unmount();
    shape(412, 915);
    const tall = mount({ view: "street" });
    expect(tall.opening.getAttribute("src")).toBe(reelSources("street", "tall").opening);
  });

  it("fetches and plays nothing for a visitor who gets the stills (reduced motion, Save-Data, a 2g link)", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    const reduced = mount();
    expect(reduced.opening.hasAttribute("src")).toBe(false);
    expect(play).not.toHaveBeenCalled();
    ticks(3);
    expect(reduced.tour.hasAttribute("src")).toBe(false);
    reduced.unmount();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("navigator", { ...navigator, connection: { effectiveType: "2g" } });
    const slow = mount();
    expect(slow.opening.hasAttribute("src")).toBe(false);
    expect(play).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("keeps the file the early script gave it, and takes over an opening that is already playing", () => {
    // Stands in for the server's markup after early.ts has run on it.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const refs = { scroll: { current: { progress: 0 } }, rig: { current: initialRigState() } };
    const onStart = vi.fn();
    host.innerHTML = renderToString(<StoryReel view="flight" playing {...refs} onStart={onStart} />);
    const opening = host.querySelector<HTMLVideoElement>('video[data-reel="opening"]')!;
    opening.setAttribute("src", "/early.mp4");
    Object.assign(fake(opening), { readyState: 4, paused: false });
    const view = render(<StoryReel view="flight" playing {...refs} onStart={onStart} />, { container: host, hydrate: true });
    expect(opening.getAttribute("src")).toBe("/early.mp4");
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".xp__reel")!.getAttribute("data-visible")).toBe("true");
    view.unmount();
    host.remove();
  });

  it("shows itself over the poster at the opening's first frame, once", () => {
    const reel = mount();
    expect(reel.reel.hasAttribute("data-visible")).toBe(false);
    fireEvent.playing(reel.opening);
    fireEvent.playing(reel.opening);
    expect(reel.reel.getAttribute("data-visible")).toBe("true");
    expect(reel.onStart).toHaveBeenCalledTimes(1);
  });

  it("tells the page where the opening is: still for the hold, then one sequence second a second", () => {
    const reel = mount();
    fake(reel.opening).currentTime = INTRO_HOLD_SECONDS / 2;
    tick();
    expect(reel.rig.current.head).toBe(0);
    fake(reel.opening).currentTime = INTRO_HOLD_SECONDS + 6;
    tick();
    expect(reel.rig.current.head).toBe(6);
    expect(reel.reel.getAttribute("data-shown")).toBe("opening");
  });

  it("pauses the opening when asked, and stops with a page that is hidden", () => {
    const reel = mount({ playing: false });
    expect(play).not.toHaveBeenCalled();
    reel.update({ playing: true });
    expect(play).toHaveBeenCalledTimes(1);
    reel.update({ playing: false });
    expect(fake(reel.opening).paused).toBe(true);
    reel.update({ playing: true });
    pause.mockClear();
    reel.unmount();
    expect(pause).toHaveBeenCalled();
  });

  it("holds its frame while the explorer is loading or open: no playing, no seeking", () => {
    const reel = mount();
    fake(reel.opening).currentTime = INTRO_HOLD_SECONDS + 4;
    tick();
    reel.update({ active: false });
    expect(fake(reel.opening).paused).toBe(true);
    expect(frame).toBeNull();
    // The explorer opens on the shot that was showing.
    expect(reel.rig.current.head).toBe(4);
    reel.update({ active: true });
    expect(fake(reel.opening).paused).toBe(false);
    expect(frame).not.toBeNull();
  });

  it("fetches the tour once the opening has a few seconds in hand", () => {
    const reel = mount();
    fake(reel.opening).bufferedEnd = 2;
    tick();
    expect(reel.tour.hasAttribute("src")).toBe(false);
    fake(reel.opening).bufferedEnd = 5;
    tick();
    expect(reel.tour.getAttribute("src")).toBe(reelSources("flight", "wide").tour);
    expect(reel.tour.preload).toBe("auto");
    expect(reel.tour.muted).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    tick();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("hands over to the tour when the opening ends, on the same frame", () => {
    const reel = mount();
    fake(reel.opening).currentTime = INTRO_HOLD_SECONDS + INTRO_SECONDS;
    fireEvent.ended(reel.opening);
    expect(reel.onIntroEnd).toHaveBeenCalledTimes(1);
    expect(reel.tour.getAttribute("src")).toBe(reelSources("flight", "wide").tour);
    // Nothing to seek on yet: the opening's last frame stays.
    tick();
    expect(seeks).toHaveLength(0);
    expect(reel.reel.getAttribute("data-shown")).toBe("opening");
    // With its metadata in, the tour is put on its first frame, the gate.
    fake(reel.tour).readyState = 1;
    tick();
    expect(seeks).toEqual([{ part: "tour", time: tourSeekTime(INTRO_SECONDS) }]);
    expect(reel.rig.current.head).toBe(INTRO_SECONDS);
    // And takes the screen only once that frame is in.
    tick();
    expect(reel.reel.getAttribute("data-shown")).toBe("opening");
    Object.assign(fake(reel.tour), { seeking: false, readyState: 2 });
    tick();
    expect(reel.reel.getAttribute("data-shown")).toBe("tour");
    expect(fake(reel.opening).paused).toBe(true);
    fireEvent.ended(reel.opening);
    expect(reel.onIntroEnd).toHaveBeenCalledTimes(1);
  });

  it("cuts to the tour when the visitor scrolls during the opening, and follows the scroll as a glide", () => {
    const reel = mount();
    fake(reel.opening).currentTime = INTRO_HOLD_SECONDS + 3;
    tick();
    reel.scroll.current.progress = 0.2; // the first stop
    Object.assign(fake(reel.tour), { readyState: 4 });
    tick();
    expect(reel.onIntroEnd).toHaveBeenCalledTimes(1);
    // From the gate, never from the middle of the opening; eased, so one frame does not jump there.
    const first = reel.rig.current.head;
    expect(first).toBeGreaterThan(INTRO_SECONDS);
    expect(first).toBeLessThan(BEATS[0].at);
    expect(seeks.at(-1)).toEqual({ part: "tour", time: tourSeekTime(first) });
    // One seek at a time: while it is under way the playhead moves on but no new seek is asked for.
    const asked = seeks.length;
    ticks(5);
    expect(seeks).toHaveLength(asked);
    expect(reel.rig.current.head).toBeGreaterThan(first);
    // When it lands, the next seek goes to where the playhead is by then.
    fake(reel.tour).seeking = false;
    tick();
    expect(seeks).toHaveLength(asked + 1);
    expect(seeks.at(-1)!.time).toBe(tourSeekTime(reel.rig.current.head));
    // Left alone it settles on the stop's own frame and shows it.
    for (let i = 0; i < 240; i++) {
      fake(reel.tour).seeking = false;
      tick();
    }
    expect(reel.rig.current.head).toBeCloseTo(BEATS[0].at, 3);
    expect(fake(reel.tour).currentTime).toBeCloseTo(tourSeekTime(BEATS[0].at));
    expect(reel.reel.getAttribute("data-shown")).toBe("tour");
    // No more seeks once it is there.
    const settled = seeks.length;
    fake(reel.tour).seeking = false;
    ticks(10);
    expect(seeks).toHaveLength(settled);
  });

  it("goes back to the gate, not to the opening, when the visitor scrolls back to the top", () => {
    const reel = mount();
    reel.scroll.current.progress = 1;
    Object.assign(fake(reel.tour), { readyState: 4 });
    for (let i = 0; i < 400; i++) {
      fake(reel.tour).seeking = false;
      tick();
    }
    expect(reel.rig.current.head).toBeCloseTo(STORY_END, 3);
    reel.scroll.current.progress = 0;
    for (let i = 0; i < 400; i++) {
      fake(reel.tour).seeking = false;
      tick();
    }
    expect(reel.rig.current.head).toBeCloseTo(INTRO_SECONDS, 3);
    expect(fake(reel.tour).currentTime).toBeCloseTo(tourSeekTime(INTRO_SECONDS));
    expect(reel.reel.getAttribute("data-shown")).toBe("tour");
  });

  it("never jumps the playhead after a tab has slept", () => {
    const reel = mount();
    reel.scroll.current.progress = 1;
    Object.assign(fake(reel.tour), { readyState: 4 });
    tick(30);
    expect(reel.rig.current.head).toBeLessThan(STORY_END);
  });

  it("waits for the visitor's first touch where the browser will not play unasked", async () => {
    playResult = rejected("NotAllowedError");
    const reel = mount();
    await settle();
    expect(reportError).not.toHaveBeenCalled();
    expect(reel.onError).not.toHaveBeenCalled();
    playResult = () => Promise.resolve();
    fireEvent.pointerDown(window);
    expect(play).toHaveBeenCalledTimes(2);
    // Only once: later touches are the visitor's own business.
    fireEvent.pointerDown(window);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("does not start at a touch while paused", async () => {
    playResult = rejected("NotAllowedError");
    const reel = mount();
    await settle();
    reel.update({ playing: false });
    fireEvent.keyDown(window);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("takes a pause before the first frame for what it is", async () => {
    playResult = rejected("AbortError");
    const reel = mount();
    await settle();
    expect(reportError).not.toHaveBeenCalled();
    expect(reel.onError).not.toHaveBeenCalled();
  });

  it("reports a play that fails for any other reason, once, and tells the page", async () => {
    playResult = rejected("NotSupportedError");
    const reel = mount();
    await settle();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith("StoryReel", expect.objectContaining({ name: "NotSupportedError" }), { view: "flight", part: "opening" });
    expect(reel.onError).toHaveBeenCalledTimes(1);
    // The loop stands still from then on.
    reel.scroll.current.progress = 1;
    tick();
    expect(seeks).toHaveLength(0);
  });

  it("reports a play that throws outright", () => {
    playResult = () => {
      throw new Error("no decoder");
    };
    const reel = mount();
    expect(reportError).toHaveBeenCalledWith("StoryReel", expect.any(Error), { view: "flight", part: "opening" });
    expect(reel.onError).toHaveBeenCalledTimes(1);
  });

  it("reports a file that cannot be played, naming which, and tells the page once", () => {
    const reel = mount();
    fake(reel.tour).error = { code: 4, message: "format not supported" };
    fireEvent.error(reel.tour);
    expect(reportError).toHaveBeenCalledWith("StoryReel", expect.objectContaining({ message: expect.stringContaining("tour could not be played (code 4: format not supported)") }), { view: "flight", part: "tour" });
    fake(reel.opening).error = { code: 4, message: "" };
    fireEvent.error(reel.opening);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reel.onError).toHaveBeenCalledTimes(1);
  });

  it("asks for the best codec the browser plays, in both parts", () => {
    plays = ["av01", "hvc1"];
    const reel = mount();
    expect(reel.opening.getAttribute("src")).toBe(reelSources("flight", "wide", "av1").opening);
    fireEvent.ended(reel.opening);
    expect(reel.tour.getAttribute("src")).toBe(reelSources("flight", "wide", "hevc").tour);
    reel.unmount();
    plays = ["hvc1"];
    expect(mount().opening.getAttribute("src")).toBe(reelSources("flight", "wide", "hevc").opening);
  });

  it("goes down the codecs from where the failed file was, and ends the reel only after H.264", () => {
    plays = ["av01", "hvc1"];
    const reel = mount();
    const breakOpening = () => {
      fake(reel.opening).error = { code: 3, message: "decode" };
      fireEvent.error(reel.opening);
      fake(reel.opening).error = null; // what `load` does
    };
    fake(reel.opening).currentTime = 5;
    breakOpening();
    expect(reel.opening.getAttribute("src")).toBe(reelSources("flight", "wide", "hevc").opening);
    expect(seeks.at(-1)).toEqual({ part: "opening", time: 5 });
    expect(play).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenLastCalledWith("StoryReel", expect.any(Error), { view: "flight", part: "opening", codec: "av1", severity: "warning", recoverable: true });
    expect(reel.onError).not.toHaveBeenCalled();
    // A late event from the file that was replaced changes nothing.
    fireEvent.error(reel.opening);
    expect(reel.opening.getAttribute("src")).toBe(reelSources("flight", "wide", "hevc").opening);
    // The tour does not try a codec that has failed.
    fireEvent.ended(reel.opening);
    expect(reel.tour.getAttribute("src")).toBe(reelSources("flight", "wide", "hevc").tour);
    fake(reel.tour).error = { code: 4, message: "" };
    fireEvent.error(reel.tour);
    expect(reel.tour.getAttribute("src")).toBe(reelSources("flight", "wide", "h264").tour);
    expect(reel.onError).not.toHaveBeenCalled();
    fireEvent.error(reel.tour);
    expect(reel.onError).toHaveBeenCalledTimes(1);
  });

  it("takes a failed play and the error event for one failure, and plays the replacement", async () => {
    plays = ["av01"];
    playResult = rejected("NotSupportedError");
    const reel = mount();
    playResult = () => Promise.resolve();
    await settle();
    fireEvent.error(reel.opening);
    expect(reel.opening.getAttribute("src")).toBe(reelSources("flight", "wide", "h264").opening);
    expect(play).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reel.onError).not.toHaveBeenCalled();
  });

  it("works without listeners", async () => {
    playResult = rejected("NotSupportedError");
    const reel = mount({ onStart: undefined, onIntroEnd: undefined, onError: undefined });
    fireEvent.playing(reel.opening);
    fireEvent.ended(reel.opening);
    fireEvent.error(reel.opening);
    await settle();
    expect(reportError).toHaveBeenCalled();
  });
});

describe("StoryReel dissolving between frames", () => {
  type Draw = { target: HTMLCanvasElement; source: unknown; alpha: number; time?: number };
  let draws: Draw[];
  let getContext: ReturnType<typeof vi.spyOn>;
  const contexts = new WeakMap<HTMLCanvasElement, object>();

  /** A 2d context that only records what is drawn onto it, and with what strength. */
  const fakeContext = (canvas: HTMLCanvasElement) => {
    let ctx = contexts.get(canvas);
    if (!ctx) {
      const own = {
        canvas,
        globalAlpha: 1,
        drawImage: (source: unknown) => draws.push({ target: canvas, source, alpha: own.globalAlpha, time: source instanceof HTMLVideoElement ? source.currentTime : undefined }),
      };
      ctx = own;
      contexts.set(canvas, ctx);
    }
    return ctx;
  };

  beforeEach(() => {
    draws = [];
    getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      return fakeContext(this) as never;
    });
  });

  /** A mounted reel whose tour is a 1920 x 1080 video with its metadata in, scrolled to `frame` of the tour. */
  const mountTour = (frame: number, props: Partial<StoryReelProps> = {}) => {
    const reel = mount(props);
    for (const key of ["videoWidth", "videoHeight"] as const) Object.defineProperty(reel.tour, key, { value: key === "videoWidth" ? 1920 : 1080, configurable: true });
    const canvas = reel.reel.querySelector<HTMLCanvasElement>("canvas[data-blend]")!;
    // Frame k of the tour is at scroll 0.2 * k / 140 up to the first stop (frame 140).
    reel.scroll.current.progress = (0.2 * frame) / 140;
    Object.assign(fake(reel.tour), { readyState: 4 });
    return { ...reel, canvas, onScreen: () => draws.filter((d) => d.target === canvas), captures: () => draws.filter((d) => d.source === reel.tour) };
  };
  /** Runs frames, each seek landing before the next frame. */
  const run = (reel: { tour: HTMLVideoElement }, n: number) => {
    for (let i = 0; i < n; i++) {
      fake(reel.tour).seeking = false;
      tick();
    }
  };
  const tourSeeks = () => seeks.filter((x) => x.part === "tour");

  it("puts a canvas the size of the video right after it, hidden and shown with it", () => {
    const reel = mountTour(70);
    expect(reel.canvas.className).toBe("xp__reel-video");
    expect(reel.canvas.dataset.reel).toBe("tour");
    expect(reel.canvas.previousElementSibling).toBe(reel.tour);
    run(reel, 1);
    expect(reel.canvas.width).toBe(1920);
    expect(reel.canvas.height).toBe(1080);
    expect(getContext).toHaveBeenCalledWith("2d", { alpha: false });
  });

  it("seeks only to the middle of whole frames, takes them from the video, dissolves, and goes quiet once settled", () => {
    const reel = mountTour(70.4);
    run(reel, 300);
    expect(tourSeeks().length).toBeGreaterThan(0);
    for (const { time } of tourSeeks()) {
      const frame = time * REEL_FPS - 0.5;
      expect(Math.abs(frame - Math.round(frame))).toBeLessThan(1e-9);
    }
    // Frames are copied off the video onto canvases of their own, never onto the screen directly.
    expect(reel.captures().length).toBeGreaterThan(0);
    expect(reel.captures().every((d) => d.target !== reel.canvas)).toBe(true);
    // Between two frames: at least one draw to the screen that is a blend.
    expect(reel.onScreen().some((d) => d.alpha > 0 && d.alpha < 1)).toBe(true);
    expect(reel.reel.getAttribute("data-shown")).toBe("tour");
    expect(reel.rig.current.head).toBeCloseTo(INTRO_SECONDS + 70.4 / 20, 3);
    // Settled: no seeks, no drawing.
    const seeked = seeks.length;
    const drawn = draws.length;
    run(reel, 30);
    expect(seeks).toHaveLength(seeked);
    expect(draws).toHaveLength(drawn);
  });

  it("rests between two frames as the frame below at full strength with the next over it by the fraction between", () => {
    const reel = mountTour(70.4);
    run(reel, 300);
    const [base, over] = reel.onScreen().slice(-2);
    expect(base.alpha).toBe(1);
    expect(over.alpha).toBeCloseTo(0.4, 2);
    const surface = (frame: number) => reel.captures().filter((d) => Math.abs(d.time! - frameTime(frame)) < 1e-9).at(-1)!.target;
    expect(base.source).toBe(surface(70));
    expect(over.source).toBe(surface(71));
    // The strength is put back, so the next frame's own draw starts from full.
    expect((fakeContext(reel.canvas) as { globalAlpha: number }).globalAlpha).toBe(1);
  });

  it("rests on a whole frame as that frame alone", () => {
    const reel = mountTour(70);
    run(reel, 300);
    expect(reel.onScreen().at(-1)!.alpha).toBe(1);
    const last = reel.onScreen().at(-1)!;
    // Nothing is drawn over the last draw: it is the frame the playhead is on.
    expect(draws.at(-1)).toBe(last);
    expect(last.time).toBeUndefined();
  });

  it("shows the nearest frame it holds while the seek for the one it needs is out, then the frame itself", () => {
    const reel = mountTour(70.4);
    run(reel, 300);
    const surface = (frame: number) => reel.captures().filter((d) => Math.abs(d.time! - frameTime(frame)) < 1e-9).at(-1)!.target;
    // The playhead moves on to 72.4: frame 72 is wanted, and the seek never lands.
    reel.scroll.current.progress = (0.2 * 72.4) / 140;
    for (let i = 0; i < 120; i++) tick();
    expect(tourSeeks().at(-1)!.time).toBeCloseTo(frameTime(72), 9);
    expect(reel.onScreen().at(-1)!.source).toBe(surface(71));
    expect(reel.onScreen().at(-1)!.alpha).toBe(1);
    expect(reel.reel.getAttribute("data-shown")).toBe("tour");
    // It lands; the next frame follows, and the screen settles on 72 with 73 dissolved over it.
    run(reel, 120);
    const [base, over] = reel.onScreen().slice(-2);
    expect([base.alpha, over.alpha]).toEqual([1, expect.closeTo(0.4, 2)]);
    expect(base.source).toBe(surface(72));
    expect(over.source).toBe(surface(73));
  });

  it("takes a frame straight off a video that is already on it, without a seek", () => {
    // A scroll that has hardly begun: the playhead is still on the gate.
    const reel = mountTour(3);
    // The tour is on its first frame already (a browser puts it there when it loads).
    fake(reel.tour).currentTime = frameTime(0);
    tick();
    expect(tourSeeks()).toHaveLength(0);
    expect(reel.captures()).toHaveLength(1);
    expect(reel.reel.getAttribute("data-shown")).toBe("tour");
  });

  it("holds no more than a few frames, whatever the scroll covers", () => {
    const reel = mountTour(3);
    reel.scroll.current.progress = 1;
    run(reel, 400);
    expect(reel.rig.current.head).toBeCloseTo(STORY_END, 3);
    const surfaces = new Set(reel.captures().map((d) => d.target));
    expect(surfaces.size).toBeLessThanOrEqual(4);
    expect(reel.captures().length).toBeGreaterThan(4);
    expect(reel.reel.getAttribute("data-shown")).toBe("tour");
  });

  it("seeks the video itself, as before, where there is no canvas to draw on", () => {
    getContext.mockImplementation(() => null as never);
    const reel = mountTour(140);
    run(reel, 400);
    expect(draws).toHaveLength(0);
    expect(tourSeeks().length).toBeGreaterThan(0);
    expect(tourSeeks().at(-1)).toEqual({ part: "tour", time: tourSeekTime(BEATS[0].at) });
    expect(reel.reel.getAttribute("data-shown")).toBe("tour");
    // Nothing went wrong: a browser without 2d canvas is not an error.
    expect(reportError).not.toHaveBeenCalled();
    const seeked = seeks.length;
    run(reel, 20);
    expect(seeks).toHaveLength(seeked);
    // And it asked once, not once a frame.
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it("goes back to seeking the video, and says so, when the canvas throws", () => {
    getContext.mockImplementation(() => {
      throw new Error("out of canvas memory");
    });
    const reel = mountTour(140);
    run(reel, 400);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith("StoryReel", expect.objectContaining({ message: "out of canvas memory" }), { view: "flight", part: "tour", severity: "warning", recoverable: true });
    expect(reel.onError).not.toHaveBeenCalled();
    expect(tourSeeks().at(-1)).toEqual({ part: "tour", time: tourSeekTime(BEATS[0].at) });
    expect(reel.reel.getAttribute("data-shown")).toBe("tour");
  });

  it("waits for the video's size before it makes the canvas", () => {
    const reel = mount();
    reel.scroll.current.progress = 0.1;
    Object.assign(fake(reel.tour), { readyState: 4 });
    run(reel, 3);
    expect(getContext).not.toHaveBeenCalled();
    // Without a size the video is sought as before.
    expect(tourSeeks().length).toBeGreaterThan(0);
  });

  it("carries on with H.264 when an AV1 tour fails in the middle of a seek", () => {
    plays = ["av01"];
    const reel = mountTour(70.4);
    fireEvent.ended(reel.opening);
    expect(reel.tour.getAttribute("src")).toBe(reelSources("flight", "wide", "av1").tour);
    run(reel, 3);
    // A seek is out, and the file fails under it.
    fake(reel.tour).seeking = true;
    const captured = reel.captures().length;
    fake(reel.tour).error = { code: 3, message: "decode" };
    fireEvent.error(reel.tour);
    expect(reel.tour.getAttribute("src")).toBe(reelSources("flight", "wide", "h264").tour);
    expect(reportError).toHaveBeenCalledWith("StoryReel", expect.any(Error), { view: "flight", part: "tour", codec: "av1", severity: "warning", recoverable: true });
    expect(reel.onError).not.toHaveBeenCalled();
    // The new file loads and the tour goes on to the playhead's frames.
    Object.assign(fake(reel.tour), { error: null, seeking: false, readyState: 4 });
    run(reel, 300);
    expect(reel.captures().length).toBeGreaterThan(captured);
    expect(reel.reel.getAttribute("data-shown")).toBe("tour");
    expect(reel.rig.current.head).toBeCloseTo(INTRO_SECONDS + 70.4 / 20, 3);
    expect(reel.onScreen().slice(-2).map((d) => d.alpha)).toEqual([1, expect.closeTo(0.4, 2)]);
    expect(reel.onError).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});

describe("StoryReel decoding the tour in the page (WebCodecs)", () => {
  type Draw = { frame: number; alpha: number };
  let draws: Draw[];
  let context: { globalAlpha: number } | null;
  let getContext: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    decoders.length = 0;
    draws = [];
    context = { globalAlpha: 1 };
    vi.stubGlobal("VideoDecoder", class {});
    getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => context as never);
  });

  /** Frames `from` to `to` decoded, each recording its draws and the strength they were drawn at. */
  const hold = (decoder: FakeDecoder, from: number, to: number) => {
    for (let f = from; f <= to; f++) decoder.frames.set(f, { draw: (ctx) => draws.push({ frame: f, alpha: ctx.globalAlpha }) });
  };
  /** A reel scrolled to `frame` of the tour, its tour asked for and its decoder open on a 1920 x 1080 file. */
  const mountTour = (frame: number) => {
    const reel = mount();
    reel.scroll.current.progress = (0.2 * frame) / 140;
    tick();
    const decoder = decoders[0];
    Object.assign(decoder, { width: 1920, height: 1080 });
    const canvas = reel.reel.querySelector<HTMLCanvasElement>("canvas[data-blend]")!;
    return { ...reel, decoder, canvas };
  };

  it("decodes the tour instead of giving its video a file, in the tour's codec order, within the shape's cap", () => {
    const reel = mountTour(70.4);
    expect(decoders).toHaveLength(1);
    const { decoder } = reel;
    expect(decoder.opened).toBe(1);
    expect(decoder.options.sources).toEqual((["hevc", "av1", "h264"] as const).map((codec) => ({ codec, url: reelSources("flight", "wide", codec).tour })));
    expect(decoder.options.cap).toBe(60);
    expect(decoder.options.gop).toBe(20);
    ticks(300);
    // No double download: the tour's video never gets a file.
    expect(reel.tour.hasAttribute("src")).toBe(false);
    expect(load).not.toHaveBeenCalled();
    // The window is steered by the playhead, in tour frames.
    expect(decoder.updates.at(-1)![0]).toBeCloseTo(tourFrameAt(reel.rig.current.head), 9);
    expect(decoder.updates.some(([, v]) => v > 0)).toBe(true);
  });

  it("draws the frame the playhead has passed at full strength and the next over it at the mix, then shows the tour", () => {
    const reel = mountTour(70.4);
    hold(reel.decoder, 0, 200);
    ticks(300);
    expect(getContext).toHaveBeenCalledWith("2d", { alpha: false });
    expect([reel.canvas.width, reel.canvas.height]).toEqual([1920, 1080]);
    expect(reel.rig.current.head).toBeCloseTo(INTRO_SECONDS + 70.4 / 20, 3);
    expect(draws.slice(-2)).toEqual([
      { frame: 70, alpha: 1 },
      { frame: 71, alpha: expect.closeTo(0.4, 2) },
    ]);
    expect(context!.globalAlpha).toBe(1);
    expect(reel.reel.getAttribute("data-shown")).toBe("tour");
    // Settled: nothing more is drawn.
    const drawn = draws.length;
    ticks(30);
    expect(draws).toHaveLength(drawn);
  });

  it("shows the nearest frame held while the one wanted is decoding, and changes over only once it is in", () => {
    const reel = mountTour(70);
    ticks(5);
    // Nothing held: nothing drawn, the opening stays.
    expect(draws).toHaveLength(0);
    hold(reel.decoder, 40, 40);
    ticks(300);
    expect(draws.at(-1)).toEqual({ frame: 40, alpha: 1 });
    expect(reel.reel.getAttribute("data-shown")).toBe("opening");
    hold(reel.decoder, 70, 70);
    tick();
    expect(draws.at(-1)).toEqual({ frame: 70, alpha: 1 });
    expect(reel.reel.getAttribute("data-shown")).toBe("tour");
  });

  it("falls back to the video from the current playhead when the decoder fails, and says so as a warning", () => {
    const reel = mountTour(70.4);
    hold(reel.decoder, 0, 200);
    ticks(300);
    const error = new Error("decode failed");
    act(() => reel.decoder.options.onError(error));
    expect(reportError).toHaveBeenCalledWith("StoryReel", error, { view: "flight", part: "tour", stage: "decoder", severity: "warning", recoverable: true });
    expect(reel.onError).not.toHaveBeenCalled();
    expect(reel.decoder.closed).toBe(true);
    expect(reel.tour.getAttribute("src")).toBe(reelSources("flight", "wide").tour);
    expect(load).toHaveBeenCalled();
    // The video takes over where the playhead is: its first seek is to that frame (or the one after it).
    for (const key of ["videoWidth", "videoHeight"] as const) Object.defineProperty(reel.tour, key, { value: key === "videoWidth" ? 1920 : 1080, configurable: true });
    Object.assign(fake(reel.tour), { readyState: 4 });
    tick();
    const first = seeks.find((x) => x.part === "tour")!;
    const at = tourFrameAt(reel.rig.current.head);
    expect([Math.floor(at), Math.floor(at) + 1].map(frameTime)).toContainEqual(first.time);
    // The canvas keeps the last decoded frame until the video's is in: still the tour on screen.
    expect(reel.reel.getAttribute("data-shown")).toBe("tour");
    // A late report from the decoder that was let go changes nothing.
    act(() => reel.decoder.options.onError(new Error("late")));
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("gives the decoder up for the video where there is no 2d canvas", () => {
    context = null;
    const reel = mountTour(30);
    tick();
    expect(reportError).toHaveBeenCalledWith("StoryReel", expect.objectContaining({ message: expect.stringContaining("No 2d canvas") }), expect.objectContaining({ stage: "decoder", severity: "warning" }));
    expect(reel.tour.getAttribute("src")).toBe(reelSources("flight", "wide").tour);
  });

  it("reports a codec the decoder had to pass over as a warning, naming it", () => {
    const reel = mountTour(30);
    const error = new Error("hevc unsupported");
    reel.decoder.options.onCodecFailed("hevc", error);
    expect(reportError).toHaveBeenCalledWith("StoryReel", error, { view: "flight", part: "tour", stage: "decoder", codec: "hevc", severity: "warning", recoverable: true });
    expect(reel.tour.hasAttribute("src")).toBe(false);
  });

  it("asks for the tall tour on a tall screen, with the smaller cap", () => {
    shape(412, 915);
    mountTour(30);
    expect(decoders[0].options.sources[0].url).toBe(reelSources("flight", "tall", "hevc").tour);
    expect(decoders[0].options.cap).toBe(40);
  });

  it("lets the decoder go with the reel", () => {
    const reel = mountTour(30);
    reel.unmount();
    expect(reel.decoder.closed).toBe(true);
  });

  it("measures itself once a second with ?reelstats=1 (development only)", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    window.history.replaceState(null, "", "/?reelstats=1");
    try {
      const reel = mountTour(70);
      hold(reel.decoder, 40, 40);
      ticks(70);
      const overlay = reel.reel.querySelector("pre[data-reelstats]")!;
      expect(overlay.textContent).toMatch(/^decoder hevc · held 1 · jobs\/s \d+\.\d · missing \d+\/\d+ refreshes$/);
      expect(info).toHaveBeenCalledWith(expect.stringContaining("[reelstats] decoder hevc"));
      act(() => reel.decoder.options.onError(new Error("x")));
      ticks(70);
      expect(overlay.textContent).toBe("video fallback h264");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("shows no measurements without the switch", () => {
    const reel = mountTour(70);
    ticks(70);
    expect(reel.reel.querySelector("pre[data-reelstats]")).toBeNull();
  });
});

describe("StoryReel without WebCodecs", () => {
  it("seeks the tour's video, as before, and makes no decoder", () => {
    decoders.length = 0;
    const reel = mount();
    reel.scroll.current.progress = 0.1;
    tick();
    expect(decoders).toHaveLength(0);
    expect(reel.tour.getAttribute("src")).toBe(reelSources("flight", "wide").tour);
  });
});
