import { PLAN_SITE, planAmenities, planApartmentBlocks, planVillas, type Rect } from "../scene/layout";
import { siteFor } from "../scene/site";
import type { Vec3 } from "../scene/types";
import type { CameraPose } from "../scene/viewpoints";

/**
 * Walk mode: a first-person stroll through the compound at eye height. Pure maths, stepped by
 * the camera rig; input comes from the keyboard, a drag on the canvas, and the touch joystick.
 */
export const EYE_HEIGHT = 1.7;
/** Metres per second: a brisk walk, and with Shift held. The site is 860 m long. */
export const WALK_SPEED = 3.4;
export const RUN_SPEED = 8;
/** Radians of turn per pixel dragged. */
export const LOOK_SPEED = 0.0042;
export const PITCH_LIMIT = 1.1;
export const WALK_FOV = 62;
/** How close the walker may come to a wall, and to the site's edge. */
const BODY = 0.6;
const EDGE = 2;

export type WalkInput = {
  /** Stick or keys: x strafes right, y walks forward; each -1 to 1. */
  move: { x: number; y: number };
  run: boolean;
  /** Pixels dragged since the last frame; the rig clears them once applied. */
  look: { dx: number; dy: number };
};

export const emptyInput = (): WalkInput => ({ move: { x: 0, y: 0 }, run: false, look: { dx: 0, dy: 0 } });

export type WalkState = {
  x: number;
  y: number;
  z: number;
  /** Heading in radians: 0 looks toward -z, and it grows turning right. */
  yaw: number;
  pitch: number;
  /** Current speed over the ground, for easing in and out of a stop. */
  vx: number;
  vz: number;
};

const grow = (r: Rect, by: number): Rect => ({ minX: r.minX - by, maxX: r.maxX + by, minZ: r.minZ - by, maxZ: r.maxZ + by });
const inside = (r: Rect, x: number, z: number) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ;

/** Amenities with walls, fences or water: walked around, not through. Lawns, terraces and plazas are open. */
const SOLID_AMENITIES = new Set(["pool", "gym", "padel", "tennis", "mosque", "gallery"]);

let obstacles: Rect[] | null = null;

/** Footprints a walker cannot enter: every villa and apartment block, and the walled amenities. */
export function walkObstacles(): Rect[] {
  if (obstacles) return obstacles;
  obstacles = [
    ...planVillas().map((v) => grow({ minX: v.x - v.width / 2, maxX: v.x + v.width / 2, minZ: v.z - v.depth / 2, maxZ: v.z + v.depth / 2 }, BODY)),
    ...planApartmentBlocks().map((b) => grow({ minX: b.x - b.width / 2, maxX: b.x + b.width / 2, minZ: b.backZ, maxZ: b.backZ + b.floorDepths[0] }, BODY)),
    ...planAmenities()
      .filter((a) => SOLID_AMENITIES.has(a.kind))
      .map((a) => grow(a.footprint, BODY)),
  ];
  return obstacles;
}

/** True where a walker cannot stand: outside the walls, in the stream, or inside a building. */
export function blocked(x: number, z: number): boolean {
  if (!inside(grow(PLAN_SITE, -EDGE), x, z)) return true;
  if (siteFor("zaitun").isWater(x, z)) return true;
  return walkObstacles().some((r) => inside(r, x, z));
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const damp = (from: number, to: number, rate: number, dt: number) => to + (from - to) * Math.exp(-rate * dt);

/**
 * One frame of walking: turn by the drag, ease toward the stick's velocity, slide along
 * whatever is in the way, and follow the ground at eye height.
 */
export function stepWalk(state: WalkState, input: WalkInput, dt: number): WalkState {
  // Grab the view: dragging right turns left, dragging down looks up.
  const yaw = state.yaw - input.look.dx * LOOK_SPEED;
  const pitch = clamp(state.pitch + input.look.dy * LOOK_SPEED, -PITCH_LIMIT, PITCH_LIMIT);

  const mx = clamp(input.move.x, -1, 1);
  const my = clamp(input.move.y, -1, 1);
  const push = Math.min(1, Math.hypot(mx, my));
  const speed = (input.run ? RUN_SPEED : WALK_SPEED) * push;
  const norm = Math.hypot(mx, my) || 1;
  // Forward is (sin yaw, -cos yaw); right is (cos yaw, sin yaw).
  const wantX = ((Math.sin(yaw) * my + Math.cos(yaw) * mx) / norm) * speed;
  const wantZ = ((-Math.cos(yaw) * my + Math.sin(yaw) * mx) / norm) * speed;
  let vx = damp(state.vx, wantX, 9, dt);
  let vz = damp(state.vz, wantZ, 9, dt);

  let x = state.x + vx * dt;
  let z = state.z + vz * dt;
  if (blocked(x, z)) {
    // Slide: keep whichever axis is free.
    if (!blocked(x, state.z)) {
      z = state.z;
      vz = 0;
    } else if (!blocked(state.x, z)) {
      x = state.x;
      vx = 0;
    } else {
      x = state.x;
      z = state.z;
      vx = 0;
      vz = 0;
    }
  }
  const y = damp(state.y, siteFor("zaitun").ground(x, z) + EYE_HEIGHT, 10, dt);
  return { x, y, z, yaw, pitch, vx, vz };
}

/** The camera for a walker: at the eye, looking along the heading. */
export function walkPose(s: WalkState): CameraPose {
  const flat = Math.cos(s.pitch);
  return {
    position: [s.x, s.y, s.z],
    target: [s.x + Math.sin(s.yaw) * flat * 10, s.y + Math.sin(s.pitch) * 10, s.z - Math.cos(s.yaw) * flat * 10],
    fov: WALK_FOV,
  };
}

/** Where walks begin when the asked-for spot is not walkable: the garden walk by the reflecting pool, looking up the axis. */
export const WALK_HOME: Readonly<Pick<WalkState, "x" | "z" | "yaw">> = { x: 0, z: -16, yaw: 0 };

/**
 * A place to start walking near `near` (where the camera was looking), facing the way the
 * camera faced. Searches outward in rings for free ground; falls back to the garden walk.
 */
export function walkStart(near: Vec3, facing: Vec3): WalkState {
  const yaw = Math.atan2(facing[0], -facing[2]) || 0;
  const at = (x: number, z: number, heading: number): WalkState => ({ x, y: siteFor("zaitun").ground(x, z) + EYE_HEIGHT, z, yaw: heading, pitch: 0, vx: 0, vz: 0 });
  for (let radius = 0; radius <= 60; radius += 4) {
    const steps = radius === 0 ? 1 : 12;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = near[0] + Math.cos(a) * radius;
      const z = near[2] + Math.sin(a) * radius;
      if (!blocked(x, z)) return at(x, z, yaw);
    }
  }
  return at(WALK_HOME.x, WALK_HOME.z, WALK_HOME.yaw);
}

/** Keyboard state to a move vector: arrows or WASD, opposite keys cancel. */
export function keysToMove(keys: ReadonlySet<string>): { x: number; y: number } {
  const on = (...codes: string[]) => (codes.some((c) => keys.has(c)) ? 1 : 0);
  return {
    x: on("ArrowRight", "KeyD") - on("ArrowLeft", "KeyA"),
    y: on("ArrowUp", "KeyW") - on("ArrowDown", "KeyS"),
  };
}

export const WALK_KEYS: ReadonlySet<string> = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight"]);
