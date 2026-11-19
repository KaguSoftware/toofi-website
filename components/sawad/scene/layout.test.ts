import { describe, expect, it } from "vitest";
import {
  PAD_Y,
  PLAN_GARDEN_BAY,
  PLAN_GATE,
  PLAN_HILL_SLOPE,
  PLAN_LANDSCAPE,
  PLAN_LEVELS,
  PLAN_LINK,
  PLAN_PADS,
  PLAN_PROMENADE,
  PLAN_SITE,
  PLAN_STREET,
  PLAN_SUN,
  SITE,
  apartmentSlot,
  boulevardPath,
  isRiver,
  markerBase,
  markerPosition,
  palmPositions,
  planAmenities,
  planApartmentBlocks,
  planApartmentSlot,
  planAreas,
  planBank,
  planBenches,
  planBoulevardZ,
  planGates,
  planIsRiver,
  planLamps,
  planLandUseAt,
  planMarkerBase,
  planMarkerPosition,
  planParking,
  planReserve,
  planRiverCenterZ,
  planRoads,
  planSway,
  planTerrainHeight,
  planTreeZones,
  planVilla,
  planVillaSlot,
  planVillas,
  planWalls,
  riverGeometryParams,
  seeded,
  terrainHeight,
  treePositions,
  villaPlot,
  villaSlot,
  type PlanLandUse,
  type Rect,
} from "./layout";
import type { SceneVariant } from "./types";

const VARIANTS: SceneVariant[] = ["dijla", "zaitun", "shatt"];
const inSite = (p: { x: number; z: number }) => p.x > SITE.minX && p.x < SITE.maxX && p.z > SITE.minZ && p.z < SITE.maxZ;

describe("7 ha layout (what the scene draws today)", () => {
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

describe("28 ha masterplan", () => {
  const { valley, terrace } = PLAN_LEVELS;
  const villas = planVillas();
  const blocks = planApartmentBlocks();
  const amenities = Object.fromEntries(planAmenities().map((a) => [a.id, a]));
  const courts = planParking();
  const stream = riverGeometryParams("zaitun");

  const area = (r: Rect) => (r.maxX - r.minX) * (r.maxZ - r.minZ);
  const overlap = (a: Rect, b: Rect) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
  const within = (outer: Rect, inner: Rect, slack = 1e-6) =>
    inner.minX >= outer.minX - slack && inner.maxX <= outer.maxX + slack && inner.minZ >= outer.minZ - slack && inner.maxZ <= outer.maxZ + slack;
  const around = (x: number, z: number, width: number, depth: number): Rect => ({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 });
  const blockRect = (b: (typeof blocks)[number]): Rect => ({ minX: b.x - b.width / 2, maxX: b.x + b.width / 2, minZ: b.backZ, maxZ: b.backZ + b.floorDepths[0] });
  /** Lowest and highest ground over an area. */
  const groundRange = (r: Rect): [number, number] => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i <= 8; i++) {
      for (let j = 0; j <= 8; j++) {
        const y = planTerrainHeight(r.minX + ((r.maxX - r.minX) * i) / 8, r.minZ + ((r.maxZ - r.minZ) * j) / 8);
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    }
    return [lo, hi];
  };
  const roadOf = (row: string) => (row === "waterfront" || row === "boulevard" ? "a" : "b");

  it("covers 28 ha inside the wall", () => {
    const ha = area(PLAN_SITE) / 10_000;
    expect(ha).toBeGreaterThan(27.9);
    expect(ha).toBeLessThan(28.1);
  });

  it("has 60 villa plots in four rows of 15, numbered row by row from west to east", () => {
    expect(villas).toHaveLength(60);
    villas.forEach((v, i) => expect(v.index).toBe(i));
    const rows = [
      ["waterfront", "courtyard"],
      ["boulevard", "garden-4"],
      ["terrace-view", "garden-4"],
      ["terrace-hill", "garden-3"],
    ];
    rows.forEach(([row, type], r) => {
      const slice = villas.slice(r * 15, r * 15 + 15);
      expect(slice.every((v) => v.row === row && v.type === type)).toBe(true);
      slice.slice(1).forEach((v, i) => expect(v.x).toBeGreaterThan(slice[i].x));
      // The arrival court and the west link street take one place from the west side of each row.
      expect(slice.filter((v) => v.x < 0)).toHaveLength(7);
    });
    expect(new Set(villas.map((v) => `${v.x},${v.z.toFixed(2)}`)).size).toBe(60);
    expect(planVillas()).toBe(villas);
  });

  it("gives each villa a plot of its type's land area, with the house, its carport and a back garden inside", () => {
    const land = { courtyard: 780, "garden-4": 560, "garden-3": 420 };
    const footprint = { courtyard: [24, 22, 7.6], "garden-4": [20, 16, 7.2], "garden-3": [17, 14, 6.8] };
    for (const v of villas) {
      expect(area(v.plot)).toBeCloseTo(land[v.type], 6);
      expect([v.width, v.depth, v.height]).toEqual(footprint[v.type]);
      const house = around(v.x, v.z, v.width, v.depth);
      expect(within(PLAN_SITE, v.plot)).toBe(true);
      expect(within(v.plot, house)).toBe(true);
      // The carport's 6.6 x 6.5 m roof stands in the forecourt, between the street and the house.
      const carport = around(v.carport.x, v.carport.z, 6.6, 6.5);
      expect(within(v.plot, carport)).toBe(true);
      const street = v.z + v.facing * (v.plot.maxZ - v.plot.minZ); // beyond the plot line, on the street side
      expect(Math.abs(v.carport.z - street)).toBeLessThan(Math.abs(v.z - street));
      expect(v.carport.rotation).toBe(v.facing === 1 ? 0 : Math.PI);
      // The back garden runs from the rear wall to the back of the plot.
      expect(within(v.plot, v.garden)).toBe(true);
      expect(overlap(v.garden, house)).toBe(false);
      if (v.type !== "courtyard") expect(v.garden.maxZ - v.garden.minZ).toBeGreaterThan(4); // room for the pool and the citrus
    }
  });

  it("faces every villa onto its boulevard, on level ground", () => {
    for (const v of villas) {
      const road = planBoulevardZ(roadOf(v.row), v.x);
      expect(Math.sign(road - v.z)).toBe(v.facing);
      // The plot line is the same distance from the centre line on every street.
      const streetEdge = v.facing === 1 ? v.plot.maxZ : v.plot.minZ;
      expect(Math.abs(streetEdge - road)).toBeCloseTo(PLAN_STREET.frontage, 6);
      const [lo, hi] = groundRange(v.plot);
      expect(hi - lo).toBeLessThan(0.01);
      expect(lo).toBeCloseTo(v.y, 2);
    }
  });

  it("steps the upper boulevard and its two rows 6 m above the valley floor", () => {
    expect(valley).toBe(PAD_Y);
    expect(terrace - valley).toBe(6);
    expect(villas.filter((v) => v.y === valley).map((v) => v.row)).toEqual([...Array(15).fill("waterfront"), ...Array(15).fill("boulevard")]);
    expect(villas.filter((v) => v.y === terrace)).toHaveLength(30);
  });

  it("sets the terrace-view row half a step off the rows either side, so each row sees between the next", () => {
    const row = (id: string) => villas.filter((v) => v.row === id);
    for (const v of row("terrace-view")) {
      for (const other of [...row("boulevard"), ...row("terrace-hill")]) expect(Math.abs(other.x - v.x)).toBeGreaterThanOrEqual(15);
    }
  });

  it("keeps plots, blocks, amenities and parking clear of each other and of the streets", () => {
    const taken: Array<[string, Rect]> = [
      ...villas.map((v): [string, Rect] => [`villa ${v.index}`, v.plot]),
      ...blocks.map((b): [string, Rect] => [`block ${b.index}`, blockRect(b)]),
      ...courts.map((p): [string, Rect] => [`parking ${p.id}`, p.footprint]),
      // The garden terrace is the paving the pool sits in; the belvedere is part of boulevard B's sidewalk.
      ...planAmenities()
        .filter((a) => a.kind !== "terrace")
        .map((a): [string, Rect] => [a.id, a.footprint]),
    ];
    const clashes: string[] = [];
    for (let i = 0; i < taken.length; i++) {
      for (let j = i + 1; j < taken.length; j++) if (overlap(taken[i][1], taken[j][1])) clashes.push(`${taken[i][0]} x ${taken[j][0]}`);
    }
    expect(clashes).toEqual([]);
    const expected: Record<string, PlanLandUse> = { villa: "plot", block: "building", parking: "parking" };
    for (const [name, r] of taken) {
      const use = expected[name.split(" ")[0]];
      if (!use) continue;
      for (const [x, z] of [
        [r.minX + 0.1, r.minZ + 0.1],
        [r.maxX - 0.1, r.minZ + 0.1],
        [r.minX + 0.1, r.maxZ - 0.1],
        [r.maxX - 0.1, r.maxZ - 0.1],
        [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2],
      ]) {
        expect(planLandUseAt(x, z), name).toBe(use);
      }
    }
  });

  it("puts six apartment blocks on the water, three either side of the stream plaza", () => {
    expect(blocks).toHaveLength(6);
    expect(blocks.map((b) => b.x)).toEqual(blocks.map((b) => -b.x).reverse());
    const plaza = amenities["stream-plaza"].footprint;
    for (const b of blocks) {
      expect([b.width, b.floors, b.floorHeight]).toEqual([32, 4, 3.6]);
      expect(b.floorDepths).toEqual([16, 13.4, 10.8, 8.2].map((d) => expect.closeTo(d, 6)));
      const r = blockRect(b);
      // Between boulevard A's plot line and the promenade, clear of the plaza, on the valley floor.
      expect(r.minZ).toBeGreaterThan(planBoulevardZ("a", b.x) + PLAN_STREET.frontage);
      expect(r.maxZ).toBeLessThan(PLAN_PROMENADE.z - PLAN_PROMENADE.width / 2);
      expect(Math.abs(b.x) - b.width / 2).toBeGreaterThan(plaza.maxX);
      expect(groundRange(r)).toEqual([expect.closeTo(valley, 6), expect.closeTo(valley, 6)]);
      expect(b.y).toBe(valley);
    }
  });

  it("anchors 24 apartment markers that never stack, and wraps stray slots", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const p = planApartmentSlot(i);
      const block = blocks[Math.floor(i / 4)];
      expect(Math.abs(p.x - block.x)).toBeLessThan(block.width / 2);
      expect(p.y).toBeGreaterThan(valley + (i % 4) * 3.6);
      expect(planIsRiver(p.x, p.z)).toBe(false);
      keys.add(`${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`);
    }
    expect(keys.size).toBe(24);
    expect(new Set([0, 1, 2, 3].map((i) => planApartmentSlot(i).x)).size).toBe(4);
    expect(planApartmentSlot(-1)).toEqual(planApartmentSlot(23));
    expect(planApartmentSlot(24)).toEqual(planApartmentSlot(0));
    expect(planVilla(60)).toBe(planVilla(0));
    expect(planVilla(-1)).toBe(villas[59]);
  });

  it("maps markers to villa or apartment anchors above the roof, with the leader base below", () => {
    for (const v of villas) {
      const p = planVillaSlot(v.index);
      expect([p.x, p.z]).toEqual([v.x, v.z]);
      expect(p.y).toBeGreaterThan(v.y + v.height);
      expect(planTerrainHeight(p.x, p.z)).toBeCloseTo(v.y, 2);
    }
    expect(planMarkerPosition({ kind: "villa", slot: 37 })).toEqual(planVillaSlot(37));
    expect(planMarkerPosition({ kind: "apartment", slot: 21 })).toEqual(planApartmentSlot(21));
    expect(planMarkerBase({ kind: "villa", slot: 37 }).y).toBeCloseTo(villas[37].y + villas[37].height, 6);
    expect(planMarkerBase({ kind: "apartment", slot: 21 }).y).toBeLessThan(planApartmentSlot(21).y);
  });

  it("grades the ground: valley floor, olive bank, terrace, hillside", () => {
    for (const x of [-300, -120, 150, 380]) {
      const { toeZ, crestZ, hillZ } = planBank(x);
      expect(planTerrainHeight(x, planBoulevardZ("a", x))).toBeCloseTo(valley, 6);
      expect(planTerrainHeight(x, toeZ)).toBeCloseTo(valley, 6);
      expect(planTerrainHeight(x, (toeZ + crestZ) / 2)).toBeCloseTo((valley + terrace) / 2, 6);
      expect(planTerrainHeight(x, crestZ)).toBeCloseTo(terrace, 6);
      expect(planTerrainHeight(x, planBoulevardZ("b", x))).toBeCloseTo(terrace, 6);
      expect(planTerrainHeight(x, hillZ - 40)).toBeCloseTo(terrace + 40 * PLAN_HILL_SLOPE, 6);
      // The bank is between 75 and 100 m wide: a 6 to 8% climb.
      expect(toeZ - crestZ).toBeGreaterThan(75);
      expect(toeZ - crestZ).toBeLessThan(100);
    }
    // The back wall stands on the hillside, and the foothills carry on up behind it.
    expect(planTerrainHeight(0, PLAN_SITE.minZ)).toBeGreaterThan(terrace + 5);
    expect(planTerrainHeight(0, -600) - valley).toBeGreaterThan(40);
    expect(planTerrainHeight(0, -600)).toBeGreaterThan(terrainHeight("dijla", 0, -600) + 20);
  });

  it("cuts the central garden as a level bay in the bank, climbing evenly to the terrace around it", () => {
    const bay = PLAN_GARDEN_BAY;
    expect(planTerrainHeight(0, bay.headZ)).toBeCloseTo(valley, 6);
    expect(planTerrainHeight(bay.halfWidth, bay.headZ)).toBeCloseTo(valley, 6);
    expect(planTerrainHeight(0, bay.headZ - bay.run / 2)).toBeCloseTo((valley + terrace) / 2, 6);
    expect(planTerrainHeight(0, bay.headZ - bay.run)).toBeCloseTo(terrace, 6);
    // The garden steps climb that slope on the axis, from the terrace by the pool up to the belvedere.
    const steps = amenities["garden-steps"].footprint;
    expect(groundRange(steps)).toEqual([expect.closeTo(valley, 6), expect.closeTo(terrace, 6)]);
    expect(steps.maxZ).toBe(amenities["garden-terrace"].footprint.minZ);
    expect(steps.minZ).toBe(amenities.belvedere.footprint.maxZ);
    expect(amenities["garden-steps"].size).toEqual({ rise: 6 });
    // Beside the bay the bank is unchanged: the first plots either side stand on their own level.
    expect(planTerrainHeight(101, planBank(101).toeZ + 1)).toBeCloseTo(valley, 6);
    expect(planTerrainHeight(82, planBank(82).crestZ - 1)).toBeCloseTo(terrace, 6);
  });

  it("keeps every slope inside the walls gentle enough to plant and to walk", () => {
    let steepest = 0;
    for (let x = PLAN_SITE.minX + 1; x < PLAN_SITE.maxX - 1; x += 6.3) {
      for (let z = PLAN_SITE.minZ + 1; z < PLAN_SITE.maxZ - 1; z += 0.9) {
        const y = planTerrainHeight(x, z);
        steepest = Math.max(steepest, Math.abs(planTerrainHeight(x, z + 0.5) - y) / 0.5, Math.abs(planTerrainHeight(x + 0.5, z) - y) / 0.5);
      }
    }
    expect(steepest).toBeLessThan(0.3); // the garden slope, 6 m in 20.5 m, is the steepest
    expect(steepest).toBeGreaterThan(0.25);
    // Pads are level. The mosque court cuts less than a metre into the foot of the bank, and the
    // bank is itself again `margin` metres behind it.
    for (const pad of PLAN_PADS) {
      expect(groundRange(pad.area)).toEqual([expect.closeTo(pad.y, 6), expect.closeTo(pad.y, 6)]);
      const x = (pad.area.minX + pad.area.maxX) / 2;
      const { toeZ, crestZ } = planBank(x);
      const bank = (z: number) => valley + ((terrace - valley) * (toeZ - z)) / (toeZ - crestZ);
      expect(bank(pad.area.minZ) - pad.y).toBeGreaterThan(0);
      expect(bank(pad.area.minZ) - pad.y).toBeLessThan(1);
      expect(planTerrainHeight(x, pad.area.minZ - pad.margin)).toBeCloseTo(bank(pad.area.minZ - pad.margin), 6);
    }
  });

  it("carves the stream below the water line and keeps the compound dry", () => {
    const mid = stream.near + stream.width / 2;
    expect(planTerrainHeight(0, mid)).toBeLessThan(0);
    expect(planIsRiver(0, mid)).toBe(true);
    // Straight along the whole promenade, bending once it is past the walls: toward the compound's
    // bank upstream and away from it downstream, without ever reaching the road to the main gate.
    for (const x of [-430, -200, 200, 430]) expect(planRiverCenterZ(x)).toBe(planRiverCenterZ(0));
    expect(planRiverCenterZ(-700)).toBeLessThan(planRiverCenterZ(0) - 30);
    expect(planRiverCenterZ(700)).toBeGreaterThan(planRiverCenterZ(0) + 30);
    for (let x = -1500; x <= -430; x += 10) expect(planRiverCenterZ(x) - stream.width / 2).toBeGreaterThan(planBoulevardZ("a", x) + 20);
    for (let x = PLAN_SITE.minX; x <= PLAN_SITE.maxX; x += 10) {
      expect(planTerrainHeight(x, PLAN_SITE.maxZ)).toBeCloseTo(valley, 6); // the promenade's edge
      expect(planIsRiver(x, PLAN_SITE.maxZ + 4)).toBe(false); // the bank falls to the water over the next 12 m
      expect(planIsRiver(x, stream.near)).toBe(true);
    }
    for (const v of villas) expect(planIsRiver(v.x, v.z)).toBe(false);
    // The far bank is land again, and its hills rise behind it.
    expect(planTerrainHeight(0, stream.far + 30)).toBeGreaterThan(0.5);
    expect(planTerrainHeight(0, stream.far + 500)).toBeGreaterThan(20);
  });

  it("runs both boulevards square onto the gates and the garden axis, swaying gently between", () => {
    expect(planSway(0)).toBe(0);
    expect(planSway(PLAN_SITE.maxX)).toBeCloseTo(0, 12);
    expect(planSway(PLAN_SITE.maxX / 2)).toBeCloseTo(1, 12);
    expect(planSway(-120)).toBe(planSway(120));
    for (const id of ["a", "b"] as const) {
      for (const x of [0, PLAN_SITE.minX, PLAN_SITE.maxX]) expect(Math.abs(planBoulevardZ(id, x + 0.5) - planBoulevardZ(id, x - 0.5))).toBeLessThan(0.005);
      let skew = 0;
      for (let x = PLAN_SITE.minX; x < PLAN_SITE.maxX; x++) skew = Math.max(skew, Math.abs(planBoulevardZ(id, x + 1) - planBoulevardZ(id, x)));
      expect((Math.atan(skew) * 180) / Math.PI).toBeLessThan(5); // villas stay square to the plan, so the street must not turn far
      expect(skew).toBeGreaterThan(0.03);
    }
    // A drifts toward the stream and B toward the hill, so the olive bank widens and narrows.
    expect(planBoulevardZ("a", 215)).toBeGreaterThan(planBoulevardZ("a", 0));
    expect(planBoulevardZ("b", 215)).toBeLessThan(planBoulevardZ("b", 0));
  });

  it("lists the streets and walks with centre lines that follow the ground", () => {
    const roads = Object.fromEntries(planRoads().map((r) => [r.id, r]));
    expect(Object.keys(roads)).toEqual(expect.arrayContaining(["boulevard-a", "boulevard-b", "link-west", "link-east", "promenade", "plaza-walk", "garden-walk"]));
    expect([roads["boulevard-a"].width, roads["boulevard-b"].width]).toEqual([9, 9]);
    expect(roads["link-west"].width).toBe(PLAN_LINK.carriageway);
    expect(roads.promenade.width).toBe(8);
    for (const r of planRoads()) {
      expect(r.path.length).toBeGreaterThan(3);
      for (const [x, y, z] of r.path) expect(y).toBeCloseTo(planTerrainHeight(x, z), 9);
    }
    // Boulevard A carries on 30 m beyond both gates; boulevard B runs between the two links.
    expect(roads["boulevard-a"].path[0][0]).toBe(PLAN_SITE.minX - 30);
    expect(roads["boulevard-a"].path.at(-1)![0]).toBe(PLAN_SITE.maxX + 30);
    expect([roads["boulevard-b"].path[0][0], roads["boulevard-b"].path.at(-1)![0]]).toEqual([roads["link-west"].path[0][0], roads["link-east"].path[0][0]]);
    // The links climb the 6 m from one boulevard to the other at under 8%.
    for (const id of ["link-west", "link-east"]) {
      const path = roads[id].path;
      expect(path[0][1]).toBeCloseTo(valley, 6);
      expect(path.at(-1)![1]).toBeCloseTo(terrace, 6);
      for (let i = 1; i < path.length; i++) {
        const run = Math.hypot(path[i][0] - path[i - 1][0], path[i][2] - path[i - 1][2]);
        expect(Math.abs(path[i][1] - path[i - 1][1]) / run).toBeLessThan(0.08);
      }
    }
  });

  it("has a gate at each end of boulevard A and a wall on three sides", () => {
    const gates = planGates();
    expect(gates.map((g) => [g.id, g.x])).toEqual([
      ["main", PLAN_SITE.minX],
      ["east", PLAN_SITE.maxX],
    ]);
    for (const g of gates) {
      expect(g.z).toBeCloseTo(planBoulevardZ("a", g.x), 9);
      expect(g.pavilions.map((p) => p.z - g.z)).toEqual([-PLAN_GATE.pavilionOffset, PLAN_GATE.pavilionOffset]);
      expect(planLandUseAt(g.x + Math.sign(-g.x) * 0.5, g.z)).toBe("road");
    }
    const walls = planWalls();
    expect(walls).toHaveLength(5);
    const back = walls.find((w) => w.id === "back")!;
    expect([back.from, back.to]).toEqual([
      [PLAN_SITE.minX, PLAN_SITE.minZ],
      [PLAN_SITE.maxX, PLAN_SITE.minZ],
    ]);
    for (const g of gates) {
      const runs = walls.filter((w) => w.id.startsWith(g.id));
      expect(runs.map((w) => [w.from[1], w.to[1]])).toEqual([
        [PLAN_SITE.minZ, g.z - PLAN_GATE.opening / 2],
        [g.z + PLAN_GATE.opening / 2, PLAN_PROMENADE.z - PLAN_PROMENADE.width / 2],
      ]);
    }
    // Nothing closes the stream side.
    for (const w of walls) expect(Math.max(w.from[1], w.to[1])).toBeLessThan(PLAN_PROMENADE.z);
  });

  it("places every amenity the brief asks for on level ground inside the walls", () => {
    expect(Object.keys(amenities).sort()).toEqual(
      ["belvedere", "gallery", "garden-steps", "garden-terrace", "gym", "lawn", "mosque", "padel-1", "padel-2", "playground", "pool", "stream-plaza", "tennis"].sort(),
    );
    for (const a of planAmenities()) {
      expect(within(PLAN_SITE, a.footprint), a.id).toBe(true);
      if (a.kind === "steps") continue;
      const [lo, hi] = groundRange(a.footprint);
      expect(hi - lo, a.id).toBeLessThan(0.01);
      expect(lo, a.id).toBeCloseTo(a.y, 2);
    }
    // The reflecting pool lies on the garden axis inside its terrace; the courts run the same way.
    const pool = amenities.pool;
    expect([pool.x, pool.size]).toEqual([0, { width: 12, depth: 72, height: 0.35 }]);
    expect(within(amenities["garden-terrace"].footprint, pool.footprint)).toBe(true);
    for (const id of ["padel-1", "padel-2", "tennis"]) {
      const f = amenities[id].footprint;
      expect(f.maxZ - f.minZ).toBeGreaterThan(f.maxX - f.minX);
    }
    expect(amenities.tennis.size).toEqual({ length: 36.6, width: 18.3 });
    expect(amenities["padel-1"].size).toEqual({ length: 20, width: 10 });
  });

  it("puts the mosque by the main gate, the playground in the central garden and the gym facing the courts and the pool", () => {
    const [main] = planGates();
    const { mosque, gallery, gym, playground, pool } = amenities;
    // Mosque: inland of boulevard A, a short walk from the gate. Its front faces the boulevard until the real north is known.
    expect(Math.hypot(mosque.x - main.x, mosque.z - main.z)).toBeLessThan(60);
    expect(mosque.footprint.maxZ).toBeLessThan(planBoulevardZ("a", mosque.x) - PLAN_STREET.frontage);
    expect(mosque.rotation).toBe(0);
    // The sales gallery is a courtyard villa on the stream side of the gate, and is not one of the 60 homes.
    expect(gallery.asset).toBe("villa-courtyard");
    expect(gallery.footprint.minZ).toBeCloseTo(planBoulevardZ("a", gallery.x) + PLAN_STREET.frontage, 6);
    expect(Math.abs(gallery.x - main.x)).toBeLessThan(40);
    expect(villas.some((v) => overlap(v.plot, gallery.footprint))).toBe(false);
    // Playground and gym stand on the garden's level floor, either side of the pool.
    for (const a of [playground, gym]) {
      expect(Math.max(Math.abs(a.footprint.minX), Math.abs(a.footprint.maxX))).toBeLessThanOrEqual(PLAN_GARDEN_BAY.halfWidth);
      expect(a.footprint.minZ).toBeGreaterThan(PLAN_GARDEN_BAY.headZ);
      expect(a.footprint.maxZ).toBeLessThan(planBoulevardZ("a", a.x) - PLAN_STREET.frontage);
    }
    expect(playground.footprint.minX).toBeGreaterThan(pool.footprint.maxX);
    // The gym's front (its glazing and terrace) is turned to +x: the padel courts, then the pool, then the evening sun.
    expect(Math.sin(gym.rotation)).toBeCloseTo(1, 12);
    expect(PLAN_SUN.azimuthX).toBeGreaterThan(0.9);
    for (const id of ["padel-1", "padel-2"]) {
      expect(amenities[id].footprint.minX).toBeGreaterThan(gym.footprint.maxX);
      expect(amenities[id].footprint.maxX).toBeLessThan(pool.footprint.minX);
    }
  });

  it("parks 112 cars in seven shared courts, each with a way in from boulevard A, and two at every villa", () => {
    expect(courts).toHaveLength(7);
    expect(courts.reduce((n, p) => n + p.spaces, 0)).toBe(112);
    expect(courts.filter((p) => p.serves === "apartments").reduce((n, p) => n + p.spaces, 0)).toBe(64);
    expect(courts.map((p) => p.serves).sort()).toEqual(["apartments", "apartments", "apartments", "apartments", "gym", "service", "visitors"]);
    const drives = [...courts.map((p) => ({ id: p.id, driveway: p.driveway, road: "a" as const, target: p.footprint })), ...villas.map((v) => ({ id: `villa ${v.index}`, driveway: v.driveway, road: roadOf(v.row), target: v.plot }))];
    for (const d of drives) {
      const x = (d.driveway.minX + d.driveway.maxX) / 2;
      const road = planBoulevardZ(d.road as "a" | "b", x);
      const [nearEdge, farEdge] = [d.driveway.minZ, d.driveway.maxZ].sort((p, q) => Math.abs(p - road) - Math.abs(q - road));
      // From the kerb to the plot line, into the court or the plot it serves.
      expect(Math.abs(nearEdge - road), d.id).toBeCloseTo(PLAN_STREET.carriageway / 2, 6);
      expect(Math.abs(farEdge - road), d.id).toBeCloseTo(PLAN_STREET.frontage, 6);
      expect(x, d.id).toBeGreaterThan(d.target.minX);
      expect(x, d.id).toBeLessThan(d.target.maxX);
      expect(planLandUseAt(x, (nearEdge + farEdge) / 2), d.id).toBe("road");
    }
  });

  it("stands lamps clear of carriageways, plots and drives, and benches along the promenade", () => {
    const lamps = planLamps();
    expect(lamps.length).toBeGreaterThan(150);
    const drives = [...villas.map((v) => v.driveway), ...courts.map((p) => p.driveway)];
    for (const l of lamps) {
      expect(["verge", "paving", "river-lawn"]).toContain(planLandUseAt(l.x, l.z));
      expect(l.y).toBeCloseTo(planTerrainHeight(l.x, l.z), 9);
      expect(drives.some((d) => l.x > d.minX - 0.5 && l.x < d.maxX + 0.5 && l.z >= d.minZ && l.z <= d.maxZ)).toBe(false);
      expect(Math.abs(l.x)).toBeGreaterThan(4); // the garden axis stays open
    }
    const benches = planBenches();
    expect(benches).toHaveLength(16);
    for (const b of benches) {
      expect(planLandUseAt(b.x, b.z)).toBe("paving");
      expect(Math.abs(b.z - PLAN_PROMENADE.z)).toBeLessThan(PLAN_PROMENADE.width / 2);
    }
  });

  it("accounts for the whole site, with 58% landscape once the phase two reserve is built", () => {
    const areas = planAreas(1);
    const site = area(PLAN_SITE);
    const total = Object.values(areas).reduce((n, v) => n + v, 0);
    expect(total).toBeCloseTo(site, 0);
    expect(areas.outside).toBeUndefined();
    const share = (uses: ReadonlyArray<PlanLandUse>) => (100 * uses.reduce((n, u) => n + (areas[u] ?? 0), 0)) / site;
    const landscape = share(PLAN_LANDSCAPE);
    expect(Math.round(landscape)).toBe(58);
    expect(Math.abs(landscape - 58)).toBeLessThan(0.3);
    // Until phase two, the reserve is olive terraces too.
    expect(share(["reserve"])).toBeGreaterThan(10);
    expect(share(["reserve"])).toBeLessThan(14);
    // 60 plots and the gallery's.
    const plots = 15 * 780 + 30 * 560 + 15 * 420 + 780;
    expect(Math.abs(areas.plot - plots) / plots).toBeLessThan(0.01);
    expect(Math.abs(areas.water - 12 * 72) / (12 * 72)).toBeLessThan(0.05);
    expect(share(["road", "paving", "parking"])).toBeLessThan(16);
  });

  it("zones the planting: palms on the valley floor and the boulevards, olives on every slope, citrus in the back gardens", () => {
    const zones = planTreeZones();
    const areas = planAreas(2);
    const roadIds = planRoads().map((r) => r.id);
    expect(new Set(zones.map((z) => z.id)).size).toBe(zones.length);
    expect(new Set(zones.map((z) => z.species))).toEqual(new Set(["date-palm", "olive", "citrus"]));
    for (const z of zones) {
      expect(z.spacing).toBeGreaterThan(0);
      if (z.pattern === "allee") expect(roadIds).toContain(z.along);
      for (const use of z.fills ?? []) expect(areas[use], use).toBeGreaterThan(0);
    }
    const fills = (species: string) => zones.filter((z) => z.species === species).flatMap((z) => z.fills ?? []);
    expect(fills("date-palm").sort()).toEqual(["palm-garden", "river-lawn"]);
    expect(fills("olive").sort()).toEqual(["olive-grove", "olive-terrace", "reserve"]);
    // Palm land is all on the valley floor; the boulevards carry the only palms on the terrace.
    for (let x = PLAN_SITE.minX + 3; x < PLAN_SITE.maxX; x += 9) {
      for (let z = PLAN_SITE.minZ + 3; z < PLAN_SITE.maxZ; z += 9) {
        const use = planLandUseAt(x, z);
        if (use === "palm-garden" || use === "river-lawn") expect(planTerrainHeight(x, z)).toBeCloseTo(valley, 6);
        if (use === "olive-terrace") expect(planTerrainHeight(x, z)).toBeGreaterThan(valley - 1e-9);
      }
    }
    const allees = zones.filter((z) => z.pattern === "allee" && z.species === "date-palm");
    expect(allees.map((z) => z.along)).toEqual(["boulevard-a", "boulevard-b"]);
    for (const z of allees) expect(z.clear).toHaveLength(villas.length + courts.length);
    const citrus = zones.find((z) => z.species === "citrus")!;
    expect(citrus.areas).toEqual(villas.map((v) => v.garden));
  });

  it("outlines the phase two reserve on the hillside, either side of a clear ride up the garden axis", () => {
    const outlines = planReserve();
    expect(outlines).toHaveLength(2);
    for (const outline of outlines) {
      for (const [x, z] of outline) {
        expect(z).toBeLessThan(planBank(x).hillZ);
        expect(z).toBeGreaterThan(PLAN_SITE.minZ);
        expect(Math.abs(x)).toBeGreaterThan(30);
      }
      const xs = outline.map((p) => p[0]);
      const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
      expect(planLandUseAt(midX, planBank(midX).hillZ - 20)).toBe("reserve");
    }
    expect(planLandUseAt(0, planBank(0).hillZ - 20)).toBe("olive-terrace");
  });
});
