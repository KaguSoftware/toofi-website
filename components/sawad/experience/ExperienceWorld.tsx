import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { HemisphereLight, Light, Mesh, Object3D, Scene, ShaderMaterial } from "three";
import { reportError } from "@/lib/monitoring";
import { loadBakedPages, setBakedDusk, setBakedMix } from "../scene/bakedLight";
import { bakedLightOf, withKtx2, type GltfLibrary } from "../scene/compoundModel";
import { MAX_FRAME_SECONDS } from "../scene/flight";
import { SceneWorld } from "../scene/SceneWorld";
import type { QualityTier } from "../scene/types";
import { advanceTime, fogDensity, sunDirection } from "../scene/world";
import { HANDOVER, createDaylight, handoverAmount, phases, stepDaylight, type Daylight, type DaylightControl } from "./daylight";
import { buildGodRays, setShaftStrength, type GodRays } from "./godrays";
import { applyGroundLight, createGroundLight, groundPage, loadLightmapManifest, loadLightmapTexture, setGroundBlend, setGroundPage } from "./lightmaps";
import { findPracticals } from "./practicals";
import type { RigState } from "./types";

export type ExperienceWorldProps = {
  tier: QualityTier;
  model: Object3D | null;
  fallback: boolean;
  vegetation: GltfLibrary | null;
  plantingFallback: boolean;
  life: GltfLibrary | null;
  daylight: Daylight;
  /** Light shafts through the palms (a quality setting). */
  godRays: boolean;
  /** Take over from a poster: the live frame starts dressed as the poster and settles (daylight.ts `HANDOVER`). */
  sunRise?: boolean;
  rig: RefObject<RigState>;
};

/** The light the sun casts by is lifted a little above the visible sun (world.ts); the shafts follow it. */
const LIGHT_LIFT_DEG = 4.5;

/** Tells the rest of the frame (the sound) how far dusk has come. */
function noteDusk(rig: RigState | null, k: number): void {
  if (rig) rig.dusk = k;
}

/** Tells the rest of the frame (the vignette) how far the poster handover has settled. */
function noteHandover(rig: RigState | null, h: number): void {
  if (rig) rig.handover = h;
}

type WorldParts = { sky: ShaderMaterial; water: ShaderMaterial; sun: Light; hemisphere: HemisphereLight; terrain: Object3D | null };

/** Finds the parts of the scene world the daylight changes, by the names world.ts gives them. */
export function findWorldParts(scene: Scene): WorldParts | null {
  const sky = scene.getObjectByName("sky") as Mesh | undefined;
  const river = scene.getObjectByName("river") as Mesh | undefined;
  const sun = scene.getObjectByName("sun") as Light | undefined;
  let hemisphere: HemisphereLight | null = null;
  scene.traverse((o) => {
    if ((o as HemisphereLight).isHemisphereLight) hemisphere = o as HemisphereLight;
  });
  if (!sky || !river || !sun || !hemisphere) return null;
  // Remember whether the sun cast shadows by day, so dusk can stop and day can start again.
  sun.userData.castsShadow ??= sun.castShadow;
  return { sky: sky.material as ShaderMaterial, water: river.material as ShaderMaterial, sun, hemisphere, terrain: scene.getObjectByName("terrain") ?? null };
}

/**
 * The scene world (sky, land, water, planting, life, buildings: unchanged from the scene
 * folder) with what the experience adds to it: the day and dusk states, the baked lamp light
 * on the ground, and light shafts through the palms.
 */
export function ExperienceWorld({ tier, model, fallback, vegetation, plantingFallback, life, daylight, godRays, sunRise = false, rig }: ExperienceWorldProps) {
  const shafts = useMemo(() => (godRays ? buildGodRays(sunDirection("zaitun", LIGHT_LIFT_DEG), fogDensity("zaitun")) : null), [godRays]);
  useEffect(() => () => shafts?.dispose(), [shafts]);
  useFrame((_, delta) => {
    if (shafts) advanceTime(shafts.material, delta);
  });

  return (
    <>
      <SceneWorld variant="zaitun" tier={tier} model={model} fallback={fallback} vegetation={vegetation} plantingFallback={plantingFallback} life={life} />
      {shafts ? <primitive object={shafts.mesh} /> : null}
      <Daylighting tier={tier} model={model} daylight={daylight} shafts={shafts} sunRise={sunRise} rig={rig} />
    </>
  );
}

type DaylightingProps = { tier: QualityTier; model: Object3D | null; daylight: Daylight; shafts: GodRays | null; sunRise?: boolean; rig: RefObject<RigState> };

type Uniform<T> = { value: T };
const skyUniforms = (scene: Scene) => ((scene.getObjectByName("sky") as Mesh | undefined)?.material as ShaderMaterial | undefined)?.uniforms as
  | { uSunDisc: Uniform<number>; uGain: Uniform<number> }
  | undefined;

const glintOf = (scene: Scene) => ((scene.getObjectByName("river") as Mesh | undefined)?.material as ShaderMaterial | undefined)?.uniforms.uGlint as Uniform<number> | undefined;
const between = (a: number, b: number, h: number) => a + (b - a) * h;

/** Dresses the live frame between the poster's look (0) and its own (1). */
export function dressHandover(scene: Scene, full: number, h: number): boolean {
  const sky = skyUniforms(scene);
  if (!sky) return false;
  sky.uSunDisc.value = full * h;
  sky.uGain.value = between(HANDOVER.skyGain, 1, h);
  const glint = glintOf(scene);
  if (glint) glint.value = between(HANDOVER.glint, 1, h);
  return true;
}

/**
 * Blends the world between day and dusk. Nothing is touched until dusk is first asked for, so
 * the day frames are exactly the scene's own; from then on the sky, the lights, the haze, the
 * exposure, the windows and lamps and the baked ground light all follow one number.
 */
export function Daylighting({ tier, model, daylight, shafts, sunRise = false, rig }: DaylightingProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const ground = useMemo(() => createGroundLight(), []);
  const control = useRef<DaylightControl | null>(null);
  const k = useRef(0);
  const wanted = useRef(daylight);
  // The settle after the poster: read once, at mount; `full` is the sun disc's own value.
  const rise = useRef<{ on: boolean; t: number; full: number | null }>({ on: sunRise, t: 0, full: null });

  // The first live frame already wears the poster's look (frames are held until the model is in).
  useEffect(() => {
    if (rise.current.on) noteHandover(rig.current, 0);
  }, [rig]);

  // A change of state wakes the loop even when it is paused.
  useEffect(() => {
    wanted.current = daylight;
    invalidate();
  }, [daylight, invalidate]);

  // The control is rebuilt when the model or the shafts change; the day look goes back first.
  useEffect(
    () => () => {
      control.current?.restore();
      control.current = null;
    },
    [gl, scene, model, shafts],
  );
  useEffect(() => () => ground.dispose(), [ground]);

  // The baked dusk light: fetched the first time dusk is asked for. The ground page for the
  // terrain, and the model's own dusk pages (buildings, site) when it carries a baked light.
  const asked = daylight === "dusk";
  useEffect(() => {
    if (!asked) return;
    let cancelled = false;
    (async () => {
      const page = groundPage(await loadLightmapManifest(), tier, "dusk");
      const texture = await loadLightmapTexture(page.url);
      if (cancelled) {
        texture.dispose();
        return;
      }
      setGroundPage(ground, texture, page);
      setGroundBlend(ground, phases(k.current).practicals);
      invalidate();
    })().catch((err) => reportError("sawad-experience", err, { stage: "lightmaps", tier }));
    const baked = bakedLightOf(model);
    if (baked && !baked.dusk) {
      withKtx2(gl, (ktx2) => loadBakedPages(baked.manifest, baked.tier, "dusk", ktx2))
        .then((pages) => {
          // A model swapped or freed meanwhile has its own light; these pages belong to this one.
          if (cancelled || baked.dusk) {
            pages.buildings.dispose();
            pages.site.dispose();
            return;
          }
          setBakedDusk(baked, pages);
          setBakedMix(baked, phases(k.current).sky);
          invalidate();
        })
        .catch((err) => reportError("sawad-experience", err, { stage: "baked-light-dusk", tier }));
    }
    return () => {
      cancelled = true;
    };
    // Loaded once per mount and model: `asked` only ever turns true.
  }, [asked, tier, ground, invalidate, gl, model]);

  useFrame((_, delta) => {
    const r = rise.current;
    if (r.on && !control.current) {
      r.full ??= skyUniforms(scene)?.uSunDisc.value ?? null;
      if (r.full !== null) {
        r.t += Math.min(delta, MAX_FRAME_SECONDS);
        const h = handoverAmount(r.t);
        dressHandover(scene, r.full, h);
        noteHandover(rig.current, h);
        if (h >= 1) r.on = false;
        else invalidate();
      }
    }
    const next = stepDaylight(k.current, wanted.current, Math.min(delta, MAX_FRAME_SECONDS));
    if (next === k.current && control.current) return;
    if (!control.current) {
      // Still day and never asked for dusk: leave the scene alone.
      if (next === 0) return;
      const parts = findWorldParts(scene);
      if (!parts) return;
      // Dusk asked for before the handover settled: the day look it captures is the live one.
      if (r.on && r.full !== null) {
        dressHandover(scene, r.full, 1);
        noteHandover(rig.current, 1);
        r.on = false;
      }
      applyGroundLight(ground, parts.terrain, model);
      control.current = createDaylight({
        gl,
        scene,
        ...parts,
        ...findPracticals(model),
        onPracticals: (strength) => setGroundBlend(ground, strength),
        onSun: (strength) => {
          if (shafts) setShaftStrength(shafts, strength);
        },
        onSky: (sky) => {
          const baked = bakedLightOf(model);
          if (baked) setBakedMix(baked, sky);
        },
      });
    }
    k.current = next;
    control.current.set(next);
    noteDusk(rig.current, next);
    // Keep drawing until the change has finished, even on a demand loop.
    if (next !== (wanted.current === "dusk" ? 1 : 0)) invalidate();
  });

  return null;
}
