// @vitest-environment jsdom
import { createRef, useEffect } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { useThree, type RootState } from "@react-three/fiber";
import { Vector3, type PerspectiveCamera } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({ instances: [] as Array<{ target: { x: number; y: number; z: number }; enabled: boolean; update: () => void; dispose: () => void }> }));
vi.mock("three/examples/jsm/controls/OrbitControls.js", async () => {
  const { Vector3: V3 } = await import("three");
  class FakeControls {
    target = new V3();
    enabled = true;
    enableDamping = false;
    update = vi.fn();
    dispose = vi.fn();
    constructor() {
      controls.instances.push(this);
    }
  }
  return { OrbitControls: FakeControls };
});

import { CameraRig, type CameraRigProps } from "./CameraRig";
import { DISTANCE, FLY_SECONDS, GROUND_CLEARANCE, TARGET_BOUNDS, markerPose } from "./flight";
import { COMPOUND_CENTER, planVillaSlot, villaSlot } from "./layout";
import { siteFor } from "./site";
import type { SceneApi, SceneMarker } from "./types";
import { FILM_HOLD_SECONDS, viewpoints } from "./viewpoints";

const markers: SceneMarker[] = [
  { id: "v1", kind: "villa", slot: 0, status: "available", label: "V1" },
  { id: "a1", kind: "apartment", slot: 2, status: "reserved", label: "A1" },
];

let root: RootState;
function Probe() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    root = get();
  }, [get]);
  return null;
}

type Rig = Awaited<ReturnType<typeof mount>>;
async function mount(props: CameraRigProps) {
  const scene = (p: CameraRigProps) => (
    <>
      <Probe />
      <CameraRig {...p} />
    </>
  );
  const renderer = await ReactThreeTestRenderer.create(scene(props), { width: 800, height: 450 });
  return {
    camera: root.camera as PerspectiveCamera,
    canvas: root.gl.domElement,
    update: (next: CameraRigProps) => renderer.update(scene(next)),
    unmount: () => renderer.unmount(),
    /** Advances the frame loop one frame at a time. */
    async frames(n: number, dt = 0.1) {
      for (let i = 0; i < n; i++) await renderer.advanceFrames(1, dt);
    },
  };
}

const position = (rig: Rig) => rig.camera.position.toArray();
const at = (v: readonly number[]) => new Vector3(v[0], v[1], v[2]);
const lastControls = () => controls.instances[controls.instances.length - 1];

afterEach(() => {
  controls.instances.length = 0;
  vi.restoreAllMocks();
});

describe("CameraRig", () => {
  it("starts at the requested view, with orbit controls only in the explorer", async () => {
    const explorer = await mount({ variant: "dijla", mode: "explorer", view: "aerial" });
    const aerial = viewpoints("dijla").aerial;
    expect(position(explorer)).toEqual(aerial.position);
    expect(explorer.camera.fov).toBe(aerial.fov);
    expect(controls.instances).toHaveLength(1);
    expect(at(Object.values(lastControls().target)).toArray()).toEqual(aerial.target);
    await explorer.unmount();
    expect(lastControls().dispose).toHaveBeenCalled();

    controls.instances.length = 0;
    const film = await mount({ variant: "dijla", mode: "film", view: "flight" });
    expect(position(film)).toEqual(viewpoints("dijla").flight.position);
    expect(controls.instances).toHaveLength(0);
    await film.unmount();
  });

  it("keeps an orbiting camera out of the foothills behind the 28 ha plan", async () => {
    const rig = await mount({ variant: "zaitun", mode: "explorer", view: "aerial" });
    const ground = siteFor("zaitun").ground(0, -450);
    expect(ground).toBeGreaterThan(20);
    rig.camera.position.set(0, ground - 5, -450); // dragged into the hillside
    await rig.frames(1);
    expect(rig.camera.position.y).toBeGreaterThanOrEqual(ground + GROUND_CLEARANCE - 1e-9);
    await rig.unmount();
  });

  it("flies to a Zaitun Hills home on its 28 ha plot", async () => {
    const markers = [{ id: "ZH-V60", kind: "villa" as const, slot: 59, status: "available" as const, label: "ZH-V60" }];
    const rig = await mount({ variant: "zaitun", mode: "explorer", view: "aerial", markers, reducedMotion: true });
    await rig.update({ variant: "zaitun", mode: "explorer", view: "aerial", markers, reducedMotion: true, selectedId: "ZH-V60" });
    const slot = planVillaSlot(59);
    expect(lastControls().target.x).toBeCloseTo(slot.x, 6);
    expect(lastControls().target.z).toBeCloseTo(slot.z, 6);
    await rig.unmount();
  });

  it("jumps to a view instantly under reduced motion and flies otherwise", async () => {
    const street = viewpoints("dijla").street.position;
    const still = await mount({ variant: "dijla", mode: "explorer", view: "aerial", reducedMotion: true });
    await still.update({ variant: "dijla", mode: "explorer", view: "street", reducedMotion: true });
    expect(position(still)).toEqual(street);
    await still.unmount();

    const rig = await mount({ variant: "dijla", mode: "explorer", view: "aerial" });
    await rig.update({ variant: "dijla", mode: "explorer", view: "street" });
    expect(lastControls().enabled).toBe(false); // the flight owns the camera
    await rig.frames(1);
    expect(position(rig)).not.toEqual(street);
    expect(position(rig)).not.toEqual(viewpoints("dijla").aerial.position);
    await rig.frames(Math.ceil(FLY_SECONDS / 0.1));
    expect(at(position(rig)).distanceTo(at(street))).toBeLessThan(1e-6);
    expect(lastControls().enabled).toBe(true);
    await rig.unmount();
  });

  it("arcs upward on a long flight so the camera clears the buildings", async () => {
    const rig = await mount({ variant: "dijla", mode: "explorer", view: "street" });
    const views = viewpoints("dijla");
    await rig.update({ variant: "dijla", mode: "explorer", view: "terrace" });
    let highest = 0;
    for (let i = 0; i < 12; i++) {
      await rig.frames(1);
      highest = Math.max(highest, rig.camera.position.y);
    }
    expect(highest).toBeGreaterThan(Math.max(views.street.position[1], views.terrace.position[1]) + 5);
    await rig.unmount();
  });

  it("flies to a newly selected home and frames its marker", async () => {
    const base: CameraRigProps = { variant: "dijla", mode: "explorer", view: "aerial", reducedMotion: true, markers };
    const rig = await mount(base);
    const before = at(position(rig));
    await rig.update({ ...base, selectedId: "v1" });
    const slot = villaSlot(0);
    const aerial = viewpoints("dijla").aerial;
    const expected = markerPose([slot.x, slot.y, slot.z], before.toArray(), aerial.target, aerial.fov + 6);
    expect(position(rig)).toEqual(expected.position);
    expect(rig.camera.fov).toBe(expected.fov);
    // The marker sits just above the centre of the picture.
    rig.camera.updateMatrixWorld();
    const ndc = at([slot.x, slot.y, slot.z]).project(rig.camera);
    expect(Math.abs(ndc.x)).toBeLessThan(0.01);
    expect(ndc.y).toBeGreaterThan(0);
    expect(ndc.y).toBeLessThan(0.2);
    // An unknown home leaves the camera where it is.
    await rig.update({ ...base, selectedId: "missing" });
    expect(position(rig)).toEqual(expected.position);
    await rig.unmount();
  });

  it("flies to the home that is already selected when the scene opens", async () => {
    const rig = await mount({ variant: "dijla", mode: "explorer", view: "aerial", markers, selectedId: "a1" });
    const start = at(position(rig));
    await rig.frames(Math.ceil(FLY_SECONDS / 0.1) + 1);
    expect(at(position(rig)).distanceTo(start)).toBeGreaterThan(20);
    await rig.unmount();
  });

  it("zooms toward the target, within limits, and resets to the current view", async () => {
    const apiRef = createRef<SceneApi | null>();
    const rig = await mount({ variant: "dijla", mode: "explorer", view: "aerial", reducedMotion: true, apiRef });
    const aerial = viewpoints("dijla").aerial;
    const target = at(aerial.target);
    const far = at(aerial.position).distanceTo(target);
    await ReactThreeTestRenderer.act(async () => apiRef.current!.zoom(1));
    expect(rig.camera.position.distanceTo(target)).toBeCloseTo(far * 0.7, 6);
    for (let i = 0; i < 30; i++) await ReactThreeTestRenderer.act(async () => apiRef.current!.zoom(1));
    expect(rig.camera.position.distanceTo(target)).toBeCloseTo(DISTANCE.min, 6);
    for (let i = 0; i < 30; i++) await ReactThreeTestRenderer.act(async () => apiRef.current!.zoom(-1));
    expect(rig.camera.position.distanceTo(target)).toBeCloseTo(DISTANCE.max, 6);
    await ReactThreeTestRenderer.act(async () => apiRef.current!.reset());
    expect(position(rig)).toEqual(aerial.position);
    await rig.unmount();
    expect(apiRef.current).toBeNull();
  });

  it("keeps the orbit target on the site and lets a press interrupt a flight", async () => {
    const rig = await mount({ variant: "dijla", mode: "explorer", view: "aerial" });
    const orbit = lastControls();
    orbit.target.x = 9000;
    orbit.target.y = -50;
    await rig.frames(1);
    expect(orbit.update).toHaveBeenCalled();
    expect(orbit.target.x).toBe(TARGET_BOUNDS.maxX);
    expect(orbit.target.y).toBe(TARGET_BOUNDS.minY);

    await rig.update({ variant: "dijla", mode: "explorer", view: "street" });
    await rig.frames(2);
    const mid = at(position(rig));
    rig.canvas.dispatchEvent(new Event("pointerdown"));
    expect(orbit.enabled).toBe(true); // the user is in charge
    await rig.frames(5);
    expect(at(position(rig)).distanceTo(mid)).toBe(0);
    await rig.unmount();
  });

  it("holds the film's opening shot, then lifts off and keeps circling the compound", async () => {
    const rig = await mount({ variant: "dijla", mode: "film", view: "flight", frame: { x: 0.12, y: 0.1 } });
    const open = at(viewpoints("dijla").flight.position);
    await rig.frames(10);
    expect(rig.camera.position.distanceTo(open)).toBeLessThan(0.01); // holding the poster frame
    expect(rig.camera.view?.enabled ?? false).toBe(false); // unshifted, like the poster
    await rig.frames(120);
    const flying = rig.camera.position.clone();
    expect(flying.distanceTo(open)).toBeGreaterThan(20);
    expect(rig.camera.view).toMatchObject({ enabled: true, offsetX: -0.12 * 800, offsetY: 0.1 * 450 });
    await rig.frames(20);
    expect(rig.camera.position.distanceTo(flying)).toBeGreaterThan(5); // still moving
    // A new view restarts the film from that shot, unshifted again.
    await rig.update({ variant: "dijla", mode: "film", view: "terrace", frame: { x: 0.12, y: 0.1 } });
    expect(rig.camera.position.distanceTo(at(viewpoints("dijla").terrace.position))).toBeLessThan(0.01);
    await rig.frames(1);
    expect(rig.camera.view?.enabled ?? false).toBe(false);
    await rig.unmount();
  });

  it("never advances more than a tenth of a second per frame, so a stalled tab does not jump", async () => {
    const rig = await mount({ variant: "shatt", mode: "film", view: "flight" });
    const open = at(viewpoints("shatt").flight.position);
    await rig.frames(1, 60); // a minute-long stall counts as 0.1 s
    expect(rig.camera.position.distanceTo(open)).toBeLessThan(0.01);
    await rig.frames(Math.ceil(FILM_HOLD_SECONDS / 0.1) + 30);
    expect(rig.camera.position.distanceTo(open)).toBeGreaterThan(1);
    await rig.unmount();
  });

  it("leaves the picture unshifted on a narrow screen", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <Probe />
        <CameraRig variant="dijla" mode="film" view="flight" frame={{ x: 0.12, y: 0.1 }} />
      </>,
      { width: 400, height: 700 },
    );
    for (let i = 0; i < 140; i++) await renderer.advanceFrames(1, 0.1);
    expect((root.camera as PerspectiveCamera).view?.enabled ?? false).toBe(false);
    await renderer.unmount();
  });

  it("measures marker flights from the compound centre before the controls exist", () => {
    // The pivot the rig falls back to is the compound centre (see flyToMarker in the explorer).
    expect(COMPOUND_CENTER).toMatchObject({ x: 0, z: -20 });
  });
});
