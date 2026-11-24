// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reportError = vi.fn();
vi.mock("@/lib/monitoring", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

import { BEATS, INTRO_HOLD_SECONDS, INTRO_SECONDS, STORY_END } from "./beats";
import { REEL_FPS, TOUR_FRAMES, reelSources, tourTime } from "./reel";
import StoryReel, { tourSeekTime, type StoryReelProps } from "./StoryReel";
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
    expect(reel.tour.getAttribute("src")).toBe(reelSources("flight", "wide", "av1").tour);
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
