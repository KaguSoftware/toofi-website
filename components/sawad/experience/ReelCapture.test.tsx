// @vitest-environment jsdom
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { useFrame } from "@react-three/fiber";
import { Group } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

const reportError = vi.fn();
vi.mock("@/lib/monitoring", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

import { REEL_CAPTURE_KEY, ReelCapture, type ReelCaptureApi, type ReelHead } from "./ReelCapture";

const api = () => (window as unknown as Record<string, ReelCaptureApi | undefined>)[REEL_CAPTURE_KEY];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Notes each frame the loop runs: the clock it ran at and where the head was. */
function Frames({ seen, head }: { seen: Array<{ seconds: number; position: number }>; head: { current: ReelHead } }) {
  useFrame((state) => {
    seen.push({ seconds: state.clock.elapsedTime, position: head.current.position });
  });
  return null;
}

afterEach(() => {
  reportError.mockClear();
  delete (window as unknown as Record<string, unknown>)[REEL_CAPTURE_KEY];
});

describe("ReelCapture", () => {
  it("offers nothing until the scene's shaders are ready", async () => {
    const head = { current: { position: 0 } };
    const onReady = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(<ReelCapture head={head} model={null} ready={false} onReady={onReady} />, { frameloop: "never" });
    await settle();
    expect(api()).toBeUndefined();
    expect(onReady).not.toHaveBeenCalled();
    await renderer.unmount();
  });

  it("draws one frame per call, at the scene time and the position asked for", async () => {
    const head = { current: { position: 0 } };
    const seen: Array<{ seconds: number; position: number }> = [];
    const onReady = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <Frames seen={seen} head={head} />
        <ReelCapture head={head} model={null} ready onReady={onReady} />
      </>,
      { frameloop: "never" },
    );
    await settle();
    expect(onReady).toHaveBeenCalledTimes(1);
    const before = seen.length;
    api()!.frame(2.5, 0.5);
    api()!.frame(2.5 + 1 / 30, 0.5 + 1 / 30);
    expect(seen.slice(before)).toEqual([
      { seconds: 2.5, position: 0.5 },
      { seconds: 2.5 + 1 / 30, position: 0.5 + 1 / 30 },
    ]);
    await renderer.unmount();
    // Gone with the scene: a later page must not find a handle to a canvas that is no more.
    expect(api()).toBeUndefined();
  });

  it("waits for the model's full detail and its full light page before it offers a frame", async () => {
    const head = { current: { position: 0 } };
    const model = new Group();
    let detailIn!: (state: string) => void;
    let pageIn!: (state: string) => void;
    model.userData.detail = { state: "far", settled: new Promise<string>((r) => (detailIn = r)), cancel: () => {} };
    model.userData.dayPage = { state: "far", settled: new Promise<string>((r) => (pageIn = r)), cancel: () => {} };
    const onReady = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(<ReelCapture head={head} model={model} ready onReady={onReady} />, { frameloop: "never" });
    await settle();
    expect(api()).toBeUndefined();
    detailIn("full");
    await settle();
    expect(api()).toBeUndefined();
    pageIn("full");
    await settle();
    expect(api()).toBeDefined();
    expect(onReady).toHaveBeenCalledTimes(1);
    await renderer.unmount();
  });

  it("reports a detail that fails to settle and offers nothing", async () => {
    const head = { current: { position: 0 } };
    const model = new Group();
    model.userData.detail = { state: "far", settled: Promise.reject(new Error("no full file")), cancel: () => {} };
    const renderer = await ReactThreeTestRenderer.create(<ReelCapture head={head} model={model} ready />, { frameloop: "never" });
    await settle();
    expect(api()).toBeUndefined();
    expect(reportError).toHaveBeenCalledWith("ReelCapture", expect.any(Error), { stage: "detail" });
    await renderer.unmount();
  });

  it("does not offer a handle for a scene that was closed while it waited", async () => {
    const head = { current: { position: 0 } };
    const model = new Group();
    let detailIn!: (state: string) => void;
    model.userData.detail = { state: "far", settled: new Promise<string>((r) => (detailIn = r)), cancel: () => {} };
    const onReady = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(<ReelCapture head={head} model={model} ready onReady={onReady} />, { frameloop: "never" });
    await renderer.unmount();
    detailIn("full");
    await settle();
    expect(api()).toBeUndefined();
    expect(onReady).not.toHaveBeenCalled();
  });
});
