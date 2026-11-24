import type { QualityTier } from "../scene/types";

/**
 * Adaptive quality. It sits on top of the two model tiers (capability.ts decides whether a
 * device gets 3D at all and which model it loads): within a tier, the frame rate moves the
 * experience up and down these levels. Phones and weak devices (the low tier) never get depth
 * of field or ambient occlusion and render at one device pixel per CSS pixel.
 */
export type QualityLevel = 0 | 1 | 2 | 3;

export type QualitySettings = {
  /** The highest device pixel ratio rendered. */
  maxDpr: number;
  /** Edge antialiasing after tone mapping (the canvas itself is not multisampled). */
  smaa: boolean;
  /** Soft glow on lamps, lit windows and sun glitter. */
  bloom: boolean;
  /** Depth of field during story shots. */
  dof: boolean;
  /** Screen-space ambient occlusion. */
  ssao: boolean;
  /** Light-shaft planes through the palms. */
  godRays: boolean;
  /** Film grain and vignette: one cheap pass, on at every level. */
  grain: boolean;
  vignette: boolean;
};

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  0: { maxDpr: 1, smaa: false, bloom: true, dof: false, ssao: false, godRays: false, grain: true, vignette: true },
  1: { maxDpr: 1.25, smaa: true, bloom: true, dof: false, ssao: false, godRays: true, grain: true, vignette: true },
  2: { maxDpr: 1.5, smaa: true, bloom: true, dof: true, ssao: false, godRays: true, grain: true, vignette: true },
  3: { maxDpr: 1.75, smaa: true, bloom: true, dof: true, ssao: true, godRays: true, grain: true, vignette: true },
};

/**
 * What the reel is recorded at (ReelCapture.tsx): the top level's effects at two device pixels
 * per CSS pixel, which the encoder scales down, so every edge is supersampled. No grain: it does
 * not survive video compression, and costs a share of every frame's bits.
 */
export const REEL_QUALITY: QualitySettings = { ...QUALITY[3], maxDpr: 2, grain: false };

type Range = { min: QualityLevel; max: QualityLevel; start: QualityLevel };

/** The levels a model tier may use. The high tier starts one below its best and earns the last step. */
export const QUALITY_RANGE: Record<QualityTier, Range> = {
  low: { min: 0, max: 1, start: 0 },
  high: { min: 1, max: 3, start: 2 },
};

export function startQuality(tier: QualityTier): QualityLevel {
  return QUALITY_RANGE[tier].start;
}

/** One level down (-1) or up (1), within the tier's range. */
export function stepQuality(level: QualityLevel, direction: 1 | -1, tier: QualityTier): QualityLevel {
  const { min, max } = QUALITY_RANGE[tier];
  return Math.min(max, Math.max(min, level + direction)) as QualityLevel;
}

/** The pixel ratio to render at for a level on this screen. */
export function pixelRatio(level: QualityLevel, deviceRatio: number): number {
  return Math.min(Math.max(1, deviceRatio || 1), QUALITY[level].maxDpr);
}

/**
 * Frame-rate bounds for the performance monitor: under the lower bound for a while steps down,
 * over the upper steps up. Phones are held to 30 fps or better, desktops to their refresh rate.
 */
export function fpsBounds(tier: QualityTier, refreshRate: number): [lower: number, upper: number] {
  if (tier === "low") return [30, 50];
  return refreshRate > 90 ? [55, 85] : [48, 57];
}
