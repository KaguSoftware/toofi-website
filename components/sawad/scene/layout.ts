import type { SceneMarker, SceneVariant } from "./types";

/**
 * Compound masterplan in metres. +x runs downstream along the river, +z points
 * across the river, y is up. The compound sits on the near (z < river) bank.
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

function hills(variant: SceneVariant, x: number, z: number): number {
  const n =
    Math.sin(x * 0.0071 + 0.4) * Math.cos(z * 0.0093 - 1.1) +
    0.55 * Math.sin(x * 0.019 + 1.3) * Math.sin(z * 0.017 + 0.7) +
    0.25 * Math.sin(x * 0.043 - 2.1) * Math.cos(z * 0.039 + 0.3);
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
