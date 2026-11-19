import { describe, expect, it } from "vitest";
import { CLICK_TOLERANCE_PX, DISTANCE, FLY_SECONDS, GROUND_CLEARANCE, MAX_FRAME_SECONDS, TARGET_BOUNDS, clampTarget, flightPose, keepAboveGround, markerPose, zoomPose } from "./flight";
import type { CameraPose } from "./viewpoints";

const from: CameraPose = { position: [0, 10, 0], target: [0, 0, -50], fov: 40 };
const to: CameraPose = { position: [400, 10, 0], target: [300, 0, -50], fov: 56 };
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("flightPose", () => {
  it("starts and ends exactly on the two poses", () => {
    expect(flightPose(from, to, 0)).toEqual(from);
    expect(flightPose(from, to, 1)).toEqual(to);
    expect(flightPose(from, to, 7)).toEqual(to); // past the end stays at the end
  });

  it("eases out: most of the distance is covered early", () => {
    const early = flightPose(from, to, 0.25);
    expect(early.position[0]).toBeGreaterThan(300);
    expect(early.fov).toBeGreaterThan(40);
    expect(early.fov).toBeLessThan(56);
  });

  it("arcs upward on long moves, at most 60 m, and barely at all on short ones", () => {
    let highest = 0;
    for (let t = 0; t <= 1; t += 0.01) highest = Math.max(highest, flightPose(from, to, t).position[1]);
    expect(highest).toBeGreaterThan(10 + 30);
    expect(highest).toBeLessThanOrEqual(10 + 60);
    const near: CameraPose = { ...from, position: [2, 10, 0] };
    let lift = 0;
    for (let t = 0; t <= 1; t += 0.01) lift = Math.max(lift, flightPose(from, near, t).position[1] - 10);
    expect(lift).toBeLessThan(0.5);
  });
});

describe("zoomPose", () => {
  const pose: CameraPose = { position: [0, 0, 100], target: [0, 0, 0], fov: 40 };

  it("steps 30 % closer or the same step back, keeping target and lens", () => {
    const closer = zoomPose(pose, 1);
    expect(closer.position[2]).toBeCloseTo(70);
    expect(closer.target).toEqual(pose.target);
    expect(closer.fov).toBe(40);
    expect(zoomPose(closer, -1).position[2]).toBeCloseTo(100);
  });

  it("stops at the orbit limits", () => {
    expect(dist(zoomPose({ ...pose, position: [0, 0, 8] }, 1).position, pose.target)).toBeCloseTo(DISTANCE.min);
    expect(dist(zoomPose({ ...pose, position: [0, 0, 700] }, -1).position, pose.target)).toBeCloseTo(DISTANCE.max);
  });

  it("copes with a camera sitting on its target", () => {
    const stuck = zoomPose({ ...pose, position: [0, 0, 0] }, 1);
    expect(stuck.position.every(Number.isFinite)).toBe(true);
  });
});

describe("markerPose", () => {
  it("backs off 62 m along the current viewing direction and looks just below the marker", () => {
    const pose = markerPose([100, 20, -30], [0, 150, -30], [50, 0, -30], 46);
    // The camera was west of its pivot, so it ends up west of the marker.
    expect(pose.position[0]).toBeCloseTo(100 - 62);
    expect(pose.position[2]).toBeCloseTo(-30);
    expect(pose.position[1]).toBe(50); // 30 m above the marker
    expect(pose.target).toEqual([100, 16, -30]);
    expect(pose.fov).toBe(46);
  });

  it("never drops below the roofs for a low marker", () => {
    expect(markerPose([0, 2, 0], [-50, 80, -50], [0, 0, 0], 46).position[1]).toBe(34);
  });

  it("picks a diagonal when the camera is straight above its pivot", () => {
    const pose = markerPose([0, 10, 0], [5, 300, 5.5], [5, 0, 5], 46);
    expect(pose.position[0]).toBeCloseTo(-62 / Math.SQRT2);
    expect(pose.position[2]).toBeCloseTo(-62 / Math.SQRT2);
  });
});

describe("clampTarget", () => {
  it("keeps the orbit target inside the site, in place", () => {
    const target = { x: 9999, y: -100, z: -9999 };
    expect(clampTarget(target)).toBe(target);
    expect(target).toEqual({ x: TARGET_BOUNDS.maxX, y: TARGET_BOUNDS.minY, z: TARGET_BOUNDS.minZ });
    expect(clampTarget({ x: 10, y: 5, z: -20 })).toEqual({ x: 10, y: 5, z: -20 });
    expect(clampTarget({ x: -9999, y: 999, z: 9999 })).toEqual({ x: TARGET_BOUNDS.minX, y: TARGET_BOUNDS.maxY, z: TARGET_BOUNDS.maxZ });
  });
});

describe("keepAboveGround", () => {
  const hill = (x: number) => Math.max(0, x * 0.12); // a slope rising 12 m per 100 m
  it("lifts a camera dragged into the hillside back above it, in place", () => {
    const p = { x: 200, y: 10, z: 0 };
    expect(keepAboveGround(p, hill)).toBe(true);
    expect(p.y).toBeCloseTo(24 + GROUND_CLEARANCE);
  });

  it("leaves a camera that is clear of the ground alone, including one at eye level", () => {
    const p = { x: 0, y: 1.7, z: 0 };
    expect(keepAboveGround(p, hill)).toBe(false);
    expect(p.y).toBe(1.7);
  });
});

describe("timing constants", () => {
  it("keeps flights short, clicks tight and frames bounded", () => {
    expect(FLY_SECONDS).toBe(1.2);
    expect(CLICK_TOLERANCE_PX).toBe(6);
    expect(MAX_FRAME_SECONDS).toBe(0.1);
  });
});
