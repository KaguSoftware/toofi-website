import { REEL_FPS, TOUR_FRAMES, tourTime } from "./reel";

/**
 * The tour's frames, as the page blends them. The playhead is between two frames most of the time
 * (a slow scroll moves it a fraction of a frame per refresh), so the page draws the frame it is
 * past and, over it, the next one at the fraction it is through. Pure arithmetic and a small cache,
 * no DOM: StoryReel.tsx does the seeking and the drawing.
 */

/** A playhead this close to a whole frame shows that frame alone: no second draw for a mix nobody can see. */
export const MIX_EPSILON = 0.02;

/** The tour file's last frame: it has TOUR_FRAMES + 1 frames, numbered from 0. */
const LAST = TOUR_FRAMES;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));

/** The playhead's place in the tour file, in frames (fractional): frame 0 is the gate. */
export function tourFrameAt(position: number): number {
  return clamp(tourTime(position) * REEL_FPS, 0, LAST);
}

/** The time to seek to for a frame: its middle, so a seek never lands on the edge between two. */
export function frameTime(frame: number): number {
  return (frame + 0.5) / REEL_FPS;
}

/** What to show for a place in the file: `base` at full strength and, when there is one, `next` over it at `mix` (0 to 1). */
export type FramePair = { base: number; next: number | null; mix: number };

export function framePair(frame: number): FramePair {
  const at = clamp(frame, 0, LAST);
  const floor = Math.floor(at);
  const mix = at - floor;
  if (mix < MIX_EPSILON || floor >= LAST) return { base: floor, next: null, mix: 0 };
  if (mix > 1 - MIX_EPSILON) return { base: floor + 1, next: null, mix: 0 };
  return { base: floor, next: floor + 1, mix };
}

/** The frame still to be fetched for a pair, the base before the next, or null when both are in hand. */
export function missingFrame(pair: FramePair, has: (frame: number) => boolean): number | null {
  if (!has(pair.base)) return pair.base;
  if (pair.next !== null && !has(pair.next)) return pair.next;
  return null;
}

/**
 * A handful of decoded frames, each on a surface (an offscreen canvas) the owner draws into.
 * Surfaces are made only while there is room; after that the one holding the frame farthest from
 * where the playhead is gets the new frame, so the frames around the playhead stay.
 */
export class FrameCache<T> {
  private readonly frames = new Map<number, T>();

  constructor(
    private readonly make: () => T,
    private readonly size = 4,
  ) {}

  /** The number of frames held. */
  get count(): number {
    return this.frames.size;
  }

  has(frame: number): boolean {
    return this.frames.has(frame);
  }

  get(frame: number): T | undefined {
    return this.frames.get(frame);
  }

  /** The surface to draw `frame` into: its own if it is held, a new one if there is room, else that of the held frame farthest from `near`. */
  slot(frame: number, near: number): T {
    const held = this.frames.get(frame);
    if (held !== undefined) return held;
    let surface: T;
    if (this.frames.size < this.size) {
      surface = this.make();
    } else {
      let farthest = -1;
      let distance = -1;
      for (const f of this.frames.keys()) {
        const d = Math.abs(f - near);
        if (d > distance) {
          distance = d;
          farthest = f;
        }
      }
      surface = this.frames.get(farthest) as T;
      this.frames.delete(farthest);
    }
    this.frames.set(frame, surface);
    return surface;
  }

  /** The held frame closest to `frame`, or null when none is held. */
  nearest(frame: number): number | null {
    let best: number | null = null;
    let distance = Infinity;
    for (const f of this.frames.keys()) {
      const d = Math.abs(f - frame);
      if (d < distance) {
        distance = d;
        best = f;
      }
    }
    return best;
  }
}
