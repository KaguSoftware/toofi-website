import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planLandscape, planLife } from "../../../components/sawad/scene/landscape";
import { walkerPose } from "../../../components/sawad/scene/lifeMotion";
import { planGroundAxes, planPoolWater } from "../../../components/sawad/scene/planWorld";
import { planTerrainHeight, riverGeometryParams } from "../../../components/sawad/scene/layout";
import { speciesFor } from "../../../components/sawad/scene/vegetation";
import { viewpoints } from "../../../components/sawad/scene/viewpoints";
import {
  HERO_OLIVE_CLEARANCE,
  POSTER,
  STILL,
  filmLandscape,
  frameIn,
  groundGrid,
  heroOlive,
  life,
  pfm,
  posters,
  secondsAt,
  shotById,
  stills,
  terrainMesh,
  vegetation,
  verticalCut,
} from "./scene.mjs";

type Shot = { id: string; startFrame: number; endFrame: number; light: string; vertical?: { seconds: number; center: number } };
const plan = JSON.parse(readFileSync(new URL("./shots.json", import.meta.url), "utf8")) as { fps: number; frames: number; vertical: { seconds: number }; shots: Shot[] };

describe("film scene: clock and shots", () => {
  it("runs one clock from frame 1 at t = 0", () => {
    expect(secondsAt(1)).toBe(0);
    expect(secondsAt(plan.fps + 1)).toBe(1);
  });

  it("finds frames inside a shot", () => {
    const s = shotById("04");
    expect(frameIn(s, 0)).toBe(s.startFrame);
    expect(frameIn(s, 1)).toBe(s.endFrame);
    expect(() => shotById("99")).toThrow();
  });
});

describe("film scene: vegetation", () => {
  it("plants the hero olive for the 05d detail and clears its neighbours", () => {
    const hero = heroOlive();
    const land = filmLandscape();
    expect(land.olives).toContainEqual(hero);
    const near = land.olives.filter((o) => o.cell !== "hero" && Math.hypot(o.x - hero.x, o.z - hero.z) <= HERO_OLIVE_CLEARANCE);
    expect(near).toHaveLength(0);
    // Everything else is 3B's landscape, untouched.
    const base = planLandscape("high");
    expect(land.palms).toEqual(base.palms);
    expect(land.olives.length).toBeLessThanOrEqual(base.olives.length + 1);
  });

  it("places every species the web places, at the finest level, one matrix per plant", () => {
    const land = filmLandscape();
    const veg = vegetation(land);
    const web = speciesFor(land, "high");
    expect(veg.map((v) => v.id)).toEqual(web.map((s) => s.id));
    for (const v of veg) {
      expect(v.matrices).toHaveLength(v.count * 16);
      expect(v.count).toBe(web.find((s) => s.id === v.id)!.matrices.length / 16);
    }
    for (const id of ["olive-a", "olive-b", "palm", "citrus"]) expect(veg.find((v) => v.id === id)!.node).toBe(`${id}_LOD0`);
  });
});

describe("film scene: life", () => {
  const frames = 48;
  const l = life(frames);
  const web = planLife("high");

  it("samples every actor on every frame", () => {
    expect(l.walkers).toHaveLength(web.walkers.length);
    expect(l.cars).toHaveLength(web.moving.length);
    expect(l.parked).toHaveLength(web.parked.length);
    for (const w of l.walkers) expect(w.track).toHaveLength(w.moving ? frames * 4 : 4);
    for (const c of l.cars) expect(c.track).toHaveLength(frames * 5);
    for (const b of l.birds) expect(b.track).toHaveLength(frames * 6);
  });

  it("moves people exactly as the web does", () => {
    const i = l.walkers.findIndex((w) => w.moving);
    const at = 30;
    const pose = walkerPose(web.walkers[i], secondsAt(at + 1));
    const t = l.walkers[i].track.slice(at * 4, at * 4 + 3);
    expect(t[0]).toBeCloseTo(pose.x, 2);
    expect(t[1]).toBeCloseTo(pose.y, 2);
    expect(t[2]).toBeCloseTo(pose.z, 2);
  });

  it("keeps wing weights between 0 and 1", () => {
    for (const b of l.birds.slice(0, 5)) {
      for (let f = 0; f < frames; f++) {
        for (const w of b.track.slice(f * 6 + 4, f * 6 + 6)) {
          expect(w).toBeGreaterThanOrEqual(0);
          expect(w).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("film scene: terrain", () => {
  const t = terrainMesh();

  it("is the web's own ground grid, out to the horizon", () => {
    const { xs, zs } = planGroundAxes("high");
    expect(t.xs).toHaveLength(xs.length);
    expect(t.zs).toHaveLength(zs.length);
    expect(t.xs[0]).toBe(-1800);
    expect(t.xs.at(-1)).toBe(1800);
    expect(t.heights).toHaveLength(xs.length * zs.length);
    expect(t.colors).toHaveLength(xs.length * zs.length * 3);
    const j = Math.floor(zs.length / 2);
    const i = Math.floor(xs.length / 3);
    expect(t.heights[j * xs.length + i]).toBeCloseTo(planTerrainHeight(xs[i], zs[j]), 2);
  });

  it("lays the stream under the whole valley and the pool inside its rim, as the web does", () => {
    const r = riverGeometryParams("zaitun");
    expect(t.stream.minX).toBe(-1800);
    expect(t.stream.maxX).toBe(1800);
    expect(t.stream.y).toBe(0);
    expect(t.stream.minZ).toBeLessThan(r.near);
    expect(t.stream.maxZ).toBeGreaterThan(r.near + r.width);
    expect((t.stream.minZ + t.stream.maxZ) / 2).toBeCloseTo(r.near + r.width / 2, 5);
    expect(t.pool).toEqual(planPoolWater());
  });
});

describe("film scene: ground", () => {
  it("covers the model's terrain with linear colours", () => {
    const layout = JSON.parse(readFileSync(new URL("../layout.json", import.meta.url), "utf8"));
    const t = layout.masterplan.terrain;
    const g = groundGrid(4);
    expect(g.minX).toBe(t.minX);
    expect((g.width - 1) * 4).toBe((t.columns - 1) * t.step);
    expect((g.height - 1) * 4).toBe((t.rows - 1) * t.step);
    expect(g.rgb).toHaveLength(g.width * g.height * 3);
    expect(Math.min(...g.rgb)).toBeGreaterThan(0);
    expect(Math.max(...g.rgb)).toBeLessThan(1);
  });

  it("writes a little-endian PFM", () => {
    const buf = pfm({ width: 2, height: 1, rgb: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) });
    expect(buf.subarray(0, 12).toString("ascii")).toBe("PF\n2 1\n-1.0\n");
    expect(buf.readFloatLE(12 + 4 * 5)).toBeCloseTo(0.6, 5);
  });
});

describe("film scene: posters, stills and the vertical cut", () => {
  it("frames the posters exactly as the web's opening shots", () => {
    const views = viewpoints("zaitun");
    const p = posters();
    expect(p.map((x) => x.id)).toEqual(["flight", "street", "terrace", "aerial"]);
    for (const x of p) {
      expect(x.position).toEqual(views[x.id as keyof typeof views].position);
      expect(x.target).toEqual(views[x.id as keyof typeof views].target);
      expect(x.fovVertical).toBe(views[x.id as keyof typeof views].fov);
      expect(x.file).toBe(`public/sawad/scene-zaitun-${x.id}.jpg`);
      expect([x.width, x.height]).toEqual([POSTER.width, POSTER.height]);
    }
  });

  it("picks 8 to 10 4K stills inside their shots, covering the brief's kinds", () => {
    const s = stills();
    expect(s.length).toBeGreaterThanOrEqual(8);
    expect(s.length).toBeLessThanOrEqual(10);
    expect(new Set(s.map((x) => x.id)).size).toBe(s.length);
    for (const x of s) {
      const shot = shotById(x.shot);
      expect(x.frame).toBeGreaterThanOrEqual(shot.startFrame);
      expect(x.frame).toBeLessThanOrEqual(shot.endFrame);
      expect([x.width, x.height]).toEqual([STILL.width, STILL.height]);
    }
    for (const kind of ["aerial hero", "eye level", "detail", "dusk"]) expect(s.some((x) => x.kind === kind)).toBe(true);
  });

  it("cuts 15 s for the vertical film from the marked shots, ending on the end card", () => {
    const cut = verticalCut();
    const marked = plan.shots.filter((s) => s.vertical);
    expect(cut.map((c) => c.shot)).toEqual(marked.map((s) => s.id));
    const frames = cut.reduce((t, c) => t + c.lastFrame - c.firstFrame + 1, 0);
    expect(frames).toBe(plan.vertical.seconds * plan.fps);
    for (const c of cut) {
      const shot = shotById(c.shot);
      expect(c.firstFrame).toBeGreaterThanOrEqual(shot.startFrame);
      expect(c.lastFrame).toBeLessThanOrEqual(shot.endFrame);
      expect(c.center).toBe(shot.vertical!.center);
    }
    expect(cut.at(-1)!.lastFrame).toBe(plan.frames);
  });
});
