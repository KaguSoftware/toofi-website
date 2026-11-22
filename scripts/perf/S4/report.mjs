#!/usr/bin/env node
/**
 * Track S4: turns a results folder (all.sh) into the Markdown tables of
 * docs/zaitun/perf/findings/S4.md, so every number in the findings can be regenerated.
 *
 *   node scripts/perf/S4/report.mjs [results-dir]
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mdTable } from "../lib.mjs";
import { VARIANTS, fmt, passFamily, pct, quantile } from "./experiments.mjs";

const mb = (bytes) => bytes / 2 ** 20;
const uniq = (list) => [...new Set(list)];

/** Variants down, cameras across: what each saves per frame (ms and share of the base frame). */
export function knockoutPivot(rows, { tier }) {
  const mine = rows.filter((r) => r.tier === tier);
  const shots = uniq(mine.map((r) => r.shot));
  const variants = uniq(mine.map((r) => r.variant));
  const cell = (variant, shot) => {
    const r = mine.find((x) => x.variant === variant && x.shot === shot);
    if (!r) return "";
    if (variant === "base") return `**${fmt(r.ms, 1)} ms** (±${fmt(r.noise, 1)})`;
    return r.sure ? `${fmt(r.saved, 1)} (${pct(r.share)})` : `~${fmt(r.saved, 1)}`;
  };
  return mdTable(variants, [["Change", (v) => v], ["What it is", (v) => VARIANTS[v]?.note ?? ""], ...shots.map((shot) => [shot, (v) => cell(v, shot)])]);
}

/**
 * Per-pass times carry the cost of the read-back that waits for the GPU. The smallest pass of a
 * run (a 10 × 6 pixel blur) is all read-back, so it is the floor taken off every pass.
 */
export function passFloor(passes) {
  const ms = passes.filter((p) => p.perFrame > 0.5 && p.ms > 0).map((p) => p.ms / p.perFrame);
  return ms.length ? Math.min(...ms) : 0;
}

/** One run's passes to families, read-back floor taken off: [{ family, ms, passes }], largest first. */
export function families(row) {
  const floor = passFloor(row.passes);
  const out = new Map();
  for (const p of row.passes) {
    const family = passFamily(p.label);
    const e = out.get(family) || { family, ms: 0, passes: 0 };
    e.ms += Math.max(0, p.ms - floor * p.perFrame);
    e.passes += p.perFrame;
    out.set(family, e);
  }
  const total = [...out.values()].reduce((a, e) => a + e.ms, 0);
  return { floor, total, families: [...out.values()].map((e) => ({ ...e, share: total > 0 ? e.ms / total : NaN })).sort((a, b) => b.ms - a.ms) };
}

const FAMILY_ORDER = ["scene", "shadow map", "ambient occlusion", "depth of field", "bloom", "SMAA", "effects (merged)", "final copy", "other"];

export function passTable(rows) {
  const data = rows.map((r) => ({ ...r, ...families(r) }));
  const present = FAMILY_ORDER.filter((f) => data.some((r) => r.families.some((x) => x.family === f)));
  return mdTable(data, [
    ["Tier", (r) => `${r.tier} L${r.level}`],
    ["Camera", (r) => r.shot],
    ["All passes (ms)", (r) => fmt(r.total, 1)],
    ...present.map((f) => [f, (r) => {
      const x = r.families.find((y) => y.family === f);
      return x ? `${fmt(x.ms, 1)} (${pct(x.share)})` : "";
    }]),
  ]);
}

/** The passes of one run, in draw order, with the floor taken off. */
export function passList(row) {
  const floor = passFloor(row.passes);
  return mdTable(
    row.passes.filter((p) => p.perFrame > 0.5),
    [
      ["#", (p) => p.label.split(" ")[0]],
      ["Pass → target", (p) => p.label.replace(/^\S+\s+/, "")],
      ["Family", (p) => passFamily(p.label)],
      ["ms", (p) => fmt(Math.max(0, p.ms / p.perFrame - floor), 2)],
    ],
  );
}

export function levelsTable(rows) {
  return mdTable(rows, [
    ["Tier", (r) => r.tier],
    ["Camera", (r) => r.shot],
    ["Level (chain)", (r) => r.level],
    ["Pixel ratio", (r) => r.dpr],
    ["Buffer", (r) => `${r.buffer} (${fmt(r.megapixels, 2)} MP)`],
    ["Passes", (r) => Math.round(r.passes)],
    ["Frame (ms)", (r) => fmt(r.ms, 1)],
    ["Against the best level", (r) => (Math.abs(r.difference) < 0.005 && r.lo === r.hi ? "–" : `${r.difference >= 0 ? "+" : ""}${fmt(r.difference, 1)} (${fmt(r.lo, 1)} to ${fmt(r.hi, 1)})`)],
  ]);
}

export function overdrawTable(rows) {
  return mdTable(rows, [
    ["Tier", (r) => r.tier],
    ["Camera", (r) => r.shot],
    ["Draw order", (r) => (r.order === "base" ? "shipped" : r.order)],
    ["Shaded, all", (r) => fmt(r.total, 2)],
    ["Opaque shaded", (r) => fmt(r.opaqueShaded, 2)],
    ["Opaque visible", (r) => fmt(r.opaqueVisible, 2)],
    ["Opaque wasted", (r) => fmt(r.opaqueShaded - r.opaqueVisible, 2)],
    ["Blended", (r) => fmt(r.transparentShaded, 2)],
  ]);
}

/** Where one camera's fragments go: materials that shade at least `min` screens. */
export function overdrawMaterials(row, min = 0.02) {
  const name = (m) => m.name || m.objects[0] || m.type;
  return mdTable(
    row.materials.filter((m) => m.shaded >= min).sort((a, b) => b.shaded - a.shaded),
    [
      ["Material", (m) => `${name(m)}${m.transparent ? " (blended)" : m.alphaTest ? " (cut-out)" : ""}`],
      ["Drawn", (m) => `#${m.index}`],
      ["Shaded", (m) => fmt(m.shaded, 2)],
      ["Visible", (m) => (m.visible === null ? "–" : fmt(m.visible, 2))],
      ["Wasted", (m) => (m.visible === null ? "–" : fmt(m.shaded - m.visible, 2))],
    ],
  );
}

/** The first frame per tier, median over fresh browsers. */
export function startupTable(rows) {
  const tiers = uniq(rows.map((r) => r.tier));
  const first = (r) => r.frames.find((f) => f.started === false || f.frame === 0) ?? r.frames[0];
  const med = (list) => quantile(list, 0.5);
  return mdTable(tiers, [
    ["Tier", (t) => t],
    ["Runs", (t) => rows.filter((r) => r.tier === t).length],
    ["First frame to GPU done", (t) => `${fmt(med(rows.filter((r) => r.tier === t).map((r) => first(r).ms)), 0)} ms`],
    ["Waiting on shader programs", (t) => `${fmt(med(rows.filter((r) => r.tier === t).map((r) => first(r).kinds.program?.ms ?? 0)), 0)} ms`],
    ["Programs built", (t) => fmt(med(rows.filter((r) => r.tier === t).map((r) => first(r).programs)), 0)],
    ["Texture calls", (t) => `${fmt(med(rows.filter((r) => r.tier === t).map((r) => first(r).kinds.texture?.ms ?? 0)), 0)} ms`],
    ["Buffer uploads", (t) => `${fmt(med(rows.filter((r) => r.tier === t).map((r) => first(r).kinds.buffer?.ms ?? 0)), 0)} ms`],
    ["Second frame", (t) => `${fmt(med(rows.filter((r) => r.tier === t).map((r) => r.frames[r.frames.indexOf(first(r)) + 1]?.ms ?? NaN)), 0)} ms`],
  ]);
}

/** Each candidate against the shipped picture: the worst camera decides. */
export function lookTable(rows) {
  const variants = uniq(rows.filter((r) => r.against === "base").map((r) => r.variant));
  const tiers = uniq(rows.map((r) => r.tier));
  const out = [];
  for (const tier of tiers) {
    for (const variant of variants) {
      const mine = rows.filter((r) => r.tier === tier && r.variant === variant && r.against === "base");
      if (!mine.length) continue;
      const worst = mine.reduce((a, r) => (r.mean > a.mean ? r : a));
      const smooth = mine.reduce((a, r) => ((r.grainFree ?? 0) > (a.grainFree ?? 0) ? r : a));
      out.push({ tier, variant, cameras: mine.length, mean: worst.mean, at: worst.shot, grainFree: smooth.grainFree ?? NaN, grainFreeAt: smooth.shot, pixel: Math.max(...mine.map((r) => r.grainFreeWorst ?? r.worst)), changed: Math.max(...mine.map((r) => r.grainFreeChanged ?? r.changedShare)) });
    }
  }
  return mdTable(out, [
    ["Tier", (r) => r.tier],
    ["Change", (r) => (r.variant === "base" ? "none (captured twice)" : r.variant)],
    ["Cameras", (r) => r.cameras],
    ["Largest mean difference", (r) => `${r.mean.toFixed(2)}/255 (${r.at})`],
    ["Grain cancelled (4 × 4 blocks)", (r) => (Number.isFinite(r.grainFree) ? `${r.grainFree.toFixed(2)}/255 (${r.grainFreeAt})` : "–")],
    ["Worst block", (r) => r.pixel],
    ["Blocks moved by more than 16", (r) => `${(r.changed * 100).toFixed(2)}%`],
    ["Gate (2/255)", (r) => (r.mean <= 2 ? "passes" : "fails")],
  ]);
}

export function memoryTable(describe) {
  const rows = Object.entries(describe).map(([key, d]) => {
    const g = d.memory.groups;
    const sum = (test) => g.filter(test).reduce((a, x) => a + x.bytes, 0);
    const [w, h] = d.describe.renderer.buffer.split("x").map(Number);
    const screen = (x) => x.w === w && x.h === h;
    return {
      key,
      buffer: d.describe.renderer.buffer,
      total: d.memory.total,
      shadow: sum((x) => x.w === 4096 && x.h === 4096),
      full: sum((x) => screen(x)),
      fullCount: g.filter(screen).reduce((a, x) => a + x.count, 0),
      partial: sum((x) => !x.compressed && !screen(x) && x.w !== 4096 && /RGBA16F|RGBA8|R32F|DEPTH|SRGB8_A8/.test(x.format) && !/mips/.test(x.key)),
      model: sum((x) => x.compressed),
    };
  });
  return mdTable(rows, [
    ["Tier and level", (r) => r.key],
    ["Buffer", (r) => r.buffer],
    ["All textures", (r) => `${fmt(mb(r.total), 0)} MB`],
    ["Shadow map (4096²)", (r) => (r.shadow ? `${fmt(mb(r.shadow), 0)} MB` : "–")],
    ["Full-size targets", (r) => `${fmt(mb(r.full), 0)} MB in ${r.fullCount}`],
    ["Smaller targets", (r) => `${fmt(mb(r.partial), 0)} MB`],
    ["Model and lightmap textures (compressed)", (r) => `${fmt(mb(r.model), 0)} MB`],
  ]);
}

const load = (dir, name) => (existsSync(join(dir, `${name}.json`)) ? JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) : null);

function main() {
  const dir = process.argv[2] ?? join("scripts", "perf", "results", "S4");
  const section = (title, body) => body && console.log(`\n## ${title}\n\n${body}`);
  const ao = (load(dir, "knockouts-ao")?.rows ?? []).filter((r) => r.variant !== "base");
  const k = [...["knockouts-high", "knockouts-high-dusk"].flatMap((n) => load(dir, n)?.rows ?? []), ...ao];
  if (k.length) section("Knock-outs, high tier (level 3)", knockoutPivot(k, { tier: "high" }));
  const kl = load(dir, "knockouts-low")?.rows;
  if (kl) section("Knock-outs, low tier (level 1)", knockoutPivot(kl, { tier: "low" }));
  for (const n of ["passes-high", "passes-high-l12", "passes-low", "passes-low-l0"]) {
    const p = load(dir, n)?.rows;
    if (!p) continue;
    section(`Passes: ${n}`, passTable(p));
    const one = p.find((r) => r.shot === "stop-1");
    if (one) section(`Pass list, ${one.tier} L${one.level}, stop-1 (read-back floor ${fmt(passFloor(one.passes), 2)} ms taken off)`, passList(one));
  }
  const lv = load(dir, "levels")?.rows;
  if (lv) section("Levels and pixel ratios", levelsTable(lv));
  // Later files replace earlier rows for the same tier, camera and order (a camera counted again).
  const counted = new Map();
  for (const name of ["overdraw", "overdraw-reordered", "overdraw-explorer"]) for (const r of load(dir, name)?.rows ?? []) counted.set(`${r.tier}/${r.shot}/${r.order}`, r);
  const od = [...counted.values()];
  if (od.length) {
    section("Overdraw (screens of fragments)", overdrawTable(od.sort((a, b) => a.tier.localeCompare(b.tier) || a.shot.localeCompare(b.shot) || a.order.localeCompare(b.order))));
    for (const tier of ["high", "low"]) for (const shot of ["opening", "stop-1", "stop-3", "aerial"]) {
      const r = od.find((x) => x.tier === tier && x.shot === shot && x.order === "base");
      if (r) section(`Overdraw by material, ${tier}, ${shot}`, overdrawMaterials(r));
    }
  }
  const st = load(dir, "startup")?.rows;
  if (st) section("First frame", startupTable(st));
  const lk = [...(load(dir, "look")?.rows ?? []), ...(load(dir, "look-ao")?.rows ?? []).filter((r) => r.variant !== "base")];
  if (lk.length) section("Look of candidate fixes", lookTable(lk));
  const d = load(dir, "describe");
  if (d) section("Texture memory", memoryTable(d));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
