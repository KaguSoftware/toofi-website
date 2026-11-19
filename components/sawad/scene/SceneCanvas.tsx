"use client";

import { useState, type RefObject } from "react";
import { Canvas } from "@react-three/fiber";
import { SceneRoot, type SceneRootProps } from "./SceneRoot";
import type { QualityTier, SceneApi } from "./types";
import { viewpoints } from "./viewpoints";

export type SceneCanvasProps = Omit<SceneRootProps, "onReady" | "apiRef"> & {
  /** False while the scene is offscreen, in a hidden tab, or paused by the visitor. */
  playing: boolean;
  apiRef?: RefObject<SceneApi | null>;
};

/** Exposure under ACES tone mapping, tuned so frames match the posters. */
export const EXPOSURE = 0.5;
/** The high tier caps the pixel ratio; the low tier renders at 1. */
export const MAX_PIXEL_RATIO = 1.75;
export const CAMERA_NEAR = 0.5;
export const CAMERA_FAR = 14000;

type RendererOptions = { antialias: boolean; alpha: false; powerPreference: "high-performance"; toneMappingExposure: number };
const RENDERER: Record<QualityTier, RendererOptions> = {
  high: { antialias: true, alpha: false, powerPreference: "high-performance", toneMappingExposure: EXPOSURE },
  low: { antialias: false, alpha: false, powerPreference: "high-performance", toneMappingExposure: EXPOSURE },
};
// Size follows the box alone; scrolling the page must not re-measure (and redraw) the scene.
const RESIZE = { scroll: false } as const;
// Pointer events follow the stage's CSS (the film lets the page scroll through it).
const STYLE = { pointerEvents: "inherit" } as const;

/**
 * The WebGL canvas for the compound scene (React Three Fiber). Client-only and heavy: load it
 * lazily, after the poster has painted. Nothing is drawn until the compound is ready, so the
 * first frame is the finished picture.
 */
export default function SceneCanvas({ playing, variant, tier, view, ...scene }: SceneCanvasProps) {
  const [ready, setReady] = useState(false);
  // The opening shot. Later view changes move the camera through the rig, not through this prop.
  const [camera] = useState(() => {
    const start = viewpoints(variant)[view];
    return { fov: start.fov, near: CAMERA_NEAR, far: CAMERA_FAR, position: start.position };
  });
  const [dpr] = useState(() => (tier === "high" ? Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) : 1));

  return (
    <Canvas
      frameloop={!ready ? "never" : playing ? "always" : "demand"}
      dpr={dpr}
      shadows={tier === "high" ? "percentage" : false}
      gl={RENDERER[tier]}
      camera={camera}
      resize={RESIZE}
      style={STYLE}
    >
      <SceneRoot {...scene} variant={variant} tier={tier} view={view} onReady={() => setReady(true)} />
    </Canvas>
  );
}
