import { describe, expect, it } from "vitest";
import { planVillas } from "../scene/layout";
import { siteFor } from "../scene/site";
import {
  blocked,
  EYE_HEIGHT,
  emptyInput,
  keysToMove,
  LOOK_SPEED,
  PITCH_LIMIT,
  RUN_SPEED,
  stepWalk,
  WALK_FOV,
  WALK_HOME,
  WALK_SPEED,
  walkPose,
  walkStart,
  type WalkInput,
  type WalkState,
} from "./walk";

const site = siteFor("zaitun");
const stand = (x: number, z: number, yaw = 0): WalkState => ({ x, y: site.ground(x, z) + EYE_HEIGHT, z, yaw, pitch: 0, vx: 0, vz: 0 });
const input = (patch: Partial<WalkInput> & { move?: { x: number; y: number } }): WalkInput => ({ ...emptyInput(), ...patch });

/** Steps for `seconds` at 60 Hz. */
function run(from: WalkState, inp: WalkInput, seconds: number): WalkState {
  let s = from;
  for (let i = 0; i < seconds * 60; i++) s = stepWalk(s, inp, 1 / 60);
  return s;
}

describe("blocked", () => {
  it("blocks outside the walls", () => {
    expect(blocked(-600, 0)).toBe(true);
    expect(blocked(0, 500)).toBe(true);
  });

  it("blocks inside a villa and frees the garden walk", () => {
    const v = planVillas()[0];
    expect(blocked(v.x, v.z)).toBe(true);
    expect(blocked(WALK_HOME.x, WALK_HOME.z)).toBe(false);
  });
});

describe("stepWalk", () => {
  it("walks forward along the heading at WALK_SPEED once settled", () => {
    const s = run(stand(0, -16, 0), input({ move: { x: 0, y: 1 } }), 1);
    expect(s.z).toBeLessThan(-16);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(WALK_SPEED, 1);
    expect(Math.abs(s.vx)).toBeLessThan(1e-6);
  });

  it("follows the yaw, turned right it goes toward +x", () => {
    const s = run(stand(0, -16, Math.PI / 2), input({ move: { x: 0, y: 1 } }), 1);
    expect(s.x).toBeGreaterThan(0);
    expect(Math.abs(s.z + 16)).toBeLessThan(0.01);
  });

  it("runs faster than it walks", () => {
    const walk = run(stand(0, -16), input({ move: { x: 0, y: 1 } }), 1);
    const sprint = run(stand(0, -16), input({ move: { x: 0, y: 1 }, run: true }), 1);
    expect(Math.hypot(sprint.vx, sprint.vz)).toBeCloseTo(RUN_SPEED, 1);
    expect(sprint.z).toBeLessThan(walk.z);
  });

  it("does not move faster diagonally", () => {
    const s = run(stand(0, -16), input({ move: { x: 1, y: 1 } }), 1);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(WALK_SPEED, 1);
  });

  it("turns by look deltas, dragging right turns left, and clamps the pitch", () => {
    const s = stepWalk(stand(0, -16, 1), input({ look: { dx: 100, dy: 0 } }), 1 / 60);
    expect(s.yaw).toBeCloseTo(1 - 100 * LOOK_SPEED, 9);
    const up = stepWalk(stand(0, -16), input({ look: { dx: 0, dy: 1e6 } }), 1 / 60);
    expect(up.pitch).toBe(PITCH_LIMIT);
    const down = stepWalk(stand(0, -16), input({ look: { dx: 0, dy: -1e6 } }), 1 / 60);
    expect(down.pitch).toBe(-PITCH_LIMIT);
  });

  it("slides along a wall instead of stopping", () => {
    const edge = 430 - 2; // the site's east wall, kept EDGE away
    const start = stand(edge - 0.5, -16, Math.PI / 4); // heading north-east: +x and -z
    const s = run(start, input({ move: { x: 0, y: 1 } }), 1);
    expect(s.x).toBeLessThan(edge);
    expect(s.z).toBeLessThan(start.z - 1);
  });

  it("never enters a blocked cell", () => {
    const v = planVillas()[0];
    let s = stand(v.x, v.z + v.depth / 2 + 8, 0);
    s.yaw = v.z < s.z ? 0 : Math.PI; // face the villa
    for (let i = 0; i < 600; i++) {
      s = stepWalk(s, input({ move: { x: 0, y: 1 }, run: true }), 1 / 60);
      expect(blocked(s.x, s.z)).toBe(false);
    }
  });

  it("keeps the eye above the ground", () => {
    const s = run(stand(0, -16), input({ move: { x: 0, y: 1 } }), 2);
    expect(s.y).toBeGreaterThan(site.ground(s.x, s.z) + EYE_HEIGHT - 0.2);
    expect(s.y).toBeLessThan(site.ground(s.x, s.z) + EYE_HEIGHT + 0.2);
  });
});

describe("walkPose", () => {
  it("looks 10 m ahead along the heading from the eye", () => {
    const pose = walkPose({ x: 1, y: 5, z: 2, yaw: 0, pitch: 0, vx: 0, vz: 0 });
    expect(pose.position).toEqual([1, 5, 2]);
    expect(pose.fov).toBe(WALK_FOV);
    expect(pose.target[0]).toBeCloseTo(1, 9);
    expect(pose.target[1]).toBeCloseTo(5, 9);
    expect(pose.target[2]).toBeCloseTo(-8, 9);
  });

  it("tilts the target with pitch", () => {
    const pose = walkPose({ x: 0, y: 0, z: 0, yaw: Math.PI / 2, pitch: Math.PI / 6, vx: 0, vz: 0 });
    expect(pose.target[1]).toBeCloseTo(5, 9);
    expect(pose.target[0]).toBeCloseTo(10 * Math.cos(Math.PI / 6), 9);
  });
});

describe("walkStart", () => {
  it("starts on the spot when it is free, at eye height, facing the way the camera faced", () => {
    const s = walkStart([0, 0, -16], [1, 0, 0]);
    expect([s.x, s.z]).toEqual([0, -16]);
    expect(s.y).toBeCloseTo(site.ground(0, -16) + EYE_HEIGHT, 9);
    expect(s.yaw).toBeCloseTo(Math.PI / 2, 9);
    expect(s.pitch).toBe(0);
  });

  it("finds free ground near a blocked point", () => {
    const v = planVillas()[0];
    const s = walkStart([v.x, 5, v.z], [0, 0, -1]);
    expect(blocked(s.x, s.z)).toBe(false);
    expect(Math.hypot(s.x - v.x, s.z - v.z)).toBeLessThan(80);
  });

  it("falls back to the garden walk far outside the site", () => {
    const s = walkStart([5000, 0, 5000], [0, 0, -1]);
    expect([s.x, s.z, s.yaw]).toEqual([WALK_HOME.x, WALK_HOME.z, WALK_HOME.yaw]);
  });
});

describe("keysToMove", () => {
  it("maps arrows and WASD", () => {
    expect(keysToMove(new Set(["KeyW"]))).toEqual({ x: 0, y: 1 });
    expect(keysToMove(new Set(["ArrowDown", "ArrowRight"]))).toEqual({ x: 1, y: -1 });
    expect(keysToMove(new Set(["KeyA"]))).toEqual({ x: -1, y: 0 });
  });

  it("cancels opposite keys and is still when idle", () => {
    expect(keysToMove(new Set(["KeyW", "ArrowDown"]))).toEqual({ x: 0, y: 0 });
    expect(keysToMove(new Set(["KeyA", "ArrowRight"]))).toEqual({ x: 0, y: 0 });
    expect(keysToMove(new Set())).toEqual({ x: 0, y: 0 });
  });
});
