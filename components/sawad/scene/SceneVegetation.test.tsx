import { useEffect } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { useThree, type RootState } from "@react-three/fiber";
import { BoxGeometry, BufferAttribute, Group, Mesh, MeshStandardMaterial, type InstancedMesh, type PerspectiveCamera } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

const reportError = vi.fn();
vi.mock("@/lib/monitoring", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

import type { Wind } from "@/lib/sawad/wind";
import { planLandscape } from "./landscape";
import { PlantsStill, SceneDetail, SceneVegetation } from "./SceneVegetation";

const TREES = ["olive-a", "olive-b", "palm", "citrus"].flatMap((a) => [`${a}_LOD0`, `${a}_LOD1`, `${a}_LOD2`, `${a}_card`]);
const OTHERS = ["hedge-low", "hedge-tall", "shrub-ball", "grass-green", "grass-dry"];

/** A stand-in for vegetation-<tier>.glb: every node the plan needs, one primitive each. */
function library() {
  const scene = new Group();
  const material = new MeshStandardMaterial({ name: "veg-olive" });
  for (const name of [...TREES, ...OTHERS]) {
    const g = new BoxGeometry(1, 2, 1);
    g.setAttribute("_wind", new BufferAttribute(new Float32Array(g.getAttribute("position").count * 4), 4));
    const mesh = new Mesh(g, material);
    mesh.name = name;
    scene.add(mesh);
  }
  return { scene, animations: [] };
}

let root: RootState;
function Probe() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    root = get();
  }, [get]);
  return null;
}

async function mount(lib = library()) {
  const renderer = await ReactThreeTestRenderer.create(
    <>
      <Probe />
      <SceneVegetation tier="low" library={lib} />
    </>,
  );
  return { renderer, lib, instanced: () => (root.scene.getObjectByName("vegetation")!.children as InstancedMesh[]) };
}

const drawn = (meshes: InstancedMesh[]) => meshes.reduce((n, m) => n + m.count, 0);

afterEach(() => reportError.mockClear());

describe("SceneVegetation", () => {
  it("mounts the plan's planting and sorts it for the camera before drawing", async () => {
    const { renderer, instanced } = await mount();
    expect(instanced().length).toBeGreaterThan(0);
    expect(drawn(instanced())).toBe(0); // nothing sorted until the frame loop runs
    const camera = root.camera as PerspectiveCamera;
    camera.position.set(0, 400, 600);
    camera.lookAt(0, 0, -60);
    await renderer.advanceFrames(1, 1 / 60);
    const land = planLandscape("low");
    expect(drawn(instanced())).toBeGreaterThan(0);
    expect(drawn(instanced())).toBeLessThanOrEqual(land.olives.length + land.palms.length + land.citrus.length + land.hedges.length + land.shrubs.length + land.grass.length);
    expect(reportError).not.toHaveBeenCalled();
    await renderer.unmount();
  });

  it("draws every plant at its finest level under the reel capture's max detail", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <SceneDetail value="max">
        <Probe />
        <SceneVegetation tier="low" library={library()} />
      </SceneDetail>,
    );
    const instanced = () => root.scene.getObjectByName("vegetation")!.children as InstancedMesh[];
    const camera = root.camera as PerspectiveCamera;
    camera.position.set(0, 400, 600);
    camera.lookAt(0, 0, -60);
    await renderer.advanceFrames(1, 1 / 60);
    const land = planLandscape("low");
    expect(drawn(instanced())).toBe(land.olives.length + land.palms.length + land.citrus.length + land.hedges.length + land.shrubs.length + land.grass.length);
    // Looking the other way draws the same plants, at the same levels.
    const before = instanced().map((m) => m.count);
    camera.lookAt(0, 0, 4000);
    await renderer.advanceFrames(1, 1 / 60);
    expect(instanced().map((m) => m.count)).toEqual(before);
    expect(instanced().filter((m) => /:(LOD1|LOD2|card):/.test(m.name)).every((m) => m.count === 0)).toBe(true);
    await renderer.unmount();
  });

  it("sorts again when the camera turns away", async () => {
    const { renderer, instanced } = await mount();
    const camera = root.camera as PerspectiveCamera;
    camera.position.set(0, 30, 0);
    camera.lookAt(0, 0, -400); // toward the olive slopes
    await renderer.advanceFrames(1, 1 / 60);
    const inland = drawn(instanced());
    camera.lookAt(0, 30, 1000); // up over the far bank and the sky
    camera.position.y = 200;
    await renderer.advanceFrames(1, 1 / 60);
    expect(drawn(instanced())).toBeLessThan(inland);
    await renderer.unmount();
  });

  it("moves the breeze with the frame clock, a tenth of a second at most per frame", async () => {
    const { renderer, lib } = await mount();
    const wind = lib.scene.userData.sawadWind as Wind;
    await renderer.advanceFrames(3, 0.05);
    expect(wind.uniforms.uWindTime.value).toBeCloseTo(0.15);
    await renderer.advanceFrames(1, 30);
    expect(wind.uniforms.uWindTime.value).toBeCloseTo(0.25);
    await renderer.unmount();
  });

  it("holds the breeze in still frames, and picks it up where it was", async () => {
    const lib = library();
    const hold = { current: { still: false } };
    const renderer = await ReactThreeTestRenderer.create(
      <PlantsStill value={hold}>
        <Probe />
        <SceneVegetation tier="low" library={lib} />
      </PlantsStill>,
    );
    const update = vi.spyOn(lib.scene.userData.sawadWind as Wind, "update");
    await renderer.advanceFrames(1, 0.05);
    const at = update.mock.lastCall![0];
    hold.current.still = true;
    await renderer.advanceFrames(5, 0.05);
    expect(update.mock.lastCall![0]).toBe(at);
    hold.current.still = false;
    await renderer.advanceFrames(1, 0.05);
    expect(update.mock.lastCall![0]).toBeCloseTo(at + 0.05);
    await renderer.unmount();
  });

  it("frees its instance buffers on unmount, and leaves the library to its loader", async () => {
    const { renderer, instanced, lib } = await mount();
    const spies = instanced().map((m) => vi.spyOn(m, "dispose"));
    const geometry = vi.spyOn((lib.scene.children[0] as Mesh).geometry, "dispose");
    await renderer.unmount();
    expect(spies.every((s) => s.mock.calls.length === 1)).toBe(true);
    expect(geometry).not.toHaveBeenCalled();
  });
});
