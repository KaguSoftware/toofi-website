import { Color, ShaderMaterial } from "three";
import { describe, expect, it } from "vitest";
import { PLAN_GARDEN_BAY, PLAN_SITE, planAmenities, planLandUseAt, planRoads, planTerrainHeight, riverGeometryParams } from "./layout";
import { buildPlanPool, buildPlanStream, buildPlanTerrain, gridGeometry, gridLines, planGroundAxes, planGroundColor, planPoolWater } from "./planWorld";
import type { QualityTier } from "./types";

/** Index of the cell [lines[i], lines[i + 1]] holding v. */
function cell(lines: number[], v: number): number {
  let lo = 0;
  let hi = lines.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid] <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The ground mesh's height at (x, z), as the GPU draws it: each cell is two triangles split from (i+1, j) to (i, j+1). */
function meshHeight(xs: number[], zs: number[], x: number, z: number): number {
  const i = cell(xs, x);
  const j = cell(zs, z);
  const u = (x - xs[i]) / (xs[i + 1] - xs[i]);
  const v = (z - zs[j]) / (zs[j + 1] - zs[j]);
  const ha = planTerrainHeight(xs[i], zs[j]);
  const hb = planTerrainHeight(xs[i + 1], zs[j]);
  const hc = planTerrainHeight(xs[i], zs[j + 1]);
  const hd = planTerrainHeight(xs[i + 1], zs[j + 1]);
  if (u + v <= 1) return ha + u * (hb - ha) + v * (hc - ha);
  return hd + (1 - u) * (hc - hd) + (1 - v) * (hb - hd);
}

/** How far the mesh rises above the true ground at the worst of the given points. */
function worstRise(tier: QualityTier, points: Array<[number, number]>): number {
  const { xs, zs } = planGroundAxes(tier);
  let worst = -Infinity;
  for (const [x, z] of points) worst = Math.max(worst, meshHeight(xs, zs, x, z) - planTerrainHeight(x, z));
  return worst;
}

const area = (minX: number, maxX: number, minZ: number, maxZ: number, step: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let x = minX; x <= maxX; x += step) for (let z = minZ; z <= maxZ; z += step) out.push([x, z]);
  return out;
};

/** Carriageway and promenade tops sit 6 cm above the ground line (scripts/blender/build_compound.py ROAD_TOP). */
const ROAD_TOP = 0.06;

describe("gridLines", () => {
  it("merges runs and exact lines, sorted, without near duplicates", () => {
    expect(gridLines([[0, 8, 4], [6, 10, 2]], [5, 8.02])).toEqual([0, 4, 5, 6, 8, 10]);
  });
});

describe("planGroundAxes", () => {
  it("lands exactly on the garden bay's edges and the steps' sides", () => {
    for (const tier of ["high", "low"] as const) {
      const { xs, zs } = planGroundAxes(tier);
      const steps = planAmenities().find((a) => a.id === "garden-steps")!.footprint;
      for (const x of [PLAN_GARDEN_BAY.halfWidth, -PLAN_GARDEN_BAY.halfWidth, steps.minX, steps.maxX]) expect(xs).toContain(x);
      for (const z of [PLAN_GARDEN_BAY.headZ, PLAN_GARDEN_BAY.headZ - PLAN_GARDEN_BAY.run, steps.minZ, steps.maxZ]) expect(zs).toContain(z);
    }
  });

  it("covers the whole valley out to the horizon, finer inside the walls", () => {
    const { xs, zs } = planGroundAxes("high");
    expect(xs[0]).toBe(-1800);
    expect(xs.at(-1)).toBe(1800);
    expect(zs[0]).toBe(-1800);
    expect(zs.at(-1)).toBe(1800);
    const insideGap = Math.max(...xs.filter((x) => Math.abs(x) < 400).map((x, i, a) => (i ? x - a[i - 1] : 0)));
    expect(insideGap).toBeLessThanOrEqual(4);
  });

  it("keeps the ground mesh light enough for both tiers", () => {
    const vertices = (t: QualityTier) => {
      const { xs, zs } = planGroundAxes(t);
      return xs.length * zs.length;
    };
    // The 7 ha ground was a 301 x 301 grid on the high tier and 171 x 171 on the low one; the
    // 28 ha ground covers 4 times the site and the stream's bends with about 10 % more.
    expect(vertices("high")).toBeLessThan(301 * 301 * 1.1);
    expect(vertices("low")).toBeLessThan(171 * 171 * 1.25);
  });
});

describe("the ground along the stream", () => {
  it("keeps the banks smooth where the stream bends past the walls", () => {
    const { xs, zs } = planGroundAxes("high");
    const r = riverGeometryParams("zaitun");
    // Across the corridor the stream can wander through: 4 m; along it, out to 1.1 km: 12 m.
    const across = zs.filter((z) => z >= r.near - 60 && z <= r.far + 60);
    expect(Math.max(...across.slice(1).map((z, i) => z - across[i]))).toBeLessThanOrEqual(4);
    const along = xs.filter((x) => Math.abs(x) >= 460 && Math.abs(x) <= 1100);
    expect(Math.max(...along.slice(1).map((x, i) => (x - along[i] > 100 ? 0 : x - along[i])))).toBeLessThanOrEqual(12.5);
  });
});

describe("the ground mesh under the model", () => {
  it("never rises over the garden steps or the paved terrace at the foot of the bay", () => {
    const steps = planAmenities().find((a) => a.id === "garden-steps")!.footprint;
    for (const tier of ["high", "low"] as const) {
      // The steps ride on the true ground (build_compound.py stair_profile); the mesh must stay under it.
      expect(worstRise(tier, area(steps.minX, steps.maxX, steps.minZ, steps.maxZ, 0.25))).toBeLessThan(0.01);
      expect(worstRise(tier, area(-11, 11, -130, -100, 0.5))).toBeLessThan(0.01);
    }
  });

  it("stays under the road surface along every street, walk and the promenade", () => {
    for (const tier of ["high", "low"] as const) {
      const points: Array<[number, number]> = [];
      for (const road of planRoads()) {
        for (let k = 0; k < road.path.length - 1; k++) {
          const [x0, , z0] = road.path[k];
          const [x1, , z1] = road.path[k + 1];
          for (let t = 0; t < 1; t += 0.2) points.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]);
        }
      }
      expect(worstRise(tier, points)).toBeLessThan(ROAD_TOP);
    }
  });

  it("follows the graded plan closely everywhere inside the walls", () => {
    const rise = worstRise("high", area(PLAN_SITE.minX + 0.3, PLAN_SITE.maxX, PLAN_SITE.minZ + 0.3, PLAN_SITE.maxZ, 3.7));
    expect(rise).toBeLessThan(0.15);
  });
});

describe("buildPlanTerrain", () => {
  it("builds the graded ground with upward faces, vertex colours and shadows", () => {
    const mesh = buildPlanTerrain("low");
    const { xs, zs } = planGroundAxes("low");
    const pos = mesh.geometry.getAttribute("position");
    expect(pos.count).toBe(xs.length * zs.length);
    expect(mesh.geometry.getAttribute("color").count).toBe(pos.count);
    expect(mesh.receiveShadow).toBe(true);
    expect(mesh.name).toBe("terrain");
    // A vertex on the terrace carries the plan's height.
    const steps = planAmenities().find((a) => a.id === "garden-steps")!.footprint;
    const top = PLAN_GARDEN_BAY.headZ - PLAN_GARDEN_BAY.run;
    const k = zs.indexOf(top) * xs.length + xs.indexOf(steps.minX);
    expect(pos.getX(k)).toBe(steps.minX);
    expect(pos.getY(k)).toBeCloseTo(planTerrainHeight(steps.minX, top), 5);
    const normals = mesh.geometry.getAttribute("normal");
    for (let i = 0; i < normals.count; i += 997) expect(normals.getY(i)).toBeGreaterThan(0);
    mesh.geometry.dispose();
  });

  it("winds a grid's triangles to face up", () => {
    const geo = gridGeometry([0, 1], [0, 1], () => 0);
    geo.computeVertexNormals();
    expect(geo.getAttribute("normal").getY(0)).toBeCloseTo(1);
  });
});

describe("planGroundColor", () => {
  const c = new Color();
  it("greens the irrigated lawns and plots, and leaves the olive terraces dry", () => {
    const lawn = planGroundColor(36, -88, 1.2, new Color());
    expect(planLandUseAt(36, -88)).toBe("lawn");
    expect(lawn.g).toBeGreaterThan(lawn.r);
    const terrace = planGroundColor(-250, -240, planTerrainHeight(-250, -240), new Color());
    expect(["olive-terrace", "reserve"]).toContain(planLandUseAt(-250, -240));
    expect(terrace.r).toBeGreaterThan(terrace.g * 0.95);
  });

  it("darkens the stream bed", () => {
    planGroundColor(0, 102, -1, c);
    expect(c.r + c.g + c.b).toBeLessThan(0.2);
  });
});

describe("water on the plan", () => {
  const material = new ShaderMaterial();
  it("lays the stream under the whole valley, wide enough for its bends past the walls", () => {
    const stream = buildPlanStream(material);
    stream.geometry.computeBoundingBox();
    const box = stream.geometry.boundingBox!;
    const r = riverGeometryParams("zaitun");
    expect(box.min.y).toBeCloseTo(0, 9);
    expect(box.min.z).toBeLessThan(r.near - 55);
    expect(box.max.z).toBeGreaterThan(r.far + 55);
    expect(stream.material).toBe(material);
  });

  it("fills the reflecting pool inside its rim, just under the coping", () => {
    const pool = planAmenities().find((a) => a.id === "pool")!;
    const w = planPoolWater();
    expect(w.minX).toBeGreaterThan(pool.footprint.minX);
    expect(w.maxZ).toBeLessThan(pool.footprint.maxZ);
    expect(w.y).toBeLessThan(pool.y + (pool.size?.height ?? 0));
    expect(w.y).toBeGreaterThan(pool.y);
    const mesh = buildPlanPool(material);
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.min.y).toBeCloseTo(w.y, 6);
    expect(mesh.name).toBe("garden-pool");
  });
});
