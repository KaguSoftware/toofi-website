import { NormalBlending, type AnimationClip, type Group, type Material, type Mesh, type Object3D, type Texture, type WebGLRenderer } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { reportError } from "@/lib/monitoring";
import { usesPlan } from "./site";
import type { QualityTier, SceneVariant } from "./types";

/**
 * The baked compound architecture (scripts/blender/build_compound.py). The high tier has the
 * 2048 trim sheet and 1024 AO; the low tier 1024 / 512, without mashrabiya screens or benches.
 */
export const COMPOUND_MODEL_URL: Record<QualityTier, string> = {
  high: "/sawad/models/compound-high.glb",
  low: "/sawad/models/compound-low.glb",
};
/**
 * The compound rebuilt on the 28 ha masterplan (Zaitun Hills, `build_compound.py --plan zaitun`).
 * The 7 ha files above stay for Bustan Dijla and Shatt Gardens until they move onto the new layout.
 */
export const PLAN_COMPOUND_MODEL_URL: Record<QualityTier, string> = {
  high: "/sawad/models/compound-zaitun-high.glb",
  low: "/sawad/models/compound-zaitun-low.glb",
};

/** The baked compound a variant draws. */
export function compoundModelUrl(variant: SceneVariant, tier: QualityTier): string {
  return usesPlan(variant) ? PLAN_COMPOUND_MODEL_URL[tier] : COMPOUND_MODEL_URL[tier];
}

/**
 * Instanced libraries placed at runtime on the 28 ha plan: the plants (scripts/blender/vegetation.py,
 * placed by landscape.ts `planLandscape`) and the people, cars and birds (scripts/blender/life.py,
 * moved by `planLife`).
 */
export type LibraryKind = "vegetation" | "life";
export const LIBRARY_URL: Record<LibraryKind, Record<QualityTier, string>> = {
  vegetation: { high: "/sawad/models/vegetation-high.glb", low: "/sawad/models/vegetation-low.glb" },
  life: { high: "/sawad/models/life-high.glb", low: "/sawad/models/life-low.glb" },
};

/** A loaded library: its scene (the source meshes, never mounted as is) and its animation clips. */
export type GltfLibrary = { scene: Group; animations: AnimationClip[] };

/** Basis Universal transcoder for the KTX2 textures (copied from three/examples/jsm/libs/basis). */
export const BASIS_TRANSCODER_PATH = "/sawad/basis/";
export const COMPOUND_NAME = "architecture-model";

type MaterialWithMaps = Material & Partial<Record<"map" | "aoMap" | "normalMap" | "roughnessMap" | "metalnessMap" | "emissiveMap" | "alphaMap", Texture | null>>;
const TEXTURE_SLOTS = ["map", "aoMap", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "alphaMap"] as const;

/** Frees the GPU resources of an object tree: geometries, materials and their textures. */
export function disposeObject(root: Object3D): void {
  const textures = new Set<Texture>();
  const materials = new Set<Material>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
    (o as Mesh & { dispose?: () => void }).dispose?.(); // InstancedMesh frees its instance buffers
  });
  for (const m of materials) {
    for (const slot of TEXTURE_SLOTS) {
      const t = (m as MaterialWithMaps)[slot];
      if (t) textures.add(t);
    }
    m.dispose();
  }
  for (const t of textures) t.dispose();
}

/** Shadows on every mesh (transparent glass receives but does not cast), AO read from UV1. */
export function prepareCompound(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const blended = materials.some((m) => m.transparent && m.blending === NormalBlending);
    mesh.castShadow = !blended;
    mesh.receiveShadow = true;
    for (const m of materials as MaterialWithMaps[]) {
      // The bake lives on its own lightmap UVs (glTF occlusionTexture.texCoord = 1).
      if (m.aoMap) m.aoMap.channel = 1;
    }
  });
}

/** Loads a GLB with the KTX2 textures and meshopt geometry the pipeline ships. */
async function loadGltf(url: string, renderer: WebGLRenderer): Promise<GLTF> {
  const ktx2 = new KTX2Loader().setTranscoderPath(BASIS_TRANSCODER_PATH);
  try {
    ktx2.detectSupport(renderer);
    const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
    return await loader.loadAsync(url);
  } finally {
    // Ends the transcoder workers; the decoded textures stay valid.
    ktx2.dispose();
  }
}

/**
 * Loads the compound model for a quality tier (and variant: Zaitun Hills has its own 28 ha model).
 * Rejects (after reporting the error) when the file is missing or broken, so the caller can keep
 * the procedural fallback.
 */
export async function loadCompound(tier: QualityTier, renderer: WebGLRenderer, variant: SceneVariant = "dijla"): Promise<Group> {
  const url = compoundModelUrl(variant, tier);
  try {
    const gltf = await loadGltf(url, renderer);
    const group = gltf.scene;
    group.name = COMPOUND_NAME;
    prepareCompound(group);
    return group;
  } catch (error) {
    reportError("sawad-scene", error, { stage: "compound-model", tier, variant, url });
    throw error;
  }
}

/** Loads an instanced library (plants, or people, cars and birds). Rejects after reporting, like `loadCompound`. */
export async function loadLibrary(kind: LibraryKind, tier: QualityTier, renderer: WebGLRenderer): Promise<GltfLibrary> {
  const url = LIBRARY_URL[kind][tier];
  try {
    const gltf = await loadGltf(url, renderer);
    return { scene: gltf.scene, animations: gltf.animations };
  } catch (error) {
    reportError("sawad-scene", error, { stage: kind, tier, url });
    throw error;
  }
}
