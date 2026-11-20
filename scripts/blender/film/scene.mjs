#!/usr/bin/env node
/**
 * The Zaitun Hills film's scene data (track 5B): everything film.py places that the compound model
 * itself doesn't carry, taken from the same code the web scene runs, so the film and the site show
 * the same place:
 *
 *   vegetation   every tree, hedge, shrub and tuft of planLandscape("high") (landscape.ts, track 3B)
 *                as instance matrices per vegetation-library node (vegetation.ts's speciesFor)
 *   life         people, cars and birds of planLife("high"), sampled every film frame with the web's
 *                own motion (lifeMotion.ts), so feet keep pace and wheels turn as on the site
 *   terrain      the web's ground mesh itself (planWorld.ts: planGroundAxes, planTerrainHeight, planGroundColor),
 *                ±1.8 km, so the film's land reaches the horizon exactly as the site's does; and its stream
 *   ground       the same colours on a 1 m grid over the walled site, for detail up close (linear)
 *   posters      the four web viewpoints (viewpoints.ts): the posters are rendered from exactly these
 *   stills       the 4K stills, picked from the approved shots (shots.json, track 5A)
 *   vertical     the 15 s social cut: which seconds of which shots, and where the 9:16 crop sits
 *
 *   node --import ./scripts/blender/film/ts-register.mjs scripts/blender/film/scene.mjs
 *
 * writes scripts/blender/out/film/scene.json and scripts/blender/out/film/ground.pfm.
 * Coordinates stay in the scene's axes (+x downstream, +z across the stream, y up, metres);
 * film.py turns them into Blender's (x, -z, y).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Color } from "three";
import { planTerrainHeight } from "../../../components/sawad/scene/layout.ts";
import { planLandscape, planLife } from "../../../components/sawad/scene/landscape.ts";
import { birdSlots, birdWings, carPose, clipTimeScale, walkerPose } from "../../../components/sawad/scene/lifeMotion.ts";
import { birdPosition } from "../../../components/sawad/scene/landscape.ts";
import { planGroundAxes, planGroundColor, planPoolWater } from "../../../components/sawad/scene/planWorld.ts";
import { riverGeometryParams } from "../../../components/sawad/scene/layout.ts";
import { speciesFor } from "../../../components/sawad/scene/vegetation.ts";
import { VIEW_IDS, viewpoints } from "../../../components/sawad/scene/viewpoints.ts";

export const TIER = "high";
export const SCENE_PATH = fileURLToPath(new URL("../out/film/scene.json", import.meta.url));
export const GROUND_PATH = fileURLToPath(new URL("../out/film/ground.pfm", import.meta.url));
const SHOTS = JSON.parse(readFileSync(new URL("./shots.json", import.meta.url), "utf8"));
const LAYOUT = JSON.parse(readFileSync(new URL("../layout.json", import.meta.url), "utf8"));

/** Posters replace public/sawad/scene-zaitun-<view>.jpg, at the size the site serves them. */
export const POSTER = { width: 1920, height: 1080 };
/** 4K stills, as the brief asks. */
export const STILL = { width: 3840, height: 2160 };
/** Metres per texel of the ground colour grid. */
export const GROUND_STEP = 1;
/** A landscape olive this close to the hero olive is moved out of its way (metres). */
export const HERO_OLIVE_CLEARANCE = 4;

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const r3 = (v) => Math.round(v * 1e3) / 1e3;

/** Seconds into the film at a frame (frame 1 is t = 0), on the film's one clock. */
export const secondsAt = (frame, fps = SHOTS.fps) => (frame - 1) / fps;

export function shotById(id) {
  const shot = SHOTS.shots.find((s) => s.id === id);
  if (!shot) throw new Error(`no shot ${id} in shots.json`);
  return shot;
}

/** The frame `at` (0..1) of the way through a shot. */
export function frameIn(shot, at) {
  return shot.startFrame + Math.round(at * (shot.endFrame - shot.startFrame));
}

// ---------------------------------------------------------------- vegetation

/**
 * The 05d detail frames an olive branch at shots.json's hero olive. 3B's olive rows don't stand
 * exactly there, so the film plants an old olive (olive-b, the hero tree) on the spot and moves
 * neighbours that would stand inside it.
 */
/** @returns {import("../../../components/sawad/scene/landscape.ts").Plant} */
export function heroOlive() {
  const { x, z } = SHOTS.hero.olive;
  return { x, y: Math.max(0, planTerrainHeight(x, z)), z, scale: 1.12, rotation: 2.4, lean: 0, variant: 1, cell: "hero", rank: 0 };
}

export function filmLandscape() {
  const land = planLandscape(TIER);
  const hero = heroOlive();
  const olives = land.olives.filter((o) => Math.hypot(o.x - hero.x, o.z - hero.z) > HERO_OLIVE_CLEARANCE);
  return { ...land, olives: [...olives, hero] };
}

/** Instance matrices (three.js, column-major, scene space) per library node, finest level. */
export function vegetation(land = filmLandscape()) {
  return speciesFor(land, TIER).map((s) => ({
    id: s.id,
    node: s.nodes.LOD0 ?? s.nodes.LOD1 ?? s.nodes.card,
    nodes: s.nodes,
    count: s.matrices.length / 16,
    matrices: Array.from(s.matrices, r4),
  }));
}

// ---------------------------------------------------------------- life

/** Every actor's pose at every film frame: [x, y, z, heading] per frame (birds add two wing weights). */
export function life(frames = SHOTS.frames, fps = SHOTS.fps) {
  const plan = planLife(TIER);
  const times = Array.from({ length: frames }, (_, i) => secondsAt(i + 1, fps));
  const pose = (p) => [r3(p.x), r3(p.y), r3(p.z), r4(p.heading)];
  return {
    fps,
    frames,
    walkers: plan.walkers.map((w) => ({
      id: w.id,
      asset: w.asset,
      clip: w.clip,
      scale: w.scale,
      timeScale: r4(clipTimeScale(w.clip, w.speed, w.scale)),
      phase: w.phase,
      moving: w.speed > 0 && w.route.points.length > 1,
      track: w.speed > 0 && w.route.points.length > 1 ? times.flatMap((t) => pose(walkerPose(w, t))) : pose(walkerPose(w, 0)),
    })),
    cars: plan.moving.map((c) => ({
      id: c.id,
      asset: c.asset,
      tint: c.tint,
      track: times.flatMap((t) => {
        const p = carPose(c, t);
        return [...pose(p), r3(p.distance)];
      }),
    })),
    parked: plan.parked.map((c) => ({ id: c.id, asset: c.asset, tint: c.tint, x: r3(c.x), y: r3(c.y), z: r3(c.z), rotation: r4(c.rotation) })),
    birds: birdSlots(plan.flocks).map((slot) => ({
      flock: slot.flock.id,
      track: times.flatMap((t) => [...pose(birdPosition(slot.flock, slot.index, t)), ...birdWings(slot, t).map(r3)]),
    })),
  };
}

// ---------------------------------------------------------------- ground

/** The web terrain's colour (linear RGB) on a GROUND_STEP grid over the model's terrain. */
export function groundGrid(step = GROUND_STEP) {
  const t = LAYOUT.masterplan.terrain;
  const width = Math.round(((t.columns - 1) * t.step) / step) + 1;
  const height = Math.round(((t.rows - 1) * t.step) / step) + 1;
  const rgb = new Float32Array(width * height * 3);
  const c = new Color();
  for (let j = 0; j < height; j++) {
    const z = t.minZ + j * step;
    for (let i = 0; i < width; i++) {
      const x = t.minX + i * step;
      planGroundColor(x, z, planTerrainHeight(x, z), c);
      rgb.set([c.r, c.g, c.b], (j * width + i) * 3);
    }
  }
  return { minX: t.minX, minZ: t.minZ, step, width, height, rgb };
}

/**
 * The web's ground mesh (planWorld.ts buildPlanTerrain, high tier): grid lines, heights row by row
 * (row j is z = zs[j]) and linear vertex colours; plus the stream's water quad (buildPlanStream).
 */
export function terrainMesh() {
  const { xs, zs } = planGroundAxes(TIER);
  const heights = [];
  const colors = [];
  const c = new Color();
  for (const z of zs) {
    for (const x of xs) {
      const y = planTerrainHeight(x, z);
      heights.push(r3(y));
      planGroundColor(x, z, y, c);
      colors.push(r4(c.r), r4(c.g), r4(c.b));
    }
  }
  const r = riverGeometryParams("zaitun");
  // buildPlanStream: one 3600 m quad at y = 0, as wide as the channel plus its bends (55 m each way) and 110 m.
  const stream = { minX: -1800, maxX: 1800, minZ: r.near + r.width / 2 - (r.width + 2 * 55 + 220) / 2, maxZ: r.near + r.width / 2 + (r.width + 2 * 55 + 220) / 2, y: 0 };
  return { xs: xs.map(r3), zs: zs.map(r3), heights, colors, stream, pool: planPoolWater() };
}

/** Portable float map: row 0 at the bottom, as PFM stores it; row j is z = minZ + j * step. */
export function pfm({ width, height, rgb }) {
  const header = Buffer.from(`PF\n${width} ${height}\n-1.0\n`, "ascii");
  return Buffer.concat([header, Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength)]);
}

// ---------------------------------------------------------------- posters, stills, vertical cut

/** The four web viewpoints, framed as the site's opening shots (three.js vertical fov). */
export function posters() {
  const views = viewpoints("zaitun");
  return VIEW_IDS.map((id) => ({
    id,
    file: `public/sawad/scene-zaitun-${id}.jpg`,
    ...POSTER,
    position: views[id].position,
    target: views[id].target,
    fovVertical: views[id].fov,
  }));
}

/**
 * The stills: 10 frames of the film, rendered alone at 4K with more samples and no motion blur.
 * Aerial hero, eye level, the hero villa, details, lifestyle and dusk, as the brief lists them.
 */
export const STILLS = [
  { id: "01-aerial-hero", shot: "01", at: 0.8, kind: "aerial hero" },
  { id: "02-gate-lintel", shot: "02", at: 0.55, kind: "eye level" },
  { id: "03-palm-allee", shot: "03", at: 0.5, kind: "eye level" },
  { id: "04-hero-villa", shot: "04", at: 1, kind: "hero villa" },
  { id: "05a-mashrabiya", shot: "05a", at: 0.5, kind: "detail" },
  { id: "05b-brass-canopy", shot: "05b", at: 1, kind: "detail" },
  { id: "05d-olive-leaves", shot: "05d", at: 0.5, kind: "detail" },
  { id: "06a-courts", shot: "06a", at: 0.5, kind: "lifestyle" },
  { id: "06b-playground", shot: "06b", at: 0.5, kind: "lifestyle" },
  { id: "08-blue-hour", shot: "08", at: 0.35, kind: "dusk" },
];

export function stills() {
  return STILLS.map((s) => {
    const shot = shotById(s.shot);
    return { ...s, frame: frameIn(shot, s.at), light: shot.light, file: `stills/zaitun-${s.id}.png`, ...STILL };
  });
}

/**
 * The 15 s vertical cut, in film order: each marked shot's `vertical.seconds` from the middle of
 * the shot (the last shot's from its end, where the end card is), cropped 9:16 at `vertical.center`.
 */
/** @typedef {{ shot: string, firstFrame: number, lastFrame: number, center: number }} VerticalSegment */

/** @returns {VerticalSegment[]} */
export function verticalCut(shots = SHOTS.shots, fps = SHOTS.fps) {
  return shots
    .filter((s) => s.vertical)
    .map((s, i, all) => {
      const length = Math.round(s.vertical.seconds * fps);
      const span = s.endFrame - s.startFrame + 1;
      const first = i === all.length - 1 ? s.endFrame - length + 1 : s.startFrame + Math.floor((span - length) / 2);
      return { shot: s.id, firstFrame: first, lastFrame: first + length - 1, center: s.vertical.center };
    });
}

export function filmScene() {
  return {
    version: 1,
    note: "Generated by scripts/blender/film/scene.mjs from the scene code (landscape.ts, lifeMotion.ts, planWorld.ts, viewpoints.ts) and shots.json. Do not edit by hand.",
    tier: TIER,
    fps: SHOTS.fps,
    frames: SHOTS.frames,
    posters: posters(),
    stills: stills(),
    vertical: verticalCut(),
    hero: { ...SHOTS.hero, oliveTree: heroOlive() },
    terrain: terrainMesh(),
    vegetation: vegetation(),
    life: life(),
  };
}

function main() {
  mkdirSync(dirname(SCENE_PATH), { recursive: true });
  const scene = filmScene();
  writeFileSync(SCENE_PATH, JSON.stringify(scene));
  const ground = groundGrid();
  writeFileSync(GROUND_PATH, pfm(ground));
  const plants = scene.vegetation.map((s) => `${s.id} ${s.count}`).join(", ");
  console.log(`scene.json: ${plants}; ${scene.life.walkers.length} people, ${scene.life.cars.length + scene.life.parked.length} cars, ${scene.life.birds.length} birds`);
  console.log(`ground.pfm: ${ground.width} x ${ground.height} at ${ground.step} m`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
