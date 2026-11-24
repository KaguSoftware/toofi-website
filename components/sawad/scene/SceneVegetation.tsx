import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3, type PerspectiveCamera } from "three";
import type { Wind } from "@/lib/sawad/wind";
import type { GltfLibrary } from "./compoundModel";
import { MAX_FRAME_SECONDS } from "./flight";
import type { QualityTier } from "./types";
import { buildVegetationField, coneCos, needsResort, prepareVegetationLibrary, type VegetationDetail, type VegetationField, type ViewCone } from "./vegetation";

export type SceneVegetationProps = { tier: QualityTier; library: GltfLibrary };

/**
 * How the scene below this point picks its detail (vegetation.ts `VegetationDetail`). The live
 * scene never sets it; the reel capture (experience/ReelCapture.tsx) provides "max", so every tree
 * is drawn at its finest level in every frame of the recorded story, and no person or car appears
 * as the camera comes closer (SceneLife).
 */
export const SceneDetail = createContext<VegetationDetail>("distance");

type Clock = { seconds: number; last: ViewCone | null };

const _forward = new Vector3();

/** The camera's view cone right now. */
function readCone(camera: PerspectiveCamera, aspect: number): ViewCone {
  camera.getWorldDirection(_forward);
  const p = camera.position;
  return { eye: { x: p.x, y: p.y, z: p.z }, forward: { x: _forward.x, y: _forward.y, z: _forward.z }, cosHalf: coneCos(camera.fov, aspect) };
}

/** One frame: the wind moves on, and the plants are re-sorted if the camera has moved or turned. */
function step(clock: Clock, wind: Wind, field: VegetationField, camera: PerspectiveCamera, aspect: number, delta: number): void {
  clock.seconds += Math.min(delta, MAX_FRAME_SECONDS);
  wind.update(clock.seconds);
  const cone = readCone(camera, aspect);
  if (!needsResort(clock.last, cone)) return;
  field.update(cone);
  clock.last = cone;
}

/**
 * The 28 ha plan's olives, palms, citrus, hedges, shrubs and grass, instanced from the
 * vegetation library at the spots landscape.ts gives, swaying in the breeze off the slopes.
 */
export function SceneVegetation({ tier, library }: SceneVegetationProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const detail = useContext(SceneDetail);
  const wind = useMemo(() => prepareVegetationLibrary(library.scene), [library]);
  const field = useMemo(() => buildVegetationField(library.scene, tier, undefined, detail), [library, tier, detail]);
  const clock = useRef<Clock>({ seconds: 0, last: null });
  useEffect(() => {
    clock.current.last = null; // a new field starts unsorted
    return () => field.dispose();
  }, [field]);

  // After the camera rig has moved the camera (priority 0) and before RenderPass draws (priority 1;
  // it already owns rendering, so a positive priority here changes nothing else). The first frame
  // is sorted too, so the poster hands over to the finished planting.
  useFrame((_, delta) => step(clock.current, wind, field, camera, size.width / Math.max(1, size.height), delta), 0.5);

  return (
    <group name="vegetation">
      {field.objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
    </group>
  );
}
