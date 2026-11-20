// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { planLandscape } from "../scene/landscape";
import { planAmenities, planApartmentBlocks, planGates, planLamps, planVilla, planVillas } from "../scene/layout";
import { siteFor } from "../scene/site";
import type { ViewId } from "../scene/types";
import { VIEW_IDS, viewpoints } from "../scene/viewpoints";
import { BEATS, INTRO_SECONDS, STORY_END } from "./beats";
import { HERO_HOME_ID, HERO_VILLA_SLOT, STORY_CAMERA, introKeys, introObject, storyKeys, storyTracks } from "./story";
import { storyPose } from "./storySheet";

const site = siteFor("zaitun");
const land = planLandscape("high");
// Crowns as cylinders: palms carry theirs on the top third of the trunk, olives from knee height.
const trees = [
  ...land.palms.map((p) => ({ x: p.x, z: p.z, base: p.y, radius: 4, top: 13 * p.scale + 1, crownFrom: 13 * p.scale * 0.62 })),
  ...land.olives.map((p) => ({ x: p.x, z: p.z, base: p.y, radius: 3 * p.scale, top: 5.5 * p.scale + 1, crownFrom: 0.5 })),
];
const lamps = planLamps();
const buildings = [
  ...planVillas().map((v) => ({ id: `villa-${v.index}`, minX: v.x - v.width / 2, maxX: v.x + v.width / 2, minZ: v.z - v.depth / 2, maxZ: v.z + v.depth / 2, top: v.y + v.height + 3 })),
  ...planApartmentBlocks().map((b) => ({ id: `block-${b.index}`, minX: b.x - b.width / 2, maxX: b.x + b.width / 2, minZ: b.backZ, maxZ: b.backZ + b.floorDepths[0], top: b.y + b.floors * b.floorHeight + 1 })),
  ...planAmenities()
    .filter((a) => ["gym", "mosque", "gallery", "playground", "padel", "tennis"].includes(a.kind))
    .map((a) => ({ id: a.id, ...a.footprint, top: a.y + (a.kind === "mosque" ? 19 : a.kind === "gym" || a.kind === "gallery" ? 9 : 6) })),
];

/** Everything the camera would be inside of at a point, by name. */
function collisions(x: number, y: number, z: number): string[] {
  const hits: string[] = [];
  if (y - Math.max(site.ground(x, z), 0) < 1.4) hits.push("ground");
  for (const b of buildings) if (x > b.minX - 1.5 && x < b.maxX + 1.5 && z > b.minZ - 1.5 && z < b.maxZ + 1.5 && y < b.top) hits.push(b.id);
  for (const l of lamps) if (Math.hypot(x - l.x, z - l.z) < 1.2 && y < l.y + 6.4) hits.push("lamp");
  for (const t of trees) {
    const d = Math.hypot(x - t.x, z - t.z);
    if (d < t.radius && y > t.base + t.crownFrom && y < t.base + t.top) hits.push("crown");
    else if (d < 0.9 && y < t.base + t.top) hits.push("trunk");
  }
  return hits;
}

/** Samples a stretch of the sheet and returns what it runs into, with the top speed in metres per sequence second. */
function fly(view: ViewId, from: number, to: number, step = 0.125) {
  const hits: string[] = [];
  let speed = 0;
  let turn = 0;
  let prev = storyPose(view, from);
  for (let p = from; p <= to + 1e-9; p += step) {
    const pose = storyPose(view, p);
    const [x, y, z] = pose.position;
    for (const h of collisions(x, y, z)) hits.push(`${h} at ${p.toFixed(2)} (${x.toFixed(0)}, ${y.toFixed(1)}, ${z.toFixed(0)})`);
    speed = Math.max(speed, Math.hypot(x - prev.position[0], y - prev.position[1], z - prev.position[2]) / step);
    const heading = (q: typeof pose) => Math.atan2(q.target[0] - q.position[0], q.target[2] - q.position[2]);
    let d = Math.abs(heading(pose) - heading(prev));
    if (d > Math.PI) d = 2 * Math.PI - d;
    turn = Math.max(turn, d / step);
    prev = pose;
  }
  return { hits, speed, turn };
}

describe("the story's keys", () => {
  it("opens every start view on its poster frame and ends it outside the main gate", () => {
    const gate = planGates()[0];
    for (const view of VIEW_IDS) {
      const keys = introKeys(view);
      const open = viewpoints("zaitun")[view];
      expect(keys[0]).toMatchObject({ at: 0, position: open.position, target: open.target, fov: open.fov });
      const last = keys.at(-1)!;
      expect(last.at).toBe(INTRO_SECONDS);
      expect(last.position[0]).toBeLessThan(gate.x); // outside the wall
      expect(last.target[0]).toBeGreaterThan(gate.x); // looking in through the gate
      expect(Math.abs(last.position[2] - gate.z)).toBeLessThan(3);
    }
  });

  it("starts the scroll path exactly where the openings end", () => {
    const first = storyKeys()[0];
    expect(first.at).toBe(INTRO_SECONDS);
    for (const view of VIEW_IDS) expect(introKeys(view).at(-1)).toEqual(first);
  });

  it("runs in order to the end of the sequence, resting on every beat's own shot", () => {
    const keys = storyKeys();
    for (let i = 1; i < keys.length; i++) expect(keys[i].at).toBeGreaterThan(keys[i - 1].at);
    expect(keys.at(-1)!.at).toBe(STORY_END);
    expect(keys.at(-1)!.ease).toBe("rest");
    // Each beat holds at least one composed frame the camera settles on.
    for (const beat of BEATS) expect(keys.some((k) => k.ease === "rest" && k.at > beat.from - 1e-9 && k.at <= beat.to + 4)).toBe(true);
  });

  it("uses real lenses: 24 to 85 mm on a full-frame sensor", () => {
    // Vertical field of view of a 24 mm lens is 53 degrees at 16:9 crop, of an 85 mm about 13.
    for (const keys of Object.values(storyTracks())) {
      for (const k of keys) {
        expect(k.fov).toBeGreaterThanOrEqual(13);
        expect(k.fov).toBeLessThanOrEqual(56);
      }
    }
  });

  it("gives every key a focus distance and a blur between 0 and 1", () => {
    for (const keys of Object.values(storyTracks())) {
      for (const k of keys) {
        expect(k.focus).toBeGreaterThan(0.5);
        expect(k.blur).toBeGreaterThanOrEqual(0);
        expect(k.blur).toBeLessThanOrEqual(1);
      }
    }
  });

  it("names one Theatre object per opening plus the story camera", () => {
    expect(Object.keys(storyTracks()).sort()).toEqual([STORY_CAMERA, ...VIEW_IDS.map(introObject)].sort());
  });

  it("stops at the courtyard villa the finder calls ZH-V05, looking at its entrance front", () => {
    const hero = planVilla(HERO_VILLA_SLOT);
    expect(hero.type).toBe("courtyard");
    expect(HERO_HOME_ID).toBe(`ZH-V${String(HERO_VILLA_SLOT + 1).padStart(2, "0")}`);
    const villa = BEATS.find((b) => b.id === "villa")!;
    const pose = storyPose("flight", villa.at);
    // On the far side of the boulevard from the villa, facing it.
    expect(Math.sign(pose.position[2] - hero.z)).toBe(hero.facing);
    expect(Math.abs(pose.target[0] - hero.x)).toBeLessThan(hero.width / 2);
  });
});

describe("the camera's path", () => {
  it("never passes through the ground, a building, a lamp or a tree on the scroll path", () => {
    expect(fly("flight", INTRO_SECONDS, STORY_END).hits).toEqual([]);
  });

  it("clears them on all four openings", () => {
    for (const view of VIEW_IDS) {
      // The terrace opening starts standing on an apartment terrace: judge it once it has stepped off.
      expect(fly(view, view === "terrace" ? 1.25 : 0, INTRO_SECONDS).hits, view).toEqual([]);
    }
  });

  it("keeps eye-level shots at eye level on the sidewalk", () => {
    const street = BEATS.find((b) => b.id === "boulevard")!;
    const pose = storyPose("flight", street.at);
    const height = pose.position[1] - site.ground(pose.position[0], pose.position[2]);
    expect(height).toBeGreaterThan(1.4);
    expect(height).toBeLessThan(2.2);
  });

  it("moves slowly on the default opening and turns gently everywhere", () => {
    const intro = fly("flight", 0, INTRO_SECONDS);
    expect(intro.speed).toBeLessThan(45); // metres per second, high above the valley
    const path = fly("flight", INTRO_SECONDS, STORY_END);
    expect(path.speed).toBeLessThan(65); // metres per sequence second; the scroll sets the real pace
    // Never a whip pan: under 32 degrees per sequence second.
    expect(Math.max(intro.turn, path.turn)).toBeLessThan((32 * Math.PI) / 180);
  });

  it("eases in and out of every resting frame", () => {
    for (const k of storyKeys().filter((key) => key.ease === "rest" && key.at > INTRO_SECONDS && key.at < STORY_END)) {
      const before = storyPose("flight", k.at - 0.05).position;
      const at = storyPose("flight", k.at).position;
      const after = storyPose("flight", k.at + 0.05).position;
      const speed = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 0.05;
      expect(speed(before, at), `into ${k.at}`).toBeLessThan(3);
      expect(speed(at, after), `out of ${k.at}`).toBeLessThan(3);
    }
  });
});
