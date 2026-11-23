import { useEffect, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraRig } from "./CameraRig";
import { SceneMarkers } from "./SceneMarkers";
import type { QualityTier, SceneApi, SceneMarker, SceneVariant, ViewId } from "./types";
import { usesPlan } from "./site";
import { useCompoundModel, useSceneLibrary } from "./useCompoundModel";
import { SceneWorld } from "./SceneWorld";

export type SceneRootProps = {
  variant: SceneVariant;
  tier: QualityTier;
  mode: "film" | "explorer";
  view: ViewId;
  reducedMotion?: boolean;
  /** Film only: see CameraRig. */
  frame?: { x: number; y: number };
  /** Explorer only. */
  markers?: SceneMarker[];
  selectedId?: string | null;
  apiRef?: RefObject<SceneApi | null>;
  onSelect?: (id: string) => void;
  /** The compound is in (or has fallen back): the first frame may be drawn. */
  onReady?: () => void;
  onFirstFrame?: () => void;
  onFrame?: (frame: number) => void;
  onError?: (error: unknown) => void;
};

/**
 * The whole scene, to be rendered inside a React Three Fiber root: the world, the home
 * markers, the camera and the render pass.
 */
export function SceneRoot({
  variant,
  tier,
  mode,
  view,
  reducedMotion,
  frame,
  markers,
  selectedId,
  apiRef,
  onSelect,
  onReady,
  onFirstFrame,
  onFrame,
  onError,
}: SceneRootProps) {
  // The finder's stage card stays on the far set: its views never need the full detail (ledger T30, D12).
  const { model, settled: modelSettled } = useCompoundModel(tier, variant, "far");
  // The 28 ha plan also places its plants and its people, cars and birds from libraries.
  const plan = usesPlan(variant);
  const vegetation = useSceneLibrary("vegetation", tier, plan);
  const life = useSceneLibrary("life", tier, plan);
  const settled = modelSettled && vegetation.settled && life.settled;
  const ready = useRef(onReady);
  useEffect(() => {
    ready.current = onReady;
  });
  useEffect(() => {
    if (settled) ready.current?.();
  }, [settled]);

  return (
    <>
      <SceneWorld
        variant={variant}
        tier={tier}
        model={model}
        fallback={modelSettled}
        vegetation={vegetation.library}
        plantingFallback={plan && vegetation.settled && !vegetation.library}
        life={life.library}
      />
      {mode === "explorer" && <SceneMarkers variant={variant} markers={markers ?? []} selectedId={selectedId} onSelect={onSelect} />}
      <CameraRig
        variant={variant}
        mode={mode}
        view={view}
        reducedMotion={reducedMotion}
        frame={frame}
        markers={markers}
        selectedId={selectedId}
        apiRef={apiRef}
      />
      <RenderPass onFirstFrame={onFirstFrame} onFrame={onFrame} onError={onError} />
    </>
  );
}

type RenderPassProps = Pick<SceneRootProps, "onFirstFrame" | "onFrame" | "onError">;

/**
 * Draws the frame, after every other frame callback has moved the scene. It owns the draw
 * call so that a failed render or a lost context is reported instead of freezing the picture,
 * and so the first frame is announced only once it is on screen.
 */
function RenderPass({ onFirstFrame, onFrame, onError }: RenderPassProps) {
  const canvas = useThree((s) => s.gl.domElement);
  const frames = useRef(0);
  const failed = useRef(false);
  const callbacks = useRef({ onFirstFrame, onFrame, onError });
  useEffect(() => {
    callbacks.current = { onFirstFrame, onFrame, onError };
  });

  useEffect(() => {
    const onLost = (e: Event) => {
      e.preventDefault();
      if (failed.current) return;
      failed.current = true;
      callbacks.current.onError?.(new Error("WebGL context lost"));
    };
    canvas.addEventListener("webglcontextlost", onLost);
    return () => canvas.removeEventListener("webglcontextlost", onLost);
  }, [canvas]);

  useFrame(({ gl, scene, camera }) => {
    if (failed.current) return;
    try {
      gl.render(scene, camera);
    } catch (err) {
      failed.current = true;
      callbacks.current.onError?.(err);
      return;
    }
    frames.current += 1;
    if (frames.current === 1) callbacks.current.onFirstFrame?.();
    callbacks.current.onFrame?.(frames.current);
  }, 1);

  return null;
}
