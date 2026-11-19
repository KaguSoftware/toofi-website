import { BoxGeometry, BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

const reportError = vi.fn();
vi.mock("@/lib/monitoring", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

import { LOD_DISTANCE, planLandscape } from "./landscape";
import {
  GRASS_DISTANCE,
  buildVegetationField,
  coneCos,
  needsResort,
  packPlacements,
  prepareVegetationLibrary,
  resolveNode,
  speciesFor,
  type Species,
  type ViewCone,
} from "./vegetation";

afterEach(() => reportError.mockClear());

/** A library shaped like vegetation-*.glb: named nodes, two primitives on the trees, foliage materials by name. */
function library(names: string[]): Group {
  const root = new Group();
  const leaves = new MeshStandardMaterial({ name: "veg-olive" });
  const bark = new MeshStandardMaterial({ name: "veg-opaque" });
  for (const name of names) {
    const node = new Group();
    node.name = name;
    for (const m of [bark, leaves]) {
      const g = new BoxGeometry(1, 2, 1).translate(0, 1, 0);
      g.setAttribute("_wind", new BufferAttribute(new Float32Array(g.getAttribute("position").count * 4), 4));
      node.add(new Mesh(g, m));
    }
    root.add(node);
  }
  return root;
}

const TREE = (a: string) => [`${a}_LOD0`, `${a}_LOD1`, `${a}_LOD2`, `${a}_card`];
const at = (x: number, z: number, y = 0) => ({ x, y, z });
const cone = (eye: { x: number; y: number; z: number }, forward = { x: 1, y: 0, z: 0 }, cosHalf = coneCos(50, 16 / 9)): ViewCone => ({ eye, forward, cosHalf });

function species(id: string, places: Array<{ x: number; y: number; z: number }>, levels = true, maxDistance = Infinity): Species {
  return { id, nodes: levels ? { LOD0: `${id}_LOD0`, LOD1: `${id}_LOD1`, LOD2: `${id}_LOD2`, card: `${id}_card` } : { LOD0: id }, ...packPlacements(places), maxDistance, levels, castShadow: true };
}

describe("packPlacements", () => {
  it("turns, tilts and scales each instance about its base", () => {
    const { matrices, positions } = packPlacements([{ x: 5, y: 2, z: -3, rotation: Math.PI / 2, scale: 2, lean: 0 }]);
    expect(Array.from(positions)).toEqual([5, 2, -3]);
    const m = new Matrix4().fromArray(matrices);
    const p = new Vector3(1, 0, 0).applyMatrix4(m);
    expect(p.x).toBeCloseTo(5);
    expect(p.z).toBeCloseTo(-5); // +x turned a quarter about +y lands on -z, twice as far
    expect(new Vector3(0, 1, 0).applyMatrix4(m).y).toBeCloseTo(4);
  });
});

describe("speciesFor", () => {
  it("covers every plant of the landscape, split by asset", () => {
    const land = planLandscape("low");
    const sp = speciesFor(land, "low");
    const count = (id: string) => sp.find((s) => s.id === id)!.positions.length / 3;
    expect(count("olive-a") + count("olive-b")).toBe(land.olives.length);
    expect(count("palm")).toBe(land.palms.length);
    expect(count("citrus")).toBe(land.citrus.length);
    expect(count("hedge-low") + count("hedge-tall")).toBe(land.hedges.length);
    expect(count("grass-green") + count("grass-dry")).toBe(land.grass.length);
    expect(sp.find((s) => s.id === "grass-dry")!.maxDistance).toBe(GRASS_DISTANCE);
    expect(sp.find((s) => s.id === "hedge-low")!.maxDistance).toBe(LOD_DISTANCE.low[1]);
    // No shadows on the low tier.
    expect(sp.every((s) => !s.castShadow)).toBe(true);
  });
});

describe("resolveNode", () => {
  const nodes = { LOD0: "t_LOD0", LOD1: "t_LOD1", LOD2: "t_LOD2", card: "t_card" };
  it("falls back to the next coarser level, then finer, when the library lacks one", () => {
    const low = (n: string) => n !== "t_LOD0"; // the low tier ships no LOD0
    expect(resolveNode(nodes, "LOD0", low)).toBe("t_LOD1");
    const citrus = (n: string) => n !== "t_LOD2";
    expect(resolveNode(nodes, "LOD2", citrus)).toBe("t_card");
    expect(resolveNode({ LOD0: "x" }, "card", () => true)).toBe("x");
    expect(resolveNode(nodes, "LOD1", () => false)).toBeNull();
  });
});

describe("buildVegetationField", () => {
  it("draws near plants in detail and far ones as cards, and nothing behind the camera", () => {
    const root = library(TREE("olive"));
    const [l0, l1, l2] = LOD_DISTANCE.high;
    const places = [at(l0 / 2, 0), at((l0 + l1) / 2, 0), at((l1 + l2) / 2, 0), at(l2 + 200, 0), at(-300, 0)];
    const field = buildVegetationField(root, "high", [species("olive", places)]);
    const drawn = field.update(cone(at(0, 0)));
    expect(drawn).toEqual({ LOD0: 1, LOD1: 1, LOD2: 1, card: 1 }); // the one at -300 is behind
    // One InstancedMesh per level and primitive, sharing a level's matrices.
    expect(field.objects).toHaveLength(8);
    const lod0 = field.objects.filter((o) => o.name.startsWith("olive:LOD0"));
    expect(lod0.every((o) => o.count === 1 && o.instanceMatrix === lod0[0].instanceMatrix)).toBe(true);
    expect(new Vector3().setFromMatrixPosition(new Matrix4().fromArray(lod0[0].instanceMatrix.array as Float32Array)).x).toBeCloseTo(l0 / 2);
    expect(field.objects.every((o) => !o.frustumCulled)).toBe(true);
    expect(field.objects.filter((o) => o.name.includes(":card")).every((o) => !o.castShadow)).toBe(true);
    // Turning round brings the one behind into view and loses the others, except the one close enough to lean into the frame.
    expect(field.update(cone(at(0, 0), { x: -1, y: 0, z: 0 }))).toEqual({ LOD0: 1, LOD1: 0, LOD2: 0, card: 1 });
    field.dispose();
  });

  it("always draws a plant right beside the camera, whichever way it looks", () => {
    const field = buildVegetationField(library(TREE("palm")), "high", [species("palm", [at(-5, 0)])]);
    expect(field.update(cone(at(0, 0))).LOD0).toBe(1);
    field.dispose();
  });

  it("drops one-level things past their distance", () => {
    const field = buildVegetationField(library(["grass"]), "high", [species("grass", [at(10, 0), at(GRASS_DISTANCE + 5, 0)], false, GRASS_DISTANCE)]);
    expect(field.update(cone(at(0, 0)))).toEqual({ LOD0: 1, LOD1: 0, LOD2: 0, card: 0 });
    field.dispose();
  });

  it("draws the low tier's missing LOD0 with LOD1, through one shared set of meshes", () => {
    const root = library(["olive_LOD1", "olive_LOD2", "olive_card"]);
    const field = buildVegetationField(root, "low", [species("olive", [at(1, 0), at(LOD_DISTANCE.low[1] - 5, 0)])]);
    expect(field.objects).toHaveLength(6); // LOD1 (shared by LOD0), LOD2, card
    field.update(cone(at(0, 0)));
    expect(field.objects.find((o) => o.name.startsWith("olive:LOD0"))!.count).toBe(2);
    expect(reportError).not.toHaveBeenCalled();
    field.dispose();
  });

  it("reports a species the library cannot draw and draws the rest", () => {
    const field = buildVegetationField(library(TREE("palm")), "high", [species("olive", [at(5, 0)]), species("palm", [at(5, 0)])]);
    expect(reportError).toHaveBeenCalledWith("sawad-scene", expect.any(Error), expect.objectContaining({ stage: "vegetation", species: "olive" }));
    expect(field.update(cone(at(0, 0))).LOD0).toBe(1);
    field.dispose();
  });

  it("frees only its instance buffers, never the library's geometry", () => {
    const root = library(TREE("palm"));
    const geometry = (root.children[0].children[0] as Mesh).geometry;
    const spy = vi.spyOn(geometry, "dispose");
    const field = buildVegetationField(root, "high", [species("palm", [at(5, 0)])]);
    const instances = field.objects.map((o) => vi.spyOn(o, "dispose"));
    field.dispose();
    expect(instances.every((s) => s.mock.calls.length === 1)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("plants the whole plan from the real landscape on both tiers", () => {
    for (const tier of ["high", "low"] as const) {
      const land = planLandscape(tier);
      const names = ["olive-a", "olive-b", "palm", "citrus"].flatMap(TREE).concat(["hedge-low", "hedge-tall", "shrub-ball", "grass-green", "grass-dry"]);
      const field = buildVegetationField(library(names), tier);
      // From high above the middle of the site, looking down the valley: every tree is in the far field.
      const drawn = field.update(cone(at(0, 2000, -60), { x: 0, y: -1, z: 0 }, -1));
      expect(drawn.card).toBe(land.olives.length + land.palms.length + land.citrus.length);
      field.dispose();
    }
  });
});

describe("prepareVegetationLibrary", () => {
  it("patches the foliage for one wind, once, and hands the same wind back", () => {
    const root = library(TREE("olive"));
    const material = (root.children[0].children[1] as Mesh).material as MeshStandardMaterial;
    const wind = prepareVegetationLibrary(root);
    const patched = material.onBeforeCompile;
    expect(material.customProgramCacheKey()).toBe("sawad-wind-olive");
    expect(prepareVegetationLibrary(root)).toBe(wind);
    expect(material.onBeforeCompile).toBe(patched);
  });
});

describe("needsResort", () => {
  it("sorts again after a move or a turn, not while the camera holds still", () => {
    const a = cone(at(0, 0));
    expect(needsResort(null, a)).toBe(true);
    expect(needsResort(a, cone(at(1, 0)))).toBe(false);
    expect(needsResort(a, cone(at(3, 0)))).toBe(true);
    const turned = { x: Math.cos(0.1), y: 0, z: Math.sin(0.1) }; // ~5.7 degrees
    expect(needsResort(a, cone(at(0, 0), turned))).toBe(true);
    expect(needsResort(a, cone(at(0, 0), a.forward, coneCos(30, 1)))).toBe(true);
  });

  it("widens the cone past the frame's diagonal", () => {
    const half = Math.acos(coneCos(40, 16 / 9, 0));
    expect((half * 180) / Math.PI).toBeGreaterThan(20 * (16 / 9) * 0.9);
    expect(coneCos(170, 3, 30)).toBeLessThan(0); // wider than a half space
    expect(coneCos(179, 50, 90)).toBeCloseTo(-1, 6); // never past straight behind
  });
});
