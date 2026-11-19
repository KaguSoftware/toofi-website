#!/usr/bin/env node
/**
 * The Zaitun Hills film's shot list as data: every camera of the 60–90 s film, placed on the
 * 28 ha masterplan in components/sawad/scene/layout.ts. The storyboard (storyboard.py, greybox
 * renders) and the final Cycles film (track 5B) both read the shots.json this writes, so the
 * frames approved on the storyboard are the frames the film renders.
 *
 *   node scripts/blender/film/shots.mjs     writes shots.json and the greybox data
 *
 * Coordinates are the scene's river-relative axes: +x downstream (toward the low evening sun),
 * +z across the stream, y up, metres. The water surface is y = 0.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLAN_LEVELS,
  PLAN_SITE,
  PLAN_SUN,
  planAmenities,
  planApartmentBlocks,
  planBoulevardZ,
  planGates,
  planRiverCenterZ,
  planTerrainHeight,
  planVillas,
  riverGeometryParams,
  seeded,
} from "../../../components/sawad/scene/layout.ts";
import { indicativeTrees } from "../../draw-masterplan.mjs";

export const SHOTS_PATH = fileURLToPath(new URL("./shots.json", import.meta.url));
export const GREYBOX_PATH = fileURLToPath(new URL("../out/film/greybox.json", import.meta.url));

export const FPS = 24;
/** Full-frame 36 mm sensor, fitted to the width: lens values read as real lenses. */
export const SENSOR_WIDTH = 36;
export const FRAME = { width: 3840, height: 2160 };
/** The optional cinema letterbox and the social cut's crop. */
export const LETTERBOX = 2.39;
export const VERTICAL = { width: 1080, height: 1920, seconds: 15 };
/** Eye height of a standing person above the ground. */
export const EYE = 1.6;

// ---------------------------------------------------------------- places the shots look at

const V = PLAN_LEVELS.valley;
const ground = (x, z) => Math.max(0, planTerrainHeight(x, z));
const p = (x, y, z) => ({ x, y, z });

/** The hero: the last courtyard villa downstream, its open flank turned to the evening sun. */
export const HERO_VILLA = planVillas()
  .filter((v) => v.type === "courtyard")
  .reduce((a, b) => (b.x > a.x ? b : a));
/** The gate the sun lights from the front: its brass lintel faces downstream, into the low sun. */
export const HERO_GATE = (() => {
  const gate = planGates().find((g) => g.id === "east");
  if (!gate) throw new Error("layout has no east gate");
  return gate;
})();
const amenity = (id) => planAmenities().find((a) => a.id === id);
const POOL = amenity("pool");

/** Front (street side) and back (garden side) faces of the hero villa. */
const heroFront = HERO_VILLA.z + (HERO_VILLA.facing * HERO_VILLA.depth) / 2;
const heroBack = HERO_VILLA.z - (HERO_VILLA.facing * HERO_VILLA.depth) / 2;

/** An olive in the groves east of the garden, where the low sun comes through it toward the camera. */
export const HERO_OLIVE = (() => {
  const want = { x: 92, z: -40 };
  const [x, z] = indicativeTrees().olive.reduce((a, b) => (Math.hypot(b[0] - want.x, b[1] - want.z) < Math.hypot(a[0] - want.x, a[1] - want.z) ? b : a));
  return p(x, ground(x, z), z);
})();

/** Boulevard A at x, with an offset across it (+ toward the stream). */
const onBoulevardA = (x, y, across = 0) => p(x, y, planBoulevardZ("a", x) + across);

// ---------------------------------------------------------------- the shot list

/**
 * One shot. `keys` are camera poses at fractions of the shot (0 start, 1 end), eased in and out.
 * `level` keeps the camera's pitch at zero and frames up or down with lens shift instead, so
 * architecture keeps straight verticals. `light` is the time of day across the shot.
 * `vertical` marks the part used in the 15 s social cut: its length and where the 9:16 crop
 * sits across the 16:9 frame (0 left, 0.5 centre, 1 right).
 */
const SHOT_LIST = [
  {
    id: "01",
    name: "Aerial reveal",
    purpose: "Open on the land: olive terraces in the foreground, the compound in the valley, the stream catching the low sun.",
    move: "Drone descent and push toward the compound",
    seconds: 12,
    lens: 24,
    fStop: 8,
    level: false,
    light: "day",
    keys: [
      { at: 0, eye: p(-640, 220, -600), target: p(20, 0, 10) },
      { at: 1, eye: p(-430, 85, -340), target: p(-40, 0, 20) },
    ],
    vertical: { seconds: 3, center: 0.55 },
  },
  {
    id: "02",
    name: "Crane over the gate",
    purpose: "Arrive: start on the brass lintel between the gate pavilions, crane up and tilt down to reveal boulevard A and its palm allée.",
    move: "Crane up with tilt down",
    seconds: 9,
    lens: 28,
    fStop: 5.6,
    level: false,
    light: "day",
    keys: [
      { at: 0, eye: p(HERO_GATE.x + 28, ground(HERO_GATE.x + 28, HERO_GATE.z) + EYE, HERO_GATE.z + 2.5), target: p(HERO_GATE.x, V + 5.6, HERO_GATE.z) },
      { at: 1, eye: p(HERO_GATE.x + 24, V + 26, HERO_GATE.z + 4), target: onBoulevardA(HERO_GATE.x - 150, V) },
    ],
  },
  {
    id: "03",
    name: "Palm allée dolly",
    purpose: "Live on the street: eye level along boulevard A, palms of the near allée sliding past in the foreground, garden villas across the street in raking sun.",
    move: "Lateral dolly at walking pace",
    seconds: 10,
    lens: 35,
    fStop: 4,
    level: true,
    light: "day",
    keys: [
      { at: 0, eye: onBoulevardA(-300, V + EYE, 9), target: onBoulevardA(-262, V + 6, -10) },
      { at: 1, eye: onBoulevardA(-286, V + EYE, 9), target: onBoulevardA(-248, V + 6, -10) },
    ],
    vertical: { seconds: 3, center: 0.45 },
  },
  {
    id: "04",
    name: "Hero villa push-in",
    purpose: "The waterfront courtyard villa square on from the riverside lawn, framed by the palm row: garden facade in raking light, the roof tower against the sky.",
    move: "Slow push-in",
    seconds: 10,
    lens: 40,
    fStop: 5.6,
    level: true,
    light: "day",
    // Square on, between two trunks of the riverside palm row: they frame the villa, then slide
    // out of frame as the camera passes between them.
    keys: [
      { at: 0, eye: p(HERO_VILLA.x + 2, V + EYE, heroBack + 30), target: p(HERO_VILLA.x + 2, V + 4.6, heroBack) },
      { at: 1, eye: p(HERO_VILLA.x + 2, V + EYE, heroBack + 19), target: p(HERO_VILLA.x + 2, V + 4.6, heroBack) },
    ],
  },
  {
    id: "05a",
    name: "Detail: mashrabiya",
    purpose: "Dark timber lattice on an upper window of the hero villa, sun raking across it.",
    move: "Slow lateral drift",
    seconds: 3,
    lens: 85,
    fStop: 2,
    level: true,
    light: "day",
    keys: [
      { at: 0, eye: p(HERO_VILLA.x + 4.6, V + 5.4, heroBack + 9), target: p(HERO_VILLA.x + 4, V + 5.4, heroBack) },
      { at: 1, eye: p(HERO_VILLA.x + 3.8, V + 5.4, heroBack + 9), target: p(HERO_VILLA.x + 3.2, V + 5.4, heroBack) },
    ],
  },
  {
    id: "05b",
    name: "Detail: brass canopy",
    purpose: "The brass entrance canopy over the front door, warm against the cream render.",
    move: "Slow push-in",
    seconds: 3,
    lens: 85,
    fStop: 2.8,
    level: true,
    light: "day",
    keys: [
      { at: 0, eye: p(HERO_VILLA.x + 7, V + 2.4, heroFront - 11), target: p(HERO_VILLA.x, V + 3, heroFront) },
      { at: 1, eye: p(HERO_VILLA.x + 6.3, V + 2.4, heroFront - 10), target: p(HERO_VILLA.x, V + 3, heroFront) },
    ],
  },
  {
    id: "05c",
    name: "Detail: pool edge",
    purpose: "Along the reflecting pool's travertine coping at water level, mosaic under the surface, the garden soft behind.",
    move: "Slow slide along the rim",
    seconds: 3,
    lens: 85,
    fStop: 2.8,
    level: true,
    light: "day",
    keys: [
      { at: 0, eye: p(POOL.footprint.maxX + 0.8, V + 0.55, -40), target: p(POOL.footprint.maxX - 0.2, V + 0.25, -52) },
      { at: 1, eye: p(POOL.footprint.maxX + 0.8, V + 0.55, -41.5), target: p(POOL.footprint.maxX - 0.2, V + 0.25, -53.5) },
    ],
  },
  {
    id: "05d",
    name: "Detail: olive leaves",
    purpose: "Olive leaves in the evening breeze, backlit by the low sun so the silver undersides flash; the compound soft behind.",
    move: "Slow arc around the branch",
    seconds: 3,
    lens: 85,
    fStop: 2,
    level: true,
    light: "day",
    keys: [
      // The crown's edge on the left third, the low sun and the soft compound beyond it.
      { at: 0, eye: p(HERO_OLIVE.x - 6, HERO_OLIVE.y + 3.0, HERO_OLIVE.z + 3.1), target: p(HERO_OLIVE.x + 60, HERO_OLIVE.y + 3.6, HERO_OLIVE.z + 3.1), focus: 6.2 },
      { at: 1, eye: p(HERO_OLIVE.x - 6, HERO_OLIVE.y + 3.0, HERO_OLIVE.z + 2.6), target: p(HERO_OLIVE.x + 60, HERO_OLIVE.y + 3.6, HERO_OLIVE.z + 2.6), focus: 6.2 },
    ],
    vertical: { seconds: 2, center: 0.5 },
  },
  {
    id: "06a",
    name: "Courts and gym across the pool",
    purpose: "Low across the reflecting pool: its water and coping in the foreground, padel players beyond, the gym terrace behind, all front-lit by the sun over the camera's shoulder.",
    move: "Slow truck along the pool rim",
    seconds: 5,
    lens: 40,
    fStop: 5.6,
    level: true,
    light: "day",
    keys: [
      { at: 0, eye: p(POOL.footprint.maxX + 1.5, V + 1.3, -41), target: p(-30, V + 4.2, -48) },
      { at: 1, eye: p(POOL.footprint.maxX + 1.5, V + 1.3, -46), target: p(-30, V + 4.2, -53) },
    ],
    vertical: { seconds: 2, center: 0.5 },
  },
  {
    id: "06b",
    name: "Playground under the sails",
    purpose: "The other way across the pool: the shaded playground backlit by the low sun, the sails glowing, families and children in silhouette, water in the foreground.",
    move: "Slow truck along the pool rim",
    seconds: 5,
    lens: 40,
    fStop: 5.6,
    level: true,
    light: "day",
    keys: [
      { at: 0, eye: p(POOL.footprint.minX - 1.5, V + 1.3, -50.5), target: p(26, V + 3.8, -46.5) },
      { at: 1, eye: p(POOL.footprint.minX - 1.5, V + 1.3, -45.5), target: p(26, V + 3.8, -42.5) },
    ],
    vertical: { seconds: 1, center: 0.5 },
  },
  {
    id: "07",
    name: "Day to dusk",
    purpose: "Locked off across the stream: the sun sets, the sky turns blue, windows, lamps and the pool light up one by one.",
    move: "Locked off, time-lapse",
    seconds: 10,
    lens: 35,
    fStop: 8,
    level: true,
    light: "day-to-dusk",
    keys: [
      { at: 0, eye: p(20, ground(20, 185) + 18, 185), target: p(0, 6, -90) },
      { at: 1, eye: p(20, ground(20, 185) + 18, 185), target: p(0, 6, -90) },
    ],
    vertical: { seconds: 2, center: 0.5 },
  },
  {
    id: "08",
    name: "Blue-hour pull-back and end card",
    purpose: "Rise and pull back over the stream until the whole compound sits under the foothills; the sky above holds the logo end card in English and Arabic.",
    move: "Pull back and crane up",
    seconds: 14,
    lens: 24,
    fStop: 8,
    level: false,
    light: "dusk",
    keys: [
      { at: 0, eye: p(0, 45, 120), target: p(0, 6, -60) },
      { at: 1, eye: p(40, 160, 420), target: p(0, 30, -140) },
    ],
    vertical: { seconds: 2, center: 0.5 },
  },
];

// ---------------------------------------------------------------- camera maths

const DEG = 180 / Math.PI;
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * The camera for one pose, in the form Blender takes (and three.js can read back):
 * `yawDeg` turns about the up axis (0 looks inland along -z, -90 looks downstream along +x),
 * `pitchDeg` tilts up (+) or down (-), `shiftY` is the vertical lens shift as a fraction of the
 * frame width, `focus` the focus distance in metres (the target's distance unless the key sets one).
 * @param {{ eye: {x: number, y: number, z: number}, target: {x: number, y: number, z: number}, focus?: number }} key
 * @param {number} lens
 * @param {boolean} level
 */
export function cameraPose({ eye, target, focus }, lens, level) {
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const dz = target.z - eye.z;
  const flat = Math.hypot(dx, dz);
  const pitch = Math.atan2(dy, flat);
  return {
    eye: { x: round(eye.x, 3), y: round(eye.y, 3), z: round(eye.z, 3) },
    target: { x: round(target.x, 3), y: round(target.y, 3), z: round(target.z, 3) },
    yawDeg: round(Math.atan2(-dx, -dz) * DEG),
    pitchDeg: level ? 0 : round(pitch * DEG),
    shiftY: level ? round((lens / SENSOR_WIDTH) * Math.tan(pitch)) : 0,
    focus: round(focus ?? Math.hypot(dx, dy, dz), 3),
  };
}

/** Horizontal and vertical field of view (degrees) of a lens on the 16:9 frame. */
export function fieldOfView(lens) {
  const h = 2 * Math.atan(SENSOR_WIDTH / 2 / lens);
  const v = 2 * Math.atan(Math.tan(h / 2) * (FRAME.height / FRAME.width));
  return { horizontal: round(h * DEG, 2), vertical: round(v * DEG, 2) };
}

/** Smoothstep-style ease in and out: zero speed at both ends of every move. */
export const ease = (t) => t * t * (3 - 2 * t);

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => p(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));

/** The eye and target of a shot at fraction t of its length, eased between its keys. */
export function poseAt(shot, t) {
  const keys = shot.keys;
  const i = Math.max(0, keys.findIndex((k, n) => n + 1 < keys.length && t >= k.at && t <= keys[n + 1].at));
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  const k = b.at === a.at ? 0 : ease((t - a.at) / (b.at - a.at));
  return { eye: lerp3(a.eye, b.eye, k), target: lerp3(a.target, b.target, k) };
}

/** The ground (or the water surface) under a point. */
export const groundAt = (x, z) => ground(x, z);

/** The full shot list with timings and computed cameras: what shots.json holds. */
export function filmShots() {
  let start = 0;
  return SHOT_LIST.map((shot) => {
    const frames = Math.round(shot.seconds * FPS);
    const out = {
      ...shot,
      startFrame: start + 1,
      endFrame: start + frames,
      fov: fieldOfView(shot.lens),
      keys: shot.keys.map((k) => ({ at: k.at, ...cameraPose(k, shot.lens, shot.level) })),
      // Storyboard frames: the start, middle and end of a move; one frame for a locked-off shot.
      boards: shot.light === "day-to-dusk" ? [0, 0.5, 1] : sameKeys(shot) ? [0.5] : [0, 0.5, 1],
    };
    start += frames;
    return out;
  });
}

function sameKeys(shot) {
  const [a, b] = [shot.keys[0], shot.keys.at(-1)];
  return ["eye", "target"].every((w) => a[w].x === b[w].x && a[w].y === b[w].y && a[w].z === b[w].z);
}

export function filmSeconds(shots = filmShots()) {
  return shots.reduce((s, shot) => s + shot.seconds, 0);
}

/** Everything track 5B and the storyboard need to set up the cameras. */
export function filmPlan() {
  const shots = filmShots();
  return {
    version: 1,
    note: "Generated by scripts/blender/film/shots.mjs from components/sawad/scene/layout.ts. Do not edit by hand.",
    fps: FPS,
    frame: FRAME,
    sensorWidth: SENSOR_WIDTH,
    letterbox: LETTERBOX,
    vertical: VERTICAL,
    sun: PLAN_SUN,
    seconds: filmSeconds(shots),
    frames: shots.at(-1).endFrame,
    // Named as the model and layout.json name it (scripts/export-scene-layout.mjs).
    hero: { villa: `villa-${String(HERO_VILLA.index).padStart(2, "0")}`, gate: HERO_GATE.id, olive: { x: round(HERO_OLIVE.x, 2), z: round(HERO_OLIVE.z, 2) } },
    shots,
  };
}

// ---------------------------------------------------------------- greybox data

/** The land the film sees: wider than the site so the aerials never run off its edge. */
export const FILM_GROUND = { minX: -1200, maxX: 1200, minZ: -900, maxZ: 900, step: 8 };

/** Heights (cm) on the film's ground grid, from the same function the scene and the plan use. */
export function filmTerrain(g = FILM_GROUND) {
  const columns = Math.round((g.maxX - g.minX) / g.step) + 1;
  const rows = Math.round((g.maxZ - g.minZ) / g.step) + 1;
  const heightsCm = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < columns; c++) row.push(Math.round(planTerrainHeight(g.minX + c * g.step, g.minZ + r * g.step) * 100));
    heightsCm.push(row);
  }
  return { ...g, columns, rows, heightsCm };
}

/**
 * Indicative trees for the greybox: the masterplan drawing's planting, then the same rule
 * (olives on the slopes, palms by the stream) across the rest of the film's ground, sparser.
 * Track 3B sets out the real ones.
 */
export function filmTrees(g = FILM_GROUND) {
  const near = indicativeTrees();
  const rand = seeded(5150);
  const r = riverGeometryParams("zaitun");
  const drawn = { minX: -530, maxX: 530, minZ: -336, maxZ: 176 };
  const out = { palm: near["date-palm"], olive: near.olive, citrus: near.citrus };
  for (let x = g.minX + 6; x < g.maxX; x += 12) {
    for (let z = g.minZ + 6; z < g.maxZ; z += 12) {
      const [tx, tz] = [x + (rand() - 0.5) * 4, z + (rand() - 0.5) * 4];
      if (tx > drawn.minX && tx < drawn.maxX && tz > drawn.minZ && tz < drawn.maxZ) continue;
      const fromStream = Math.abs(tz - planRiverCenterZ(tx)) - r.width / 2;
      if (fromStream < 5) continue;
      const y = planTerrainHeight(tx, tz);
      if (y > 4.4 && rand() < 0.55) out.olive.push([tx, tz]);
      else if (y <= 4.4 && fromStream < 60 && rand() < 0.3) out.palm.push([tx, tz]);
    }
  }
  const at = (list) => list.map(([x, z]) => [round(x, 2), round(ground(x, z), 2), round(z, 2)]);
  return { palm: at(out.palm), olive: at(out.olive), citrus: at(out.citrus) };
}

export function greybox() {
  return {
    note: "Film greybox ground and trees. Generated by scripts/blender/film/shots.mjs; buildings come from scripts/blender/layout.json.",
    site: PLAN_SITE,
    apartments: planApartmentBlocks().length,
    terrain: filmTerrain(),
    trees: filmTrees(),
  };
}

export function writeFilm(shotsPath = SHOTS_PATH, greyboxPath = GREYBOX_PATH) {
  const plan = filmPlan();
  mkdirSync(dirname(shotsPath), { recursive: true });
  writeFileSync(shotsPath, JSON.stringify(plan, null, 2) + "\n");
  if (greyboxPath) {
    mkdirSync(dirname(greyboxPath), { recursive: true });
    writeFileSync(greyboxPath, JSON.stringify(greybox()));
  }
  return plan;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const plan = writeFilm();
  console.log(`wrote ${SHOTS_PATH}: ${plan.shots.length} shots, ${plan.seconds} s; greybox at ${GREYBOX_PATH}`);
}
