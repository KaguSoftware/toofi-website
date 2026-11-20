/**
 * The story's timeline, without any geometry: safe to import on the page side (captions, the
 * scroll driver) as well as inside the canvas. Positions are in sequence seconds, the unit of
 * the Theatre.js sheet (storySheet.ts): 0 to INTRO_SECONDS plays by itself, the rest follows
 * the scroll.
 */

export const BEAT_IDS = ["entrance", "boulevard", "villa", "amenities", "aerial"] as const;
export type BeatId = (typeof BEAT_IDS)[number];

/** The auto-playing opening: from the poster frame down to the main gate. */
export const INTRO_SECONDS = 14;
/** Where the sequence ends: the aerial, where free exploring takes over. */
export const STORY_END = 86;

export type Beat = {
  id: BeatId;
  /** The stretch of the sequence the beat's caption belongs to. */
  from: number;
  to: number;
  /** Where the camera is when the beat's panel is centred on screen. */
  at: number;
};

export const BEATS: readonly Beat[] = [
  { id: "entrance", from: INTRO_SECONDS, to: 25, at: 21 },
  { id: "boulevard", from: 25, to: 40, at: 32 },
  { id: "villa", from: 40, to: 57, at: 48 },
  { id: "amenities", from: 57, to: 73, at: 66 },
  { id: "aerial", from: 73, to: STORY_END, at: STORY_END },
];

/** The beat a sequence position belongs to; "intro" before the gate. */
export function beatAt(position: number): BeatId | "intro" {
  if (position < INTRO_SECONDS) return "intro";
  return (BEATS.find((b) => position < b.to) ?? BEATS[BEATS.length - 1]).id;
}

/**
 * Scroll progress to sequence position, as (progress, position) pairs. The page is one panel
 * for the hero and one per beat, so panel k is centred at progress k / 5; each pair puts that
 * beat's composed shot there, and the camera glides between them in between.
 */
const SCROLL_ANCHORS: ReadonlyArray<readonly [number, number]> = [[0, INTRO_SECONDS], ...BEATS.map((b, i) => [(i + 1) / BEATS.length, b.at] as const)];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** The sequence position for a scroll progress of 0 to 1 through the story. */
export function scrollToPosition(progress: number): number {
  const s = clamp01(Number.isFinite(progress) ? progress : 0);
  for (let i = 1; i < SCROLL_ANCHORS.length; i++) {
    const [s1, p1] = SCROLL_ANCHORS[i];
    if (s > s1) continue;
    const [s0, p0] = SCROLL_ANCHORS[i - 1];
    return p0 + ((s - s0) / (s1 - s0)) * (p1 - p0);
  }
  return STORY_END;
}

/** How quickly the playhead closes on the scroll (per second), and its top speed in sequence seconds per second. */
export const HEAD_RATE = 3.2;
export const HEAD_MAX_SPEED = 4.5;

/**
 * Moves the playhead toward where the scroll wants it: eased, and never faster than
 * HEAD_MAX_SPEED, so a flung scroll becomes a quick glide along the authored path instead of a jump.
 */
export function approach(head: number, goal: number, dt: number, rate = HEAD_RATE, maxSpeed = HEAD_MAX_SPEED): number {
  const gap = goal - head;
  if (Math.abs(gap) < 1e-4 || dt <= 0) return Math.abs(gap) < 1e-4 ? goal : head;
  const eased = gap * (1 - Math.exp(-rate * dt));
  const limit = maxSpeed * dt;
  return head + Math.max(-limit, Math.min(limit, eased));
}

/** Seconds after the intro without any input before the camera drifts into the slow circuit. */
export const AMBIENT_IDLE_SECONDS = 5;
/** Seconds to ease from the gate shot into the circuit. */
export const AMBIENT_BLEND_SECONDS = 9;
