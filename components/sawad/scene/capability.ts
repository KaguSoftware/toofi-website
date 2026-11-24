import type { QualityTier } from "./types";

export type CapabilityEnv = {
  webgl2: boolean;
  /** The GPU's name, where the browser gives one. Unknown (masked, or not asked) counts as fine. */
  renderer?: string;
  saveData?: boolean;
  effectiveType?: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  /** The screen's shorter side in CSS pixels, whichever way the device is held. */
  shortSide?: number;
  /** The main pointer is a finger: a phone or a tablet. */
  coarsePointer?: boolean;
  reducedMotion: boolean;
  mode: "film" | "explorer";
};

/** Links too slow for the 3D download, whoever asks. */
export const REFUSED_NETWORKS: readonly string[] = ["slow-2g", "2g"];
/**
 * Links that get the 3D only on request. Chrome reports "3g" for an ordinary 4G link with a
 * long round trip (5 Mbps at 300 ms, measured in S9), so this is an offer, not a refusal.
 */
export const OFFERED_NETWORKS: readonly string[] = ["3g"];
/** Under these the 3D is offered, not started: gigabytes of memory, and processor threads. */
export const MIN_MEMORY_GB = 4;
export const MIN_THREADS = 4;
/** Under these a device gets the low tier. */
export const HIGH_TIER_MEMORY_GB = 8;
export const HIGH_TIER_THREADS = 8;
/** A screen whose shorter side is under this many CSS pixels is a phone, however it is held. */
export const PHONE_SHORT_SIDE = 768;

/** Software rasterizers: a WebGL2 context without a GPU behind it (virtual machines, remote desktops). */
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i;
/**
 * GPUs sent to the low tier whatever the memory and thread counts say: Intel's integrated HD and
 * UHD graphics, and phone GPUs behind a desktop-sized window. The list comes from S9's estimate
 * (a UHD-class GPU is 8 to 12 times slower than the Mac the levels were sized on); no such laptop
 * has been measured yet, so change the list here when one has.
 */
export const WEAK_GPU = /\bu?hd graphics\b|\bmali\b|\badreno\b|\bpowervr\b|\bvideocore\b/i;

export const isSoftwareRenderer = (renderer: string | undefined): boolean => !!renderer && SOFTWARE_RENDERER.test(renderer);
export const isWeakGpu = (renderer: string | undefined): boolean => !!renderer && WEAK_GPU.test(renderer);

/** "yes": the 3D starts by itself. "offer": only when the visitor asks. "no": the stills are all there is. */
export type Render3D = "yes" | "offer" | "no";

/**
 * Whether this device loads the 3D scene: by itself, on request, or never. Only what cannot work
 * or was declined is refused outright (no WebGL2, a software renderer, Save-Data, a 2g link); a
 * slow link or a small device gets the stills with an offer.
 */
export function render3D(env: CapabilityEnv): Render3D {
  if (!env.webgl2) return "no";
  if (isSoftwareRenderer(env.renderer)) return "no";
  if (env.saveData) return "no";
  if (env.effectiveType && REFUSED_NETWORKS.includes(env.effectiveType)) return "no";
  if (env.mode === "film" && env.reducedMotion) return "no";
  if (env.effectiveType && OFFERED_NETWORKS.includes(env.effectiveType)) return "offer";
  if (env.deviceMemory !== undefined && env.deviceMemory < MIN_MEMORY_GB) return "offer";
  if (env.hardwareConcurrency !== undefined && env.hardwareConcurrency < MIN_THREADS) return "offer";
  return "yes";
}

/**
 * Whether this device plays the story reel: the story as video (experience/reel.ts). It needs no
 * GPU and little memory, so only what was declined is refused: Save-Data, a 2g link, and reduced
 * motion (nothing may move unasked). A "3g" report plays it: video starts on what has arrived.
 */
export function playsReel(env: Pick<CapabilityEnv, "saveData" | "effectiveType" | "reducedMotion">): boolean {
  if (env.saveData) return false;
  if (env.effectiveType && REFUSED_NETWORKS.includes(env.effectiveType)) return false;
  return !env.reducedMotion;
}

/** Whether this device should load the 3D scene unasked. The poster is the fallback. */
export function canRender3D(env: CapabilityEnv): boolean {
  return render3D(env) === "yes";
}

/** Low tier: no shadows, pixel ratio 1, fewer trees. Phones and tablets, modest hardware, weak GPUs. */
export function qualityTier(env: CapabilityEnv & { width: number; dpr: number }): QualityTier {
  if (env.width < PHONE_SHORT_SIDE) return "low";
  // A phone held sideways is wider than that, and still a phone.
  if (env.shortSide !== undefined && env.shortSide < PHONE_SHORT_SIDE) return "low";
  if (env.coarsePointer) return "low";
  if (env.deviceMemory !== undefined && env.deviceMemory < HIGH_TIER_MEMORY_GB) return "low";
  if (env.hardwareConcurrency !== undefined && env.hardwareConcurrency < HIGH_TIER_THREADS) return "low";
  if (isWeakGpu(env.renderer)) return "low";
  return "high";
}

type NavigatorExtras = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
};

/** What the WebGL2 probe found: whether a context is given out, and the GPU's name if the browser tells. */
export type GpuProbe = { webgl2: boolean; renderer?: string };

/** Where the early script (experience/early.ts) leaves its probe, so the context is made once per page. */
export const PROBE_KEY = "__sawadGpu";

let gpuProbe: GpuProbe | undefined;

/** Forgets the probe result (tests only). */
export function resetWebGL2Probe(): void {
  gpuProbe = undefined;
  if (typeof window !== "undefined") delete (window as unknown as Record<string, unknown>)[PROBE_KEY];
}

/** 0x9246 where the extension is present; the plain RENDERER (0x1F01) is what Firefox recommends instead. */
function rendererName(gl: WebGL2RenderingContext): string | undefined {
  const info = gl.getExtension?.("WEBGL_debug_renderer_info") as { UNMASKED_RENDERER_WEBGL: number } | null | undefined;
  const name = gl.getParameter?.(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) as unknown;
  return typeof name === "string" && name ? name : undefined;
}

/**
 * Whether the browser gives out a WebGL2 context, and on which GPU. The answer cannot change
 * within a page, and making a context is a round trip to the GPU process that blocked the main
 * thread for about 60 ms on a mid-range phone each time it ran, so it is asked once (here or by
 * the early script) and the probe is released.
 */
export function probeGpu(): GpuProbe {
  if (gpuProbe) return gpuProbe;
  const early = (window as unknown as Record<string, GpuProbe | undefined>)[PROBE_KEY];
  if (early && typeof early.webgl2 === "boolean") return (gpuProbe = { webgl2: early.webgl2, renderer: typeof early.renderer === "string" ? early.renderer : undefined });
  try {
    const gl = document.createElement("canvas").getContext("webgl2") as WebGL2RenderingContext | null;
    gpuProbe = gl ? { webgl2: true, renderer: rendererName(gl) } : { webgl2: false };
    gl?.getExtension?.("WEBGL_lose_context")?.loseContext();
  } catch {
    // No context is an answer, not a failure: the stills are shown.
    gpuProbe = { webgl2: false };
  }
  return gpuProbe;
}

/** Reads the capability inputs from the browser. Safe to call during SSR (returns a "no" env). */
export function readCapabilityEnv(mode: "film" | "explorer"): CapabilityEnv {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { webgl2: false, reducedMotion: true, mode };
  }
  const nav = navigator as NavigatorExtras;
  const media = (query: string) => typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const screenSides = typeof screen !== "undefined" && screen.width > 0 && screen.height > 0 ? Math.min(screen.width, screen.height) : undefined;
  const gpu = probeGpu();
  return {
    webgl2: gpu.webgl2,
    renderer: gpu.renderer,
    saveData: nav.connection?.saveData,
    effectiveType: nav.connection?.effectiveType,
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
    shortSide: screenSides,
    coarsePointer: media("(pointer: coarse)"),
    reducedMotion: media("(prefers-reduced-motion: reduce)"),
    mode,
  };
}
