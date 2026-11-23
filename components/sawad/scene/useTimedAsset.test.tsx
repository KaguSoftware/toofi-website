import { Activity, useEffect } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

const reportError = vi.fn();
vi.mock("@/lib/monitoring", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

import { KEEP_HIDDEN_MS, MODEL_TIMEOUT_MS, useTimedAsset, type TimedAssetState } from "./useTimedAsset";

type Asset = { name: string };
type Deferred = { promise: Promise<Asset>; resolve: (a: Asset) => void; reject: (e: unknown) => void };
const deferred = (): Deferred => {
  let resolve!: (a: Asset) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<Asset>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

let state: TimedAssetState<Asset>;
const dispose = vi.fn();
function Harness({ id, load, enabled }: { id: string; load: () => Promise<Asset>; enabled?: boolean }) {
  const current = useTimedAsset(id, { load, dispose, stage: "vegetation", context: { tier: "high" }, enabled });
  useEffect(() => {
    state = current;
  });
  return null;
}
const settle = () => ReactThreeTestRenderer.act(async () => {});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useTimedAsset", () => {
  it("is held until the asset arrives, then hands it over", async () => {
    const d = deferred();
    await ReactThreeTestRenderer.create(<Harness id="a" load={() => d.promise} />);
    expect(state).toEqual({ value: null, settled: false });
    const asset = { name: "trees" };
    d.resolve(asset);
    await settle();
    expect(state).toEqual({ value: asset, settled: true });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("settles without the asset when the load fails (the loader reports it)", async () => {
    const d = deferred();
    await ReactThreeTestRenderer.create(<Harness id="a" load={() => d.promise} />);
    d.reject(new Error("404"));
    await settle();
    expect(state).toEqual({ value: null, settled: true });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("gives up after the timeout, reports it, and frees an asset that arrives later", async () => {
    vi.useFakeTimers();
    const d = deferred();
    await ReactThreeTestRenderer.create(<Harness id="a" load={() => d.promise} />);
    await ReactThreeTestRenderer.act(async () => {
      vi.advanceTimersByTime(MODEL_TIMEOUT_MS);
    });
    expect(state).toEqual({ value: null, settled: true });
    expect(reportError).toHaveBeenCalledWith("sawad-scene", expect.any(Error), { stage: "vegetation", tier: "high" });
    const late = { name: "late" };
    d.resolve(late);
    await settle();
    expect(state.value).toBeNull();
    expect(dispose).toHaveBeenCalledWith(late);
  });

  it("settles at once with nothing when not needed, and never loads", async () => {
    const load = vi.fn(() => deferred().promise);
    await ReactThreeTestRenderer.create(<Harness id="a" load={load} enabled={false} />);
    expect(state).toEqual({ value: null, settled: true });
    expect(load).not.toHaveBeenCalled();
  });

  it("frees the asset on unmount and on a new key, which starts held again", async () => {
    const first = deferred();
    const second = deferred();
    const loads = [first, second];
    const load = () => loads.shift()!.promise;
    const renderer = await ReactThreeTestRenderer.create(<Harness id="high" load={load} />);
    const a = { name: "high" };
    first.resolve(a);
    await settle();
    await renderer.update(<Harness id="low" load={load} />);
    expect(dispose).toHaveBeenCalledWith(a);
    expect(state).toEqual({ value: null, settled: false });
    const b = { name: "low" };
    second.resolve(b);
    await settle();
    expect(state).toEqual({ value: b, settled: true });
    await renderer.unmount();
    expect(dispose).toHaveBeenCalledWith(b);
  });

  describe("kept through a hide (keep)", () => {
    let alive = true;
    const keep = { ms: 1000, alive: () => alive };
    function Kept({ id, load, hidden = false }: { id: string; load: () => Promise<Asset>; hidden?: boolean }) {
      return (
        <Activity mode={hidden ? "hidden" : "visible"}>
          <KeptInner id={id} load={load} />
        </Activity>
      );
    }
    function KeptInner({ id, load }: { id: string; load: () => Promise<Asset> }) {
      const current = useTimedAsset(id, { load, dispose, stage: "compound-model", keep });
      useEffect(() => {
        state = current;
      });
      return null;
    }

    it("takes the same asset back on a reveal, without loading it again", async () => {
      alive = true;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const asset = { name: "model" };
      const load = vi.fn(() => Promise.resolve(asset));
      const r = await ReactThreeTestRenderer.create(<Kept id="a" load={load} />);
      await settle();
      expect(state).toEqual({ value: asset, settled: true });
      await r.update(<Kept id="a" load={load} hidden />);
      await ReactThreeTestRenderer.act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(dispose).not.toHaveBeenCalled();
      await r.update(<Kept id="a" load={load} />);
      await settle();
      expect(state).toEqual({ value: asset, settled: true });
      expect(load).toHaveBeenCalledTimes(1);
      // The release timers of the hide were cancelled by the reveal.
      await ReactThreeTestRenderer.act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(dispose).not.toHaveBeenCalled();
    });

    it("re-renders whoever uses the asset on a reveal, though nothing about it changed", async () => {
      // A reveal rebuilds what effects own (the post chain's composer), and the users hand the new one
      // on when they render. Without this render the hero stayed black after a visit to another page.
      alive = true;
      const asset = { name: "model" };
      const rendered = vi.fn();
      function Counted() {
        rendered();
        const current = useTimedAsset("a", { load: () => Promise.resolve(asset), dispose, stage: "compound-model", keep });
        useEffect(() => {
          state = current;
        });
        return null;
      }
      // The same element throughout: only the hook itself can make it render again.
      const inner = <Counted />;
      const r = await ReactThreeTestRenderer.create(<Activity mode="visible">{inner}</Activity>);
      await settle();
      await r.update(<Activity mode="hidden">{inner}</Activity>);
      const before = rendered.mock.calls.length;
      await r.update(<Activity mode="visible">{inner}</Activity>);
      await settle();
      expect(rendered.mock.calls.length).toBeGreaterThan(before);
      expect(state).toEqual({ value: asset, settled: true });
    });

    it("frees a hidden asset after `ms`, and loads it again on a later reveal", async () => {
      alive = true;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const asset = { name: "model" };
      const load = vi.fn(() => Promise.resolve(asset));
      const r = await ReactThreeTestRenderer.create(<Kept id="a" load={load} />);
      await settle();
      await r.update(<Kept id="a" load={load} hidden />);
      await ReactThreeTestRenderer.act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(dispose).toHaveBeenCalledExactlyOnceWith(asset);
      await r.update(<Kept id="a" load={load} />);
      await settle();
      expect(load).toHaveBeenCalledTimes(2);
      expect(state).toEqual({ value: asset, settled: true });
    });

    it("frees at once when the canvas has left the page (a real unmount)", async () => {
      alive = true;
      const asset = { name: "model" };
      const r = await ReactThreeTestRenderer.create(<Kept id="a" load={() => Promise.resolve(asset)} />);
      await settle();
      alive = false;
      await r.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(dispose).toHaveBeenCalledExactlyOnceWith(asset);
    });

    it("frees what it kept for another key when a new key loads", async () => {
      alive = true;
      const a = { name: "high" };
      const b = { name: "low" };
      const r = await ReactThreeTestRenderer.create(<Kept id="high" load={() => Promise.resolve(a)} />);
      await settle();
      await r.update(<Kept id="low" load={() => Promise.resolve(b)} />);
      await settle();
      expect(dispose).toHaveBeenCalledExactlyOnceWith(a);
      expect(state).toEqual({ value: b, settled: true });
    });

    it("keeps a hidden scene's assets for a few minutes", () => {
      expect(KEEP_HIDDEN_MS).toBe(180_000);
    });
  });
});
