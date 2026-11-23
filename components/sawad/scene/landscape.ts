/**
 * Landscape and life on the 28 ha plan (track 3B): where every tree, hedge, shrub and tuft of
 * grass stands, and the paths the people, cars and birds follow. Successor to `palmPositions` and
 * `treePositions` in layout.ts, which keep drawing the 7 ha layout until track 7B switches over.
 *
 * Everything here is pure and deterministic: the same call always returns the same list, so the
 * scene, the Blender film and the tests agree. The rules come from the plan itself
 * (`planTreeZones()`, `planLandUseAt()`, `planVillas()`), never from a second copy of the layout.
 *
 * Plants carry a `cell` (a 64 m tile) so the scene can cull and pick a level of detail per tile,
 * and `lodFor()` / `visibleTriangles()` say what each level costs against the 300k budget.
 * Asset names are the ones in public/sawad/models/vegetation-*.glb and life-*.glb (track 3A).
 */
import {
  PLAN_PROMENADE,
  PLAN_SITE,
  PLAN_STREET,
  PLAN_ASSET_SIZE,
  planAmenities,
  planBoulevardZ,
  planGates,
  planBank,
  planLandUseAt,
  planParking,
  planRiverCenterZ,
  planRoads,
  planTerrainHeight,
  planTreeZones,
  planVillas,
  riverGeometryParams,
  seeded,
  type PlanLandUse,
  type PlanTreeZone,
  type Point3,
  type Rect,
} from "./layout";

export type LandscapeTier = "high" | "low";

/** One plant. `variant` picks olive-a or olive-b (0 or 1); `rank` (0..1) is how early the low tier drops it. */
export type Plant = Point3 & { scale: number; rotation: number; lean: number; variant: 0 | 1; cell: string; rank: number };

/** A hedge module: 2.0 m long, tiling along its own x. `rotation` turns it about +y. */
export type HedgeModule = Point3 & { rotation: number; kind: "hedge-low" | "hedge-tall"; cell: string };

export type Shrub = Point3 & { scale: number; cell: string };
export type Tuft = Point3 & { rotation: number; scale: number; kind: "grass-green" | "grass-dry"; cell: string; rank: number };

export type Landscape = {
  palms: Plant[];
  olives: Plant[];
  citrus: Plant[];
  hedges: HedgeModule[];
  shrubs: Shrub[];
  grass: Tuft[];
};

// ---------------------------------------------------------------- constants

export const CELL_SIZE = 64;
export const cellOf = (x: number, z: number) => `${Math.floor(x / CELL_SIZE)}_${Math.floor(z / CELL_SIZE)}`;

/** Length of a hedge module (scripts/blender/vegetation.py). */
export const HEDGE_MODULE = 2;

/** Olives follow the contours on a 9 m grid. */
const OLIVE_SPACING = 9;
/** Foothill olives run this far inland of the back wall and this far along the valley. */
const FOOTHILLS = { depth: 560, halfLength: 1150 } as const;
/** Palms stay in the valley: nothing above this ground height. */
const PALM_MAX_HEIGHT = 14;
/** Olives stop where the hillside gets too steep to terrace. */
const OLIVE_MAX_HEIGHT = 70;

/** Land uses nothing grows in (the plan paves, builds or floods them). */
const BLOCKED: ReadonlySet<PlanLandUse> = new Set(["road", "paving", "parking", "plot", "building", "court", "play", "water"]);

/** Share of each outside class the low tier keeps; the inside of the walls stays whole. */
const LOW_KEEP = { olivesOutside: 0.35, palmsOutside: 0.5, grass: 0.5 } as const;

const WALL_PAD = 6;

// ---------------------------------------------------------------- helpers

const ground = (x: number, z: number) => planTerrainHeight(x, z);
const inRect = (r: Rect, x: number, z: number, pad = 0) => x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
export const insidePlan = (x: number, z: number, pad = 0) => inRect(PLAN_SITE, x, z, pad);

/** True when the point and four points 1.6 m around it are all free to plant (clear of paving, buildings and water). */
function plantable(x: number, z: number, reach = 1.6): boolean {
  if (!insidePlan(x, z)) return true;
  for (const [dx, dz] of [[0, 0], [reach, 0], [-reach, 0], [0, reach], [0, -reach]]) {
    if (BLOCKED.has(planLandUseAt(x + dx, z + dz))) return false;
  }
  return true;
}

/** Boulevard A carries on 30 m past each gate and the road outside meets it: true within `margin` m of its edge. */
function onRoadOutside(x: number, z: number, margin: number): boolean {
  return Math.abs(x) < PLAN_SITE.maxX + 60 && Math.abs(z - planBoulevardZ("a", x)) < PLAN_STREET.carriageway / 2 + margin;
}

/** Whether an olive may stand outside the walls at (x, z): off the river, the road and the walls, on gentle enough ground. */
function openGround(x: number, z: number): boolean {
  if (insidePlan(x, z, WALL_PAD)) return false;
  const y = ground(x, z);
  if (y < 1.2 || y > OLIVE_MAX_HEIGHT) return false;
  return !onRoadOutside(x, z, PLAN_STREET.verge + 3);
}

type Maker = (x: number, z: number, scale: number, lean: number, rank?: number) => Plant;

function plantMaker(rand: () => number, yOffset: number): Maker {
  return (x, z, scale, lean, rank = rand()) => ({
    x,
    y: ground(x, z) - yOffset,
    z,
    scale: scale * (0.86 + rand() * 0.28),
    rotation: rand() * Math.PI * 2,
    lean,
    variant: rand() < 0.3 ? 1 : 0,
    cell: cellOf(x, z),
    rank,
  });
}

const jitter = (rand: () => number, amount: number) => (rand() - 0.5) * 2 * amount;

function inAny(rects: ReadonlyArray<Rect> | undefined, x: number, z: number, pad: number): boolean {
  return !!rects && rects.some((r) => inRect(r, x, z, pad));
}

// ---------------------------------------------------------------- zones inside the walls

type Candidate = { x: number; z: number };

/** Candidates of one `planTreeZones()` entry, before the land-use filter. */
function zoneCandidates(zone: PlanTreeZone, rand: () => number): Candidate[] {
  const out: Candidate[] = [];
  if (zone.pattern === "allee" && zone.along) {
    const road = planRoads().find((r) => r.id === zone.along);
    if (!road) return out;
    const offset = zone.offset ?? 0;
    if (zone.along.startsWith("boulevard")) {
      // Boulevards run along x: trees stand on the anchor's phase, both sides of the kerb.
      const id = zone.along.endsWith("-b") ? "b" : "a";
      const first = road.path[0][0];
      const last = road.path[road.path.length - 1][0];
      const anchor = zone.anchorX ?? 0;
      const start = anchor + Math.ceil((first + 8 - anchor) / zone.spacing) * zone.spacing;
      for (let x = start; x <= last - 8; x += zone.spacing) {
        for (const side of [-1, 1]) out.push({ x, z: planBoulevardZ(id, x) + side * offset });
      }
    } else {
      // Link streets run along z: walk the centre line and step sideways.
      for (let i = 0; i < road.path.length - 1; i++) {
        const [x0, , z0] = road.path[i];
        const [x1, , z1] = road.path[i + 1];
        const len = Math.hypot(x1 - x0, z1 - z0);
        for (let d = i === 0 ? 8 : 0; d < len; d += zone.spacing) {
          const t = d / len;
          for (const side of [-1, 1]) out.push({ x: x0 + (x1 - x0) * t + side * offset, z: z0 + (z1 - z0) * t });
        }
      }
    }
  } else if (zone.pattern === "row" && zone.line) {
    for (let i = 0; i < zone.line.length - 1; i++) {
      const [x0, z0] = zone.line[i];
      const [x1, z1] = zone.line[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.floor(len / zone.spacing));
      for (let k = 0; k <= n; k++) out.push({ x: x0 + ((x1 - x0) * k) / n + jitter(rand, 0.8), z: z0 + ((z1 - z0) * k) / n + jitter(rand, 0.8) });
    }
  } else if (zone.pattern === "grid") {
    // Anchored to the grid lines, so a different site rectangle never shifts the trees.
    for (let x = Math.ceil(PLAN_SITE.minX / zone.spacing) * zone.spacing; x <= PLAN_SITE.maxX; x += zone.spacing) {
      for (let z = Math.ceil(PLAN_SITE.minZ / zone.spacing) * zone.spacing; z <= PLAN_SITE.maxZ; z += zone.spacing) {
        const cx = x + jitter(rand, 0.6);
        const cz = z + jitter(rand, 0.6);
        if (zone.fills?.includes(planLandUseAt(cx, cz))) out.push({ x: cx, z: cz });
      }
    }
  } else if (zone.pattern === "terraces") {
    // Rows follow the contours: each one is a fixed distance inland from a curve of the plan.
    for (let x = Math.ceil(PLAN_SITE.minX / zone.spacing) * zone.spacing; x <= PLAN_SITE.maxX; x += zone.spacing) {
      const bank = planBank(x);
      const rows = [
        ...Array.from({ length: Math.floor((bank.toeZ - bank.crestZ) / zone.spacing) }, (_, k) => bank.toeZ - zone.spacing / 2 - k * zone.spacing),
        ...Array.from({ length: Math.floor((bank.hillZ - PLAN_SITE.minZ) / zone.spacing) }, (_, k) => bank.hillZ - zone.spacing / 2 - k * zone.spacing),
      ];
      for (const z of rows) {
        const cx = x + jitter(rand, 0.6);
        const cz = z + jitter(rand, 0.4);
        if (zone.fills?.includes(planLandUseAt(cx, cz))) out.push({ x: cx, z: cz });
      }
    }
  }
  return out;
}

function treesInsideWalls(rand: () => number): { palms: Plant[]; olives: Plant[] } {
  const palmMaker = plantMaker(rand, 0.3);
  const oliveMaker = plantMaker(rand, 0.1);
  const palms: Plant[] = [];
  const olives: Plant[] = [];
  for (const zone of planTreeZones()) {
    if (zone.species === "citrus") continue;
    for (const c of zoneCandidates(zone, rand)) {
      if (!insidePlan(c.x, c.z)) continue;
      if (inAny(zone.clear, c.x, c.z, 1.6)) continue;
      // Allée and row trees stand on a verge or at a paving edge by design; only the stems must be clear of buildings and water.
      const reach = zone.pattern === "allee" || zone.pattern === "row" ? 0 : 1.6;
      if (zone.pattern === "allee" || zone.pattern === "row") {
        const use = planLandUseAt(c.x, c.z);
        if (use === "building" || use === "water" || use === "plot" || use === "parking" || use === "court" || use === "play") continue;
      } else if (!plantable(c.x, c.z, reach)) continue;
      if (zone.species === "date-palm") palms.push(palmMaker(c.x, c.z, zone.pattern === "allee" || zone.pattern === "row" ? 1.05 : 1, jitter(rand, 0.25)));
      else olives.push(oliveMaker(c.x, c.z, 0.9, 0));
    }
  }
  return { palms, olives };
}

/** Citrus in the villa back gardens: one row down the middle, 5 m apart, 3 m in from the side fences. */
function citrusGardens(rand: () => number): Plant[] {
  const make = plantMaker(rand, 0.05);
  const out: Plant[] = [];
  const spacing = planTreeZones().find((z) => z.species === "citrus")?.spacing ?? 5;
  for (const v of planVillas()) {
    const g = v.garden;
    if (g.maxZ - g.minZ < 4) continue; // a courtyard villa's garden is the courtyard inside it
    const inset = 3;
    const count = Math.floor((g.maxX - g.minX - 2 * inset) / spacing) + 1;
    const z = (g.minZ + g.maxZ) / 2;
    const x0 = (g.minX + g.maxX) / 2 - ((count - 1) * spacing) / 2;
    for (let k = 0; k < count; k++) out.push(make(x0 + k * spacing, z + jitter(rand, 0.5), 0.9, 0));
  }
  return out;
}

// ---------------------------------------------------------------- outside the walls

/** Palm belts along both banks of the stream and groves in the valley, never above the valley terraces. */
function palmsOutside(rand: () => number): Plant[] {
  const make = plantMaker(rand, 0.3);
  const out: Plant[] = [];
  const width = riverGeometryParams("zaitun").width;
  for (let x = -FOOTHILLS.halfLength; x <= FOOTHILLS.halfLength; x += 7) {
    for (const side of [-1, 1]) {
      if (rand() < 0.35) continue;
      const edge = planRiverCenterZ(x) + side * (width / 2);
      const z = edge + side * (8 + rand() * rand() * 70);
      const px = x + jitter(rand, 2.5);
      if (insidePlan(px, z, WALL_PAD) || ground(px, z) < 1.2 || ground(px, z) > PALM_MAX_HEIGHT) continue;
      if (onRoadOutside(px, z, 4)) continue;
      out.push(make(px, z, 0.95 + rand() * 0.2, jitter(rand, 0.25)));
    }
  }
  // Groves: clusters on the near bank's valley floor, nearer the compound than the olive slopes.
  for (let g = 0; g < 70; g++) {
    const cx = -FOOTHILLS.halfLength + rand() * FOOTHILLS.halfLength * 2;
    const side = rand() < 0.55 ? 1 : -1;
    const cz = planRiverCenterZ(cx) + side * (60 + rand() * rand() * 260);
    const n = 8 + Math.floor(rand() * 18);
    const spread = 40 + rand() * 50;
    for (let k = 0; k < n; k++) {
      const x = cx + jitter(rand, spread / 2);
      const z = cz + jitter(rand, spread * 0.4);
      if (insidePlan(x, z, WALL_PAD) || onRoadOutside(x, z, 4) || ground(x, z) < 1.2 || ground(x, z) > PALM_MAX_HEIGHT) continue;
      out.push(make(x, z, 0.9 + rand() * 0.3, jitter(rand, 0.25)));
    }
  }
  return out;
}

/**
 * Olive terraces on the foothills: rows 9 m apart that follow the same curves as the hill inside
 * the walls (the boulevard's sway, carried past the ends), trees 9 m apart along them, thinning
 * out with distance so the far slopes read as texture and cost almost nothing.
 */
function olivesOutside(rand: () => number): Plant[] {
  const make = plantMaker(rand, 0.1);
  const out: Plant[] = [];
  const spacing = OLIVE_SPACING;
  for (let x = Math.ceil(-FOOTHILLS.halfLength / spacing) * spacing; x <= FOOTHILLS.halfLength; x += spacing) {
    const toe = planBank(x).toeZ;
    const edge = Math.max(0, Math.abs(x) - PLAN_SITE.maxX);
    // The groves fade out toward the ends of the valley.
    const keep = 1 - Math.min(0.7, Math.max(0, Math.abs(x) - 700) / 650);
    const rows: number[] = [];
    // Past the gates the bank, the terrace and the hillside are open land: rows run from the foot of the bank
    // to the end of the foothills. Behind the walls only the hillside beyond the back wall is open.
    const firstRow = edge > 0 ? toe - spacing / 2 : PLAN_SITE.minZ - WALL_PAD - 2;
    for (let z = firstRow; z > PLAN_SITE.minZ - FOOTHILLS.depth; z -= spacing) rows.push(z);
    // Valley floor between the road and the stream, past the gates: olive grove, like inside.
    if (edge > 40) for (let z = toe + 10; z < planBoulevardZ("a", x) - 14; z += spacing) rows.push(z);
    for (const z0 of rows) {
      if (rand() > keep * (1 - Math.min(0.5, Math.max(0, PLAN_SITE.minZ - z0) / (FOOTHILLS.depth * 1.6)))) continue;
      const px = x + jitter(rand, 0.8);
      const pz = z0 + jitter(rand, 0.8);
      if (!openGround(px, pz)) continue;
      out.push(make(px, pz, 0.9 + rand() * 0.3, 0));
    }
  }
  return out;
}

// ---------------------------------------------------------------- hedges, shrubs, grass

/** Tiles a straight line with hedge modules (centre of each module), skipping any module whose centre lies in `skip`. */
function hedgeLine(a: [number, number], b: [number, number], kind: HedgeModule["kind"], skip: ReadonlyArray<Rect>, out: HedgeModule[]) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.floor(len / HEDGE_MODULE);
  const rotation = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  const start = (len - n * HEDGE_MODULE) / 2;
  for (let k = 0; k < n; k++) {
    const d = start + (k + 0.5) * HEDGE_MODULE;
    const x = a[0] + ((b[0] - a[0]) * d) / len;
    const z = a[1] + ((b[1] - a[1]) * d) / len;
    // A module is skipped when any part of it would cross a drive.
    const ex = Math.abs(Math.cos(rotation)) * (HEDGE_MODULE / 2);
    const ez = Math.abs(Math.sin(rotation)) * (HEDGE_MODULE / 2);
    if (skip.some((r) => x + ex > r.minX && x - ex < r.maxX && z + ez > r.minZ && z - ez < r.maxZ)) continue;
    out.push({ x, y: ground(x, z), z, rotation, kind, cell: cellOf(x, z) });
  }
}

/** Clipped hedges: low along every villa front (broken at the drive), tall along the sides of the parking courts. */
function hedges(): HedgeModule[] {
  const out: HedgeModule[] = [];
  const drives = [...planVillas().map((v) => v.driveway), ...planParking().map((p) => p.driveway)];
  for (const v of planVillas()) {
    // The front edge of the plot is the one on the street: its nearest edge to the boulevard.
    const z = v.facing === -1 ? v.plot.minZ + 0.6 : v.plot.maxZ - 0.6;
    hedgeLine([v.plot.minX + 0.6, z], [v.plot.maxX - 0.6, z], "hedge-low", drives, out);
  }
  for (const p of planParking()) {
    // The aisle runs along z (courts are turned a quarter turn): hedges line the two long sides.
    const f = p.footprint;
    for (const x of [f.minX + 0.4, f.maxX - 0.4]) hedgeLine([x, f.minZ + 0.4], [x, f.maxZ - 0.4], "hedge-tall", [], out);
  }
  return out;
}

/** Clipped balls flanking the gate pavilions, inside the walls. */
function shrubs(): Shrub[] {
  const out: Shrub[] = [];
  for (const g of planGates()) {
    const inward = g.x < 0 ? 1 : -1;
    for (const p of g.pavilions) {
      for (const [dx, dz] of [[inward * 4.2, 0], [inward * 4.2, p.z < g.z ? -2.1 : 2.1]]) {
        const x = p.x + dx;
        const z = p.z + dz;
        out.push({ x, y: ground(x, z), z, scale: 1, cell: cellOf(x, z) });
      }
    }
  }
  return out;
}

/** Green tufts on the lawns, dry tufts on the slopes under and between the olives, thinning with distance from the walls. */
function grass(rand: () => number): Tuft[] {
  const out: Tuft[] = [];
  const add = (x: number, z: number, kind: Tuft["kind"]) =>
    out.push({ x, y: ground(x, z), z, rotation: rand() * Math.PI * 2, scale: 0.8 + rand() * 0.6, kind, cell: cellOf(x, z), rank: rand() });
  for (let x = PLAN_SITE.minX; x <= PLAN_SITE.maxX; x += 5) {
    for (let z = PLAN_SITE.minZ; z <= PLAN_SITE.maxZ; z += 5) {
      const px = x + jitter(rand, 2);
      const pz = z + jitter(rand, 2);
      const use = planLandUseAt(px, pz);
      if (use === "lawn" || use === "river-lawn") {
        if (rand() < 0.7 && plantable(px, pz, 0.8)) add(px, pz, "grass-green");
      } else if (use === "olive-terrace" || use === "reserve" || use === "olive-grove") {
        if (rand() < 0.22 && plantable(px, pz, 0.8)) add(px, pz, "grass-dry");
      }
    }
  }
  // A dry band outside the back wall, where the camera looks across the slopes.
  for (let x = PLAN_SITE.minX - 60; x <= PLAN_SITE.maxX + 60; x += 9) {
    for (let z = PLAN_SITE.minZ - WALL_PAD - 2; z > PLAN_SITE.minZ - 140; z -= 9) {
      const px = x + jitter(rand, 3.5);
      const pz = z + jitter(rand, 3.5);
      if (openGround(px, pz) && rand() < 0.45) add(px, pz, "grass-dry");
    }
  }
  return out;
}

// ---------------------------------------------------------------- the whole landscape

const cache = new Map<string, Landscape>();

/** Every plant of the 28 ha plan. The low tier thins what is far from the homes and keeps all of what is inside the walls. */
export function planLandscape(tier: LandscapeTier): Landscape {
  const hit = cache.get(tier);
  if (hit) return hit;
  const inside = treesInsideWalls(seeded(2301));
  const outPalms = palmsOutside(seeded(2302));
  const outOlives = olivesOutside(seeded(2303));
  const outGrass = grass(seeded(2304));
  const keepOutside = (list: Plant[], share: number) => (tier === "high" ? list : list.filter((p) => p.rank < share));
  const result: Landscape = {
    palms: [...inside.palms, ...keepOutside(outPalms, LOW_KEEP.palmsOutside)],
    olives: [...inside.olives, ...keepOutside(outOlives, LOW_KEEP.olivesOutside)],
    citrus: citrusGardens(seeded(2305)),
    hedges: hedges(),
    shrubs: shrubs(),
    grass: tier === "high" ? outGrass : outGrass.filter((t) => t.rank < LOW_KEEP.grass),
  };
  cache.set(tier, result);
  return result;
}

// ---------------------------------------------------------------- level of detail and budget

export type Lod = 0 | 1 | 2 | "card";
export type PlantClass = "olive" | "palm" | "citrus";

/** Triangles of each level of detail, from public/sawad/models/vegetation-high.glb (scripts/blender/out/vegetation-report-high.json). */
export const LOD_TRIANGLES: Record<PlantClass, Record<"0" | "1" | "2" | "card", number>> = {
  olive: { "0": 3300, "1": 800, "2": 450, card: 4 },
  palm: { "0": 3778, "1": 694, "2": 279, card: 4 },
  citrus: { "0": 1330, "1": 272, "2": 272, card: 4 },
};

/** Camera distance (m) at which each level hands over to the next. The low tier has no level 0. */
export const LOD_DISTANCE: Record<LandscapeTier, [number, number, number]> = {
  high: [22, 60, 140],
  low: [0, 50, 110],
};

export function lodFor(distance: number, tier: LandscapeTier): Lod {
  const [a, b, c] = LOD_DISTANCE[tier];
  if (distance < a) return 0;
  if (distance < b) return 1;
  if (distance < c) return 2;
  return "card";
}

const HEDGE_TRIANGLES = { "hedge-low": 268, "hedge-tall": 396 } as const;

/**
 * Triangles of vegetation a camera at `eye` looking at `target` draws: every plant within 50 degrees
 * of the view direction and 1,400 m, at the level of detail its distance gives. An estimate for the
 * budget (90k of the 300k), not a render count.
 */
export function visibleTriangles(eye: Point3, target: Point3, tier: LandscapeTier): number {
  const land = planLandscape(tier);
  const fx = target.x - eye.x;
  const fy = target.y - eye.y;
  const fz = target.z - eye.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  const cosHalf = Math.cos((50 * Math.PI) / 180);
  const seen = (x: number, y: number, z: number): number | null => {
    const dx = x - eye.x;
    const dy = y - eye.y;
    const dz = z - eye.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > 1400) return null;
    if (d < 1) return d;
    return (dx * fx + dy * fy + dz * fz) / (d * fl) >= cosHalf ? d : null;
  };
  let total = 0;
  const plants: Array<[Plant[], PlantClass]> = [[land.olives, "olive"], [land.palms, "palm"], [land.citrus, "citrus"]];
  for (const [list, cls] of plants) {
    for (const p of list) {
      const d = seen(p.x, p.y, p.z);
      if (d === null) continue;
      const lod = lodFor(d, tier);
      total += LOD_TRIANGLES[cls][String(lod) as "0" | "1" | "2" | "card"];
    }
  }
  for (const h of land.hedges) {
    const d = seen(h.x, h.y, h.z);
    if (d !== null && d < LOD_DISTANCE[tier][1]) total += HEDGE_TRIANGLES[h.kind];
  }
  for (const t of land.grass) {
    const d = seen(t.x, t.y, t.z);
    if (d !== null && d < 90) total += 6;
  }
  return total;
}

// ---------------------------------------------------------------- life

export type PathPoint = [number, number, number];

/** A route: open routes are walked back and forth, closed ones round and round. */
export type LifeRoute = { points: PathPoint[]; closed: boolean };

export type Clip = "walk" | "run" | "idle" | "swing" | "sit";

/** People are the `person-*` assets of life-<tier>.glb on the shared `person-rig`. */
export type Walker = {
  id: string;
  asset: string;
  clip: Clip;
  /** Metres per second; 0 for someone standing, sitting or playing in place. */
  speed: number;
  scale: number;
  /** Start offset along the route in seconds, so people never step in unison. */
  phase: number;
  route: LifeRoute;
  /** Heading for people who stand still, radians about +y (0 faces +z). */
  heading: number;
};

export type CarKind = "car-sedan" | "car-suv" | "car-pickup";
export type MovingCar = { id: string; asset: CarKind; tint: string; speed: number; phase: number; route: LifeRoute };
export type ParkedCar = Point3 & { id: string; asset: CarKind; tint: string; rotation: number };

export type BirdFlock = {
  id: string;
  /** Birds in the flock on this tier. */
  count: number;
  /** Circuit: an ellipse about (cx, cz), `altitude` m above the ground there, at `speed` m/s. */
  cx: number;
  cz: number;
  rx: number;
  rz: number;
  altitude: number;
  speed: number;
  clockwise: boolean;
};

export type Life = { walkers: Walker[]; moving: MovingCar[]; parked: ParkedCar[]; flocks: BirdFlock[] };

/** What each tier may draw at once (the skinned people are the expensive part). */
export const LIFE_BUDGET = {
  high: { walkers: 30, moving: 6, parked: 34, birds: 44 },
  low: { walkers: 10, moving: 3, parked: 14, birds: 14 },
} as const;

const CAR_TINTS = ["#d9d6cf", "#2c2f33", "#8d949b", "#b5b0a4", "#6f5a46", "#c9c4b8", "#1f2a3a"];

const groundPoint = (x: number, z: number): PathPoint => [x, ground(x, z), z];

function polyline(pairs: Array<[number, number]>, step = 4): PathPoint[] {
  const out: PathPoint[] = [];
  for (let i = 0; i < pairs.length - 1; i++) {
    const [x0, z0] = pairs[i];
    const [x1, z1] = pairs[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) out.push(groundPoint(x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n));
  }
  return out;
}

/** Total length of a route in metres (closed routes include the way back to the start). */
export function routeLength(route: LifeRoute): number {
  const p = route.points;
  let len = 0;
  for (let i = 0; i < p.length - 1; i++) len += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][2] - p[i][2]);
  if (route.closed && p.length > 1) len += Math.hypot(p[0][0] - p[p.length - 1][0], p[0][2] - p[p.length - 1][2]);
  return len;
}

/** A place and a heading (radians about +y, 0 facing +z). */
export type PathPose = { x: number; y: number; z: number; heading: number };

/** A route measured once: its points with the way back for closed routes, each segment's length, and the total. */
type MeasuredRoute = { pts: PathPoint[]; segs: number[]; total: number };

/**
 * Routes are planned once and never edited afterwards, so each is measured once. samplePath runs
 * per walker and car on every frame, and copying and re-measuring the route there was the steadiest
 * garbage in the frame (ledger T22).
 */
const measured = new WeakMap<LifeRoute, MeasuredRoute>();

function measure(route: LifeRoute): MeasuredRoute {
  let m = measured.get(route);
  if (m) return m;
  const pts = route.closed && route.points.length > 0 ? [...route.points, route.points[0]] : route.points;
  const segs: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) segs.push(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][2] - pts[i][2]));
  m = { pts, segs, total: routeLength(route) };
  measured.set(route, m);
  return m;
}

function setPose(out: PathPose | undefined, x: number, y: number, z: number, heading: number): PathPose {
  if (!out) return { x, y, z, heading };
  out.x = x;
  out.y = y;
  out.z = z;
  out.heading = heading;
  return out;
}

/**
 * Position and heading `distance` metres along a route. Open routes bounce, closed ones wrap.
 * Pass `out` to have the pose written into it (no garbage per frame); without it a new object is returned.
 */
export function samplePath(route: LifeRoute, distance: number, out?: PathPose): PathPose {
  const { pts, segs, total } = measure(route);
  if (pts.length < 2 || total === 0) return setPose(out, pts[0][0], pts[0][1], pts[0][2], 0);
  let d: number;
  let reverse = false;
  if (route.closed) d = ((distance % total) + total) % total;
  else {
    const m = ((distance % (2 * total)) + 2 * total) % (2 * total);
    reverse = m > total;
    d = reverse ? 2 * total - m : m;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const seg = segs[i];
    if (d <= seg || i === pts.length - 2) {
      const t = seg === 0 ? 0 : Math.min(1, d / seg);
      const heading = Math.atan2(b[0] - a[0], b[2] - a[2]) + (reverse ? Math.PI : 0);
      return setPose(out, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, heading);
    }
    d -= seg;
  }
  const last = pts[pts.length - 1];
  return setPose(out, last[0], last[1], last[2], 0);
}

/**
 * A bird of a flock at time t (seconds): position and heading, deterministic so a flock never needs a stored state.
 * Pass `out` to have the pose written into it; without it a new object is returned.
 */
export function birdPosition(flock: BirdFlock, index: number, t: number, out?: PathPose): PathPose {
  const dir = flock.clockwise ? -1 : 1;
  const mean = (flock.rx + flock.rz) / 2;
  const w = (dir * flock.speed) / mean;
  // Each bird holds its own place in the flock: a small offset in angle, radius and height.
  const h = Math.sin((index + 1) * 12.9898) * 43758.5453;
  const r1 = h - Math.floor(h);
  const g = Math.sin((index + 1) * 78.233) * 12345.6789;
  const r2 = g - Math.floor(g);
  const a = w * t + (r1 - 0.5) * 0.35 + index * 0.02;
  const rx = flock.rx * (0.94 + r2 * 0.12);
  const rz = flock.rz * (0.94 + r1 * 0.12);
  const x = flock.cx + Math.cos(a) * rx;
  const z = flock.cz + Math.sin(a) * rz;
  const y = Math.max(ground(x, z), 0) + flock.altitude + (r2 - 0.5) * 9 + Math.sin(a * 3 + index) * 2.2;
  const heading = Math.atan2(-Math.sin(a) * rx * dir, Math.cos(a) * rz * dir);
  return setPose(out, x, y, z, heading);
}

const outfits = {
  men: ["person-man-shirt", "person-man-jacket", "person-man-kurdish"],
  women: ["person-woman-abaya", "person-woman-coat", "person-woman-skirt"],
  kids: ["person-boy", "person-girl", "person-boy-2"],
} as const;

function walkers(rand: () => number, tier: LandscapeTier): Walker[] {
  const out: Walker[] = [];
  const all = planAmenities();
  const amenity = (id: string) => all.find((a) => a.id === id)!;
  const pick = <T,>(list: ReadonlyArray<T>) => list[Math.floor(rand() * list.length)];
  const walker = (id: string, asset: string, clip: Clip, speed: number, scale: number, route: LifeRoute, heading = 0): Walker => ({
    id,
    asset,
    clip,
    speed,
    scale,
    phase: rand() * 40,
    route,
    heading,
  });
  const walk = (pairs: Array<[number, number]>): LifeRoute => ({ points: polyline(pairs), closed: false });
  const promenadeZ = PLAN_PROMENADE.z;
  const stand = (x: number, z: number): LifeRoute => ({ points: [groundPoint(x, z)], closed: false });

  // Families, couples and joggers on the promenade, in both directions.
  const promenade = [
    ["couple", [-250, promenadeZ - 1.5], [-120, promenadeZ - 1.5]],
    ["couple", [60, promenadeZ + 1.2], [220, promenadeZ + 1.2]],
    ["walk", [-330, promenadeZ + 0.5], [-180, promenadeZ + 0.5]],
    ["walk", [150, promenadeZ - 0.8], [330, promenadeZ - 0.8]],
  ] as const;
  promenade.forEach(([kind, a, b], i) => {
    const route = walk([[...a], [...b]]);
    if (kind === "couple") {
      out.push(walker(`promenade-${i}-a`, pick(outfits.men), "walk", 1.25, 1, route));
      out.push(walker(`promenade-${i}-b`, pick(outfits.women), "walk", 1.25, 0.96, { ...route, points: route.points.map(([x, y, z]): PathPoint => [x, y, z + 0.9]) }));
    } else out.push(walker(`promenade-${i}`, pick([...outfits.men, ...outfits.women]), "walk", 1.35, 0.97 + rand() * 0.06, route));
  });
  // A family on the stream plaza walk, with a child running ahead.
  out.push(walker("plaza-father", "person-man-jacket", "walk", 1.1, 1, walk([[0, 13], [0, 44]])));
  out.push(walker("plaza-mother", "person-woman-coat", "walk", 1.1, 0.96, walk([[1.2, 13], [1.2, 44]])));
  out.push(walker("plaza-child", "person-girl", "run", 2.3, 0.68, walk([[-1.4, 14], [-1.4, 43]])));
  // Along the garden walks.
  out.push(walker("garden-walk-1", "person-woman-skirt", "walk", 1.2, 0.97, walk([[-70, -21], [55, -21]])));
  out.push(walker("garden-walk-2", "person-man-shirt", "walk", 1.3, 1, walk([[56, -21], [-70, -21]])));
  // Someone walking to the mosque, from the villa blocks near the gate, along boulevard A's sidewalk, then the court.
  const mosque = amenity("mosque");
  const sideZ = planBoulevardZ("a", mosque.x + 30) - (PLAN_STREET.carriageway / 2 + PLAN_STREET.verge + PLAN_STREET.sidewalk / 2);
  out.push(walker("to-mosque", "person-man-kurdish", "walk", 1.2, 1, walk([[mosque.x + 90, sideZ], [mosque.x + 30, sideZ], [mosque.x + 6, mosque.z + 19]])));
  // Padel: four players, a racket each, on the two courts.
  for (const [court, sx] of [["padel-1", 0], ["padel-2", 1]] as const) {
    const c = amenity(court);
    const kit = [["person-man-sport", "person-woman-sport"], ["person-woman-sport", "person-man-sport"]][sx];
    kit.forEach((asset, k) => out.push(walker(`${court}-${k}`, asset, "swing", 0, 1, stand(c.x + (k === 0 ? -2 : 2), c.z + (k === 0 ? -6 : 6)), k === 0 ? 0 : Math.PI)));
  }
  // The playground: children at play and a parent on the bench.
  const play = amenity("playground");
  [
    ["person-boy", -6, -2],
    ["person-girl", 3, 3],
    ["person-boy-2", 7, -4],
  ].forEach(([asset, dx, dz], i) => out.push(walker(`play-${i}`, asset as string, i === 1 ? "idle" : "run", i === 1 ? 0 : 1.8, 0.66 + i * 0.03, { points: polyline([[play.x + (dx as number), play.z + (dz as number)], [play.x + (dx as number) + 5, play.z + (dz as number) + 3]], 1.5), closed: false })));
  out.push(walker("play-parent", "person-woman-abaya", "sit", 0, 0.97, stand(play.x - 11.5, play.z), Math.PI / 2));
  // Benches on the promenade: two people sitting.
  out.push(walker("bench-1", "person-man-shirt", "sit", 0, 1, stand(-390 + 52 * 3, promenadeZ - PLAN_PROMENADE.width / 2 + 1.4), 0));
  out.push(walker("bench-2", "person-woman-coat", "sit", 0, 0.96, stand(-390 + 52 * 9, promenadeZ - PLAN_PROMENADE.width / 2 + 1.4), 0));
  // Lawn: two kids, a ball.
  out.push(walker("lawn-kid-1", "person-boy-2", "run", 2.4, 0.68, walk([[22, -72], [50, -100]])));
  out.push(walker("lawn-kid-2", "person-girl", "run", 2.1, 0.66, walk([[50, -75], [24, -104]])));
  // Boulevard sidewalks: neighbours walking.
  out.push(walker("street-1", "person-woman-skirt", "walk", 1.25, 0.97, walk([[-300, planBoulevardZ("a", -300) + 7.5], [-170, planBoulevardZ("a", -170) + 7.5]])));
  out.push(walker("street-2", "person-man-jacket", "walk", 1.3, 1, walk([[200, planBoulevardZ("a", 200) - 7.5], [330, planBoulevardZ("a", 330) - 7.5]])));
  out.push(walker("street-3", "person-woman-coat", "walk", 1.2, 0.96, walk([[-80, planBoulevardZ("b", -80) + 7.5], [60, planBoulevardZ("b", 60) + 7.5]])));
  out.push(walker("street-4", "person-man-shirt", "walk", 1.3, 1.02, walk([[140, planBoulevardZ("b", 140) - 7.5], [260, planBoulevardZ("b", 260) - 7.5]])));
  return tier === "high" ? out : out.slice(0, LIFE_BUDGET.low.walkers);
}

/** Right-hand traffic: east on boulevard A's river-side lane and back on the other, round the closed loop. */
function loopRoute(id: "a" | "b", fromX: number, toX: number): LifeRoute {
  const lane = PLAN_STREET.carriageway / 4;
  const xs: number[] = [];
  for (let x = fromX; x <= toX; x += 8) xs.push(x);
  // Driving east (+x) on the right means the lane on the +z... in these axes the right of +x is -z.
  const east = xs.map((x): PathPoint => groundPoint(x, planBoulevardZ(id, x) - lane));
  const west = [...xs].reverse().map((x): PathPoint => groundPoint(x, planBoulevardZ(id, x) + lane));
  return { points: [...east, ...west], closed: true };
}

function carsMoving(rand: () => number, tier: LandscapeTier): MovingCar[] {
  const kinds: CarKind[] = ["car-sedan", "car-suv", "car-pickup"];
  const routeA = loopRoute("a", -400, 400);
  const routeB = loopRoute("b", -340, 380);
  const len = (r: LifeRoute) => routeLength(r);
  const out: MovingCar[] = [];
  const spawn = (id: string, route: LifeRoute, share: number, speed: number) => {
    out.push({ id, asset: kinds[Math.floor(rand() * kinds.length)], tint: CAR_TINTS[Math.floor(rand() * CAR_TINTS.length)], speed, phase: (share * len(route)) / speed, route });
  };
  // Speeds of 5 to 8 m/s (18 to 29 km/h): a residential street, one car now and then, never a queue.
  spawn("a-1", routeA, 0.05, 6.5);
  spawn("a-2", routeA, 0.38, 5.5);
  spawn("a-3", routeA, 0.72, 7.2);
  spawn("b-1", routeB, 0.12, 5.2);
  spawn("b-2", routeB, 0.55, 6.1);
  spawn("a-4", routeA, 0.9, 5.8);
  return out.slice(0, LIFE_BUDGET[tier].moving);
}

function carsParked(rand: () => number, tier: LandscapeTier): ParkedCar[] {
  const kinds: CarKind[] = ["car-sedan", "car-suv", "car-pickup"];
  const car = (id: string, x: number, z: number, rotation: number): ParkedCar => ({
    id,
    x,
    y: ground(x, z),
    z,
    rotation,
    asset: kinds[Math.floor(rand() * kinds.length)],
    tint: CAR_TINTS[Math.floor(rand() * CAR_TINTS.length)],
  });
  const out: ParkedCar[] = [];
  // In the carports of about a third of the villas.
  for (const v of planVillas()) {
    if (rand() > 0.34) continue;
    const c = v.carport;
    // A two-bay carport is 6 m wide by 6 m deep; the car sits in the first bay, nose to the street.
    const lateral = (PLAN_ASSET_SIZE.carport.bay_width / 2) * (rand() < 0.5 ? -1 : 1);
    const cos = Math.cos(c.rotation);
    const sin = Math.sin(c.rotation);
    out.push(car(`carport-${v.index}`, c.x + lateral * cos, c.z - lateral * sin, c.rotation));
  }
  // In the shared courts, about a quarter of the bays: the aisle runs along local x.
  for (const p of planParking()) {
    const { bay_width: bw, bay_depth: bd, aisle } = PLAN_ASSET_SIZE.parking;
    const run = p.baysPerSide * bw;
    const cos = Math.cos(p.rotation);
    const sin = Math.sin(p.rotation);
    for (let k = 0; k < p.baysPerSide; k++) {
      for (const side of [-1, 1]) {
        if (rand() > 0.26) continue;
        const lx = -run / 2 + (k + 0.5) * bw;
        const lz = side * (aisle / 2 + bd / 2);
        // Local to world: x' = lx*cos + lz*sin, z' = lz*cos - lx*sin (the transform `placedBounds` uses).
        out.push(car(`${p.id}-${k}-${side}`, p.x + lx * cos + lz * sin, p.z + lz * cos - lx * sin, p.rotation + (side === 1 ? Math.PI : 0)));
      }
    }
  }
  return tier === "high" ? out.slice(0, LIFE_BUDGET.high.parked) : out.filter((_, i) => i % 3 === 0).slice(0, LIFE_BUDGET.low.parked);
}

function flocks(tier: LandscapeTier): BirdFlock[] {
  const n = LIFE_BUDGET[tier].birds;
  const share = (f: number) => Math.max(3, Math.round(n * f));
  const riverZ = (x: number) => planRiverCenterZ(x);
  return [
    { id: "stream-west", count: share(0.3), cx: -240, cz: riverZ(-240), rx: 150, rz: 22, altitude: 16, speed: 7, clockwise: false },
    { id: "stream-east", count: share(0.25), cx: 250, cz: riverZ(250), rx: 180, rz: 26, altitude: 20, speed: 8, clockwise: true },
    { id: "slope-olives", count: share(0.3), cx: -60, cz: -330, rx: 120, rz: 70, altitude: 38, speed: 6, clockwise: false },
    { id: "slope-far", count: share(0.15), cx: 300, cz: -420, rx: 140, rz: 80, altitude: 55, speed: 7, clockwise: true },
  ];
}

const lifeCache = new Map<string, Life>();

/** The people, cars and birds of the 28 ha plan on one tier. */
export function planLife(tier: LandscapeTier): Life {
  const hit = lifeCache.get(tier);
  if (hit) return hit;
  const life: Life = {
    walkers: walkers(seeded(3301), tier),
    moving: carsMoving(seeded(3302), tier),
    parked: carsParked(seeded(3303), tier),
    flocks: flocks(tier),
  };
  lifeCache.set(tier, life);
  return life;
}
