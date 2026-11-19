import { useEffect } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { useThree, type RootState } from "@react-three/fiber";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture, type Color, type DirectionalLight, type FogExp2, type InstancedMesh, type ShaderMaterial } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

// PMREM needs a GPU; hand back a stand-in target instead.
const pmrem = vi.hoisted(() => ({ targets: [] as Array<{ texture: unknown; dispose: () => void }>, fail: false }));
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class FakePMREMGenerator {
    fromScene() {
      if (pmrem.fail) throw new Error("no float targets");
      const target = { texture: new actual.Texture(), dispose: vi.fn() };
      pmrem.targets.push(target);
      return target;
    }
    dispose() {}
  }
  return { ...actual, PMREMGenerator: FakePMREMGenerator };
});
const reportError = vi.fn();
vi.mock("@/lib/monitoring", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

// The library-driven parts have their own tests; here they only record what they are handed.
const libraryParts = vi.hoisted(() => ({ vegetation: [] as unknown[], life: [] as unknown[] }));
vi.mock("./SceneVegetation", () => ({
  SceneVegetation: (p: unknown) => {
    libraryParts.vegetation.push(p);
    return null;
  },
}));
vi.mock("./SceneLife", () => ({
  SceneLife: (p: unknown) => {
    libraryParts.life.push(p);
    return null;
  },
}));

import { SceneWorld, type SceneWorldProps } from "./SceneWorld";
import { ENVIRONMENT_INTENSITY, HAZE_COLOR, REFLECTIVE_ENV_INTENSITY, SUN_LIGHT, fogDensity } from "./world";

let root: RootState;
function Probe() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    root = get();
  }, [get]);
  return null;
}

async function mount(props: SceneWorldProps) {
  const tree = (p: SceneWorldProps) => (
    <>
      <Probe />
      <SceneWorld {...p} />
    </>
  );
  const renderer = await ReactThreeTestRenderer.create(tree(props));
  return {
    scene: root.scene,
    update: (next: SceneWorldProps) => renderer.update(tree(next)),
    unmount: () => renderer.unmount(),
    async frames(n: number, dt: number) {
      for (let i = 0; i < n; i++) await renderer.advanceFrames(1, dt);
    },
  };
}

const names = () => root.scene.children.map((c) => c.name).filter(Boolean);

afterEach(() => {
  pmrem.targets.length = 0;
  pmrem.fail = false;
  reportError.mockClear();
});

describe("SceneWorld", () => {
  it("plants Zaitun Hills from the vegetation library, with its people, cars and birds", async () => {
    libraryParts.vegetation.length = 0;
    libraryParts.life.length = 0;
    const plants = { scene: new Group(), animations: [] };
    const people = { scene: new Group(), animations: [] };
    const world = await mount({ variant: "zaitun", tier: "high", model: null, fallback: false, vegetation: plants, life: people });
    expect(libraryParts.vegetation.at(-1)).toEqual({ tier: "high", library: plants });
    expect(libraryParts.life.at(-1)).toEqual({ tier: "high", library: people });
    expect(names()).not.toContain("palm-crowns"); // no procedural trees beside the library ones
    await world.unmount();
  });

  it("holds Zaitun Hills' planting until the library settles, then falls back to procedural trees", async () => {
    libraryParts.vegetation.length = 0;
    const world = await mount({ variant: "zaitun", tier: "low", model: null, fallback: false });
    expect(names()).not.toContain("palm-crowns");
    expect(libraryParts.vegetation).toHaveLength(0);
    await world.update({ variant: "zaitun", tier: "low", model: null, fallback: false, plantingFallback: true });
    expect(names()).toEqual(expect.arrayContaining(["palm-crowns", "tree-crowns"]));
    await world.unmount();
  });

  it("never hands the 7 ha compounds a library", async () => {
    libraryParts.vegetation.length = 0;
    libraryParts.life.length = 0;
    const lib = { scene: new Group(), animations: [] };
    const world = await mount({ variant: "dijla", tier: "low", model: null, fallback: false, vegetation: lib, life: lib });
    expect(libraryParts.vegetation).toHaveLength(0);
    expect(libraryParts.life).toHaveLength(0);
    expect(names()).toContain("palm-crowns");
    await world.unmount();
  });

  it("builds the low-tier Tigris scene in a handful of draw calls and frees it on unmount", async () => {
    const world = await mount({ variant: "dijla", tier: "low", model: null, fallback: false });
    expect(names()).toEqual(expect.arrayContaining(["sky", "sun", "terrain", "river", "garden-pool", "palm-trunks", "palm-crowns", "tree-trunks", "tree-crowns"]));
    // No buildings yet: the first frame is held until the model is in (or has failed).
    expect(names()).not.toContain("architecture");
    const palms = world.scene.getObjectByName("palm-crowns") as InstancedMesh;
    expect(palms.count).toBeGreaterThan(300);
    expect((world.scene.getObjectByName("sun") as DirectionalLight).castShadow).toBe(false);
    // Few draw calls: everything is instanced or merged.
    const meshes: Mesh[] = [];
    world.scene.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
    expect(meshes.length).toBeLessThan(15);
    const terrain = world.scene.getObjectByName("terrain") as Mesh;
    const geometry = vi.spyOn(terrain.geometry, "dispose");
    const instances = vi.spyOn(palms, "dispose");
    await world.unmount();
    expect(geometry).toHaveBeenCalled();
    expect(instances).toHaveBeenCalled();
    expect(world.scene.children).toHaveLength(0);
  });

  it("hazes the scene with the compound's fog and clear colour", async () => {
    const world = await mount({ variant: "shatt", tier: "low", model: null, fallback: false });
    const fog = world.scene.fog as FogExp2;
    expect(fog.density).toBe(fogDensity("shatt"));
    expect(`#${fog.color.getHexString()}`).toBe(HAZE_COLOR);
    expect(`#${(world.scene.background as Color).getHexString()}`).toBe(HAZE_COLOR);
    await world.unmount();
  });

  it("casts shadows on the high tier and plants olives on Zaitun", async () => {
    const world = await mount({ variant: "zaitun", tier: "high", model: null, fallback: false, plantingFallback: true });
    const sun = world.scene.getObjectByName("sun") as DirectionalLight;
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.mapSize.toArray()).toEqual([SUN_LIGHT.shadow.mapSize, SUN_LIGHT.shadow.mapSize]);
    expect(sun.shadow.camera.right).toBe(SUN_LIGHT.shadow.extent);
    expect(sun.shadow.camera.far).toBe(SUN_LIGHT.shadow.far);
    expect(sun.shadow.normalBias).toBe(SUN_LIGHT.shadow.normalBias);
    expect(sun.position.length()).toBeCloseTo(SUN_LIGHT.distance, 3);
    const olives = world.scene.getObjectByName("tree-crowns") as InstancedMesh;
    expect(olives.count).toBeGreaterThan(800);
    await world.unmount();
  });

  it("animates the water and the sky, never by more than a tenth of a second per frame", async () => {
    const world = await mount({ variant: "shatt", tier: "low", model: null, fallback: false });
    const water = (world.scene.getObjectByName("river") as Mesh).material as ShaderMaterial;
    const sky = (world.scene.getObjectByName("sky") as Mesh).material as ShaderMaterial;
    await world.frames(5, 0.05);
    expect(water.uniforms.uTime.value).toBeCloseTo(0.25);
    expect(sky.uniforms.uTime.value).toBeCloseTo(0.25);
    await world.frames(1, 30); // a stalled tab
    expect(water.uniforms.uTime.value).toBeCloseTo(0.35);
    await world.unmount();
  });

  it("lights the scene with the prefiltered sky and frees it on unmount", async () => {
    const world = await mount({ variant: "shatt", tier: "low", model: null, fallback: false });
    const target = pmrem.targets.at(-1)!;
    expect(world.scene.environment).toBe(target.texture);
    expect(world.scene.environmentIntensity).toBe(ENVIRONMENT_INTENSITY);
    expect(reportError).not.toHaveBeenCalled();
    await world.unmount();
    expect(target.dispose).toHaveBeenCalled();
    expect(world.scene.environment).toBeNull();
  });

  it("reports a failed environment map and still builds the scene", async () => {
    pmrem.fail = true;
    const world = await mount({ variant: "dijla", tier: "low", model: null, fallback: false });
    expect(reportError).toHaveBeenCalledWith("sawad-scene", expect.any(Error), expect.objectContaining({ stage: "environment", variant: "dijla", tier: "low" }));
    expect(world.scene.environment).toBeNull();
    expect(names()).toContain("terrain");
    await world.unmount();
  });

  it("shows the baked model with sky reflections on its metals, and leaves freeing it to its owner", async () => {
    const world = await mount({ variant: "dijla", tier: "low", model: null, fallback: false });
    const model = new Group();
    model.name = "architecture-model";
    const map = new Texture();
    const brass = new MeshStandardMaterial({ metalness: 1, roughness: 0.35 });
    const wall = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map }));
    model.add(wall, new Mesh(new BoxGeometry(), brass));
    await world.update({ variant: "dijla", tier: "low", model, fallback: true });
    expect(world.scene.getObjectByName("architecture-model")).toBe(model);
    expect(world.scene.getObjectByName("architecture")).toBeUndefined(); // never both
    expect(brass.envMap).toBe(world.scene.environment);
    expect(brass.envMapIntensity).toBe(REFLECTIVE_ENV_INTENSITY);
    const geometry = vi.spyOn(wall.geometry, "dispose");
    await world.unmount();
    expect(geometry).not.toHaveBeenCalled(); // useCompoundModel loaded it and frees it
  });

  it("falls back to the procedural compound and frees it", async () => {
    const world = await mount({ variant: "zaitun", tier: "low", model: null, fallback: false });
    await world.update({ variant: "zaitun", tier: "low", model: null, fallback: true });
    const procedural = world.scene.getObjectByName("architecture") as Mesh;
    expect(procedural).toBeTruthy();
    expect(procedural.geometry.getAttribute("position").count).toBeGreaterThan(1000);
    const geometry = vi.spyOn(procedural.geometry, "dispose");
    const material = vi.spyOn(procedural.material as MeshStandardMaterial, "dispose");
    await world.unmount();
    expect(geometry).toHaveBeenCalled();
    expect(material).toHaveBeenCalled();
  });
});
