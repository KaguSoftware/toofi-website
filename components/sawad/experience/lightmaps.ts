import { DataTexture, SRGBColorSpace, TextureLoader, Vector4, type Material, type Mesh, type MeshStandardMaterial, type Object3D, type Texture } from "three";
import type { QualityTier } from "../scene/types";
import type { Daylight } from "./daylight";

/**
 * The lighting track's baked light (docs/zaitun/LIGHTING.md), as far as today's files allow.
 *
 * The baked `ground` page is projected straight down, so it needs no second UV set: it is
 * blended in here as extra irradiance on the terrain and on the model's ground-level surfaces
 * (streets, sidewalks, garden paving). At dusk that is the lamp pools, the pool lights and the
 * spill from the windows. The `buildings` and `site` pages need TEXCOORD_2 on the model, which
 * arrives with the final export (track 6B); track 7D wires those through `material.lightMap`.
 * Day keeps the real-time sun, so the day frames are unchanged.
 */
export const LIGHTMAP_BASE = "/sawad/lightmaps/zaitun/";

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
export type LightmapManifest = {
  version: number;
  states: Record<Daylight, { intensity: number }>;
  tiers: Record<QualityTier, { pages: { ground: { files: Record<Daylight, string>; projection: { bounds: Bounds } } } }>;
};

/** The ground page for a tier and state: its file, the rectangle it covers and its intensity. */
export type GroundPage = { url: string; bounds: Bounds; intensity: number };

export async function loadLightmapManifest(fetcher: typeof fetch = fetch): Promise<LightmapManifest> {
  const res = await fetcher(`${LIGHTMAP_BASE}lightmaps.json`);
  if (!res.ok) throw new Error(`lightmaps.json: HTTP ${res.status}`);
  return (await res.json()) as LightmapManifest;
}

export function groundPage(manifest: LightmapManifest, tier: QualityTier, state: Daylight): GroundPage {
  const page = manifest.tiers[tier].pages.ground;
  return { url: LIGHTMAP_BASE + page.files[state], bounds: page.projection.bounds, intensity: manifest.states[state].intensity };
}

/** Loads a baked page: sRGB-encoded irradiance, unflipped (the glTF convention the bake uses). */
export async function loadLightmapTexture(url: string, loader: Pick<TextureLoader, "loadAsync"> = new TextureLoader()): Promise<Texture> {
  const texture = await loader.loadAsync(url);
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/** The uniforms every patched material shares, so one assignment lights them all. */
export type GroundLight = {
  uniforms: {
    uGroundLm: { value: Texture };
    /** minX, minZ, 1 / width, 1 / depth of the rectangle the page covers. */
    uGroundLmBounds: { value: Vector4 };
    /** Page intensity times how far the blend has come (0 while it is day). */
    uGroundLmStrength: { value: number };
  };
  /** The page's own intensity, from the manifest. */
  intensity: number;
  dispose: () => void;
};

/** A ground light with nothing in it yet: a black texel, so patched materials render as before. */
export function createGroundLight(): GroundLight {
  const empty = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  empty.needsUpdate = true;
  const light: GroundLight = {
    uniforms: { uGroundLm: { value: empty }, uGroundLmBounds: { value: new Vector4(0, 0, 1, 1) }, uGroundLmStrength: { value: 0 } },
    intensity: 0,
    dispose() {
      empty.dispose();
      if (light.uniforms.uGroundLm.value !== empty) light.uniforms.uGroundLm.value.dispose();
    },
  };
  return light;
}

/** Puts a loaded page into the light. The strength stays where the blend left it. */
export function setGroundPage(light: GroundLight, texture: Texture, page: Pick<GroundPage, "bounds" | "intensity">): void {
  const { minX, maxX, minZ, maxZ } = page.bounds;
  light.uniforms.uGroundLm.value = texture;
  light.uniforms.uGroundLmBounds.value.set(minX, minZ, 1 / (maxX - minX), 1 / (maxZ - minZ));
  light.intensity = page.intensity;
}

/** How far the baked light is blended in (0 to 1). */
export function setGroundBlend(light: GroundLight, blend: number): void {
  light.uniforms.uGroundLmStrength.value = light.intensity * Math.min(1, Math.max(0, blend));
}

const VERTEX_PARS = /* glsl */ `
uniform vec4 uGroundLmBounds;
varying vec2 vGroundLmUv;
`;
const VERTEX_MAIN = /* glsl */ `
vec4 groundLmWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  groundLmWorld = instanceMatrix * groundLmWorld;
#endif
groundLmWorld = modelMatrix * groundLmWorld;
vGroundLmUv = (groundLmWorld.xz - uGroundLmBounds.xy) * uGroundLmBounds.zw;
`;
const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uGroundLm;
uniform float uGroundLmStrength;
varying vec2 vGroundLmUv;
`;
/** Walls take a share of the light at their foot; faces that look down take none. */
const fragmentMain = (wall: number) => /* glsl */ `
#if defined( RE_IndirectDiffuse )
  if (uGroundLmStrength > 0.0 && vGroundLmUv.x > 0.0 && vGroundLmUv.x < 1.0 && vGroundLmUv.y > 0.0 && vGroundLmUv.y < 1.0) {
    float groundLmUp = clamp(inverseTransformDirection(geometryNormal, viewMatrix).y, 0.0, 1.0);
    irradiance += texture2D(uGroundLm, vGroundLmUv).rgb * uGroundLmStrength * mix(${wall.toFixed(2)}, 1.0, groundLmUp);
  }
#endif
`;

const PATCHED = "groundLight";

/**
 * Adds the ground light to a standard material, on top of whatever the material already
 * compiles. `wall` is the share upright faces receive (0 for none).
 */
export function patchGroundLight(material: MeshStandardMaterial, light: GroundLight, wall = 0.45): void {
  if (material.userData[PATCHED]) return;
  material.userData[PATCHED] = true;
  const before = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    Object.assign(shader.uniforms, light.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_PARS}`)
      .replace("#include <lights_fragment_maps>", `#include <lights_fragment_maps>\n${fragmentMain(wall)}`);
  };
  material.customProgramCacheKey = () => `${cacheKey.call(material)}|ground-light:${wall}`;
  material.needsUpdate = true;
}

/** Materials of the baked model that lie on the ground: streets, kerbs, sidewalks, walls and the central garden. */
export const GROUND_MATERIALS: ReadonlySet<string> = new Set(["site-atlas", "garden-atlas"]);

const materialsOf = (mesh: Mesh): Material[] => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);

/** Patches the terrain and the model's ground-level materials. Returns how many materials now take the light. */
export function applyGroundLight(light: GroundLight, terrain: Object3D | null, model: Object3D | null): number {
  let count = 0;
  const patch = (root: Object3D, accept: (m: Material) => boolean, wall: number) =>
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      for (const m of materialsOf(mesh)) {
        const std = m as MeshStandardMaterial;
        if (!std.isMeshStandardMaterial || !accept(m) || std.userData[PATCHED]) continue;
        patchGroundLight(std, light, wall);
        count += 1;
      }
    });
  if (terrain) patch(terrain, () => true, 1);
  if (model) patch(model, (m) => GROUND_MATERIALS.has(m.name), 0.45);
  return count;
}
