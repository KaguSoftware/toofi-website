// @vitest-environment jsdom
import { useEffect, type RefObject } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { useThree, type RootState } from "@react-three/fiber";
import { Group } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneMarkersProps } from "../scene/SceneMarkers";
import type { SceneMarker } from "../scene/types";
import type { ExperienceWorldProps } from "./ExperienceWorld";
import type { PostFXProps } from "./PostFX";
import type { StoryRigProps } from "./StoryRig";
import type { UnitTargetsProps } from "./UnitTargets";

// The baked model and the two libraries: each test decides when (and whether) they arrive.
type Deferred = { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void };
const deferred = (): Deferred => {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const loads = vi.hoisted(() => ({ pending: {} as Record<string, { promise: Promise<unknown> }> }));
vi.mock("../scene/compoundModel", () => ({
  loadCompound: () => loads.pending.model.promise,
  loadLibrary: (kind: string) => loads.pending[kind].promise,
  disposeObject: vi.fn(),
}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

// The parts have their own tests; here they only record what the root hands them.
const parts = vi.hoisted(() => ({
  world: [] as unknown[],
  markers: [] as unknown[],
  units: [] as unknown[],
  rig: [] as unknown[],
  fx: [] as unknown[],
  monitor: [] as unknown[],
  composer: null as unknown,
  draw: { calls: [] as unknown[][], fail: null as Error | null },
}));
const record = (list: unknown[]) => (p: unknown) => {
  list.push(p);
  return null;
};
vi.mock("./ExperienceWorld", () => ({ ExperienceWorld: (p: unknown) => record(parts.world)(p) }));
vi.mock("../scene/SceneMarkers", () => ({ SceneMarkers: (p: unknown) => record(parts.markers)(p) }));
vi.mock("./UnitTargets", () => ({ UnitTargets: (p: unknown) => record(parts.units)(p) }));
vi.mock("./StoryRig", () => ({ StoryRig: (p: unknown) => record(parts.rig)(p) }));
vi.mock("@react-three/drei/core/PerformanceMonitor", () => ({ PerformanceMonitor: (p: unknown) => record(parts.monitor)(p) }));
vi.mock("./PostFX", () => ({
  PostFX: (p: { composerRef: { current: unknown } }) => {
    parts.fx.push(p);
    p.composerRef.current = parts.composer;
    return null;
  },
  drawComposer: (...args: unknown[]) => {
    parts.draw.calls.push(args);
    if (parts.draw.fail) throw parts.draw.fail;
  },
}));

import { ExperienceRoot, RenderPass, type ExperienceRootProps } from "./ExperienceRoot";
import { QUALITY, fpsBounds } from "./quality";
import { initialRigState } from "./types";
import { emptyInput } from "./walk";

const last = <T,>(list: unknown[]) => list.at(-1) as T;
const world = () => last<ExperienceWorldProps>(parts.world);
const rig = () => last<StoryRigProps>(parts.rig);
const fx = () => last<PostFXProps>(parts.fx);
const monitor = () => last<{ bounds: (r: number) => [number, number]; flipflops: number; onDecline: () => void; onIncline: () => void; onFallback: () => void }>(parts.monitor);

let root: RootState;
let getRoot: () => RootState;
function Probe() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    getRoot = get;
    root = get();
  }, [get]);
  return null;
}

const markers: SceneMarker[] = [{ id: "ZH-V05", kind: "villa", slot: 4, status: "available", label: "ZH-V05" }];
const base: ExperienceRootProps = {
  tier: "high",
  level: 2,
  view: "flight",
  mode: "story",
  daylight: "day",
  scroll: { current: { progress: 0 } },
  input: { current: emptyInput() },
  rig: { current: initialRigState() },
};

async function mount(props: ExperienceRootProps) {
  const tree = (p: ExperienceRootProps) => (
    <>
      <Probe />
      <ExperienceRoot {...p} />
    </>
  );
  const renderer = await ReactThreeTestRenderer.create(tree(props));
  // The stand-in WebGL context cannot draw; record the draw calls instead.
  const render = vi.spyOn(root.gl, "render").mockImplementation(() => {});
  return {
    render,
    update: (next: ExperienceRootProps) => renderer.update(tree(next)),
    unmount: () => renderer.unmount(),
    frames: (n: number) => renderer.advanceFrames(n, 1 / 60),
  };
}
const settle = () => ReactThreeTestRenderer.act(async () => {});
let model: Deferred;
let vegetation: Deferred;
let life: Deferred;

beforeEach(() => {
  model = deferred();
  vegetation = deferred();
  life = deferred();
  loads.pending = { model, vegetation, life };
  for (const list of [parts.world, parts.markers, parts.units, parts.rig, parts.fx, parts.monitor, parts.draw.calls]) list.length = 0;
  parts.composer = null;
  parts.draw.fail = null;
  vi.stubGlobal("devicePixelRatio", 3);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ExperienceRoot", () => {
  it("is ready only once the model and both libraries have arrived", async () => {
    const onReady = vi.fn();
    const scene = await mount({ ...base, onReady });
    expect(world()).toMatchObject({ tier: "high", model: null, fallback: false, vegetation: null, life: null, plantingFallback: false });
    const group = new Group();
    model.resolve(group);
    await settle();
    expect(onReady).not.toHaveBeenCalled();
    const plants = { scene: new Group(), animations: [] };
    vegetation.resolve(plants);
    await settle();
    expect(onReady).not.toHaveBeenCalled();
    const people = { scene: new Group(), animations: [] };
    life.resolve(people);
    await settle();
    expect(onReady).toHaveBeenCalledOnce();
    expect(world()).toMatchObject({ model: group, fallback: true, vegetation: plants, life: people, plantingFallback: false });
    await scene.unmount();
  });

  it("is ready with the procedural fallbacks when everything fails", async () => {
    const onReady = vi.fn();
    const scene = await mount({ ...base, tier: "low", level: 0, onReady });
    model.reject(new Error("404"));
    vegetation.reject(new Error("404"));
    life.reject(new Error("404"));
    await settle();
    expect(onReady).toHaveBeenCalledOnce();
    expect(world()).toMatchObject({ model: null, fallback: true, vegetation: null, plantingFallback: true, life: null });
    await scene.unmount();
  });

  it("lets only the story's opening take over from its poster (no capture, no explorer on request)", async () => {
    const story = await mount(base);
    expect(world().sunRise).toBe(true);
    // Read once: a later change of mode does not start it again.
    await story.update({ ...base, mode: "orbit" });
    expect(world().sunRise).toBe(true);
    await story.unmount();
    const capture = await mount({ ...base, holdAt: 30 });
    expect(world().sunRise).toBe(false);
    await capture.unmount();
    const explorer = await mount({ ...base, mode: "orbit" });
    expect(world().sunRise).toBe(false);
    await explorer.unmount();
  });

  it("hands the homes to markers and click targets only while exploring", async () => {
    const onSelect = vi.fn();
    const story = await mount({ ...base, markers, selectedId: "ZH-V05", onSelect });
    expect(parts.markers).toHaveLength(0);
    expect(parts.units).toHaveLength(0);
    await story.update({ ...base, mode: "orbit", markers, selectedId: "ZH-V05", onSelect });
    expect(last<SceneMarkersProps>(parts.markers)).toMatchObject({ variant: "zaitun", markers, selectedId: "ZH-V05", onSelect });
    expect(last<UnitTargetsProps>(parts.units)).toMatchObject({ markers, selectedId: "ZH-V05", onSelect });
    await story.unmount();

    const walk = await mount({ ...base, mode: "walk" });
    expect(last<SceneMarkersProps>(parts.markers).markers).toEqual([]);
    expect(last<UnitTargetsProps>(parts.units).markers).toEqual([]);
    await walk.unmount();
  });

  it("hands the camera rig its inputs", async () => {
    const apiRef = { current: null };
    const onIntroEnd = vi.fn();
    const onError = vi.fn();
    const scene = await mount({ ...base, view: "aerial", reducedMotion: true, playing: false, holdAt: 30, markers, selectedId: "x", apiRef, onIntroEnd, onError });
    expect(rig()).toMatchObject({ view: "aerial", mode: "story", reducedMotion: true, playing: false, holdAt: 30, markers, selectedId: "x", apiRef, onIntroEnd, onError });
    expect(rig().scroll).toBe(base.scroll);
    expect(rig().input).toBe(base.input);
    expect(rig().rig).toBe(base.rig);
    await scene.unmount();
  });

  it("applies the quality level: effects, light shafts and the pixel ratio", async () => {
    const scene = await mount({ ...base, daylight: "dusk" });
    expect(fx().settings).toBe(QUALITY[2]);
    expect(fx().rig).toBe(base.rig);
    expect(world()).toMatchObject({ godRays: true, daylight: "dusk" });
    expect(getRoot().viewport.dpr).toBe(1.5);
    await scene.update({ ...base, level: 0 });
    expect(fx().settings).toBe(QUALITY[0]);
    expect(world().godRays).toBe(false);
    expect(getRoot().viewport.dpr).toBe(1);
    await scene.unmount();
  });

  it("asks for a step down or up as the frame rate moves", async () => {
    const onQuality = vi.fn();
    const scene = await mount({ ...base, tier: "low", onQuality });
    expect(monitor().bounds(60)).toEqual(fpsBounds("low", 60));
    expect(monitor().flipflops).toBe(3);
    monitor().onDecline();
    monitor().onIncline();
    monitor().onFallback();
    expect(onQuality.mock.calls).toEqual([[-1], [1], [-1]]);
    await scene.unmount();

    // Without a listener the monitor's callbacks do nothing.
    const quiet = await mount(base);
    expect(() => monitor().onDecline()).not.toThrow();
    expect(() => monitor().onIncline()).not.toThrow();
    expect(() => monitor().onFallback()).not.toThrow();
    await quiet.unmount();
  });

  it("draws through the composer once the effects exist", async () => {
    parts.composer = { name: "composer" };
    const onFirstFrame = vi.fn();
    const scene = await mount({ ...base, onFirstFrame });
    await scene.frames(2);
    expect(parts.draw.calls).toHaveLength(2);
    expect(parts.draw.calls[0][0]).toBe(root.gl);
    expect(parts.draw.calls[0][1]).toBe(parts.composer);
    expect(scene.render).not.toHaveBeenCalled();
    expect(onFirstFrame).toHaveBeenCalledOnce();
    await scene.unmount();
  });
});

describe("RenderPass", () => {
  async function pass(props: { composer?: unknown; onFirstFrame?: () => void; onFrame?: (n: number) => void; onError?: (e: unknown) => void }) {
    const composer = { current: props.composer ?? null } as RefObject<never>;
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <Probe />
        <RenderPass composer={composer} onFirstFrame={props.onFirstFrame} onFrame={props.onFrame} onError={props.onError} />
      </>,
    );
    const render = vi.spyOn(root.gl, "render").mockImplementation(() => {});
    return { render, renderer, frames: (n: number) => renderer.advanceFrames(n, 1 / 60) };
  }

  it("draws with the renderer when there is no composer, counting frames and announcing the first", async () => {
    const onFirstFrame = vi.fn();
    const onFrame = vi.fn();
    const p = await pass({ onFirstFrame, onFrame });
    expect(root.internal.priority).toBe(1); // the pass owns the draw call
    onFirstFrame.mockImplementation(() => expect(p.render).toHaveBeenCalledOnce());
    for (let i = 0; i < 3; i++) await p.frames(1);
    expect(p.render).toHaveBeenCalledTimes(3);
    expect(p.render).toHaveBeenLastCalledWith(root.scene, root.camera);
    expect(onFirstFrame).toHaveBeenCalledOnce();
    expect(onFrame.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);
    await p.renderer.unmount();
  });

  it("reports a failed draw once and stops drawing", async () => {
    const onError = vi.fn();
    const onFirstFrame = vi.fn();
    const boom = new Error("shader failed to compile");
    parts.draw.fail = boom;
    const p = await pass({ composer: {}, onError, onFirstFrame });
    for (let i = 0; i < 3; i++) await p.frames(1);
    expect(onError).toHaveBeenCalledExactlyOnceWith(boom);
    expect(parts.draw.calls).toHaveLength(1);
    expect(onFirstFrame).not.toHaveBeenCalled();
    await p.renderer.unmount();
  });

  it("draws quietly without any listeners, even when the draw fails", async () => {
    const p = await pass({});
    await p.frames(1);
    expect(p.render).toHaveBeenCalledOnce();
    p.render.mockImplementation(() => {
      throw new Error("lost");
    });
    await expect(p.frames(1)).resolves.toBeUndefined();
    await p.renderer.unmount();
  });

  it("reports a lost WebGL context once and stops drawing", async () => {
    const onError = vi.fn();
    const p = await pass({ onError });
    const canvas = root.gl.domElement;
    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lost);
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(lost.defaultPrevented).toBe(true);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toMatchObject({ message: "WebGL context lost" });
    await p.frames(2);
    expect(p.render).not.toHaveBeenCalled();
    await p.renderer.unmount();
    onError.mockClear();
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(onError).not.toHaveBeenCalled();
  });
});
