import { INTRO_HOLD_SECONDS } from "./beats";
import { Color, Vector3, type Fog, type FogExp2, type Light, type MeshStandardMaterial, type Scene, type ShaderMaterial, type WebGLRenderer } from "three";

/**
 * Day and dusk. The day look is whatever the scene was built with (world.ts, tuned against the
 * posters), so it is captured from the live objects, never restated here; dusk is defined
 * below, after the lighting track's dusk rig (docs/zaitun/LIGHTING.md): the sun 5 degrees under
 * the horizon, a deep blue sky with an afterglow toward the sun, lit windows and lamps.
 * `k` runs from 0 (day) to 1 (dusk).
 */
export type Daylight = "day" | "dusk";

/** Seconds a full change between day and dusk takes. */
export const DAYLIGHT_SECONDS = 5;
export const DUSK_SUN_ELEVATION_DEG = -5;
/** Lit windows: colour and radiance from the lighting track. */
export const WINDOW_GLOW = { color: "#ffc98a", radiance: 1.1 } as const;
/** How much brighter the lamp heads burn at dusk. */
export const LAMP_BOOST = 7;

/** The dusk look. Sky colours are scene-linear, already scaled for the dusk exposure. */
export const DUSK = {
  exposure: 1.9,
  sunColor: new Color(0.95, 0.36, 0.2).multiplyScalar(0.34),
  zenith: new Color("#1d2a5c").multiplyScalar(0.5),
  horizonAway: new Color("#3a4478").multiplyScalar(0.55),
  horizonSun: new Color("#e0825a").multiplyScalar(0.85),
  ground: new Color("#20243a").multiplyScalar(0.5),
  haze: new Color("#39446e").multiplyScalar(0.42),
  hazeDensity: 0.8,
  sunLight: 0,
  hemisphere: { sky: new Color("#7f95d6"), ground: new Color("#3b3550"), intensity: 0.8 },
  environment: 0.3,
  reflections: 0.22,
  water: { sun: new Color(0.9, 0.4, 0.25).multiplyScalar(0.3), horizon: new Color("#58608f").multiplyScalar(0.6), zenith: new Color("#1d2a5c").multiplyScalar(0.5), deep: new Color("#0c1220") },
} as const;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Moves `k` toward day (0) or dusk (1) at a steady rate; the look eases it (see `phases`). */
export function stepDaylight(k: number, target: Daylight, dt: number, seconds = DAYLIGHT_SECONDS): number {
  const goal = target === "dusk" ? 1 : 0;
  const step = seconds > 0 ? dt / seconds : 1;
  return goal > k ? Math.min(goal, k + step) : Math.max(goal, k - step);
}

/**
 * What happens when during the change: the sun sets and the sky darkens across the whole of
 * it; windows, lamps and the baked lamp light on the ground come on in the second half; the
 * sun disc and the light shafts are gone by the middle.
 */
export function phases(k: number): { sky: number; practicals: number; sun: number } {
  return { sky: smoothstep(0, 1, k), practicals: smoothstep(0.42, 0.92, k), sun: 1 - smoothstep(0, 0.5, k) };
}

/**
 * The poster handover. The posters are Cycles frames (track 5B): their sun is a lamp the camera
 * cannot see, so their sky is the scene's sky without the disc; that sky reads brighter, and their
 * vignette is lighter. The live scene takes over dressed as the poster, holds that while the
 * poster fades out, then settles into its own look while the camera starts to move.
 */
export const HANDOVER = {
  /** Seconds the poster look holds after the first live frame: as long as the camera holds still. */
  hold: INTRO_HOLD_SECONDS,
  /** Seconds it then takes to settle. */
  seconds: 3.5,
  /** Visible sky brightness at the cut (1 is the live look). */
  skyGain: 1.35,
  /** Vignette darkness at the cut (the live look is VIGNETTE_DARKNESS in PostFX). */
  vignette: 0.12,
  /** Sun glitter on the stream at the cut (Cycles shows a narrow streak where the web glitters). */
  glint: 0.15,
} as const;

/** How far the handover has settled `t` seconds after the first live frame (0 poster, 1 live). */
export function handoverAmount(t: number): number {
  return smoothstep(HANDOVER.hold, HANDOVER.hold + HANDOVER.seconds, t);
}

/** A unit vector for the sun at an elevation, keeping the heading of `from`. */
export function sunAtElevation(from: Vector3, elevationDeg: number, out = new Vector3()): Vector3 {
  const el = (elevationDeg * Math.PI) / 180;
  const flat = Math.hypot(from.x, from.z) || 1;
  return out.set((from.x / flat) * Math.cos(el), Math.sin(el), (from.z / flat) * Math.cos(el));
}

type Uniform<T> = { value: T };
const colorOf = (m: ShaderMaterial, name: string) => (m.uniforms[name] as Uniform<Color>).value;

export type DaylightTargets = {
  gl: Pick<WebGLRenderer, "toneMappingExposure">;
  scene: Scene;
  sky: ShaderMaterial;
  water: ShaderMaterial;
  sun: Light;
  hemisphere: Light & { groundColor: Color };
  /** Window glass, the lamp heads, and the mirror-like materials whose sky reflection dims. */
  windows?: MeshStandardMaterial[];
  lamps?: MeshStandardMaterial[];
  mirrors?: MeshStandardMaterial[];
  /** Called with the practicals' strength (0 to 1): the baked lamp light on the ground. */
  onPracticals?: (strength: number) => void;
  /** Called with the daylight's strength (1 to 0): the light shafts. */
  onSun?: (strength: number) => void;
  /** Called with how far the sky has gone toward dusk (0 to 1): the baked light's day-to-dusk blend. */
  onSky?: (k: number) => void;
};

export type DaylightControl = {
  /** Applies the look at `k` (0 day, 1 dusk). */
  set: (k: number) => void;
  /** Puts the day look back. */
  restore: () => void;
};

/**
 * Captures the day look from the live scene and returns a control that blends it toward dusk.
 * At k = 0 every value is exactly what it was, so the day frames keep matching the posters.
 */
export function createDaylight(t: DaylightTargets): DaylightControl {
  const fog = t.scene.fog as (Fog | FogExp2 | null) & { density?: number };
  // By flag, not instanceof: the scene's colour may come from another copy of three.
  const background = (t.scene.background as Color | null)?.isColor ? (t.scene.background as Color) : null;
  const day = {
    exposure: t.gl.toneMappingExposure,
    skySun: colorOf(t.sky, "uSunColor").clone(),
    zenith: colorOf(t.sky, "uZenith").clone(),
    horizonAway: colorOf(t.sky, "uHorizonAway").clone(),
    horizonSun: colorOf(t.sky, "uHorizonSun").clone(),
    ground: colorOf(t.sky, "uGround").clone(),
    sunDir: (t.sky.uniforms.uSunDir as Uniform<Vector3>).value.clone(),
    sunDisc: (t.sky.uniforms.uSunDisc as Uniform<number>).value,
    haze: fog ? fog.color.clone() : null,
    hazeDensity: fog?.density ?? 0,
    background: background?.clone() ?? null,
    sunLight: t.sun.intensity,
    hemiSky: t.hemisphere.color.clone(),
    hemiGround: t.hemisphere.groundColor.clone(),
    hemiIntensity: t.hemisphere.intensity,
    environment: t.scene.environmentIntensity,
    waterSun: colorOf(t.water, "uSunColor").clone(),
    waterHorizon: colorOf(t.water, "uHorizon").clone(),
    waterZenith: colorOf(t.water, "uZenith").clone(),
    waterDeep: colorOf(t.water, "uDeep").clone(),
    waterSunDir: (t.water.uniforms.uSunDir as Uniform<Vector3>).value.clone(),
    waterFogDensity: (t.water.uniforms.uFogDensity as Uniform<number>).value,
    windows: (t.windows ?? []).map((m) => ({ color: m.emissive.clone(), intensity: m.emissiveIntensity })),
    lamps: (t.lamps ?? []).map((m) => m.emissiveIntensity),
    mirrors: (t.mirrors ?? []).map((m) => m.envMapIntensity),
  };
  const glow = new Color(WINDOW_GLOW.color);
  const duskDir = sunAtElevation(day.sunDir, DUSK_SUN_ELEVATION_DEG);
  const mix = (a: number, b: number, k: number) => a + (b - a) * k;

  const set = (k: number) => {
    const { sky, practicals, sun } = phases(clamp01(k));
    t.gl.toneMappingExposure = mix(day.exposure, DUSK.exposure, sky);

    colorOf(t.sky, "uSunColor").copy(day.skySun).lerp(DUSK.sunColor, sky);
    colorOf(t.sky, "uZenith").copy(day.zenith).lerp(DUSK.zenith, sky);
    colorOf(t.sky, "uHorizonAway").copy(day.horizonAway).lerp(DUSK.horizonAway, sky);
    colorOf(t.sky, "uHorizonSun").copy(day.horizonSun).lerp(DUSK.horizonSun, sky);
    colorOf(t.sky, "uGround").copy(day.ground).lerp(DUSK.ground, sky);
    (t.sky.uniforms.uSunDir as Uniform<Vector3>).value.copy(day.sunDir).lerp(duskDir, sky).normalize();
    (t.sky.uniforms.uSunDisc as Uniform<number>).value = day.sunDisc * sun;

    if (fog && day.haze) {
      fog.color.copy(day.haze).lerp(DUSK.haze, sky);
      if (fog.density !== undefined) fog.density = day.hazeDensity * mix(1, DUSK.hazeDensity, sky);
      colorOf(t.water, "uFogColor").copy(fog.color);
    }
    if (background && day.background) background.copy(day.background).lerp(DUSK.haze, sky);

    t.sun.intensity = mix(day.sunLight, DUSK.sunLight, sky);
    // No light, no shadow pass.
    t.sun.castShadow = t.sun.userData.castsShadow === true && t.sun.intensity > day.sunLight * 0.02;
    t.hemisphere.color.copy(day.hemiSky).lerp(DUSK.hemisphere.sky, sky);
    t.hemisphere.groundColor.copy(day.hemiGround).lerp(DUSK.hemisphere.ground, sky);
    t.hemisphere.intensity = mix(day.hemiIntensity, DUSK.hemisphere.intensity, sky);
    t.scene.environmentIntensity = day.environment * mix(1, DUSK.environment, sky);

    colorOf(t.water, "uSunColor").copy(day.waterSun).lerp(DUSK.water.sun, sky);
    colorOf(t.water, "uHorizon").copy(day.waterHorizon).lerp(DUSK.water.horizon, sky);
    colorOf(t.water, "uZenith").copy(day.waterZenith).lerp(DUSK.water.zenith, sky);
    colorOf(t.water, "uDeep").copy(day.waterDeep).lerp(DUSK.water.deep, sky);
    (t.water.uniforms.uSunDir as Uniform<Vector3>).value.copy(day.waterSunDir).lerp(duskDir, sky).normalize();
    (t.water.uniforms.uFogDensity as Uniform<number>).value = day.waterFogDensity * mix(1, DUSK.hazeDensity, sky);

    (t.windows ?? []).forEach((m, i) => {
      m.emissive.copy(day.windows[i].color).lerp(glow, practicals);
      m.emissiveIntensity = mix(day.windows[i].intensity, WINDOW_GLOW.radiance, practicals);
    });
    (t.lamps ?? []).forEach((m, i) => {
      m.emissiveIntensity = day.lamps[i] * mix(1, LAMP_BOOST, practicals);
    });
    (t.mirrors ?? []).forEach((m, i) => {
      m.envMapIntensity = day.mirrors[i] * mix(1, DUSK.reflections, sky);
    });
    t.onPracticals?.(practicals);
    t.onSun?.(sun);
    t.onSky?.(sky);
  };

  return { set, restore: () => set(0) };
}
