// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setErrorSink } from "@/lib/monitoring";
import type { EngineOptions } from "./engine";
import type { SceneLabels, SceneMarker } from "./types";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) => <img src={src} alt={alt} className={className} />,
}));

const cap = { ok: true };
vi.mock("./capability", () => ({
  canRender3D: () => cap.ok,
  readCapabilityEnv: (mode: string) => ({ webgl2: cap.ok, reducedMotion: false, mode }),
  qualityTier: () => "low",
}));

const engine = {
  setView: vi.fn(),
  flyToMarker: vi.fn(),
  setMarkers: vi.fn(),
  setSelected: vi.fn(),
  zoom: vi.fn(),
  reset: vi.fn(),
  setPlaying: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
};
const created: EngineOptions[] = [];
const loader = { fail: false };
vi.mock("./engine", () => ({
  createEngine: (_canvas: HTMLCanvasElement, opts: EngineOptions) => {
    if (loader.fail) throw new Error("no gl");
    created.push(opts);
    return engine;
  },
}));

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

const firstFrame = async () => {
  await vi.waitFor(() => expect(created.length).toBeGreaterThan(0));
  await act(async () => created[created.length - 1].onFirstFrame?.());
};

beforeEach(() => {
  cap.ok = true;
  loader.fail = false;
  created.length = 0;
  resetCapabilityCache();
  vi.clearAllMocks();
});
afterEach(() => setErrorSink(null));

describe("SceneViewport", () => {
  it("always renders the poster inside a labelled region", () => {
    cap.ok = false;
    render(<SceneViewport mode="film" variant="dijla" view="flight" poster={poster} labels={labels} />);
    expect(screen.getByRole("img", { name: poster.alt })).toBeTruthy();
    expect(screen.getByRole("region", { name: labels.sceneLabel })).toBeTruthy();
    // Film without 3D: quietly stays a poster.
    expect(screen.queryByText(labels.unavailable)).toBeNull();
  });

  it("explains, without alarm, when the explorer cannot run", () => {
    cap.ok = false;
    render(<SceneViewport mode="explorer" variant="dijla" view="aerial" poster={poster} labels={labels} />);
    expect(screen.getByText(labels.unavailable)).toBeTruthy();
  });

  it("waits for a click when autoLoad is off", async () => {
    render(<SceneViewport mode="explorer" variant="dijla" view="aerial" poster={poster} labels={labels} autoLoad={false} />);
    expect(created).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: labels.load3d }));
    await vi.waitFor(() => expect(created).toHaveLength(1));
  });

  it("shows the pause control only once the film is running", async () => {
    const { container } = render(<SceneViewport mode="film" variant="dijla" view="flight" poster={poster} labels={labels} />);
    expect(screen.queryByRole("button", { name: labels.pause })).toBeNull();
    await firstFrame();
    const pause = screen.getByRole("button", { name: labels.pause });
    expect(container.querySelector(".scene")?.getAttribute("data-scene-ready")).toBe("true");
    fireEvent.click(pause);
    expect(screen.getByRole("button", { name: labels.play })).toBeTruthy();
    expect(engine.setPlaying).toHaveBeenLastCalledWith(false);
  });

  it("frames the film clear of the hero text, mirrored right to left", async () => {
    render(<SceneViewport mode="film" variant="dijla" view="flight" poster={poster} labels={labels} />);
    await firstFrame();
    expect(created[0].frame).toEqual({ x: 0.12, y: 0.1 });
    cleanup();
    created.length = 0;
    render(
      <div dir="rtl" style={{ direction: "rtl" }}>
        <SceneViewport mode="film" variant="dijla" view="flight" poster={poster} labels={labels} />
      </div>,
    );
    await firstFrame();
    expect(created[0].frame).toEqual({ x: -0.12, y: 0.1 });
  });

  it("drives the explorer: markers, selection, views and zoom controls", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <SceneViewport mode="explorer" variant="dijla" view="aerial" poster={poster} labels={labels} markers={markers} onSelect={onSelect} />,
    );
    await firstFrame();
    expect(created[0].frame).toBeUndefined();
    expect(engine.setMarkers).toHaveBeenCalledWith(markers);
    created[0].onSelect?.("v1");
    expect(onSelect).toHaveBeenCalledWith("v1");
    rerender(<SceneViewport mode="explorer" variant="dijla" view="street" poster={poster} labels={labels} markers={markers} selectedId="v1" onSelect={onSelect} />);
    expect(engine.setView).toHaveBeenLastCalledWith("street", true);
    expect(engine.flyToMarker).toHaveBeenCalledWith("v1");
    fireEvent.click(screen.getByRole("button", { name: labels.zoomIn }));
    fireEvent.click(screen.getByRole("button", { name: labels.zoomOut }));
    fireEvent.click(screen.getByRole("button", { name: labels.reset }));
    expect(engine.zoom).toHaveBeenCalledWith(1);
    expect(engine.zoom).toHaveBeenCalledWith(-1);
    expect(engine.reset).toHaveBeenCalled();
    expect(screen.getByText(labels.dragHint)).toBeTruthy();
  });

  it("rebuilds the engine when the compound changes and disposes on unmount", async () => {
    const { rerender, unmount } = render(<SceneViewport mode="explorer" variant="dijla" view="aerial" poster={poster} labels={labels} />);
    await firstFrame();
    rerender(<SceneViewport mode="explorer" variant="zaitun" view="aerial" poster={poster} labels={labels} />);
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(created).toHaveLength(2));
    expect(created[1].variant).toBe("zaitun");
    unmount();
    expect(engine.dispose).toHaveBeenCalledTimes(2);
  });

  it("reports a failed engine by name and falls back to the poster", async () => {
    loader.fail = true;
    const sink = vi.fn();
    setErrorSink(sink);
    render(<SceneViewport mode="explorer" variant="dijla" view="aerial" poster={poster} labels={labels} />);
    await vi.waitFor(() => expect(sink).toHaveBeenCalled());
    expect(sink.mock.calls[0][0]).toMatchObject({ component: "SceneViewport", message: "no gl" });
    expect(screen.getByText(labels.unavailable)).toBeTruthy();
    expect(screen.getByRole("img", { name: poster.alt })).toBeTruthy();
  });
});
