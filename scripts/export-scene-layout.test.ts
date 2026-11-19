import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  APARTMENT_BACK_Z,
  APARTMENT_BUILDINGS_X,
  BOULEVARD_WIDTH,
  PLAN_LEVELS,
  PLAN_SITE,
  SITE,
  apartmentFloorDepth,
  boulevardCurve,
  boulevardPath,
  planAmenities,
  planApartmentBlocks,
  planBank,
  planLamps,
  planParking,
  planRoads,
  planTerrainHeight,
  planVillas,
  villaPlots,
} from "../components/sawad/scene/layout";
import { LAYOUT_PATH, TERRAIN_GRID, formatJson, sceneLayout, terrainGrid, writeSceneLayout, writeTerrain } from "./export-scene-layout.mjs";

const dir = mkdtempSync(join(tmpdir(), "sawad-layout-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("export-scene-layout", () => {
  const layout = sceneLayout();

  it("exports all 24 villa plots of the 7 ha layout with their placement and size", () => {
    expect(layout.version).toBe(2);
    expect(layout.villas).toHaveLength(24);
    expect(layout.villas).toEqual(villaPlots().map(({ index, x, z, facing, type, width, depth, height }) => ({ index, x, z, facing, type, width, depth, height })));
    for (const v of layout.villas) expect(Object.keys(v).sort()).toEqual(["depth", "facing", "height", "index", "type", "width", "x", "z"]);
  });

  it("exports the 7 ha layout's apartments, site, paths, gates and pool rim", () => {
    expect(layout.padY).toBe(1.2);
    expect(layout.site).toEqual({ ...SITE });
    expect(layout.apartments).toEqual({
      x: [...APARTMENT_BUILDINGS_X],
      backZ: APARTMENT_BACK_Z,
      width: 32,
      floorHeight: 3.6,
      floors: 4,
      floorDepths: [0, 1, 2, 3].map(apartmentFloorDepth),
    });
    const [a, b, promenade, axis] = boulevardPath();
    expect(layout.boulevards).toEqual({ width: BOULEVARD_WIDTH, paths: [a, b] });
    expect(layout.promenade).toEqual({ width: 8, path: promenade });
    expect(layout.gardenAxis).toEqual({ width: 5, path: axis });
    expect(layout.gates.minX).toEqual([-8 + boulevardCurve(SITE.minX), -86 + boulevardCurve(SITE.minX)]);
    expect(layout.gates.maxX).toEqual([-8 + boulevardCurve(SITE.maxX), -86 + boulevardCurve(SITE.maxX)]);
    expect(layout.poolRim).toEqual({ x: 0, z: -46, width: 9.2, height: 0.35, depth: 61 });
  });

  it("writes JSON that round-trips, and the committed layout.json is current", () => {
    const out = join(dir, "nested", "layout.json");
    writeSceneLayout(out);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(JSON.parse(JSON.stringify(layout)));
    // The Blender build reads this file; a stale copy would misplace buildings.
    expect(JSON.parse(readFileSync(LAYOUT_PATH, "utf8"))).toEqual(JSON.parse(JSON.stringify(layout)));
  });
});

describe("export-scene-layout: the 28 ha masterplan", () => {
  const plan = sceneLayout().masterplan;
  const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-4); // the file is rounded to 0.1 mm

  it("exports the site, its levels and the 60 villas under the names the model uses", () => {
    expect(plan.site).toEqual({ ...PLAN_SITE });
    expect(plan.areaHa).toBeCloseTo(28.04, 2);
    expect(plan.levels).toEqual({ ...PLAN_LEVELS });
    expect(plan.villas).toHaveLength(60);
    planVillas().forEach((v, i) => {
      const out = plan.villas[i];
      expect(out.name).toBe(`villa-${String(i).padStart(2, "0")}`);
      expect([out.index, out.row, out.type, out.facing, out.width, out.depth, out.height]).toEqual([v.index, v.row, v.type, v.facing, v.width, v.depth, v.height]);
      near(out.x, v.x);
      near(out.y, v.y);
      near(out.z, v.z);
      near(out.plot.maxZ - out.plot.minZ, v.plot.maxZ - v.plot.minZ);
      near(out.carport.x, v.carport.x);
      near(out.driveway.minZ, v.driveway.minZ);
      expect(Object.keys(out).sort()).toEqual(["carport", "depth", "driveway", "facing", "garden", "height", "index", "name", "plot", "row", "type", "width", "x", "y", "z"]);
    });
  });

  it("exports the apartment blocks, amenities, parking, streets, gates, walls and lamps", () => {
    expect(plan.apartments.map((b: { name: string }) => b.name)).toEqual(planApartmentBlocks().map((b) => `apartment-${b.index}`));
    expect(plan.apartments[0]).toMatchObject({ width: 32, floors: 4, floorHeight: 3.6, floorDepths: [16, 13.4, 10.8, 8.2] });
    expect(plan.amenities.map((a: { id: string }) => a.id)).toEqual(planAmenities().map((a) => a.id));
    expect(plan.amenities.find((a: { id: string }) => a.id === "gallery").asset).toBe("villa-courtyard");
    expect(plan.parking.map((p: { id: string; spaces: number }) => [p.id, p.spaces])).toEqual(planParking().map((p) => [p.id, p.spaces]));
    expect(plan.roads.map((r: { id: string; path: unknown[] }) => [r.id, r.path.length])).toEqual(planRoads().map((r) => [r.id, r.path.length]));
    expect(plan.gates.map((g: { id: string }) => g.id)).toEqual(["main", "east"]);
    expect(plan.walls).toHaveLength(5);
    expect(plan.lamps).toHaveLength(planLamps().length);
    expect(plan.benches).toHaveLength(16);
    expect(plan.reserve).toHaveLength(2);
    expect(plan.treeZones.map((z: { species: string }) => z.species)).toEqual(expect.arrayContaining(["date-palm", "olive", "citrus"]));
    expect(plan.assetSizes.tennis).toEqual({ length: 36.6, width: 18.3 });
    expect(plan.sun).toEqual({ elevationDeg: 4.2, azimuthX: 0.97, azimuthZ: 0.16 });
    expect(plan.river).toEqual({ near: 84, width: 36, far: 120, bedDepth: 1.8 });
  });

  it("exports how the ground is graded, and the ground itself on a 4 m grid in centimetres", () => {
    expect(plan.ground.hillSlope).toBe(0.12);
    expect(plan.ground.gardenBay).toEqual({ halfWidth: 60, headZ: -122, run: 20.5 });
    expect(plan.ground.lines).toHaveLength(87);
    for (const l of [plan.ground.lines[0], plan.ground.lines[43], plan.ground.lines[86]]) {
      const bank = planBank(l.x);
      near(l.toeZ, bank.toeZ);
      near(l.crestZ, bank.crestZ);
      near(l.hillZ, bank.hillZ);
    }
    const t = plan.terrain;
    expect([t.minX, t.minZ, t.step, t.columns, t.rows]).toEqual([TERRAIN_GRID.minX, TERRAIN_GRID.minZ, 4, 246, 113]);
    expect(t.heightsCm).toHaveLength(t.rows);
    expect(t.heightsCm.every((row: number[]) => row.length === t.columns && row.every(Number.isInteger))).toBe(true);
    for (const [i, j] of [
      [0, 0],
      [122, 80],
      [245, 112],
      [60, 40],
    ]) {
      expect(t.heightsCm[j][i]).toBe(Math.round(planTerrainHeight(t.minX + i * t.step, t.minZ + j * t.step) * 100) + 0);
    }
    // The grid covers the walled site with room to spare.
    expect(t.minX).toBeLessThan(PLAN_SITE.minX);
    expect(t.minX + (t.columns - 1) * t.step).toBeGreaterThan(PLAN_SITE.maxX);
    expect(t.minZ).toBeLessThan(PLAN_SITE.minZ);
    expect(t.minZ + (t.rows - 1) * t.step).toBeGreaterThan(PLAN_SITE.maxZ);
  });

  it("samples the ground over any area on request", () => {
    const grid = terrainGrid({ minX: -20, maxX: 20, minZ: -10, maxZ: 10, step: 10 });
    expect([grid.columns, grid.rows]).toEqual([5, 3]);
    expect(grid.heightsCm[1][2]).toBe(Math.round(planTerrainHeight(0, 0) * 100));
    const out = join(dir, "terrain.json");
    expect(writeTerrain("-20,20,-10,10,10", out)).toEqual(grid);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(grid);
    expect(() => writeTerrain("1,2,3", out)).toThrow(/usage/);
    expect(() => writeTerrain("0,10,0,10,5", "")).toThrow(/usage/);
  });

  it("writes lists of plain values on one line and everything else indented", () => {
    const text = formatJson({ a: [1, 2, 3], b: { c: [[1, 2], [3, 4]], d: "x" }, e: [], f: {}, g: [{ h: 1 }], skipped: undefined });
    expect(text).toBe(['{', '  "a": [1, 2, 3],', '  "b": {', '    "c": [', "      [1, 2],", "      [3, 4]", "    ],", '    "d": "x"', "  },", '  "e": [],', '  "f": {},', '  "g": [', '    { "h": 1 }', "  ]", "}"].join("\n"));
    expect(JSON.parse(text)).toEqual({ a: [1, 2, 3], b: { c: [[1, 2], [3, 4]], d: "x" }, e: [], f: {}, g: [{ h: 1 }] });
    // One row of ground heights per line keeps the committed file readable.
    const lines = readFileSync(LAYOUT_PATH, "utf8").split("\n");
    expect(lines.length).toBeLessThan(6000);
  });
});
