import { useEffect, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Bloom, DepthOfField, EffectComposer, N8AO, Noise, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode, type DepthOfFieldEffect, type EffectComposer as Composer } from "postprocessing";
import type { WebGLRenderer } from "three";
import type { QualitySettings } from "./quality";
import type { RigState } from "./types";

export type PostFXProps = {
  settings: QualitySettings;
  /** The lens the camera rig sets every frame (focus distance and blur). */
  rig: RefObject<RigState>;
  /** Receives the composer: the render pass draws through it. */
  composerRef: RefObject<Composer | null>;
};

/** The widest the blur gets (bokeh scale at blur = 1). */
export const MAX_BOKEH = 2.4;

/** Depth of field follows the story's lens: sharp at the subject, soft before and beyond it. */
function focusLens(effect: DepthOfFieldEffect, rig: RigState): void {
  effect.cocMaterial.focusDistance = rig.focus;
  // A deeper field for far subjects, so wide shots stay crisp.
  effect.cocMaterial.focusRange = Math.max(6, rig.focus * 0.9);
  effect.bokehScale = rig.blur * MAX_BOKEH;
}

/**
 * The look after the scene is drawn: ambient occlusion, depth of field and bloom in linear
 * light, then ACES tone mapping, edge smoothing, a vignette and film grain. Which of them run
 * comes from the quality level. The composer is built here but does not draw by itself
 * (`enabled={false}`): the render pass owns the draw call, so a failed frame is caught and reported.
 */
export function PostFX({ settings, rig, composerRef }: PostFXProps) {
  const dof = useRef<DepthOfFieldEffect>(null);
  const composer = useRef<Composer>(null);

  useEffect(() => {
    composerRef.current = composer.current;
    return () => {
      composerRef.current = null;
    };
  });

  useFrame(() => {
    if (dof.current && rig.current) focusLens(dof.current, rig.current);
  }, 0.8);

  return (
    <EffectComposer ref={composer} enabled={false} multisampling={0}>
      {settings.ssao ? <N8AO halfRes aoRadius={2.4} distanceFalloff={1.2} intensity={1.5} quality="medium" /> : null}
      {settings.dof ? <DepthOfField ref={dof} focusDistance={100} focusRange={90} bokehScale={0} resolutionScale={0.5} /> : null}
      {settings.bloom ? <Bloom mipmapBlur luminanceThreshold={1.05} luminanceSmoothing={0.35} intensity={0.5} radius={0.72} /> : null}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      {settings.smaa ? <SMAA /> : null}
      {settings.vignette ? <Vignette offset={0.3} darkness={0.46} /> : null}
      {settings.grain ? <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.13} /> : null}
    </EffectComposer>
  );
}

const applied = new WeakMap<Composer, { width: number; height: number; ratio: number }>();

/** Draws one frame through the composer, keeping its buffers the size of the canvas. */
export function drawComposer(gl: WebGLRenderer, composer: Composer, delta: number): void {
  const canvas = gl.domElement;
  const ratio = gl.getPixelRatio();
  const width = canvas.clientWidth || canvas.width / ratio;
  const height = canvas.clientHeight || canvas.height / ratio;
  const last = applied.get(composer);
  if (!last || last.width !== width || last.height !== height || last.ratio !== ratio) {
    composer.setSize(width, height);
    applied.set(composer, { width, height, ratio });
  }
  const autoClear = gl.autoClear;
  gl.autoClear = true;
  try {
    composer.render(delta);
  } finally {
    gl.autoClear = autoClear;
  }
}
