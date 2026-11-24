"use client";

import { useCallback, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { reportError } from "@/lib/monitoring";
import { CAMERA_FAR, CAMERA_NEAR, EXPOSURE } from "../scene/SceneCanvas";
import { viewpoints } from "../scene/viewpoints";
import { ExperienceRoot, type ExperienceRootProps } from "./ExperienceRoot";
import { REEL_QUALITY, pixelRatio, startQuality, stepQuality, type QualityLevel } from "./quality";
import { openStoryStudio, storyPose } from "./storySheet";

export type ExperienceCanvasProps = Omit<ExperienceRootProps, "level" | "onReady" | "onQuality" | "playing"> & {
  /** False while offscreen, in a hidden tab, or paused by the visitor: frames are drawn only when asked for. */
  playing: boolean;
  /** False pauses what moves by itself (the intro, the circuit) while the loop keeps running. */
  moving?: boolean;
};

// The canvas is not multisampled: the effect chain smooths edges after tone mapping.
const RENDERER = { antialias: false, alpha: false, powerPreference: "high-performance", toneMappingExposure: EXPOSURE } as const;
const RESIZE = { scroll: false } as const;
const STYLE = { pointerEvents: "inherit" } as const;

/** Development only: `?level=2` pins the quality level (to measure frame times without the monitor moving it). */
export function pinnedLevel(): QualityLevel | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("level");
  return raw === "0" || raw === "1" || raw === "2" || raw === "3" ? (Number(raw) as QualityLevel) : null;
}

/**
 * The WebGL canvas for the Zaitun Hills experience (React Three Fiber). Client-only and heavy:
 * loaded lazily, after the poster has painted. Nothing is drawn until the compound is ready,
 * so the first frame is the finished picture. It also holds the quality level, which the frame
 * rate moves within the device's tier.
 */
export default function ExperienceCanvas({ playing, moving = true, tier, view, mode, holdAt = null, reel = false, startAt = null, ...rest }: ExperienceCanvasProps) {
  const [ready, setReady] = useState(false);
  const [level, setLevel] = useState<QualityLevel>(() => (reel ? 3 : (pinnedLevel() ?? startQuality(tier))));
  // The opening shot. Later moves go through the rig, not through this prop.
  const [camera] = useState(() => {
    const start = mode === "story" ? storyPose(view, holdAt ?? 0) : startAt !== null ? storyPose(view, startAt) : viewpoints("zaitun").aerial;
    return { fov: start.fov, near: CAMERA_NEAR, far: CAMERA_FAR, position: start.position };
  });
  // The Canvas re-applies `dpr` whenever it re-renders, so it must follow the level: a fixed start
  // ratio would undo every level change on the next state change around it (ledger T17).
  const dpr = reel ? REEL_QUALITY.maxDpr : pixelRatio(level, window.devicePixelRatio);
  // Development only: `?studio=1` opens Theatre Studio on the story sheet (see README.md).
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (new URLSearchParams(window.location.search).get("studio") !== "1") return;
    openStoryStudio().catch((err) => reportError("ExperienceCanvas", err, { stage: "theatre-studio" }));
  }, []);
  // A capture holds its level: stills must not depend on how fast the capturing machine is.
  const onQuality = useCallback((direction: 1 | -1) => setLevel((l) => (holdAt === null && !reel && pinnedLevel() === null ? stepQuality(l, direction, tier) : l)), [holdAt, reel, tier]);

  return (
    <Canvas
      flat
      // The reel is recorded frame by frame: its capture draws each one (ReelCapture.tsx).
      frameloop={!ready || reel ? "never" : playing ? "always" : "demand"}
      dpr={dpr}
      shadows={tier === "high" ? "percentage" : false}
      gl={RENDERER}
      camera={camera}
      resize={RESIZE}
      style={STYLE}
    >
      <ExperienceRoot {...rest} tier={tier} level={level} view={view} mode={mode} holdAt={holdAt} reel={reel} startAt={startAt} playing={moving} onReady={() => setReady(true)} onQuality={onQuality} />
    </Canvas>
  );
}
