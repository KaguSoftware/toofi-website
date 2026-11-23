// @vitest-environment jsdom
import { createRef, useEffect } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { useThree, type RootState } from "@react-three/fiber";
import { Group } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CameraRigProps } from "./CameraRig";
import type { SceneMarkersProps } from "./SceneMarkers";
import type { SceneWorldProps } from "./SceneWorld";
import type { SceneApi, SceneMarker } from "./types";

// The baked model: each test decides when (and whether) it arrives.
type Deferred = { promise: Promise<Group>; resolve: (g: Group) => void; reject: (e: unknown) => void };
let model: Deferred;
const deferred = (): Deferred => {
  let resolve!: (g: Group) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<Group>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
// The plant and life libraries (28 ha plan only), likewise.
type LibDeferred = { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void };
const libraryDeferred = (): LibDeferred => {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const libs = vi.hoisted(() => ({ pending: {} as Record<string, { promise: Promise<unknown> }>, loaded: [] as string[], compound: [] as unknown[][] }));
vi.mock("./compoundModel", () => ({
  loadCompound: (...args: unknown[]) => {
    libs.compound.push(args);
    return model.promise;
  },
  loadLibrary: (kind: string) => {
    libs.loaded.push(kind);
    return libs.pending[kind].promise;
  },
  disposeObject: vi.fn(),
}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

// The parts have their own tests; here they only record what the root hands them.
const parts = vi.hoisted(() => ({ world: [] as unknown[], markers: [] as unknown[], rig: [] as unknown[] }));
vi.mock("./SceneWorld", () => ({
  SceneWorld: (p: unknown) => {
    parts.world.push(p);
    return null;
  },
}));
vi.mock("./SceneMarkers", () => ({
  SceneMarkers: (p: unknown) => {
    parts.markers.push(p);
    return null;
  },
}));
vi.mock("./CameraRig", () => ({
  CameraRig: (p: unknown) => {
    parts.rig.push(p);
    return null;
  },
}));

import { SceneRoot, type SceneRootProps } from "./SceneRoot";

const world = () => parts.world.at(-1) as SceneWorldProps;
const markerLayer = () => parts.markers.at(-1) as SceneMarkersProps | undefined;
const rig = () => parts.rig.at(-1) as CameraRigProps;

let root: RootState;
function Probe() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    root = get();
  }, [get]);
  return null;
}

async function mount(props: SceneRootProps) {
  const renderer = await ReactThreeTestRenderer.create(
    <>
      <Probe />
      <SceneRoot {...props} />
    </>,
  );
  // The stand-in WebGL context cannot draw; record the draw calls instead.
  const render = vi.spyOn(root.gl, "render").mockImplementation(() => {});
  return {
    render,
    unmount: () => renderer.unmount(),
    async frames(n: number) {
      for (let i = 0; i < n; i++) await renderer.advanceFrames(1, 1 / 60);
    },
  };
}
/** Lets a settled model promise reach the scene. */
const settle = () => ReactThreeTestRenderer.act(async () => {});

const markers: SceneMarker[] = [{ id: "v1", kind: "villa", slot: 0, status: "available", label: "V1" }];
const film: SceneRootProps = { variant: "dijla", tier: "high", mode: "film", view: "flight" };

let vegetation: LibDeferred;
let life: LibDeferred;

beforeEach(() => {
  model = deferred();
  vegetation = libraryDeferred();
  life = libraryDeferred();
  libs.pending = { vegetation, life };
  libs.loaded.length = 0;
  parts.world.length = 0;
  parts.markers.length = 0;
  parts.rig.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("SceneRoot", () => {
  it("keeps the finder's compound on the far set (ledger T30)", async () => {
    libs.compound.length = 0;
    const scene = await mount({ ...film, variant: "zaitun" });
    expect(libs.compound[0]).toEqual(["high", expect.anything(), "zaitun", "far"]);
    await scene.unmount();
  });

  it("is not ready until the baked model is attached", async () => {
    const onReady = vi.fn();
    const scene = await mount({ ...film, onReady });
    expect(world()).toMatchObject({ variant: "dijla", tier: "high", model: null, fallback: false });
    expect(onReady).not.toHaveBeenCalled();
    const group = new Group();
    model.resolve(group);
    await settle();
    expect(world().model).toBe(group);
    expect(onReady).toHaveBeenCalledOnce();
    await scene.unmount();
  });

  it("becomes ready with the procedural compound when the model fails to load", async () => {
    const onReady = vi.fn();
    const scene = await mount({ ...film, variant: "zaitun", tier: "low", onReady });
    model.reject(new Error("404"));
    vegetation.resolve({ scene: new Group(), animations: [] });
    life.resolve({ scene: new Group(), animations: [] });
    await settle();
    expect(onReady).toHaveBeenCalledOnce();
    expect(world()).toMatchObject({ model: null, fallback: true });
    await scene.unmount();
  });

  it("on the 28 ha plan, waits for the plant and life libraries too, and hands them to the world", async () => {
    const onReady = vi.fn();
    const scene = await mount({ ...film, variant: "zaitun", onReady });
    expect(libs.loaded.sort()).toEqual(["life", "vegetation"]);
    model.resolve(new Group());
    await settle();
    expect(onReady).not.toHaveBeenCalled(); // the trees are not in yet
    const plants = { scene: new Group(), animations: [] };
    const people = { scene: new Group(), animations: [] };
    vegetation.resolve(plants);
    await settle();
    expect(onReady).not.toHaveBeenCalled();
    life.resolve(people);
    await settle();
    expect(onReady).toHaveBeenCalledOnce();
    expect(world()).toMatchObject({ vegetation: plants, life: people, plantingFallback: false });
    await scene.unmount();
  });

  it("plants procedural trees when the plant library fails, and goes on without life", async () => {
    const onReady = vi.fn();
    const scene = await mount({ ...film, variant: "zaitun", onReady });
    model.resolve(new Group());
    vegetation.reject(new Error("404"));
    life.reject(new Error("404"));
    await settle();
    expect(onReady).toHaveBeenCalledOnce();
    expect(world()).toMatchObject({ vegetation: null, life: null, plantingFallback: true });
    await scene.unmount();
  });

  it("never loads the libraries for the 7 ha compounds", async () => {
    const onReady = vi.fn();
    const scene = await mount({ ...film, onReady });
    model.resolve(new Group());
    await settle();
    expect(libs.loaded).toEqual([]);
    expect(onReady).toHaveBeenCalledOnce();
    expect(world()).toMatchObject({ vegetation: null, life: null, plantingFallback: false });
    await scene.unmount();
  });

  it("draws each frame itself, announcing the first one once it is on screen", async () => {
    const onFirstFrame = vi.fn();
    const onFrame = vi.fn();
    const scene = await mount({ ...film, onFirstFrame, onFrame });
    expect(root.internal.priority).toBe(1); // the render pass owns the draw call
    expect(onFirstFrame).not.toHaveBeenCalled();
    onFirstFrame.mockImplementation(() => expect(scene.render).toHaveBeenCalledOnce());
    await scene.frames(3);
    expect(scene.render).toHaveBeenCalledTimes(3);
    expect(scene.render).toHaveBeenLastCalledWith(root.scene, root.camera);
    expect(onFirstFrame).toHaveBeenCalledOnce();
    expect(onFrame.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);
    await scene.unmount();
  });

  it("reports a failed draw once and stops drawing", async () => {
    const onError = vi.fn();
    const onFirstFrame = vi.fn();
    const scene = await mount({ ...film, onError, onFirstFrame });
    const boom = new Error("shader failed to compile");
    scene.render.mockImplementationOnce(() => {
      throw boom;
    });
    await scene.frames(3);
    expect(onError).toHaveBeenCalledExactlyOnceWith(boom);
    expect(onFirstFrame).not.toHaveBeenCalled();
    expect(scene.render).toHaveBeenCalledOnce();
    await scene.unmount();
  });

  it("reports a lost WebGL context once and stops drawing", async () => {
    const onError = vi.fn();
    const scene = await mount({ ...film, onError });
    const lost = new Event("webglcontextlost", { cancelable: true });
    root.gl.domElement.dispatchEvent(lost);
    root.gl.domElement.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(lost.defaultPrevented).toBe(true);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toMatchObject({ message: "WebGL context lost" });
    await scene.frames(2);
    expect(scene.render).not.toHaveBeenCalled();
    // Once the scene is gone, its teardown (which drops the context) is not an error.
    const canvas = root.gl.domElement;
    await scene.unmount();
    onError.mockClear();
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(onError).not.toHaveBeenCalled();
  });

  it("shows home markers only in the explorer and hands the camera its inputs", async () => {
    const onSelect = vi.fn();
    const apiRef = createRef<SceneApi | null>();
    const explorer = await mount({ variant: "dijla", tier: "low", mode: "explorer", view: "aerial", markers, selectedId: "v1", onSelect, apiRef, reducedMotion: true });
    expect(markerLayer()).toMatchObject({ markers, selectedId: "v1", onSelect });
    expect(rig()).toMatchObject({ variant: "dijla", mode: "explorer", view: "aerial", markers, selectedId: "v1", apiRef, reducedMotion: true });
    await explorer.unmount();

    parts.markers.length = 0;
    const frame = { x: 0.12, y: 0.1 };
    const home = await mount({ ...film, frame });
    expect(markerLayer()).toBeUndefined();
    expect(rig()).toMatchObject({ mode: "film", view: "flight", frame });
    await home.unmount();
  });

  it("gives the explorer an empty marker layer before the homes arrive", async () => {
    const scene = await mount({ variant: "dijla", tier: "low", mode: "explorer", view: "aerial" });
    expect(markerLayer()?.markers).toEqual([]);
    await scene.unmount();
  });
});
