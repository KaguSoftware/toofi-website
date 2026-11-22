/**
 * Track S5's cameras: the rig's fixed cameras (../shots.mjs) where they fit, plus the moments
 * where JavaScript does the most per frame: a slow scroll through the whole tour, a flung scroll,
 * the idle circuit at the top, a long orbit drag and a long walk with a turn. Same step format as
 * the rig's plans; frames count from the scene's first frame.
 *
 * Scroll positions depend on the page, so `sweep` steps carry a fraction of the way from the top
 * to the last beat, which planS5() resolves once the page is laid out.
 */
import { SHOTS } from "../shots.mjs";

const EXPLORE = ".xp__explore";
const RESET = '.xp__hud[data-hud="explore"] .xp__group--column button:last-child';
const WALK = '.xp__hud[data-hud="explore"] .xp__modes button:nth-child(2)';

const at = (frame, step) => ({ frame, ...step });

function drag(from, frames, dx, dy = 0) {
  const steps = [at(from, { do: "pointer", type: "pointerdown", x: 0.5, y: 0.5 })];
  for (let i = 1; i <= frames; i++) steps.push(at(from + i, { do: "pointer", type: "pointermove", x: 0.5 + (dx * i) / frames, y: 0.5 + (dy * i) / frames }));
  steps.push(at(from + frames + 1, { do: "pointer", type: "pointerup", x: 0.5 + dx, y: 0.5 + dy }));
  return steps;
}

/** A slow scroll from the top to the last beat: one step per frame. */
function sweep(from, frames) {
  const steps = [];
  for (let i = 0; i <= frames; i++) steps.push(at(from + i, { do: "sweep", fraction: i / frames }));
  return steps;
}

export const S5_SHOTS = {
  "stop-2": { ...SHOTS["stop-2"], note: "Tour stop 2 held still: the cost of a frame where only the clocks move" },
  opening: { ...SHOTS.opening, note: "The opening playing by the clock: the camera flies, the plants are re-sorted" },
  "scroll-sweep": {
    note: "A slow scroll from the top to the last beat over 6 s (the story driver, the captions, the plants)",
    steps: sweep(200, 360),
    record: [200, 620],
  },
  fling: {
    note: "A flung scroll: the page jumps to the last beat and the camera glides after it",
    steps: [at(200, { do: "scrollToBeat", beat: 5 })],
    record: [190, 340],
  },
  circuit: {
    note: "No input at the top: after the opening and 5 s of waiting, the slow circuit over the site",
    steps: [],
    record: [1160, 1400],
  },
  "orbit-drag": {
    note: "Explore, Reset, then a 2 s drag across 60% of the screen",
    steps: [at(5, { do: "click", selector: EXPLORE }), at(30, { do: "click", selector: RESET }), ...drag(240, 120, 0.6)],
    record: [240, 420],
  },
  "walk-long": {
    note: "Explore, Walk, W held 5 s with a turn (drag) in the middle",
    steps: [
      at(5, { do: "click", selector: EXPLORE }),
      at(30, { do: "click", selector: WALK }),
      at(200, { do: "key", type: "keydown", code: "KeyW" }),
      ...drag(300, 60, -0.25),
      at(500, { do: "key", type: "keyup", code: "KeyW" }),
    ],
    record: [200, 520],
  },
  "explore-idle": {
    note: "Explore, Reset, then nothing: the aerial held",
    steps: [at(5, { do: "click", selector: EXPLORE }), at(30, { do: "click", selector: RESET })],
    record: [260, 440],
  },
};

export const S5_SHOT_NAMES = Object.keys(S5_SHOTS);

/**
 * The probe's plan for one shot. `scrollRange` ({ top, bottom } in page pixels) resolves sweep
 * steps into plain scrollTo steps; `level` pins a quality level on frame 1.
 *
 * @param {string} name
 * @param {{ level?: number | null, scrollRange?: { top: number, bottom: number } | null }} [options]
 * @returns {{ steps: Array<{ frame: number, do: string, [key: string]: unknown }>, lastFrame: number, needsScroll: boolean }}
 */
export function planS5(name, { level = null, scrollRange = null } = {}) {
  const shot = S5_SHOTS[name];
  if (!shot) throw new Error(`unknown S5 shot ${name}`);
  const steps = shot.steps.map((s) => {
    if (s.do !== "sweep") return s;
    if (!scrollRange) throw new Error(`${name} needs the page's scroll range`);
    return { frame: s.frame, do: "scrollTo", y: Math.round(scrollRange.top + (scrollRange.bottom - scrollRange.top) * s.fraction) };
  });
  if (level !== null) steps.push(at(1, { do: "pin", level }));
  steps.push(at(shot.record[0], { do: "record", on: true }), at(shot.record[1], { do: "record", on: false }));
  steps.sort((a, b) => a.frame - b.frame);
  return { steps, lastFrame: Math.max(shot.record[1], ...steps.map((s) => s.frame)) + 2, needsScroll: shot.steps.some((s) => s.do === "sweep") };
}
