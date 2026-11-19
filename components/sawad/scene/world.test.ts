import { BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, Scene, ShaderMaterial, Texture, type WebGLRenderer } from "three";
import { describe, expect, it, vi } from "vitest";

// PMREM needs a GPU; record what it was asked to prefilter instead.
const pmrem = vi.hoisted(() => ({ scenes: [] as unknown[], targets: [] as Array<{ texture: unknown; dispose: () => void }>, disposed: 0 }));
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class FakePMREMGenerator {
    fromScene(scene: unknown) {
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

import { ENVIRONMENT_INTENSITY, REFLECTIVE_ENV_INTENSITY, buildArchitecture, buildWorld, createWaterMaterial, sunDirection } from "./world";

describe("buildWorld", () => {
  it("builds the low-tier Tigris scene without a renderer", () => {
    const world = buildWorld({ variant: "dijla", tier: "low" });
    const names = world.scene.children.map((c) => c.name).filter(Boolean);
    expect(names).toEqual(expect.arrayContaining(["sky", "terrain", "river", "garden-pool", "palm-trunks", "palm-crowns", "architecture"]));
    const palms = world.scene.getObjectByName("palm-crowns") as InstancedMesh;
    expect(palms).toBeInstanceOf(InstancedMesh);
    expect(palms.count).toBeGreaterThan(300);
    expect(world.sun.castShadow).toBe(false);
    // Few draw calls: everything is instanced or merged.
    const meshes: Mesh[] = [];
    world.scene.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
    expect(meshes.length).toBeLessThan(15);
    world.dispose();
    expect(world.scene.children).toHaveLength(0);
  });

  it("casts shadows on the high tier and plants olives on Zaitun", () => {
    const world = buildWorld({ variant: "zaitun", tier: "high" });
    expect(world.sun.castShadow).toBe(true);
    const olives = world.scene.getObjectByName("tree-crowns") as InstancedMesh;
    expect(olives.count).toBeGreaterThan(800);
    world.dispose();
  });

  it("animates the water and sky through update()", () => {
    const world = buildWorld({ variant: "shatt", tier: "low" });
    world.update(12.5);
    const water = world.water.material as ShaderMaterial;
    expect(water.uniforms.uTime.value).toBe(12.5);
    world.dispose();
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

  it("swaps the procedural architecture for the baked model and disposes both", () => {
    const world = buildWorld({ variant: "dijla", tier: "low" });
    const procedural = world.scene.getObjectByName("architecture") as Mesh;
    expect(procedural).toBeInstanceOf(Mesh);
    const oldGeometry = vi.spyOn(procedural.geometry, "dispose");
    const oldMaterial = vi.spyOn(procedural.material as MeshStandardMaterial, "dispose");
    const model = new Group();
    model.name = "architecture-model";
    const map = new Texture();
    const part = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map }));
    model.add(part);
    world.setArchitecture(model);
    expect(world.scene.getObjectByName("architecture")).toBeUndefined();
    expect(world.scene.getObjectByName("architecture-model")).toBe(model);
    expect(oldGeometry).toHaveBeenCalled();
    expect(oldMaterial).toHaveBeenCalled();
    world.setArchitecture(model); // idempotent
    expect(world.scene.getObjectByName("architecture-model")).toBe(model);
    const newGeometry = vi.spyOn(part.geometry, "dispose");
    const newMap = vi.spyOn(map, "dispose");
    world.dispose();
    expect(newGeometry).toHaveBeenCalled();
    expect(newMap).toHaveBeenCalled();
  });

  it("prefilters the golden-hour sky alone into scene.environment", () => {
    const world = buildWorld({ variant: "shatt", tier: "low" });
    world.setEnvironment({} as WebGLRenderer);
    const envScene = pmrem.scenes.at(-1) as Scene;
    expect(envScene.children).toHaveLength(1);
    const sky = world.scene.getObjectByName("sky") as Mesh;
    const envSky = (envScene.children[0] as Mesh).material as ShaderMaterial;
    const screenSky = sky.material as ShaderMaterial;
    // Same sky, minus the sun disc (an HDR spike that the prefilter would smear); the
    // on-screen sky is unchanged.
    expect(envSky.fragmentShader).toBe(screenSky.fragmentShader);
    expect(envSky.uniforms.uSunDisc.value).toBe(0);
    expect(screenSky.uniforms.uSunDisc.value).toBe(1);
    // NaN guard: pow() of a slightly negative azimuth term would poison the whole env map.
    expect(screenSky.fragmentShader).toMatch(/float az = clamp\(/);
    expect(world.scene.environment).toBe(pmrem.targets.at(-1)!.texture);
    expect(world.scene.environmentIntensity).toBe(ENVIRONMENT_INTENSITY);
    expect(ENVIRONMENT_INTENSITY).toBeGreaterThan(0);
    expect(ENVIRONMENT_INTENSITY).toBeLessThanOrEqual(1);
    expect(pmrem.disposed).toBeGreaterThan(0);
    // Rebuilding replaces the old target; dispose() frees the current one.
    const first = pmrem.targets.at(-1)!;
    world.setEnvironment({} as WebGLRenderer);
    expect(first.dispose).toHaveBeenCalled();
    world.dispose();
    expect(pmrem.targets.at(-1)!.dispose).toHaveBeenCalled();
    expect(world.scene.environment).toBeNull();
  });

  it("gives the model's metals and polished glass full sky reflections, not the trim sheet", () => {
    const world = buildWorld({ variant: "dijla", tier: "low" });
    world.setEnvironment({} as WebGLRenderer);
    const env = world.scene.environment;
    const brass = new MeshStandardMaterial({ metalness: 1, roughness: 0.35 });
    const glass = new MeshStandardMaterial({ metalness: 0, roughness: 0.05 });
    // glTF trim-sheet materials carry factors of 1 and take metalness/roughness from a texture.
    const atlas = new MeshStandardMaterial({ metalness: 1, roughness: 1, metalnessMap: new Texture(), roughnessMap: new Texture() });
    const model = new Group();
    for (const m of [brass, glass, atlas]) model.add(new Mesh(new BoxGeometry(), m));
    world.setArchitecture(model);
    expect(brass.envMap).toBe(env);
    expect(brass.envMapIntensity).toBe(REFLECTIVE_ENV_INTENSITY);
    expect(glass.envMap).toBe(env);
    expect(atlas.envMap).toBeNull(); // uses scene.environment at ENVIRONMENT_INTENSITY
    world.dispose();
  });

  it("keeps the procedural compound buildable as the fallback", () => {
    const mesh = buildArchitecture();
    expect(mesh.name).toBe("architecture");
    expect(mesh.geometry.getAttribute("position").count).toBeGreaterThan(1000);
    mesh.geometry.dispose();
  });

  it("creates a water material with the sun direction", () => {
    const m = createWaterMaterial(sunDirection("dijla"), "dijla");
    expect(m.uniforms.uSunDir.value.y).toBeGreaterThan(0);
    expect(m.fragmentShader).toContain("glint");
    m.dispose();
  });
});
