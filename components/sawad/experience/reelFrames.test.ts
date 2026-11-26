import { describe, expect, it, vi } from "vitest";
import { INTRO_SECONDS, STORY_END } from "./beats";
import { FrameCache, MIX_EPSILON, frameTime, framePair, missingFrame, tourFrameAt } from "./reelFrames";
import { REEL_FPS, TOUR_FRAMES, TOUR_FRAMES_PER_UNIT, tourPosition } from "./reel";

describe("tourFrameAt", () => {
  it("is the fractional frame of the tour file a sequence position falls on", () => {
    expect(tourFrameAt(INTRO_SECONDS)).toBe(0);
    expect(tourFrameAt(INTRO_SECONDS + 1)).toBeCloseTo(TOUR_FRAMES_PER_UNIT);
    expect(tourFrameAt(INTRO_SECONDS + 1.5)).toBeCloseTo(1.5 * TOUR_FRAMES_PER_UNIT);
    expect(tourFrameAt(STORY_END)).toBe(TOUR_FRAMES);
    for (const k of [0, 1, 333, TOUR_FRAMES]) expect(tourFrameAt(tourPosition(k))).toBeCloseTo(k, 6);
  });

  it("stays within the file, and takes anything before the gate for the gate", () => {
    expect(tourFrameAt(0)).toBe(0);
    expect(tourFrameAt(-5)).toBe(0);
    expect(tourFrameAt(STORY_END + 40)).toBe(TOUR_FRAMES);
    expect(tourFrameAt(Number.NaN)).toBe(0);
  });
});

describe("frameTime", () => {
  it("is the middle of the frame", () => {
    expect(frameTime(0)).toBeCloseTo(0.5 / REEL_FPS);
    expect(frameTime(30)).toBeCloseTo(30.5 / REEL_FPS);
    expect(frameTime(TOUR_FRAMES)).toBeCloseTo((TOUR_FRAMES + 0.5) / REEL_FPS);
  });
});

describe("framePair", () => {
  it("is the frame below and the frame above, with how far between them", () => {
    const pair = framePair(10.25);
    expect(pair.base).toBe(10);
    expect(pair.next).toBe(11);
    expect(pair.mix).toBeCloseTo(0.25);
  });

  it("is one frame alone when the playhead is within the epsilon of a whole frame", () => {
    expect(framePair(10)).toEqual({ base: 10, next: null, mix: 0 });
    expect(framePair(10 + MIX_EPSILON / 2)).toEqual({ base: 10, next: null, mix: 0 });
    // Just short of the next frame: that frame, alone.
    expect(framePair(11 - MIX_EPSILON / 2)).toEqual({ base: 11, next: null, mix: 0 });
    // Just outside the epsilon: a blend.
    expect(framePair(10 + MIX_EPSILON * 2).next).toBe(11);
    expect(framePair(11 - MIX_EPSILON * 2).next).toBe(11);
  });

  it("never reaches past the file, and takes anything that is not a number for the first frame", () => {
    expect(framePair(TOUR_FRAMES)).toEqual({ base: TOUR_FRAMES, next: null, mix: 0 });
    expect(framePair(TOUR_FRAMES - 0.5).next).toBe(TOUR_FRAMES);
    expect(framePair(TOUR_FRAMES + 10)).toEqual({ base: TOUR_FRAMES, next: null, mix: 0 });
    expect(framePair(-3)).toEqual({ base: 0, next: null, mix: 0 });
    expect(framePair(Number.NaN)).toEqual({ base: 0, next: null, mix: 0 });
    expect(framePair(Infinity)).toEqual({ base: 0, next: null, mix: 0 });
  });
});

describe("missingFrame", () => {
  const pair = { base: 5, next: 6, mix: 0.5 };
  it("asks for the base first, then the next, then nothing", () => {
    expect(missingFrame(pair, () => false)).toBe(5);
    expect(missingFrame(pair, (f) => f === 6)).toBe(5);
    expect(missingFrame(pair, (f) => f === 5)).toBe(6);
    expect(missingFrame(pair, () => true)).toBeNull();
  });

  it("has nothing to ask for beyond a lone frame", () => {
    expect(missingFrame({ base: 5, next: null, mix: 0 }, (f) => f === 5)).toBeNull();
    expect(missingFrame({ base: 5, next: null, mix: 0 }, () => false)).toBe(5);
  });
});

describe("FrameCache", () => {
  const surfaces = () => {
    let n = 0;
    return vi.fn(() => ({ id: ++n }));
  };

  it("makes a surface for each frame while there is room, and gives the same one back", () => {
    const make = surfaces();
    const cache = new FrameCache(make, 3);
    expect(cache.count).toBe(0);
    const a = cache.slot(10, 10);
    const b = cache.slot(11, 10);
    expect(a).not.toBe(b);
    expect(cache.count).toBe(2);
    expect(cache.has(10) && cache.has(11) && !cache.has(12)).toBe(true);
    expect(cache.get(10)).toBe(a);
    expect(cache.get(12)).toBeUndefined();
    // A frame already held keeps its surface.
    expect(cache.slot(10, 10)).toBe(a);
    expect(make).toHaveBeenCalledTimes(2);
    expect(cache.count).toBe(2);
  });

  it("reuses the surface of the held frame farthest from the playhead once it is full", () => {
    const make = surfaces();
    const cache = new FrameCache(make, 4);
    const held = [10, 11, 12, 20].map((f) => cache.slot(f, 11));
    expect(cache.count).toBe(4);
    const reused = cache.slot(13, 12);
    expect(reused).toBe(held[3]);
    expect(cache.has(20)).toBe(false);
    expect(cache.get(13)).toBe(held[3]);
    expect(cache.count).toBe(4);
    // Scrolling the other way: now the low end is farthest.
    expect(cache.slot(30, 12)).toBe(held[0]);
    expect(cache.has(10)).toBe(false);
    expect(make).toHaveBeenCalledTimes(4);
  });

  it("holds four frames unless told otherwise", () => {
    const make = surfaces();
    const cache = new FrameCache(make);
    for (let f = 0; f < 10; f++) cache.slot(f, f);
    expect(cache.count).toBe(4);
    expect(make).toHaveBeenCalledTimes(4);
    // The four nearest the last playhead are the ones kept.
    expect([6, 7, 8, 9].every((f) => cache.has(f))).toBe(true);
  });

  it("names the held frame nearest to a frame, or none when empty", () => {
    const cache = new FrameCache(surfaces(), 4);
    expect(cache.nearest(5)).toBeNull();
    cache.slot(10, 10);
    cache.slot(20, 10);
    expect(cache.nearest(11)).toBe(10);
    expect(cache.nearest(18)).toBe(20);
    expect(cache.nearest(10)).toBe(10);
    expect(cache.nearest(1000)).toBe(20);
  });
});
