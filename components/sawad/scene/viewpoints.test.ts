import { describe, expect, it } from "vitest";
import { PLAN_LEVELS, PLAN_SITE, PLAN_STREET, isRiver, planApartmentBlocks, planBoulevardZ, planLandUseAt, planVillas, terrainHeight } from "./layout";
import { visibleTriangles } from "./landscape";
import { siteFor } from "./site";
import { FILM_BLEND_SECONDS, FILM_HOLD_SECONDS, VIEW_IDS, easeOutExpo, filmPose, lerpCamera, tourAngleNear, tourFor, tourPose, viewpoints } from "./viewpoints";
import type { SceneVariant, Vec3 } from "./types";
import type { CameraPose } from "./viewpoints";

const VARIANTS: SceneVariant[] = ["dijla", "zaitun", "shatt"];

/** A world point in normalised screen coordinates (-1..1 across the frame) for a camera pose. */
function project(pose: CameraPose, p: Vec3, aspect: number): [number, number] {
  const f = pose.target.map((n, i) => n - pose.position[i]);
  const fl = Math.hypot(...f);
  const fw = f.map((n) => n / fl);
  const right = [-fw[2], 0, fw[0]];
  const rl = Math.hypot(...right);
  const r = right.map((n) => n / rl);
  const up = [r[1] * fw[2] - r[2] * fw[1], r[2] * fw[0] - r[0] * fw[2], r[0] * fw[1] - r[1] * fw[0]];
  const d = p.map((n, i) => n - pose.position[i]);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const depth = dot(d, fw);
  const t = Math.tan((pose.fov * Math.PI) / 360);
  return [dot(d, r) / (depth * t * aspect), dot(d, up) / (depth * t)];
}

describe("viewpoints", () => {
  it("defines all four views for every variant, above the ground", () => {
    for (const v of VARIANTS) {
      const views = viewpoints(v);
      expect(Object.keys(views).sort()).toEqual([...VIEW_IDS].sort());
      for (const id of VIEW_IDS) {
        const [x, y, z] = views[id].position;
        expect(y).toBeGreaterThan(siteFor(v).ground(x, z));
        expect(views[id].fov).toBeGreaterThan(20);
      }
    }
  });

  it("matches the brief: low flight over water, street at eye level, terrace ~12 m, aerial high", () => {
    const views = viewpoints("dijla");
    const [fx, fy, fz] = views.flight.position;
    expect(isRiver("dijla", fx, fz)).toBe(true);
    expect(fy).toBeLessThan(25);
    expect(views.street.position[1] - terrainHeight("dijla", views.street.position[0], views.street.position[2])).toBeCloseTo(1.7, 1);
    expect(views.terrace.position[1]).toBeGreaterThan(10);
    expect(views.terrace.position[1]).toBeLessThan(16);
    expect(views.aerial.position[1]).toBeGreaterThan(120);
  });

  it("keeps Bustan Dijla and Shatt Gardens on the 7 ha shots", () => {
    for (const v of ["dijla", "shatt"] as const) {
      const views = viewpoints(v);
      expect(views.aerial).toEqual({ position: [-250, 150, -270], target: [10, 0, 10], fov: 40 });
      expect(views.street.position[0]).toBe(-168);
      expect(tourFor(v).seconds).toBe(150);
    }
  });

  it("frames Zaitun Hills on the 28 ha plan", () => {
    const views = viewpoints("zaitun");
    const site = siteFor("zaitun");
    // Low over the stream, upstream of the walls, looking downstream (toward the sun) across the homes.
    const [fx, fy, fz] = views.flight.position;
    expect(site.isWater(fx, fz)).toBe(true);
    expect(fx).toBeLessThan(PLAN_SITE.minX);
    expect(fy).toBeLessThan(30);
    expect(views.flight.target[0]).toBeGreaterThan(fx);
    // At eye level on boulevard A's sidewalk (clear of the cars), looking along the street.
    const [sx, sy, sz] = views.street.position;
    expect(sy - site.ground(sx, sz)).toBeCloseTo(1.7, 1);
    expect(planLandUseAt(sx, sz)).toBe("paving");
    // Not standing in a villa's drive.
    expect(planVillas().some((v) => sx >= v.driveway.minX - 2 && sx <= v.driveway.maxX + 2 && sz >= v.driveway.minZ && sz <= v.driveway.maxZ)).toBe(false);
    const offset = sz - planBoulevardZ("a", sx);
    expect(Math.abs(offset)).toBeGreaterThan(PLAN_STREET.carriageway / 2 + PLAN_STREET.verge);
    expect(views.street.target[2] - planBoulevardZ("a", views.street.target[0])).toBeCloseTo(offset, 6);
    // Tilted down just past the orbit limit (0.03 rad below the target), so the explorer keeps the camera at eye level.
    const [stx, sty, stz] = views.street.target;
    expect(Math.atan2(sy - sty, Math.hypot(stx - sx, stz - sz))).toBeGreaterThan(0.03);
    expect(Math.atan2(sy - sty, Math.hypot(stx - sx, stz - sz))).toBeLessThan(0.05);
    // On the third-floor terrace of the westernmost waterfront block, looking across the stream.
    const block = planApartmentBlocks()[0];
    const [tx, ty, tz] = views.terrace.position;
    expect(Math.abs(tx - block.x)).toBeLessThan(block.width / 2);
    expect(ty).toBeCloseTo(PLAN_LEVELS.valley + 3 * block.floorHeight + 1.65, 6);
    expect(tz).toBeGreaterThan(block.backZ);
    expect(tz).toBeLessThan(block.backZ + block.floorDepths[2]);
    expect(views.terrace.target[2]).toBeGreaterThan(site.river.far);
    // High enough to take in the whole wall: every corner of the site falls inside a 16:9 frame.
    const a = views.aerial;
    expect(a.position[1]).toBeGreaterThan(180);
    for (const [x, z] of [[PLAN_SITE.minX, PLAN_SITE.minZ], [PLAN_SITE.maxX, PLAN_SITE.minZ], [PLAN_SITE.minX, PLAN_SITE.maxZ], [PLAN_SITE.maxX, PLAN_SITE.maxZ]]) {
      const [u, v] = project(a, [x, PLAN_LEVELS.valley, z], 16 / 9);
      expect(Math.abs(u)).toBeLessThan(0.95);
      expect(Math.abs(v)).toBeLessThan(0.95);
    }
  });

  it("keeps every Zaitun Hills opening shot inside the vegetation's triangle budget (90k of 300k) on both tiers", () => {
    for (const tier of ["high", "low"] as const) {
      for (const id of VIEW_IDS) {
        const { position: [x, y, z], target: [tx, ty, tz] } = viewpoints("zaitun")[id];
        expect(visibleTriangles({ x, y, z }, { x: tx, y: ty, z: tz }, tier)).toBeLessThan(90_000);
      }
    }
  });

  it("tours the whole compound in one closed circuit that stays well above the ground", () => {
    for (const v of VARIANTS) {
      const tour = tourFor(v);
      const { center } = tour;
      const angles = new Set<number>();
      for (let s = 0; s < tour.seconds; s += 0.5) {
        const { position: [x, y, z], fov } = tourPose(v, s);
        expect(y).toBeGreaterThanOrEqual(siteFor(v).ground(x, z) + 18);
        expect(Math.hypot((x - center.x) / tour.radius.x, (z - center.z) / tour.radius.z)).toBeGreaterThan(0.55); // never over the rooftops
        expect(fov).toBeGreaterThan(38);
        angles.add(Math.floor(((Math.atan2(z - center.z, x - center.x) + Math.PI) / (2 * Math.PI)) * 12) % 12);
      }
      expect(angles.size).toBe(12); // every side of the compound
      const a = tourPose(v, 0);
      const b = tourPose(v, tour.seconds);
      a.position.forEach((n, i) => expect(b.position[i]).toBeCloseTo(n, 6));
    }
  });

  it("flies the 28 ha circuit at about the 7 ha ground speed, low on the stream side and high over the slopes", () => {
    let low = Infinity;
    let high = 0;
    const seconds = tourFor("zaitun").seconds;
    for (let s = 0; s < seconds; s += 0.1) {
      const [x0, y0, z0] = tourPose("zaitun", s).position;
      const [x1, y1, z1] = tourPose("zaitun", s + 0.1).position;
      expect(Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 0.1).toBeLessThan(22); // m/s
      if (z0 > siteFor("zaitun").river.near) low = Math.min(low, y0);
      if (z0 < PLAN_SITE.minZ) high = Math.max(high, y0);
    }
    expect(low).toBeLessThan(45);
    expect(high).toBeGreaterThan(110);
  });

  it("moves slowly and smoothly, low over the water and high over the land", () => {
    let low = Infinity;
    let high = 0;
    for (let s = 0; s < tourFor("dijla").seconds; s += 0.1) {
      const [x0, y0, z0] = tourPose("dijla", s).position;
      const [x1, y1, z1] = tourPose("dijla", s + 0.1).position;
      expect(Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 0.1).toBeLessThan(22); // m/s
      if (isRiver("dijla", x0, z0)) low = Math.min(low, y0);
      else high = Math.max(high, y0);
    }
    expect(low).toBeLessThan(40);
    expect(high).toBeGreaterThan(90);
  });

  it("opens on the chosen viewpoint, then glides into the tour without jumps", () => {
    for (const v of ["dijla", "zaitun"] as const) {
      for (const start of VIEW_IDS) {
        const open = viewpoints(v)[start];
        expect(filmPose(v, start, 0)).toEqual(open);
        expect(filmPose(v, start, FILM_HOLD_SECONDS)).toEqual(open);
        let prev = filmPose(v, start, FILM_HOLD_SECONDS).position;
        for (let s = FILM_HOLD_SECONDS; s < FILM_HOLD_SECONDS + FILM_BLEND_SECONDS + 2; s += 0.1) {
          const p = filmPose(v, start, s + 0.1).position;
          expect(Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])).toBeLessThan(v === "zaitun" ? 9 : 6);
          // The glide never passes through the ground (the foothills behind the 28 ha plan).
          expect(p[1]).toBeGreaterThan(siteFor(v).ground(p[0], p[2]));
          prev = p;
        }
        const t = FILM_HOLD_SECONDS + FILM_BLEND_SECONDS + 20;
        expect(filmPose(v, start, t)).toEqual(tourPose(v, t - FILM_HOLD_SECONDS, tourAngleNear(open.position, v)));
      }
    }
  });

  it("eases out exponentially and clamps", () => {
    expect(easeOutExpo(-1)).toBe(0);
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
    expect(easeOutExpo(2)).toBe(1);
    expect(easeOutExpo(0.5)).toBeGreaterThan(0.9);
  });

  it("interpolates camera poses", () => {
    const a = { position: [0, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number], fov: 40 };
    const b = { position: [10, 20, 30] as [number, number, number], target: [2, 2, 2] as [number, number, number], fov: 60 };
    expect(lerpCamera(a, b, 0.5)).toEqual({ position: [5, 10, 15], target: [1, 1, 1], fov: 50 });
    expect(lerpCamera(a, b, 3)).toEqual(b);
  });
});
