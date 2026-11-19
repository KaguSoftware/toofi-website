import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Scene, ShaderMaterial, Texture, type WebGLRenderer } from "three";
import { describe, expect, it, vi } from "vitest";

// PMREM needs a GPU; record what it was asked to prefilter instead.
const pmrem = vi.hoisted(() => ({ scenes: [] as unknown[], targets: [] as Array<{ texture: unknown; dispose: () => void }>, disposed: 0, fail: false }));
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class FakePMREMGenerator {
    fromScene(scene: unknown) {
      if (pmrem.fail) throw new Error("no float targets");
      pmrem.scenes.push(scene);
      const target = { texture: new actual.Texture(), dispose: vi.fn() };
      pmrem.targets.push(target);
      return target;
    }
    dispose() {
      pmrem.disposed++;
    }
  }
  return { ...actual, PMREMGenerator: FakePMREMGenerator };
});

import {
  ENVIRONMENT_INTENSITY,
  HAZE_COLOR,
  HEMISPHERE_LIGHT,
  REFLECTIVE_ENV_INTENSITY,
  SUN_LIGHT,
  applyReflections,
  buildArchitecture,
  buildGardenPool,
  buildPalms,
  buildRoundTrees,
  buildSky,
  buildSkyEnvironment,
  buildTerrain,
  buildWater,
  createWaterMaterial,
  fogDensity,
  paletteHex,
  sunDirection,
  sunLightPosition,
} from "./world";
import { PLAN_SITE, SITE, planApartmentBlocks, planVillas } from "./layout";
import { planLandscape } from "./landscape";
import { planGroundAxes, planPoolWater } from "./planWorld";

describe("the procedural world", () => {
  it("builds the land, river and pool as single named meshes", () => {
    const terrain = buildTerrain("dijla", "low");
    expect(terrain.name).toBe("terrain");
    expect(terrain.receiveShadow).toBe(true);
    // The high tier is a finer grid.
    const fine = buildTerrain("dijla", "high");
    expect(fine.geometry.getAttribute("position").count).toBeGreaterThan(terrain.geometry.getAttribute("position").count);
    const material = createWaterMaterial(sunDirection("dijla"), "dijla");
    const river = buildWater("dijla", material);
    const pool = buildGardenPool(material);
    expect(river.name).toBe("river");
    expect(pool.name).toBe("garden-pool");
    expect(pool.material).toBe(river.material); // one shader animates both
    for (const m of [terrain, fine, river, pool]) m.geometry.dispose();
    material.dispose();
  });

  it("plants palms as two instanced meshes, fewer on the low tier", () => {
    const low = buildPalms("dijla", "low");
    expect(low.objects.map((o) => o.name)).toEqual(["palm-trunks", "palm-crowns"]);
    const crowns = low.objects[1];
    expect(crowns).toBeInstanceOf(InstancedMesh);
    expect(crowns.count).toBeGreaterThan(300);
    expect(crowns.castShadow).toBe(true);
    const high = buildPalms("dijla", "high");
    expect(high.objects[1].count).toBeGreaterThan(crowns.count);
    const geometry = vi.spyOn(crowns.geometry, "dispose");
    const material = vi.spyOn(crowns.material as MeshStandardMaterial, "dispose");
    const instances = vi.spyOn(crowns, "dispose");
    low.dispose();
    high.dispose();
    expect(geometry).toHaveBeenCalled();
    expect(material).toHaveBeenCalled();
    expect(instances).toHaveBeenCalled();
  });

  it("covers Zaitun's foothills in olives and keeps a few shade trees elsewhere", () => {
    const olives = buildRoundTrees("zaitun", "high");
    expect(olives.objects.map((o) => o.name)).toEqual(["tree-trunks", "tree-crowns"]);
    expect(olives.objects[1].count).toBeGreaterThan(800);
    const fewer = buildRoundTrees("zaitun", "low");
    expect(fewer.objects[1].count).toBeLessThan(olives.objects[1].count);
    const shade = buildRoundTrees("dijla", "high");
    expect(shade.objects[1].count).toBeLessThan(100);
    for (const p of [olives, fewer, shade]) p.dispose();
  });

  it("keeps the sun low on the horizon for golden hour", () => {
    for (const v of ["dijla", "zaitun", "shatt"] as const) {
      const d = sunDirection(v);
      expect(d.length()).toBeCloseTo(1, 5);
      expect(Math.asin(d.y) * (180 / Math.PI)).toBeLessThan(8);
      expect(d.x).toBeGreaterThan(0.8);
    }
    expect(sunDirection("dijla", 4).y).toBeGreaterThan(sunDirection("dijla").y);
  });

  it("puts the sun light above the visible sun, with a warm colour and one large shadow map", () => {
    const p = sunLightPosition("zaitun");
    expect(p.length()).toBeCloseTo(SUN_LIGHT.distance, 3);
    expect(p.clone().normalize().y).toBeGreaterThan(sunDirection("zaitun").y); // lifted so the ground still reads
    expect(SUN_LIGHT.color).toBe("#ffa65c");
    expect(SUN_LIGHT.shadow.mapSize).toBe(4096);
    expect(HEMISPHERE_LIGHT.intensity).toBeGreaterThan(0);
  });

  it("hazes every compound, Shatt a little more", () => {
    expect(HAZE_COLOR).toBe("#e6ae86");
    expect(fogDensity("shatt")).toBeGreaterThan(fogDensity("zaitun"));
    expect(fogDensity("dijla")).toBe(fogDensity("zaitun"));
  });

  it("exposes the palette as sRGB hex for the model check", () => {
    const palette = paletteHex();
    expect(palette.cream).toBe("#ecdfc7");
    expect(palette.brass).toBe("#c9a24a");
  });

  it("prefilters the golden-hour sky alone into an environment map", () => {
    const sky = buildSky(sunDirection("shatt"));
    expect(sky.mesh.name).toBe("sky");
    const target = buildSkyEnvironment({} as WebGLRenderer, sky);
    const envScene = pmrem.scenes.at(-1) as Scene;
    expect(envScene.children).toHaveLength(1);
    const envSky = (envScene.children[0] as Mesh).material as ShaderMaterial;
    // Same sky, minus the sun disc (an HDR spike that the prefilter would smear); the
    // on-screen sky is unchanged.
    expect(envSky.fragmentShader).toBe(sky.material.fragmentShader);
    expect(envSky.uniforms.uSunDisc.value).toBe(0);
    expect(sky.material.uniforms.uSunDisc.value).toBe(1);
    // NaN guard: pow() of a slightly negative azimuth term would poison the whole env map.
    expect(sky.material.fragmentShader).toMatch(/float az = clamp\(/);
    expect(target).toBe(pmrem.targets.at(-1));
    expect(ENVIRONMENT_INTENSITY).toBeGreaterThan(0);
    expect(ENVIRONMENT_INTENSITY).toBeLessThanOrEqual(1);
    expect(pmrem.disposed).toBeGreaterThan(0);
  });

  it("frees the prefilter even when it fails", () => {
    const sky = buildSky(sunDirection("dijla"));
    const before = pmrem.disposed;
    pmrem.fail = true;
    try {
      expect(() => buildSkyEnvironment({} as WebGLRenderer, sky)).toThrow("no float targets");
    } finally {
      pmrem.fail = false;
    }
    expect(pmrem.disposed).toBe(before + 1);
  });

  it("gives the model's metals and polished glass full sky reflections, not the trim sheet", () => {
    const env = new Texture();
    const brass = new MeshStandardMaterial({ metalness: 1, roughness: 0.35 });
    const glass = new MeshStandardMaterial({ metalness: 0, roughness: 0.05 });
    // glTF trim-sheet materials carry factors of 1 and take metalness/roughness from a texture.
    const atlas = new MeshStandardMaterial({ metalness: 1, roughness: 1, metalnessMap: new Texture(), roughnessMap: new Texture() });
    const model = new Group();
    for (const m of [brass, glass, atlas]) model.add(new Mesh(new BoxGeometry(), m));
    applyReflections(model, env);
    expect(brass.envMap).toBe(env);
    expect(brass.envMapIntensity).toBe(REFLECTIVE_ENV_INTENSITY);
    expect(glass.envMap).toBe(env);
    expect(atlas.envMap).toBeNull(); // uses scene.environment at ENVIRONMENT_INTENSITY
  });

  it("keeps the procedural compound buildable as the fallback", () => {
    const mesh = buildArchitecture();
    expect(mesh.name).toBe("architecture");
    expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
    expect(mesh.geometry.getAttribute("position").count).toBeGreaterThan(1000);
    mesh.geometry.dispose();
  });

  it("draws Zaitun Hills' land and water on the 28 ha plan, and the others on the 7 ha layout", () => {
    const zaitun = buildTerrain("zaitun", "low");
    const { xs, zs } = planGroundAxes("low");
    expect(zaitun.geometry.getAttribute("position").count).toBe(xs.length * zs.length);
    const material = createWaterMaterial(sunDirection("zaitun"), "zaitun");
    const pool = buildGardenPool(material, "zaitun");
    pool.geometry.computeBoundingBox();
    const w = planPoolWater();
    expect(pool.geometry.boundingBox!.min.x).toBeCloseTo(w.minX, 5);
    expect(pool.geometry.boundingBox!.max.z).toBeCloseTo(w.maxZ, 5);
    const old = buildGardenPool(material);
    old.geometry.computeBoundingBox();
    expect(old.geometry.boundingBox!.max.z).toBeCloseTo(-16, 5); // the 7 ha pool, 60 m long about z = -46
    const river = buildWater("zaitun", material);
    expect(river.name).toBe("river");
    for (const m of [zaitun, pool, old, river]) m.geometry.dispose();
    material.dispose();
  });

  it("falls back to procedural trees at the plan's own spots on Zaitun Hills", () => {
    const land = planLandscape("low");
    const palms = buildPalms("zaitun", "low");
    expect(palms.objects[1].count).toBeLessThanOrEqual(land.palms.length);
    expect(palms.objects[1].count).toBeGreaterThan(300);
    // Every fallback palm stands where the plan puts one.
    const m = new Matrix4();
    const spots = new Set(land.palms.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`));
    for (let i = 0; i < palms.objects[0].count; i += 37) {
      palms.objects[0].getMatrixAt(i, m);
      const e = m.elements;
      expect(spots.has(`${e[12].toFixed(2)},${e[14].toFixed(2)}`)).toBe(true);
    }
    palms.dispose();
  });

  it("builds Zaitun Hills' fallback compound on the 28 ha plan: 60 villas, 6 blocks, walls to the site's edge", () => {
    const plan = buildArchitecture("zaitun");
    const old = buildArchitecture("dijla");
    plan.geometry.computeBoundingBox();
    old.geometry.computeBoundingBox();
    const box = plan.geometry.boundingBox!;
    expect(box.min.x).toBeLessThan(PLAN_SITE.minX + 1);
    expect(box.max.x).toBeGreaterThan(PLAN_SITE.maxX - 1);
    expect(box.min.z).toBeLessThan(PLAN_SITE.minZ + 1);
    expect(old.geometry.boundingBox!.min.x).toBeGreaterThan(SITE.minX - 40);
    expect(plan.geometry.getAttribute("position").count).toBeGreaterThan(2 * old.geometry.getAttribute("position").count);
    // A villa's slab stands at its own ground level (the upper rows are 6 m up, on the terrace).
    const upper = planVillas().find((v) => v.row === "terrace-hill")!;
    expect(upper.y).toBeGreaterThan(planVillas()[0].y);
    expect(planApartmentBlocks()).toHaveLength(6);
    plan.geometry.dispose();
    old.geometry.dispose();
  });

  it("creates a water material with the sun direction and the scene's haze", () => {
    const m = createWaterMaterial(sunDirection("dijla"), "dijla");
    expect(m.uniforms.uSunDir.value.y).toBeGreaterThan(0);
    expect(m.uniforms.uFogDensity.value).toBe(fogDensity("dijla"));
    expect(m.fragmentShader).toContain("glint");
    m.dispose();
  });
});
