// @vitest-environment jsdom
import { createRef, useImperativeHandle, type ReactNode, type Ref } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import type { EffectComposer as Composer } from "postprocessing";
import type { WebGLRenderer } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The effect chain needs a real WebGL context. The stand-ins record what each effect is handed.
type Seen = { name: string; props: Record<string, unknown> };
const fx = vi.hoisted(() => ({
  seen: [] as Seen[],
  composer: { setSize: () => {}, render: () => {} } as unknown,
  dof: { cocMaterial: { focusDistance: 0, focusRange: 0 }, bokehScale: 0 },
}));
vi.mock("@react-three/postprocessing", () => {
  const effect = (name: string) => {
    function Effect({ ref, ...props }: Record<string, unknown> & { ref?: Ref<unknown> }) {
      fx.seen.push({ name, props });
      useImperativeHandle(ref, () => (name === "DepthOfField" ? fx.dof : {}));
      return null;
    }
    return Effect;
  };
  return {
    EffectComposer: ({ ref, children, ...props }: { ref?: Ref<unknown>; children?: ReactNode }) => {
      fx.seen.push({ name: "EffectComposer", props });
      useImperativeHandle(ref, () => fx.composer);
      return <>{children}</>;
    },
    N8AO: effect("N8AO"),
    DepthOfField: effect("DepthOfField"),
    Bloom: effect("Bloom"),
    ToneMapping: effect("ToneMapping"),
    SMAA: effect("SMAA"),
    Vignette: effect("Vignette"),
    Noise: effect("Noise"),
  };
});
vi.mock("postprocessing", () => ({
  BlendFunction: { SOFT_LIGHT: "soft-light" },
  ToneMappingMode: { ACES_FILMIC: "aces" },
}));

import { MAX_BOKEH, PostFX, drawComposer } from "./PostFX";
import { QUALITY, type QualityLevel } from "./quality";
import { initialRigState, type RigState } from "./types";

const mounted = () => new Set(fx.seen.map((s) => s.name));
const propsOf = (name: string) => fx.seen.filter((s) => s.name === name).at(-1)?.props;

async function mount(level: QualityLevel, rig: { current: RigState | null } = { current: initialRigState() }) {
  const composerRef = createRef<Composer | null>() as { current: Composer | null };
  const tree = (l: QualityLevel) => <PostFX settings={QUALITY[l]} rig={rig as { current: RigState }} composerRef={composerRef} />;
  const renderer = await ReactThreeTestRenderer.create(tree(level));
  return { composerRef, renderer, update: (l: QualityLevel) => renderer.update(tree(l)) };
}

beforeEach(() => {
  fx.seen.length = 0;
  fx.dof.cocMaterial.focusDistance = 0;
  fx.dof.cocMaterial.focusRange = 0;
  fx.dof.bokehScale = 0;
});

describe("PostFX", () => {
  it("runs the cheapest chain at level 0: no edge smoothing, depth of field or occlusion", async () => {
    const { renderer } = await mount(0);
    expect(mounted()).toEqual(new Set(["EffectComposer", "Bloom", "ToneMapping", "Vignette", "Noise"]));
    expect(propsOf("EffectComposer")).toMatchObject({ enabled: false, multisampling: 0 });
    expect(propsOf("ToneMapping")).toMatchObject({ mode: "aces" });
    expect(propsOf("Noise")).toMatchObject({ blendFunction: "soft-light", premultiply: true });
    await renderer.unmount();
  });

  it("adds the effects level by level, up to the whole chain at level 3", async () => {
    const one = await mount(1);
    expect(mounted().has("SMAA")).toBe(true);
    expect(mounted().has("DepthOfField")).toBe(false);
    await one.renderer.unmount();

    fx.seen.length = 0;
    const two = await mount(2);
    expect(mounted().has("DepthOfField")).toBe(true);
    expect(mounted().has("N8AO")).toBe(false);
    await two.renderer.unmount();

    fx.seen.length = 0;
    const three = await mount(3);
    expect(mounted()).toEqual(new Set(["EffectComposer", "N8AO", "DepthOfField", "Bloom", "ToneMapping", "SMAA", "Vignette", "Noise"]));
    await three.renderer.unmount();
  });

  it("follows a change of level", async () => {
    const m = await mount(3);
    fx.seen.length = 0;
    await m.update(0);
    expect(mounted().has("N8AO")).toBe(false);
    expect(mounted().has("SMAA")).toBe(false);
    await m.renderer.unmount();
  });

  it("hands the composer to the render pass and takes it back on unmount", async () => {
    const { composerRef, renderer } = await mount(2);
    expect(composerRef.current).toBe(fx.composer);
    await renderer.unmount();
    expect(composerRef.current).toBeNull();
  });

  it("focuses the depth of field on the rig's subject every frame", async () => {
    const rig = { current: { ...initialRigState(), focus: 40, blur: 0.5 } as RigState | null };
    const { renderer } = await mount(3, rig);
    await renderer.advanceFrames(1, 1 / 60);
    expect(fx.dof.cocMaterial.focusDistance).toBe(40);
    expect(fx.dof.cocMaterial.focusRange).toBeCloseTo(36, 9);
    expect(fx.dof.bokehScale).toBeCloseTo(0.5 * MAX_BOKEH, 9);
    // A near subject keeps a field of at least 6 m.
    rig.current = { ...initialRigState(), focus: 2, blur: 1 };
    await renderer.advanceFrames(1, 1 / 60);
    expect(fx.dof.cocMaterial.focusRange).toBe(6);
    expect(fx.dof.bokehScale).toBe(MAX_BOKEH);
    // No lens yet: the effect is left alone.
    rig.current = null;
    await renderer.advanceFrames(1, 1 / 60);
    expect(fx.dof.cocMaterial.focusDistance).toBe(2);
    await renderer.unmount();
  });
});

describe("drawComposer", () => {
  const setup = (box: { clientWidth: number; clientHeight: number; width: number; height: number }, ratio = 2) => {
    const gl = { domElement: { ...box }, getPixelRatio: vi.fn(() => ratio), autoClear: false };
    const composer = { setSize: vi.fn(), render: vi.fn() };
    return { gl, composer, draw: (dt = 0.016) => drawComposer(gl as unknown as WebGLRenderer, composer as unknown as Composer, dt) };
  };

  it("sizes the composer once per size or pixel ratio, and draws with autoClear on", () => {
    const { gl, composer, draw } = setup({ clientWidth: 800, clientHeight: 450, width: 1600, height: 900 });
    composer.render.mockImplementation(() => expect(gl.autoClear).toBe(true));
    draw(0.02);
    draw();
    expect(composer.setSize).toHaveBeenCalledExactlyOnceWith(800, 450);
    expect(composer.render).toHaveBeenCalledTimes(2);
    expect(composer.render).toHaveBeenNthCalledWith(1, 0.02);
    expect(gl.autoClear).toBe(false); // restored after the draw

    gl.domElement.clientWidth = 640;
    draw();
    expect(composer.setSize).toHaveBeenLastCalledWith(640, 450);
    gl.getPixelRatio.mockReturnValue(1);
    draw();
    expect(composer.setSize).toHaveBeenCalledTimes(3);
  });

  it("falls back to the drawing buffer over the pixel ratio when the canvas is not laid out", () => {
    const { composer, draw } = setup({ clientWidth: 0, clientHeight: 0, width: 1200, height: 600 }, 1.5);
    draw();
    expect(composer.setSize).toHaveBeenCalledExactlyOnceWith(800, 400);
  });

  it("restores autoClear even when the draw throws", () => {
    const { gl, composer, draw } = setup({ clientWidth: 10, clientHeight: 10, width: 10, height: 10 });
    gl.autoClear = false;
    composer.render.mockImplementation(() => {
      throw new Error("lost");
    });
    expect(() => draw()).toThrow("lost");
    expect(gl.autoClear).toBe(false);
  });
});
