"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { reportError } from "@/lib/monitoring";
import { canRender3D, qualityTier, readCapabilityEnv } from "./capability";
import type { Engine } from "./engine";
import type { SceneViewportProps } from "./types";
import "./scene.css";

type Phase = "poster" | "idle" | "loading" | "running" | "unavailable";

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const capable = useSyncExternalStore<boolean | null>(noopSubscribe, () => capableSnapshot(mode), () => null);
  const capture = useSyncExternalStore(noopSubscribe, isCaptureMode, () => false);
  const [status, setStatus] = useState<"off" | "loading" | "running" | "failed">("off");
  const [requested, setRequested] = useState(autoLoad);
  const [playing, setPlaying] = useState(true);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const [hint, setHint] = useState(mode === "explorer");
  const [captureReady, setCaptureReady] = useState(false);

  // Latest props for engine callbacks and for the initial state of a fresh engine.
  const latest = useRef({ view, markers, selectedId, onSelect });
  useEffect(() => {
    latest.current = { view, markers, selectedId, onSelect };
  });

  const fail = useCallback(
    (err: unknown) => {
      reportError("SceneViewport", err, { variant, mode });
      engineRef.current?.dispose();
      engineRef.current = null;
      setStatus("failed");
    },
    [variant, mode],
  );

  // The engine lives exactly as long as this effect.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!capable || !requested || !canvas) return;
    let cancelled = false;
    const env = readCapabilityEnv(mode);
    const captureNow = isCaptureMode();
    const tier = captureNow ? "high" : qualityTier({ ...env, width: window.innerWidth, dpr: window.devicePixelRatio || 1 });
    import("./engine")
      .then(({ createEngine }) => {
        if (cancelled) return;
        const engine = createEngine(canvas, {
          variant,
          tier,
          mode,
          view: latest.current.view,
          reducedMotion: env.reducedMotion,
          // Keep the compound clear of the hero text panel, which sits at the inline start.
          frame: mode === "film" ? { x: getComputedStyle(canvas).direction === "rtl" ? -0.12 : 0.12, y: 0.1 } : undefined,
          onSelect: (id) => latest.current.onSelect?.(id),
          onFirstFrame: () => setStatus("running"),
          onFrame: captureNow ? (n) => n === CAPTURE_FRAMES && setCaptureReady(true) : undefined,
          onError: fail,
        });
        engineRef.current = engine;
        if (mode === "explorer" && !captureNow) {
          engine.setMarkers(latest.current.markers ?? []);
          engine.setSelected(latest.current.selectedId ?? null);
        }
      })
      .catch((err) => {
        if (!cancelled) fail(err);
      });
    return () => {
      cancelled = true;
      engineRef.current?.dispose();
      engineRef.current = null;
      setStatus("off");
      setCaptureReady(false);
    };
  }, [capable, requested, variant, mode, fail]);

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

  useEffect(() => {
    engineRef.current?.setPlaying(playing && onScreen && tabVisible);
  }, [playing, onScreen, tabVisible, phase]);

  // Keep the canvas sized to its box.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || phase !== "running" || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => engineRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase]);

  // Controlled props → engine.
  useEffect(() => {
    if (phase === "running") engineRef.current?.setView(view, true);
  }, [view, phase]);
  useEffect(() => {
    if (phase === "running" && mode === "explorer" && !capture) engineRef.current?.setMarkers(markers ?? []);
  }, [markers, phase, mode, capture]);
  useEffect(() => {
    if (phase !== "running" || mode !== "explorer") return;
    engineRef.current?.setSelected(selectedId ?? null);
    if (selectedId) engineRef.current?.flyToMarker(selectedId);
  }, [selectedId, phase, mode]);

  // The drag hint disappears after first interaction or a few seconds.
  useEffect(() => {
    if (!hint || phase !== "running") return;
    const t = setTimeout(() => setHint(false), 6000);
    return () => clearTimeout(t);
  }, [hint, phase]);

  const running = phase === "running";
  const ready = capture ? captureReady : running;
  const showUi = !capture;

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
      <canvas ref={canvasRef} className="scene__canvas" data-visible={running} aria-hidden="true" />

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
            <button type="button" className="scene__btn" aria-label={labels.zoomIn} onClick={() => engineRef.current?.zoom(1)}>
              <PlusIcon />
            </button>
            <button type="button" className="scene__btn" aria-label={labels.zoomOut} onClick={() => engineRef.current?.zoom(-1)}>
              <MinusIcon />
            </button>
            <button type="button" className="scene__btn" aria-label={labels.reset} onClick={() => engineRef.current?.reset()}>
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
