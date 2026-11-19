// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneRootProps } from "./SceneRoot";

// The real <Canvas> needs WebGL and a measured box. Record how it is configured instead.
type CanvasProps = {
  frameloop: string;
  dpr: number;
  shadows: unknown;
  gl: Record<string, unknown>;
  camera: Record<string, unknown>;
  resize: Record<string, unknown>;
  style: Record<string, unknown>;
  children: ReactNode;
};
const seen = vi.hoisted(() => ({ canvas: [] as unknown[], root: [] as unknown[] }));
vi.mock("@react-three/fiber", () => ({
  Canvas: (props: { children: ReactNode }) => {
    seen.canvas.push(props);
    return <div data-testid="canvas">{props.children}</div>;
  },
}));
vi.mock("./SceneRoot", () => ({
  SceneRoot: (props: unknown) => {
    seen.root.push(props);
    return null;
  },
}));

import SceneCanvas, { CAMERA_FAR, CAMERA_NEAR, EXPOSURE, MAX_PIXEL_RATIO, type SceneCanvasProps } from "./SceneCanvas";
import { viewpoints } from "./viewpoints";

const canvas = () => seen.canvas.at(-1) as CanvasProps;
const root = () => seen.root.at(-1) as SceneRootProps;
const film: SceneCanvasProps = { variant: "zaitun", tier: "high", mode: "film", view: "flight", playing: true };

beforeEach(() => {
  seen.canvas.length = 0;
  seen.root.length = 0;
  vi.stubGlobal("devicePixelRatio", 3);
});
afterEach(() => vi.unstubAllGlobals());

describe("SceneCanvas", () => {
  it("draws nothing until the compound is ready, then plays", () => {
    render(<SceneCanvas {...film} />);
    expect(canvas().frameloop).toBe("never");
    act(() => root().onReady?.());
    expect(canvas().frameloop).toBe("always");
  });

  it("draws only on demand while paused, offscreen or in a hidden tab", () => {
    const { rerender } = render(<SceneCanvas {...film} />);
    act(() => root().onReady?.());
    rerender(<SceneCanvas {...film} playing={false} />);
    expect(canvas().frameloop).toBe("demand");
    rerender(<SceneCanvas {...film} playing />);
    expect(canvas().frameloop).toBe("always");
  });

  it("stays held while paused if the compound is not ready yet", () => {
    render(<SceneCanvas {...film} playing={false} />);
    expect(canvas().frameloop).toBe("never");
  });

  it("renders the high tier antialiased with soft shadows at a capped pixel ratio", () => {
    render(<SceneCanvas {...film} />);
    expect(canvas().dpr).toBe(MAX_PIXEL_RATIO);
    expect(canvas().shadows).toBe("percentage");
    expect(canvas().gl).toMatchObject({ antialias: true, alpha: false, powerPreference: "high-performance", toneMappingExposure: EXPOSURE });
  });

  it("uses the screen's own pixel ratio when it is below the cap", () => {
    vi.stubGlobal("devicePixelRatio", 1.25);
    render(<SceneCanvas {...film} />);
    expect(canvas().dpr).toBe(1.25);
  });

  it("renders the low tier at pixel ratio 1 without antialiasing or shadows", () => {
    render(<SceneCanvas {...film} tier="low" />);
    expect(canvas().dpr).toBe(1);
    expect(canvas().shadows).toBe(false);
    expect(canvas().gl).toMatchObject({ antialias: false, alpha: false, toneMappingExposure: EXPOSURE });
  });

  it("opens on the requested view and keeps that camera when the view changes later", () => {
    const { rerender } = render(<SceneCanvas {...film} />);
    const flight = viewpoints("zaitun").flight;
    const camera = canvas().camera;
    expect(camera).toEqual({ fov: flight.fov, near: CAMERA_NEAR, far: CAMERA_FAR, position: flight.position });
    rerender(<SceneCanvas {...film} view="aerial" />);
    expect(canvas().camera).toBe(camera); // the rig moves the camera; the canvas does not rebuild it
    expect(root().view).toBe("aerial");
  });

  it("follows its box, not the page scroll, and takes pointer events from the stage", () => {
    render(<SceneCanvas {...film} />);
    expect(canvas().resize).toEqual({ scroll: false });
    expect(canvas().style).toEqual({ pointerEvents: "inherit" });
  });

  it("hands the scene everything else", () => {
    const onSelect = vi.fn();
    const onFirstFrame = vi.fn();
    const onError = vi.fn();
    const apiRef = { current: null };
    const markers = [{ id: "v1", kind: "villa" as const, slot: 0, status: "available" as const, label: "V1" }];
    render(
      <SceneCanvas
        variant="dijla"
        tier="low"
        mode="explorer"
        view="aerial"
        playing
        reducedMotion
        markers={markers}
        selectedId="v1"
        apiRef={apiRef}
        onSelect={onSelect}
        onFirstFrame={onFirstFrame}
        onError={onError}
      />,
    );
    expect(root()).toMatchObject({ variant: "dijla", tier: "low", mode: "explorer", view: "aerial", reducedMotion: true, markers, selectedId: "v1", apiRef, onSelect, onFirstFrame, onError });
    expect(root()).not.toHaveProperty("playing");
  });
});
