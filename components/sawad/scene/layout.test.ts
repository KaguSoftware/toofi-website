import { describe, expect, it } from "vitest";
import {
  PAD_Y,
  SITE,
  apartmentSlot,
  boulevardPath,
  isRiver,
  markerBase,
  markerPosition,
  palmPositions,
  riverGeometryParams,
  seeded,
  terrainHeight,
  treePositions,
  villaPlot,
  villaSlot,
} from "./layout";
import type { SceneVariant } from "./types";

const VARIANTS: SceneVariant[] = ["dijla", "zaitun", "shatt"];
const inSite = (p: { x: number; z: number }) => p.x > SITE.minX && p.x < SITE.maxX && p.z > SITE.minZ && p.z < SITE.maxZ;

describe("layout", () => {
  it("seeded PRNG is deterministic and in [0, 1)", () => {
    const a = seeded(5);
    const b = seeded(5);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("has 24 unique villa slots and 12 unique apartment slots inside the site", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const p = villaSlot(i);
      expect(inSite(p)).toBe(true);
      keys.add(`${p.x.toFixed(1)},${p.z.toFixed(1)}`);
    }
    for (let i = 0; i < 12; i++) {
      const p = apartmentSlot(i);
      expect(inSite(p)).toBe(true);
      keys.add(`${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`);
    }
    expect(keys.size).toBe(36);
  });

  it("never puts a home in the river, for every variant", () => {
    for (const v of VARIANTS) {
      for (let i = 0; i < 24; i++) {
        const p = villaSlot(i);
        expect(isRiver(v, p.x, p.z)).toBe(false);
        expect(p.y).toBeGreaterThan(terrainHeight(v, p.x, p.z));
      }
      for (let i = 0; i < 12; i++) {
        const p = apartmentSlot(i);
        expect(isRiver(v, p.x, p.z)).toBe(false);
      }
    }
  });

  it("levels the compound pad and carves the river channel below the water line", () => {
    for (const v of VARIANTS) {
      expect(terrainHeight(v, 0, 0)).toBeCloseTo(PAD_Y, 5);
      const r = riverGeometryParams(v);
      expect(terrainHeight(v, 0, r.near + r.width / 2)).toBeLessThan(0);
      expect(isRiver(v, 0, r.near + r.width / 2)).toBe(true);
    }
  });

  it("makes Zaitun hillier than the Tigris plain", () => {
    const rise = (v: SceneVariant) => terrainHeight(v, 0, -600) - PAD_Y;
    expect(rise("zaitun")).toBeGreaterThan(rise("dijla") + 20);
  });

  it("wraps slot indices and builds villa plots that face their boulevard", () => {
    expect(villaPlot(24)).toEqual(villaPlot(0));
    expect(apartmentSlot(-1)).toEqual(apartmentSlot(11));
    expect(villaPlot(0).type).toBe("courtyard");
    expect(villaPlot(23).type).toBe("garden-3");
    expect(villaPlot(0).facing).toBe(-1);
    expect(villaPlot(6).facing).toBe(1);
  });

  it("maps markers to villa or apartment anchors, with the leader base below", () => {
    expect(markerPosition({ kind: "villa", slot: 3 })).toEqual(villaSlot(3));
    expect(markerPosition({ kind: "apartment", slot: 5 })).toEqual(apartmentSlot(5));
    const base = markerBase({ kind: "villa", slot: 3 });
    expect(base.y).toBeLessThan(villaSlot(3).y);
  });

  it("fans apartment floors out so markers never stack", () => {
    const xs = [0, 1, 2, 3].map((i) => apartmentSlot(i).x);
    expect(new Set(xs).size).toBe(4);
  });

  it("places palms deterministically, on land, up to the requested count", () => {
    for (const v of VARIANTS) {
      const a = palmPositions(v, 400);
      expect(a).toEqual(palmPositions(v, 400));
      expect(a.length).toBeLessThanOrEqual(400);
      expect(a.length).toBeGreaterThan(200);
      for (const p of a) expect(isRiver(v, p.x, p.z)).toBe(false);
    }
  });

  it("plants olive groves on Zaitun and a few garden trees elsewhere", () => {
    expect(treePositions("zaitun", 600).length).toBeGreaterThan(400);
    const dijla = treePositions("dijla", 72);
    expect(dijla.length).toBeGreaterThan(20);
    expect(dijla.length).toBeLessThanOrEqual(72);
  });

  it("returns boulevard, promenade and garden-axis polylines", () => {
    const paths = boulevardPath();
    expect(paths).toHaveLength(4);
    for (const p of paths) expect(p.length).toBeGreaterThan(3);
  });
});
