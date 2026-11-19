import { APARTMENT_BACK_Z, APARTMENT_BUILDINGS_X, BOULEVARD_Z, FLOOR_HEIGHT, PAD_Y, apartmentFloorDepth, boulevardCurve, riverGeometryParams, terrainHeight } from "./layout";
import type { SceneVariant, Vec3, ViewId } from "./types";

export type CameraPose = { position: Vec3; target: Vec3; fov: number };

export const VIEW_IDS: ViewId[] = ["flight", "street", "terrace", "aerial"];

/** Mid-channel height for the low flight (narrow streams get a lower, tighter line). */
function flightLine(variant: SceneVariant): number {
  const r = riverGeometryParams(variant);
  return r.near + Math.min(r.width * 0.32, 70);
}

/** The four named viewpoints for a compound variant. */
export function viewpoints(variant: SceneVariant): Record<ViewId, CameraPose> {
  const r = riverGeometryParams(variant);
  const zf = flightLine(variant);
  const streetX = -168;
  const streetZ = BOULEVARD_Z[0] + boulevardCurve(streetX);
  const terraceFloor = 2;
  const terraceY = PAD_Y + (terraceFloor + 1) * FLOOR_HEIGHT + 1.65;
  const terraceZ = APARTMENT_BACK_Z + apartmentFloorDepth(terraceFloor) - 1;
  const across = variant === "zaitun" ? r.far + 260 : r.near + r.width * 0.85;
  return {
    // Low over the water, angled so the compound and the sun glint share the frame.
    flight: { position: [-300, 24, zf + 20], target: [30, -8, zf - 175], fov: 44 },
    street: { position: [streetX, PAD_Y + 1.7, streetZ], target: [-40, PAD_Y + 4.5, BOULEVARD_Z[0] + boulevardCurve(-40)], fov: 56 },
    terrace: {
      position: [APARTMENT_BUILDINGS_X[0] - 4, terraceY, terraceZ],
      target: [APARTMENT_BUILDINGS_X[0] + 150, variant === "zaitun" ? 24 : 3, across],
      fov: 52,
    },
    aerial: { position: [-250, 150, -270], target: [10, 0, 10], fov: 40 },
  };
}

/** Seconds the film holds its opening shot (the poster frame) before lifting off. */
export const FILM_HOLD_SECONDS = 2.5;
/** Seconds to glide from the opening shot into the tour. */
export const FILM_BLEND_SECONDS = 9;
/** Seconds for one full circuit of the compound. */
export const TOUR_SECONDS = 150;

const TOUR_CENTER = { x: 0, z: -20 };
const TOUR_RADIUS = { x: 330, z: 235 };
/** Default starting angle: over the water, upstream, near the low-flight poster frame. */
const TOUR_START = 0.78 * Math.PI;

/** The tour angle nearest a camera position, so the film lifts off without a long transit. */
export function tourAngleNear([x, , z]: Vec3): number {
  return Math.atan2((z - TOUR_CENTER.z) / TOUR_RADIUS.z, (x - TOUR_CENTER.x) / TOUR_RADIUS.x);
}

/**
 * The cinematic showcase: one slow circuit around the compound. The camera sinks
 * low over the water on the river side, climbs high over the land behind, breathes
 * in and out, and looks slightly ahead of its path so the place keeps revealing itself.
 */
export function tourPose(variant: SceneVariant, seconds: number, startAngle = TOUR_START): CameraPose {
  const phase = (2 * Math.PI * seconds) / TOUR_SECONDS;
  const theta = startAngle - phase;
  const breathe = 1 + 0.09 * Math.sin(2 * phase + 0.6);
  const x = TOUR_CENTER.x + TOUR_RADIUS.x * breathe * Math.cos(theta);
  const z = TOUR_CENTER.z + TOUR_RADIUS.z * breathe * Math.sin(theta);
  const riverSide = (1 + Math.sin(theta)) / 2; // 1 over the water, 0 inland
  const y = Math.max(28 + 74 * (1 - riverSide) + 6 * Math.sin(3 * phase), terrainHeight(variant, x, z) + 18);
  // Direction of travel (theta decreasing), to lead the gaze.
  const tx = TOUR_RADIUS.x * Math.sin(theta);
  const tz = -TOUR_RADIUS.z * Math.cos(theta);
  const len = Math.hypot(tx, tz) || 1;
  const target: Vec3 = [TOUR_CENTER.x + (70 * tx) / len + 40 * Math.sin(2 * phase), 4, TOUR_CENTER.z + (45 * tz) / len];
  return { position: [x, y, z], target, fov: 42 + 3 * Math.sin(2 * phase) };
}

const smoother = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * k * (k * (k * 6 - 15) + 10);
};

/** How far the film has left its opening shot: 0 while holding, easing to 1 once touring. */
export function filmBlend(seconds: number): number {
  return smoother((seconds - FILM_HOLD_SECONDS) / FILM_BLEND_SECONDS);
}

/**
 * The Home film at a moment: hold the opening shot, glide into the tour (rising
 * first, so low shots clear the trees), then circle the compound for good.
 */
export function filmPose(variant: SceneVariant, start: ViewId, seconds: number): CameraPose {
  const open = viewpoints(variant)[start];
  if (seconds <= FILM_HOLD_SECONDS) return open;
  const q = seconds - FILM_HOLD_SECONDS;
  const tour = tourPose(variant, q, tourAngleNear(open.position));
  if (q >= FILM_BLEND_SECONDS) return tour;
  const a = q / FILM_BLEND_SECONDS;
  const k = filmBlend(seconds);
  const ky = smoother(a * 1.6);
  const pose = lerpCamera(open, tour, k);
  pose.position[1] = lerp(open.position[1], tour.position[1], ky);
  return pose;
}

export function easeOutExpo(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(2, -10 * t);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function lerpCamera(from: CameraPose, to: CameraPose, t: number): CameraPose {
  const k = Math.min(1, Math.max(0, t));
  return { position: lerp3(from.position, to.position, k), target: lerp3(from.target, to.target, k), fov: lerp(from.fov, to.fov, k) };
}
