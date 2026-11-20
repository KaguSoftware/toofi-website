import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planLife } from "../../../components/sawad/scene/landscape";
import { posters, stills, vegetation } from "./scene.mjs";

/*
 * film.py runs inside Blender, so this checks what it wrote: film.report.json (cameras, counts,
 * renders) and the posters it put in public/sawad/. Re-run film.py (render.sh posters|stills|preview)
 * after changing the shots, the scene data or the look, and these stay green.
 */

type Camera = { eye: number[]; forward: number[]; fovVerticalDeg: number | null };
type Report = {
  look: { viewTransform: string; exposureDay: number; exposureDusk: number; motionBlurShutter: number };
  exposureWeb: { day: number; dusk: number };
  haze: { color: string; density: number };
  vegetation: Record<string, number>;
  life: { people: number; cars: number; birds: number };
  duskLights: Record<string, number>;
  cameras: Record<string, { lens: number; fStop: number; sensorWidth: number }>;
  posters: Array<{ id: string; file: string; bytes: number; camera: Camera }>;
  stills: Array<{ id: string; frame: number }>;
};

const root = new URL("../../../", import.meta.url);
const report = JSON.parse(readFileSync(new URL("./film.report.json", import.meta.url), "utf8")) as Report;
const shots = JSON.parse(readFileSync(new URL("./shots.json", import.meta.url), "utf8")) as { shots: Array<{ id: string; lens: number; fStop: number }>; sensorWidth: number };

/** Width and height from a baseline or progressive JPEG's frame header. */
function jpegSize(buf: Buffer): [number, number] {
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  throw new Error("no frame header");
}

describe("film.py: the posters", () => {
  it("rendered all four web viewpoints", () => {
    expect(report.posters.map((p) => p.id).sort()).toEqual(posters().map((p) => p.id).sort());
  });

  it("framed each one exactly as the web's opening shot", () => {
    for (const p of posters()) {
      const r = report.posters.find((x) => x.id === p.id)!;
      r.camera.eye.forEach((v, k) => expect(v).toBeCloseTo(p.position[k], 2));
      const d = p.target.map((v, k) => v - p.position[k]);
      const n = Math.hypot(...d);
      r.camera.forward.forEach((v, k) => expect(v).toBeCloseTo(d[k] / n, 3));
      expect(r.camera.fovVerticalDeg).toBeCloseTo(p.fovVertical, 2);
    }
  });

  it("wrote 1920 x 1080 JPEGs where the site serves them", () => {
    for (const p of posters()) {
      const path = new URL(p.file, root);
      expect(existsSync(path)).toBe(true);
      expect(jpegSize(readFileSync(path))).toEqual([p.width, p.height]);
    }
  });

  it("tone mapped them as the web canvas does", () => {
    expect(report.exposureWeb.day).toBe(0.5);
    expect(report.haze.color).toBe("#e6ae86");
  });
});

describe("film.py: the film and stills", () => {
  it("built every shot's camera with its lens and aperture", () => {
    for (const s of shots.shots) {
      const cam = report.cameras[s.id];
      expect(cam.lens).toBeCloseTo(s.lens, 5);
      expect(cam.fStop).toBeCloseTo(s.fStop, 5);
      expect(cam.sensorWidth).toBe(shots.sensorWidth);
    }
  });

  it("rendered the stills at the frames scene.mjs picks", () => {
    const want = stills().map((s) => ({ id: s.id, frame: s.frame }));
    expect(report.stills.map(({ id, frame }) => ({ id, frame })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(want.sort((a, b) => a.id.localeCompare(b.id)));
  });

  it("placed every plant, person, car and bird of the web scene", () => {
    for (const v of vegetation()) expect(report.vegetation[v.id]).toBe(v.count);
    const life = planLife("high");
    expect(report.life.people).toBe(life.walkers.length);
    expect(report.life.cars).toBe(life.moving.length + life.parked.length);
    expect(report.life.birds).toBe(life.flocks.reduce((n, f) => n + f.count, 0));
  });

  it("lights the dusk with track 4's fittings and keeps the look subtle", () => {
    expect(report.duskLights["street-lamp"]).toBeGreaterThan(100);
    expect(report.look.viewTransform).toBe("AgX");
    expect(report.look.exposureDusk).toBeGreaterThan(report.look.exposureDay);
    expect(report.look.motionBlurShutter).toBeLessThanOrEqual(0.5);
  });
});
