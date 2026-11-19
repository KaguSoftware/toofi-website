import type { Vec3 } from "./types";
import { easeOutExpo, lerpCamera, type CameraPose } from "./viewpoints";

/** Seconds an explorer flight takes (view changes, marker fly-tos, zoom steps, reset). */
export const FLY_SECONDS = 1.2;
/** A press that travels less than this is a click, anything more is a drag. */
export const CLICK_TOLERANCE_PX = 6;
/** The orbit target stays inside this box, so the camera can never be dragged off the site. */
export const TARGET_BOUNDS = { minX: -480, maxX: 480, minY: -2, maxY: 60, minZ: -320, maxZ: 420 } as const;
/** Orbit distance limits, in metres. */
export const DISTANCE = { min: 7, max: 720 } as const;
/** The longest step a frame may advance, so a stalled tab resumes without a jump. */
export const MAX_FRAME_SECONDS = 0.1;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

/**
 * The camera at fraction `t` of a flight. Eased, and arced upward on long moves so the
 * camera never skims through buildings.
 */
export function flightPose(from: CameraPose, to: CameraPose, t: number): CameraPose {
  const k = easeOutExpo(t);
  // Land exactly on the destination, without the arc's rounding residue.
  if (k >= 1) return { position: [...to.position], target: [...to.target], fov: to.fov };
  const pose = lerpCamera(from, to, k);
  const span = length(sub(to.position, from.position));
  pose.position[1] += Math.sin(Math.PI * k) * Math.min(60, span * 0.18);
  return pose;
}

/** One zoom step toward (1) or away from (-1) the target, within the orbit limits. */
export function zoomPose(pose: CameraPose, dir: 1 | -1): CameraPose {
  const offset = sub(pose.position, pose.target);
  const current = length(offset) || 1;
  const k = clamp(current * (dir === 1 ? 0.7 : 1 / 0.7), DISTANCE.min, DISTANCE.max) / current;
  return { ...pose, position: [pose.target[0] + offset[0] * k, pose.target[1] + offset[1] * k, pose.target[2] + offset[2] * k] };
}

/**
 * Where the camera goes to show a marker: 62 m back from it along the current viewing
 * direction (measured from `pivot`, the point the camera orbits), raised above the roofs.
 */
export function markerPose(marker: Vec3, camera: Vec3, pivot: Vec3, fov: number): CameraPose {
  let dx = camera[0] - pivot[0];
  let dz = camera[2] - pivot[2];
  if (dx * dx + dz * dz < 1) {
    dx = -1;
    dz = -1;
  }
  const len = Math.hypot(dx, dz);
  return {
    position: [marker[0] + (dx / len) * 62, Math.max(marker[1] + 30, 34), marker[2] + (dz / len) * 62],
    target: [marker[0], marker[1] - 4, marker[2]],
    fov,
  };
}

/** The least clearance between an orbiting camera and the ground under it, in metres. */
export const GROUND_CLEARANCE = 1.5;

/**
 * Lifts a camera that has been dragged into the ground (the foothills rise 60 m above the
 * valley, higher than any orbit angle limit can account for) back above it, in place.
 * Returns true when it had to move.
 */
export function keepAboveGround<T extends { x: number; y: number; z: number }>(position: T, ground: (x: number, z: number) => number): boolean {
  const floor = ground(position.x, position.z) + GROUND_CLEARANCE;
  if (position.y >= floor) return false;
  position.y = floor;
  return true;
}

/** Clamps an orbit target into TARGET_BOUNDS, in place. */
export function clampTarget<T extends { x: number; y: number; z: number }>(target: T): T {
  target.x = clamp(target.x, TARGET_BOUNDS.minX, TARGET_BOUNDS.maxX);
  target.y = clamp(target.y, TARGET_BOUNDS.minY, TARGET_BOUNDS.maxY);
  target.z = clamp(target.z, TARGET_BOUNDS.minZ, TARGET_BOUNDS.maxZ);
  return target;
}
