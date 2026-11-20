import type { QualityTier } from "./types";

export type CapabilityEnv = {
  webgl2: boolean;
  saveData?: boolean;
  effectiveType?: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  reducedMotion: boolean;
  mode: "film" | "explorer";
};

const SLOW_NETWORKS = new Set(["slow-2g", "2g", "3g"]);

/** Whether this device should load the 3D scene at all. The poster is the fallback. */
export function canRender3D(env: CapabilityEnv): boolean {
  if (!env.webgl2) return false;
  if (env.saveData) return false;
  if (env.effectiveType && SLOW_NETWORKS.has(env.effectiveType)) return false;
  if (env.deviceMemory !== undefined && env.deviceMemory < 4) return false;
  if (env.hardwareConcurrency !== undefined && env.hardwareConcurrency < 4) return false;
  if (env.mode === "film" && env.reducedMotion) return false;
  return true;
}

/** Low tier: no shadows, pixel ratio 1, fewer trees. */
export function qualityTier(env: CapabilityEnv & { width: number; dpr: number }): QualityTier {
  if (env.width < 768) return "low";
  if (env.deviceMemory !== undefined && env.deviceMemory < 8) return "low";
  if (env.hardwareConcurrency !== undefined && env.hardwareConcurrency < 8) return "low";
  return "high";
}

type NavigatorExtras = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
};

let webgl2Probe: boolean | undefined;

/** Forgets the probe result (tests only). */
export function resetWebGL2Probe(): void {
  webgl2Probe = undefined;
}

/**
 * Whether the browser gives out a WebGL2 context. The answer cannot change within a page, and
 * making a context is a round trip to the GPU process that blocked the main thread for about
 * 60 ms on a mid-range phone each time it ran, so it is asked once and the probe is released.
 */
function detectWebGL2(): boolean {
  if (webgl2Probe !== undefined) return webgl2Probe;
  try {
    const gl = document.createElement("canvas").getContext("webgl2") as WebGL2RenderingContext | null;
    webgl2Probe = !!gl;
    gl?.getExtension?.("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl2Probe = false;
  }
  return webgl2Probe;
}

/** Reads the capability inputs from the browser. Safe to call during SSR (returns a "no" env). */
export function readCapabilityEnv(mode: "film" | "explorer"): CapabilityEnv {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { webgl2: false, reducedMotion: true, mode };
  }
  const nav = navigator as NavigatorExtras;
  const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return {
    webgl2: detectWebGL2(),
    saveData: nav.connection?.saveData,
    effectiveType: nav.connection?.effectiveType,
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
    reducedMotion,
    mode,
  };
}
