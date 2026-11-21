/**
 * The fixed cameras every frame measurement and reference frame uses. Each shot is a fresh
 * load of Home and a frame-exact plan the probe runs from the scene's first frame (frame 0):
 * actions, a recording window for timing, and the frame to capture for the look gate.
 *
 * Frames are counted at 60 per second of virtual time when capturing. While timing they are
 * real frames, so a step lands at the same point of the story either way.
 */

const EXPLORE = ".xp__explore";
const RESET = '.xp__hud[data-hud="explore"] .xp__group--column button:last-child';
const WALK = '.xp__hud[data-hud="explore"] .xp__modes button:nth-child(2)';
// The ambience group (dusk, sound) follows the pause group in the story HUD.
const DUSK = '.xp__hud[data-hud="story"] .xp__tools > .xp__group:nth-child(2) > button:first-child';

const at = (frame, step) => ({ frame, ...step });

function stop(beat) {
  return {
    note: `Tour stop ${beat}, held: the stop's panel scrolled to the top of the screen`,
    steps: [at(5, { do: "scrollToBeat", beat })],
    record: [220, 400],
    capture: 330,
  };
}

/** Pointer drag across the canvas, one move per frame. */
function drag(from, frames, dx) {
  const steps = [at(from, { do: "pointer", type: "pointerdown", x: 0.5, y: 0.5 })];
  for (let i = 1; i <= frames; i++) steps.push(at(from + i, { do: "pointer", type: "pointermove", x: 0.5 + (dx * i) / frames, y: 0.5 }));
  steps.push(at(from + frames + 1, { do: "pointer", type: "pointerup", x: 0.5 + dx, y: 0.5 }));
  return steps;
}

export const SHOTS = {
  "poster-hold": {
    note: "The first frames: the poster frame held still for 2 s before the opening plays",
    steps: [],
    record: [0, 110],
    capture: 60,
  },
  opening: {
    note: "The opening shot playing by the clock under the letterbox (2 s hold, then about 12 s)",
    steps: [],
    record: [130, 840],
    capture: 480,
  },
  "stop-1": stop(1),
  "stop-2": stop(2),
  "stop-3": stop(3),
  "stop-4": stop(4),
  "stop-5": stop(5),
  aerial: {
    note: "Explore, then Reset: the explorer's aerial over the whole plan (the widest shot)",
    steps: [at(5, { do: "click", selector: EXPLORE }), at(30, { do: "click", selector: RESET })],
    record: [260, 440],
    capture: 330,
  },
  orbit: {
    note: "The aerial, then a drag across 30% of the screen and the controls settling",
    steps: [at(5, { do: "click", selector: EXPLORE }), at(30, { do: "click", selector: RESET }), ...drag(240, 40, 0.3)],
    record: [240, 420],
    capture: 520,
  },
  walk: {
    note: "Explore, Walk, then W held for 2 s along the path the walk starts on",
    steps: [
      at(5, { do: "click", selector: EXPLORE }),
      at(30, { do: "click", selector: WALK }),
      at(200, { do: "key", type: "keydown", code: "KeyW" }),
      at(320, { do: "key", type: "keyup", code: "KeyW" }),
    ],
    record: [200, 330],
    capture: 380,
  },
  dusk: {
    note: "Tour stop 2 (the boulevard) at dusk, after the 5 s blend",
    steps: [at(5, { do: "scrollToBeat", beat: 2 }), at(60, { do: "click", selector: DUSK })],
    record: [420, 600],
    capture: 480,
  },
};

export const SHOT_NAMES = Object.keys(SHOTS);

/** Quality levels per tier (quality.ts QUALITY_RANGE). */
export const LEVELS = { high: [1, 2, 3], low: [0, 1] };
/** The level reference frames are taken at: each tier's best. */
export const REFERENCE_LEVEL = { high: 3, low: 1 };

/**
 * The probe's plan for one shot: optional level pin on frame 1, the shot's steps, a recording
 * window (timing) and/or a capture (reference frames).
 *
 * @param {string} name
 * @param {{ level?: number | null, record?: boolean, capture?: boolean, width?: number }} [options]
 */
export function planFor(name, { level = null, record = true, capture = false, width = 960 } = {}) {
  const shot = SHOTS[name];
  if (!shot) throw new Error(`unknown shot ${name}`);
  const steps = [...shot.steps];
  if (level !== null) steps.push(at(1, { do: "pin", level }));
  if (record) steps.push(at(shot.record[0], { do: "record", on: true }), at(shot.record[1], { do: "record", on: false }));
  if (capture) steps.push(at(shot.capture, { do: "capture", name, width }));
  steps.sort((a, b) => a.frame - b.frame);
  const last = Math.max(record ? shot.record[1] : 0, capture ? shot.capture : 0, ...steps.map((s) => s.frame));
  return { steps, lastFrame: last + 2 };
}
