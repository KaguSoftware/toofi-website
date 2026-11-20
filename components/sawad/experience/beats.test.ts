import { describe, expect, it } from "vitest";
import { approach, BEATS, beatAt, HEAD_MAX_SPEED, INTRO_SECONDS, scrollToPosition, STORY_END } from "./beats";

describe("BEATS", () => {
  it("run contiguously from the end of the intro to the end of the story", () => {
    expect(BEATS[0].from).toBe(INTRO_SECONDS);
    expect(BEATS.at(-1)!.to).toBe(STORY_END);
    for (let i = 1; i < BEATS.length; i++) expect(BEATS[i].from).toBe(BEATS[i - 1].to);
    for (const b of BEATS) {
      expect(b.at).toBeGreaterThan(b.from);
      expect(b.at).toBeLessThanOrEqual(b.to);
    }
  });
});

describe("beatAt", () => {
  it("is the intro before the gate and each beat from its start", () => {
    expect(beatAt(0)).toBe("intro");
    expect(beatAt(INTRO_SECONDS - 0.01)).toBe("intro");
    expect(beatAt(INTRO_SECONDS)).toBe("entrance");
    expect(beatAt(24.99)).toBe("entrance");
    expect(beatAt(25)).toBe("boulevard");
    expect(beatAt(40)).toBe("villa");
    expect(beatAt(57)).toBe("amenities");
    expect(beatAt(73)).toBe("aerial");
  });

  it("stays on the last beat at and past the end", () => {
    expect(beatAt(STORY_END)).toBe("aerial");
    expect(beatAt(1000)).toBe("aerial");
  });
});

describe("scrollToPosition", () => {
  it("starts at the intro's end and puts each beat's shot at panel k of 5", () => {
    expect(scrollToPosition(0)).toBe(INTRO_SECONDS);
    BEATS.forEach((b, i) => expect(scrollToPosition((i + 1) / 5)).toBeCloseTo(b.at, 9));
    expect(scrollToPosition(1)).toBe(STORY_END);
  });

  it("is monotonic", () => {
    let prev = -Infinity;
    for (let s = 0; s <= 1; s += 0.01) {
      const p = scrollToPosition(s);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it("clamps out-of-range progress and survives NaN", () => {
    expect(scrollToPosition(-3)).toBe(INTRO_SECONDS);
    expect(scrollToPosition(7)).toBe(STORY_END);
    expect(scrollToPosition(NaN)).toBe(INTRO_SECONDS);
    expect(scrollToPosition(Infinity)).toBe(INTRO_SECONDS);
  });

  it("glides linearly between two shots", () => {
    expect(scrollToPosition(0.1)).toBeCloseTo((INTRO_SECONDS + BEATS[0].at) / 2, 9);
  });
});

describe("approach", () => {
  it("is a no-op for dt <= 0", () => {
    expect(approach(3, 10, 0)).toBe(3);
    expect(approach(3, 10, -1)).toBe(3);
  });

  it("snaps to the goal when already there", () => {
    expect(approach(5, 5.00001, 0.016)).toBe(5.00001);
  });

  it("converges without overshooting, in either direction", () => {
    for (const [from, goal] of [[0, 3], [3, 0]]) {
      let head = from;
      for (let i = 0; i < 600; i++) {
        const next = approach(head, goal, 1 / 60);
        expect(Math.abs(goal - next)).toBeLessThanOrEqual(Math.abs(goal - head));
        expect((next - goal) * (from - goal)).toBeGreaterThanOrEqual(0);
        head = next;
      }
      expect(head).toBeCloseTo(goal, 3);
    }
  });

  it("never moves faster than the top speed", () => {
    expect(approach(0, 1000, 0.5)).toBeCloseTo(HEAD_MAX_SPEED * 0.5, 9);
    expect(approach(0, -1000, 0.5)).toBeCloseTo(-HEAD_MAX_SPEED * 0.5, 9);
    expect(approach(0, 1000, 0.5, 3.2, 1)).toBeCloseTo(0.5, 9);
  });

  it("eases a small gap at the given rate", () => {
    expect(approach(0, 0.1, 0.1, 2)).toBeCloseTo(0.1 * (1 - Math.exp(-0.2)), 9);
  });
});
