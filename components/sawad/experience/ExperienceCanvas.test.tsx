// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperienceRootProps } from "./ExperienceRoot";

// The real <Canvas> needs WebGL and a measured box. Record how it is configured instead.
type CanvasProps = {
  flat: boolean;
  frameloop: string;
  dpr: number;
  shadows: unknown;
  gl: Record<string, unknown>;
  camera: { fov: number; near: number; far: number; position: number[] };
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
vi.mock("../scene/SceneRoot", () => ({ SceneRoot: () => null }));
vi.mock("./ExperienceRoot", () => ({
  ExperienceRoot: (props: unknown) => {
    seen.root.push(props);
    return null;
  },
}));

import { CAMERA_FAR, CAMERA_NEAR, EXPOSURE } from "../scene/SceneCanvas";
import { viewpoints } from "../scene/viewpoints";
import ExperienceCanvas, { pinnedLevel, type ExperienceCanvasProps } from "./ExperienceCanvas";
import { storyPose } from "./storySheet";
import { initialRigState } from "./types";
import { emptyInput } from "./walk";

const canvas = () => seen.canvas.at(-1) as CanvasProps;
const root = () => seen.root.at(-1) as ExperienceRootProps;
const base: ExperienceCanvasProps = {
  tier: "high",
  view: "flight",
  mode: "story",
  daylight: "day",
  playing: true,
  scroll: { current: { progress: 0 } },
  input: { current: emptyInput() },
  rig: { current: initialRigState() },
};

beforeEach(() => {
  seen.canvas.length = 0;
  seen.root.length = 0;
  vi.stubGlobal("devicePixelRatio", 3);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.history.replaceState({}, "", "/");
});

describe("ExperienceCanvas", () => {
  it("draws nothing until the compound is ready, then plays, or draws on demand while paused", () => {
    const { rerender } = render(<ExperienceCanvas {...base} />);
    expect(canvas().frameloop).toBe("never");
    act(() => root().onReady?.());
    expect(canvas().frameloop).toBe("always");
    rerender(<ExperienceCanvas {...base} playing={false} />);
    expect(canvas().frameloop).toBe("demand");
    rerender(<ExperienceCanvas {...base} playing />);
    expect(canvas().frameloop).toBe("always");
  });

  it("stays held while paused if the compound is not ready yet", () => {
    render(<ExperienceCanvas {...base} playing={false} />);
    expect(canvas().frameloop).toBe("never");
  });

  it("renders flat, without multisampling, with soft shadows on the high tier only", () => {
    const { unmount } = render(<ExperienceCanvas {...base} />);
    expect(canvas().flat).toBe(true);
    expect(canvas().shadows).toBe("percentage");
    expect(canvas().gl).toMatchObject({ antialias: false, alpha: false, powerPreference: "high-performance", toneMappingExposure: EXPOSURE });
    expect(canvas().dpr).toBe(1.5); // the high tier's starting level caps a 3x screen
    expect(canvas().resize).toEqual({ scroll: false });
    expect(canvas().style).toEqual({ pointerEvents: "inherit" });
    unmount();

    render(<ExperienceCanvas {...base} tier="low" />);
    expect(canvas().shadows).toBe(false);
    expect(canvas().dpr).toBe(1);
  });

  it("opens on the story's first frame and keeps that camera when the view changes", () => {
    const { rerender } = render(<ExperienceCanvas {...base} view="aerial" />);
    const open = storyPose("aerial", 0);
    const camera = canvas().camera;
    expect(camera).toEqual({ fov: open.fov, near: CAMERA_NEAR, far: CAMERA_FAR, position: open.position });
    rerender(<ExperienceCanvas {...base} view="terrace" />);
    expect(canvas().camera).toBe(camera);
    expect(root().view).toBe("terrace");
  });

  it("opens on a held story position for a capture", () => {
    render(<ExperienceCanvas {...base} holdAt={30} />);
    expect(canvas().camera.position).toEqual(storyPose("flight", 30).position);
    expect(root().holdAt).toBe(30);
  });

  it("opens on the aerial viewpoint for a visitor who explores without the story", () => {
    render(<ExperienceCanvas {...base} mode="orbit" />);
    const aerial = viewpoints("zaitun").aerial;
    expect(canvas().camera).toMatchObject({ fov: aerial.fov, position: aerial.position });
  });

  it("steps the quality level with the frame rate, within the tier's range", () => {
    render(<ExperienceCanvas {...base} />);
    expect(root().level).toBe(2);
    act(() => root().onQuality?.(1));
    expect(root().level).toBe(3);
    act(() => root().onQuality?.(1));
    expect(root().level).toBe(3);
    act(() => root().onQuality?.(-1));
    act(() => root().onQuality?.(-1));
    act(() => root().onQuality?.(-1));
    expect(root().level).toBe(1);
  });

  it("renders at the current level's pixel ratio, also after the canvas re-renders", () => {
    // The Canvas re-applies its `dpr` on every render, so a fixed start ratio would undo each level change.
    const { rerender } = render(<ExperienceCanvas {...base} />);
    expect(canvas().dpr).toBe(1.5);
    act(() => root().onQuality?.(1));
    expect(canvas().dpr).toBe(1.75);
    rerender(<ExperienceCanvas {...base} playing={false} />);
    expect(canvas().dpr).toBe(1.75);
    act(() => root().onQuality?.(-1));
    act(() => root().onQuality?.(-1));
    expect(canvas().dpr).toBe(1.25);
    rerender(<ExperienceCanvas {...base} />);
    expect(canvas().dpr).toBe(1.25);
  });

  it("never renders above the screen's own pixel ratio", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    render(<ExperienceCanvas {...base} />);
    act(() => root().onQuality?.(1));
    expect(canvas().dpr).toBe(1);
  });

  it("holds the level while a capture holds the story", () => {
    render(<ExperienceCanvas {...base} tier="low" holdAt={20} />);
    expect(root().level).toBe(0);
    act(() => root().onQuality?.(1));
    expect(root().level).toBe(0);
  });

  it("pins the quality level in development with ?level=, to measure frame times", () => {
    window.history.replaceState({}, "", "/?level=3");
    expect(pinnedLevel()).toBe(3);
    render(<ExperienceCanvas {...base} tier="low" />);
    expect(root().level).toBe(3);
    act(() => root().onQuality?.(-1));
    expect(root().level).toBe(3);
    expect(canvas().dpr).toBe(1.75);
    window.history.replaceState({}, "", "/?level=7");
    expect(pinnedLevel()).toBeNull();
  });

  it("never pins the level in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    window.history.replaceState({}, "", "/?level=3");
    expect(pinnedLevel()).toBeNull();
  });

  it("hands the scene everything else, with `moving` as what plays by itself", () => {
    const onSelect = vi.fn();
    const onError = vi.fn();
    const apiRef = { current: null };
    render(<ExperienceCanvas {...base} moving={false} reducedMotion daylight="dusk" selectedId="v1" apiRef={apiRef} onSelect={onSelect} onError={onError} />);
    expect(root()).toMatchObject({ tier: "high", view: "flight", mode: "story", daylight: "dusk", playing: false, reducedMotion: true, selectedId: "v1", apiRef, onSelect, onError, holdAt: null });
    expect(root().scroll).toBe(base.scroll);
    expect(root()).not.toHaveProperty("moving");
  });

  it("lets what moves by itself play by default", () => {
    render(<ExperienceCanvas {...base} />);
    expect(root().playing).toBe(true);
  });
});
