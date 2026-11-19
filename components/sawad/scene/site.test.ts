import { describe, expect, it } from "vitest";
import { PLAN_SITE, SITE, apartmentSlot, planApartmentSlot, planTerrainHeight, planVillaSlot, terrainHeight, villaSlot } from "./layout";
import { siteFor, usesPlan } from "./site";

describe("siteFor", () => {
  it("puts Zaitun Hills on the 28 ha masterplan and keeps the other compounds on the 7 ha layout", () => {
    expect(usesPlan("zaitun")).toBe(true);
    expect(usesPlan("dijla")).toBe(false);
    expect(usesPlan("shatt")).toBe(false);
    expect(siteFor("zaitun").bounds).toBe(PLAN_SITE);
    expect(siteFor("dijla").bounds).toBe(SITE);
  });

  it("answers ground height from the variant's own layout", () => {
    for (const [x, z] of [[0, -150], [-300, -230], [200, 40], [600, -400]]) {
      expect(siteFor("zaitun").ground(x, z)).toBe(planTerrainHeight(x, z));
      expect(siteFor("shatt").ground(x, z)).toBe(terrainHeight("shatt", x, z));
    }
  });

  it("places markers on the variant's plots: 60 villas and 24 apartments on the plan", () => {
    const zaitun = siteFor("zaitun");
    expect(zaitun.markerPosition({ kind: "villa", slot: 59 })).toEqual(planVillaSlot(59));
    expect(zaitun.markerPosition({ kind: "apartment", slot: 23 })).toEqual(planApartmentSlot(23));
    const dijla = siteFor("dijla");
    expect(dijla.markerPosition({ kind: "villa", slot: 7 })).toEqual(villaSlot(7));
    expect(dijla.markerPosition({ kind: "apartment", slot: 11 })).toEqual(apartmentSlot(11));
  });

  it("keeps each stem's base under its marker", () => {
    for (const v of ["zaitun", "dijla"] as const) {
      const s = siteFor(v);
      const m = { kind: "villa", slot: 3 } as const;
      const top = s.markerPosition(m);
      const base = s.markerBase(m);
      expect(base.x).toBe(top.x);
      expect(base.z).toBe(top.z);
      expect(base.y).toBeLessThan(top.y);
    }
  });

  it("finds the stream on the plan where the plan puts it", () => {
    const s = siteFor("zaitun");
    expect(s.isWater(0, s.riverCenterZ(0))).toBe(true);
    expect(s.isWater(0, -60)).toBe(false);
  });

  it("returns the same object for repeated calls", () => {
    expect(siteFor("zaitun")).toBe(siteFor("zaitun"));
  });
});
