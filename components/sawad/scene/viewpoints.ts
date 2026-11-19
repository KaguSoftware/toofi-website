import {
  APARTMENT_BACK_Z,
  APARTMENT_BUILDINGS_X,
  BOULEVARD_Z,
  FLOOR_HEIGHT,
  PAD_Y,
  PLAN_LEVELS,
  PLAN_STREET,
  apartmentFloorDepth,
  boulevardCurve,
  planApartmentBlocks,
  planBoulevardZ,
  riverGeometryParams,
} from "./layout";
import { siteFor, usesPlan } from "./site";
import type { SceneVariant, Vec3, ViewId } from "./types";

export type CameraPose = { position: Vec3; target: Vec3; fov: number };

export const VIEW_IDS: ViewId[] = ["flight", "street", "terrace", "aerial"];

/** Mid-channel height for the low flight (narrow streams get a lower, tighter line). */
function flightLine(variant: SceneVariant): number {
  const r = riverGeometryParams(variant);
  return r.near + Math.min(r.width * 0.32, 70);
}

/**
 * The four named viewpoints on the 28 ha masterplan (Zaitun Hills). Same shots as the 7 ha
 * compounds, framed for a site 2.4 times as long: the low flight comes up the stream from
 * upstream of the main gate, the street shot stands on boulevard A's sidewalk beside its palm allée, the terrace
 * looks downstream along the waterfront from the westernmost block, the aerial takes in the whole plan from above
 * the olive slopes. Each opening shot is its poster frame (public/sawad/scene-zaitun-*.jpg).
 */
function planViewpoints(): Record<ViewId, CameraPose> {
  const r = riverGeometryParams("zaitun");
  const site = siteFor("zaitun");
  const valley = PLAN_LEVELS.valley;
  const streetX = -320; // between two drives on the inland row (villas at x = -340 and -302)
  // 40 m up the allée and 1.5 m below the eye: the same line of sight as the poster, tilted down
  // just past the explorer's orbit limit (1.7 degrees below the target), so orbit controls never
  // lift the camera off eye level to obey it.
  const lookX = streetX + 40;
  // On the inland sidewalk, clear of the cars on the carriageway, with the palm verge alongside.
  const sidewalk = -(PLAN_STREET.carriageway / 2 + PLAN_STREET.verge + PLAN_STREET.sidewalk / 2);
  const block = planApartmentBlocks()[0];
  const terraceFloor = 2;
  const flightX = -560;
  return {
    // Low over the stream upstream of the walls, looking downstream across the compound into the sun.
    flight: { position: [flightX, 22, site.riverCenterZ(flightX) + 8], target: [-120, -6, -70], fov: 44 },
    street: {
      position: [streetX, valley + 1.7, planBoulevardZ("a", streetX) + sidewalk],
      target: [lookX, valley + 0.2, planBoulevardZ("a", lookX) + sidewalk],
      fov: 56,
    },
    terrace: {
      position: [block.x - 4, block.y + (terraceFloor + 1) * block.floorHeight + 1.65, block.backZ + block.floorDepths[terraceFloor] - 1],
      // Along the waterfront, downstream: the next blocks and the promenade palms lead the eye to the bend.
      target: [block.x + 380, 6, r.far + 120],
      fov: 52,
    },
    aerial: { position: [-660, 300, -600], target: [-30, 0, -120], fov: 40 },
  };
}

/** The four named viewpoints for a compound variant. */
export function viewpoints(variant: SceneVariant): Record<ViewId, CameraPose> {
  if (usesPlan(variant)) return planViewpoints();
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
/** Seconds for one full circuit of a 7 ha compound. */
export const TOUR_SECONDS = 150;

/**
 * The film's circuit: an ellipse about `center` with `radius`, flown in `seconds`. `lead` is how
 * far ahead of the camera it looks (along and across its path), `sway` how far that gaze drifts.
 * The 28 ha circuit is 1.8 times as long and wide, flown at about the same ground speed.
 */
export type Tour = {
  center: { x: number; z: number };
  radius: { x: number; z: number };
  seconds: number;
  lead: { along: number; across: number };
  sway: number;
  /** Lowest height over the water side and how much higher it climbs over the land. */
  low: number;
  climb: number;
};

const TOUR_7HA: Tour = { center: { x: 0, z: -20 }, radius: { x: 330, z: 235 }, seconds: TOUR_SECONDS, lead: { along: 70, across: 45 }, sway: 40, low: 28, climb: 74 };
const TOUR_PLAN: Tour = { center: { x: 0, z: -60 }, radius: { x: 600, z: 330 }, seconds: 240, lead: { along: 120, across: 70 }, sway: 70, low: 30, climb: 96 };

export function tourFor(variant: SceneVariant): Tour {
  return usesPlan(variant) ? TOUR_PLAN : TOUR_7HA;
}

/** Default starting angle: over the water, upstream, near the low-flight poster frame. */
const TOUR_START = 0.78 * Math.PI;

/** The tour angle nearest a camera position, so the film lifts off without a long transit. */
export function tourAngleNear([x, , z]: Vec3, variant: SceneVariant = "dijla"): number {
  const { center, radius } = tourFor(variant);
  return Math.atan2((z - center.z) / radius.z, (x - center.x) / radius.x);
}

/**
 * The cinematic showcase: one slow circuit around the compound. The camera sinks
 * low over the water on the river side, climbs high over the land behind, breathes
 * in and out, and looks slightly ahead of its path so the place keeps revealing itself.
 */
export function tourPose(variant: SceneVariant, seconds: number, startAngle = TOUR_START): CameraPose {
  const tour = tourFor(variant);
  const { center, radius, lead } = tour;
  const phase = (2 * Math.PI * seconds) / tour.seconds;
  const theta = startAngle - phase;
  const breathe = 1 + 0.09 * Math.sin(2 * phase + 0.6);
  const x = center.x + radius.x * breathe * Math.cos(theta);
  const z = center.z + radius.z * breathe * Math.sin(theta);
  const riverSide = (1 + Math.sin(theta)) / 2; // 1 over the water, 0 inland
  const y = Math.max(tour.low + tour.climb * (1 - riverSide) + 6 * Math.sin(3 * phase), siteFor(variant).ground(x, z) + 18);
  // Direction of travel (theta decreasing), to lead the gaze.
  const tx = radius.x * Math.sin(theta);
  const tz = -radius.z * Math.cos(theta);
  const len = Math.hypot(tx, tz) || 1;
  const target: Vec3 = [center.x + (lead.along * tx) / len + tour.sway * Math.sin(2 * phase), 4, center.z + (lead.across * tz) / len];
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
  const tour = tourPose(variant, q, tourAngleNear(open.position, variant));
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
