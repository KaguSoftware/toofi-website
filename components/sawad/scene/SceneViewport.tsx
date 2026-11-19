"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { ErrorBoundary } from "@/components/monitoring/ErrorBoundary";
import { reportError } from "@/lib/monitoring";
import { canRender3D, qualityTier, readCapabilityEnv } from "./capability";
import type { QualityTier, SceneApi, SceneViewportProps } from "./types";
import "./scene.css";

// The WebGL scene (three.js + React Three Fiber) is its own chunk, fetched in the browser
// only once a capable device asks for it.
const SceneCanvas = dynamic(() => import("./SceneCanvas"), { ssr: false });

type Phase = "poster" | "idle" | "loading" | "running" | "unavailable";
/** What one mounted canvas has reached. Another compound or mode starts again from nothing. */
type Run = { key: string; status: "running" | "failed"; captureReady: boolean };
/** Facts read from the browser when the canvas stage mounts. */
type Setup = { key: string; tier: QualityTier; reducedMotion: boolean; frame?: { x: number; y: number }; capture: boolean };

function isCaptureMode(): boolean {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("capture") === "1";
}

const CAPTURE_FRAMES = 30;

// Client-only facts, read without an effect (server snapshot: unknown / false).
const noopSubscribe = () => () => {};
const capabilityCache = new Map<string, boolean>();
function capableSnapshot(mode: "film" | "explorer"): boolean {
  let v = capabilityCache.get(mode);
  if (v === undefined) {
    v = canRender3D(readCapabilityEnv(mode));
    capabilityCache.set(mode, v);
  }
  return v;
}
/** Test hook: forget cached capability results. */
export function resetCapabilityCache(): void {
  capabilityCache.clear();
}

/** Runs once when it mounts: how the error boundary's fallback tells the viewport it failed. */
function OnMount({ run }: { run: () => void }) {
  useEffect(run, [run]);
  return null;
}

/**
 * Poster first, always. The 3D scene loads on capable devices only and fades in
 * after its first rendered frame, so there is never a blank canvas.
 */
export function SceneViewport({
  mode,
  variant,
  view,
  poster,
  markers,
  selectedId = null,
  onSelect,
  labels,
  autoLoad = true,
  className,
}: SceneViewportProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<SceneApi | null>(null);
  const capable = useSyncExternalStore<boolean | null>(noopSubscribe, () => capableSnapshot(mode), () => null);
  const capture = useSyncExternalStore(noopSubscribe, isCaptureMode, () => false);
  // The scene is rebuilt from scratch for another compound or mode; so is everything it reached.
  const sceneKey = `${variant}:${mode}`;
  const [run, setRun] = useState<Run | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [requested, setRequested] = useState(autoLoad);
  const [playing, setPlaying] = useState(true);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const [hint, setHint] = useState(mode === "explorer");

  const status = run?.key === sceneKey ? run.status : "off";
  const captureReady = run?.key === sceneKey && run.captureReady;
  const mark = useCallback(
    (patch: Partial<Omit<Run, "key">>) =>
      setRun((prev) => ({ key: sceneKey, status: "running", captureReady: false, ...(prev?.key === sceneKey ? prev : null), ...patch })),
    [sceneKey],
  );

  const onFirstFrame = useCallback(() => mark({ status: "running" }), [mark]);
  const onFrame = useCallback(
    (n: number) => {
      if (n === CAPTURE_FRAMES) mark({ captureReady: true });
    },
    [mark],
  );
  const onBoundaryError = useCallback(() => mark({ status: "failed" }), [mark]);
  const fail = useCallback(
    (err: unknown) => {
      reportError("SceneViewport", err, { variant, mode });
      mark({ status: "failed" });
    },
    [variant, mode, mark],
  );

  // The stage element exists only while the scene should load. Mounting it reads the device
  // once: quality tier, motion preference, and which side the film must keep clear.
  const stageRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      const env = readCapabilityEnv(mode);
      const captureNow = isCaptureMode();
      setSetup({
        key: sceneKey,
        tier: captureNow ? "high" : qualityTier({ ...env, width: window.innerWidth, dpr: window.devicePixelRatio || 1 }),
        reducedMotion: env.reducedMotion,
        // Keep the compound clear of the hero text panel, which sits at the inline start.
        frame: mode === "film" ? { x: getComputedStyle(el).direction === "rtl" ? -0.12 : 0.12, y: 0.1 } : undefined,
        capture: captureNow,
      });
    },
    [mode, sceneKey],
  );

  // Pause when offscreen or the tab is hidden.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0.05 });
      io.observe(el);
    }
    const onVis = () => setTabVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const phase: Phase =
    capable === null
      ? "poster"
      : !capable || status === "failed"
        ? mode === "explorer"
          ? "unavailable"
          : "poster"
        : !requested
          ? "idle"
          : status === "running"
            ? "running"
            : "loading";

  // The drag hint disappears after first interaction or a few seconds.
  useEffect(() => {
    if (!hint || phase !== "running") return;
    const t = setTimeout(() => setHint(false), 6000);
    return () => clearTimeout(t);
  }, [hint, phase]);

  const running = phase === "running";
  const ready = capture ? captureReady : running;
  const showUi = !capture;
  const loads = capable === true && requested && status !== "failed";
  const current = setup?.key === sceneKey ? setup : null;

  return (
    <div
      ref={rootRef}
      className={`scene ${className ?? ""}`.trim()}
      data-mode={mode}
      data-phase={phase}
      data-scene-ready={ready ? "true" : undefined}
      role="region"
      aria-label={labels.sceneLabel}
      onPointerDown={() => setHint(false)}
    >
      <Image className="scene__poster" src={poster.src} alt={poster.alt} fill priority sizes="100vw" />
      {loads && (
        <div key={sceneKey} ref={stageRef} className="scene__canvas" data-visible={running} aria-hidden="true">
          {current && (
            <ErrorBoundary name="SceneViewport" fallback={<OnMount run={onBoundaryError} />}>
              <SceneCanvas
                variant={variant}
                tier={current.tier}
                mode={mode}
                view={view}
                reducedMotion={current.reducedMotion}
                frame={current.frame}
                markers={mode === "explorer" && !current.capture ? (markers ?? []) : undefined}
                selectedId={mode === "explorer" ? selectedId : null}
                playing={playing && onScreen && tabVisible}
                apiRef={apiRef}
                onSelect={onSelect}
                onFirstFrame={onFirstFrame}
                onFrame={current.capture ? onFrame : undefined}
                onError={fail}
              />
            </ErrorBoundary>
          )}
        </div>
      )}

      {showUi && phase === "loading" && mode === "explorer" && (
        <p className="scene__note" role="status">
          {labels.loading}
        </p>
      )}
      {showUi && phase === "unavailable" && <p className="scene__note">{labels.unavailable}</p>}
      {showUi && phase === "idle" && (
        <button type="button" className="scene__btn scene__load" onClick={() => setRequested(true)}>
          {labels.load3d}
        </button>
      )}

      {showUi && running && mode === "film" && (
        <div className="scene__controls">
          <button
            type="button"
            className="scene__btn"
            aria-pressed={!playing}
            aria-label={playing ? labels.pause : labels.play}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
        </div>
      )}

      {showUi && running && mode === "explorer" && (
        <>
          <div className="scene__controls">
            <button type="button" className="scene__btn" aria-label={labels.zoomIn} onClick={() => apiRef.current?.zoom(1)}>
              <PlusIcon />
            </button>
            <button type="button" className="scene__btn" aria-label={labels.zoomOut} onClick={() => apiRef.current?.zoom(-1)}>
              <MinusIcon />
            </button>
            <button type="button" className="scene__btn" aria-label={labels.reset} onClick={() => apiRef.current?.reset()}>
              <ResetIcon />
            </button>
          </div>
          {hint && (
            <p className="scene__hint" aria-hidden="true">
              {labels.dragHint}
            </p>
          )}
        </>
      )}
    </div>
  );
}

const iconProps = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true } as const;

function PauseIcon() {
  return (
    <svg {...iconProps}>
      <path d="M6 4v10M12 4v10" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5.5 3.5l9 5.5-9 5.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg {...iconProps}>
      <path d="M9 3.5v11M3.5 9h11" />
    </svg>
  );
}
function MinusIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3.5 9h11" />
    </svg>
  );
}
function ResetIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3.8 7.2A5.6 5.6 0 1 1 3.6 10.5" />
      <path d="M3.5 3.5v3.9h3.9" />
    </svg>
  );
}
