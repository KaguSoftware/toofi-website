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
const mon = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: mon.reportError }));

// The parts have their own tests; here they only record what the root hands them.
const parts = vi.hoisted(() => ({
  world: [] as unknown[],
  markers: [] as unknown[],
  units: [] as unknown[],
  rig: [] as unknown[],
  fx: [] as unknown[],
  reel: [] as unknown[],
  /** The scene detail the world is given through context, one entry per render. */
  detail: [] as string[],
  composer: null as unknown,
  draw: { calls: [] as unknown[][], fail: null as Error | null },
}));
const record = (list: unknown[]) => (p: unknown) => {
  list.push(p);
  return null;
};
vi.mock("./ExperienceWorld", async () => {
  const { useContext } = await import("react");
  const { SceneDetail } = await import("../scene/SceneVegetation");
  return {
    ExperienceWorld: (p: unknown) => {
      parts.detail.push(useContext(SceneDetail));
      return record(parts.world)(p);
    },
  };
});
vi.mock("./ReelCapture", () => ({ ReelCapture: (p: unknown) => record(parts.reel)(p) }));
vi.mock("../scene/SceneMarkers", () => ({ SceneMarkers: (p: unknown) => record(parts.markers)(p) }));
vi.mock("./UnitTargets", () => ({ UnitTargets: (p: unknown) => record(parts.units)(p) }));
vi.mock("./StoryRig", () => ({ StoryRig: (p: unknown) => record(parts.rig)(p) }));
// Shader compiling has its own tests; here each call is recorded and finishes when the test says.
const ahead = vi.hoisted(() => ({
  compiles: [] as Array<{ draw: () => void; resolve: (ok: boolean) => void; reject: (e: unknown) => void }>,
  warms: [] as Array<{ draw: () => void; cancelled: () => boolean; resolve: (frames: number) => void; reject: (e: unknown) => void }>,
  auto: true,
}));
vi.mock("./compileAhead", () => ({
  compileAhead: (_gl: unknown, draw: () => void) =>
    ahead.auto ? Promise.resolve(true) : new Promise<boolean>((resolve, reject) => ahead.compiles.push({ draw, resolve, reject })),
  warmUp: (_gl: unknown, draw: () => void, options: { cancelled: () => boolean }) =>
    ahead.auto ? Promise.resolve(1) : new Promise<number>((resolve, reject) => ahead.warms.push({ draw, cancelled: options.cancelled, resolve, reject })),
}));
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

import { ExperienceRoot, QualityMonitor, RenderPass, fxChunk, loadPostFX, resetPostFX, sceneControl, type ExperienceRootProps } from "./ExperienceRoot";
import { QUALITY, REEL_QUALITY } from "./quality";
import type { ReelCaptureProps } from "./ReelCapture";
import { initialRigState } from "./types";
import { emptyInput } from "./walk";

const last = <T,>(list: unknown[]) => list.at(-1) as T;
const world = () => last<ExperienceWorldProps>(parts.world);
const rig = () => last<StoryRigProps>(parts.rig);
const fx = () => last<PostFXProps>(parts.fx);
const reel = () => last<ReelCaptureProps>(parts.reel);

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
/** Lets a chain of already-resolved promises run to its end. */
const drain = async () => {
  for (let i = 0; i < 5; i++) await settle();
};
let model: Deferred;
let vegetation: Deferred;
let life: Deferred;

beforeEach(() => {
  model = deferred();
  vegetation = deferred();
  life = deferred();
  loads.pending = { model, vegetation, life };
  for (const list of [parts.world, parts.markers, parts.units, parts.rig, parts.fx, parts.reel, parts.detail, parts.draw.calls, ahead.compiles, ahead.warms]) list.length = 0;
  parts.composer = null;
  parts.draw.fail = null;
  ahead.auto = true;
  mon.reportError.mockClear();
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
    await drain();
    expect(onReady).not.toHaveBeenCalled();
    const plants = { scene: new Group(), animations: [] };
    vegetation.resolve(plants);
    await drain();
    expect(onReady).not.toHaveBeenCalled();
    const people = { scene: new Group(), animations: [] };
    life.resolve(people);
    await drain();
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
    await drain();
    expect(onReady).toHaveBeenCalledOnce();
    expect(world()).toMatchObject({ model: null, fallback: true, vegetation: null, plantingFallback: true, life: null });
    await scene.unmount();
  });

  describe("shaders ahead of the first frame", () => {
    const arrive = async () => {
      model.resolve(new Group());
      vegetation.resolve({ scene: new Group(), animations: [] });
      life.resolve({ scene: new Group(), animations: [] });
      await drain();
    };

    it("compiles in the background as things arrive, then warms up, and only then is ready", async () => {
      ahead.auto = false;
      parts.composer = { name: "composer" };
      const onReady = vi.fn();
      const scene = await mount({ ...base, onReady });
      await drain();
      // The world and the effect chain are in: their shaders start compiling while the model downloads.
      expect(ahead.compiles).toHaveLength(1);
      ahead.compiles[0].draw();
      expect(parts.draw.calls.at(-1)).toEqual([root.gl, parts.composer, 0]);
      ahead.compiles[0].resolve(true);

      model.resolve(new Group());
      await drain();
      expect(ahead.compiles).toHaveLength(2);
      expect(ahead.warms).toHaveLength(0);
      ahead.compiles[1].resolve(true);

      vegetation.resolve({ scene: new Group(), animations: [] });
      life.resolve({ scene: new Group(), animations: [] });
      await drain();
      // Everything is in: one last compile, and the frame loop still waits.
      expect(ahead.compiles).toHaveLength(3);
      expect(onReady).not.toHaveBeenCalled();
      ahead.compiles[2].resolve(true);
      await drain();
      expect(ahead.warms).toHaveLength(1);
      expect(onReady).not.toHaveBeenCalled();
      ahead.warms[0].draw();
      expect(parts.draw.calls.at(-1)).toEqual([root.gl, parts.composer, 0]);
      ahead.warms[0].resolve(8);
      await drain();
      expect(onReady).toHaveBeenCalledOnce();
      expect(mon.reportError).not.toHaveBeenCalled();
      await scene.unmount();
    });

    it("compiles one arrival after another, never two at once", async () => {
      ahead.auto = false;
      const scene = await mount(base);
      await drain();
      model.resolve(new Group());
      await drain();
      // The first compile is still running: the second waits its turn.
      expect(ahead.compiles).toHaveLength(1);
      ahead.compiles[0].resolve(true);
      await drain();
      expect(ahead.compiles).toHaveLength(2);
      await scene.unmount();
    });

    it("draws nothing in a dry frame while there is no composer", async () => {
      ahead.auto = false;
      const scene = await mount(base);
      await drain();
      ahead.compiles[0].draw();
      expect(parts.draw.calls).toEqual([]);
      await scene.unmount();
    });

    it("reports a failed compile and still starts: the shaders are then built in the first frame", async () => {
      ahead.auto = false;
      const onReady = vi.fn();
      const scene = await mount({ ...base, tier: "low", onReady });
      await arrive();
      const boom = new Error("context lost during compile");
      ahead.compiles[0].reject(boom);
      await drain();
      expect(mon.reportError).toHaveBeenCalledWith("ExperienceRoot", boom, { stage: "compile-ahead", tier: "low" });
      // The compiles queued behind it still run, then the warm-up.
      for (const c of ahead.compiles.slice(1)) c.resolve(true);
      await drain();
      for (const c of ahead.compiles) c.resolve(true);
      await drain();
      ahead.warms.at(-1)!.resolve(3);
      await drain();
      expect(onReady).toHaveBeenCalledOnce();
      await scene.unmount();
    });

    it("reports a failed warm-up and still starts", async () => {
      ahead.auto = false;
      const onReady = vi.fn();
      const scene = await mount({ ...base, onReady });
      await arrive();
      for (let i = 0; i < 4; i++) {
        for (const c of ahead.compiles) c.resolve(true);
        await drain();
      }
      const boom = new Error("draw failed");
      ahead.warms.at(-1)!.reject(boom);
      await drain();
      expect(mon.reportError).toHaveBeenCalledWith("ExperienceRoot", boom, { stage: "compile-ahead", tier: "high" });
      expect(onReady).toHaveBeenCalledOnce();
      await scene.unmount();
    });

    it("stops at once when the scene is torn down, and never says ready", async () => {
      ahead.auto = false;
      const onReady = vi.fn();
      const scene = await mount({ ...base, onReady });
      await arrive();
      for (let i = 0; i < 4; i++) {
        for (const c of ahead.compiles) c.resolve(true);
        await drain();
      }
      const warm = ahead.warms.at(-1)!;
      expect(warm.cancelled()).toBe(false);
      await scene.unmount();
      expect(warm.cancelled()).toBe(true);
      warm.resolve(0);
      await drain();
      expect(onReady).not.toHaveBeenCalled();
    });

    it("does not compile after a teardown that came while an earlier compile was running", async () => {
      ahead.auto = false;
      const scene = await mount(base);
      await drain();
      model.resolve(new Group());
      await drain();
      await scene.unmount();
      ahead.compiles[0].resolve(true);
      await drain();
      expect(ahead.compiles).toHaveLength(1);
      expect(ahead.warms).toHaveLength(0);
    });
  });

  describe("the effect chain's chunk", () => {
    it("is asked for once and shared by later mounts", async () => {
      const load = vi.spyOn(fxChunk, "load");
      const first = loadPostFX();
      expect(loadPostFX()).toBe(first);
      await first;
      expect(load).not.toHaveBeenCalled(); // already in from the mounts above
    });

    it("waits for the chunk before mounting the effects", async () => {
      const scene = await mount(base);
      await drain();
      expect(fx().settings).toBe(QUALITY[2]);
      await scene.unmount();
    });

    it("does not remember a chunk that failed to load: the next call asks again", async () => {
      resetPostFX();
      const boom = new Error("chunk failed");
      const load = vi.spyOn(fxChunk, "load").mockRejectedValueOnce(boom);
      await expect(loadPostFX()).rejects.toBe(boom);
      const chain = await loadPostFX();
      expect(typeof chain.drawComposer).toBe("function");
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("hands a failed chunk to onError: without the effect chain there is no picture to show", async () => {
      resetPostFX();
      const boom = new Error("chunk failed");
      vi.spyOn(fxChunk, "load").mockRejectedValueOnce(boom);
      const onError = vi.fn();
      const onReady = vi.fn();
      const scene = await mount({ ...base, onError, onReady });
      model.resolve(new Group());
      vegetation.resolve({ scene: new Group(), animations: [] });
      life.resolve({ scene: new Group(), animations: [] });
      await drain();
      expect(onError).toHaveBeenCalledExactlyOnceWith(boom);
      expect(onReady).not.toHaveBeenCalled();
      expect(parts.fx).toHaveLength(0);
      await scene.unmount();
    });

    it("says nothing about a chunk that fails, or arrives, after the scene is gone", async () => {
      for (const outcome of ["fails", "arrives"] as const) {
        resetPostFX();
        const chunk = deferred();
        vi.spyOn(fxChunk, "load").mockReturnValueOnce(chunk.promise as never);
        const onError = vi.fn();
        const scene = await mount({ ...base, onError });
        await scene.unmount();
        if (outcome === "fails") chunk.reject(new Error("chunk failed"));
        else chunk.resolve({ PostFX: () => null, drawComposer: () => {} });
        await drain();
        expect(onError).not.toHaveBeenCalled();
        expect(parts.fx).toHaveLength(0);
      }
      resetPostFX();
    });
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
    await drain();
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

  it("asks for a step up when the frame rate holds, through its own monitor", async () => {
    const onQuality = vi.fn();
    const scene = await mount({ ...base, onQuality });
    getRoot().set({ frameloop: "always" });
    // Two and a half seconds at 60 frames a second.
    await scene.frames(149);
    expect(onQuality).not.toHaveBeenCalled();
    await scene.frames(2);
    expect(onQuality.mock.calls).toEqual([[1]]);
    await scene.unmount();
  });

  it("leaves the level alone during a capture: stills must not depend on the machine", async () => {
    const onQuality = vi.fn();
    const scene = await mount({ ...base, holdAt: 30, onQuality });
    getRoot().set({ frameloop: "always" });
    await scene.frames(400);
    expect(onQuality).not.toHaveBeenCalled();
    await scene.unmount();
  });

  it("draws the live scene at the detail its distances give, with no capture handle", async () => {
    const scene = await mount(base);
    await drain();
    expect(parts.detail.at(-1)).toBe("distance");
    expect(parts.reel).toHaveLength(0);
    expect(rig().reel).toBeNull();
    await scene.unmount();
  });

  it("records the reel at its own quality, with every plant at its finest, frame by frame", async () => {
    const onQuality = vi.fn();
    const onReelReady = vi.fn();
    const group = new Group();
    const scene = await mount({ ...base, level: 3, reel: true, onQuality, onReelReady });
    await drain();
    // The reel's settings whatever the level: two device pixels per CSS pixel, no grain.
    expect(fx().settings).toBe(REEL_QUALITY);
    expect(getRoot().viewport.dpr).toBe(REEL_QUALITY.maxDpr);
    expect(parts.detail.at(-1)).toBe("max");
    // The opening still takes over from its poster: the reel's first frame is the poster's.
    expect(world().sunRise).toBe(true);
    // The capture and the camera rig share one head; the capture waits for the shaders.
    expect(reel().head).toBe(rig().reel);
    expect(reel().head.current).toEqual({ position: 0 });
    expect(reel().onReady).toBe(onReelReady);
    expect(reel().ready).toBe(false);
    model.resolve(group);
    vegetation.resolve({ scene: new Group(), animations: [] });
    life.resolve({ scene: new Group(), animations: [] });
    await drain();
    expect(reel().ready).toBe(true);
    expect(reel().model).toBe(group);
    // No monitor: a frame may take as long as it likes.
    getRoot().set({ frameloop: "always" });
    await scene.frames(400);
    expect(onQuality).not.toHaveBeenCalled();
    await scene.unmount();
  });

  it("hands the rig the shot an explorer opened from the reel starts on", async () => {
    const scene = await mount({ ...base, mode: "orbit", startAt: 48 });
    expect(rig().startAt).toBe(48);
    await scene.unmount();
  });

  it("draws through the composer once the effects exist", async () => {
    parts.composer = { name: "composer" };
    const onFirstFrame = vi.fn();
    const scene = await mount({ ...base, onFirstFrame });
    await drain();
    parts.draw.calls.length = 0;
    await scene.frames(2);
    expect(parts.draw.calls).toHaveLength(2);
    expect(parts.draw.calls[0][0]).toBe(root.gl);
    expect(parts.draw.calls[0][1]).toBe(parts.composer);
    expect(scene.render).not.toHaveBeenCalled();
    expect(onFirstFrame).toHaveBeenCalledOnce();
    await scene.unmount();
  });

  it("gives the page a handle that stops and restarts the drawing", async () => {
    const control = { current: null as null | { pause: () => void; resume: () => void } };
    const scene = await mount({ ...base, controlRef: control });
    getRoot().set({ frameloop: "always" });
    control.current!.pause();
    expect(getRoot().frameloop).toBe("never");
    control.current!.resume();
    expect(getRoot().frameloop).toBe("always");
    // The handle outlives the cleanup a hidden page runs.
    await scene.unmount();
    expect(control.current).not.toBeNull();
  });
});

describe("sceneControl", () => {
  const store = (frameloop: "always" | "demand" | "never") => {
    const state = { frameloop, setFrameloop: vi.fn((next: "always" | "demand" | "never") => void (state.frameloop = next)) };
    return { state, get: () => state };
  };

  it("pauses a running loop and restarts it as it was", () => {
    for (const loop of ["always", "demand"] as const) {
      const s = store(loop);
      const control = sceneControl(s.get);
      control.pause();
      expect(s.state.frameloop).toBe("never");
      control.resume();
      expect(s.state.frameloop).toBe(loop);
    }
  });

  it("leaves a loop that has not started alone", () => {
    const s = store("never");
    const control = sceneControl(s.get);
    control.pause();
    control.resume();
    expect(s.state.setFrameloop).not.toHaveBeenCalled();
  });

  it("agrees across handles to one canvas: a later handle resumes what an earlier one paused", () => {
    const s = store("always");
    sceneControl(s.get).pause();
    sceneControl(s.get).resume();
    expect(s.state.frameloop).toBe("always");
  });

  it("does not undo a loop the canvas was given while paused", () => {
    const s = store("always");
    const control = sceneControl(s.get);
    control.pause();
    s.state.frameloop = "demand";
    control.resume();
    expect(s.state.frameloop).toBe("demand");
    // And forgets the pause: a second resume does nothing.
    s.state.frameloop = "never";
    control.resume();
    expect(s.state.frameloop).toBe("never");
  });

  it("pauses once: a second pause does not forget what was running", () => {
    const s = store("demand");
    const control = sceneControl(s.get);
    control.pause();
    control.pause();
    control.resume();
    expect(s.state.frameloop).toBe("demand");
  });
});

describe("QualityMonitor", () => {
  async function monitored(props: { tier: "low" | "high"; level: 0 | 1 | 2 | 3; onQuality?: (d: 1 | -1) => void; onStarved?: () => void }) {
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <Probe />
        <QualityMonitor {...props} />
      </>,
    );
    getRoot().set({ frameloop: "always" });
    return { renderer, frames: (n: number, fps: number) => renderer.advanceFrames(n, 1 / fps) };
  }

  it("asks for a step down when frames stay slow", async () => {
    const onQuality = vi.fn();
    const m = await monitored({ tier: "high", level: 2, onQuality });
    await m.frames(90, 30);
    expect(onQuality.mock.calls).toEqual([[-1]]);
    await m.renderer.unmount();
  });

  it("gives up at the lowest level when frames stay unwatchable", async () => {
    const onQuality = vi.fn();
    const onStarved = vi.fn();
    const m = await monitored({ tier: "high", level: 1, onQuality, onStarved });
    await m.frames(15 * 12, 15);
    expect(onStarved).toHaveBeenCalledOnce();
    expect(onQuality).not.toHaveBeenCalled();
    await m.renderer.unmount();
  });

  it("judges only a loop that runs by itself", async () => {
    const onQuality = vi.fn();
    const m = await monitored({ tier: "high", level: 2, onQuality });
    getRoot().set({ frameloop: "demand" });
    await m.frames(300, 30);
    expect(onQuality).not.toHaveBeenCalled();
    await m.renderer.unmount();
  });

  it("does nothing without listeners", async () => {
    const m = await monitored({ tier: "low", level: 0 });
    await expect(m.frames(200, 60)).resolves.toBeUndefined();
    const slow = await monitored({ tier: "high", level: 2 });
    await expect(slow.frames(100, 30)).resolves.toBeUndefined();
    const starved = await monitored({ tier: "high", level: 1 });
    await expect(starved.frames(200, 15)).resolves.toBeUndefined();
    await m.renderer.unmount();
    await slow.renderer.unmount();
    await starved.renderer.unmount();
  });
});

describe("RenderPass", () => {
  type Draw = (...args: unknown[]) => void;
  async function pass(props: { composer?: unknown; draw?: Draw; onFirstFrame?: () => void; onFrame?: (n: number) => void; onError?: (e: unknown) => void; onContextLost?: () => void }) {
    const composer = { current: props.composer ?? null } as RefObject<never>;
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <Probe />
        <RenderPass composer={composer} draw={props.draw as never} onFirstFrame={props.onFirstFrame} onFrame={props.onFrame} onError={props.onError} onContextLost={props.onContextLost} />
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

  it("draws with the renderer while the effect chain's code has not arrived", async () => {
    const p = await pass({ composer: {} });
    await p.frames(1);
    expect(p.render).toHaveBeenCalledOnce();
    await p.renderer.unmount();
  });

  it("reports a failed draw once and stops drawing", async () => {
    const onError = vi.fn();
    const onFirstFrame = vi.fn();
    const boom = new Error("shader failed to compile");
    const draw = vi.fn(() => {
      throw boom;
    });
    const p = await pass({ composer: {}, draw, onError, onFirstFrame });
    for (let i = 0; i < 3; i++) await p.frames(1);
    expect(onError).toHaveBeenCalledExactlyOnceWith(boom);
    expect(draw).toHaveBeenCalledOnce();
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

  it("tells the page once when the browser takes the context away, and stops drawing", async () => {
    const onError = vi.fn();
    const onContextLost = vi.fn();
    const p = await pass({ onError, onContextLost });
    const canvas = root.gl.domElement;
    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lost);
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(lost.defaultPrevented).toBe(true);
    // An event to recover from, not an error.
    expect(onContextLost).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    await p.frames(2);
    expect(p.render).not.toHaveBeenCalled();
    await p.renderer.unmount();
    onContextLost.mockClear();
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(onContextLost).not.toHaveBeenCalled();
  });

  it("draws a frame run by hand for the shaders without counting it, and lets its errors through", async () => {
    const onFirstFrame = vi.fn();
    const onFrame = vi.fn();
    const onError = vi.fn();
    const draw = vi.fn();
    const preparing = { current: true };
    const composer = { current: { name: "composer" } } as unknown as RefObject<never>;
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <Probe />
        <RenderPass composer={composer} draw={draw as never} preparing={preparing} onFirstFrame={onFirstFrame} onFrame={onFrame} onError={onError} />
      </>,
    );
    const render = vi.spyOn(root.gl, "render").mockImplementation(() => {});
    await renderer.advanceFrames(2, 1 / 60);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(draw).toHaveBeenLastCalledWith(root.gl, composer.current, 0);
    expect(onFirstFrame).not.toHaveBeenCalled();
    expect(onFrame).not.toHaveBeenCalled();
    // A failure belongs to whoever ran the frame: the scene is not marked failed.
    draw.mockImplementationOnce(() => {
      throw new Error("warm-up draw failed");
    });
    expect(() => getRoot().advance(0, false)).toThrow("warm-up draw failed");
    expect(onError).not.toHaveBeenCalled();
    // The first real frame is still the first one counted.
    preparing.current = false;
    await renderer.advanceFrames(1, 1 / 60);
    expect(onFirstFrame).toHaveBeenCalledOnce();
    expect(onFrame).toHaveBeenLastCalledWith(1);
    expect(render).not.toHaveBeenCalled();
    await renderer.unmount();
  });

  it("draws nothing in such a frame while there is no composer to draw through", async () => {
    const preparing = { current: true };
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <Probe />
        <RenderPass composer={{ current: null } as RefObject<never>} preparing={preparing} />
      </>,
    );
    const render = vi.spyOn(root.gl, "render").mockImplementation(() => {});
    await renderer.advanceFrames(1, 1 / 60);
    expect(render).not.toHaveBeenCalled();
    await renderer.unmount();
  });

  it("reports a lost context as an error where nobody listens for the loss", async () => {
    const onError = vi.fn();
    const p = await pass({ onError });
    root.gl.domElement.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toMatchObject({ message: "WebGL context lost" });
    await p.renderer.unmount();
    const quiet = await pass({});
    expect(() => root.gl.domElement.dispatchEvent(new Event("webglcontextlost", { cancelable: true }))).not.toThrow();
    await quiet.renderer.unmount();
  });
});
