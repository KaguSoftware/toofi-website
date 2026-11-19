import { describe, expect, it } from "vitest";
import {
  COMPOUNDS,
  RESIDENCES,
  RESIDENCE_TYPES,
  TOTALS,
  countByStatus,
  fromPrice,
  getCompound,
  getResidence,
  residencesIn,
  sceneImage,
  seeded,
} from "./data";

describe("sample portfolio", () => {
  it("matches the design overview: 96 homes, 64 villas, 32 apartments", () => {
    expect(TOTALS).toEqual({ residences: 96, villas: 64, apartments: 32 });
  });

  it.each(COMPOUNDS.map((c) => [c.id, c] as const))("%s has exactly its phase-one mix", (_, c) => {
    const homes = residencesIn(c.id);
    expect(homes.filter((r) => r.kind === "villa")).toHaveLength(c.phaseOne.villas);
    expect(homes.filter((r) => r.kind === "apartment")).toHaveLength(c.phaseOne.apartments);
  });

  it("gives every residence a unique id and a slot inside the masterplan", () => {
    expect(new Set(RESIDENCES.map((r) => r.id)).size).toBe(RESIDENCES.length);
    for (const r of RESIDENCES) {
      expect(r.slot).toBeGreaterThanOrEqual(0);
      expect(r.slot).toBeLessThan(r.kind === "villa" ? 24 : 12);
      expect(r.floor === null).toBe(r.kind === "villa");
    }
  });

  it("copies the type's specs onto each residence", () => {
    for (const r of RESIDENCES) {
      const t = RESIDENCE_TYPES[r.type];
      expect([r.kind, r.bedrooms, r.builtM2, r.landM2]).toEqual([t.kind, t.bedrooms, t.builtM2, t.landM2]);
    }
  });

  it("is deterministic (server and client must agree)", () => {
    const a = seeded(42);
    const b = seeded(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("prices round to 5,000 and stay near the type's base", () => {
    for (const r of RESIDENCES) {
      expect(r.priceUsd % 5000).toBe(0);
      expect(r.priceUsd).toBeLessThan(RESIDENCE_TYPES[r.type].basePriceUsd * 1.2);
    }
  });

  it("keeps a coming-soon compound fully open", () => {
    const shatt = residencesIn("shatt-gardens");
    expect(countByStatus(shatt)).toEqual({ available: 32, reserved: 0, sold: 0 });
    const dijla = countByStatus(residencesIn("bustan-dijla"));
    expect(dijla.sold + dijla.reserved).toBeGreaterThan(0);
  });

  it("looks things up safely", () => {
    expect(getCompound("zaitun-hills")?.city.en).toBe("Erbil");
    expect(getCompound("nope")).toBeUndefined();
    expect(getResidence("bd-v01")?.id).toBe("BD-V01");
    expect(getResidence(null)).toBeUndefined();
    expect(fromPrice("bustan-dijla", "cv5")).toBeGreaterThan(fromPrice("bustan-dijla", "ta2")!);
    expect(fromPrice("zaitun-hills", "nonexistent" as never)).toBeNull();
  });

  it("names scene renders by variant and view", () => {
    expect(sceneImage("shatt", "terrace")).toBe("/sawad/scene-shatt-terrace.jpg");
  });
});
