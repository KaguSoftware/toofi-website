import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { planGates, planRiverCenterZ, planTerrainHeight, planVillas, riverGeometryParams } from "../../../components/sawad/scene/layout";
import { indicativeTrees } from "../../draw-masterplan.mjs";
import {
  FILM_GROUND,
  FPS,
  HERO_GATE,
  HERO_VILLA,
  SENSOR_WIDTH,
  SHOTS_PATH,
  VERTICAL,
  cameraPose,
  ease,
  fieldOfView,
  filmPlan,
  filmSeconds,
  filmShots,
  filmTerrain,
  filmTrees,
  groundAt,
  poseAt,
  writeFilm,
} from "./shots.mjs";

type Vec = { x: number; y: number; z: number };
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const shots = filmShots();
const byId = (id: string) => {
  const shot = shots.find((s) => s.id === id);
  expect(shot, `shot ${id}`).toBeDefined();
  return shot!;
};

const dir = mkdtempSync(join(tmpdir(), "zaitun-film-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the film's shot list", () => {
  it("runs 60–90 s and covers the brief's eight shots in order", () => {
    const seconds = filmSeconds(shots);
    expect(seconds).toBeGreaterThanOrEqual(60);
    expect(seconds).toBeLessThanOrEqual(90);
    const numbers = shots.map((s) => Number(s.id.slice(0, 2)));
    expect([...new Set(numbers)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it("lays the shots end to end on one 24 fps timeline", () => {
    let next = 1;
    for (const s of shots) {
      expect(s.startFrame).toBe(next);
      expect(s.endFrame - s.startFrame + 1).toBe(Math.round(s.seconds * FPS));
      next = s.endFrame + 1;
    }
    expect(filmPlan().frames).toBe(next - 1);
  });

  it("uses real lenses: wide for establishing shots, 85 mm with shallow focus for details", () => {
    for (const s of shots) {
      expect(s.lens, s.id).toBeGreaterThanOrEqual(18);
      expect(s.lens, s.id).toBeLessThanOrEqual(135);
    }
    for (const id of ["01", "02", "07", "08"]) {
      expect(byId(id).lens).toBeGreaterThanOrEqual(24);
      expect(byId(id).lens).toBeLessThanOrEqual(35);
    }
    const details = shots.filter((s) => s.id.startsWith("05"));
    expect(details.length).toBeGreaterThanOrEqual(4);
    for (const s of details) {
      expect(s.lens).toBe(85);
      expect(s.fStop).toBeLessThanOrEqual(2.8);
    }
  });

  it("never puts a camera underground or in the water", () => {
    for (const s of shots) {
      for (let i = 0; i <= 40; i++) {
        const { eye } = poseAt(s, i / 40);
        expect(eye.y - groundAt(eye.x, eye.z), `${s.id} at ${i / 40}`).toBeGreaterThanOrEqual(0.5);
        expect(eye.y, `${s.id} above the water`).toBeGreaterThan(0.5);
      }
    }
  });

  it("moves slowly and eases in and out of every move", () => {
    for (const s of shots) {
      const n = 200;
      const step = s.seconds / n;
      const speeds: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = poseAt(s, i / n);
        const b = poseAt(s, (i + 1) / n);
        const speed = dist(a.eye, b.eye) / step;
        speeds.push(speed);
        // How fast the picture changes: speed over the distance to what the camera looks at.
        expect(speed / dist(a.eye, a.target), `${s.id} sweep`).toBeLessThan(0.11);
        const turn = Math.abs(cameraPose(b, s.lens, s.level).yawDeg - cameraPose(a, s.lens, s.level).yawDeg) % 360;
        expect(Math.min(turn, 360 - turn) / step, `${s.id} pan`).toBeLessThan(8);
      }
      const peak = Math.max(...speeds);
      if (peak > 0) {
        expect(speeds[0] / peak, `${s.id} eases in`).toBeLessThan(0.05);
        expect(speeds.at(-1)! / peak, `${s.id} eases out`).toBeLessThan(0.05);
      }
    }
    // Eye-level moves stay at walking pace.
    for (const id of ["03", "04", "06a", "06b"]) {
      const s = byId(id);
      const travel = dist(s.keys[0].eye, s.keys.at(-1)!.eye);
      expect(travel / s.seconds, id).toBeLessThan(1.5);
    }
  });

  it("keeps verticals straight on architecture shots: level camera, lens shift within limits", () => {
    for (const s of shots.filter((s) => s.level)) {
      for (const k of s.keys) {
        expect(k.pitchDeg).toBe(0);
        expect(Math.abs(k.shiftY), s.id).toBeLessThanOrEqual(0.3);
      }
    }
    for (const id of ["03", "04", "05a", "05b", "06a", "06b", "07"]) expect(byId(id).level, id).toBe(true);
    for (const s of shots.filter((s) => !s.level)) {
      for (const k of s.keys) expect(k.shiftY).toBe(0);
    }
  });

  it("frames the right places from the layout", () => {
    expect(HERO_VILLA.type).toBe("courtyard");
    expect(HERO_VILLA.row).toBe("waterfront");
    expect(planVillas()).toContainEqual(HERO_VILLA);
    expect(planGates()).toContainEqual(HERO_GATE);
    const named = JSON.parse(readFileSync(join(__dirname, "..", "layout.json"), "utf8")).masterplan.villas.find((v: { name: string }) => v.name === filmPlan().hero.villa);
    expect(named?.index).toBe(HERO_VILLA.index);
    // The hero push-in looks at the villa's garden facade, square on.
    const push = byId("04");
    for (const k of push.keys) {
      expect(Math.abs(k.target.x - HERO_VILLA.x)).toBeLessThan(HERO_VILLA.width / 2);
      expect(k.target.z).toBeCloseTo(HERO_VILLA.z + HERO_VILLA.depth / 2, 3);
      expect(k.yawDeg).toBeCloseTo(0, 3);
    }
    // The crane starts on the lintel, outside the gate, and ends looking down the boulevard.
    const crane = byId("02");
    expect(crane.keys[0].target.x).toBe(HERO_GATE.x);
    expect(crane.keys[0].eye.x).toBeGreaterThan(HERO_GATE.x);
    expect(crane.keys.at(-1)!.pitchDeg).toBeLessThan(0);
  });

  it("goes from golden hour through the time-lapse to blue hour", () => {
    const order = shots.map((s) => s.light);
    const lapse = order.indexOf("day-to-dusk");
    expect(lapse).toBeGreaterThan(0);
    expect(order.slice(0, lapse).every((l) => l === "day")).toBe(true);
    expect(order.slice(lapse + 1).every((l) => l === "dusk")).toBe(true);
    const tl = shots[lapse];
    expect(tl.keys[0].eye).toEqual(tl.keys.at(-1)!.eye);
    expect(tl.boards).toEqual([0, 0.5, 1]);
  });

  it("picks 15 s of the film for the vertical cut", () => {
    const parts = shots.filter((s) => s.vertical);
    const total = parts.reduce((t, s) => t + s.vertical!.seconds, 0);
    expect(total).toBe(VERTICAL.seconds);
    for (const s of parts) {
      expect(s.vertical!.seconds).toBeLessThanOrEqual(s.seconds);
      expect(s.vertical!.center).toBeGreaterThanOrEqual(0);
      expect(s.vertical!.center).toBeLessThanOrEqual(1);
    }
  });

  it("writes shots.json exactly as the shot list says (regenerate with node scripts/blender/film/shots.mjs)", () => {
    const committed = JSON.parse(readFileSync(SHOTS_PATH, "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(filmPlan())));
  });

  it("writes the shot list and the greybox data", () => {
    const shotsPath = join(dir, "shots.json");
    const greyPath = join(dir, "out", "greybox.json");
    const plan = writeFilm(shotsPath, greyPath);
    expect(JSON.parse(readFileSync(shotsPath, "utf8")).seconds).toBe(plan.seconds);
    const grey = JSON.parse(readFileSync(greyPath, "utf8"));
    expect(grey.terrain.columns).toBe(filmTerrain().columns);
    expect(grey.trees.olive.length).toBeGreaterThan(1000);
  });
});

describe("camera maths", () => {
  const eye = { x: 0, y: 2, z: 0 };

  it("turns the camera with Blender's yaw: 0 looks inland (-z), -90 downstream (+x)", () => {
    expect(cameraPose({ eye, target: { x: 0, y: 2, z: -10 } }, 35, false).yawDeg).toBeCloseTo(0, 6);
    expect(cameraPose({ eye, target: { x: 10, y: 2, z: 0 } }, 35, false).yawDeg).toBeCloseTo(-90, 6);
    expect(Math.abs(cameraPose({ eye, target: { x: 0, y: 2, z: 10 } }, 35, false).yawDeg)).toBeCloseTo(180, 6);
  });

  it("tilts a free camera, and shifts the lens of a level one by the same angle", () => {
    const target = { x: 0, y: 12, z: -10 };
    const free = cameraPose({ eye, target }, 36, false);
    expect(free.pitchDeg).toBeCloseTo(45, 6);
    expect(free.shiftY).toBe(0);
    const level = cameraPose({ eye, target }, 36, true);
    expect(level.pitchDeg).toBe(0);
    expect(level.shiftY).toBeCloseTo((36 / SENSOR_WIDTH) * Math.tan(Math.PI / 4), 4);
  });

  it("focuses on the target unless a key sets the distance", () => {
    expect(cameraPose({ eye, target: { x: 0, y: 2, z: -10 } }, 85, true).focus).toBe(10);
    expect(cameraPose({ eye, target: { x: 0, y: 2, z: -10 }, focus: 4 }, 85, true).focus).toBe(4);
  });

  it("gives the field of view of a lens on the 16:9 frame", () => {
    expect(fieldOfView(36).horizontal).toBeCloseTo(53.13, 1);
    expect(fieldOfView(24).vertical).toBeLessThan(fieldOfView(24).horizontal);
  });

  it("eases with zero speed at both ends", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBe(0.5);
    expect(ease(0.001)).toBeLessThan(0.0001);
  });

  it("holds still between identical keys", () => {
    const tl = byId("07");
    expect(poseAt(tl, 0.3)).toEqual(poseAt(tl, 0.9));
  });
});

describe("greybox data", () => {
  it("samples the ground from the plan's terrain function, beyond the site on every side", () => {
    const t = filmTerrain({ minX: -40, maxX: 40, minZ: -40, maxZ: 40, step: 20 });
    expect(t.columns).toBe(5);
    expect(t.rows).toBe(5);
    expect(t.heightsCm[1][3]).toBe(Math.round(planTerrainHeight(20, -20) * 100));
    expect(FILM_GROUND.minX).toBeLessThan(-430 - 500);
    expect(FILM_GROUND.maxZ).toBeGreaterThan(400);
  });

  it("keeps the masterplan drawing's trees and adds more outside it, none in the stream", () => {
    const trees = filmTrees();
    const drawn = indicativeTrees();
    expect(trees.palm.length).toBeGreaterThan(drawn["date-palm"].length);
    expect(trees.olive.length).toBeGreaterThan(drawn.olive.length);
    expect(trees.citrus.length).toBe(drawn.citrus.length);
    const r = riverGeometryParams("zaitun");
    for (const [x, y, z] of [...trees.palm, ...trees.olive]) {
      expect(Math.abs(z - planRiverCenterZ(x)) - r.width / 2).toBeGreaterThan(0);
      expect(y).toBeGreaterThanOrEqual(0);
    }
  });
});
