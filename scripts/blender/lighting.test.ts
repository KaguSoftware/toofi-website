import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Checks the Zaitun Hills lighting (scripts/blender/lighting.py, track 4) through what it writes:
 *   scripts/blender/lighting.report.json             sun, north, rigs, pages, seams, validation
 *   public/sawad/lightmaps/zaitun/lightmaps.json     what the web scene reads
 *   public/sawad/lightmaps/zaitun/*.png              the lightmap pages
 * Regenerate with scripts/blender/bake-lightmaps.sh.
 */

type Seams = { samples: number; mean: number; p95: number; over10pct: number };
type StateReport = {
  world: { strength: number; irradianceUp: number };
  intensity: number;
  seams: Seams;
  meanIrradiance: Record<Page, number>;
};
type Validation = { shot: string; key: number; state: State; relativeError: number; medianLogRatio: number };
type TierReport = {
  pages: Record<Page, { size: [number, number]; texelMetres: number; coverage: number }>;
  densityPxPerMetre: number;
  tiles: number;
  instances: string[];
  states: Record<State, StateReport>;
  duskLights: Record<string, number>;
  validation: Validation[];
};
type Report = {
  source: string;
  north: { three: number[]; given: string };
  sun: { direction: number[]; lightDirection: number[]; bearingDeg: number; elevationDeg: number; lightElevationDeg: number; color: string; intensity: number };
  qibla: { bearingDeg: number; direction: number[] };
  hemi: { sky: string; ground: string; intensity: number };
  haze: { color: string; density: number };
  skyDay: Record<string, [string, number] | unknown>;
  tiers: Record<Tier, TierReport>;
};
type Instance = { page: Page; scaleOffset: [number, number, number, number]; position: number[]; rotationY: number; windowsLit: boolean };
type Manifest = {
  version: number;
  plan: string;
  uv: { attribute: string; gltf: string; flipY: boolean };
  encoding: { colorSpace: string };
  states: Record<State, { intensity: number }>;
  tiers: Record<Tier, { pages: Record<Page, { size: [number, number]; files: Record<State, string>; projection?: { axes: string; bounds: Record<string, number> } }>; instances: Record<string, Instance> }>;
};
type Page = "buildings" | "site" | "ground";
type State = "day" | "dusk";
type Tier = "high" | "low";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string) => readFileSync(here(p), "utf8");
const report: Report = JSON.parse(read("./lighting.report.json"));
const manifest: Manifest = JSON.parse(read("../../public/sawad/lightmaps/zaitun/lightmaps.json"));
const layout = JSON.parse(read("./layout.json"));
const plan = layout.masterplan;
const world = read("../../components/sawad/scene/world.ts");

const TIERS: Tier[] = ["high", "low"];
const STATES: State[] = ["day", "dusk"];
const PAGES: Page[] = ["buildings", "site", "ground"];
const HIGH_PAGES: Record<Page, [number, number]> = { buildings: [2048, 2048], site: [1024, 1024], ground: [2048, 1024] };

/** First capture of the first pattern that matches (world.ts before and after the R3F port). */
function pick(src: string, patterns: RegExp[]): string {
  for (const p of patterns) {
    const m = src.match(p);
    if (m) return m[1];
  }
  throw new Error(`none of ${patterns.join(", ")} in world.ts`);
}

function pngSize(path: string): [number, number] {
  const b = readFileSync(path);
  expect(b.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

/** Compass bearing of a three.js direction with +z north and +x west (owner, 2026-11-19). */
const bearing = (x: number, z: number) => ((Math.atan2(-x, z) * 180) / Math.PI + 360) % 360;

describe("Zaitun lighting (scripts/blender/lighting.py)", () => {
  it("the report comes from the current lighting.py, with both tiers", () => {
    expect(report.source).toBe(createHash("sha256").update(readFileSync(here("./lighting.py"))).digest("hex"));
    expect(Object.keys(report.tiers).sort()).toEqual(["high", "low"]);
    expect(Object.keys(manifest.tiers).sort()).toEqual(["high", "low"]);
  });

  it("lights with the web scene's sun, hemisphere, haze and sky (world.ts)", () => {
    const [el, ax, az] = world.match(/zaitun:\s*\{\s*elevationDeg:\s*([\d.]+),\s*azimuthX:\s*([\d.]+),\s*azimuthZ:\s*([\d.]+)/)!.slice(1).map(Number);
    const lift = Number(pick(world, [/LIGHT_LIFT_DEG\s*=\s*([\d.]+)/]));
    expect(report.sun.elevationDeg).toBe(el);
    expect(report.sun.lightElevationDeg).toBeCloseTo(el + lift, 6);
    const n = Math.hypot(ax, az);
    const [x, , z] = report.sun.direction;
    expect(x / Math.hypot(x, z)).toBeCloseTo(ax / n, 4);
    expect(z / Math.hypot(x, z)).toBeCloseTo(az / n, 4);
    expect(report.sun.color).toBe(pick(world, [/DirectionalLight\(new Color\("(#[0-9a-f]{6})"\)/, /SUN_LIGHT = \{\s*color: "(#[0-9a-f]{6})"/]));
    expect(report.sun.intensity).toBe(Number(pick(world, [/DirectionalLight\(new Color\("#[0-9a-f]{6}"\), ([\d.]+)\)/, /SUN_LIGHT = \{\s*color: "#[0-9a-f]{6}",\s*intensity: ([\d.]+)/])));
    expect(report.hemi).toEqual({
      sky: pick(world, [/HemisphereLight\(new Color\("(#[0-9a-f]{6})"\)/, /HEMISPHERE_LIGHT = \{ sky: "(#[0-9a-f]{6})"/]),
      ground: pick(world, [/HemisphereLight\(new Color\("#[0-9a-f]{6}"\), new Color\("(#[0-9a-f]{6})"\)/, /HEMISPHERE_LIGHT = \{ sky: "#[0-9a-f]{6}", ground: "(#[0-9a-f]{6})"/]),
      intensity: Number(pick(world, [/HemisphereLight\([^)]*\), new Color\("#[0-9a-f]{6}"\), ([\d.]+)\)/, /HEMISPHERE_LIGHT = \{[^}]*intensity: ([\d.]+)/])),
    });
    expect(report.haze.color).toBe(pick(world, [/HAZE = new Color\("(#[0-9a-f]{6})"\)/, /HAZE_COLOR = "(#[0-9a-f]{6})"/]));
    expect(report.haze.density).toBe(Number(pick(world, [/"shatt" \? [\d.]+ : ([\d.]+)/])));
    for (const [key, uniform] of [["zenith", "uZenith"], ["horizonAway", "uHorizonAway"], ["horizonSun", "uHorizonSun"], ["ground", "uGround"]] as const) {
      const hex = pick(world, [new RegExp(`${key}: new Color\\("(#[0-9a-f]{6})"\\)`)]);
      const mult = Number(pick(world, [new RegExp(`${uniform}: \\{ value: SKY\\.${key}\\.clone\\(\\)\\.multiplyScalar\\(([\\d.]+)\\)`)]));
      expect(report.skyDay[key], key).toEqual([hex, mult]);
    }
  });

  it("orients the sun to the owner's north: an evening sun just north of west", () => {
    expect(report.north.three).toEqual([0, 0, 1]);
    const [x, , z] = report.sun.direction;
    expect(report.sun.bearingDeg).toBeCloseTo(bearing(x, z), 1);
    expect(report.sun.bearingDeg).toBeGreaterThan(270);
    expect(report.sun.bearingDeg).toBeLessThan(290);
    // The qibla for the mosque (track 0/1B): Erbil to Mecca, a little west of south.
    expect(report.qibla.bearingDeg).toBeGreaterThan(190);
    expect(report.qibla.bearingDeg).toBeLessThan(205);
    const [qx, , qz] = report.qibla.direction;
    expect(bearing(qx, qz)).toBeCloseTo(report.qibla.bearingDeg, 1);
  });

  it("the day sky lights open ground like the web scene's hemisphere light", () => {
    const lin = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const [r, g, b] = lin(report.hemi.sky).map((c) => c * report.hemi.intensity);
    const target = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    for (const tier of TIERS) expect(report.tiers[tier].states.day.world.irradianceUp).toBeCloseTo(target, 2);
  });

  it.each(TIERS)("the %s tier bakes every page at its size, and the files are there", (tier) => {
    const div = tier === "high" ? 1 : 2;
    const pages = manifest.tiers[tier].pages;
    for (const page of PAGES) {
      const size: [number, number] = [HIGH_PAGES[page][0] / div, HIGH_PAGES[page][1] / div];
      expect(report.tiers[tier].pages[page].size, page).toEqual(size);
      expect(pages[page].size, page).toEqual(size);
      for (const state of STATES) {
        const file = here(`../../public/sawad/lightmaps/zaitun/${pages[page].files[state]}`);
        expect(existsSync(file), file).toBe(true);
        expect(pngSize(file), file).toEqual(size);
      }
    }
    expect(pages.ground.projection?.axes).toBe("xz");
  });

  it("the manifest tells the web how to read the maps", () => {
    expect(manifest).toMatchObject({ version: 1, plan: "zaitun", uv: { attribute: "uv2", gltf: "TEXCOORD_2", flipY: false }, encoding: { colorSpace: "srgb" } });
    for (const state of STATES) {
      expect(manifest.states[state].intensity).toBeGreaterThan(0);
      for (const tier of TIERS) expect(report.tiers[tier].states[state].intensity).toBeGreaterThan(0);
    }
  });

  it.each(TIERS)("every placed building on the %s tier has its own tile, inside the page and not overlapping", (tier) => {
    const inst = manifest.tiers[tier].instances;
    const expected = [
      ...plan.villas.map((v: { index: number; type: string }) => `villa-${String(v.index).padStart(2, "0")}-${v.type}`),
      ...plan.villas.map((v: { index: number }) => `carport-${String(v.index).padStart(2, "0")}`),
      ...plan.apartments.map((b: { index: number }) => `apartment-${b.index}`),
      ...plan.parking.map((p: { id: string }) => `parking-${p.id}`),
      "gym",
      "padel-1",
      "padel-2",
      "tennis",
      "playground",
      "mosque",
      "gallery-courtyard",
    ];
    for (const name of expected) expect(inst[name]?.page, name).toBe("buildings");
    expect(inst.site.page).toBe("site");
    expect(inst.garden.page).toBe("site");
    expect(report.tiers[tier].tiles).toBe(expected.length);
    const [w, h] = manifest.tiers[tier].pages.buildings.size;
    const rects = expected.map((name) => {
      const [sx, sy, ox, oy] = inst[name].scaleOffset;
      expect(ox, name).toBeGreaterThanOrEqual(0);
      expect(oy, name).toBeGreaterThanOrEqual(0);
      expect(ox + sx, name).toBeLessThanOrEqual(1 + 1e-6);
      expect(oy + sy, name).toBeLessThanOrEqual(1 + 1e-6);
      return { name, x0: Math.round(ox * w), y0: Math.round(oy * h), x1: Math.round((ox + sx) * w), y1: Math.round((oy + sy) * h) };
    });
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
        expect(overlap, `${a.name} / ${b.name}`).toBe(false);
      }
    }
    // Copies of one template get the same tile size (the same texels per metre).
    const villa = plan.villas.find((v: { type: string }) => v.type === "garden-4");
    const sample = inst[`villa-${String(villa.index).padStart(2, "0")}-garden-4`].scaleOffset[0];
    for (const v of plan.villas.filter((x: { type: string }) => x.type === "garden-4")) {
      expect(inst[`villa-${String(v.index).padStart(2, "0")}-garden-4`].scaleOffset[0]).toBeCloseTo(sample, 6);
    }
  });

  it("instances carry their placement, so the web can find them after GPU instancing", () => {
    const inst = manifest.tiers.high.instances;
    for (const v of plan.villas) {
      const p = inst[`villa-${String(v.index).padStart(2, "0")}-${v.type}`].position;
      expect(p[0]).toBeCloseTo(v.x, 2);
      expect(p[2]).toBeCloseTo(v.z, 2);
    }
    // Some villas sit dark at dusk; apartments and amenities are all lit.
    const villas = Object.entries(inst).filter(([k]) => k.startsWith("villa-"));
    const lit = villas.filter(([, v]) => v.windowsLit).length / villas.length;
    expect(lit).toBeGreaterThan(0.55);
    expect(lit).toBeLessThan(0.9);
    expect(inst["apartment-0"].windowsLit).toBe(true);
  });

  it("no UV2 seam splits a flat wall or roof on the high tier; one window strip on the low tier", () => {
    // Seams are measured where they split a flat surface of at least 1 m2 along an edge of at least
    // 1 m. Smart UV Project keeps every such surface one island on the high tier. On the low tier
    // (63 cm texels) one L-shaped strip of wall around a back window of the 4-bed garden villa is its
    // own island, about a texel wide: 3 edges, 3 samples each. Nothing else may appear.
    for (const state of STATES) {
      expect(report.tiers.high.states[state].seams.samples).toBe(0);
      expect(report.tiers.low.states[state].seams.samples).toBeLessThanOrEqual(9);
    }
  });

  it("puts a dusk light at every modelled fitting", () => {
    const d = report.tiers.high.duskLights;
    expect(d["street-lamp"]).toBe(plan.lamps.length);
    expect(d.carport).toBe(plan.villas.length);
    // One entrance canopy per villa, per apartment block, the sales gallery and the gym.
    expect(d.entrance).toBe(plan.villas.length + plan.apartments.length + 2);
    expect(d.fixture ?? 0).toBe(0); // every glowing fitting is recognised
    expect(d.portico).toBe(1);
    expect(d.lantern).toBe(1);
    expect(d.floodlight).toBe(12); // 4 masts per court: 2 padel, 1 tennis
    expect(d["gate-lintel"]).toBe(plan.gates.length);
    expect(d["pavilion-uplight"]).toBe(plan.gates.length * 2 * 4);
    expect(report.tiers.low.duskLights["street-lamp"]).toBe(plan.lamps.length);
  });

  it("the baked light matches Cycles' own from the storyboard cameras", () => {
    const v = report.tiers.high.validation;
    expect(v.filter((r) => r.state === "day").length).toBeGreaterThanOrEqual(5);
    expect(v.filter((r) => r.state === "dusk").length).toBeGreaterThanOrEqual(2);
    for (const r of v) {
      // Median brightness within 5 % by day and 10 % at dusk; 8 x 8 block error within 15 % / 35 %.
      expect(Math.abs(r.medianLogRatio), `${r.state} ${r.shot}`).toBeLessThan(r.state === "day" ? 0.05 : 0.1);
      expect(r.relativeError, `${r.state} ${r.shot}`).toBeLessThan(r.state === "day" ? 0.15 : 0.35);
    }
  });
});
