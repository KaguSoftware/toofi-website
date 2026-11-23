// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setErrorSink } from "@/lib/monitoring";
import type { SceneCanvasProps } from "./SceneCanvas";
import type { SceneLabels, SceneMarker } from "./types";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt, className, sizes }: { src: string; alt: string; className?: string; sizes?: string }) => (
    <img src={src} alt={alt} className={className} data-sizes={sizes} />
  ),
}));

const cap = { ok: true, tier: "low" as "low" | "high", reducedMotion: false };
const tierInputs: Array<{ width: number; dpr: number }> = [];
vi.mock("./capability", () => ({
  canRender3D: () => cap.ok,
  readCapabilityEnv: (mode: string) => ({ webgl2: cap.ok, reducedMotion: cap.reducedMotion, mode }),
  qualityTier: (env: { width: number; dpr: number }) => {
    tierInputs.push(env);
    return cap.tier;
  },
}));

// The WebGL canvas is a separate, lazily loaded chunk. Stand in for it and record its props.
const api = { zoom: vi.fn(), reset: vi.fn() };
const scene = vi.hoisted(() => ({ props: [] as unknown[], mounts: 0, unmounts: 0, fail: false }));
vi.mock("./SceneCanvas", async () => {
  const { useEffect } = await import("react");
  function SceneCanvasStub(props: SceneCanvasProps) {
    if (scene.fail) throw new Error("no gl");
    scene.props.push(props);
    const { apiRef } = props;
    useEffect(() => {
      scene.mounts++;
      if (apiRef) apiRef.current = api;
      return () => {
        scene.unmounts++;
      };
    }, [apiRef]);
    return <div data-testid="scene-canvas" />;
  }
  return { default: SceneCanvasStub };
});

import { SceneViewport, resetCapabilityCache } from "./SceneViewport";

const labels: SceneLabels = {
  loading: "Loading the 3D view",
  unavailable: "The 3D view is not available on this device. The list shows every home.",
  load3d: "Show 3D view",
  pause: "Pause film",
  play: "Play film",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  reset: "Reset view",
  dragHint: "Drag to look around",
  sceneLabel: "Compound in 3D",
};
const poster = { src: "/poster.jpg", alt: "Bustan Dijla at golden hour" };
const markers: SceneMarker[] = [{ id: "v1", kind: "villa", slot: 0, status: "available", label: "V1" }];

const last = () => scene.props.at(-1) as SceneCanvasProps;
/** Waits for the lazy canvas to mount. */
const loaded = (mounts = 1) => vi.waitFor(() => expect(scene.mounts).toBe(mounts));
const firstFrame = async () => {
  await vi.waitFor(() => expect(scene.props.length).toBeGreaterThan(0));
  await act(async () => last().onFirstFrame?.());
};
const stage = (container: HTMLElement) => container.querySelector(".scene__canvas");
const phase = (container: HTMLElement) => container.querySelector(".scene")?.getAttribute("data-phase");

beforeEach(() => {
  cap.ok = true;
  cap.tier = "low";
  cap.reducedMotion = false;
  tierInputs.length = 0;
  scene.props.length = 0;
  scene.mounts = 0;
  scene.unmounts = 0;
  scene.fail = false;
  resetCapabilityCache();
  vi.clearAllMocks();
});
afterEach(() => {
  setErrorSink(null);
  window.history.replaceState({}, "", "/");
});

describe("SceneViewport", () => {
  it("always renders the poster inside a labelled region", () => {
    cap.ok = false;
    render(<SceneViewport mode="film" variant="dijla" view="flight" poster={poster} labels={labels} />);
    expect(screen.getByRole("img", { name: poster.alt })).toBeTruthy();
    expect(screen.getByRole("region", { name: labels.sceneLabel })).toBeTruthy();
    // Film without 3D: quietly stays a poster.
    expect(screen.queryByText(labels.unavailable)).toBeNull();
  });

  it("explains, without alarm, when the explorer cannot run, and never loads the 3D", async () => {
    cap.ok = false;
    const { container } = render(<SceneViewport mode="explorer" variant="dijla" view="aerial" poster={poster} labels={labels} />);
    expect(screen.getByText(labels.unavailable)).toBeTruthy();
    expect(stage(container)).toBeNull();
    await act(async () => {});
    expect(scene.mounts).toBe(0);
  });

  it("waits for a click when autoLoad is off", async () => {
    const { container } = render(<SceneViewport mode="explorer" variant="dijla" view="aerial" poster={poster} labels={labels} autoLoad={false} />);
    expect(phase(container)).toBe("idle");
    await act(async () => {});
    expect(scene.mounts).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: labels.load3d }));
    await loaded();
    expect(screen.getByRole("status").textContent).toBe(labels.loading);
  });

  it("keeps the poster up until the first frame, then reveals the canvas, hidden from screen readers", async () => {
    const { container } = render(<SceneViewport mode="film" variant="dijla" view="flight" poster={poster} labels={labels} />);
    await loaded();
    expect(phase(container)).toBe("loading");
    expect(stage(container)?.getAttribute("data-visible")).toBe("false");
    expect(stage(container)?.getAttribute("aria-hidden")).toBe("true");
    await firstFrame();
    expect(phase(container)).toBe("running");
    expect(stage(container)?.getAttribute("data-visible")).toBe("true");
    expect(screen.getByRole("img", { name: poster.alt })).toBeTruthy(); // still underneath
  });

  it("shows the pause control only once the film is running", async () => {
    const { container } = render(<SceneViewport mode="film" variant="dijla" view="flight" poster={poster} labels={labels} />);
    expect(screen.queryByRole("button", { name: labels.pause })).toBeNull();
    await firstFrame();
    const pause = screen.getByRole("button", { name: labels.pause });
    expect(container.querySelector(".scene")?.getAttribute("data-scene-ready")).toBe("true");
    expect(last().playing).toBe(true);
    fireEvent.click(pause);
    expect(screen.getByRole("button", { name: labels.play })).toBeTruthy();
    expect(last().playing).toBe(false);
  });

  it("pauses while the tab is hidden", async () => {
    render(<SceneViewport mode="film" variant="dijla" view="flight" poster={poster} labels={labels} />);
    await firstFrame();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(last().playing).toBe(false);
    visibility.mockReturnValue("visible");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(last().playing).toBe(true);
    visibility.mockRestore();
  });

  it("frames the film clear of the hero text, mirrored right to left", async () => {
    render(<SceneViewport mode="film" variant="dijla" view="flight" poster={poster} labels={labels} />);
    await firstFrame();
    expect(last().frame).toEqual({ x: 0.12, y: 0.1 });
    cleanup();
    scene.props.length = 0;
    render(
      <div dir="rtl" style={{ direction: "rtl" }}>
        <SceneViewport mode="film" variant="dijla" view="flight" poster={poster} labels={labels} />
      </div>,
    );
    await firstFrame();
    expect(last().frame).toEqual({ x: -0.12, y: 0.1 });
  });

  it("reads the device once for the quality tier and the motion preference", async () => {
    cap.tier = "high";
    cap.reducedMotion = true;
    render(<SceneViewport mode="explorer" variant="dijla" view="aerial" poster={poster} labels={labels} />);
    await firstFrame();
    expect(last()).toMatchObject({ tier: "high", reducedMotion: true, mode: "explorer", variant: "dijla" });
    expect(tierInputs.at(-1)).toMatchObject({ width: window.innerWidth, dpr: window.devicePixelRatio || 1 });
  });

  it("drives the explorer: markers, selection, views and zoom controls", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <SceneViewport mode="explorer" variant="dijla" view="aerial" poster={poster} labels={labels} markers={markers} onSelect={onSelect} />,
    );
    await firstFrame();
    expect(last().frame).toBeUndefined();
    expect(last().markers).toBe(markers);
    expect(last().selectedId).toBeNull();
    last().onSelect?.("v1");
    expect(onSelect).toHaveBeenCalledWith("v1");
    rerender(<SceneViewport mode="explorer" variant="dijla" view="street" poster={poster} labels={labels} markers={markers} selectedId="v1" onSelect={onSelect} />);
    expect(last()).toMatchObject({ view: "street", selectedId: "v1" });
    expect(scene.mounts).toBe(1); // moving the camera never rebuilds the scene
    fireEvent.click(screen.getByRole("button", { name: labels.zoomIn }));
    fireEvent.click(screen.getByRole("button", { name: labels.zoomOut }));
    fireEvent.click(screen.getByRole("button", { name: labels.reset }));
    expect(api.zoom).toHaveBeenCalledWith(1);
    expect(api.zoom).toHaveBeenCalledWith(-1);
    expect(api.reset).toHaveBeenCalled();
    expect(screen.getByText(labels.dragHint)).toBeTruthy();
  });

  it("drops the drag hint on the first touch", async () => {
    render(<SceneViewport mode="explorer" variant="dijla" view="aerial" poster={poster} labels={labels} />);
    await firstFrame();
    fireEvent.pointerDown(screen.getByRole("region", { name: labels.sceneLabel }));
    expect(screen.queryByText(labels.dragHint)).toBeNull();
  });

  it("gives the film no markers and no selection", async () => {
    render(<SceneViewport mode="film" variant="dijla" view="flight" poster={poster} labels={labels} markers={markers} selectedId="v1" />);
    await firstFrame();
    expect(last().markers).toBeUndefined();
    expect(last().selectedId).toBeNull();
  });

  it("rebuilds the scene behind the poster when the compound changes, and frees it on unmount", async () => {
    const { rerender, unmount, container } = render(<SceneViewport mode="explorer" variant="dijla" view="aerial" poster={poster} labels={labels} />);
    await firstFrame();
    rerender(<SceneViewport mode="explorer" variant="zaitun" view="aerial" poster={poster} labels={labels} />);
    expect(scene.unmounts).toBe(1);
    // The poster covers the rebuild: the new canvas starts hidden, with no fade from the old one.
    expect(phase(container)).toBe("loading");
    expect(stage(container)?.getAttribute("data-visible")).toBe("false");
    await loaded(2);
    expect(last().variant).toBe("zaitun");
    await firstFrame();
    expect(phase(container)).toBe("running");
    unmount();
    expect(scene.unmounts).toBe(2);
  });

  it("reports a scene that fails to start by name and falls back to the poster", async () => {
    scene.fail = true;
    const sink = vi.fn();
    setErrorSink(sink);
    vi.spyOn(console, "error").mockImplementation(() => {}); // React logs the caught render error
    const { container } = render(<SceneViewport mode="explorer" variant="dijla" view="aerial" poster={poster} labels={labels} />);
    await vi.waitFor(() => expect(sink).toHaveBeenCalled());
    expect(sink.mock.calls[0][0]).toMatchObject({ component: "SceneViewport", message: "no gl" });
    await vi.waitFor(() => expect(screen.getByText(labels.unavailable)).toBeTruthy());
    expect(screen.getByRole("img", { name: poster.alt })).toBeTruthy();
    expect(stage(container)).toBeNull();
    vi.restoreAllMocks();
  });

  it("reports a scene that fails while running (a lost context) and takes the canvas away", async () => {
    const sink = vi.fn();
    setErrorSink(sink);
    const { container } = render(<SceneViewport mode="film" variant="shatt" view="flight" poster={poster} labels={labels} />);
    await firstFrame();
    await act(async () => last().onError?.(new Error("WebGL context lost")));
    expect(sink.mock.calls[0][0]).toMatchObject({ component: "SceneViewport", message: "WebGL context lost", context: { variant: "shatt", mode: "film" } });
    expect(scene.unmounts).toBe(1);
    expect(stage(container)).toBeNull();
    // The film quietly becomes a poster again.
    expect(phase(container)).toBe("poster");
    expect(screen.queryByRole("button", { name: labels.pause })).toBeNull();
  });

  it("renders stills in capture mode: high tier, no interface, ready after the scene has settled", async () => {
    window.history.replaceState({}, "", "/?capture=1");
    const { container } = render(<SceneViewport mode="explorer" variant="dijla" view="aerial" poster={poster} labels={labels} markers={markers} />);
    await firstFrame();
    expect(last().tier).toBe("high");
    expect(last().markers).toBeUndefined();
    expect(screen.queryByRole("button", { name: labels.zoomIn })).toBeNull();
    const ready = () => container.querySelector(".scene")?.getAttribute("data-scene-ready");
    expect(ready()).toBeNull();
    await act(async () => last().onFrame?.(29));
    expect(ready()).toBeNull();
    await act(async () => last().onFrame?.(30));
    expect(ready()).toBe("true");
  });
});

describe("SceneViewport poster sizes", () => {
  afterEach(cleanup);
  it("defaults the poster to the full viewport width", () => {
    render(<SceneViewport mode="film" variant="dijla" view="aerial" poster={poster} labels={labels} autoLoad={false} />);
    expect(screen.getByAltText(poster.alt).getAttribute("data-sizes")).toBe("100vw");
  });
  it("passes a narrower stage's sizes hint to the poster", () => {
    render(
      <SceneViewport mode="explorer" variant="dijla" view="aerial" poster={poster} labels={labels} autoLoad={false} posterSizes="(min-width: 64rem) 60vw, 100vw" />,
    );
    expect(screen.getByAltText(poster.alt).getAttribute("data-sizes")).toBe("(min-width: 64rem) 60vw, 100vw");
  });
});
