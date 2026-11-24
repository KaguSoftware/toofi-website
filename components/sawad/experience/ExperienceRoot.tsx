import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useFrame, useThree, type RootState } from "@react-three/fiber";
import type { EffectComposer as Composer } from "postprocessing";
import { reportError } from "@/lib/monitoring";
import { SceneMarkers } from "../scene/SceneMarkers";
import { PlantsStill, SceneDetail } from "../scene/SceneVegetation";
import type { QualityTier, SceneMarker, ViewId } from "../scene/types";
import { useCompoundModel, useSceneLibrary } from "../scene/useCompoundModel";
import { compileAhead, warmUp } from "./compileAhead";
import type { Daylight } from "./daylight";
import { ExperienceWorld } from "./ExperienceWorld";
import { STARVED_FPS, createQualityMonitor } from "./monitor";
import { QUALITY, QUALITY_RANGE, REEL_QUALITY, fpsBounds, pixelRatio, type QualityLevel } from "./quality";
import { ReelCapture, type ReelHead } from "./ReelCapture";
import { StoryRig } from "./StoryRig";
import type { ExperienceApi, ExperienceControl, ExperienceMode, RigState, ScrollState } from "./types";
import { UnitTargets } from "./UnitTargets";
import type { WalkInput } from "./walk";

/** The effect chain's module: postprocessing and its React bindings. */
type Fx = typeof import("./PostFX");

/** The chunk request itself (tests replace it). */
export const fxChunk = { load: (): Promise<Fx> => import("./PostFX") };

let fxModule: Promise<Fx> | null = null;
/**
 * The effect chain loads as a chunk of its own, after the scene's code has run, so that the 3D
 * code is evaluated in several short tasks instead of one long one (T33). The first frame still
 * waits for it: nothing is drawn without the chain, because the look depends on it.
 */
/** Test hook: forget the chunk, so the next mount asks for it again. */
export function resetPostFX(): void {
  fxModule = null;
}
export function loadPostFX(): Promise<Fx> {
  fxModule ??= fxChunk.load().catch((err: unknown) => {
    // A failed fetch is not remembered: the next mount asks again.
    fxModule = null;
    throw err;
  });
  return fxModule;
}

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
  /**
   * Development capture of the reel (ReelCapture.tsx): frames are drawn only when the capture
   * script asks, at the reel's quality, with every plant at its finest level.
   */
  reel?: boolean;
  /** The reel capture's handle is on `window`. */
  onReelReady?: () => void;
  /** An explorer opened from the reel: the sequence position the reel was showing (StoryRig). */
  startAt?: number | null;
  /** The homes, for exploring: status markers and click targets. */
  markers?: SceneMarker[];
  selectedId?: string | null;
  scroll: RefObject<ScrollState>;
  input: RefObject<WalkInput>;
  rig: RefObject<RigState>;
  apiRef?: RefObject<ExperienceApi | null>;
  /** Receives the handle that stops and restarts the drawing from outside (a hidden page). */
  controlRef?: RefObject<ExperienceControl | null>;
  onSelect?: (id: string) => void;
  /** The compound is in (or has fallen back) and its shaders are ready: the first frame may be drawn. */
  onReady?: () => void;
  onFirstFrame?: () => void;
  onFrame?: (frame: number) => void;
  onError?: (error: unknown) => void;
  /** The browser took the GPU context away. Not a failure of the page: the scene can be started again. */
  onContextLost?: () => void;
  onIntroEnd?: () => void;
  /** The frame rate asks for a step down (-1) or allows a step up (1). */
  onQuality?: (direction: 1 | -1) => void;
  /** The lowest level is still too slow to watch: the stills serve this device better. */
  onStarved?: () => void;
};

type Frameloop = RootState["frameloop"];
/** What each canvas was doing when it was paused, by its store: any handle to the same canvas agrees. */
const parked = new WeakMap<object, Frameloop>();

/** The pause and resume of one canvas (see `ExperienceControl`). */
export function sceneControl(get: () => Pick<RootState, "frameloop" | "setFrameloop">): ExperienceControl {
  return {
    pause() {
      const { frameloop, setFrameloop } = get();
      if (frameloop === "never") return;
      parked.set(get, frameloop);
      setFrameloop("never");
    },
    resume() {
      const was = parked.get(get);
      parked.delete(get);
      const { frameloop, setFrameloop } = get();
      // The canvas may have been given a new loop meanwhile; only a loop this paused is restarted.
      if (was && frameloop === "never") setFrameloop(was);
    },
  };
}

/**
 * Everything inside the experience's canvas: the scene world with its day and dusk states, the
 * story camera, the homes to click while exploring, the post-processing and the render pass.
 * The model, plants and life load on the same terms as in the scene: the first frame waits for
 * them, and for their shaders, which are compiled in the background while the poster is up.
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
  reel = false,
  onReelReady,
  startAt,
  markers,
  selectedId,
  scroll,
  input,
  rig,
  apiRef,
  controlRef,
  onSelect,
  onReady,
  onFirstFrame,
  onFrame,
  onError,
  onContextLost,
  onIntroEnd,
  onQuality,
  onStarved,
}: ExperienceRootProps) {
  const { model, settled: modelSettled } = useCompoundModel(tier, "zaitun");
  const vegetation = useSceneLibrary("vegetation", tier, true);
  const life = useSceneLibrary("life", tier, true);
  const settled = modelSettled && vegetation.settled && life.settled;

  const latest = useRef({ onReady, onError });
  useEffect(() => {
    latest.current = { onReady, onError };
  });

  const [fx, setFx] = useState<Fx | null>(null);
  useEffect(() => {
    let closed = false;
    loadPostFX().then(
      (module) => {
        if (!closed) setFx(module);
      },
      (err: unknown) => {
        if (!closed) latest.current.onError?.(err);
      },
    );
    return () => {
      closed = true;
    };
  }, []);

  const settings = reel ? REEL_QUALITY : QUALITY[level];
  const setDpr = useThree((s) => s.setDpr);
  useEffect(() => {
    setDpr(reel ? REEL_QUALITY.maxDpr : pixelRatio(level, window.devicePixelRatio));
  }, [level, reel, setDpr]);
  const reelHead = useRef<ReelHead>({ position: 0 });
  /** The shaders are ready and the loop may start (or, for the reel, frames may be asked for). */
  const [warm, setWarm] = useState(false);

  const get = useThree((s) => s.get);
  useLayoutEffect(() => {
    // Not cleared on cleanup: a hidden page runs the cleanups first and must still reach the canvas.
    if (controlRef) controlRef.current = sceneControl(get);
  }, [controlRef, get]);

  const composer = useRef<Composer | null>(null);

  // Shaders, ahead of the first frame (T13). Whatever has arrived is compiled in the background
  // at once; when everything is in, the first uses are spread over hidden frames, and only then
  // may the frame loop start.
  const gl = useThree((s) => s.gl);
  const advance = useThree((s) => s.advance);
  const compiling = useRef<Promise<unknown>>(Promise.resolve());
  /** True while a frame is run by hand for the shaders' sake: the render pass draws it without counting it. */
  const preparing = useRef(false);
  const hasModel = model !== null;
  const hasPlants = vegetation.library !== null;
  const hasLife = life.library !== null;
  useEffect(() => {
    if (!fx) return;
    let closed = false;
    // One frame of the real loop at a standstill: every frame callback runs with no time passed,
    // so the scene is drawn in the state its own code keeps it in (drawn cold, an unprepared
    // morph target made three.js throw), and nothing in it moves.
    const draw = () => {
      preparing.current = true;
      try {
        advance(0, false);
      } finally {
        preparing.current = false;
      }
    };
    const reported = (err: unknown) => {
      // The scene still starts: its shaders are then built in the first frame, as they used to be.
      reportError("ExperienceRoot", err, { stage: "compile-ahead", tier });
    };
    const compiled = compiling.current.then(() => (closed ? undefined : compileAhead(gl, draw))).catch(reported);
    compiling.current = compiled;
    if (settled) {
      void compiled
        .then(() => (closed ? 0 : warmUp(gl, draw, { cancelled: () => closed })))
        .catch(reported)
        .then(() => {
          if (closed) return;
          setWarm(true);
          latest.current.onReady?.();
        });
    }
    return () => {
      closed = true;
    };
  }, [fx, gl, advance, tier, settled, hasModel, hasPlants, hasLife]);

  const exploring = mode !== "story";
  // The story takes over from its poster; a capture or an explorer opened on request does not.
  const [sunRise] = useState(() => mode === "story" && holdAt == null);
  const homes = markers ?? [];
  const PostFX = fx?.PostFX;

  return (
    <>
      <SceneDetail value={reel ? "max" : "distance"}>
        <PlantsStill value={reel ? reelHead : null}>
          <ExperienceWorld
            tier={tier}
            model={model}
            fallback={modelSettled}
            vegetation={vegetation.library}
            plantingFallback={vegetation.settled && !vegetation.library}
            life={life.library}
            daylight={daylight}
            godRays={settings.godRays}
            sunRise={sunRise}
            rig={rig}
          />
        </PlantsStill>
      </SceneDetail>
      {exploring ? <SceneMarkers variant="zaitun" markers={homes} selectedId={selectedId} onSelect={onSelect} /> : null}
      {exploring ? <UnitTargets markers={homes} selectedId={selectedId} onSelect={onSelect} /> : null}
      <StoryRig
        view={view}
        mode={mode}
        reducedMotion={reducedMotion}
        playing={playing}
        holdAt={holdAt}
        reel={reel ? reelHead : null}
        startAt={startAt}
        scroll={scroll}
        input={input}
        rig={rig}
        markers={markers}
        selectedId={selectedId}
        apiRef={apiRef}
        onIntroEnd={onIntroEnd}
        onError={onError}
      />
      {PostFX ? <PostFX settings={settings} rig={rig} composerRef={composer} /> : null}
      {/* A capture holds its level: stills must not depend on how fast the capturing machine is. */}
      {holdAt == null && !reel ? <QualityMonitor tier={tier} level={level} onQuality={onQuality} onStarved={onStarved} /> : null}
      {reel ? <ReelCapture head={reelHead} model={model} ready={warm} onReady={onReelReady} /> : null}
      <RenderPass composer={composer} draw={fx?.drawComposer} preparing={preparing} onFirstFrame={onFirstFrame} onFrame={onFrame} onError={onError} onContextLost={onContextLost} />
    </>
  );
}

type QualityMonitorProps = Pick<ExperienceRootProps, "tier" | "level" | "onQuality" | "onStarved">;

/**
 * Watches the frame rate and asks for a quality step when it stays off its bounds (monitor.ts).
 * It judges only a loop that runs by itself: frames drawn on demand, while the scene is paused,
 * say nothing about how fast the device is.
 */
export function QualityMonitor({ tier, level, onQuality, onStarved }: QualityMonitorProps) {
  const [monitor] = useState(createQualityMonitor);
  const latest = useRef({ tier, level, onQuality, onStarved });
  useEffect(() => {
    latest.current = { tier, level, onQuality, onStarved };
  });

  useFrame((state, delta) => {
    if (state.frameloop !== "always") {
      monitor.rest();
      return;
    }
    const now = latest.current;
    const { min, max } = QUALITY_RANGE[now.tier];
    const decision = monitor.frame(delta, { level: now.level, min, max, bounds: (refreshRate) => fpsBounds(now.tier, refreshRate), starvedFps: STARVED_FPS[now.tier] });
    if (decision === "down") now.onQuality?.(-1);
    else if (decision === "up") now.onQuality?.(1);
    else if (decision === "starved") now.onStarved?.();
  });

  return null;
}

type RenderPassProps = Pick<ExperienceRootProps, "onFirstFrame" | "onFrame" | "onError" | "onContextLost"> & {
  composer: RefObject<Composer | null>;
  /** Draws a frame through the composer (PostFX's `drawComposer`, once the effect chain has loaded). */
  draw?: Fx["drawComposer"];
  /** True while a frame is run by hand to compile or warm up shaders: it is drawn, not counted, and its errors go to whoever ran it. */
  preparing?: RefObject<boolean>;
};

/**
 * Draws the frame through the effect composer, after every other frame callback has moved the
 * scene. It owns the draw call so that a failed render or a lost context is reported instead
 * of freezing the picture, and so the first frame is announced only once it is on screen.
 */
export function RenderPass({ composer, draw, preparing, onFirstFrame, onFrame, onError, onContextLost }: RenderPassProps) {
  const canvas = useThree((s) => s.gl.domElement);
  const frames = useRef(0);
  const failed = useRef(false);
  const callbacks = useRef({ draw, onFirstFrame, onFrame, onError, onContextLost });
  useEffect(() => {
    callbacks.current = { draw, onFirstFrame, onFrame, onError, onContextLost };
  });

  useEffect(() => {
    const onLost = (e: Event) => {
      e.preventDefault();
      if (failed.current) return;
      failed.current = true;
      // Browsers take contexts away from background tabs: an event to recover from, where the page can.
      const { onContextLost: lost, onError: error } = callbacks.current;
      if (lost) lost();
      else error?.(new Error("WebGL context lost"));
    };
    canvas.addEventListener("webglcontextlost", onLost);
    return () => canvas.removeEventListener("webglcontextlost", onLost);
  }, [canvas]);

  useFrame(({ gl, scene, camera }, delta) => {
    if (failed.current) return;
    if (preparing?.current) {
      // Through the composer or not at all: a plain render would build programs for the wrong target.
      const drawComposer = callbacks.current.draw;
      if (composer.current && drawComposer) drawComposer(gl, composer.current, 0);
      return;
    }
    try {
      const drawComposer = callbacks.current.draw;
      if (composer.current && drawComposer) drawComposer(gl, composer.current, delta);
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
