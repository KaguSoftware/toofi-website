/**
 * Names for what S5's probe (probe-s5.js) measures in the minified production build, plus the
 * summaries the S5 scripts print. Pure functions, tested in labels.test.ts.
 */
import { median, percentile } from "../lib.mjs";

const has = (list, ...keys) => keys.every((k) => list.includes(k));

/**
 * Which component owns a useFrame subscriber, from what the probe could see of it: the owner's
 * prop names, the keys of its memoised values, and the subscriber's priority. Component names
 * are minified in production, so props are the fingerprint. Rules follow the source:
 * ExperienceRoot.tsx (RenderPass), StoryRig.tsx, PostFX.tsx, ExperienceWorld.tsx (shafts clock,
 * Daylighting), SceneWorld.tsx (Sky, Water, InstanceCulling), SceneVegetation.tsx,
 * SceneLife.tsx and drei's PerformanceMonitor.
 */
export function labelSubscriber(desc) {
  if (!desc) return "unknown";
  const p = desc.props ?? [];
  const memo = (desc.memoKeys ?? []).join(" ");
  if (has(p, "composer", "onFirstFrame")) return "RenderPass: draw (composer)";
  if (has(p, "scroll", "input", "rig", "mode")) return "StoryRig: camera";
  if (has(p, "settings", "rig", "composerRef")) return "PostFX: lens and vignette";
  if (has(p, "model", "margin")) return "InstanceCulling: buildings";
  if (has(p, "daylight", "shafts")) return "Daylighting: handover and dusk";
  if (has(p, "plantingFallback", "godRays")) return "ExperienceWorld: light-shaft clock";
  if (has(p, "bounds", "flipflops")) return "PerformanceMonitor (drei)";
  if (has(p, "library", "tier")) {
    if (desc.priority === 0.5 || /objects/.test(memo)) return "SceneVegetation: wind and sort";
    if (/movers|figures/.test(memo) || desc.priority === 0) return "SceneLife: people, cars, birds";
  }
  if (has(p, "variant", "tier") || has(p, "variant")) {
    if (/river/.test(memo)) return "Water: clock";
    if (/mesh/.test(memo)) return "Sky: clock";
  }
  if (desc.src && /movers/.test(desc.src)) return "SceneLife: people, cars, birds";
  return `unlabelled (priority ${desc.priority}; props ${p.slice(0, 5).join(",") || "none"})`;
}

/** Per-subscriber cost over the recorded frames: median and p95 ms per frame, and its share. */
export function subscriberTable(snapshot) {
  const frames = snapshot.frames ?? [];
  const subs = snapshot.subs ?? [];
  const rows = subs.map((s) => {
    const per = frames.map((f) => f.subs?.[s.id] ?? 0);
    return { id: s.id, label: labelSubscriber(s.desc), priority: s.priority, median: median(per), p95: percentile(per, 95), max: per.length ? Math.max(...per) : null, mean: per.length ? per.reduce((a, b) => a + b, 0) / per.length : null };
  });
  const cb = frames.map((f) => f.cb);
  const subsTotal = frames.map((f) => (f.subs ?? []).reduce((a, b) => a + (b ?? 0), 0));
  const outside = frames.map((f, i) => f.cb - subsTotal[i]);
  // Merge duplicates (a component mounted twice, or a remount during the run).
  const merged = new Map();
  for (const r of rows) {
    const m = merged.get(r.label);
    if (!m) merged.set(r.label, { ...r });
    else {
      m.mean = (m.mean ?? 0) + (r.mean ?? 0);
      m.median = (m.median ?? 0) + (r.median ?? 0);
      m.p95 = (m.p95 ?? 0) + (r.p95 ?? 0);
      m.max = Math.max(m.max ?? 0, r.max ?? 0);
    }
  }
  const total = median(cb);
  const other = frames.map((f) => f.other ?? 0);
  const up = frames.filter((f) => f.uploads);
  const bufferBytes = up.map((f) => f.uploads.buffer);
  const textureBytes = up.map((f) => f.uploads.texture);
  return {
    frames: frames.length,
    callback: { median: total, p95: percentile(cb, 95), max: cb.length ? Math.max(...cb) : null },
    outsideSubscribers: { median: median(outside), p95: percentile(outside, 95) },
    otherCallbacks: { median: median(other), p95: percentile(other, 95) },
    uploads: {
      bufferMedian: median(bufferBytes),
      bufferMean: bufferBytes.length ? bufferBytes.reduce((a, b) => a + b, 0) / bufferBytes.length : null,
      textureMedian: median(textureBytes),
      textureMean: textureBytes.length ? textureBytes.reduce((a, b) => a + b, 0) / textureBytes.length : null,
      max: up.length ? Math.max(...up.map((f) => f.uploads.buffer + f.uploads.texture)) : null,
    },
    rows: [...merged.values()].sort((a, b) => (b.mean ?? 0) - (a.mean ?? 0)),
  };
}

/** Commits per second by renderer over the recorded window, and the components that rendered most. */
export function commitSummary(snapshot, seconds) {
  const by = {};
  const names = {};
  for (const c of snapshot.commits ?? []) {
    const key = c.renderer === "@react-three/fiber" ? "r3f" : "dom";
    by[key] = (by[key] ?? 0) + 1;
    for (const [n, k] of Object.entries(c.names ?? {})) names[`${key}:${n}`] = (names[`${key}:${n}`] ?? 0) + k;
  }
  const top = Object.entries(names)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, renders]) => ({ name, renders }));
  return {
    dom: by.dom ?? 0,
    r3f: by.r3f ?? 0,
    domPerSecond: seconds > 0 ? (by.dom ?? 0) / seconds : null,
    r3fPerSecond: seconds > 0 ? (by.r3f ?? 0) / seconds : null,
    top,
  };
}

/**
 * The frames over a budget and what each held: interval, callback time, the biggest subscriber,
 * any commit in the same frame. For finding the cause of a hitch.
 */
export function longFrames(snapshot, rigFrames, budgetMs = 20) {
  const byFrame = new Map((snapshot.frames ?? []).map((f) => [f.frame, f]));
  const commitsAt = new Map();
  for (const c of snapshot.commits ?? []) commitsAt.set(c.frame, (commitsAt.get(c.frame) ?? 0) + 1);
  const labels = new Map((snapshot.subs ?? []).map((s) => [s.id, labelSubscriber(s.desc)]));
  const out = [];
  const list = rigFrames ?? [];
  for (const [i, f] of list.entries()) {
    if (f.interval == null || f.interval <= budgetMs) continue;
    const mine = byFrame.get(f.frame);
    let top = null;
    if (mine) {
      for (const [id, ms] of (mine.subs ?? []).entries()) if (ms != null && (!top || ms > top.ms)) top = { label: labels.get(id), ms };
    }
    // A change in render passes per frame within two frames is a quality level change (a new effect chain).
    const near = list.slice(Math.max(0, i - 2), i + 1).map((x) => x.passes);
    const levelChange = near.some((p) => p !== f.passes);
    out.push({ frame: f.frame, interval: f.interval, cpuMs: f.cpuMs ?? null, renderMs: f.renderMs ?? null, passes: f.passes, levelChange, dpr: f.dpr, callback: mine?.cb ?? null, other: mine?.other ?? null, top, commits: commitsAt.get(f.frame) ?? 0 });
  }
  return out;
}

/** Frames where the render passes per frame change: the quality level moved (frame, from, to). */
export function levelChanges(rigFrames) {
  const out = [];
  let prev = null;
  for (const f of rigFrames ?? []) {
    if (prev !== null && f.passes !== prev) out.push({ frame: f.frame, from: prev, to: f.passes });
    prev = f.passes;
  }
  return out;
}
