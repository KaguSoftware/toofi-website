/**
 * Wind, leaf flutter and distance-card billboarding for the Zaitun vegetation library
 * (public/sawad/models/vegetation-{high,low}.glb, built by scripts/blender/vegetation.py).
 *
 * The GLB carries a `_WIND` vertex attribute (three.js: `_wind`, vec4 in 0..1):
 *   x  sway: 0 at the ground, rising with height; the whole plant bends downwind
 *   y  branch: 0 on the trunk, rising along limbs and fronds (on `card` meshes: 1 marks the
 *      quad that turns to face the camera)
 *   z  flutter: 0 at a leaf card's stem, 1 at its tip
 *   w  phase: random per limb, cluster or frond
 *
 * `applyWind(material, wind, kind)` patches a built-in lit material (what GLTFLoader returns)
 * through onBeforeCompile; every patched material shares the uniforms of one `createWind()`,
 * so a single `wind.update(elapsedSeconds)` per frame moves the whole site. Displacement is in
 * world metres, after instancing, so instanced trees at any heading bend the same way.
 *
 * Olives flash their silver undersides: back faces take the underside colour, and fluttering
 * leaf tips lighten toward it in gusts (the "evening breeze off the slopes").
 */
import {
  BufferAttribute,
  Color,
  Matrix4,
  ShaderChunk,
  Vector2,
  type BufferGeometry,
  type IUniform,
  type Material,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { reportError } from "@/lib/monitoring";

export type FoliageKind = "olive" | "palm" | "citrus" | "hedge" | "grass" | "card" | "bark";

/** Material names in the GLB -> the kind of patch they get. */
export const MATERIAL_KINDS: Readonly<Record<string, FoliageKind>> = {
  "veg-olive": "olive",
  "veg-palm": "palm",
  "veg-citrus": "citrus",
  "veg-hedge": "hedge",
  "veg-grass": "grass",
  "veg-card": "card",
  "veg-opaque": "bark",
};

export type WindUniforms = {
  uWindTime: IUniform<number>;
  /** Unit vector in the xz plane, the direction the wind blows toward. */
  uWindDir: IUniform<Vector2>;
  /** Sway at the top of a 5 m tree, in metres. */
  uWindStrength: IUniform<number>;
  /** 0 = steady breeze, 1 = gusts rolling across the site. */
  uWindGust: IUniform<number>;
  uUnderside: IUniform<Color>;
};

export type Wind = {
  uniforms: WindUniforms;
  update: (elapsedSeconds: number) => void;
  /** Wind toward a heading in radians in the xz plane (0 = +x, downstream). */
  setDirection: (radians: number) => void;
};

export type WindOptions = { direction?: number; strength?: number; gust?: number; underside?: string };

/**
 * The site story is a cooler evening breeze off the slopes: it blows from the foothills toward the
 * stream (-z toward +z in the river-relative axes), gently.
 */
export function createWind({ direction = Math.PI / 2, strength = 0.14, gust = 0.6, underside = "#b7bca8" }: WindOptions = {}): Wind {
  const uniforms: WindUniforms = {
    uWindTime: { value: 0 },
    uWindDir: { value: new Vector2(Math.cos(direction), Math.sin(direction)) },
    uWindStrength: { value: strength },
    uWindGust: { value: gust },
    uUnderside: { value: new Color(underside) },
  };
  return {
    uniforms,
    update: (t) => {
      uniforms.uWindTime.value = t;
    },
    setDirection: (radians) => {
      uniforms.uWindDir.value.set(Math.cos(radians), Math.sin(radians));
    },
  };
}

const VERTEX_PARS = /* glsl */ `
attribute vec4 _wind;
uniform float uWindTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uWindGust;
varying float vSawadSilver;

float sawadHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// World-space offset for one vertex. origin: the plant's base in world space; localY: height
// above the base in the plant's own metres (taller plants travel further at the top).
vec3 sawadWind(vec3 wp, vec3 origin, float localY, vec4 w) {
  float t = uWindTime;
  float ph = sawadHash(origin.xz) * 6.2831853;
  vec3 dir = vec3(uWindDir.x, 0.0, uWindDir.y);
  // Gusts roll across the site downwind, about 40 m apart.
  float gust = 1.0 + uWindGust * (0.55 * sin(dot(origin.xz, uWindDir) * 0.16 - t * 0.9) - 0.15);
  float reach = uWindStrength * gust * (0.6 + 0.08 * max(localY, 0.0));
  // The whole plant leans downwind and rocks slowly.
  vec3 off = dir * w.x * reach * (0.7 + 0.3 * sin(t * 1.15 + ph));
  // Limbs and fronds bob out of step with each other.
  float bp = ph + w.w * 6.2831853;
  off += (dir * 0.55 + vec3(0.0, 0.45, 0.0)) * w.y * reach * 0.45 * sin(t * 2.1 + bp);
  // Leaf tips shiver.
  off += vec3(sin(t * 7.3 + bp * 3.1 + wp.x * 0.7), 0.6 * cos(t * 6.1 + bp * 2.3 + wp.z * 0.9), cos(t * 8.3 + bp * 1.7)) * w.z * uWindStrength * gust * 0.22;
  vSawadSilver = w.z * clamp(gust - 0.6, 0.0, 1.0) * (0.5 + 0.5 * sin(t * 5.3 + bp * 4.0));
  return off;
}
`;

function projectVertex(kind: FoliageKind): string {
  const billboard =
    kind === "card"
      ? /* glsl */ `
  // Distance card: the flagged quad turns to the camera about the plant's up axis.
  if (_wind.y > 0.5) {
    vec3 toCam = cameraPosition - sawadOrigin;
    vec2 d = normalize(toCam.xz + vec2(1e-5, 0.0));
    vec3 right = vec3(d.y, 0.0, -d.x);
    vec3 facing = vec3(d.x, 0.0, d.y);
    vec3 up = vec3(0.0, 1.0, 0.0);
    sawadWorld.xyz = sawadOrigin + right * (transformed.x * sawadScale.x) + up * (transformed.y * sawadScale.y);
    #ifndef FLAT_SHADED
      vec3 n = normalize(right * objectNormal.x + up * objectNormal.y + facing * objectNormal.z);
      vNormal = normalize((viewMatrix * vec4(n, 0.0)).xyz);
    #endif
  }
`
      : "";
  return /* glsl */ `
  vec4 sawadLocal = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    sawadLocal = batchingMatrix * sawadLocal;
  #endif
  mat4 sawadModel = modelMatrix;
  #ifdef USE_INSTANCING
    sawadModel = modelMatrix * instanceMatrix;
  #endif
  vec4 sawadWorld = sawadModel * sawadLocal;
  vec3 sawadOrigin = (sawadModel * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 sawadScale = vec3(length(sawadModel[0].xyz), length(sawadModel[1].xyz), length(sawadModel[2].xyz));
${billboard}
  sawadWorld.xyz += sawadWind(sawadWorld.xyz, sawadOrigin, transformed.y * sawadScale.y, _wind);
  vec4 mvPosition = viewMatrix * sawadWorld;
  gl_Position = projectionMatrix * mvPosition;
`;
}

const FRAGMENT_PARS = /* glsl */ `
varying float vSawadSilver;
uniform vec3 uUnderside;
`;

const OLIVE_COLOR = /* glsl */ `
#include <color_fragment>
// Silver undersides: back faces, and fluttering tips in a gust.
diffuseColor.rgb = mix(diffuseColor.rgb, uUnderside, gl_FrontFacing ? vSawadSilver * 0.45 : 0.62);
`;

/**
 * Alpha-tested leaves thin out and vanish with distance: each mip level averages leaf texels with
 * transparent ones, so thin leaflets and frond tips fall under the 0.5 cutoff. Scaling alpha up by
 * the mip level being sampled (estimated from the UV derivatives) keeps the coverage the leaf had
 * at full size, so far palms keep their fronds attached to the crown.
 */
const alphaCoverage = (perLevel: number) => /* glsl */ `
#include <map_fragment>
#ifdef USE_MAP
  vec2 sawadTexel = vMapUv * vec2(textureSize(map, 0));
  vec2 sawadDx = dFdx(sawadTexel);
  vec2 sawadDy = dFdy(sawadTexel);
  float sawadLod = max(0.0, 0.5 * log2(max(dot(sawadDx, sawadDx), dot(sawadDy, sawadDy))));
  diffuseColor.a *= 1.0 + sawadLod * ${perLevel.toFixed(2)};
#endif
`;

/** How hard each kind holds its coverage: thin palm leaflets need the most; dense crowns little,
 * or they fill in and lose their airy, silvery read. */
const COVERAGE: Readonly<Partial<Record<FoliageKind, number>>> = { palm: 0.3, card: 0.2, grass: 0.2, hedge: 0.15, citrus: 0.12, olive: 0.1 };

/** Foliage keeps its crown-shaped normals on both faces (no flip), so a crown shades as one volume. */
const FOLIAGE_NORMAL = ShaderChunk.normal_fragment_begin.replace("normal *= faceDirection;", "/* sawad foliage: keep the crown normal */");

const FOLIAGE: ReadonlySet<FoliageKind> = new Set(["olive", "palm", "citrus", "hedge", "grass", "card"]);

/**
 * Patch a GLTFLoader material for wind. Safe to call once per material; chains any existing
 * onBeforeCompile. If three.js's shader chunks change shape, the material is left as it is and
 * the problem is reported as `sawad-wind` (the plants just stand still).
 */
export function applyWind(material: Material, wind: Wind, kind: FoliageKind): void {
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    previous(shader, renderer);
    const vertex = shader.vertexShader;
    const fragment = shader.fragmentShader;
    if (!vertex.includes("#include <project_vertex>") || !vertex.includes("void main()") || !fragment.includes("void main()")) {
      reportError("sawad-wind", new Error("three.js shader chunks changed; wind not applied"), { kind, material: material.name });
      return;
    }
    Object.assign(shader.uniforms, wind.uniforms);
    shader.vertexShader = (VERTEX_PARS + vertex).replace("#include <project_vertex>", projectVertex(kind));
    let frag = FRAGMENT_PARS + fragment;
    if (FOLIAGE.has(kind)) {
      frag = frag.replace("#include <normal_fragment_begin>", FOLIAGE_NORMAL);
      frag = frag.replace("#include <map_fragment>", alphaCoverage(COVERAGE[kind] ?? 0.15));
    }
    if (kind === "olive") frag = frag.replace("#include <color_fragment>", OLIVE_COLOR);
    shader.fragmentShader = frag;
  };
  material.customProgramCacheKey = () => `sawad-wind-${kind}`;
  material.needsUpdate = true;
}

/** Patch every vegetation material found on a loaded GLB scene (by the names vegetation.py gives them). */
export function applyWindToScene(root: { traverse: (fn: (o: unknown) => void) => void }, wind: Wind): number {
  const seen = new Set<Material>();
  root.traverse((o) => {
    const mesh = o as { isMesh?: boolean; material?: Material | Material[] };
    if (!mesh.isMesh || !mesh.material) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const kind = MATERIAL_KINDS[m.name];
      if (kind && !seen.has(m)) {
        seen.add(m);
        applyWind(m, wind, kind);
      }
    }
  });
  return seen.size;
}

type BakeableMesh = {
  isMesh?: boolean;
  isSkinnedMesh?: boolean;
  geometry: BufferGeometry;
  matrix: Matrix4;
  matrixWorld: Matrix4;
  position: { set: (x: number, y: number, z: number) => void };
  quaternion: { identity: () => void };
  scale: { set: (x: number, y: number, z: number) => void };
  updateMatrix: () => void;
};

/**
 * Meshopt (KHR_mesh_quantization) stores positions as normalized integers and puts the scale and
 * offset that undo it into each node's matrix. Instanced plants need the opposite: float geometry
 * in the plant's own metres with its origin at the trunk base, because the wind and the distance
 * cards measure height and turn about that origin. This bakes each mesh's transform (relative to
 * `root`) into Float32 positions and normals and resets the mesh to identity. Skinned meshes are
 * left alone (three.js handles their quantization through the bind matrices).
 */
export function bakeNodeTransforms(root: Object3D): number {
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const m = new Matrix4();
  let baked = 0;
  root.traverse((o) => {
    const mesh = o as unknown as BakeableMesh;
    if (!mesh.isMesh || mesh.isSkinnedMesh) return;
    const g = mesh.geometry;
    for (const name of ["position", "normal"]) {
      const attr = g.getAttribute(name);
      if (attr && (attr.normalized || !(attr.array instanceof Float32Array))) {
        const out = new Float32Array(attr.count * attr.itemSize);
        for (let i = 0; i < attr.count; i++) for (let k = 0; k < attr.itemSize; k++) out[i * attr.itemSize + k] = attr.getComponent(i, k);
        g.setAttribute(name, new BufferAttribute(out, attr.itemSize));
      }
    }
    m.multiplyMatrices(toRoot, mesh.matrixWorld);
    g.applyMatrix4(m);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    // The mesh now sits at the root's origin: reset its own transform (and drop parents' through `root`).
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrix();
    baked++;
  });
  return baked;
}

export type VegetationLod = "LOD0" | "LOD1" | "LOD2" | "card";

/**
 * Which level of detail to draw at a distance (metres). The low tier ships no LOD0 and swaps to
 * cards sooner. Distances are chosen so a switch happens below ~40 px of screen height change on
 * a 1080p frame at the street views' 35-40 degree field of view.
 */
export const LOD_DISTANCES: Readonly<Record<"high" | "low", readonly [number, number, number]>> = {
  high: [22, 55, 95],
  low: [0, 35, 65],
};

export function lodFor(distance: number, tier: "high" | "low"): VegetationLod {
  const [a, b, c] = LOD_DISTANCES[tier];
  if (distance < a) return "LOD0";
  if (distance < b) return "LOD1";
  if (distance < c) return "LOD2";
  return "card";
}

/**
 * Morph weights [wings-up, wings-down] for the bird in life-*.glb at a time (s), for flocks drawn
 * as one InstancedMesh (`setMorphAt`). A bird flaps for a few beats, then glides with its wings
 * slightly raised; `phase` (0..1) keeps a flock out of step.
 */
export function flapWeights(time: number, phase = 0): [number, number] {
  const beatsPerSecond = 3;
  const cycle = 2.6; // seconds: flap ~1.4 s, glide ~1.2 s
  const local = (((time + phase * cycle) % cycle) + cycle) % cycle;
  if (local > 1.4) return [0.25, 0];
  const s = Math.sin(local * beatsPerSecond * Math.PI * 2);
  return [Math.max(0, s), Math.max(0, -s)];
}
