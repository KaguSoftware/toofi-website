import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { APARTMENT_BACK_Z, APARTMENT_BUILDINGS_X, BOULEVARD_WIDTH, SITE, apartmentFloorDepth, boulevardCurve, boulevardPath, villaPlots } from "../components/sawad/scene/layout";
import { LAYOUT_PATH, sceneLayout, writeSceneLayout } from "./export-scene-layout.mjs";

const dir = mkdtempSync(join(tmpdir(), "sawad-layout-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("export-scene-layout", () => {
  const layout = sceneLayout();

  it("exports all 24 villa plots with their placement and size", () => {
    expect(layout.villas).toHaveLength(24);
    expect(layout.villas).toEqual(villaPlots().map(({ index, x, z, facing, type, width, depth, height }) => ({ index, x, z, facing, type, width, depth, height })));
    for (const v of layout.villas) expect(Object.keys(v).sort()).toEqual(["depth", "facing", "height", "index", "type", "width", "x", "z"]);
  });

  it("exports the apartments, site, paths, gates and pool rim", () => {
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
