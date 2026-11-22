/**
 * Track S4's experiments (search: drawing each frame), as data, and the arithmetic on their
 * results. Plain Node, no browser, so it is unit tested (experiments.test.ts). run.mjs runs them
 * on the rig; probe.js applies them to the live scene.
 *
 * A variant is one change to the shipped scene. Its cost is read in one page load: the shipped
 * frame is timed, the change is made, and the changed frame is timed a few seconds later at the
 * same camera, level and pixel ratio (run.mjs `paired`). The difference of the two is the
 * measurement; the machine's load drifts between page loads (other sessions work on it), and a
 * pair is close enough in time for that to cancel. One change per measurement (rule 2 of the plan).
 */

/** Frames after the scene's first frame at which a change is made when nothing is being timed (look captures set their own). */
export const DPR_AT = 30;
export const MUTATE_AT = 60;
/** Ticks left for a change to settle (shader rebuilds, new render targets) before it is timed. */
export const SETTLE = 12;

/** The pixel ratio each quality level draws at (quality.ts). */
export const LEVEL_DPR = { 0: 1, 1: 1.25, 2: 1.5, 3: 1.75 };
/** Each tier's best level: where the reference frames are taken and where the knock-outs run. */
export const BEST_LEVEL = { high: 3, low: 1 };

const at = (frame, step) => ({ frame, ...step });
const hide = (match) => [at(MUTATE_AT, { do: "hide", match })];

/**
 * @typedef {{ frame: number, do: string, after?: number, match?: string, [key: string]: unknown }} Mutation
 * @typedef {{ note: string, mutations: Mutation[], tiers: string[], look: "same" | "close" | "breaks" }} Variant
 */

/**
 * Knock-outs. `tiers` says where a variant makes sense (the low tier has no shadows, ambient
 * occlusion or depth of field). `look` says what it does to the picture: "breaks" variants only
 * measure a cost; "same" and "close" variants are candidate fixes, checked by `run.mjs look`.
 */
/** @type {Record<string, Variant>} */
export const VARIANTS = {
  base: { note: "The shipped scene", mutations: [], tiers: ["high", "low"], look: "same" },

  // --- shadows
  "shadow-off": { note: "No sun shadow at all (no shadow pass, no shadow lookups)", mutations: [at(MUTATE_AT, { do: "shadow", cast: false })], tiers: ["high"], look: "breaks" },
  "shadow-frozen": { note: "Shadow map kept, not redrawn each frame", mutations: [at(MUTATE_AT, { do: "shadow", freeze: true })], tiers: ["high"], look: "close" },
  "shadow-2048": { note: "Shadow map 2048² instead of 4096²", mutations: [at(MUTATE_AT, { do: "shadow", size: 2048 })], tiers: ["high"], look: "close" },
  "shadow-1024": { note: "Shadow map 1024²", mutations: [at(MUTATE_AT, { do: "shadow", size: 1024 })], tiers: ["high"], look: "close" },
  "shadow-one-lookup": { note: "Baked surfaces look the shadow up once, not twice", mutations: [at(MUTATE_AT, { do: "singleShadowLookup" })], tiers: ["high"], look: "close" },

  // --- the effect chain (skipped passes leave stale buffers: cost only)
  "no-ao": { note: "Ambient occlusion passes not drawn (its two extra scene renders included)", mutations: [at(MUTATE_AT, { do: "skip", match: "^(scene\\+|ShaderMaterial#)" })], tiers: ["high"], look: "breaks" },
  "no-ao-rerenders": { note: "Ambient occlusion kept, its two extra scene renders not drawn", mutations: [at(MUTATE_AT, { do: "skip", match: "^scene\\+" })], tiers: ["high"], look: "close" },
  "level-2-chain": {
    note: "The level-2 chain at level 3's pixel ratio: no ambient occlusion and no extra copy to the screen",
    // The pixel ratio a few frames after the level: the level change sets its own ratio first.
    mutations: [at(MUTATE_AT, { do: "pinLevel", level: 2, step: 2 }), { ...at(MUTATE_AT, { do: "dpr", value: 1.75 }), after: 4 }],
    tiers: ["high"],
    look: "close",
  },
  "no-dof": { note: "Depth-of-field passes not drawn", mutations: [at(MUTATE_AT, { do: "skip", match: "CircleOfConfusion|KawaseBlur|MaskMaterial|Bokeh|^CopyMaterial@\\d" })], tiers: ["high"], look: "breaks" },
  "no-bloom": { note: "Bloom passes not drawn", mutations: [at(MUTATE_AT, { do: "skip", match: "Luminance|Downsampling|Upsampling" })], tiers: ["high", "low"], look: "breaks" },
  "no-smaa": { note: "SMAA edge and weight passes not drawn", mutations: [at(MUTATE_AT, { do: "skip", match: "EdgeDetection|SMAAWeights" })], tiers: ["high", "low"], look: "breaks" },

  // --- what is in the scene
  "no-vegetation": { note: "Plants hidden", mutations: hide("^vegetation$"), tiers: ["high", "low"], look: "breaks" },
  "no-buildings": { note: "The compound model hidden", mutations: hide("^architecture-model$"), tiers: ["high", "low"], look: "breaks" },
  "no-terrain": { note: "The land hidden", mutations: hide("^terrain$"), tiers: ["high", "low"], look: "breaks" },
  "no-water": { note: "Stream and pool hidden", mutations: hide("^(river|garden-pool)$"), tiers: ["high", "low"], look: "breaks" },
  "no-sky": { note: "Sky dome hidden", mutations: hide("^sky$"), tiers: ["high", "low"], look: "breaks" },
  "no-life": { note: "People, cars and birds hidden", mutations: hide("^life$"), tiers: ["high", "low"], look: "breaks" },
  "no-shafts": { note: "Light shafts hidden", mutations: hide("^god-rays$"), tiers: ["high", "low"], look: "breaks" },

  // --- surface shading
  "flat": { note: "Every surface one flat colour (no lighting, textures or fog)", mutations: [at(MUTATE_AT, { do: "flatShading" })], tiers: ["high", "low"], look: "breaks" },
  "no-environment": { note: "No sky light on surfaces (scene.environment off)", mutations: [at(MUTATE_AT, { do: "environment", on: false })], tiers: ["high", "low"], look: "close" },

  // --- draw order
  "sky-last": { note: "Sky dome drawn after the opaque scene, not before", mutations: [at(MUTATE_AT, { do: "renderOrder", match: "^sky$", value: 10 })], tiers: ["high", "low"], look: "same" },
  "ground-last": {
    note: "Sky, land and water drawn after buildings and plants",
    mutations: [at(MUTATE_AT, { do: "renderOrder", match: "^sky$", value: 10 }), at(MUTATE_AT, { do: "renderOrder", match: "^terrain$", value: 9 }), at(MUTATE_AT, { do: "renderOrder", match: "^(river|garden-pool)$", value: 8 })],
    tiers: ["high", "low"],
    look: "same",
  },
};

/**
 * Frames drawn back to back per tick while timing, so the GPU stays busy (probe.js `repeat`), and
 * how many ticks are timed. Six frames of 10 ms fill three 60 Hz periods with barely a gap.
 */
export const REPEAT = 6;
export const TICKS = 40;

/** The cameras knock-outs run at: a wide moving shot, the busiest stop, a close stop, the widest aerial. */
export const KNOCKOUT_SHOTS = ["opening", "stop-1", "stop-3", "aerial"];

/**
 * The probe configuration for a variant: its mutations on the frame asked for, and optionally a
 * pixel ratio other than the level's.
 *
 * @param {string} variantId
 * @param {{ at?: number, dpr?: number | null, sync?: boolean, repeat?: number, extra?: Record<string, unknown> }} [options]
 */
export function s4Config(variantId, { at: frame = MUTATE_AT, dpr = null, sync = true, repeat = 1, extra = {} } = {}) {
  const v = VARIANTS[variantId];
  if (!v) throw new Error(`unknown variant ${variantId}`);
  const mutations = v.mutations.map(({ after = 0, ...m }) => ({ ...m, frame: frame + after }));
  if (dpr !== null) mutations.push(at(DPR_AT, { do: "dpr", value: dpr }));
  return { sync, ...(repeat > 1 ? { repeat } : {}), mutations: mutations.sort((a, b) => a.frame - b.frame), ...extra };
}

// ---------------------------------------------------------------- statistics

const finite = (values) => values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);

export function quantile(values, q) {
  const v = finite(values);
  if (!v.length) return NaN;
  const i = (v.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}

/** One run's recorded frames to its numbers: the median frame, the spread, the JavaScript share. */
export function summarizeSync(frames) {
  const ms = frames.map((f) => f.ms);
  const js = frames.map((f) => f.jsMs);
  return { frames: frames.length, ms: quantile(ms, 0.5), p10: quantile(ms, 0.1), p90: quantile(ms, 0.9), max: finite(ms).at(-1) ?? NaN, jsMs: quantile(js, 0.5) };
}

/**
 * A paired run's frames to its two windows: before the change (`a`) and after it has settled (`b`).
 *
 * @template {{ frame: number }} T
 * @param {T[]} frames
 * @param {{ from: number, change: number, resume: number }} windows
 * @returns {{ a: T[], b: T[] }}
 */
export function splitWindows(frames, { from, change, resume }) {
  // The first two ticks of a window carry the start of recording.
  return { a: frames.filter((f) => f.frame > from + 1 && f.frame < change), b: frames.filter((f) => f.frame > resume + 1) };
}

/**
 * Pairs ({ a, b }: frame time before and after a change, one pair per page load) to what the
 * change saves. `noise` is the largest difference the same pairing shows when nothing is changed;
 * a saving is sure when every pair agrees on its sign and it is larger than that.
 */
export function pairStats(pairs, noise = 0) {
  const d = finite(pairs.map((p) => p.a - p.b));
  const saved = quantile(d, 0.5);
  const lo = d[0] ?? NaN;
  const hi = d.at(-1) ?? NaN;
  const ms = quantile(pairs.map((p) => p.a), 0.5);
  return { pairs: pairs.length, ms, after: quantile(pairs.map((p) => p.b), 0.5), saved, lo, hi, share: ms > 0 ? saved / ms : NaN, noise, sure: Math.sign(lo) === Math.sign(hi) && Math.abs(saved) > noise };
}

// ---------------------------------------------------------------- passes

/** The family a labelled render pass belongs to (labels are `<material or "scene">@<target>`, see probe.js). */
export function passFamily(label) {
  const name = label.replace(/^\d+\+?\s+/, "");
  if (name === "shadow") return "shadow map";
  if (name.startsWith("scene@")) return "scene";
  // n8ao draws the scene again (transparent objects only) and its own passes carry no material name.
  if (name.startsWith("scene+") || name.startsWith("ShaderMaterial#")) return "ambient occlusion";
  if (/Luminance|Downsampling|Upsampling/.test(name)) return "bloom";
  if (/Bokeh|CircleOfConfusion|MaskMaterial|KawaseBlur|^CopyMaterial@\d/.test(name)) return "depth of field";
  if (/EdgeDetection|SMAAWeights/.test(name)) return "SMAA";
  if (/^EffectMaterial/.test(name)) return "effects (merged)";
  if (name === "CopyMaterial@screen") return "final copy";
  return "other";
}

/** Per-pass totals (probe.js `passes`: label → { n, ms }) to per-family milliseconds per frame. */
export function familyTable(passes, frames) {
  const out = new Map();
  for (const [label, p] of Object.entries(passes)) {
    const family = passFamily(label);
    const e = out.get(family) || { family, passes: 0, ms: 0, targets: new Set() };
    e.passes += p.n / frames;
    e.ms += p.ms / frames;
    const target = label.split("@")[1];
    if (target) e.targets.add(target);
    out.set(family, e);
  }
  const total = [...out.values()].reduce((a, e) => a + e.ms, 0);
  return [...out.values()].map((e) => ({ ...e, targets: [...e.targets], share: total > 0 ? e.ms / total : NaN })).sort((a, b) => b.ms - a.ms);
}

// ---------------------------------------------------------------- images

/**
 * An RGBA image averaged over n × n blocks. The effect chain's film grain is per-pixel noise whose
 * pattern can differ between two captures of the same scene; block averages cancel it and keep
 * real changes, so a look comparison is given both ways (as track S3 does).
 */
export function blockAverage(img, n = 4) {
  const width = Math.floor(img.width / n);
  const height = Math.floor(img.height / n);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sum = [0, 0, 0, 0];
      for (let dy = 0; dy < n; dy++) {
        for (let dx = 0; dx < n; dx++) {
          const o = ((y * n + dy) * img.width + x * n + dx) * 4;
          for (let c = 0; c < 4; c++) sum[c] += img.data[o + c];
        }
      }
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) data[o + c] = Math.round(sum[c] / (n * n));
    }
  }
  return { width, height, data };
}

export const fmt = (n, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : "–");
export const pct = (n) => (Number.isFinite(n) ? `${(n * 100).toFixed(0)}%` : "–");
