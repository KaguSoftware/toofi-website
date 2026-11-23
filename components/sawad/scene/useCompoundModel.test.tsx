import { useEffect } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { Group } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const loadCompound = vi.fn<(tier: string, renderer: unknown, variant?: string, detail?: string) => Promise<Group>>(() => model.promise);
const loadLibrary = vi.fn<(kind: string, tier: string, renderer: unknown) => Promise<{ scene: Group; animations: unknown[] }>>();
vi.mock("./compoundModel", () => ({
  loadCompound: (tier: string, renderer: unknown, variant: string, detail: string) => (detail === "full" ? loadCompound(tier, renderer) : loadCompound(tier, renderer, variant, detail)),
  loadLibrary: (kind: string, tier: string, renderer: unknown) => loadLibrary(kind, tier, renderer),
  disposeObject: (...args: unknown[]) => disposeObject(...args),
}));
vi.mock("@/lib/monitoring", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

import type { QualityTier, SceneVariant } from "./types";
import { MODEL_TIMEOUT_MS, useCompoundModel, useSceneLibrary, type CompoundModelState, type LibraryState } from "./useCompoundModel";

let state: CompoundModelState;
function Harness({ tier, variant }: { tier: QualityTier; variant: SceneVariant }) {
  const current = useCompoundModel(tier, variant);
  useEffect(() => {
    state = current;
  });
  return null;
}
const mount = (tier: QualityTier, variant: SceneVariant) => ReactThreeTestRenderer.create(<Harness tier={tier} variant={variant} />);
/** Lets a settled model promise reach the hook. */
const settle = () => ReactThreeTestRenderer.act(async () => {});
/** An unmount frees on the next turn, once it has seen that the canvas left the page (useTimedAsset `keep`). */
const released = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  model = deferred();
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useCompoundModel", () => {
  it("holds the first frame until the baked model is in", async () => {
    const renderer = await mount("high", "dijla");
    expect(loadCompound).toHaveBeenCalledWith("high", expect.objectContaining({ render: expect.any(Function) }));
    expect(state).toEqual({ model: null, settled: false });
    const group = new Group();
    model.resolve(group);
    await settle();
    expect(state).toEqual({ model: group, settled: true });
    expect(reportError).not.toHaveBeenCalled();
    // The hook loaded it, so the hook frees it.
    await renderer.unmount();
    await released();
    expect(disposeObject).toHaveBeenCalledWith(group);
  });

  it("settles without a model when it fails to load, so the procedural compound shows", async () => {
    const renderer = await mount("low", "zaitun");
    expect(loadCompound).toHaveBeenCalledWith("low", expect.anything());
    model.reject(new Error("404"));
    await settle();
    expect(state).toEqual({ model: null, settled: true });
    expect(reportError).not.toHaveBeenCalled(); // loadCompound reports its own failure
    await renderer.unmount();
    expect(disposeObject).not.toHaveBeenCalled();
  });

  it("falls back after the timeout, reports it and drops a late model", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const renderer = await mount("high", "shatt");
    await ReactThreeTestRenderer.act(async () => vi.advanceTimersByTime(MODEL_TIMEOUT_MS - 1));
    expect(state.settled).toBe(false);
    expect(reportError).not.toHaveBeenCalled();
    await ReactThreeTestRenderer.act(async () => vi.advanceTimersByTime(1));
    expect(reportError).toHaveBeenCalledWith(
      "sawad-scene",
      expect.any(Error),
      expect.objectContaining({ stage: "compound-model", tier: "high", variant: "shatt" }),
    );
    expect(state).toEqual({ model: null, settled: true });
    const late = new Group();
    model.resolve(late);
    await settle();
    expect(state).toEqual({ model: null, settled: true }); // no pop from boxes to model mid-film
    expect(disposeObject).toHaveBeenCalledWith(late);
    await renderer.unmount();
  });

  it("does not time out once the model has arrived", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const renderer = await mount("low", "dijla");
    model.resolve(new Group());
    await settle();
    await ReactThreeTestRenderer.act(async () => vi.advanceTimersByTime(MODEL_TIMEOUT_MS * 2));
    expect(reportError).not.toHaveBeenCalled();
    expect(state.model).not.toBeNull();
    await renderer.unmount();
  });

  it("frees a model that arrives after the scene is gone", async () => {
    const renderer = await mount("low", "dijla");
    await renderer.unmount();
    const late = new Group();
    model.resolve(late);
    await settle();
    expect(disposeObject).toHaveBeenCalledWith(late);
  });

  it("ignores a failure that arrives after the scene is gone", async () => {
    const renderer = await mount("low", "dijla");
    await renderer.unmount();
    model.reject(new Error("aborted"));
    await settle();
    expect(reportError).not.toHaveBeenCalled();
    expect(state).toEqual({ model: null, settled: false });
  });

  it("starts over, holding the first frame again, when the tier changes", async () => {
    const renderer = await mount("low", "dijla");
    const first = new Group();
    model.resolve(first);
    await settle();
    model = deferred();
    await renderer.update(<Harness tier="high" variant="dijla" />);
    expect(disposeObject).toHaveBeenCalledWith(first);
    expect(loadCompound).toHaveBeenLastCalledWith("high", expect.anything());
    expect(state).toEqual({ model: null, settled: false });
    await renderer.unmount();
  });
});

describe("useCompoundModel with the far set only", () => {
  function Far() {
    const current = useCompoundModel("high", "zaitun", "far");
    useEffect(() => {
      state = current;
    });
    return null;
  }

  it("asks the loader for the far set only (the finder, ledger T30)", async () => {
    await ReactThreeTestRenderer.create(<Far />);
    expect(loadCompound).toHaveBeenCalledWith("high", expect.anything(), "zaitun", "far");
    const group = new Group();
    model.resolve(group);
    await settle();
    expect(state).toEqual({ model: group, settled: true });
  });
});

describe("useSceneLibrary", () => {
  let lib: LibraryState;
  function Library({ enabled }: { enabled: boolean }) {
    const current = useSceneLibrary("vegetation", "low", enabled);
    useEffect(() => {
      lib = current;
    });
    return null;
  }

  it("loads the tier's library, holds until it is in, and frees its scene on unmount", async () => {
    const scene = new Group();
    let resolve!: (v: { scene: Group; animations: unknown[] }) => void;
    loadLibrary.mockImplementation(() => new Promise((res) => (resolve = res)));
    const renderer = await ReactThreeTestRenderer.create(<Library enabled />);
    expect(loadLibrary).toHaveBeenCalledWith("vegetation", "low", expect.anything());
    expect(lib).toEqual({ library: null, settled: false });
    const loaded = { scene, animations: [] };
    resolve(loaded);
    await settle();
    expect(lib).toEqual({ library: loaded, settled: true });
    await renderer.unmount();
    await released();
    expect(disposeObject).toHaveBeenCalledWith(scene);
  });

  it("settles at once without loading for a compound that does not use it", async () => {
    await ReactThreeTestRenderer.create(<Library enabled={false} />);
    expect(loadLibrary).not.toHaveBeenCalled();
    expect(lib).toEqual({ library: null, settled: true });
  });
});
