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
/** Seconds the opening holds still on its poster frame before the camera starts to move. */
export const INTRO_HOLD_SECONDS = 2;
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

/**
 * How quickly the playhead closes on the scroll (per second), and its top speed in sequence
 * seconds per second. Tight enough that the camera stays with the captions, which follow the
 * scroll exactly. The rate is loose on purpose: the playhead keeps gliding for a moment after the
 * visitor stops (about 0.6 s to settle) and smooths the notches of a mouse wheel, instead of
 * halting dead with the scroll. A flick through the whole tour is still caught up within about
 * a second; the top speed only stops a single frame from jumping.
 */
export const HEAD_RATE = 8;
export const HEAD_MAX_SPEED = 96;

/** The playhead counts as caught up with the scroll within this many sequence seconds. */
export const HEAD_SETTLED = 0.05;

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

/** The reel's playhead: where it is, and how fast it is going (sequence seconds per second). */
export type Glide = { head: number; speed: number };
/** How long the playhead takes to answer the scroll, in seconds: it is at rest about two and a half of these after the scroll is. */
export const GLIDE_SECONDS = 0.4;
/**
 * The slowest the playhead goes before it stops (sequence seconds per second). The tour has twenty
 * pictures to a sequence second, so below this the glide would end as a handful of pictures, each
 * far apart in time, instead of as a movement.
 */
export const GLIDE_MIN_SPEED = 0.6;

/**
 * Moves the reel's playhead toward where the scroll wants it, with momentum: a critically damped
 * spring. Its speed never jumps, so a scroll eases it away and, when the scroll stops, it slows
 * along a curve to a stop (`approach` starts at full speed the moment the scroll moves). It never
 * passes the goal. A step of any length is exact, so the glide is the same at any frame rate.
 */
export function glide(state: Glide, goal: number, dt: number, seconds = GLIDE_SECONDS, maxSpeed = HEAD_MAX_SPEED): Glide {
  if (dt <= 0) return state;
  const gap = goal - state.head;
  if (Math.abs(gap) < 1e-4) return { head: goal, speed: 0 };
  const omega = 2 / seconds;
  const decay = Math.exp(-omega * dt);
  const pull = (state.speed - omega * gap) * dt;
  let head = goal + (pull - gap) * decay;
  let speed = (state.speed - omega * pull) * decay;
  // Near the end: no slower than the least speed, and then stop.
  const least = GLIDE_MIN_SPEED * dt;
  const slowing = Math.abs(gap) < GLIDE_MIN_SPEED * seconds && Math.abs(speed) < GLIDE_MIN_SPEED;
  if (slowing && Math.abs(head - state.head) < least) head = state.head + Math.sign(gap) * Math.min(least, Math.abs(gap));
  const most = maxSpeed * dt;
  if (Math.abs(head - state.head) > most) {
    head = state.head + Math.sign(head - state.head) * most;
    speed = Math.sign(head - state.head) * maxSpeed;
  }
  // Past the goal (a scroll that turned back on a fast playhead may swing wide; one that did not must not).
  if (gap > 0 !== goal - head > 0 && state.speed * gap >= 0) return { head: goal, speed: 0 };
  return { head, speed };
}

/** How far behind the scroll the reel's playhead runs, in seconds: the time the spring takes to close on a goal that moves steadily at one unit a second. */
export const REEL_SMOOTH_SECONDS = 0.3;

/**
 * The reel's playhead as a critically damped spring (Unity's SmoothDamp). Unlike `approach` it
 * carries its velocity from one frame to the next: it eases away from rest, trails a steady scroll
 * by about `smoothTime` times its speed, and when the scroll stops it coasts to rest along a curve
 * instead of halting. It never passes the goal, and its speed stays within ±maxSpeed. Returns the
 * new head and velocity; a step of zero or less changes nothing.
 */
export function follow(head: number, velocity: number, goal: number, dt: number, smoothTime = REEL_SMOOTH_SECONDS, maxSpeed = HEAD_MAX_SPEED): { head: number; velocity: number } {
  if (!(dt > 0)) return { head, velocity };
  const time = Math.max(1e-4, smoothTime);
  const omega = 2 / time;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  // The pull is limited so a far goal is approached at the top speed, not jumped to.
  const reach = maxSpeed * time;
  const gap = Math.max(-reach, Math.min(reach, head - goal));
  const target = head - gap;
  const pull = (velocity + omega * gap) * dt;
  let v = (velocity - omega * pull) * decay;
  let next = target + (gap + pull) * decay;
  // Never past the goal: stop on it.
  if (goal - head > 0 === next > goal) return { head: goal, velocity: 0 };
  v = Math.max(-maxSpeed, Math.min(maxSpeed, v));
  if (Math.abs(goal - next) < 1e-4 && Math.abs(v) < 1e-2) {
    next = goal;
    v = 0;
  }
  return { head: next, velocity: v };
}

/** Seconds after the intro without any input before the camera drifts into the slow circuit. */
export const AMBIENT_IDLE_SECONDS = 5;
/** Seconds to ease from the gate shot into the circuit. */
export const AMBIENT_BLEND_SECONDS = 9;
