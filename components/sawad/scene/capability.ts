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

function detectWebGL2(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!canvas.getContext("webgl2");
  } catch {
    return false;
  }
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
