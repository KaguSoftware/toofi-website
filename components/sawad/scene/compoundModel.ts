import { NormalBlending, type Group, type Material, type Mesh, type Object3D, type Texture, type WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { reportError } from "@/lib/monitoring";
import type { QualityTier } from "./types";

/**
 * The baked compound architecture (scripts/blender/build_compound.py). The high tier has the
 * 2048 trim sheet and 1024 AO; the low tier 1024 / 512, without mashrabiya screens or benches.
 */
export const COMPOUND_MODEL_URL: Record<QualityTier, string> = {
  high: "/sawad/models/compound-high.glb",
  low: "/sawad/models/compound-low.glb",
};
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

/**
 * Loads the compound model for a quality tier. Rejects (after reporting the error) when the
 * file is missing or broken, so the caller can keep the procedural fallback.
 */
export async function loadCompound(tier: QualityTier, renderer: WebGLRenderer): Promise<Group> {
  const url = COMPOUND_MODEL_URL[tier];
  const ktx2 = new KTX2Loader().setTranscoderPath(BASIS_TRANSCODER_PATH);
  try {
    ktx2.detectSupport(renderer);
    const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    const group = gltf.scene;
    group.name = COMPOUND_NAME;
    prepareCompound(group);
    return group;
  } catch (error) {
    reportError("sawad-scene", error, { stage: "compound-model", tier, url });
    throw error;
  } finally {
    // Ends the transcoder workers; the decoded textures stay valid.
    ktx2.dispose();
  }
}
