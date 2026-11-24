import { describe, expect, it } from "vitest";
import { approach, BEATS, beatAt, HEAD_MAX_SPEED, HEAD_RATE, glide, GLIDE_MIN_SPEED, GLIDE_SECONDS, INTRO_SECONDS, scrollToPosition, STORY_END } from "./beats";

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

  it("keeps gliding after the scroll stops, and settles within about a second", () => {
    // The scroll stops 1 unit ahead of the playhead: it must not snap there in a frame or two.
    let head = 0;
    head = approach(head, 1, 1 / 60);
    expect(head).toBeLessThan(0.15);
    expect(HEAD_RATE).toBeLessThanOrEqual(10);
    for (let i = 1; i < 60; i++) head = approach(head, 1, 1 / 60);
    expect(1 - head).toBeLessThan(0.01);
  });

  it("eases a small gap at the given rate", () => {
    expect(approach(0, 0.1, 0.1, 2)).toBeCloseTo(0.1 * (1 - Math.exp(-0.2)), 9);
  });
});

describe("glide", () => {
  const run = (state: { head: number; speed: number }, goal: number, seconds: number, dt = 1 / 60) => {
    const path = [state];
    for (let t = 0; t < seconds - 1e-9; t += dt) path.push((state = glide(state, goal, dt)));
    return path;
  };
  const speeds = (path: Array<{ head: number }>, dt = 1 / 60) => path.slice(1).map((s, i) => (s.head - path[i].head) / dt);

  it("eases away from rest, with no jump in speed", () => {
    const v = speeds(run({ head: 20, speed: 0 }, 30, 1));
    // The first frame moves far less than the fastest one: it gathers speed.
    expect(v[0]).toBeLessThan(Math.max(...v) * 0.35);
    for (let i = 1; i < v.length; i++) expect(Math.abs(v[i] - v[i - 1])).toBeLessThan(Math.max(...v) * 0.35);
  });

  it("slows along a curve to a stop when the scroll stops, never passing it, and is at rest soon after", () => {
    const path = run({ head: 20, speed: 12 }, 26, GLIDE_SECONDS * 4);
    const v = speeds(path);
    const top = v.indexOf(Math.max(...v));
    // Slower every frame from its fastest down to the least speed, and shedding less and less of it.
    const falling = v.slice(top).filter((x) => x > GLIDE_MIN_SPEED * 1.5);
    for (let i = 1; i < falling.length; i++) expect(falling[i]).toBeLessThanOrEqual(falling[i - 1] + 1e-6);
    expect(falling[0] - falling[5]).toBeGreaterThan(falling[falling.length - 6] - falling[falling.length - 1]);
    expect(Math.max(...path.map((s) => s.head))).toBeLessThanOrEqual(26);
    expect(path[path.length - 1]).toEqual({ head: 26, speed: 0 });
  });

  it("does not creep: it goes no slower than its least speed until it stops", () => {
    const v = speeds(run({ head: 20, speed: 5 }, 22, 2));
    const moving = v.filter((x) => x > 1e-6);
    // The last frame of all may be a part of one.
    for (const x of moving.slice(0, -1).slice(-20)) expect(x).toBeGreaterThanOrEqual(GLIDE_MIN_SPEED - 1e-6);
  });

  it("is the same glide at 30, 60 and 120 frames a second", () => {
    const at = [30, 60, 120].map((fps) => run({ head: 20, speed: 0 }, 60, 0.5, 1 / fps).at(-1)!.head);
    for (const h of at) expect(h).toBeCloseTo(at[0], 3);
  });

  it("turns round smoothly when the scroll does", () => {
    const path = run({ head: 30, speed: 20 }, 25, 2);
    const v = speeds(path);
    // Still going the old way at first, then back, and home.
    expect(v[0]).toBeGreaterThan(0);
    expect(Math.min(...v)).toBeLessThan(0);
    expect(path[path.length - 1].head).toBe(25);
  });

  it("goes no faster than its top speed, stands still at its goal, and ignores an empty step", () => {
    expect(glide({ head: 14, speed: 0 }, 86, 0.1, 0.01).head).toBeLessThanOrEqual(14 + HEAD_MAX_SPEED * 0.1 + 1e-9);
    expect(glide({ head: 40, speed: 3 }, 40, 1 / 60)).toEqual({ head: 40, speed: 0 });
    const state = { head: 20, speed: 4 };
    expect(glide(state, 30, 0)).toBe(state);
  });
});
