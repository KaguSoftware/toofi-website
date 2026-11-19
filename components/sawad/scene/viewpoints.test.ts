import { describe, expect, it } from "vitest";
import { isRiver, terrainHeight } from "./layout";
import { FILM_BLEND_SECONDS, FILM_HOLD_SECONDS, TOUR_SECONDS, VIEW_IDS, easeOutExpo, filmPose, lerpCamera, tourAngleNear, tourPose, viewpoints } from "./viewpoints";
import type { SceneVariant } from "./types";

const VARIANTS: SceneVariant[] = ["dijla", "zaitun", "shatt"];

describe("viewpoints", () => {
  it("defines all four views for every variant, above the ground", () => {
    for (const v of VARIANTS) {
      const views = viewpoints(v);
      expect(Object.keys(views).sort()).toEqual([...VIEW_IDS].sort());
      for (const id of VIEW_IDS) {
        const [x, y, z] = views[id].position;
        expect(y).toBeGreaterThan(terrainHeight(v, x, z));
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

  it("tours the whole compound in one closed circuit that stays well above the ground", () => {
    for (const v of VARIANTS) {
      const angles = new Set<number>();
      for (let s = 0; s < TOUR_SECONDS; s += 0.5) {
        const { position: [x, y, z], fov } = tourPose(v, s);
        expect(y).toBeGreaterThanOrEqual(terrainHeight(v, x, z) + 18);
        expect(Math.hypot(x, z + 20)).toBeGreaterThan(180); // never over the rooftops
        expect(fov).toBeGreaterThan(38);
        angles.add(Math.floor(((Math.atan2(z + 20, x) + Math.PI) / (2 * Math.PI)) * 12) % 12);
      }
      expect(angles.size).toBe(12); // every side of the compound
      const a = tourPose(v, 0);
      const b = tourPose(v, TOUR_SECONDS);
      a.position.forEach((n, i) => expect(b.position[i]).toBeCloseTo(n, 6));
    }
  });

  it("moves slowly and smoothly, low over the water and high over the land", () => {
    let low = Infinity;
    let high = 0;
    for (let s = 0; s < TOUR_SECONDS; s += 0.1) {
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
    for (const start of VIEW_IDS) {
      const open = viewpoints("dijla")[start];
      expect(filmPose("dijla", start, 0)).toEqual(open);
      expect(filmPose("dijla", start, FILM_HOLD_SECONDS)).toEqual(open);
      let prev = filmPose("dijla", start, FILM_HOLD_SECONDS).position;
      for (let s = FILM_HOLD_SECONDS; s < FILM_HOLD_SECONDS + FILM_BLEND_SECONDS + 2; s += 0.1) {
        const p = filmPose("dijla", start, s + 0.1).position;
        expect(Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])).toBeLessThan(6);
        prev = p;
      }
      const t = FILM_HOLD_SECONDS + FILM_BLEND_SECONDS + 20;
      expect(filmPose("dijla", start, t)).toEqual(tourPose("dijla", t - FILM_HOLD_SECONDS, tourAngleNear(open.position)));
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
