import { useEffect, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei/core/PerformanceMonitor";
import type { EffectComposer as Composer } from "postprocessing";
import { SceneMarkers } from "../scene/SceneMarkers";
import type { QualityTier, SceneMarker, ViewId } from "../scene/types";
import { useCompoundModel, useSceneLibrary } from "../scene/useCompoundModel";
import type { Daylight } from "./daylight";
import { ExperienceWorld } from "./ExperienceWorld";
import { PostFX, drawComposer } from "./PostFX";
import { QUALITY, fpsBounds, pixelRatio, type QualityLevel } from "./quality";
import { StoryRig } from "./StoryRig";
import type { ExperienceApi, ExperienceMode, RigState, ScrollState } from "./types";
import { UnitTargets } from "./UnitTargets";
import type { WalkInput } from "./walk";

export type ExperienceRootProps = {
  tier: QualityTier;
  level: QualityLevel;
  view: ViewId;
  mode: ExperienceMode;
  daylight: Daylight;
  reducedMotion?: boolean;
  playing?: boolean;
  /** Development capture: hold the story at this sequence position. */
  holdAt?: number | null;
  /** The homes, for exploring: status markers and click targets. */
  markers?: SceneMarker[];
  selectedId?: string | null;
  scroll: RefObject<ScrollState>;
  input: RefObject<WalkInput>;
  rig: RefObject<RigState>;
  apiRef?: RefObject<ExperienceApi | null>;
  onSelect?: (id: string) => void;
  /** The compound is in (or has fallen back): the first frame may be drawn. */
  onReady?: () => void;
  onFirstFrame?: () => void;
  onFrame?: (frame: number) => void;
  onError?: (error: unknown) => void;
  onIntroEnd?: () => void;
  /** The frame rate asks for a step down (-1) or allows a step up (1). */
  onQuality?: (direction: 1 | -1) => void;
};

/**
 * Everything inside the experience's canvas: the scene world with its day and dusk states, the
 * story camera, the homes to click while exploring, the post-processing and the render pass.
 * The model, plants and life load on the same terms as in the scene: the first frame waits for them.
 */
export function ExperienceRoot({
  tier,
  level,
  view,
  mode,
  daylight,
  reducedMotion,
  playing,
  holdAt,
  markers,
  selectedId,
  scroll,
  input,
  rig,
  apiRef,
  onSelect,
  onReady,
  onFirstFrame,
  onFrame,
  onError,
  onIntroEnd,
  onQuality,
}: ExperienceRootProps) {
  const { model, settled: modelSettled } = useCompoundModel(tier, "zaitun");
  const vegetation = useSceneLibrary("vegetation", tier, true);
  const life = useSceneLibrary("life", tier, true);
  const settled = modelSettled && vegetation.settled && life.settled;
  const ready = useRef(onReady);
  useEffect(() => {
    ready.current = onReady;
  });
  useEffect(() => {
    if (settled) ready.current?.();
  }, [settled]);

  const settings = QUALITY[level];
  const setDpr = useThree((s) => s.setDpr);
  useEffect(() => {
    setDpr(pixelRatio(level, window.devicePixelRatio));
  }, [level, setDpr]);

  const composer = useRef<Composer | null>(null);
  const exploring = mode !== "story";
  const homes = markers ?? [];

  return (
    <>
      <ExperienceWorld
        tier={tier}
        model={model}
        fallback={modelSettled}
        vegetation={vegetation.library}
        plantingFallback={vegetation.settled && !vegetation.library}
        life={life.library}
        daylight={daylight}
        godRays={settings.godRays}
        rig={rig}
      />
      {exploring ? <SceneMarkers variant="zaitun" markers={homes} selectedId={selectedId} onSelect={onSelect} /> : null}
      {exploring ? <UnitTargets markers={homes} selectedId={selectedId} onSelect={onSelect} /> : null}
      <StoryRig
        view={view}
        mode={mode}
        reducedMotion={reducedMotion}
        playing={playing}
        holdAt={holdAt}
        scroll={scroll}
        input={input}
        rig={rig}
        markers={markers}
        selectedId={selectedId}
        apiRef={apiRef}
        onIntroEnd={onIntroEnd}
        onError={onError}
      />
      <PostFX settings={settings} rig={rig} composerRef={composer} />
      <PerformanceMonitor
        bounds={(refreshRate) => fpsBounds(tier, refreshRate)}
        flipflops={3}
        onDecline={() => onQuality?.(-1)}
        onIncline={() => onQuality?.(1)}
        onFallback={() => onQuality?.(-1)}
      />
      <RenderPass composer={composer} onFirstFrame={onFirstFrame} onFrame={onFrame} onError={onError} />
    </>
  );
}

type RenderPassProps = Pick<ExperienceRootProps, "onFirstFrame" | "onFrame" | "onError"> & { composer: RefObject<Composer | null> };

/**
 * Draws the frame through the effect composer, after every other frame callback has moved the
 * scene. It owns the draw call so that a failed render or a lost context is reported instead
 * of freezing the picture, and so the first frame is announced only once it is on screen.
 */
export function RenderPass({ composer, onFirstFrame, onFrame, onError }: RenderPassProps) {
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

  useFrame(({ gl, scene, camera }, delta) => {
    if (failed.current) return;
    try {
      if (composer.current) drawComposer(gl, composer.current, delta);
      else gl.render(scene, camera);
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
