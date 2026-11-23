import { useThree } from "@react-three/fiber";
import type { Group } from "three";
import { disposeObject, loadCompound, loadLibrary, type CompoundDetailWanted, type GltfLibrary, type LibraryKind } from "./compoundModel";
import type { QualityTier, SceneVariant } from "./types";
import { KEEP_HIDDEN_MS, MODEL_TIMEOUT_MS, useTimedAsset } from "./useTimedAsset";

export { MODEL_TIMEOUT_MS };

/**
 * Keeps the scene's assets through a hide (Next's Activity): freed after KEEP_HIDDEN_MS, or as soon
 * as the canvas has left the page (a real unmount). See `useTimedAsset`'s `keep`.
 */
function useKeep(): { ms: number; alive: () => boolean } {
  const canvas = useThree((s) => s.gl.domElement);
  return { ms: KEEP_HIDDEN_MS, alive: () => canvas.isConnected };
}

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
 * compound shows instead. `detail` "far" keeps Zaitun Hills on its far set (the finder).
 */
export function useCompoundModel(tier: QualityTier, variant: SceneVariant, detail: CompoundDetailWanted = "full"): CompoundModelState {
  const gl = useThree((s) => s.gl);
  const keep = useKeep();
  const { value, settled } = useTimedAsset<Group>(`${tier}:${variant}:${detail}`, {
    load: () => loadCompound(tier, gl, variant, detail),
    dispose: disposeObject,
    stage: "compound-model",
    context: { tier, variant, detail },
    keep,
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
  const keep = useKeep();
  const { value, settled } = useTimedAsset<GltfLibrary>(`${kind}:${tier}`, {
    load: () => loadLibrary(kind, tier, gl),
    dispose: disposeLibrary,
    stage: kind,
    context: { tier },
    enabled,
    keep,
  });
  return { library: value, settled };
}
