import { describe, expect, it } from "vitest";
import { approach, BEATS, beatAt, follow, HEAD_MAX_SPEED, HEAD_RATE, glide, GLIDE_MIN_SPEED, GLIDE_SECONDS, INTRO_SECONDS, REEL_SMOOTH_SECONDS, scrollToPosition, STORY_END } from "./beats";

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

describe("follow", () => {
  type State = { head: number; velocity: number };
  const DT = 1 / 60;
  /** Steps a state toward a goal that may move (a function of time), returning every state on the way. */
  const run = (start: State, goal: number | ((t: number) => number), seconds: number, dt = DT): State[] => {
    const path = [start];
    let state = start;
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      state = follow(state.head, state.velocity, typeof goal === "number" ? goal : goal(t + dt), dt);
      path.push(state);
    }
    return path;
  };
  const speeds = (path: State[], dt = DT) => path.slice(1).map((s, i) => (s.head - path[i].head) / dt);

  it("changes nothing for a step of zero or less", () => {
    expect(follow(20, 4, 30, 0)).toEqual({ head: 20, velocity: 4 });
    expect(follow(20, 4, 30, -1)).toEqual({ head: 20, velocity: 4 });
    expect(follow(20, 4, 30, Number.NaN)).toEqual({ head: 20, velocity: 4 });
  });

  it("eases in from rest, with no overshoot in either direction", () => {
    for (const goal of [30, 10]) {
      const path = run({ head: 20, velocity: 0 }, goal, 3);
      const first = Math.abs(path[1].head - 20);
      expect(first).toBeGreaterThan(0);
      // Its first step is smaller than the plain ease's.
      expect(first).toBeLessThan(Math.abs(approach(20, goal, DT) - 20));
      for (const s of path) expect((s.head - goal) * Math.sign(20 - goal)).toBeGreaterThanOrEqual(-1e-9);
      expect(path.at(-1)).toEqual({ head: goal, velocity: 0 });
    }
  });

  it("coasts on after a steady scroll stops, slowing to rest on the goal", () => {
    const rate = 10; // sequence seconds a second
    const scrolled = run({ head: 20, velocity: 0 }, (t) => 20 + rate * t, 2);
    const end = scrolled.at(-1)!;
    const goal = 20 + rate * 2;
    // The scroll stops here. The playhead is behind and still moving 0.1 s later.
    expect(end.head).toBeLessThan(goal);
    const rest = run(end, goal, 3);
    expect(rest[Math.round(0.1 / DT)].velocity).toBeGreaterThan(1);
    const v = rest.map((s) => s.velocity);
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeLessThanOrEqual(v[i - 1] + 1e-9);
    expect(rest.every((s) => s.head <= goal)).toBe(true);
    expect(rest.at(-1)).toEqual({ head: goal, velocity: 0 });
  });

  it("trails a steady scroll by about the smoothing time times its speed", () => {
    for (const rate of [2, 10, 40]) {
      const path = run({ head: 20, velocity: 0 }, (t) => 20 + rate * t, 3);
      const lag = 20 + rate * 3 - path.at(-1)!.head;
      expect(lag).toBeCloseTo(REEL_SMOOTH_SECONDS * rate, 0);
      expect(Math.abs(lag - REEL_SMOOTH_SECONDS * rate)).toBeLessThan(0.1 * REEL_SMOOTH_SECONDS * rate + 0.05);
    }
  });

  it("goes no faster than its top speed, and catches up with a flick through the whole story", () => {
    const path = run({ head: 14, velocity: 0 }, 86, 4);
    for (const s of speeds(path)) expect(Math.abs(s)).toBeLessThanOrEqual(HEAD_MAX_SPEED + 1e-9);
    for (const s of path) expect(Math.abs(s.velocity)).toBeLessThanOrEqual(HEAD_MAX_SPEED + 1e-9);
    expect(Math.abs(86 - path[Math.round(1.5 / DT)].head)).toBeLessThan(0.5);
    expect(path[Math.round(3 / DT)]).toEqual({ head: 86, velocity: 0 });
    // And backwards, the same.
    const back = run({ head: 86, velocity: 0 }, 14, 4);
    for (const s of speeds(back)) expect(Math.abs(s)).toBeLessThanOrEqual(HEAD_MAX_SPEED + 1e-9);
    expect(back[Math.round(3 / DT)]).toEqual({ head: 14, velocity: 0 });
  });

  it("rests on the goal once it is within a hair of it and nearly still", () => {
    expect(follow(40, 0, 40, DT)).toEqual({ head: 40, velocity: 0 });
    expect(follow(40 - 5e-5, 5e-3, 40, DT)).toEqual({ head: 40, velocity: 0 });
  });

  it("stops on the goal rather than passing it, even from a fast run", () => {
    const next = follow(29.9, 90, 30, 0.1);
    expect(next).toEqual({ head: 30, velocity: 0 });
  });

  it("turns round smoothly when the scroll does", () => {
    const path = run({ head: 30, velocity: 20 }, 25, 3);
    const v = speeds(path);
    expect(v[0]).toBeGreaterThan(0);
    expect(path.at(-1)).toEqual({ head: 25, velocity: 0 });
  });

  it("honours its own smoothing time and top speed", () => {
    let fast = { head: 0, velocity: 0 };
    let loose = { head: 0, velocity: 0 };
    for (let i = 0; i < 30; i++) {
      fast = follow(fast.head, fast.velocity, 10, DT, 0.1);
      loose = follow(loose.head, loose.velocity, 10, DT, 0.6);
    }
    expect(fast.head).toBeGreaterThan(loose.head);
    const capped = follow(0, 0, 100, 0.05, 0.3, 5);
    expect(capped.head).toBeLessThanOrEqual(5 * 0.3);
    expect(Math.abs(capped.velocity)).toBeLessThanOrEqual(5);
  });

  it("survives a smoothing time of zero", () => {
    const next = follow(0, 0, 10, DT, 0);
    expect(Number.isFinite(next.head) && Number.isFinite(next.velocity)).toBe(true);
  });
});
