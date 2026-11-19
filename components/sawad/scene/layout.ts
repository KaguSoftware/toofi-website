import type { SceneMarker, SceneVariant } from "./types";

/**
 * Compound masterplan in metres. +x runs downstream along the river, +z points
 * across the river, y is up. The compound sits on the near (z < river) bank.
 *
 * Two layouts live here for now:
 * - The 7 ha layout (first half of the file) is what the scene and the baked model draw today,
 *   for all three compounds.
 * - The 28 ha masterplan (everything named `plan...` / `PLAN_...`, second half) is the plan for
 *   Zaitun Hills. The model is rebuilt on it and the scene moves onto it later; the 7 ha layout
 *   goes away then. The drawing is docs/zaitun/masterplan.svg (node scripts/draw-masterplan.mjs).
 */

export type Point3 = { x: number; y: number; z: number };
export type TreeInstance = Point3 & { scale: number; rotation: number; lean: number };

/** Site rectangle (inside the boundary wall). */
export const SITE = { minX: -178, maxX: 178, minZ: -132, maxZ: 66 } as const;
/** Height of the levelled compound pad. */
export const PAD_Y = 1.2;
/** Boulevard centre lines (before the gentle curve). */
export const BOULEVARD_Z = [-8, -86] as const;
export const BOULEVARD_WIDTH = 9;
export const FLOOR_HEIGHT = 3.6;
export const APARTMENT_BUILDINGS_X = [-95, 0, 95] as const;
export const APARTMENT_BACK_Z = 40;
export const APARTMENT_WIDTH = 32;
/** Depth of each apartment floor (floors step back toward the river view). */
export const apartmentFloorDepth = (floor: number) => 16 - floor * 2.6;

const VILLA_COLUMNS_X = [-152, -122, -92, 92, 122, 152] as const;
const ROW_OFFSET = 21;

export type VillaType = "courtyard" | "garden-4" | "garden-3";
export type VillaPlot = {
  index: number;
  x: number;
  z: number;
  /** +1: entrance faces +z, -1: faces -z (always toward its boulevard). */
  facing: 1 | -1;
  type: VillaType;
  width: number;
  depth: number;
  height: number;
};

export type RiverParams = { near: number; width: number; far: number; bedDepth: number };

const RIVERS: Record<SceneVariant, RiverParams> = {
  dijla: { near: 84, width: 240, far: 324, bedDepth: 3.5 },
  zaitun: { near: 84, width: 36, far: 120, bedDepth: 1.8 },
  shatt: { near: 84, width: 430, far: 514, bedDepth: 4.5 },
};

export function riverGeometryParams(variant: SceneVariant): RiverParams {
  return RIVERS[variant];
}

/** Small deterministic PRNG (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Gentle curve shared by both boulevards. */
export const boulevardCurve = (x: number) => 5 * Math.sin(x / 55);

/** River centre line z; straight past the compound, bending far away. */
export function riverCenterZ(variant: SceneVariant, x: number): number {
  const r = RIVERS[variant];
  const bend = smoothstep(260, 700, Math.abs(x)) * 40 * Math.sin(x / 420);
  return r.near + r.width / 2 + bend;
}

/** Rolling ground: three octaves, about -1.8 to 1.8. */
function rolling(x: number, z: number): number {
  return (
    Math.sin(x * 0.0071 + 0.4) * Math.cos(z * 0.0093 - 1.1) +
    0.55 * Math.sin(x * 0.019 + 1.3) * Math.sin(z * 0.017 + 0.7) +
    0.25 * Math.sin(x * 0.043 - 2.1) * Math.cos(z * 0.039 + 0.3)
  );
}

function hills(variant: SceneVariant, x: number, z: number): number {
  const n = rolling(x, z);
  if (variant === "zaitun") {
    // Foothills rising inland (away from the stream) and beyond the far bank.
    const r = RIVERS.zaitun;
    const inland = Math.min(60, Math.max(0, -z - 150) * 0.12 + Math.max(0, z - r.far - 120) * 0.1);
    // Rolling foothills; never dips below the valley floor (no stray puddles).
    return 2 + inland + Math.max(-1, n) * (2.5 + inland * 0.28);
  }
  // The Mesopotamian plain is nearly flat.
  const amp = variant === "shatt" ? 0.35 : 0.55;
  return 1.6 + amp * (n + 1);
}

/** Distance outside the site rectangle (0 inside). */
function outsideSite(x: number, z: number): number {
  const dx = Math.max(SITE.minX - x, 0, x - SITE.maxX);
  const dz = Math.max(SITE.minZ - z, 0, z - SITE.maxZ);
  return Math.hypot(dx, dz);
}

/** Ground height. Water surface is y = 0; anything below is river. */
export function terrainHeight(variant: SceneVariant, x: number, z: number): number {
  const r = RIVERS[variant];
  let land = hills(variant, x, z);
  // Levelled compound pad, blended into the surrounding land.
  land = PAD_Y + (land - PAD_Y) * smoothstep(0, 55, outsideSite(x, z));
  // River channel with sloping banks.
  const fromEdge = Math.abs(z - riverCenterZ(variant, x)) - r.width / 2; // < 0 inside the water
  if (fromEdge < 0) return -0.6 - Math.min(-fromEdge, 30) / 30 * r.bedDepth;
  const bank = smoothstep(0, 16, fromEdge);
  return -0.6 + (land + 0.6) * bank;
}

export function isRiver(variant: SceneVariant, x: number, z: number): boolean {
  return terrainHeight(variant, x, z) < 0.05;
}

function villaType(row: number): VillaType {
  if (row === 0) return "courtyard";
  return row === 3 ? "garden-3" : "garden-4";
}

const VILLA_SIZE: Record<VillaType, { width: number; depth: number; height: number }> = {
  courtyard: { width: 24, depth: 22, height: 7.6 },
  "garden-4": { width: 20, depth: 16, height: 7.2 },
  "garden-3": { width: 17, depth: 14, height: 6.8 },
};

/** Villa plot i (0..23): 4 rows of 6 along the two boulevards. */
export function villaPlot(i: number): VillaPlot {
  const index = ((i % 24) + 24) % 24;
  const row = Math.floor(index / 6);
  const col = index % 6;
  const x = VILLA_COLUMNS_X[col];
  const boulevard = BOULEVARD_Z[row < 2 ? 0 : 1];
  const side = row % 2 === 0 ? 1 : -1; // row 0/2: river side of its boulevard
  const z = boulevard + boulevardCurve(x) + side * ROW_OFFSET;
  const type = villaType(row);
  return { index, x, z, facing: side === 1 ? -1 : 1, type, ...VILLA_SIZE[type] };
}

export function villaPlots(): VillaPlot[] {
  return Array.from({ length: 24 }, (_, i) => villaPlot(i));
}

const VILLA_MARKER_LIFT = 6;
const APARTMENT_MARKER_LIFT = 2.6;

/** Marker anchor above villa i's roof. */
export function villaSlot(i: number): Point3 {
  const p = villaPlot(i);
  return { x: p.x, y: PAD_Y + p.height + VILLA_MARKER_LIFT, z: p.z };
}

/** Marker anchor for apartment i (0..11) at its terrace edge; floors fan out sideways so markers never stack. */
export function apartmentSlot(i: number): Point3 {
  const index = ((i % 12) + 12) % 12;
  const building = Math.floor(index / 4);
  const floor = index % 4;
  return {
    x: APARTMENT_BUILDINGS_X[building] + (floor - 1.5) * 6.5,
    y: PAD_Y + (floor + 1) * FLOOR_HEIGHT + APARTMENT_MARKER_LIFT,
    z: APARTMENT_BACK_Z + apartmentFloorDepth(floor),
  };
}

export function markerPosition(marker: Pick<SceneMarker, "kind" | "slot">): Point3 {
  return marker.kind === "villa" ? villaSlot(marker.slot) : apartmentSlot(marker.slot);
}

/** Where a marker's leader line meets the building. */
export function markerBase(marker: Pick<SceneMarker, "kind" | "slot">): Point3 {
  const p = markerPosition(marker);
  return { ...p, y: p.y - (marker.kind === "villa" ? VILLA_MARKER_LIFT : APARTMENT_MARKER_LIFT) };
}

/** Boulevard centre lines as [x, z] polylines (plus the riverfront promenade and garden axis). */
export function boulevardPath(): Array<Array<[number, number]>> {
  const line = (z0: number) => {
    const pts: Array<[number, number]> = [];
    for (let x = SITE.minX - 30; x <= SITE.maxX + 30; x += 6) pts.push([x, z0 + boulevardCurve(x)]);
    return pts;
  };
  const promenade: Array<[number, number]> = [];
  for (let x = SITE.minX + 4; x <= SITE.maxX - 4; x += 12) promenade.push([x, 62]);
  const axis: Array<[number, number]> = [];
  for (let z = SITE.minZ + 6; z <= 30; z += 12) axis.push([0, z]);
  return [line(BOULEVARD_Z[0]), line(BOULEVARD_Z[1]), promenade, axis];
}

function footprintHit(x: number, z: number, pad: number): boolean {
  for (const p of villaPlots()) {
    if (Math.abs(x - p.x) < p.width / 2 + pad && Math.abs(z - p.z) < p.depth / 2 + pad) return true;
  }
  for (const bx of APARTMENT_BUILDINGS_X) {
    if (Math.abs(x - bx) < APARTMENT_WIDTH / 2 + pad && z > APARTMENT_BACK_Z - pad && z < APARTMENT_BACK_Z + 16 + pad) return true;
  }
  return false;
}

function onBoulevard(x: number, z: number, margin: number): boolean {
  return BOULEVARD_Z.some((b) => Math.abs(z - (b + boulevardCurve(x))) < BOULEVARD_WIDTH / 2 + margin);
}

function insideSite(x: number, z: number, margin = 0): boolean {
  return x > SITE.minX - margin && x < SITE.maxX + margin && z > SITE.minZ - margin && z < SITE.maxZ + margin;
}

/**
 * Date palms: boulevard allées, the central garden grid, the riverfront row,
 * then groves on both banks until `count` is reached.
 */
export function palmPositions(variant: SceneVariant, count: number): TreeInstance[] {
  const rand = seeded(variant === "dijla" ? 11 : variant === "zaitun" ? 23 : 37);
  const out: TreeInstance[] = [];
  const add = (x: number, z: number, scale = 1) => {
    if (out.length >= count) return;
    const y = terrainHeight(variant, x, z);
    if (y < 0.4) return;
    out.push({ x, y, z, scale: scale * (0.82 + rand() * 0.36), rotation: rand() * Math.PI * 2, lean: (rand() - 0.5) * 0.5 });
  };
  // Boulevard allées, both sides.
  for (const b of BOULEVARD_Z) {
    for (let x = SITE.minX + 8; x <= SITE.maxX - 8; x += 13) {
      for (const side of [-1, 1]) add(x, b + boulevardCurve(x) + side * (BOULEVARD_WIDTH / 2 + 2.2), 1.05);
    }
  }
  // Riverfront promenade.
  for (let x = SITE.minX + 6; x <= SITE.maxX - 6; x += 11) add(x + (rand() - 0.5) * 2, 64 + (rand() - 0.5) * 2, 1.1);
  // Central garden grid (a planted orchard, the "sawad" in miniature).
  for (let x = -48; x <= 48; x += 12) {
    for (let z = -122; z <= 26; z += 12) {
      if (Math.abs(x) < 7) continue; // garden axis + pool
      if (onBoulevard(x, z, 2)) continue;
      add(x + (rand() - 0.5) * 2.5, z + (rand() - 0.5) * 2.5);
    }
  }
  const groveShare = variant === "zaitun" ? 0.35 : 1;
  const target = Math.min(count, out.length + Math.floor((count - out.length) * groveShare));
  const r = RIVERS[variant];
  // Riverbank belts: palms line both banks the whole way.
  for (let x = -1500; x <= 1500 && out.length < target; x += 7) {
    for (const bankSide of [-1, 1]) {
      if (rand() < 0.35) continue;
      const edge = riverCenterZ(variant, x) + bankSide * (r.width / 2);
      const z = edge + bankSide * (8 + rand() * rand() * 70);
      if (insideSite(x, z, 25)) continue;
      add(x + (rand() - 0.5) * 5, z);
    }
  }
  // Groves: clustered scatter on land outside the site.
  let guard = 0;
  while (out.length < target && guard++ < count * 40) {
    const cx = -1300 + rand() * 2600;
    const farBank = rand() < 0.55;
    const cz = farBank ? r.far + 30 + rand() * rand() * 520 : r.near - 30 - rand() * rand() * 650;
    const clusterSize = 14 + Math.floor(rand() * 30);
    const spread = 60 + rand() * 70;
    for (let k = 0; k < clusterSize && out.length < target; k++) {
      const x = cx + (rand() - 0.5) * spread;
      const z = cz + (rand() - 0.5) * spread * 0.8;
      if (insideSite(x, z, 25)) continue;
      if (variant === "zaitun" && terrainHeight(variant, x, z) > 26) continue; // palms stay in the valley
      add(x, z, 0.9 + rand() * 0.3);
    }
  }
  return out;
}

/** Rounded trees: olive groves on the Zaitun hills, citrus in villa gardens elsewhere. */
export function treePositions(variant: SceneVariant, count: number): TreeInstance[] {
  const rand = seeded(variant === "zaitun" ? 91 : variant === "dijla" ? 57 : 73);
  const out: TreeInstance[] = [];
  const add = (x: number, z: number, scale: number) => {
    const y = terrainHeight(variant, x, z);
    if (y < 0.4) return;
    out.push({ x, y, z, scale, rotation: rand() * Math.PI * 2, lean: 0 });
  };
  // Garden trees behind each villa.
  for (const p of villaPlots()) {
    for (let k = 0; k < 3 && out.length < count; k++) {
      const x = p.x + (k - 1) * (p.width / 3);
      const z = p.z - p.facing * (p.depth / 2 + 4 + rand() * 2);
      if (!footprintHit(x, z, 0.5) && !onBoulevard(x, z, 1)) add(x, z, 0.8 + rand() * 0.4);
    }
  }
  if (variant !== "zaitun") return out.slice(0, count);
  // Olive terraces in rows across the foothills.
  let guard = 0;
  while (out.length < count && guard++ < count * 30) {
    const x = -900 + rand() * 1800;
    const z = rand() < 0.7 ? -150 - rand() * rand() * 650 : RIVERS.zaitun.far + 30 + rand() * rand() * 520;
    const gx = Math.round(x / 9) * 9 + (rand() - 0.5) * 1.5;
    const gz = Math.round(z / 9) * 9 + (rand() - 0.5) * 1.5;
    if (insideSite(gx, gz, 20)) continue;
    add(gx, gz, 0.85 + rand() * 0.4);
  }
  return out;
}

export const COMPOUND_CENTER: Point3 = { x: 0, y: 6, z: -20 };

// =====================================================================================
// The 28 ha masterplan
//
// Everything above is the 7 ha layout the scene and the baked model draw today. The plan
// below is the one Zaitun Hills is rebuilt on: 60 villas and 6 apartment blocks on 28 ha,
// with the homes on the valley floor by the stream, a second boulevard on a river terrace
// 6 m higher, olive terraces above it, and a garden running from the slopes to the water.
// Same axes: +x downstream, +z across the stream, y up.
// =====================================================================================

export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

const inRect = (r: Rect, x: number, z: number) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
const outsideRect = (r: Rect, x: number, z: number) => Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));
const rectAt = (x: number, z: number, width: number, depth: number): Rect => ({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 });
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const series = (from: number, step: number, count: number) => Array.from({ length: count }, (_, k) => from + step * k);

/** Builds a value the first time it is asked for. The plan is fixed, so each list is made once. */
function once<T>(build: () => T): () => T {
  let value: T | undefined;
  return () => {
    if (value === undefined) value = build();
    return value;
  };
}

/** Inside the boundary wall: 860 x 326 m, 28.0 ha. The stream side is open. */
export const PLAN_SITE: Rect = { minX: -430, maxX: 430, minZ: -260, maxZ: 66 };
/** Ground levels: the valley floor by the stream, and the river terrace the upper boulevard runs on. */
export const PLAN_LEVELS = { valley: PAD_Y, terrace: PAD_Y + 6 } as const;
/** Golden-hour sun, the same as the scene's Zaitun sun (world.ts). Provisional until the real north is known. */
export const PLAN_SUN = { elevationDeg: 4.2, azimuthX: 0.97, azimuthZ: 0.16 } as const;
/** What an orbiting camera looks at: the reflecting pool. */
export const PLAN_CENTER: Point3 = { x: 0, y: 6, z: -60 };

/** Boulevard section from the centre line out: half the 9 m carriageway, the palm verge, the sidewalk, then the plot line. */
export const PLAN_STREET = { carriageway: 9, verge: 3.25, sidewalk: 2.5, frontage: 11 } as const;
/** The two streets that climb from the lower boulevard to the upper one. */
export const PLAN_LINK = { carriageway: 6.5, sidewalk: 2 } as const;
export const PLAN_PROMENADE = { z: 62, width: 8, fromX: -424, toX: 424 } as const;
export const PLAN_WALL = { height: 2.8, thickness: 0.6 } as const;
export const PLAN_GATE = { opening: 18, pavilion: 4.5, pavilionHeight: 5, pavilionOffset: 9.5, lintelLength: 23.5 } as const;

/**
 * Boulevard A runs the length of the valley floor, gate to gate. Boulevard B runs on the terrace
 * between the two link streets. `sway` is how far each drifts from its gate line (A toward the
 * stream, B toward the hill), so the olive bank between them widens and narrows.
 */
const PLAN_BOULEVARDS = {
  a: { gateZ: 2, sway: 7, fromX: -430, toX: 430 },
  b: { gateZ: -158, sway: -10, fromX: -370, toX: 410 },
} as const;
export type PlanBoulevardId = keyof typeof PLAN_BOULEVARDS;
/** x of the west and east link streets (the west one leaves room for the arrival court). */
const PLAN_LINK_X = [-370, 410] as const;

const HALF_LENGTH = 430;

/** 0 at the gates and on the garden axis, 1 halfway between: each boulevard sways once on either side of the garden. */
export function planSway(x: number): number {
  return (1 - Math.cos((2 * Math.PI * Math.min(HALF_LENGTH, Math.abs(x))) / HALF_LENGTH)) / 2;
}

/** Centre line of a boulevard. It meets both gates and the garden axis square on. */
export function planBoulevardZ(id: PlanBoulevardId, x: number): number {
  const b = PLAN_BOULEVARDS[id];
  return b.gateZ + b.sway * planSway(x);
}

// ---------------------------------------------------------------- ground

/** The bank starts 4 m behind the back gardens on either side of it. */
const BANK_SETBACK = 40.5;
/** Foot of the olive bank, behind the row along boulevard A. */
const bankToeZ = (x: number) => planBoulevardZ("a", x) - BANK_SETBACK;
/** Top of the bank, where the terrace begins. */
const bankCrestZ = (x: number) => planBoulevardZ("b", x) + BANK_SETBACK;
/**
 * The central garden is a level bay cut into the bank: the valley floor carries on 60 m either
 * side of the axis as far inland as `headZ`, and the ground climbs to the terrace over `run`
 * metres all around it. The garden steps climb that slope on the axis, up to the belvedere.
 */
export const PLAN_GARDEN_BAY = { halfWidth: 60, headZ: -122, run: 20.5 } as const;
/** Distance outside the garden bay's floor (0 on it). */
const beyondBay = (x: number, z: number) => Math.hypot(Math.max(Math.abs(x) - PLAN_GARDEN_BAY.halfWidth, 0), Math.max(PLAN_GARDEN_BAY.headZ - z, 0));
/** Where the terrace ends and the hillside begins, 4 m behind the upper row's back gardens. */
const hillToeZ = (x: number) => planBoulevardZ("b", x) - 37.1;
/** Rise of the hillside above the terrace, per metre inland. */
export const PLAN_HILL_SLOPE = 0.12;

/** The lines the ground is graded between at x: the foot and the top of the olive bank, and the foot of the hillside. */
export function planBank(x: number): { toeZ: number; crestZ: number; hillZ: number } {
  return { toeZ: bankToeZ(x), crestZ: bankCrestZ(x), hillZ: hillToeZ(x) };
}

/** Areas levelled into the slope, each blended into the ground around it over `margin` metres. */
export const PLAN_PADS: ReadonlyArray<{ id: string; area: Rect; y: number; margin: number }> = [
  // Room to turn the mosque toward Mecca once the real north is known.
  { id: "mosque-court", area: { minX: -426, maxX: -382, minZ: -48, maxZ: -9 }, y: PLAN_LEVELS.valley, margin: 6 },
];

/** Graded ground: valley floor, olive bank, terrace, hillside. Outside the walls the same landforms carry on along the valley. */
function planGrade(x: number, z: number): number {
  const { valley, terrace } = PLAN_LEVELS;
  const toe = bankToeZ(x);
  let y: number = valley;
  if (z < toe) {
    const crest = bankCrestZ(x);
    if (z >= crest) y = mix(valley, terrace, (toe - z) / (toe - crest));
    else {
      const hill = hillToeZ(x);
      y = z >= hill ? terrace : Math.min(terrace + 60, terrace + PLAN_HILL_SLOPE * (hill - z));
    }
    const bay = beyondBay(x, z);
    if (bay < PLAN_GARDEN_BAY.run) y = Math.min(y, mix(valley, terrace, bay / PLAN_GARDEN_BAY.run));
  }
  for (const pad of PLAN_PADS) {
    const d = outsideRect(pad.area, x, z);
    if (d < pad.margin) y = mix(pad.y, y, smoothstep(0, pad.margin, d));
  }
  return y;
}

/** The land as it lies outside the walls: the same valley floor, terrace and hillside, wandering and rolling. */
function planNatural(x: number, z: number): number {
  const r = RIVERS.zaitun;
  const beyondEnds = Math.max(PLAN_SITE.minX - x, 0, x - PLAN_SITE.maxX);
  const wander = 16 * Math.sin(x * 0.006 + 1.3) * smoothstep(0, 160, beyondEnds);
  const farBank = Math.min(60, Math.max(0, z - r.far - 120) * 0.1);
  const base = planGrade(x, z + wander) + farBank;
  // Never below the valley floor's low points, so no stray puddles.
  return Math.max(0.9, base + 0.8 + Math.max(-1, rolling(x, z)) * (2.5 + (base - PLAN_LEVELS.valley) * 0.28));
}

/**
 * Stream centre line: straight along the promenade, bending as soon as it is past the walls
 * (toward the compound's bank upstream, away from it downstream), so it never reads as a canal.
 */
export function planRiverCenterZ(x: number): number {
  const r = RIVERS.zaitun;
  return r.near + r.width / 2 + smoothstep(450, 800, Math.abs(x)) * 55 * Math.sin(x / 420);
}

/** Ground height on the 28 ha plan. The water surface is y = 0; anything below is the stream. */
export function planTerrainHeight(x: number, z: number): number {
  const r = RIVERS.zaitun;
  const outside = outsideRect(PLAN_SITE, x, z);
  const land = outside > 0 ? mix(planGrade(x, z), planNatural(x, z), smoothstep(0, 55, outside)) : planGrade(x, z);
  const fromEdge = Math.abs(z - planRiverCenterZ(x)) - r.width / 2; // < 0 inside the water
  if (fromEdge < 0) return -0.6 - (Math.min(-fromEdge, 30) / 30) * r.bedDepth;
  return -0.6 + (land + 0.6) * smoothstep(0, 16, fromEdge);
}

export function planIsRiver(x: number, z: number): boolean {
  return planTerrainHeight(x, z) < 0.05;
}

// ---------------------------------------------------------------- homes

export type PlanRowId = "waterfront" | "boulevard" | "terrace-view" | "terrace-hill";
export type PlanVilla = VillaPlot & {
  row: PlanRowId;
  /** Level of the ground the villa stands on. */
  y: number;
  /** The private plot. Its area is the home's land area. */
  plot: Rect;
  /** The back garden: from the rear wall to the back of the plot. */
  garden: Rect;
  /** Two-car carport in the forecourt, open toward the street (scripts/blender/amenities.py `carport`). */
  carport: { x: number; z: number; rotation: number };
  /** The drive from the kerb to the plot line, across the verge and the sidewalk. */
  driveway: Rect;
};

/** Width of a villa's drive (its carport is 6.6 m wide) and of a parking court's way in. */
const DRIVE_WIDTH = { villa: 6.6, court: 6 } as const;

/** The strip between a boulevard's kerb and the plot line on one side, `width` wide at x. */
function driveAcross(road: PlanBoulevardId, side: 1 | -1, x: number, width: number): Rect {
  const z = planBoulevardZ(road, x);
  const kerb = z + (side * PLAN_STREET.carriageway) / 2;
  const plotLine = z + side * PLAN_STREET.frontage;
  return { minX: x - width / 2, maxX: x + width / 2, minZ: Math.min(kerb, plotLine), maxZ: Math.max(kerb, plotLine) };
}

type PlanRow = { id: PlanRowId; type: VillaType; road: PlanBoulevardId; side: 1 | -1; xs: number[] };

/**
 * The four rows, each west to east. Villas are numbered row by row in this order, so the
 * courtyard villas come first, then the 4-bed garden villas, then the 3-bed ones.
 * The west side has one villa fewer per row: the arrival court and the west link street are there.
 * The terrace-view row sits half a step off the rows either side of it, so each row sees between the next.
 */
const PLAN_ROWS: PlanRow[] = [
  { id: "waterfront", type: "courtyard", road: "a", side: 1, xs: [...series(-362, 28, 7), ...series(194, 28, 8)] },
  { id: "boulevard", type: "garden-4", road: "a", side: -1, xs: [...series(-340, 38, 7), ...series(112, 38, 8)] },
  { id: "terrace-view", type: "garden-4", road: "b", side: 1, xs: [...series(-321, 38, 7), ...series(93, 38, 8)] },
  { id: "terrace-hill", type: "garden-3", road: "b", side: -1, xs: [...series(-340, 38, 7), ...series(112, 38, 8)] },
];

/**
 * Plot of each villa type: `area` is the land area sold with the home, `setback` the forecourt
 * between the plot line and the front wall, `carport` where the carport stands in the villa's own
 * axes (x to its right, z toward the street).
 */
const PLAN_PLOT: Record<VillaType, { width: number; area: number; setback: number; carport: [number, number] }> = {
  courtyard: { width: 26, area: 780, setback: 6.5, carport: [-9, 14.25] },
  "garden-4": { width: 22, area: 560, setback: 3.5, carport: [5.8, 8.25] },
  "garden-3": { width: 19, area: 420, setback: 3.7, carport: [4.93, 7.45] },
};

function buildVilla(index: number, row: PlanRow, x: number): PlanVilla {
  const size = VILLA_SIZE[row.type];
  const plot = PLAN_PLOT[row.type];
  const front = planBoulevardZ(row.road, x) + row.side * PLAN_STREET.frontage; // the plot line on the street
  const back = front + row.side * (plot.area / plot.width);
  const z = front + row.side * (plot.setback + size.depth / 2);
  const rear = z + row.side * (size.depth / 2);
  const facing = row.side === 1 ? -1 : 1;
  const span = { minX: x - plot.width / 2, maxX: x + plot.width / 2 };
  const carportX = x + facing * plot.carport[0];
  return {
    index,
    row: row.id,
    x,
    z,
    y: row.road === "a" ? PLAN_LEVELS.valley : PLAN_LEVELS.terrace,
    facing,
    type: row.type,
    ...size,
    plot: { ...span, minZ: Math.min(front, back), maxZ: Math.max(front, back) },
    garden: { ...span, minZ: Math.min(rear, back), maxZ: Math.max(rear, back) },
    carport: { x: carportX, z: z + facing * plot.carport[1], rotation: facing === 1 ? 0 : Math.PI },
    driveway: driveAcross(row.road, row.side, carportX, DRIVE_WIDTH.villa),
  };
}

const builtVillas = once(() => {
  const out: PlanVilla[] = [];
  for (const row of PLAN_ROWS) for (const x of row.xs) out.push(buildVilla(out.length, row, x));
  return out;
});

/** The 60 villa plots: 0-14 courtyard (waterfront), 15-29 and 30-44 garden-4, 45-59 garden-3. */
export function planVillas(): ReadonlyArray<PlanVilla> {
  return builtVillas();
}

/** Villa i; indices wrap, so a stray slot never throws in the render loop. */
export function planVilla(i: number): PlanVilla {
  const all = builtVillas();
  return all[((i % all.length) + all.length) % all.length];
}

export type PlanApartmentBlock = {
  index: number;
  x: number;
  /** Level of the ground floor. */
  y: number;
  /** The garden-side wall; floors step back from here toward the stream. */
  backZ: number;
  width: number;
  floors: number;
  floorHeight: number;
  floorDepths: number[];
};

/** Three blocks on either side of the stream plaza, west to east. */
const PLAN_APARTMENT_X = [-156, -104, -52, 52, 104, 156] as const;
/** Front garden between the plot line and each block's entrance. */
const APARTMENT_FRONT_GARDEN = 6;
const PLAN_APARTMENT_FLOORS = 4;

const builtBlocks = once(() =>
  PLAN_APARTMENT_X.map(
    (x, index): PlanApartmentBlock => ({
      index,
      x,
      y: PLAN_LEVELS.valley,
      backZ: planBoulevardZ("a", x) + PLAN_STREET.frontage + APARTMENT_FRONT_GARDEN,
      width: APARTMENT_WIDTH,
      floors: PLAN_APARTMENT_FLOORS,
      floorHeight: FLOOR_HEIGHT,
      floorDepths: series(0, 1, PLAN_APARTMENT_FLOORS).map(apartmentFloorDepth),
    }),
  ),
);

/** The 6 waterfront apartment blocks, one home per floor: 24 apartments. */
export function planApartmentBlocks(): ReadonlyArray<PlanApartmentBlock> {
  return builtBlocks();
}

const blockRect = (b: PlanApartmentBlock): Rect => ({ minX: b.x - b.width / 2, maxX: b.x + b.width / 2, minZ: b.backZ, maxZ: b.backZ + b.floorDepths[0] });

/** Marker anchor above villa i's roof. */
export function planVillaSlot(i: number): Point3 {
  const v = planVilla(i);
  return { x: v.x, y: v.y + v.height + VILLA_MARKER_LIFT, z: v.z };
}

/** Marker anchor for apartment i (block = floor(i / 4), floor = i % 4) at its terrace edge; floors fan out sideways so markers never stack. */
export function planApartmentSlot(i: number): Point3 {
  const blocks = builtBlocks();
  const count = blocks.length * PLAN_APARTMENT_FLOORS;
  const index = ((i % count) + count) % count;
  const block = blocks[Math.floor(index / PLAN_APARTMENT_FLOORS)];
  const floor = index % PLAN_APARTMENT_FLOORS;
  return {
    x: block.x + (floor - 1.5) * 6.5,
    y: block.y + (floor + 1) * block.floorHeight + APARTMENT_MARKER_LIFT,
    z: block.backZ + block.floorDepths[floor],
  };
}

export function planMarkerPosition(marker: Pick<SceneMarker, "kind" | "slot">): Point3 {
  return marker.kind === "villa" ? planVillaSlot(marker.slot) : planApartmentSlot(marker.slot);
}

/** Where a marker's leader line meets the building. */
export function planMarkerBase(marker: Pick<SceneMarker, "kind" | "slot">): Point3 {
  const p = planMarkerPosition(marker);
  return { ...p, y: p.y - (marker.kind === "villa" ? VILLA_MARKER_LIFT : APARTMENT_MARKER_LIFT) };
}

// ---------------------------------------------------------------- amenities and parking

export type PlanAmenityKind = "pool" | "terrace" | "steps" | "belvedere" | "plaza" | "lawn" | "gym" | "padel" | "tennis" | "playground" | "mosque" | "gallery";
export type PlanAmenity = {
  id: string;
  kind: PlanAmenityKind;
  /** Origin: the centre of the asset's footprint, on the ground. */
  x: number;
  y: number;
  z: number;
  /** Turn about +y in radians. At 0 the asset's front faces +z. */
  rotation: number;
  /** World-aligned bounds of everything it covers. */
  footprint: Rect;
  /** The asset's own size arguments (scripts/blender/amenities.py), or the pool rim's size. */
  size?: Record<string, number>;
  /** The model to place, when it reuses one of the homes' models. */
  asset?: string;
};

/** Bounds of each amenity asset in its own axes at the sizes below (measured from scripts/blender/amenities.py). */
const ASSET_BOUNDS = {
  gym: { minX: -15.1, maxX: 15.1, minZ: -9.5, maxZ: 14.6 },
  padel: { minX: -6, maxX: 6, minZ: -11, maxZ: 11 },
  tennis: { minX: -9.75, maxX: 9.75, minZ: -18.5, maxZ: 18.5 },
  playground: { minX: -12, maxX: 12, minZ: -9, maxZ: 9 },
  mosque: { minX: -13.6, maxX: 13, minZ: -10.6, maxZ: 14.25 },
} satisfies Record<string, Rect>;

/** Sizes the amenity assets are built at. */
export const PLAN_ASSET_SIZE = {
  gym: { width: 30, depth: 18, height: 7.2 },
  padel: { length: 20, width: 10 },
  tennis: { length: 36.6, width: 18.3 },
  playground: { width: 24, depth: 18 },
  mosque: { width: 16, depth: 16, height: 7.5, dome_radius: 4.2, minaret_height: 17 },
  carport: { bays: 2, bay_width: 3, depth: 6, height: 2.8 },
  parking: { bay_width: 2.5, bay_depth: 5, aisle: 6 },
} as const;

/** World-aligned bounds of an asset placed at (x, z) and turned by `rotation` about +y. */
function placedBounds(local: Rect, x: number, z: number, rotation: number): Rect {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const corners = [local.minX, local.maxX].flatMap((lx) => [local.minZ, local.maxZ].map((lz) => [lx * c + lz * s, lz * c - lx * s]));
  const xs = corners.map((p) => p[0]);
  const zs = corners.map((p) => p[1]);
  return { minX: x + Math.min(...xs), maxX: x + Math.max(...xs), minZ: z + Math.min(...zs), maxZ: z + Math.max(...zs) };
}

/** The sales gallery is a courtyard villa by the main gate, fitted out as the show home. It is not for sale. */
const GALLERY_X = -411;

const builtAmenities = once((): PlanAmenity[] => {
  const { valley, terrace } = PLAN_LEVELS;
  const area = (id: string, kind: PlanAmenityKind, footprint: Rect, y: number, size?: Record<string, number>): PlanAmenity => ({
    id,
    kind,
    x: (footprint.minX + footprint.maxX) / 2,
    y,
    z: (footprint.minZ + footprint.maxZ) / 2,
    rotation: 0,
    footprint,
    ...(size ? { size } : {}),
  });
  const asset = (id: string, kind: keyof typeof ASSET_BOUNDS, x: number, z: number, rotation = 0): PlanAmenity => ({
    id,
    kind,
    x,
    y: valley,
    z,
    rotation,
    footprint: placedBounds(ASSET_BOUNDS[kind], x, z, rotation),
    size: { ...PLAN_ASSET_SIZE[kind] },
  });
  const galleryFront = planBoulevardZ("a", GALLERY_X) + PLAN_STREET.frontage;
  const courtyard = VILLA_SIZE.courtyard;
  const plot = PLAN_PLOT.courtyard;
  return [
    // The garden axis, from the stream to the upper boulevard. The pool comes first: it lies inside the terrace.
    area("pool", "pool", rectAt(0, -66, 12, 72), valley, { width: 12, depth: 72, height: 0.35 }),
    area("garden-terrace", "terrace", { minX: -11, maxX: 11, minZ: -122, maxZ: -9 }, valley),
    area("garden-steps", "steps", { minX: -4, maxX: 4, minZ: -143, maxZ: -122 }, valley, { rise: terrace - valley }),
    area("belvedere", "belvedere", { minX: -12, maxX: 12, minZ: -151, maxZ: -143 }, terrace),
    area("stream-plaza", "plaza", { minX: -28, maxX: 28, minZ: 44, maxZ: 58 }, valley),
    area("lawn", "lawn", { minX: 16, maxX: 56, minZ: -112, maxZ: -64 }, valley),
    // West of the pool: the gym's terrace looks across the padel courts and the water, into the evening sun.
    asset("gym", "gym", -50.5, -55, Math.PI / 2),
    asset("padel-1", "padel", -22.5, -42),
    asset("padel-2", "padel", -22.5, -68),
    asset("tennis", "tennis", -22.5, -100.5),
    // East of the pool.
    asset("playground", "playground", 26, -44),
    // By the main gate. The mosque's qibla wall is its -z side: turn it once the real north is known.
    asset("mosque", "mosque", -404, -26),
    {
      id: "gallery",
      kind: "gallery",
      x: GALLERY_X,
      y: valley,
      z: galleryFront + plot.setback + courtyard.depth / 2,
      rotation: Math.PI,
      footprint: { minX: GALLERY_X - plot.width / 2, maxX: GALLERY_X + plot.width / 2, minZ: galleryFront, maxZ: galleryFront + plot.area / plot.width },
      size: { ...courtyard },
      asset: "villa-courtyard",
    },
  ];
});

/** The garden axis, the sports and play areas, the mosque and the sales gallery. */
export function planAmenities(): ReadonlyArray<PlanAmenity> {
  return builtAmenities();
}

export type PlanParking = {
  id: string;
  serves: "visitors" | "apartments" | "gym" | "service";
  /** Origin of the parking court (scripts/blender/amenities.py `parking`: the aisle runs along its x, the way in is at its +x end). */
  x: number;
  y: number;
  z: number;
  rotation: number;
  baysPerSide: number;
  spaces: number;
  footprint: Rect;
  /** The way in from boulevard A, across the verge and the sidewalk. */
  driveway: Rect;
};

function parkingCourt(id: string, serves: PlanParking["serves"], x: number, riverSide: boolean, baysPerSide: number): PlanParking {
  const run = baysPerSide * PLAN_ASSET_SIZE.parking.bay_width;
  const local: Rect = { minX: -(run / 2 + 1.6), maxX: run / 2 + 1, minZ: -9.3, maxZ: 9.3 };
  // The way in is 1 m behind the plot line, facing boulevard A.
  const side = riverSide ? 1 : -1;
  const z = planBoulevardZ("a", x) + side * (PLAN_STREET.frontage + 1 + run / 2 + 1);
  const rotation = (side * Math.PI) / 2;
  const driveway = driveAcross("a", side, x, DRIVE_WIDTH.court);
  return { id, serves, x, y: PLAN_LEVELS.valley, z, rotation, baysPerSide, spaces: baysPerSide * 2, footprint: placedBounds(local, x, z, rotation), driveway };
}

const builtParking = once((): PlanParking[] => [
  parkingCourt("visitors", "visitors", -387.3, true, 10),
  parkingCourt("apartments-1", "apartments", -130, true, 8),
  parkingCourt("apartments-2", "apartments", -78, true, 8),
  parkingCourt("apartments-3", "apartments", 78, true, 8),
  parkingCourt("apartments-4", "apartments", 130, true, 8),
  parkingCourt("gym", "gym", -82, false, 8),
  parkingCourt("service", "service", 415, true, 6),
]);

/** Shared parking courts. Each villa also has its own carport (`planVillas()[i].carport`). */
export function planParking(): ReadonlyArray<PlanParking> {
  return builtParking();
}

// ---------------------------------------------------------------- streets, walks, gates, walls

export type PlanRoad = {
  id: string;
  kind: "boulevard" | "street" | "promenade" | "walk";
  /** Paved width: the carriageway of a street, the whole width of a walk. */
  width: number;
  /** Centre line as [x, y, z], following the ground. */
  path: Array<[number, number, number]>;
};

/** Straight walks, as centre lines with a width. */
const PLAN_WALKS: Array<{ id: string; from: [number, number]; to: [number, number]; width: number }> = [
  // From boulevard A down the garden axis to the stream plaza.
  { id: "plaza-walk", from: [0, 13], to: [0, 44], width: 8 },
  // Across the garden in front of the pool: gym parking to the playground and the lawn.
  { id: "garden-walk", from: [-72.7, -21], to: [57.5, -21], width: 3 },
  // Along the courts, between the gym terrace and the padel courts.
  { id: "courts-walk", from: [-32.5, -19.5], to: [-32.5, -80.5], width: 3 },
  // From the gym terrace to the pool, between the two padel courts.
  { id: "gym-walk", from: [-31, -55], to: [-11, -55], width: 3 },
  // East of the pool: between the playground and the lawn, and down the lawn's far side.
  { id: "lawn-walk", from: [11, -58.5], to: [59, -58.5], width: 3 },
  { id: "orchard-walk", from: [57.5, -19.5], to: [57.5, -112], width: 3 },
];

const walkRect = (w: (typeof PLAN_WALKS)[number]): Rect => {
  const alongX = w.from[1] === w.to[1];
  return {
    minX: Math.min(w.from[0], w.to[0]) - (alongX ? 0 : w.width / 2),
    maxX: Math.max(w.from[0], w.to[0]) + (alongX ? 0 : w.width / 2),
    minZ: Math.min(w.from[1], w.to[1]) - (alongX ? w.width / 2 : 0),
    maxZ: Math.max(w.from[1], w.to[1]) + (alongX ? w.width / 2 : 0),
  };
};

/** A line from a to b in steps of about `step` metres, with the ground height at each point. */
function groundLine(a: [number, number], b: [number, number], step: number): Array<[number, number, number]> {
  const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  return Array.from({ length: n + 1 }, (_, i): [number, number, number] => {
    const x = mix(a[0], b[0], i / n);
    const z = mix(a[1], b[1], i / n);
    return [x, planTerrainHeight(x, z), z];
  });
}

const builtRoads = once((): PlanRoad[] => {
  const boulevard = (id: PlanBoulevardId, fromX: number, toX: number): PlanRoad => {
    const n = Math.round((toX - fromX) / 6);
    const path = Array.from({ length: n + 1 }, (_, i): [number, number, number] => {
      const x = mix(fromX, toX, i / n);
      const z = planBoulevardZ(id, x);
      return [x, planTerrainHeight(x, z), z];
    });
    return { id: `boulevard-${id}`, kind: "boulevard", width: PLAN_STREET.carriageway, path };
  };
  const link = (id: string, x: number): PlanRoad => ({
    id,
    kind: "street",
    width: PLAN_LINK.carriageway,
    path: groundLine([x, planBoulevardZ("a", x)], [x, planBoulevardZ("b", x)], 6),
  });
  const { a, b } = PLAN_BOULEVARDS;
  return [
    // Boulevard A carries on 30 m past each gate to meet the road outside.
    boulevard("a", a.fromX - 30, a.toX + 30),
    boulevard("b", b.fromX, b.toX),
    link("link-west", PLAN_LINK_X[0]),
    link("link-east", PLAN_LINK_X[1]),
    { id: "promenade", kind: "promenade", width: PLAN_PROMENADE.width, path: groundLine([PLAN_PROMENADE.fromX, PLAN_PROMENADE.z], [PLAN_PROMENADE.toX, PLAN_PROMENADE.z], 12) },
    ...PLAN_WALKS.map((w): PlanRoad => ({ id: w.id, kind: "walk", width: w.width, path: groundLine(w.from, w.to, 6) })),
  ];
});

/** Boulevards, link streets, the promenade and the garden walks. */
export function planRoads(): ReadonlyArray<PlanRoad> {
  return builtRoads();
}

export type PlanGate = {
  id: "main" | "east";
  x: number;
  y: number;
  z: number;
  /** Centres of the twin pavilions that flank the gate, joined by the brass lintel. */
  pavilions: Array<{ x: number; z: number }>;
};

/** The main gate (west, with the arrival court inside it) and the east gate, both on boulevard A. */
export function planGates(): PlanGate[] {
  return (["main", "east"] as const).map((id) => {
    const x = id === "main" ? PLAN_SITE.minX : PLAN_SITE.maxX;
    const z = planBoulevardZ("a", x);
    return { id, x, y: PLAN_LEVELS.valley, z, pavilions: [-1, 1].map((s) => ({ x, z: z + s * PLAN_GATE.pavilionOffset })) };
  });
}

/** Boundary wall runs as [x, z] pairs: both side walls with their gate openings, and the back wall. The stream side is open. */
export function planWalls(): Array<{ id: string; from: [number, number]; to: [number, number] }> {
  const { minX, maxX, minZ } = PLAN_SITE;
  const riverEnd = PLAN_PROMENADE.z - PLAN_PROMENADE.width / 2; // side walls stop at the promenade
  const out: Array<{ id: string; from: [number, number]; to: [number, number] }> = [];
  for (const gate of planGates()) {
    const half = PLAN_GATE.opening / 2;
    out.push({ id: `${gate.id}-inland`, from: [gate.x, minZ], to: [gate.x, gate.z - half] });
    out.push({ id: `${gate.id}-stream`, from: [gate.x, gate.z + half], to: [gate.x, riverEnd] });
  }
  out.push({ id: "back", from: [minX, minZ], to: [maxX, minZ] });
  return out;
}

export type PlanFixture = { x: number; y: number; z: number; rotation: number };

/** Lamps stand 26 m apart along a street, at x = 13, 39, ... so none stands on the garden axis. */
const LAMP_SPACING = 26;
const LAMP_FIRST_X = 13;
/** Boulevard palms stand 13 m apart at x = 6.5, 19.5, ...: a lamp falls midway between every other pair. */
const PALM_SPACING = 13;
const PALM_FIRST_X = 6.5;
const lampXs = (fromX: number, toX: number) => series(LAMP_FIRST_X - LAMP_SPACING * 20, LAMP_SPACING, 41).filter((x) => x >= fromX + 8 && x <= toX - 8);

/** Every drive that crosses a verge: one per villa and one per parking court. */
function builtDrives(): Rect[] {
  return [...builtVillas().map((v) => v.driveway), ...builtParking().map((p) => p.driveway)];
}

/** Street lamps: both sides of the boulevards, one side of the link streets and the promenade. The arm points at local +z. */
export function planLamps(): PlanFixture[] {
  const out: PlanFixture[] = [];
  const add = (x: number, z: number, rotation: number) => out.push({ x, y: planTerrainHeight(x, z), z, rotation });
  const kerb = PLAN_STREET.carriageway / 2 + 0.55;
  const drives = builtDrives();
  /** A lamp that would stand in a drive moves to 0.8 m beside it. */
  const beside = (x: number, z: number) => {
    const drive = drives.find((d) => x > d.minX - 0.8 && x < d.maxX + 0.8 && z >= d.minZ && z <= d.maxZ);
    if (!drive) return x;
    return x - drive.minX < drive.maxX - x ? drive.minX - 0.8 : drive.maxX + 0.8;
  };
  for (const id of ["a", "b"] as const) {
    const b = PLAN_BOULEVARDS[id];
    for (const x of lampXs(b.fromX, b.toX)) {
      for (const [side, rotation] of [[-1, 0], [1, Math.PI]] as const) {
        const lampX = beside(x, planBoulevardZ(id, x) + side * kerb);
        add(lampX, planBoulevardZ(id, lampX) + side * kerb, rotation);
      }
    }
  }
  for (const x of PLAN_LINK_X) {
    const from = planBoulevardZ("a", x) - 24;
    const to = planBoulevardZ("b", x) + 24;
    const n = Math.round((from - to) / 26);
    for (let i = 0; i <= n; i++) add(x + PLAN_LINK.carriageway / 2 + 0.55, mix(from, to, i / n), -Math.PI / 2);
  }
  const edge = PLAN_PROMENADE.z - PLAN_PROMENADE.width / 2 - 0.55;
  for (const x of lampXs(PLAN_PROMENADE.fromX, PLAN_PROMENADE.toX)) add(x, edge, 0);
  return out;
}

/** Limestone benches along the inland edge of the promenade, facing the stream. */
export function planBenches(): PlanFixture[] {
  const z = PLAN_PROMENADE.z - PLAN_PROMENADE.width / 2 + 1.4;
  return series(-390, 52, 16).map((x) => ({ x, y: planTerrainHeight(x, z), z, rotation: 0 }));
}

// ---------------------------------------------------------------- land use and planting

export type PlanLandUse =
  | "outside"
  | "road"
  | "paving"
  | "parking"
  | "plot"
  | "building"
  | "court"
  | "play"
  | "reserve"
  | "water"
  | "verge"
  | "river-lawn"
  | "palm-garden"
  | "lawn"
  | "olive-grove"
  | "olive-terrace";

/** The land uses that count toward the landscape share. */
export const PLAN_LANDSCAPE: ReadonlyArray<PlanLandUse> = ["water", "verge", "river-lawn", "palm-garden", "lawn", "olive-grove", "olive-terrace"];

/**
 * Land on the hillside kept for a later phase (a third street with one row of villas): between
 * the link streets, from 4 m behind the terrace to 4 m inside the back wall, leaving a clear ride
 * up the garden axis. It is planted as olive terraces until then, and is not counted as
 * landscape, so the landscape share is the share that stays green once the compound is fully built.
 */
const PLAN_RESERVE = { fromX: -359, toX: 399, rideHalfWidth: 39, margin: 4 } as const;

function inReserve(x: number, z: number): boolean {
  const r = PLAN_RESERVE;
  return x >= r.fromX && x <= r.toX && Math.abs(x) >= r.rideHalfWidth && z >= PLAN_SITE.minZ + r.margin && z <= hillToeZ(x) - r.margin;
}

/** Outlines of the two halves of the reserve, as [x, z] pairs. */
export function planReserve(): Array<Array<[number, number]>> {
  const r = PLAN_RESERVE;
  const back = PLAN_SITE.minZ + r.margin;
  return [
    [r.fromX, -r.rideHalfWidth],
    [r.rideHalfWidth, r.toX],
  ].map(([from, to]) => {
    const n = Math.round((to - from) / 10);
    const front = Array.from({ length: n + 1 }, (_, i): [number, number] => {
      const x = mix(from, to, i / n);
      return [x, hillToeZ(x) - r.margin];
    });
    return [[from, back], ...front, [to, back]];
  });
}

/** Half the width of the central garden; beyond it the valley floor between the plots is olive grove. */
const GARDEN_HALF_WIDTH = 96;

const AMENITY_USE: Record<PlanAmenityKind, PlanLandUse> = {
  pool: "water",
  terrace: "paving",
  steps: "paving",
  belvedere: "paving",
  plaza: "paving",
  lawn: "lawn",
  gym: "building",
  padel: "court",
  tennis: "court",
  playground: "play",
  mosque: "building",
  gallery: "plot",
};

function streetUseAt(x: number, z: number): PlanLandUse | null {
  const { carriageway, verge, sidewalk } = PLAN_STREET;
  for (const linkX of PLAN_LINK_X) {
    const d = Math.abs(x - linkX);
    if (d > PLAN_LINK.carriageway / 2 + PLAN_LINK.sidewalk) continue;
    if (z > planBoulevardZ("a", linkX) || z < planBoulevardZ("b", linkX)) continue;
    return d <= PLAN_LINK.carriageway / 2 ? "road" : "paving";
  }
  for (const id of ["a", "b"] as const) {
    const b = PLAN_BOULEVARDS[id];
    if (x < b.fromX - PLAN_LINK.carriageway / 2 || x > b.toX + PLAN_LINK.carriageway / 2) continue;
    const d = Math.abs(z - planBoulevardZ(id, x));
    if (d <= carriageway / 2) return "road";
    if (d <= carriageway / 2 + verge) return "verge";
    if (d <= carriageway / 2 + verge + sidewalk) return "paving";
  }
  if (Math.abs(z - PLAN_PROMENADE.z) <= PLAN_PROMENADE.width / 2 && x >= PLAN_PROMENADE.fromX && x <= PLAN_PROMENADE.toX) return "paving";
  for (const w of PLAN_WALKS) if (inRect(walkRect(w), x, z)) return "paving";
  return null;
}

/** What the plan puts at a point. */
export function planLandUseAt(x: number, z: number): PlanLandUse {
  if (!inRect(PLAN_SITE, x, z)) return "outside";
  for (const a of builtAmenities()) if (inRect(a.footprint, x, z)) return AMENITY_USE[a.kind];
  for (const p of builtParking()) if (inRect(p.footprint, x, z)) return "parking";
  for (const b of builtBlocks()) if (inRect(blockRect(b), x, z)) return "building";
  for (const v of builtVillas()) if (inRect(v.plot, x, z)) return "plot";
  const street = streetUseAt(x, z);
  if (street === "road") return street;
  for (const d of builtDrives()) if (inRect(d, x, z)) return "road";
  if (street) return street;
  if (z > planBoulevardZ("a", x)) return "river-lawn";
  if (z >= bankToeZ(x)) return Math.abs(x) <= GARDEN_HALF_WIDTH ? "palm-garden" : "olive-grove";
  const bay = beyondBay(x, z);
  if (bay === 0) return "palm-garden";
  if (z >= bankCrestZ(x) || bay < PLAN_GARDEN_BAY.run) return "olive-terrace";
  if (z >= hillToeZ(x)) return "olive-grove";
  return inReserve(x, z) ? "reserve" : "olive-terrace";
}

/**
 * Area of each land use inside the walls in m², measured on a grid of `step` metres. The sample
 * points sit off the round numbers the plan is drawn on, so none lands on an edge.
 */
export function planAreas(step = 1): Record<PlanLandUse, number> {
  const out = {} as Record<PlanLandUse, number>;
  const columns = Math.round((PLAN_SITE.maxX - PLAN_SITE.minX) / step);
  const rows = Math.round((PLAN_SITE.maxZ - PLAN_SITE.minZ) / step);
  for (let i = 0; i < columns; i++) {
    for (let j = 0; j < rows; j++) {
      const use = planLandUseAt(PLAN_SITE.minX + (i + 0.37) * step, PLAN_SITE.minZ + (j + 0.37) * step);
      out[use] = (out[use] ?? 0) + step * step;
    }
  }
  return out;
}

export type PlanTreeZone = {
  id: string;
  species: "date-palm" | "olive" | "citrus";
  /**
   * allee: both sides of a street. row: one line. grid: an even grid. terraces: rows that
   * follow the contours. garden: a few trees in each listed area.
   */
  pattern: "allee" | "row" | "grid" | "terraces" | "garden";
  /** Metres between trees. */
  spacing: number;
  /** allee: the street it lines (a `planRoads()` id), how far from its centre line, and the x of one tree where the street runs in x. */
  along?: string;
  offset?: number;
  anchorX?: number;
  /** Ground to keep clear of trees: the drives that cross the verges. */
  clear?: Rect[];
  /** row: the line it follows, as [x, z] pairs. */
  line?: Array<[number, number]>;
  /** grid and terraces: the land uses it fills. */
  fills?: PlanLandUse[];
  /** garden: the areas it plants. */
  areas?: Rect[];
};

/**
 * Where each species goes inside the walls. Palms stay on the valley floor and the two
 * boulevards; everything on a slope is olive. Outside the walls the same rule holds: palms
 * along the stream, olive terraces on the foothills.
 */
export function planTreeZones(): PlanTreeZone[] {
  const palmOffset = PLAN_STREET.carriageway / 2 + PLAN_STREET.verge / 2;
  const riverRow = PLAN_PROMENADE.z - PLAN_PROMENADE.width / 2 - 2;
  return [
    { id: "allee-a", species: "date-palm", pattern: "allee", spacing: PALM_SPACING, along: "boulevard-a", offset: palmOffset, anchorX: PALM_FIRST_X, clear: builtDrives() },
    { id: "allee-b", species: "date-palm", pattern: "allee", spacing: PALM_SPACING, along: "boulevard-b", offset: palmOffset, anchorX: PALM_FIRST_X, clear: builtDrives() },
    { id: "riverside-row", species: "date-palm", pattern: "row", spacing: 11, line: [[PLAN_PROMENADE.fromX, riverRow], [PLAN_PROMENADE.toX, riverRow]] },
    { id: "palm-orchard", species: "date-palm", pattern: "grid", spacing: 12, fills: ["palm-garden"] },
    { id: "river-lawn-palms", species: "date-palm", pattern: "grid", spacing: 18, fills: ["river-lawn"] },
    { id: "link-avenue-west", species: "olive", pattern: "allee", spacing: 9, along: "link-west", offset: PLAN_LINK.carriageway / 2 + PLAN_LINK.sidewalk + 2 },
    { id: "link-avenue-east", species: "olive", pattern: "allee", spacing: 9, along: "link-east", offset: PLAN_LINK.carriageway / 2 + PLAN_LINK.sidewalk + 2 },
    { id: "olive-groves", species: "olive", pattern: "grid", spacing: 9, fills: ["olive-grove"] },
    { id: "olive-terraces", species: "olive", pattern: "terraces", spacing: 9, fills: ["olive-terrace", "reserve"] },
    { id: "citrus-gardens", species: "citrus", pattern: "garden", spacing: 5, areas: builtVillas().map((v) => v.garden) },
  ];
}
