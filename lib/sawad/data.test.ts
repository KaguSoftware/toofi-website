import { describe, expect, it } from "vitest";
import { planApartmentBlocks, planVillas, type VillaType } from "@/components/sawad/scene/layout";
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
  type ResidenceTypeId,
} from "./data";

describe("sample portfolio", () => {
  it("matches the design overview: 148 homes, 100 villas, 48 apartments", () => {
    expect(TOTALS).toEqual({ residences: 148, villas: 100, apartments: 48 });
    expect(COMPOUNDS.map((c) => [c.id, c.phaseOne])).toEqual([
      ["bustan-dijla", { villas: 20, apartments: 12 }],
      ["zaitun-hills", { villas: 60, apartments: 24 }],
      ["shatt-gardens", { villas: 20, apartments: 12 }],
    ]);
  });

  it.each(COMPOUNDS.map((c) => [c.id, c] as const))("%s has exactly its phase-one mix", (_, c) => {
    const homes = residencesIn(c.id);
    expect(homes.filter((r) => r.kind === "villa")).toHaveLength(c.phaseOne.villas);
    expect(homes.filter((r) => r.kind === "apartment")).toHaveLength(c.phaseOne.apartments);
  });

  it("gives every residence a unique id and a slot inside its compound's masterplan", () => {
    expect(new Set(RESIDENCES.map((r) => r.id)).size).toBe(RESIDENCES.length);
    // Zaitun Hills is on the 28 ha plan; the other two are still on the 7 ha layout.
    const plan = { villa: planVillas().length, apartment: planApartmentBlocks().length * 4 };
    for (const r of RESIDENCES) {
      const places = r.compound === "zaitun-hills" ? plan : { villa: 24, apartment: 12 };
      expect(r.slot).toBeGreaterThanOrEqual(0);
      expect(r.slot).toBeLessThan(places[r.kind]);
      expect(r.floor === null).toBe(r.kind === "villa");
      if (r.kind === "apartment") expect(r.floor).toBe(r.slot % 4);
    }
    for (const c of COMPOUNDS) {
      for (const kind of ["villa", "apartment"] as const) {
        const slots = residencesIn(c.id).filter((r) => r.kind === kind).map((r) => r.slot);
        expect(slots).toEqual(slots.map((_, i) => i)); // one home per slot, in order
      }
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

describe("Zaitun Hills on the 28 ha masterplan", () => {
  const compound = getCompound("zaitun-hills")!;
  const homes = residencesIn("zaitun-hills");
  const villas = homes.filter((r) => r.kind === "villa");
  const apartments = homes.filter((r) => r.kind === "apartment");
  const plots = planVillas();
  const blocks = planApartmentBlocks();
  const TYPE_OF_PLOT: Record<VillaType, ResidenceTypeId> = { courtyard: "cv5", "garden-4": "gv4", "garden-3": "gv3" };
  const count = (type: ResidenceTypeId) => homes.filter((r) => r.type === type).length;

  it("has a home of the right type on every villa plot, and a plot for every villa", () => {
    expect(villas).toHaveLength(plots.length);
    expect(compound.phaseOne.villas).toBe(plots.length);
    plots.forEach((plot, i) => {
      const home = villas[i];
      expect(home.slot).toBe(plot.index);
      expect(home.id).toBe(`ZH-V${String(plot.index + 1).padStart(2, "0")}`);
      expect(home.type).toBe(TYPE_OF_PLOT[plot.type]);
    });
  });

  it("sells each villa with the land its plot has", () => {
    for (const plot of plots) {
      const land = (plot.plot.maxX - plot.plot.minX) * (plot.plot.maxZ - plot.plot.minZ);
      expect(land).toBeCloseTo(RESIDENCE_TYPES[TYPE_OF_PLOT[plot.type]].landM2!, 6);
    }
  });

  it("has a home on every floor of every apartment block, with the river apartments on top", () => {
    expect(apartments).toHaveLength(blocks.length * 4);
    expect(compound.phaseOne.apartments).toBe(blocks.length * 4);
    blocks.forEach((block, b) => {
      expect(block.floors).toBe(4);
      const stack = apartments.filter((r) => Math.floor(r.slot / 4) === b);
      expect(stack.map((r) => r.floor)).toEqual([0, 1, 2, 3]);
      expect(stack.slice(1).map((r) => r.type)).toEqual(["ta2", "ta3", "ra4"]);
      expect(stack[3].outlook).toBe("river");
    });
    // One garden duplex per block on the ground floor, mirrored about the stream plaza.
    const ground = apartments.filter((r) => r.floor === 0).map((r) => r.type);
    expect(ground).toEqual(["ra4", "ta3", "ta2", "ta2", "ta3", "ra4"]);
    expect(apartments.at(-1)!.id).toBe("ZH-A24");
  });

  it("keeps the brief's mix: 15, 30 and 15 villas, and 8 of each apartment", () => {
    expect([count("cv5"), count("gv4"), count("gv3")]).toEqual([15, 30, 15]);
    expect([count("ra4"), count("ta3"), count("ta2")]).toEqual([8, 8, 8]);
  });

  it("takes each villa's outlook from its row", () => {
    const byRow = { waterfront: "river", boulevard: "boulevard", "terrace-view": "garden", "terrace-hill": "boulevard" } as const;
    plots.forEach((plot, i) => expect(villas[i].outlook).toBe(byRow[plot.row]));
    // Every courtyard villa is on the water.
    expect(villas.filter((r) => r.type === "cv5").every((r) => r.outlook === "river")).toBe(true);
  });

  it("stays close to the brief's guide prices and availability", () => {
    // Base price x 0.86, give or take 5%.
    const from = (type: ResidenceTypeId) => fromPrice("zaitun-hills", type)!;
    for (const [type, guide] of [
      ["cv5", 840_000],
      ["gv4", 590_000],
      ["gv3", 450_000],
      ["ra4", 370_000],
      ["ta3", 270_000],
      ["ta2", 195_000],
    ] as const) {
      expect(from(type)).toBeGreaterThan(guide * 0.93);
      expect(from(type)).toBeLessThanOrEqual(guide * 1.01);
    }
    // About 14% sold and 24% reserved.
    const status = countByStatus(homes);
    expect(status.sold / homes.length).toBeGreaterThan(0.08);
    expect(status.sold / homes.length).toBeLessThan(0.2);
    expect(status.reserved / homes.length).toBeGreaterThan(0.18);
    expect(status.reserved / homes.length).toBeLessThan(0.3);
    expect(status.available).toBeGreaterThan(homes.length / 2);
  });
});

describe("Bustan Dijla and Shatt Gardens (unchanged while Zaitun Hills moves to its new plan)", () => {
  it.each(["bustan-dijla", "shatt-gardens"] as const)("%s keeps its 20 villas and 12 apartments", (id) => {
    const homes = residencesIn(id);
    const count = (type: ResidenceTypeId) => homes.filter((r) => r.type === type).length;
    expect([count("cv5"), count("gv4"), count("gv3")]).toEqual([6, 8, 6]);
    expect([count("ra4"), count("ta3"), count("ta2")]).toEqual([4, 4, 4]);
    expect(homes.filter((r) => r.floor === 0).map((r) => r.type)).toEqual(["ra4", "ta3", "ta2"]);
  });

  it("keeps the first homes' prices and status, which the site's pages and tests quote", () => {
    expect(getResidence("BD-V01")).toMatchObject({ type: "cv5", outlook: "river", priceUsd: 955_000 });
    expect(getResidence("BD-A04")).toMatchObject({ type: "ra4", floor: 3, outlook: "river" });
    expect(fromPrice("shatt-gardens", "ta2")).toBe(175_000);
  });
});
