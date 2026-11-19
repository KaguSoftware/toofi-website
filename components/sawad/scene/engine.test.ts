import { DirectionalLight, Group, Mesh, PerspectiveCamera, Scene, Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rendered: Array<{ camera: PerspectiveCamera }> = [];
const rendererDispose = vi.fn();
const controlsDispose = vi.fn();
const worldDispose = vi.fn();
const setArchitecture = vi.fn();
const setEnvironment = vi.fn();
const reportError = vi.fn();
const disposeObject = vi.fn();

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
const loadCompound = vi.fn(() => model.promise);
vi.mock("./compoundModel", () => ({
  loadCompound: (...args: unknown[]) => (loadCompound as (...a: unknown[]) => Promise<Group>)(...args),
  disposeObject: (...args: unknown[]) => disposeObject(...args),
}));
vi.mock("@/lib/monitoring", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class FakeRenderer {
    shadowMap = { enabled: false, type: 0 };
    toneMapping = 0;
    toneMappingExposure = 1;
    outputColorSpace = "";
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    render = (_scene: unknown, camera: PerspectiveCamera) => rendered.push({ camera });
    dispose = rendererDispose;
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

vi.mock("three/examples/jsm/controls/OrbitControls.js", async () => {
  const { Vector3: V3 } = await import("three");
  class FakeControls {
    target = new V3();
    enabled = true;
    enableDamping = false;
    update = vi.fn();
    dispose = controlsDispose;
  }
  return { OrbitControls: FakeControls };
});

vi.mock("./world", () => ({
  buildWorld: () => ({
    scene: new Scene(),
    sun: new DirectionalLight(),
    water: new Mesh(),
    sunDirection: new Vector3(1, 0.05, 0),
    update: vi.fn(),
    setArchitecture,
    setEnvironment,
    dispose: worldDispose,
  }),
}));

import { MODEL_TIMEOUT_MS, createEngine } from "./engine";
import { villaSlot } from "./layout";
import { viewpoints } from "./viewpoints";

type Listener = (e: unknown) => void;
function fakeCanvas() {
  const listeners = new Map<string, Listener>();
  return {
    listeners,
    canvas: {
      clientWidth: 800,
      clientHeight: 450,
      style: {} as Record<string, string>,
      addEventListener: (t: string, fn: Listener) => listeners.set(t, fn),
      removeEventListener: (t: string) => listeners.delete(t),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 }),
    } as unknown as HTMLCanvasElement,
  };
}

let frames: FrameRequestCallback[] = [];
const flush = (n = 1) => {
  for (let i = 0; i < n; i++) {
    const queue = frames;
    frames = [];
    queue.forEach((cb) => cb(0));
  }
};

/** Lets the model promise settle (the engine renders nothing before that). */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  frames = [];
  rendered.length = 0;
  model = deferred();
  model.resolve(new Group());
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const lastCamera = () => rendered[rendered.length - 1].camera;
const markers = [
  { id: "v1", kind: "villa" as const, slot: 0, status: "available" as const, label: "V1" },
  { id: "a1", kind: "apartment" as const, slot: 2, status: "reserved" as const, label: "A1" },
];

describe("createEngine", () => {
  it("renders, reports the first frame and starts at the requested view", async () => {
    const onFirstFrame = vi.fn();
    const onFrame = vi.fn();
    const { canvas } = fakeCanvas();
    createEngine(canvas, { variant: "dijla", tier: "low", mode: "explorer", view: "aerial", onFirstFrame, onFrame });
    await settle();
    flush(2);
    expect(onFirstFrame).toHaveBeenCalledOnce();
    expect(onFrame).toHaveBeenLastCalledWith(2);
    expect(lastCamera().position.toArray()).toEqual(viewpoints("dijla").aerial.position);
  });

  it("jumps to a view instantly under reduced motion and flies otherwise", async () => {
    const { canvas } = fakeCanvas();
    const e = createEngine(canvas, { variant: "dijla", tier: "low", mode: "explorer", view: "aerial", reducedMotion: true });
    await settle();
    flush();
    e.setView("street");
    flush();
    expect(lastCamera().position.toArray()).toEqual(viewpoints("dijla").street.position);
    const e2 = createEngine(fakeCanvas().canvas, { variant: "dijla", tier: "low", mode: "explorer", view: "aerial" });
    await settle();
    flush();
    e2.setView("street");
    flush();
    expect(lastCamera().position.toArray()).not.toEqual(viewpoints("dijla").street.position);
  });

  it("flies to a marker and selects it on click", async () => {
    const onSelect = vi.fn();
    const { canvas, listeners } = fakeCanvas();
    const e = createEngine(canvas, { variant: "dijla", tier: "low", mode: "explorer", view: "aerial", reducedMotion: true, onSelect });
    await settle();
    e.setMarkers(markers);
    e.setSelected("v1");
    e.flyToMarker("v1");
    flush();
    const cam = lastCamera();
    cam.updateMatrixWorld();
    const sprite = new Vector3(0, 0, 0);
    // Project the marker to the screen and click it.
    const s = villaSlot(0);
    sprite.set(s.x, s.y, s.z).project(cam);
    const clientX = ((sprite.x + 1) / 2) * 800;
    const clientY = ((1 - sprite.y) / 2) * 450;
    listeners.get("pointerdown")!({ clientX, clientY });
    listeners.get("pointerup")!({ clientX, clientY });
    expect(onSelect).toHaveBeenCalledWith("v1");
    // A drag is not a click.
    onSelect.mockClear();
    listeners.get("pointerdown")!({ clientX, clientY });
    listeners.get("pointerup")!({ clientX: clientX + 40, clientY });
    expect(onSelect).not.toHaveBeenCalled();
    e.flyToMarker("missing");
  });

  it("zooms toward the target and resets", async () => {
    const { canvas } = fakeCanvas();
    const e = createEngine(canvas, { variant: "dijla", tier: "low", mode: "explorer", view: "aerial", reducedMotion: true });
    await settle();
    flush();
    const before = lastCamera().position.length();
    e.zoom(1);
    flush();
    const target = new Vector3(...viewpoints("dijla").aerial.target);
    expect(lastCamera().position.distanceTo(target)).toBeLessThan(new Vector3(...viewpoints("dijla").aerial.position).distanceTo(target));
    e.zoom(-1);
    e.reset();
    flush();
    expect(lastCamera().position.length()).toBeCloseTo(before, 3);
  });

  it("plays the film from the opening shot and stops when paused", async () => {
    const { canvas } = fakeCanvas();
    const e = createEngine(canvas, { variant: "shatt", tier: "high", mode: "film", view: "flight" });
    await settle();
    flush(3);
    const count = rendered.length;
    e.setPlaying(false);
    flush(3);
    expect(rendered.length).toBe(count);
    e.setPlaying(true);
    flush();
    expect(rendered.length).toBeGreaterThan(count);
    e.setView("terrace");
    flush();
    expect(lastCamera().position.distanceTo(new Vector3(...viewpoints("shatt").terrace.position))).toBeLessThan(20);
  });

  it("lifts off from the opening shot and flies around the compound", async () => {
    let ms = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (ms += 100));
    const { canvas } = fakeCanvas();
    const e = createEngine(canvas, { variant: "dijla", tier: "low", mode: "film", view: "flight", frame: { x: 0.12, y: 0.1 } });
    await settle();
    const open = new Vector3(...viewpoints("dijla").flight.position);
    flush(10);
    expect(lastCamera().position.distanceTo(open)).toBeLessThan(0.01); // holding the poster frame
    expect(lastCamera().view?.enabled ?? false).toBe(false); // unshifted, like the poster
    flush(120);
    const flying = lastCamera().position.clone();
    expect(flying.distanceTo(open)).toBeGreaterThan(20);
    expect(lastCamera().view).toMatchObject({ enabled: true, offsetX: -0.12 * 800, offsetY: 0.1 * 450 });
    flush(20);
    expect(lastCamera().position.distanceTo(flying)).toBeGreaterThan(5); // still moving
    e.setView("flight");
    flush();
    expect(lastCamera().position.distanceTo(open)).toBeLessThan(0.01);
    vi.restoreAllMocks();
  });

  it("reports a lost WebGL context", () => {
    const onError = vi.fn();
    const { canvas, listeners } = fakeCanvas();
    createEngine(canvas, { variant: "dijla", tier: "low", mode: "film", view: "flight", onError });
    listeners.get("webglcontextlost")!({ preventDefault: () => {} });
    expect(onError).toHaveBeenCalled();
  });

  it("disposes everything and removes listeners", () => {
    const { canvas, listeners } = fakeCanvas();
    const e = createEngine(canvas, { variant: "dijla", tier: "low", mode: "explorer", view: "aerial" });
    e.resize();
    e.dispose();
    expect(rendererDispose).toHaveBeenCalled();
    expect(controlsDispose).toHaveBeenCalled();
    expect(worldDispose).toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it("holds the first frame until the baked model is attached", async () => {
    model = deferred();
    const onFirstFrame = vi.fn();
    const { canvas } = fakeCanvas();
    createEngine(canvas, { variant: "dijla", tier: "high", mode: "film", view: "flight", onFirstFrame });
    expect(loadCompound).toHaveBeenCalledWith("high", expect.anything());
    expect(setEnvironment).toHaveBeenCalledOnce();
    flush(5);
    await settle();
    flush(5);
    expect(rendered).toHaveLength(0);
    expect(onFirstFrame).not.toHaveBeenCalled();
    const group = new Group();
    model.resolve(group);
    await settle();
    flush();
    expect(setArchitecture).toHaveBeenCalledWith(group);
    expect(onFirstFrame).toHaveBeenCalledOnce();
    expect(rendered.length).toBeGreaterThan(0);
  });

  it("keeps the procedural compound when the model fails to load", async () => {
    model = deferred();
    const onFirstFrame = vi.fn();
    createEngine(fakeCanvas().canvas, { variant: "zaitun", tier: "low", mode: "explorer", view: "aerial", onFirstFrame });
    expect(loadCompound).toHaveBeenCalledWith("low", expect.anything());
    model.reject(new Error("404"));
    await settle();
    flush();
    expect(onFirstFrame).toHaveBeenCalledOnce();
    expect(setArchitecture).not.toHaveBeenCalled();
  });

  it("falls back after the timeout, reports it and drops a late model", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      model = deferred();
      const onFirstFrame = vi.fn();
      createEngine(fakeCanvas().canvas, { variant: "shatt", tier: "high", mode: "film", view: "street", onFirstFrame });
      vi.advanceTimersByTime(MODEL_TIMEOUT_MS - 1);
      flush();
      expect(onFirstFrame).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(reportError).toHaveBeenCalledWith("sawad-scene", expect.any(Error), expect.objectContaining({ stage: "compound-model" }));
      flush();
      expect(onFirstFrame).toHaveBeenCalledOnce();
      const late = new Group();
      model.resolve(late);
      await Promise.resolve();
      await Promise.resolve();
      expect(setArchitecture).not.toHaveBeenCalled(); // no pop from boxes to model mid-film
      expect(disposeObject).toHaveBeenCalledWith(late);
    } finally {
      vi.useRealTimers();
    }
  });

  it("frees a model that arrives after the engine is gone", async () => {
    model = deferred();
    const e = createEngine(fakeCanvas().canvas, { variant: "dijla", tier: "low", mode: "film", view: "flight" });
    e.dispose();
    const late = new Group();
    model.resolve(late);
    await settle();
    expect(setArchitecture).not.toHaveBeenCalled();
    expect(disposeObject).toHaveBeenCalledWith(late);
  });

  it("reports a failed environment map and still renders", async () => {
    setEnvironment.mockImplementationOnce(() => {
      throw new Error("no float targets");
    });
    const onFirstFrame = vi.fn();
    createEngine(fakeCanvas().canvas, { variant: "dijla", tier: "low", mode: "film", view: "flight", onFirstFrame });
    expect(reportError).toHaveBeenCalledWith("sawad-scene", expect.any(Error), expect.objectContaining({ stage: "environment" }));
    await settle();
    flush();
    expect(onFirstFrame).toHaveBeenCalledOnce();
  });
});
