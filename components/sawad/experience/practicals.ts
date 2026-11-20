import type { Material, Mesh, MeshStandardMaterial, Object3D } from "three";

/**
 * The lights people switch on at dusk, found in the baked model by material name: window glass
 * (`glass`), lamp heads and fittings (`lamp-glow`), and the mirror-like materials whose sky
 * reflection has to dim with the sky. daylight.ts drives their strength.
 */
export const WINDOW_MATERIAL = "glass";
export const LAMP_MATERIAL = "lamp-glow";

export type Practicals = { windows: MeshStandardMaterial[]; lamps: MeshStandardMaterial[]; mirrors: MeshStandardMaterial[] };

/** Share of windows that are lit at dusk (the lighting track lit 72 % of the villas). */
export const LIT_WINDOWS = 0.72;

const PARS_VERTEX = /* glsl */ `
varying vec3 vWindowWorld;
`;
const MAIN_VERTEX = /* glsl */ `
vec4 windowWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  windowWorld = instanceMatrix * windowWorld;
#endif
vWindowWorld = (modelMatrix * windowWorld).xyz;
`;
const PARS_FRAGMENT = /* glsl */ `
varying vec3 vWindowWorld;
float windowHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
`;
/** One room is about 3 m wide and a storey high: each cell is lit or dark, and no two glow alike. */
const MAIN_FRAGMENT = /* glsl */ `
{
  vec3 room = floor(vec3(vWindowWorld.x / 3.1, vWindowWorld.y / 3.6, vWindowWorld.z / 3.1));
  float lit = step(${(1 - LIT_WINDOWS).toFixed(2)}, windowHash(room));
  totalEmissiveRadiance *= lit * (0.55 + 0.45 * windowHash(room + 17.0));
}
`;

const PATCHED = "windowRooms";

/** Makes a window material glow room by room instead of as one sheet. */
export function patchWindowRooms(material: MeshStandardMaterial): void {
  if (material.userData[PATCHED]) return;
  material.userData[PATCHED] = true;
  const before = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${PARS_VERTEX}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${MAIN_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${PARS_FRAGMENT}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${MAIN_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => `${cacheKey.call(material)}|window-rooms`;
  material.needsUpdate = true;
}

const isMirror = (m: MeshStandardMaterial) => (m.metalness >= 0.5 && !m.metalnessMap) || (m.roughness <= 0.1 && !m.roughnessMap);

/** Finds the model's windows, lamps and mirror-like materials, and prepares the windows to glow by room. */
export function findPracticals(model: Object3D | null): Practicals {
  const found: Practicals = { windows: [], lamps: [], mirrors: [] };
  if (!model) return found;
  const seen = new Set<Material>();
  model.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as MeshStandardMaterial;
      if (!std.isMeshStandardMaterial || seen.has(m)) continue;
      seen.add(m);
      if (m.name === WINDOW_MATERIAL) {
        patchWindowRooms(std);
        found.windows.push(std);
      } else if (m.name === LAMP_MATERIAL) found.lamps.push(std);
      if (isMirror(std)) found.mirrors.push(std);
    }
  });
  return found;
}
