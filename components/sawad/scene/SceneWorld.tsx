import { useEffect, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Frustum, type Object3D, type Texture, type WebGLRenderTarget } from "three";
import { reportError } from "@/lib/monitoring";
import { disposeObject, type GltfLibrary } from "./compoundModel";
import { cameraFrustum, cullInstances, prepareInstanceCulling, restoreInstances } from "./instanceCulling";
import { SceneLife } from "./SceneLife";
import { SceneVegetation } from "./SceneVegetation";
import { usesPlan } from "./site";
import type { QualityTier, SceneVariant } from "./types";
import {
  HAZE_COLOR,
  HEMISPHERE_LIGHT,
  SUN_LIGHT,
  advanceTime,
  applyReflections,
  buildArchitecture,
  buildGardenPool,
  buildPalms,
  buildRoundTrees,
  buildSky,
  buildSkyEnvironment,
  buildTerrain,
  buildWater,
  createWaterMaterial,
  fogDensity,
  setSceneEnvironment,
  sunDirection,
  sunLightPosition,
} from "./world";

type Place = { variant: SceneVariant; tier: QualityTier };

export type SceneWorldProps = Place & {
  /** The baked compound, once it has loaded. */
  model: Object3D | null;
  /** Show the procedural compound instead (the model failed or timed out). */
  fallback: boolean;
  /** 28 ha plan only: the plant library, once loaded. */
  vegetation?: GltfLibrary | null;
  /** 28 ha plan only: the plant library failed or timed out; plant procedural trees instead. */
  plantingFallback?: boolean;
  /** 28 ha plan only: the people, cars and birds library, once loaded. */
  life?: GltfLibrary | null;
};

/**
 * Everything around the camera: haze, sky, light, land, water, planting and the compound.
 * Each part is its own component, so a later track can swap one without touching the rest.
 */
export function SceneWorld({ variant, tier, model, fallback, vegetation = null, plantingFallback = false, life = null }: SceneWorldProps) {
  const [environment, setEnvironment] = useState<Texture | null>(null);
  return (
    <>
      <Atmosphere variant={variant} />
      <Sky variant={variant} tier={tier} onEnvironment={setEnvironment} />
      <Lights variant={variant} tier={tier} />
      <Terrain variant={variant} tier={tier} />
      <Water variant={variant} />
      <Planting variant={variant} tier={tier} vegetation={vegetation} fallback={plantingFallback} />
      {usesPlan(variant) && life ? <SceneLife tier={tier} library={life} /> : null}
      <Architecture variant={variant} tier={tier} model={model} fallback={fallback} environment={environment} />
    </>
  );
}

/**
 * Trees. The 7 ha compounds plant procedural palms and round trees. The 28 ha plan plants the
 * vegetation library (SceneVegetation), and the procedural trees, at the same spots, only if
 * the library failed to load; until it settles, nothing (the first frame waits for it).
 */
export function Planting({ variant, tier, vegetation, fallback }: Place & { vegetation: GltfLibrary | null; fallback: boolean }) {
  if (usesPlan(variant)) {
    if (vegetation) return <SceneVegetation tier={tier} library={vegetation} />;
    if (!fallback) return null;
  }
  return (
    <>
      <Palms variant={variant} tier={tier} />
      <RoundTrees variant={variant} tier={tier} />
    </>
  );
}

/** Dusty haze: the fog, and the clear colour behind the sky dome. */
export function Atmosphere({ variant }: { variant: SceneVariant }) {
  return (
    <>
      <color attach="background" args={[HAZE_COLOR]} />
      <fogExp2 attach="fog" args={[HAZE_COLOR, fogDensity(variant)]} />
    </>
  );
}

/**
 * The art-directed sky dome. It also lights the scene: the same sky, without the sun disc, is
 * prefiltered once into `scene.environment` for reflections on glass, brass and water.
 */
export function Sky({ variant, tier, onEnvironment }: Place & { onEnvironment?: (texture: Texture | null) => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const sky = useMemo(() => buildSky(sunDirection(variant)), [variant]);

  useEffect(
    () => () => {
      sky.mesh.geometry.dispose();
      sky.material.dispose();
    },
    [sky],
  );

  useEffect(() => {
    let target: WebGLRenderTarget;
    try {
      target = buildSkyEnvironment(gl, sky);
    } catch (err) {
      // Without reflections the scene still renders; say so and carry on.
      reportError("sawad-scene", err, { stage: "environment", variant, tier });
      return;
    }
    setSceneEnvironment(scene, target.texture);
    onEnvironment?.(target.texture);
    return () => {
      target.dispose();
      setSceneEnvironment(scene, null);
      onEnvironment?.(null);
    };
  }, [gl, scene, sky, variant, tier, onEnvironment]);

  useFrame((_, delta) => advanceTime(sky.material, delta));

  return <primitive object={sky.mesh} />;
}

/** Golden-hour sun and sky fill. Only the high tier casts shadows. */
export function Lights({ variant, tier }: Place) {
  const position = useMemo(() => sunLightPosition(variant).toArray(), [variant]);
  const shadow = SUN_LIGHT.shadow;
  return (
    <>
      <hemisphereLight args={[HEMISPHERE_LIGHT.sky, HEMISPHERE_LIGHT.ground, HEMISPHERE_LIGHT.intensity]} />
      {tier === "high" ? (
        <directionalLight
          name="sun"
          color={SUN_LIGHT.color}
          intensity={SUN_LIGHT.intensity}
          position={position}
          castShadow
          shadow-mapSize={[shadow.mapSize, shadow.mapSize]}
          shadow-bias={shadow.bias}
          shadow-normalBias={shadow.normalBias}
          shadow-radius={shadow.radius}
          shadow-camera-left={-shadow.extent}
          shadow-camera-right={shadow.extent}
          shadow-camera-top={shadow.extent}
          shadow-camera-bottom={-shadow.extent}
          shadow-camera-near={shadow.near}
          shadow-camera-far={shadow.far}
        />
      ) : (
        <directionalLight name="sun" color={SUN_LIGHT.color} intensity={SUN_LIGHT.intensity} position={position} />
      )}
    </>
  );
}

/** The land: river valley, pad and foothills, coloured per vertex. */
export function Terrain({ variant, tier }: Place) {
  const terrain = useMemo(() => buildTerrain(variant, tier), [variant, tier]);
  useEffect(() => () => disposeObject(terrain), [terrain]);
  return <primitive object={terrain} />;
}

/** The river and the garden's reflecting pool. They share one animated water material. */
export function Water({ variant }: { variant: SceneVariant }) {
  const water = useMemo(() => {
    const material = createWaterMaterial(sunDirection(variant), variant);
    return { material, river: buildWater(variant, material), pool: buildGardenPool(material, variant) };
  }, [variant]);

  useEffect(
    () => () => {
      water.river.geometry.dispose();
      water.pool.geometry.dispose();
      water.material.dispose();
    },
    [water],
  );

  useFrame((_, delta) => advanceTime(water.material, delta));

  return (
    <>
      <primitive object={water.river} />
      <primitive object={water.pool} />
    </>
  );
}

/** Procedural date palms: boulevard allées, the orchard grid and the river banks. Two draw calls. */
export function Palms({ variant, tier }: Place) {
  const palms = useMemo(() => buildPalms(variant, tier), [variant, tier]);
  useEffect(() => () => palms.dispose(), [palms]);
  return palms.objects.map((o) => <primitive key={o.name} object={o} />);
}

/** Round-crowned trees: olives on Zaitun's foothills, shade trees elsewhere. Two draw calls. */
export function RoundTrees({ variant, tier }: Place) {
  const trees = useMemo(() => buildRoundTrees(variant, tier), [variant, tier]);
  useEffect(() => () => trees.dispose(), [trees]);
  return trees.objects.map((o) => <primitive key={o.name} object={o} />);
}

/**
 * The compound's buildings: the baked model when there is one, otherwise (only once asked to
 * fall back) the procedural boxes. Whoever loaded the model frees it; the boxes are freed here.
 */
export function Architecture({
  variant = "dijla",
  tier = "high",
  model,
  fallback,
  environment,
}: {
  variant?: SceneVariant;
  tier?: QualityTier;
  model: Object3D | null;
  fallback: boolean;
  environment: Texture | null;
}) {
  const procedural = useMemo(() => (fallback && !model ? buildArchitecture(variant) : null), [fallback, model, variant]);
  useEffect(() => {
    if (!procedural) return;
    return () => disposeObject(procedural);
  }, [procedural]);

  const object = model ?? procedural;
  // Metals and polished glass in the model mirror the sky at full strength.
  useEffect(() => {
    if (object && environment) applyReflections(object, environment);
  }, [object, environment]);

  return object ? (
    <>
      <primitive object={object} />
      {model ? <InstanceCulling model={model} margin={CULL_MARGIN[tier]} /> : null}
    </>
  ) : null;
}

/**
 * Metres a copy may stand outside the view and still be drawn. The high tier's real-time sun
 * throws a villa's shadow some 50 m at golden hour; the low tier has only baked shadows.
 */
export const CULL_MARGIN: Record<QualityTier, number> = { high: 60, low: 4 };

/**
 * Draws only the copies of the model's instanced meshes that are in view (instanceCulling.ts).
 * Runs after the camera rigs (priority 0.5, as the plants) and before the render pass.
 */
export function InstanceCulling({ model, margin }: { model: Object3D; margin: number }) {
  const culled = useMemo(() => prepareInstanceCulling(model), [model]);
  const frustum = useMemo(() => new Frustum(), []);
  useEffect(() => () => restoreInstances(culled), [culled]);
  useFrame(({ camera }) => {
    cullInstances(culled, cameraFrustum(camera, frustum), margin);
  }, 0.5);
  return null;
}
