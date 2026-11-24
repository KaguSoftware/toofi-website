import { useEffect, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import type { Object3D } from "three";
import { reportError } from "@/lib/monitoring";
import { dayPageOf, detailOf } from "../scene/compoundModel";

/** The sequence position the camera is held at for the frame being recorded. */
export type ReelHead = { position: number };

/**
 * What scripts/render-story-reel.mjs drives, on `window.__sawadReel`: one call per frame of the
 * reel. `frame` puts the story camera at a sequence position, moves the scene's clock to `seconds`
 * and draws, all before it returns, so the canvas can be read right after it.
 */
export type ReelCaptureApi = { frame: (seconds: number, position: number) => void };

export const REEL_CAPTURE_KEY = "__sawadReel";

type Host = { [REEL_CAPTURE_KEY]?: ReelCaptureApi };

export type ReelCaptureProps = {
  /** Written before each frame; the camera rig reads it. */
  head: RefObject<ReelHead>;
  /** The compound: the recording waits for its full detail and its full light page. */
  model: Object3D | null;
  /** The scene's shaders are ready and its loop stands still. */
  ready: boolean;
  /** The handle is on `window`: frames may be asked for. */
  onReady?: () => void;
};

/**
 * Development only: records the story for the reel (reel.ts). The canvas runs no loop of its own
 * (`frameloop="never"`); each frame is drawn when the capture script asks for it, at the scene
 * time and camera position the script gives, so the same frame comes out however fast the
 * machine is. Nothing is offered until the far set has been replaced by the full model: the reel
 * shows the detail a visitor would only get by waiting.
 */
export function ReelCapture({ head, model, ready, onReady }: ReelCaptureProps) {
  const advance = useThree((s) => s.advance);
  useEffect(() => {
    if (!ready) return;
    let closed = false;
    const host = window as unknown as Host;
    const api: ReelCaptureApi = {
      frame(seconds, position) {
        head.current.position = position;
        advance(seconds, false);
      },
    };
    Promise.all([detailOf(model)?.settled, dayPageOf(model)?.settled])
      .then(() => {
        if (closed) return;
        host[REEL_CAPTURE_KEY] = api;
        onReady?.();
      })
      .catch((err: unknown) => reportError("ReelCapture", err, { stage: "detail" }));
    return () => {
      closed = true;
      if (host[REEL_CAPTURE_KEY] === api) delete host[REEL_CAPTURE_KEY];
    };
  }, [ready, model, advance, head, onReady]);
  return null;
}
