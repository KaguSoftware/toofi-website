import { describe, expect, it } from "vitest";
import {
  CELL_SIZE,
  HEDGE_MODULE,
  LIFE_BUDGET,
  LOD_DISTANCE,
  birdPosition,
  cellOf,
  insidePlan,
  lodFor,
  planLandscape,
  planLife,
  routeLength,
  samplePath,
  visibleTriangles,
  type LandscapeTier,
  type LifeRoute,
} from "./landscape";
import { PLAN_SITE, planAmenities, planBoulevardZ, planIsRiver, planLandUseAt, planParking, planTerrainHeight, planVillas, type Rect } from "./layout";

const TIERS: LandscapeTier[] = ["high", "low"];
const inRect = (r: Rect, x: number, z: number) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
const BUILT = new Set(["building", "plot", "water", "court", "play", "parking"]);

describe("planLandscape", () => {
  it("is deterministic and cached", () => {
    expect(planLandscape("high")).toBe(planLandscape("high"));
    expect(planLandscape("high").palms[0]).toEqual(planLandscape("high").palms[0]);
  });

  it("puts every plant on the ground, off the stream", () => {
    for (const tier of TIERS) {
      const land = planLandscape(tier);
      for (const p of [...land.palms, ...land.olives, ...land.citrus]) {
        expect(Math.abs(p.y - planTerrainHeight(p.x, p.z))).toBeLessThan(0.35);
        expect(planIsRiver(p.x, p.z)).toBe(false);
      }
    }
  });

  it("keeps trees out of buildings, plots, pools, courts and parking", () => {
    for (const tier of TIERS) {
      const land = planLandscape(tier);
      for (const p of [...land.palms, ...land.olives]) {
        if (insidePlan(p.x, p.z)) expect(BUILT.has(planLandUseAt(p.x, p.z))).toBe(false);
      }
    }
  });

  it("keeps palms in the valley and out of the high slopes", () => {
    const { palms } = planLandscape("high");
    expect(palms.length).toBeGreaterThan(800);
    for (const p of palms) {
      // Inside the walls palms stand on the valley floor and the boulevards, never above the terrace.
      expect(p.y).toBeLessThan(14.5);
    }
  });

  it("plants olives in rows on the hillsides, and many more than palms", () => {
    const high = planLandscape("high");
    expect(high.olives.length).toBeGreaterThan(high.palms.length * 4);
    const outside = high.olives.filter((o) => !insidePlan(o.x, o.z, 5));
    expect(outside.length).toBeGreaterThan(3000);
    // Foothill olives reach well above the terrace.
    expect(Math.max(...outside.map((o) => o.y))).toBeGreaterThan(30);
  });

  it("covers the whole terrace beyond the gates, with no bare band between the valley and the hill", () => {
    const { olives } = planLandscape("high");
    const x0 = PLAN_SITE.maxX + 100;
    const zs = olives.filter((o) => o.x > x0 && o.x < x0 + 120).map((o) => o.z);
    const sorted = [...zs].sort((a, b) => a - b);
    let widest = 0;
    for (let i = 1; i < sorted.length; i++) widest = Math.max(widest, sorted[i] - sorted[i - 1]);
    expect(widest).toBeLessThan(30);
  });

  it("keeps the road past the gate clear", () => {
    const { olives, palms } = planLandscape("high");
    for (const p of [...olives, ...palms]) {
      if (Math.abs(p.x) > PLAN_SITE.maxX + 8 && Math.abs(p.x) < PLAN_SITE.maxX + 60) {
        expect(Math.abs(p.z - planBoulevardZ("a", p.x)), `${p.x} ${p.z}`).toBeGreaterThan(4.5);
      }
    }
  });

  it("gives the low tier a thinner outside and the same inside", () => {
    const high = planLandscape("high");
    const low = planLandscape("low");
    const inside = (l: typeof high) => l.olives.filter((o) => insidePlan(o.x, o.z)).length;
    expect(inside(low)).toBe(inside(high));
    expect(low.olives.length).toBeLessThan(high.olives.length * 0.7);
    expect(low.palms.length).toBeLessThan(high.palms.length);
    expect(low.grass.length).toBeLessThan(high.grass.length);
    expect(low.citrus).toEqual(high.citrus);
  });

  it("puts citrus in the back gardens of the villas that have one, clear of the house", () => {
    const { citrus } = planLandscape("high");
    expect(citrus.length).toBeGreaterThan(100);
    const gardens = planVillas().map((v) => v.garden);
    for (const c of citrus) expect(gardens.some((g) => inRect(g, c.x, c.z))).toBe(true);
    for (const v of planVillas()) {
      const own = citrus.filter((c) => inRect(v.garden, c.x, c.z));
      if (v.type === "courtyard") expect(own).toHaveLength(0);
      else expect(own.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("clips a low hedge along every villa front, broken at the drive", () => {
    const { hedges } = planLandscape("high");
    const low = hedges.filter((h) => h.kind === "hedge-low");
    for (const v of planVillas()) {
      const front = v.facing === -1 ? v.plot.minZ + 0.6 : v.plot.maxZ - 0.6;
      const mine = low.filter((h) => Math.abs(h.z - front) < 0.01 && h.x > v.plot.minX && h.x < v.plot.maxX);
      expect(mine.length).toBeGreaterThanOrEqual(5);
      for (const h of mine) {
        expect(h.x + HEDGE_MODULE / 2).toBeLessThanOrEqual(v.plot.maxX);
        expect(h.x > v.driveway.minX - 1 && h.x < v.driveway.maxX + 1 && h.z > v.driveway.minZ && h.z < v.driveway.maxZ).toBe(false);
      }
    }
    expect(hedges.some((h) => h.kind === "hedge-tall")).toBe(true);
  });

  it("lines the parking courts with tall hedges and flanks every gate pavilion with shrubs", () => {
    const { hedges, shrubs } = planLandscape("high");
    for (const p of planParking()) {
      const near = hedges.filter((h) => h.kind === "hedge-tall" && inRect({ minX: p.footprint.minX - 1, maxX: p.footprint.maxX + 1, minZ: p.footprint.minZ - 1, maxZ: p.footprint.maxZ + 1 }, h.x, h.z));
      expect(near.length).toBeGreaterThan(5);
    }
    expect(shrubs).toHaveLength(8);
  });

  it("scatters green tufts on the lawns only and dry tufts elsewhere", () => {
    const { grass } = planLandscape("high");
    const green = grass.filter((t) => t.kind === "grass-green");
    expect(green.length).toBeGreaterThan(300);
    for (const t of green) expect(["lawn", "river-lawn"]).toContain(planLandUseAt(t.x, t.z));
    expect(grass.filter((t) => t.kind === "grass-dry").length).toBeGreaterThan(300);
  });

  it("tiles the landscape into 64 m cells", () => {
    expect(CELL_SIZE).toBe(64);
    expect(cellOf(-1, 65)).toBe("-1_1");
    for (const p of planLandscape("low").olives.slice(0, 200)) expect(p.cell).toBe(cellOf(p.x, p.z));
  });
});

describe("level of detail and the triangle budget", () => {
  it("steps down with distance", () => {
    expect(lodFor(5, "high")).toBe(0);
    expect(lodFor(LOD_DISTANCE.high[0] + 1, "high")).toBe(1);
    expect(lodFor(LOD_DISTANCE.high[1] + 1, "high")).toBe(2);
    expect(lodFor(LOD_DISTANCE.high[2] + 1, "high")).toBe("card");
    // The low tier never uses level 0.
    expect(lodFor(1, "low")).not.toBe(0);
  });

  const views = {
    street: [{ x: -300, y: 3, z: 20 }, { x: -100, y: 3, z: 10 }],
    aerial: [{ x: 0, y: 160, z: 150 }, { x: 0, y: 6, z: -60 }],
    hills: [{ x: 0, y: 40, z: 30 }, { x: 0, y: 20, z: -300 }],
    terrace: [{ x: -20, y: 12, z: -120 }, { x: 0, y: 8, z: -30 }],
  } as const;

  it.each(Object.entries(views))("stays inside the 90k vegetation budget in the %s view, on both tiers", (_name, [eye, target]) => {
    for (const tier of TIERS) expect(visibleTriangles(eye, target, tier)).toBeLessThan(90_000);
  });

  it("draws less on the low tier than on the high tier", () => {
    const [eye, target] = views.street;
    expect(visibleTriangles(eye, target, "low")).toBeLessThan(visibleTriangles(eye, target, "high"));
  });

  it("counts nothing behind the camera", () => {
    expect(visibleTriangles({ x: 0, y: 5, z: 500 }, { x: 0, y: 5, z: 900 }, "high")).toBe(0);
  });
});

describe("life", () => {
  it("respects each tier's budget", () => {
    for (const tier of TIERS) {
      const life = planLife(tier);
      expect(life.walkers.length).toBeLessThanOrEqual(LIFE_BUDGET[tier].walkers);
      expect(life.moving.length).toBeLessThanOrEqual(LIFE_BUDGET[tier].moving);
      expect(life.parked.length).toBeLessThanOrEqual(LIFE_BUDGET[tier].parked);
      expect(life.flocks.reduce((n, f) => n + f.count, 0)).toBeLessThanOrEqual(LIFE_BUDGET[tier].birds + 8);
    }
    expect(planLife("high")).toBe(planLife("high"));
  });

  it("keeps people on ground they can walk on", () => {
    const walkable = new Set(["paving", "lawn", "river-lawn", "verge", "play", "court", "palm-garden", "olive-grove", "road"]);
    for (const w of planLife("high").walkers) {
      for (const [x, , z] of w.route.points) {
        expect(walkable.has(planLandUseAt(x, z)), `${w.id} at ${x.toFixed(1)}, ${z.toFixed(1)} is ${planLandUseAt(x, z)}`).toBe(true);
      }
    }
  });

  it("covers the scenes the brief asks for", () => {
    const ids = planLife("high").walkers.map((w) => w.id).join(" ");
    for (const id of ["promenade", "to-mosque", "padel-1", "padel-2", "play-", "bench-"]) expect(ids).toContain(id);
    const clips = new Set(planLife("high").walkers.map((w) => w.clip));
    for (const c of ["walk", "run", "idle", "swing", "sit"]) expect(clips.has(c as never)).toBe(true);
  });

  it("puts players on the courts and children inside the playground", () => {
    const life = planLife("high");
    const amenity = (id: string) => planAmenities().find((a) => a.id === id)!;
    for (const w of life.walkers.filter((p) => p.id.startsWith("padel"))) {
      const court = amenity(w.id.slice(0, 7));
      expect(inRect(court.footprint, w.route.points[0][0], w.route.points[0][2])).toBe(true);
    }
    for (const w of life.walkers.filter((p) => p.id.startsWith("play-") && p.clip !== "sit")) {
      for (const [x, , z] of w.route.points) expect(inRect(amenity("playground").footprint, x, z)).toBe(true);
    }
  });

  it("drives on the right: east on the river side lane, west on the other", () => {
    for (const car of planLife("high").moving) {
      const [first] = car.route.points;
      const id = car.id.startsWith("b") ? "b" : "a";
      expect(first[2]).toBeLessThan(planBoulevardZ(id, first[0]));
      expect(car.route.closed).toBe(true);
    }
  });

  it("parks cars in carports and bays, not on top of one another", () => {
    const parked = planLife("high").parked;
    expect(parked.length).toBeGreaterThan(15);
    for (let i = 0; i < parked.length; i++) {
      for (let j = i + 1; j < parked.length; j++) expect(Math.hypot(parked[i].x - parked[j].x, parked[i].z - parked[j].z)).toBeGreaterThan(1.8);
    }
    for (const c of parked) expect(planIsRiver(c.x, c.z)).toBe(false);
  });

  it("flies birds over the stream and the olive slopes, above the ground", () => {
    const { flocks } = planLife("high");
    expect(flocks.map((f) => f.id)).toEqual(expect.arrayContaining(["stream-west", "slope-olives"]));
    for (const f of flocks) {
      for (let i = 0; i < f.count; i += 3) {
        const p = birdPosition(f, i, 12.5);
        expect(p.y).toBeGreaterThan(Math.max(0, planTerrainHeight(p.x, p.z)) + 4);
        expect(birdPosition(f, i, 12.5)).toEqual(p);
      }
    }
    const f = flocks[0];
    expect(birdPosition(f, 0, 0)).not.toEqual(birdPosition(f, 0, 5));
  });
});

describe("routes", () => {
  const open: LifeRoute = { points: [[0, 0, 0], [10, 0, 0], [10, 0, 10]], closed: false };
  const closed: LifeRoute = { points: [[0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]], closed: true };

  it("measures length, closing a loop back to its start", () => {
    expect(routeLength(open)).toBe(20);
    expect(routeLength(closed)).toBe(40);
  });

  it("walks an open route back and forth and a closed one round and round", () => {
    expect(samplePath(open, 5)).toMatchObject({ x: 5, z: 0 });
    expect(samplePath(open, 25)).toMatchObject({ x: 10, z: 5 });
    expect(samplePath(open, 45)).toMatchObject({ x: 5, z: 0 });
    expect(samplePath(closed, 45)).toMatchObject({ x: 5, z: 0 });
    expect(samplePath(closed, 35)).toMatchObject({ x: 0, z: 5 });
  });

  it("faces the way it is going, and turns round on the way back", () => {
    expect(samplePath(open, 5).heading).toBeCloseTo(Math.PI / 2);
    expect(samplePath(open, 35).heading).toBeCloseTo(Math.PI / 2 + Math.PI);
  });

  it("copes with a single point", () => {
    expect(samplePath({ points: [[3, 1, 4]], closed: false }, 99)).toMatchObject({ x: 3, y: 1, z: 4 });
  });
});
