import { useThree } from "@react-three/fiber";
import type { Group } from "three";
import { disposeObject, loadCompound, loadLibrary, type GltfLibrary, type LibraryKind } from "./compoundModel";
import type { QualityTier, SceneVariant } from "./types";
import { MODEL_TIMEOUT_MS, useTimedAsset } from "./useTimedAsset";

export { MODEL_TIMEOUT_MS };

export type CompoundModelState = {
  /** The baked compound, or null while loading and after a failure or timeout. */
  model: Group | null;
  /** True once the outcome is known: the model is in, it failed, or it took too long. */
  settled: boolean;
};

/**
 * Loads the baked compound for a quality tier and variant and says when the scene may show its
 * first frame. The poster hands over to a finished compound, never to boxes that pop into a
 * model: a model that arrives after the timeout is freed, not swapped in, and the procedural
 * compound shows instead.
 */
export function useCompoundModel(tier: QualityTier, variant: SceneVariant): CompoundModelState {
  const gl = useThree((s) => s.gl);
  const { value, settled } = useTimedAsset<Group>(`${tier}:${variant}`, {
    load: () => loadCompound(tier, gl, variant),
    dispose: disposeObject,
    stage: "compound-model",
    context: { tier, variant },
  });
  return { model: value, settled };
}

export type LibraryState = {
  /** The library, or null while loading, after a failure or timeout, and when not needed. */
  library: GltfLibrary | null;
  settled: boolean;
};

const disposeLibrary = (lib: GltfLibrary) => disposeObject(lib.scene);

/**
 * Loads an instanced library (plants, or people, cars and birds) on the same terms as the
 * compound: the first frame waits for it, and one that is late is freed, not swapped in.
 * `enabled` false (a compound that does not use it) settles at once with nothing.
 */
export function useSceneLibrary(kind: LibraryKind, tier: QualityTier, enabled: boolean): LibraryState {
  const gl = useThree((s) => s.gl);
  const { value, settled } = useTimedAsset<GltfLibrary>(`${kind}:${tier}`, {
    load: () => loadLibrary(kind, tier, gl),
    dispose: disposeLibrary,
    stage: kind,
    context: { tier },
    enabled,
  });
  return { library: value, settled };
}
