import { useEffect } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

const reportError = vi.fn();
vi.mock("@/lib/monitoring", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

import { MODEL_TIMEOUT_MS, useTimedAsset, type TimedAssetState } from "./useTimedAsset";

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
});
