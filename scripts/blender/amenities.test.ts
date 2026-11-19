import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Checks the amenity templates built by scripts/blender/amenities.py, through the report it writes:
 *   Blender -b --factory-startup -P scripts/blender/amenities.py -- --tier high --no-bake --report
 *   (and again with --tier low)
 */

type Measured = { triangles: number; min: number[]; max: number[]; size: number[]; materials: string[]; smoothFaces: number };
type Report = {
  source: string;
  surfaces: Record<string, string>;
  params: Record<string, Record<string, number | string | boolean>>;
  tiers: Record<"high" | "low", Record<string, Measured>>;
};

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const report: Report = JSON.parse(readFileSync(here("./amenities.report.json"), "utf8"));
const source = readFileSync(here("./amenities.py"));

const ASSETS = ["gym", "padel", "tennis", "playground", "mosque", "carport", "parking"] as const;
const TIERS = ["high", "low"] as const;
/** The compound's shared materials (build_compound.py): atlas + lattice per asset, then the specials. */
const MATERIALS = ["atlas", "lattice", "glass", "glass-clear", "brass", "bronze", "lamp-glow"];
/** Triangles per template on the high tier. One copy each, except courts and parking (a few). */
const BUDGET: Record<(typeof ASSETS)[number], number> = {
  gym: 14_000,
  padel: 3_000,
  tennis: 6_000,
  playground: 7_000,
  mosque: 21_000,
  carport: 2_000,
  parking: 8_000,
};

const high = report.tiers.high;
const low = report.tiers.low;

describe("amenity templates (scripts/blender/amenities.py)", () => {
  it("the report comes from the current amenities.py, with both tiers", () => {
    expect(report.source).toBe(createHash("sha256").update(source).digest("hex"));
    expect(Object.keys(report.tiers)).toEqual(["high", "low"]);
  });

  it("build_compound.py builds them through its one hook", () => {
    const build = readFileSync(here("./build_compound.py"), "utf8");
    expect(build).toMatch(/^import amenities\b/m);
    expect(build.match(/amenities\.build_all\(/g)).toHaveLength(1);
  });

  it.each(TIERS)("every asset is built on the %s tier and stands on the ground", (tier) => {
    for (const name of ASSETS) {
      const m = report.tiers[tier][name];
      expect(m, name).toBeDefined();
      expect(m.min[1], name).toBeGreaterThanOrEqual(-0.001);
      expect(m.min[1], name).toBeLessThanOrEqual(0.01);
      expect(m.triangles, name).toBeGreaterThan(0);
    }
  });

  it.each(TIERS)("the %s tier uses only the compound's shared materials", (tier) => {
    for (const name of ASSETS) {
      for (const mat of report.tiers[tier][name].materials) expect(MATERIALS, `${name}: ${mat}`).toContain(mat);
    }
  });

  it("stays within the triangle budgets, and the low tier is never heavier", () => {
    for (const name of ASSETS) {
      expect(high[name].triangles, name).toBeLessThanOrEqual(BUDGET[name]);
      expect(low[name].triangles, name).toBeLessThanOrEqual(high[name].triangles);
    }
    // Tiers keep the same envelope: the low tier drops detail, never mass.
    for (const name of ASSETS) expect(low[name].size, name).toEqual(high[name].size);
  });

  it("the low tier drops the mashrabiya screens and the high tier has them", () => {
    for (const name of ["gym", "mosque"]) {
      expect(high[name].materials, name).toContain("lattice");
      expect(low[name].materials, name).not.toContain("lattice");
    }
  });

  it("courts keep regulation sizes", () => {
    expect(report.params.padel).toMatchObject({ length: 20, width: 10 });
    expect(high.padel.size[0]).toBeCloseTo(10 + 2, 1); // court + 1 m apron each side
    expect(high.padel.size[2]).toBeCloseTo(20 + 2, 1);
    expect(high.padel.size[1]).toBeGreaterThanOrEqual(4); // 4 m back walls (glass + mesh)
    // Tennis enclosure at least the ITF minimum 36.57 x 18.29 m around a 23.77 x 10.97 m court.
    expect(high.tennis.size[2]).toBeGreaterThanOrEqual(36.57);
    expect(high.tennis.size[0]).toBeGreaterThanOrEqual(18.29);
  });

  it("the mosque stays modest: the minaret is its tallest point, below the 18 m cap", () => {
    expect(high.mosque.size[1]).toBeCloseTo(Number(report.params.mosque.minaret_height), 2);
    expect(high.mosque.size[1]).toBeLessThanOrEqual(18);
    expect(high.mosque.smoothFaces).toBeGreaterThan(0); // dome and minaret shade smooth
  });

  it("buildings keep to the compound's heights", () => {
    expect(high.gym.size[1]).toBeLessThanOrEqual(Number(report.params.gym.height) + 0.8); // + parapet
    expect(high.playground.size[1]).toBeLessThan(6);
    expect(high.carport.size[1]).toBeLessThan(3.5);
    expect(high.parking.size[1]).toBeLessThan(3.5);
  });

  it("surfaces without a trim-sheet region yet fall back to existing regions", () => {
    expect(Object.keys(report.surfaces).sort()).toEqual(["court", "line", "mesh", "sail", "sand", "soft"]);
    for (const region of Object.values(report.surfaces)) expect(typeof region).toBe("string");
  });
});
