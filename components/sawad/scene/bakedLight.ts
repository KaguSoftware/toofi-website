import { InstancedBufferAttribute, Matrix4, Quaternion, ShaderChunk, Vector3, type BufferAttribute, type BufferGeometry, type InstancedMesh, type Material, type Mesh, type MeshStandardMaterial, type Object3D, type Texture } from "three";
import { assetUrl } from "./assetUrl";
import type { QualityTier } from "./types";

/**
 * The baked light of the Zaitun Hills model (track 4's bake, track 6B's KTX2 files; the contract
 * is docs/zaitun/LIGHTING.md). Two pages ride on the model's second lightmap UV set (`TEXCOORD_2`,
 * three's `uv2`): `buildings`, one tile per placed copy, and `site`, the streets, walls and central
 * garden. Each holds diffuse irradiance (sun or lamps, sky, bounce), so a lit surface shows the
 * soft shadows and bounce light of the Cycles film instead of the real-time hemisphere light.
 *
 * - The day pages load with the model, so the first frame (the one that replaces the poster) is
 *   already lit by them. A failure leaves the model as it was, with real-time light.
 * - Dusk pages load when dusk is first asked for; `setBakedMix` blends day to dusk.
 * - Plants, people and cars are not in the bake, so the sun's real-time shadow still darkens a
 *   baked surface where one of them stands in the light (the baked sun is taken out there).
 *   Buildings also cast real-time shadows; where the bake is already in their shadow, the
 *   result never drops below the real-time sky light.
 */
export const BAKED_LIGHT_BASE = "/sawad/lightmaps/zaitun/";
export type BakedState = "day" | "dusk";
export type BakedPage = "buildings" | "site";
const PAGES: readonly BakedPage[] = ["buildings", "site"];

type Instance = { page: string; scaleOffset: [number, number, number, number]; position: [number, number, number] };
export type BakedManifest = {
  version: number;
  states: Record<BakedState, { intensity: number }>;
  tiers: Record<QualityTier, { pages: Record<string, { files: Record<BakedState, string> }>; instances: Record<string, Instance> }>;
};

/** The stable path of a page's KTX2 file (the manifest lists the PNG masters; 6B ships each as KTX2). */
function pagePath(manifest: BakedManifest, tier: QualityTier, page: BakedPage, state: BakedState): string {
  return BAKED_LIGHT_BASE + manifest.tiers[tier].pages[page].files[state].replace(/\.png$/, ".ktx2");
}

/** The KTX2 file of a page, at its versioned address (`assetUrl`). */
export function bakedPageUrl(manifest: BakedManifest, tier: QualityTier, page: BakedPage, state: BakedState): string {
  return assetUrl(pagePath(manifest, tier, page, state));
}

/**
 * The same page at half size: its KTX2 without the top mip level (scripts/blender/diet.mjs writes it
 * beside the page, byte for byte the levels the GPU samples one step down). Same tile layout, so it
 * can stand in for the full page while the first frame is waiting (ledger T36).
 */
export function bakedHalfPageUrl(manifest: BakedManifest, tier: QualityTier, page: BakedPage, state: BakedState): string {
  return assetUrl(pagePath(manifest, tier, page, state).replace(/\.ktx2$/, ".half.ktx2"));
}

export async function loadBakedManifest(fetcher: typeof fetch = fetch): Promise<BakedManifest> {
  const res = await fetcher(assetUrl(`${BAKED_LIGHT_BASE}lightmaps.json`));
  if (!res.ok) throw new Error(`lightmaps.json: HTTP ${res.status}`);
  return (await res.json()) as BakedManifest;
}

type PageTextures = Record<BakedPage, Texture>;
type TextureLoader = { loadAsync: (url: string) => Promise<Texture> };

/** Loads one page (KTX2: sRGB and unflipped, as the bake wrote it), from its own file unless `url` names another. */
export async function loadBakedPage(manifest: BakedManifest, tier: QualityTier, page: BakedPage, state: BakedState, loader: TextureLoader, url = bakedPageUrl(manifest, tier, page, state)): Promise<Texture> {
  const t = await loader.loadAsync(url);
  t.flipY = false;
  t.channel = 2;
  return t;
}

/** Loads one state's pages; `urls` may name another file for a page (its half-size level). */
export async function loadBakedPages(manifest: BakedManifest, tier: QualityTier, state: BakedState, loader: TextureLoader, urls: Partial<Record<BakedPage, string>> = {}): Promise<PageTextures> {
  const [buildings, site] = await Promise.all(PAGES.map((p) => loadBakedPage(manifest, tier, p, state, loader, urls[p])));
  return { buildings, site };
}

type Uniform<T> = { value: T };
/** The uniforms one page's materials share, so one assignment moves every material on it. */
type PageUniforms = {
  uBakedDusk: Uniform<Texture>;
  uBakedDayIntensity: Uniform<number>;
  uBakedDuskIntensity: Uniform<number>;
  uBakedMix: Uniform<number>;
  uBakedStrength: Uniform<number>;
};

export type BakedLight = {
  tier: QualityTier;
  manifest: BakedManifest;
  day: PageTextures;
  dusk: PageTextures | null;
  uniforms: Record<BakedPage, PageUniforms>;
  /** The lit copies of the materials, by page (window glass, lamps and the like are among them). */
  materials: Record<BakedPage, MeshStandardMaterial[]>;
  dispose: () => void;
};

export function createBakedLight(manifest: BakedManifest, tier: QualityTier, day: PageTextures): BakedLight {
  const uniformsFor = (page: BakedPage): PageUniforms => ({
    uBakedDusk: { value: day[page] },
    uBakedDayIntensity: { value: manifest.states.day.intensity },
    uBakedDuskIntensity: { value: manifest.states.dusk.intensity },
    uBakedMix: { value: 0 },
    uBakedStrength: { value: 1 },
  });
  const light: BakedLight = {
    tier,
    manifest,
    day,
    dusk: null,
    uniforms: { buildings: uniformsFor("buildings"), site: uniformsFor("site") },
    materials: { buildings: [], site: [] },
    dispose() {
      for (const p of PAGES) {
        light.day[p].dispose();
        light.dusk?.[p].dispose();
        for (const m of light.materials[p]) m.dispose();
      }
    },
  };
  return light;
}

/**
 * Replaces one day page with another of the same layout (the high tier's buildings page: its half-size
 * mip level for the poster hold, then the full page, compoundModel.ts `upgradeDayPage`). Every lit
 * material on that page takes the new texture; their shaders stay (the slot is the same). Returns the
 * texture it replaced, for the caller to free once nothing draws with it.
 */
export function setBakedDayPage(light: BakedLight, page: BakedPage, texture: Texture): Texture {
  const old = light.day[page];
  light.day = { ...light.day, [page]: texture };
  for (const m of light.materials[page]) if (m.lightMap === old) m.lightMap = texture;
  // Without dusk pages the dusk uniform points at the day page (createBakedLight).
  if (light.uniforms[page].uBakedDusk.value === old) light.uniforms[page].uBakedDusk.value = texture;
  return old;
}

/** Puts the dusk pages in. The blend stays where it was. */
export function setBakedDusk(light: BakedLight, dusk: PageTextures): void {
  light.dusk = dusk;
  for (const p of PAGES) light.uniforms[p].uBakedDusk.value = dusk[p];
}

/** How far the baked light has gone from day (0) to dusk (1). Without dusk pages it stays on day. */
export function setBakedMix(light: BakedLight, mix: number): void {
  const m = light.dusk ? Math.min(1, Math.max(0, mix)) : 0;
  for (const p of PAGES) light.uniforms[p].uBakedMix.value = m;
}

/** How much the baked light replaces the real-time light (1: fully baked, 0: real-time only). */
export function setBakedStrength(light: BakedLight, strength: number): void {
  const s = Math.min(1, Math.max(0, strength));
  for (const p of PAGES) {
    light.uniforms[p].uBakedStrength.value = s;
    // The lightmap already holds the occlusion; the baked AO fades out as it takes over.
    for (const m of light.materials[p]) m.aoMapIntensity = m.userData.bakedAo * (1 - s);
  }
}

const VERTEX_PARS = /* glsl */ `
#ifdef USE_INSTANCING
  attribute vec4 lightmapTile;
#endif
`;
/** Copies share one mesh but each has its own tile on the buildings page. */
const VERTEX_MAIN = /* glsl */ `
#if defined( USE_INSTANCING ) && defined( USE_LIGHTMAP )
  vLightMapUv = vLightMapUv * lightmapTile.xy + lightmapTile.zw;
#endif
`;
/** Mip bias for the dusk pages (see FRAGMENT_MAPS). */
export const DUSK_MIP_BIAS = 1.2;
const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uBakedDusk;
uniform float uBakedDayIntensity;
uniform float uBakedDuskIntensity;
uniform float uBakedMix;
uniform float uBakedStrength;
// The sun's real-time shadow at this pixel, as three's light loop computed it (see SUN_SHADOW).
float bakedSunLit = 1.0;
`;
/**
 * Replaces three's lightmap step: the baked irradiance takes the place of the ambient and
 * hemisphere light and of the sun's real-time diffuse light (it already holds both); the sun
 * still adds its specular highlights, the environment its reflections.
 */
const FRAGMENT_MAPS = /* glsl */ `
#if defined( RE_IndirectDiffuse )
  #ifdef USE_LIGHTMAP
  {
    vec3 bakedDay = texture2D( lightMap, vLightMapUv ).rgb * uBakedDayIntensity;
    // One mip down: the dusk bake's lamp light carries soft sampling blotches that this evens out.
    vec3 bakedDusk = texture2D( uBakedDusk, vLightMapUv, ${DUSK_MIP_BIAS.toFixed(1)} ).rgb * uBakedDuskIntensity;
    vec3 baked = mix( bakedDay, bakedDusk, uBakedMix );
    #if ( NUM_DIR_LIGHTS > 0 )
      // The sun's light that something not in the bake (a tree, a person, a car) holds back:
      // bakedSunLit, kept from three's own shadow lookup for the sun (lightsWithSunShadow).
      vec3 bakedSun = saturate( dot( geometryNormal, directionalLights[ 0 ].direction ) ) * directionalLights[ 0 ].color;
      baked = max( baked - bakedSun * ( 1.0 - bakedSunLit ), min( baked, irradiance ) );
    #endif
    irradiance = mix( irradiance, baked, uBakedStrength );
  }
  #endif
  #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )
    iblIrradiance += getIBLIrradiance( geometryNormal ) * ( 1.0 - uBakedStrength );
  #endif
#endif
reflectedLight.directDiffuse *= 1.0 - uBakedStrength;
`;
/**
 * three's shadow lookup for each directional light, in its light loop (lights_fragment_begin). The
 * baked light needs the sun's (light 0) value again in its own step; it used to look it up a second
 * time, a full PCF lookup per baked pixel (S4-12: up to 0.5 ms a frame). It now keeps the value.
 */
const SUN_SHADOW = "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;";
/** The same lookup, kept in `bakedSunLit` for light 0. The loop is unrolled: `[ i ]` and `UNROLLED_LOOP_INDEX` become each light's index. */
const SUN_SHADOW_KEPT = `{
		float bakedShadowLit = ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#if ( UNROLLED_LOOP_INDEX == 0 )
		bakedSunLit = bakedShadowLit;
		#endif
		directLight.color *= bakedShadowLit;
		}`;

/** three's light loop with the sun's shadow kept for the baked step (the picture is the same). */
export function lightsWithSunShadow(chunk: string = ShaderChunk.lights_fragment_begin): string {
  if (!chunk.includes(SUN_SHADOW)) throw new Error("three's lights_fragment_begin chunk changed: the baked light cannot keep the sun's shadow");
  return chunk.replace(SUN_SHADOW, SUN_SHADOW_KEPT);
}

/** The rest of three's chunk (reflections), unchanged: everything after its diffuse block. */
const MAPS_TAIL_MARKER = "#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )";

/** The reflection half of three's lights_fragment_maps chunk, kept verbatim after the baked diffuse. */
export function mapsTail(chunk: string = ShaderChunk.lights_fragment_maps): string {
  const at = chunk.indexOf(MAPS_TAIL_MARKER);
  if (at < 0) throw new Error("three's lights_fragment_maps chunk changed: the baked light cannot patch it");
  return chunk.slice(at);
}

/** Turns a copy of a model material into one lit by a baked page. */
export function bakeMaterial(source: MeshStandardMaterial, texture: Texture, uniforms: PageUniforms, page: BakedPage): MeshStandardMaterial {
  const tail = mapsTail();
  const lights = lightsWithSunShadow();
  const m = source.clone();
  m.name = source.name;
  m.lightMap = texture;
  m.lightMapIntensity = 1;
  m.userData = { ...source.userData, baked: page, bakedAo: source.aoMapIntensity };
  m.aoMapIntensity = 0;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
      .replace("#include <uv_vertex>", `#include <uv_vertex>\n${VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_PARS}`)
      .replace("#include <lights_fragment_begin>", lights)
      .replace("#include <lights_fragment_maps>", `${FRAGMENT_MAPS}\n${tail}`);
  };
  m.customProgramCacheKey = () => `baked-light:${page}`;
  return m;
}

/** Never lit by a page: single faces seen from both sides (the bake leaves them to real-time light). */
export const UNBAKED_MATERIAL = /(-lattice|-screen|^glass-clear)$/;

const materialsOf = (mesh: Mesh): Material[] => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);
const bakeable = (m: Material): m is MeshStandardMaterial =>
  (m as MeshStandardMaterial).isMeshStandardMaterial === true && !m.transparent && m.alphaTest === 0 && !UNBAKED_MATERIAL.test(m.name);

type NamedCopy = Instance & { name: string };

/** Placed copies on the buildings page, for matching instances by where they stand. */
function buildingCopies(manifest: BakedManifest, tier: QualityTier): NamedCopy[] {
  return Object.entries(manifest.tiers[tier].instances)
    .filter(([, i]) => i.page === "buildings")
    .map(([name, i]) => ({ ...i, name }));
}

/** The copy standing at a point (within 0.5 m across the ground), or null. */
export function copyAt<T extends Instance>(copies: readonly T[], x: number, z: number): T | null {
  let best: T | null = null;
  let bestD = 0.5;
  for (const c of copies) {
    const d = Math.hypot(c.position[0] - x, c.position[2] - z);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/** A single copy keeps its node name through the export (`gym`, `site`): the mesh or a parent carries it. */
export function copyNamed(manifest: BakedManifest, tier: QualityTier, mesh: Object3D, root: Object3D): Instance | null {
  const instances = manifest.tiers[tier].instances;
  for (let o: Object3D | null = mesh; o && o !== root; o = o.parent) {
    const hit = instances[o.name] ?? instances[o.name.replace(/_\d+$/, "")];
    if (hit) return hit;
  }
  return null;
}

/** One placed copy of an instanced mesh: where its transform puts the mesh, and how it is turned. */
export type CopyTransform = { position: Vector3; rotation: Quaternion; scale: number };

const off = new Vector3();
const at = new Vector3();
const back = new Quaternion();

/**
 * Finds each copy's tile. The export quantizes positions, so every copy's transform carries the
 * same local offset (the centre of the mesh's original bounds), turned with the copy: transform
 * position = placed position + rotation × offset. The offset is unknown, so it is solved for:
 * each placed copy near the first transform is tried as its match, and the offset that puts
 * every other transform on a distinct placed copy wins. Returns one scale/offset per copy, or
 * null when no offset fits them all.
 */
export function solveTiles(transforms: readonly CopyTransform[], copies: readonly NamedCopy[]): Float32Array | null {
  if (transforms.length === 0) return null;
  const first = transforms[0];
  // The offset lies inside the mesh's own bounds (quantized to -1..1, then scaled).
  const reach = first.scale * 1.8;
  const near = copies
    .map((c) => ({ c, d: Math.hypot(c.position[0] - first.position.x, c.position[2] - first.position.z) }))
    .filter((e) => e.d <= reach)
    .sort((a, b) => a.d - b.d);
  for (const { c } of near) {
    off.set(first.position.x - c.position[0], first.position.y - c.position[1], first.position.z - c.position[2]).applyQuaternion(back.copy(first.rotation).invert());
    const tiles = new Float32Array(transforms.length * 4);
    const used = new Set<string>();
    let ok = true;
    for (let i = 0; i < transforms.length && ok; i++) {
      const t = transforms[i];
      at.copy(off).applyQuaternion(t.rotation);
      const hit = copyAt(copies, t.position.x - at.x, t.position.z - at.z);
      if (!hit || used.has(hit.name)) ok = false;
      else {
        used.add(hit.name);
        tiles.set(hit.scaleOffset, i * 4);
      }
    }
    if (ok) return tiles;
  }
  return null;
}

const TILED = "bakedTile";

/**
 * Moves a single copy's lightmap UVs onto its tile. Copies that share one mesh (fewer than the
 * export's instancing threshold) each get their own geometry first, cloned before any is moved.
 */
function tileUv2(mesh: Mesh, scaleOffset: Instance["scaleOffset"], shared: boolean): void {
  if (mesh.geometry.userData[TILED]) return;
  const [sx, sy, ox, oy] = scaleOffset;
  if (sx === 1 && sy === 1 && ox === 0 && oy === 0) return;
  const g: BufferGeometry = shared ? mesh.geometry.clone() : mesh.geometry;
  // A clone shares its source's userData object (BufferGeometry.copy): give it its own.
  g.userData = { ...g.userData, [TILED]: true };
  mesh.geometry = g;
  const uv2 = g.getAttribute("uv2") as BufferAttribute;
  for (let i = 0; i < uv2.count; i++) uv2.setXY(i, uv2.getX(i) * sx + ox, uv2.getY(i) * sy + oy);
  uv2.needsUpdate = true;
}

const m4 = new Matrix4();
const sc = new Vector3();

/** Where the instanced mesh's copies stand (world space). */
function transformsOf(inst: InstancedMesh): CopyTransform[] {
  const out: CopyTransform[] = [];
  for (let i = 0; i < inst.count; i++) {
    inst.getMatrixAt(i, m4);
    m4.premultiply(inst.matrixWorld);
    const t: CopyTransform = { position: new Vector3(), rotation: new Quaternion(), scale: 1 };
    m4.decompose(t.position, t.rotation, sc);
    t.scale = Math.max(sc.x, sc.y, sc.z);
    out.push(t);
  }
  return out;
}

/**
 * Lights the model with the baked pages: every mesh with lightmap UVs gets lit copies of its
 * materials, and its copies their tiles. A mesh whose copies cannot all be matched to the bake
 * keeps real-time light. Returns how many meshes are now baked.
 */
export function applyBakedLight(model: Object3D, light: BakedLight): number {
  const { manifest, tier } = light;
  const copies = buildingCopies(manifest, tier);
  const lit = new Map<string, MeshStandardMaterial>();
  const litCopy = (m: MeshStandardMaterial, page: BakedPage) => {
    const key = `${page}:${m.uuid}`;
    let c = lit.get(key);
    if (!c) {
      c = bakeMaterial(m, light.day[page], light.uniforms[page], page);
      lit.set(key, c);
      light.materials[page].push(c);
    }
    return c;
  };
  model.updateMatrixWorld(true);
  const users = new Map<BufferGeometry, number>();
  model.traverse((o) => {
    if ((o as Mesh).isMesh) users.set((o as Mesh).geometry, (users.get((o as Mesh).geometry) ?? 0) + 1);
  });
  // Primitives of one instanced mesh share their transforms: solve once per set of transforms.
  const solved = new Map<string, Float32Array | null>();
  let count = 0;
  model.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.geometry.getAttribute("uv2") || !materialsOf(mesh).some(bakeable)) return;
    const inst = (mesh as InstancedMesh).isInstancedMesh ? (mesh as InstancedMesh) : null;
    let page: BakedPage;
    if (inst) {
      const key = `${inst.count}:${Array.from(inst.instanceMatrix.array.subarray(0, 16)).join(",")}`;
      if (!solved.has(key)) solved.set(key, solveTiles(transformsOf(inst), copies));
      const tiles = solved.get(key);
      if (!tiles) return;
      inst.geometry.setAttribute("lightmapTile", new InstancedBufferAttribute(tiles, 4));
      page = "buildings";
    } else {
      const c = copyNamed(manifest, tier, mesh, model);
      if (!c) return;
      page = c.page as BakedPage;
      tileUv2(mesh, c.scaleOffset, (users.get(mesh.geometry) ?? 0) > 1);
    }
    const next = materialsOf(mesh).map((m) => (bakeable(m) ? litCopy(m, page) : m));
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
    count += 1;
  });
  return count;
}
