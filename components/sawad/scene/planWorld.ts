import { BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial, PlaneGeometry, type ShaderMaterial } from "three";
import {
  PLAN_GARDEN_BAY,
  PLAN_LEVELS,
  PLAN_PADS,
  planAmenities,
  planBoulevardZ,
  planLandUseAt,
  planRiverCenterZ,
  planTerrainHeight,
  riverGeometryParams,
  type PlanLandUse,
  type Rect,
} from "./layout";
import type { QualityTier } from "./types";

/*
 * The procedural parts of the 28 ha scene (Zaitun Hills) that the baked model leaves to code:
 * the graded ground, the stream and the reflecting pool's water. The model's hardscape (streets,
 * kerbs, walks, the garden steps) is modelled on `planTerrainHeight` and reaches 0.12 m below it,
 * so the ground mesh must follow that surface to within a few centimetres wherever the model
 * stands on it. See `planGroundAxes` for how the grid is laid out to do that.
 */

// ---------------------------------------------------------------- ground grid

/** A run of grid lines from `from` to `to` every `step` metres. */
type Run = readonly [from: number, to: number, step: number];

/** Grid lines: every run's lines plus the exact lines in `exact`, sorted and de-duplicated (to 5 cm). */
export function gridLines(runs: ReadonlyArray<Run>, exact: ReadonlyArray<number> = []): number[] {
  const all: number[] = [...exact];
  for (const [from, to, step] of runs) {
    const n = Math.round((to - from) / step);
    for (let i = 0; i <= n; i++) all.push(from + ((to - from) * i) / n);
  }
  all.sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of all) if (!out.length || v - out[out.length - 1] > 0.05) out.push(v);
  return out;
}

/** Where the ground creases along z (the foot and top of the olive bank, the foot of the hillside), as bands to sample finely. */
function creaseBands(): Array<[number, number]> {
  const toe = [planBoulevardZ("a", 0), planBoulevardZ("a", 215)].map((z) => z - 40.5); // bank toe, both extremes of the sway
  const crest = [planBoulevardZ("b", 0), planBoulevardZ("b", 215)].map((z) => z + 40.5);
  const hill = [planBoulevardZ("b", 0), planBoulevardZ("b", 215)].map((z) => z - 37.1);
  return [toe, crest, hill].map(([a, b]) => [Math.min(a, b) - 1.5, Math.max(a, b) + 1.5]);
}

/**
 * The ground mesh's grid lines along x and z. A grid between exact samples rounds off every crease
 * it does not land on, and the rounded surface rises above the true one by up to slope x step / 4:
 * 0.3 m on a 4 m grid at the garden bay's edge, enough to cover the paving the model lays there.
 * So the grid is fine where the model stands (4 m inside the walls, 8 m on the low tier), lands
 * exactly on the garden bay's edges, the steps' cheek walls and the pads cut into the bank (the
 * mosque court), and samples the curving creases of
 * the olive bank and the hillside every metre (2 m on the low tier). Along the stream, where it
 * bends past the walls, it stays at 4 m across and 12 m along (8 and 24 on the low tier) so the
 * banks stay smooth in the low flight; elsewhere beyond the walls it opens out to 100 m toward the
 * horizon, where the haze hides the facets.
 */
export function planGroundAxes(tier: QualityTier): { xs: number[]; zs: number[] } {
  const inner = tier === "high" ? 4 : 8;
  const fine = tier === "high" ? 1 : 2;
  // Beyond the walls the stream bends 55 m each way; its banks need a finer grid than open fields.
  const corridor = tier === "high" ? 12 : 24;
  const { halfWidth, headZ, run } = PLAN_GARDEN_BAY;
  const steps = planAmenities().find((a) => a.id === "garden-steps")!.footprint;
  const xs = gridLines(
    [
      [-1800, -1100, 100],
      [-1100, -460, corridor],
      [-460, 460, inner],
      [460, 1100, corridor],
      [1100, 1800, 100],
    ],
    [-halfWidth - run, -halfWidth, halfWidth, halfWidth + run, steps.minX, steps.maxX, ...PLAN_PADS.flatMap((p) => [p.area.minX - p.margin, p.area.minX, p.area.maxX, p.area.maxX + p.margin])],
  );
  const r = riverGeometryParams("zaitun");
  const zs = gridLines(
    [
      [-1800, -1000, 100],
      [-1000, -300, 20],
      [-300, 210, inner], // inside the walls, and the stream's whole corridor as it bends past them
      [210, 600, 20],
      [600, 1800, 100],
      ...creaseBands().map(([a, b]): Run => [a, b, fine]),
      // The stream's banks fall 2 m over 16 m on a smooth curve.
      [r.near - 18, r.near, fine * 2],
      [r.far, r.far + 18, fine * 2],
    ],
    [headZ, headZ - run, steps.minZ, steps.maxZ, ...PLAN_PADS.flatMap((p) => [p.area.minZ - p.margin, p.area.minZ - p.margin / 2, p.area.minZ, p.area.maxZ, p.area.maxZ + p.margin])],
  );
  return { xs, zs };
}

// ---------------------------------------------------------------- ground colour

// Palette (sRGB hex, converted to linear by Color).
const G = {
  lawn: new Color("#7f9445"),
  lawnDeep: new Color("#6c8239"),
  verge: new Color("#86934a"),
  dryGrass: new Color("#a99a62"),
  oliveSoil: new Color("#a68d63"),
  earth: new Color("#a48a63"),
  earthDry: new Color("#b89c72"),
  field: new Color("#6f8638"),
  fallow: new Color("#8f7350"),
  grass: new Color("#87904c"),
  bank: new Color("#6b5a44"),
  bed: new Color("#3a3226"),
  paved: new Color("#b9a582"),
};

const IRRIGATED: ReadonlySet<PlanLandUse> = new Set(["plot", "lawn", "palm-garden", "river-lawn"]);
const HARD: ReadonlySet<PlanLandUse> = new Set(["road", "paving", "parking", "building", "court", "play"]);

/** Ground colour at a point: irrigated lawns inside the walls, terraced olive soil on the slopes, fields and dry foothills outside. */
export function planGroundColor(x: number, z: number, y: number, out: Color): Color {
  const mottled = 0.5 + 0.5 * Math.sin(x * 0.031 + Math.cos(z * 0.027) * 2.0);
  if (y < -0.2) return out.copy(G.bed);
  const use = planLandUseAt(x, z);
  if (use === "water") return out.copy(G.bed);
  if (HARD.has(use)) return out.copy(G.paved); // under the model's hardscape
  if (IRRIGATED.has(use)) return out.copy(G.lawn).lerp(G.lawnDeep, mottled * 0.6);
  if (use === "verge") return out.copy(G.verge);
  if (use !== "outside") {
    // Olive groves and terraces: worked soil between the rows, dry grass on the banks.
    const rows = 0.5 + 0.5 * Math.sin(z * 0.7);
    return out.copy(G.oliveSoil).lerp(G.dryGrass, 0.35 + 0.35 * rows * mottled);
  }
  // Outside the walls: irrigated fields and fallow plots on the valley floor, dry grass and earth up the foothills.
  const r = riverGeometryParams("zaitun");
  const fromWater = Math.abs(z - planRiverCenterZ(x)) - r.width / 2;
  const wet = Math.max(0, 1 - fromWater / 22);
  const plot = Math.sin(Math.floor(x / 70) * 12.9898 + Math.floor(z / 55) * 78.233) * 43758.5453;
  const irrigated = plot - Math.floor(plot) < 0.55 && y < PLAN_LEVELS.terrace + 4;
  const nearRiver = Math.max(0, 1 - fromWater / 900);
  out.copy(G.earth).lerp(G.earthDry, Math.min(1, Math.max(0, (y - 3) / 14)));
  out.lerp(G.grass, 0.55 + 0.25 * mottled);
  if (irrigated) out.lerp(G.field, (0.55 + 0.3 * mottled) * 0.6 * (0.35 + 0.65 * nearRiver));
  else out.lerp(G.fallow, 0.35 * mottled);
  return out.lerp(G.bank, wet * 0.7);
}

// ---------------------------------------------------------------- meshes

/** Indexed grid geometry over the given lines, with heights from `height`. */
export function gridGeometry(xs: ReadonlyArray<number>, zs: ReadonlyArray<number>, height: (x: number, z: number) => number): BufferGeometry {
  const nx = xs.length;
  const nz = zs.length;
  const positions = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 3;
      positions[k] = xs[i];
      positions[k + 1] = height(xs[i], zs[j]);
      positions[k + 2] = zs[j];
    }
  }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let n = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // Counter-clockwise seen from above (+y), so the faces point up.
      index.set([a, c, b, b, c, d], n);
      n += 6;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setIndex(new BufferAttribute(index, 1));
  return geo;
}

/** The graded 28 ha ground and the foothills around it, coloured by what the plan puts there. */
export function buildPlanTerrain(tier: QualityTier): Mesh {
  const { xs, zs } = planGroundAxes(tier);
  const geo = gridGeometry(xs, zs, planTerrainHeight);
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const tmp = new Color();
  for (let i = 0; i < pos.count; i++) {
    planGroundColor(pos.getX(i), pos.getZ(i), pos.getY(i), tmp);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new Mesh(geo, new MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 }));
  mesh.receiveShadow = true;
  mesh.name = "terrain";
  return mesh;
}

/** How far the stream's centre line wanders from its line past the walls (layout.ts `planRiverCenterZ`). */
const STREAM_BEND = 55;

/** The stream's surface: one wide quad at y = 0 under the whole valley; the ground covers it everywhere but the channel. */
export function buildPlanStream(material: ShaderMaterial): Mesh {
  const r = riverGeometryParams("zaitun");
  const geo = new PlaneGeometry(3600, r.width + 2 * STREAM_BEND + 220, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, r.near + r.width / 2);
  const mesh = new Mesh(geo, material);
  mesh.name = "river";
  return mesh;
}

/** The reflecting pool's water: inside the limestone rim the model draws, 6 cm under its top. */
export function planPoolWater(): Rect & { y: number } {
  const pool = planAmenities().find((a) => a.id === "pool")!;
  const f = pool.footprint;
  return { minX: f.minX + 0.6, maxX: f.maxX - 0.6, minZ: f.minZ + 0.5, maxZ: f.maxZ - 0.5, y: pool.y + (pool.size?.height ?? 0.35) - 0.06 };
}

export function buildPlanPool(material: ShaderMaterial): Mesh {
  const w = planPoolWater();
  const geo = new PlaneGeometry(w.maxX - w.minX, w.maxZ - w.minZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate((w.minX + w.maxX) / 2, w.y, (w.minZ + w.maxZ) / 2);
  const mesh = new Mesh(geo, material);
  mesh.name = "garden-pool";
  return mesh;
}
