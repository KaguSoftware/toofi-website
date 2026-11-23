import { flapWeights } from "@/lib/sawad/wind";
import { samplePath, type BirdFlock, type Clip, type MovingCar, type PathPose, type Walker } from "./landscape";

/*
 * Motion for the life on the 28 ha plan (people, cars, birds), as plain maths. SceneLife.tsx puts
 * it on the meshes of public/sawad/models/life-<tier>.glb (scripts/blender/life.py, track 3A);
 * the routes and flocks come from planLife() in landscape.ts (track 3B).
 */

/**
 * Ground speed (m/s) of a figure at scale 1 playing each clip at its authored rate, estimated from
 * life.py's keyframes: the walk swings the thigh from -24 to +18 degrees on a 0.9 m leg (about
 * 0.65 m per step, two steps per 1.0 s loop); the run swings -40 to +28 degrees (about 1.0 m per
 * step, two steps per 0.67 s loop). Stride grows with the figure, so a child at 0.68 covers less.
 */
export const CLIP_GROUND_SPEED: Readonly<Partial<Record<Clip, number>>> = { walk: 1.3, run: 3 };

/** A clip never plays slower or faster than this, so a gait stays believable. */
export const TIME_SCALE_RANGE = { min: 0.6, max: 1.8 } as const;

/**
 * How fast to play a walker's clip so the feet keep pace with the ground (no skating). Clips that
 * stay in place (idle, sit, swing) and people standing still play at their authored rate.
 */
export function clipTimeScale(clip: Clip, speed: number, scale: number): number {
  const natural = CLIP_GROUND_SPEED[clip];
  if (!natural || speed <= 0 || scale <= 0) return 1;
  return Math.min(TIME_SCALE_RANGE.max, Math.max(TIME_SCALE_RANGE.min, speed / (natural * scale)));
}

export type Pose = PathPose;
export type CarPose = Pose & { distance: number };

/*
 * Each pose function takes an optional `out`: SceneLife passes one object per walker or car and
 * reuses it on every frame, so moving the life makes no garbage (ledger T22). Without `out` a new
 * object is returned, which is what the film's track export keeps.
 */

/** Where a walker is `t` seconds in: along the route from its phase, or standing at the start facing `heading`. */
export function walkerPose(walker: Walker, t: number, out?: Pose): Pose {
  if (walker.speed <= 0 || walker.route.points.length < 2) {
    const start = walker.route.points[0];
    const pose = out ?? { x: 0, y: 0, z: 0, heading: 0 };
    pose.x = start[0];
    pose.y = start[1];
    pose.z = start[2];
    pose.heading = walker.heading;
    return pose;
  }
  return samplePath(walker.route, (walker.phase + t) * walker.speed, out);
}

/** Where a car is `t` seconds in, and how far it has driven (for turning the wheels). */
export function carPose(car: MovingCar, t: number, out?: CarPose): CarPose {
  const distance = (car.phase + t) * car.speed;
  const pose = out ?? { x: 0, y: 0, z: 0, heading: 0, distance: 0 };
  samplePath(car.route, distance, pose);
  pose.distance = distance;
  return pose;
}

/** Wheel turn (radians about its axle) after rolling `distance` metres on a wheel of `radius` metres. */
export function wheelAngle(distance: number, radius: number): number {
  return radius > 0 ? distance / radius : 0;
}

/** Radius of a wheel from its height (bounding box bottom and top, in the car's metres). */
export function wheelRadius(minY: number, maxY: number): number {
  return Math.max(0, (maxY - minY) / 2);
}

/** One bird of one flock. */
export type BirdSlot = { flock: BirdFlock; index: number; phase: number };

/** Every bird of every flock in one list (one instance each), with a fixed flap phase per bird. */
export function birdSlots(flocks: ReadonlyArray<BirdFlock>): BirdSlot[] {
  const out: BirdSlot[] = [];
  for (const flock of flocks) {
    for (let index = 0; index < flock.count; index++) {
      const h = Math.sin((out.length + 1) * 91.345) * 47453.5453;
      out.push({ flock, index, phase: h - Math.floor(h) });
    }
  }
  return out;
}

/** Morph weights [wings-up, wings-down] for a bird at time t (s). */
export function birdWings(slot: BirdSlot, t: number): [number, number] {
  return flapWeights(t, slot.phase);
}
