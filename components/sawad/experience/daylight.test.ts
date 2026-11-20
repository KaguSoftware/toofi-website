import { Color, DirectionalLight, FogExp2, HemisphereLight, MeshStandardMaterial, Scene, ShaderMaterial, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { createDaylight, DUSK, DUSK_SUN_ELEVATION_DEG, HANDOVER, handoverAmount, LAMP_BOOST, phases, smoothstep, stepDaylight, sunAtElevation, WINDOW_GLOW } from "./daylight";

function rig() {
  const scene = new Scene();
  scene.fog = new FogExp2("#aabbcc", 0.002);
  scene.background = new Color("#88aadd");
  scene.environmentIntensity = 0.9;
  const sky = new ShaderMaterial({
    uniforms: {
      uSunColor: { value: new Color(1, 0.9, 0.7) },
      uZenith: { value: new Color("#3070d0") },
      uHorizonAway: { value: new Color("#a0c0e0") },
      uHorizonSun: { value: new Color("#ffd8a0") },
      uGround: { value: new Color("#7a8070") },
      uSunDir: { value: new Vector3(0.8, 0.5, 0.33).normalize() },
      uSunDisc: { value: 1 },
    },
  });
  const water = new ShaderMaterial({
    uniforms: {
      uSunColor: { value: new Color(1, 0.9, 0.7) },
      uHorizon: { value: new Color("#a0c0e0") },
      uZenith: { value: new Color("#3070d0") },
      uDeep: { value: new Color("#104050") },
      uSunDir: { value: new Vector3(0.8, 0.5, 0.33).normalize() },
      uFogColor: { value: new Color("#aabbcc") },
      uFogDensity: { value: 0.002 },
    },
  });
  const sun = new DirectionalLight("#fff", 3);
  sun.userData.castsShadow = true;
  sun.castShadow = true;
  const hemisphere = new HemisphereLight("#bbddff", "#665544", 1.2);
  const windows = [new MeshStandardMaterial({ emissive: new Color("#000000"), emissiveIntensity: 0.1 })];
  const lamps = [new MeshStandardMaterial({ emissiveIntensity: 0.5 }), new MeshStandardMaterial({ emissiveIntensity: 1 })];
  const mirrors = [new MeshStandardMaterial({ envMapIntensity: 1.5 })];
  const gl = { toneMappingExposure: 0.5 };
  const onPracticals = vi.fn();
  const onSun = vi.fn();
  const onSky = vi.fn();
  const control = createDaylight({ gl, scene, sky, water, sun, hemisphere, windows, lamps, mirrors, onPracticals, onSun, onSky });
  return { scene, sky, water, sun, hemisphere, windows, lamps, mirrors, gl, onPracticals, onSun, onSky, control };
}

const sameColor = (a: Color, b: Color) => a.toArray().forEach((v, i) => expect(v).toBeCloseTo(b.toArray()[i], 9));
const u = <T>(m: ShaderMaterial, n: string) => m.uniforms[n].value as T;

describe("phases", () => {
  it("keeps practicals off in the first 40 percent and sun gone by the middle", () => {
    expect(phases(0)).toEqual({ sky: 0, practicals: 0, sun: 1 });
    expect(phases(0.4).practicals).toBe(0);
    expect(phases(0.5).sun).toBe(0);
    expect(phases(1)).toEqual({ sky: 1, practicals: 1, sun: 0 });
    expect(phases(0.5).sky).toBeCloseTo(0.5, 9);
  });

  it("smoothstep clamps and is symmetric", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
  });
});

describe("stepDaylight", () => {
  it("moves at 1 / seconds per second toward the target", () => {
    expect(stepDaylight(0, "dusk", 1)).toBeCloseTo(0.2, 9);
    expect(stepDaylight(1, "day", 2.5)).toBeCloseTo(0.5, 9);
    expect(stepDaylight(0, "dusk", 1, 10)).toBeCloseTo(0.1, 9);
  });

  it("clamps at the goal and holds there", () => {
    expect(stepDaylight(0.9, "dusk", 5)).toBe(1);
    expect(stepDaylight(0.1, "day", 5)).toBe(0);
    expect(stepDaylight(0, "day", 1)).toBe(0);
  });

  it("jumps at once when the duration is zero", () => {
    expect(stepDaylight(0, "dusk", 0.016, 0)).toBe(1);
  });
});

describe("sunAtElevation", () => {
  it("returns a unit vector at the elevation with the heading kept", () => {
    const from = new Vector3(3, 5, 4);
    const out = sunAtElevation(from, -5);
    expect(out.length()).toBeCloseTo(1, 9);
    expect(out.y).toBeCloseTo(Math.sin((-5 * Math.PI) / 180), 9);
    expect(out.z / out.x).toBeCloseTo(4 / 3, 9);
    expect(sunAtElevation(from, 90).y).toBeCloseTo(1, 9);
  });

  it("survives a straight-up sun", () => {
    expect(sunAtElevation(new Vector3(0, 1, 0), 10).y).toBeCloseTo(Math.sin((10 * Math.PI) / 180), 9);
  });
});

describe("createDaylight", () => {
  it("leaves every value exactly as captured at k = 0", () => {
    const r = rig();
    r.control.set(0);
    expect(r.gl.toneMappingExposure).toBe(0.5);
    expect(u<Color>(r.sky, "uZenith").getHexString()).toBe(new Color("#3070d0").getHexString());
    expect(u<Color>(r.sky, "uSunColor").toArray()).toEqual([1, 0.9, 0.7]);
    expect(u<number>(r.sky, "uSunDisc")).toBe(1);
    expect(u<Vector3>(r.sky, "uSunDir").y).toBeCloseTo(0.5 / Math.hypot(0.8, 0.5, 0.33), 9);
    expect(r.sun.intensity).toBe(3);
    expect(r.sun.castShadow).toBe(true);
    expect(r.hemisphere.intensity).toBeCloseTo(1.2, 9);
    expect((r.scene.fog as FogExp2).density).toBeCloseTo(0.002, 9);
    expect(r.scene.environmentIntensity).toBeCloseTo(0.9, 9);
    expect(r.windows[0].emissiveIntensity).toBeCloseTo(0.1, 9);
    expect(r.lamps.map((l) => l.emissiveIntensity)).toEqual([0.5, 1]);
    expect(r.mirrors[0].envMapIntensity).toBeCloseTo(1.5, 9);
  });

  it("reaches the dusk look at k = 1", () => {
    const r = rig();
    const heading = Math.atan2(0.33, 0.8);
    r.control.set(1);
    expect(r.gl.toneMappingExposure).toBeCloseTo(DUSK.exposure, 9);
    expect(r.sun.intensity).toBe(0);
    expect(r.sun.castShadow).toBe(false);
    expect(u<number>(r.sky, "uSunDisc")).toBe(0);
    sameColor(u<Color>(r.sky, "uZenith"), DUSK.zenith);
    const dir = u<Vector3>(r.sky, "uSunDir");
    expect(dir.y).toBeCloseTo(Math.sin((DUSK_SUN_ELEVATION_DEG * Math.PI) / 180), 6);
    expect(dir.y).toBeLessThan(0);
    expect(Math.atan2(dir.z, dir.x)).toBeCloseTo(heading, 6);
    expect(u<Vector3>(r.water, "uSunDir").y).toBeCloseTo(dir.y, 6);
    expect(r.windows[0].emissive.getHexString()).toBe(new Color(WINDOW_GLOW.color).getHexString());
    expect(r.windows[0].emissiveIntensity).toBeCloseTo(WINDOW_GLOW.radiance, 9);
    expect(r.lamps.map((l) => l.emissiveIntensity)).toEqual([0.5 * LAMP_BOOST, 1 * LAMP_BOOST]);
    expect(r.mirrors[0].envMapIntensity).toBeCloseTo(1.5 * DUSK.reflections, 9);
    expect((r.scene.fog as FogExp2).density).toBeCloseTo(0.002 * DUSK.hazeDensity, 9);
    sameColor(u<Color>(r.water, "uFogColor"), (r.scene.fog as FogExp2).color);
    sameColor(r.scene.background as Color, DUSK.haze);
  });

  it("keeps lamps and windows off while the sky starts changing, and the sun gone by the middle", () => {
    const r = rig();
    r.control.set(0.3);
    expect(r.lamps[0].emissiveIntensity).toBe(0.5);
    expect(r.gl.toneMappingExposure).toBeGreaterThan(0.5);
    r.control.set(0.5);
    expect(r.sun.intensity).toBeCloseTo(1.5, 6);
    expect(u<number>(r.sky, "uSunDisc")).toBe(0);
  });

  it("restores the day look", () => {
    const r = rig();
    r.control.set(1);
    r.control.restore();
    expect(r.gl.toneMappingExposure).toBe(0.5);
    expect(r.sun.intensity).toBe(3);
    expect(r.sun.castShadow).toBe(true);
    expect(r.lamps[1].emissiveIntensity).toBe(1);
  });

  it("clamps k outside 0..1", () => {
    const r = rig();
    r.control.set(5);
    expect(r.gl.toneMappingExposure).toBeCloseTo(DUSK.exposure, 9);
    r.control.set(-5);
    expect(r.gl.toneMappingExposure).toBe(0.5);
  });

  it("reports the practicals' and the sun's strength", () => {
    const r = rig();
    r.control.set(1);
    expect(r.onPracticals).toHaveBeenLastCalledWith(1);
    expect(r.onSun).toHaveBeenLastCalledWith(0);
    r.control.set(0);
    expect(r.onPracticals).toHaveBeenLastCalledWith(0);
    expect(r.onSun).toHaveBeenLastCalledWith(1);
  });

  it("reports how far the sky has gone, for the baked light's day-to-dusk blend", () => {
    const r = rig();
    r.control.set(0.5);
    expect(r.onSky).toHaveBeenLastCalledWith(phases(0.5).sky);
    r.control.set(1);
    expect(r.onSky).toHaveBeenLastCalledWith(1);
    r.control.restore();
    expect(r.onSky).toHaveBeenLastCalledWith(0);
  });

  it("does not turn shadows on for a sun that never cast them", () => {
    const r = rig();
    r.sun.userData.castsShadow = false;
    r.control.set(0);
    expect(r.sun.castShadow).toBe(false);
  });
});

describe("handoverAmount", () => {
  it("holds the poster's look while the poster fades, then settles smoothly into the live look", () => {
    expect(handoverAmount(0)).toBe(0);
    expect(handoverAmount(HANDOVER.hold)).toBe(0);
    expect(HANDOVER.hold).toBeGreaterThan(0.9); // the poster's fade (experience.css) is over first
    const mid = handoverAmount(HANDOVER.hold + HANDOVER.seconds / 2);
    expect(mid).toBeCloseTo(0.5, 9);
    expect(handoverAmount(HANDOVER.hold + HANDOVER.seconds)).toBe(1);
    expect(handoverAmount(60)).toBe(1);
    // Eased: slow at both ends.
    const step = HANDOVER.seconds / 20;
    expect(handoverAmount(HANDOVER.hold + step)).toBeLessThan(0.05);
    expect(1 - handoverAmount(HANDOVER.hold + HANDOVER.seconds - step)).toBeLessThan(0.05);
  });

  it("starts the cut brighter in the sky, lighter at the edges and with a calmer stream, as the posters are", () => {
    expect(HANDOVER.skyGain).toBeGreaterThan(1);
    expect(HANDOVER.vignette).toBeLessThan(0.46);
    expect(HANDOVER.glint).toBeLessThan(1);
  });
});
