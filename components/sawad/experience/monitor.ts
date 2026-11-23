import type { QualityTier } from "../scene/types";

/**
 * The frame-rate monitor behind the quality levels. It replaces drei's PerformanceMonitor, which
 * counted a window above the upper bound as a flip even at the top level, stepped every fast
 * device down after about 11 s, and then stopped for good (S5-3, S9-4).
 *
 * This one never stops. It judges windows of frame-rate samples: mostly under the lower bound
 * asks for a step down, mostly over the upper bound allows a step up. A level that failed is not
 * tried again until its cooldown has passed, and the cooldown doubles each time it fails again,
 * so a device between two levels settles on the lower one instead of flipping between them.
 */
export const MONITOR = {
  /** One frame-rate sample is taken over this long. */
  sampleMs: 250,
  /** Samples per verdict: 2.5 s. */
  samples: 10,
  /** The share of a window's samples beyond a bound that makes the monitor act. */
  share: 0.75,
  /** After a level change nothing is judged for this long: the change itself costs a frame. */
  settleMs: 1000,
  /** A level that failed is not tried again for this long; doubled each time it fails again. */
  cooldownMs: 60_000,
  cooldownMaxMs: 600_000,
  /** A gap between two frames longer than this is a pause (hidden tab, on-demand loop), not a slow frame. */
  gapMs: 500,
  /** Windows in a row under the starved frame rate, at the lowest level, before giving up: 10 s. */
  starvedWindows: 4,
} as const;

export type MonitorConfig = { [K in keyof typeof MONITOR]: number };

/**
 * Under this frame rate at a tier's lowest level the scene gives way to the stills. The high
 * tier's number comes from S9's estimate for weak laptops (no such machine has been measured);
 * phones keep the scene until a real phone has been measured (`null`: never give up).
 */
export const STARVED_FPS: Record<QualityTier, number | null> = { high: 20, low: null };

/** A step down, a step up, or: the lowest level is still too slow to watch. */
export type MonitorDecision = "down" | "up" | "starved";

export type MonitorInput = {
  /** The level now, and the lowest and highest the tier may use. */
  level: number;
  min: number;
  max: number;
  /** The frame rates under which to step down and over which to step up, for a display's refresh rate. */
  bounds: (refreshRate: number) => readonly [lower: number, upper: number];
  /** See STARVED_FPS. */
  starvedFps?: number | null;
};

export type QualityMonitor = {
  /**
   * One drawn frame, `delta` seconds after the one before it. Returns what the frame rate asks
   * for, or null. Time is counted from the deltas, so a paused or externally driven loop is
   * judged by the frames it draws, not by the clock on the wall.
   */
  frame: (delta: number, input: MonitorInput) => MonitorDecision | null;
  /** Forgets the samples in hand (the loop was paused, or the scene was hidden). Cooldowns stay. */
  rest: () => void;
};

export function createQualityMonitor(config: MonitorConfig = MONITOR): QualityMonitor {
  let clock = 0;
  let quietUntil = 0;
  let frames = 0;
  let span = 0;
  let samples: number[] = [];
  /** The highest frame rate seen: the display's refresh rate, as far as the page can tell. */
  let refreshRate = 0;
  /** Per level: when it may be tried again, and how long the wait was. */
  const cooling = new Map<number, { until: number; wait: number }>();
  let starved = 0;
  let gaveUp = false;

  const rest = () => {
    frames = 0;
    span = 0;
    samples = [];
    starved = 0;
  };

  const verdict = ({ level, min, max, bounds, starvedFps = null }: MonitorInput): MonitorDecision | null => {
    const [lower, upper] = bounds(refreshRate);
    const slow = samples.filter((s) => s < lower).length / samples.length;
    const fast = samples.filter((s) => s > upper).length / samples.length;
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    samples = [];

    if (slow >= config.share) {
      if (level > min) {
        // This level failed: leave it, and do not come back before its cooldown.
        const wait = Math.min(config.cooldownMaxMs, (cooling.get(level)?.wait ?? config.cooldownMs / 2) * 2);
        cooling.set(level, { until: clock + wait, wait });
        starved = 0;
        quietUntil = clock + config.settleMs;
        return "down";
      }
      // Nothing lower to step to. Slow is kept; unwatchable for long enough is given up on, once.
      if (starvedFps !== null && mean < starvedFps) {
        starved += 1;
        if (starved >= config.starvedWindows) {
          gaveUp = true;
          return "starved";
        }
      } else starved = 0;
      return null;
    }

    starved = 0;
    if (fast >= config.share && level < max && clock >= (cooling.get(level + 1)?.until ?? 0)) {
      quietUntil = clock + config.settleMs;
      return "up";
    }
    return null;
  };

  return {
    rest,
    frame(delta, input) {
      if (gaveUp) return null;
      const ms = delta * 1000;
      if (!(ms > 0)) return null;
      clock += ms;
      if (ms > config.gapMs) {
        rest();
        return null;
      }
      if (clock < quietUntil) {
        rest();
        return null;
      }
      frames += 1;
      span += ms;
      // Half a millisecond of slack, so 15 frames at 60 Hz (250 ms less a rounding error) make a sample.
      if (span < config.sampleMs - 0.5) return null;
      const fps = (frames * 1000) / span;
      frames = 0;
      span = 0;
      refreshRate = Math.max(refreshRate, fps);
      samples.push(fps);
      return samples.length >= config.samples ? verdict(input) : null;
    },
  };
}
