import { describe, expect, it } from "vitest";
import { flapWeights } from "@/lib/sawad/wind";
import { planLife, routeLength, samplePath, type BirdFlock, type MovingCar, type Walker } from "./landscape";
import { CLIP_GROUND_SPEED, TIME_SCALE_RANGE, birdSlots, birdWings, carPose, clipTimeScale, walkerPose, wheelAngle, wheelRadius } from "./lifeMotion";

const line = (len: number) => ({ points: [[0, 1, 0], [len, 1, 0]] as Array<[number, number, number]>, closed: false });

describe("clipTimeScale", () => {
  it("plays a walk at its authored rate when the walker moves at the clip's own ground speed", () => {
    expect(clipTimeScale("walk", CLIP_GROUND_SPEED.walk!, 1)).toBeCloseTo(1);
    expect(clipTimeScale("run", CLIP_GROUND_SPEED.run!, 1)).toBeCloseTo(1);
  });

  it("speeds the legs up for a smaller figure covering the same ground", () => {
    expect(clipTimeScale("run", 2.3, 0.68)).toBeGreaterThan(clipTimeScale("run", 2.3, 1));
  });

  it("stays within a believable range", () => {
    expect(clipTimeScale("walk", 0.1, 1)).toBe(TIME_SCALE_RANGE.min);
    expect(clipTimeScale("walk", 10, 1)).toBe(TIME_SCALE_RANGE.max);
  });

  it("leaves clips that stay in place, and people standing still, at their authored rate", () => {
    expect(clipTimeScale("swing", 0, 1)).toBe(1);
    expect(clipTimeScale("idle", 2, 1)).toBe(1);
    expect(clipTimeScale("walk", 0, 1)).toBe(1);
  });

  it("keeps every walker on the plan inside the range", () => {
    for (const w of planLife("high").walkers) {
      const k = clipTimeScale(w.clip, w.speed, w.scale);
      expect(k).toBeGreaterThanOrEqual(TIME_SCALE_RANGE.min);
      expect(k).toBeLessThanOrEqual(TIME_SCALE_RANGE.max);
    }
  });
});

describe("walkerPose", () => {
  const walker = (speed: number, heading = 0.5): Walker => ({ id: "w", asset: "person-man-shirt", clip: "walk", speed, scale: 1, phase: 2, route: line(100), heading });

  it("walks along the route from its phase", () => {
    const p = walkerPose(walker(1.5), 4);
    expect(p.x).toBeCloseTo((2 + 4) * 1.5);
    expect(p.y).toBe(1);
    expect(p.heading).toBeCloseTo(Math.PI / 2); // facing +x
  });

  it("stands at the start of its route facing its own heading when it does not move", () => {
    expect(walkerPose(walker(0, 1.2), 30)).toEqual({ x: 0, y: 1, z: 0, heading: 1.2 });
  });

  it("turns round at the end of an open route", () => {
    const p = walkerPose(walker(1), 110); // 112 m along a 100 m route: 12 m back from the end
    expect(p.x).toBeCloseTo(88);
    expect(Math.sin(p.heading)).toBeCloseTo(-1); // facing -x, back the way it came
  });
});

describe("carPose", () => {
  it("drives along its route and reports the distance covered", () => {
    const car: MovingCar = { id: "c", asset: "car-sedan", tint: "#fff", speed: 10, phase: 1, route: { ...line(500), closed: true } };
    const p = carPose(car, 3);
    expect(p.distance).toBeCloseTo(40);
    expect(p.x).toBeCloseTo(samplePath(car.route, 40).x);
  });

  it("keeps the plan's cars on their loops", () => {
    for (const car of planLife("high").moving) {
      const p = carPose(car, 1000);
      expect(Number.isFinite(p.x + p.z + p.heading)).toBe(true);
      expect(routeLength(car.route)).toBeGreaterThan(0);
    }
  });
});

describe("wheels", () => {
  it("turns a wheel one radian per radius of road", () => {
    expect(wheelAngle(0.32, 0.32)).toBeCloseTo(1);
    expect(wheelAngle(2 * Math.PI * 0.32, 0.32)).toBeCloseTo(2 * Math.PI);
  });

  it("does not turn a wheel it could not measure", () => {
    expect(wheelAngle(10, 0)).toBe(0);
  });

  it("measures the radius from the wheel's height", () => {
    expect(wheelRadius(0.01, 0.65)).toBeCloseTo(0.32);
    expect(wheelRadius(1, 0)).toBe(0);
  });
});

describe("birds", () => {
  const flock = (id: string, count: number): BirdFlock => ({ id, count, cx: 0, cz: 0, rx: 50, rz: 20, altitude: 10, speed: 6, clockwise: false });

  it("lists every bird of every flock once", () => {
    const slots = birdSlots([flock("a", 3), flock("b", 2)]);
    expect(slots.map((s) => `${s.flock.id}${s.index}`)).toEqual(["a0", "a1", "a2", "b0", "b1"]);
  });

  it("keeps a flock out of step: each bird has its own flap phase", () => {
    const slots = birdSlots([flock("a", 12)]);
    for (const s of slots) {
      expect(s.phase).toBeGreaterThanOrEqual(0);
      expect(s.phase).toBeLessThan(1);
    }
    expect(new Set(slots.map((s) => s.phase.toFixed(4))).size).toBe(12);
    expect(birdWings(slots[3], 0.7)).toEqual(flapWeights(0.7, slots[3].phase));
  });

  it("matches the plan's bird count", () => {
    const flocks = planLife("low").flocks;
    expect(birdSlots(flocks)).toHaveLength(flocks.reduce((n, f) => n + f.count, 0));
  });
});
